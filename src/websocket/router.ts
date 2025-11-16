import { userStore } from '../domain/users.js';
import { roomsStore } from '../domain/rooms.js';
import { gamesStore } from '../domain/games.js';
import { logError, logInfo } from '../utils/logger.js';
import { broadcastAll, sendError, sendPersonal } from './sender.js';
import { connectionStore } from './connections.js';

export interface WebSocketMessage {
    type: string;
    data: unknown;
    id: number;
}

type CommandHandler = (context: { message: WebSocketMessage; connectionId: number }) => Promise<void>;

const buildLeaderboard = () =>
    userStore.listLeaderboard().map((entry) => ({
        name: entry.name,
        wins: entry.wins,
    }));

const broadcastWinners = () => {
    const data = buildLeaderboard();
    broadcastAll({
        type: 'update_winners',
        data,
        id: 0,
    });
};

const buildRoomsState = () =>
    roomsStore.listOpenRooms().reduce<Array<{ roomId: string; roomUsers: Array<{ name: string; index: string }> }>>(
        (acc, room) => {
            const roomUsers = room.users
                .map((userId) => {
                    const user = userStore.getById(userId);
                    if (!user) {
                        return null;
                    }
                    return { name: user.name, index: user.id };
                })
                .filter((value): value is { name: string; index: string } => value !== null);

            if (roomUsers.length === 0) {
                return acc;
            }

            acc.push({ roomId: room.id, roomUsers });
            return acc;
        },
        [],
    );

const broadcastRooms = () => {
    const data = buildRoomsState();
    broadcastAll({
        type: 'update_room',
        data,
        id: 0,
    });
};

const requireAuthenticatedUser = (connectionId: number, messageId: number): string | null => {
    const userId = connectionStore.getUserId(connectionId);
    if (!userId) {
        sendError(connectionId, 'Authentication required', messageId);
        return null;
    }
    return userId;
};

const handleReg: CommandHandler = async ({ message, connectionId }) => {
    if (typeof message.data !== 'object' || message.data === null) {
        sendError(connectionId, 'Invalid payload for "reg" command', message.id);
        return;
    }

    const { name, password } = message.data as Partial<{ name: unknown; password: unknown }>;

    if (typeof name !== 'string' || typeof password !== 'string') {
        sendError(connectionId, 'Name and password must be provided as strings', message.id);
        return;
    }

    const result = userStore.registerOrLogin(name, password);

    if ('error' in result) {
        sendPersonal(connectionId, {
            type: 'reg',
            data: {
                name,
                index: '',
                error: true,
                errorText: result.error,
            },
            id: message.id,
        });
        return;
    }

    const { user } = result;

    connectionStore.setUser(connectionId, user.id);

    sendPersonal(connectionId, {
        type: 'reg',
        data: {
            name: user.name,
            index: user.id,
            error: false,
            errorText: '',
        },
        id: message.id,
    });

    broadcastRooms();
    broadcastWinners();
};

const handleCreateRoom: CommandHandler = async ({ message, connectionId }) => {
    const userId = requireAuthenticatedUser(connectionId, message.id);
    if (!userId) {
        return;
    }

    roomsStore.createRoomForUser(userId);
    broadcastRooms();
};

const handleAddUserToRoom: CommandHandler = async ({ message, connectionId }) => {
    if (typeof message.data !== 'object' || message.data === null) {
        sendError(connectionId, 'Invalid payload for "add_user_to_room" command', message.id);
        return;
    }

    const { indexRoom } = message.data as Partial<{ indexRoom: unknown }>;

    if (indexRoom === undefined || indexRoom === null) {
        sendError(connectionId, 'Room identifier is required', message.id);
        return;
    }

    const userId = requireAuthenticatedUser(connectionId, message.id);
    if (!userId) {
        return;
    }

    const roomId = String(indexRoom);
    const room = roomsStore.addUserToRoom(roomId, userId);

    if (!room) {
        sendError(connectionId, 'Unable to join the room', message.id);
        return;
    }

    broadcastRooms();

    const game = gamesStore.createFromRoom(room);
    roomsStore.attachGame(room.id, game.id);

    game.players.forEach((player) => {
        const targetConnection = connectionStore.findByUserId(player.userId);
        if (!targetConnection) {
            logError(`Active connection not found for user ${player.userId}`);
            return;
        }

        sendPersonal(targetConnection.id, {
            type: 'create_game',
            data: {
                idGame: game.id,
                idPlayer: player.playerId,
            },
            id: 0,
        });
    });
};

const commandHandlers: Record<string, CommandHandler> = {
    reg: handleReg,
    create_room: handleCreateRoom,
    add_user_to_room: handleAddUserToRoom,
    add_ships: async ({ message, connectionId }) => {
        if (typeof message.data !== 'object' || message.data === null) {
            sendError(connectionId, 'Invalid payload for "add_ships"', message.id);
            return;
        }

        const { gameId, ships, indexPlayer } = message.data as Partial<{ gameId: unknown; ships: unknown; indexPlayer: unknown }>;

        if (typeof gameId !== 'string' || !Array.isArray(ships) || typeof indexPlayer !== 'string') {
            sendError(connectionId, 'Invalid add_ships payload types', message.id);
            return;
        }

        // store ships
        try {
            const ready = gamesStore.setPlayerShips(gameId, indexPlayer, ships as unknown as import('../domain/games.js').Ship[]);

            sendPersonal(connectionId, {
                type: 'add_ships',
                data: { ok: true },
                id: 0,
            });

            if (ready) {
                const starter = gamesStore.startGameIfReady(gameId);
                const game = gamesStore.getById(gameId)!;

                // notify both players
                game.players.forEach((p) => {
                    const conn = connectionStore.findByUserId(p.userId);
                    if (!conn) return;

                    const myShips = game.shipsByPlayer.get(p.playerId) ?? [];
                    sendPersonal(conn.id, {
                        type: 'start_game',
                        data: {
                            ships: myShips,
                            currentPlayerIndex: starter,
                        },
                        id: 0,
                    });
                });

                // inform whose turn
                if (starter) {
                    const gameObj = gamesStore.getById(gameId)!;
                    gameObj.players.forEach((p) => {
                        const conn = connectionStore.findByUserId(p.userId);
                        if (!conn) return;
                        sendPersonal(conn.id, {
                            type: 'turn',
                            data: { currentPlayer: starter },
                            id: 0,
                        });
                    });
                }
            }
        } catch (err) {
            logError('Error in add_ships handler', err);
            sendError(connectionId, 'Server error while placing ships', message.id);
        }
    },
    attack: async ({ message, connectionId }) => {
        if (typeof message.data !== 'object' || message.data === null) {
            sendError(connectionId, 'Invalid payload for "attack"', message.id);
            return;
        }

        const { gameId, x, y, indexPlayer } = message.data as Partial<{ gameId: unknown; x: unknown; y: unknown; indexPlayer: unknown }>;

        if (typeof gameId !== 'string' || typeof x !== 'number' || typeof y !== 'number' || typeof indexPlayer !== 'string') {
            sendError(connectionId, 'Invalid attack payload types', message.id);
            return;
        }

        try {
            const result = gamesStore.handleAttack(gameId, indexPlayer, x, y);
            const game = gamesStore.getById(gameId)!;

            // broadcast attack for main cell
            game.players.forEach((p) => {
                const conn = connectionStore.findByUserId(p.userId);
                if (!conn) return;
                sendPersonal(conn.id, {
                    type: 'attack',
                    data: {
                        position: { x, y },
                        currentPlayer: result.nextPlayerId ?? game.currentPlayerId,
                        status: result.status,
                    },
                    id: 0,
                });
            });

            // if killed, also send surrounding misses and killed cells
            if (result.status === 'killed') {
                if (result.killedCells) {
                    for (const c of result.killedCells) {
                        game.players.forEach((p) => {
                            const conn = connectionStore.findByUserId(p.userId);
                            if (!conn) return;
                            sendPersonal(conn.id, {
                                type: 'attack',
                                data: { position: c, currentPlayer: result.nextPlayerId ?? game.currentPlayerId, status: 'killed' },
                                id: 0,
                            });
                        });
                    }
                }

                if (result.surroundingMisses) {
                    for (const c of result.surroundingMisses) {
                        game.players.forEach((p) => {
                            const conn = connectionStore.findByUserId(p.userId);
                            if (!conn) return;
                            sendPersonal(conn.id, {
                                type: 'attack',
                                data: { position: c, currentPlayer: result.nextPlayerId ?? game.currentPlayerId, status: 'miss' },
                                id: 0,
                            });
                        });
                    }
                }
            }

            // send turn update
            game.players.forEach((p) => {
                const conn = connectionStore.findByUserId(p.userId);
                if (!conn) return;
                sendPersonal(conn.id, { type: 'turn', data: { currentPlayer: result.nextPlayerId ?? game.currentPlayerId }, id: 0 });
            });

            // if winner
            if (result.winner) {
                game.players.forEach((p) => {
                    const conn = connectionStore.findByUserId(p.userId);
                    if (!conn) return;
                    sendPersonal(conn.id, { type: 'finish', data: { winPlayer: result.winner }, id: 0 });
                });

                // update user wins
                // map playerId -> userId
                const winnerPlayer = game.players.find((pl) => pl.playerId === result.winner!);
                if (winnerPlayer) {
                    // increment wins and broadcast leaderboard
                        userStore.incrementWins(winnerPlayer.userId);
                    // broadcast winners
                    broadcastWinners();
                }
            }
        } catch (err) {
            logError('Error in attack handler', err);
            sendError(connectionId, 'Server error while processing attack', message.id);
        }
    },
    randomAttack: async ({ message, connectionId }) => {
        // choose random available cell and reuse attack handler
        if (typeof message.data !== 'object' || message.data === null) {
            sendError(connectionId, 'Invalid payload for "randomAttack"', message.id);
            return;
        }

        const { gameId, indexPlayer } = message.data as Partial<{ gameId: unknown; indexPlayer: unknown }>;

        if (typeof gameId !== 'string' || typeof indexPlayer !== 'string') {
            sendError(connectionId, 'Invalid randomAttack payload types', message.id);
            return;
        }

        try {
            const game = gamesStore.getById(gameId);
            if (!game) {
                sendError(connectionId, 'Game not found', message.id);
                return;
            }

            // pick random x,y within 10x10 grid (simple fallback)
            const x = Math.floor(Math.random() * 10);
            const y = Math.floor(Math.random() * 10);

            // reuse attack
            await commandHandlers.attack({ message: { type: 'attack', data: { gameId, x, y, indexPlayer }, id: 0 } as WebSocketMessage, connectionId });
        } catch (err) {
            logError('Error in randomAttack handler', err);
            sendError(connectionId, 'Server error while processing randomAttack', message.id);
        }
    },
};

const validateMessage = (message: unknown): string | null => {
    if (typeof message !== 'object' || message === null) {
        return 'Payload must be an object';
    }

    const typedMessage = message as Partial<WebSocketMessage>;

    if (typeof typedMessage.type !== 'string') {
        return 'Payload "type" must be a string';
    }

    if (!Object.prototype.hasOwnProperty.call(typedMessage, 'id')) {
        return 'Payload must contain "id" field';
    }

    if (typedMessage.id !== 0) {
        return 'Payload "id" must equal 0';
    }

    return null;
};

export const handleMessage = async ({
    rawMessage,
    connectionId,
}: {
    rawMessage: string;
    connectionId: number;
}): Promise<void> => {
    let parsed: unknown;

    try {
        parsed = JSON.parse(rawMessage);
    } catch (error) {
        logError(`Invalid JSON received from connection#${connectionId}`, error);
        sendError(connectionId, 'Invalid JSON');
        return;
    }

    const validationError = validateMessage(parsed);
    if (validationError) {
        logInfo(`Validation failed for connection#${connectionId}: ${validationError}`);
        const responseId = typeof (parsed as Partial<WebSocketMessage>).id === 'number' ? (parsed as WebSocketMessage).id : 0;
        sendError(connectionId, validationError, responseId);
        return;
    }

    const message = parsed as WebSocketMessage;
    logInfo(`Received command "${message.type}" from connection#${connectionId}`);

    const handler = commandHandlers[message.type];

    if (!handler) {
        sendError(connectionId, `Command "${message.type}" is not implemented yet`, message.id);
        return;
    }

    try {
        await handler({ message, connectionId });
    } catch (error) {
        logError(`Unhandled error while processing command "${message.type}"`, error);
        sendError(connectionId, 'Internal server error', message.id);
    }
};
