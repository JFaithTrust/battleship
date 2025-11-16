import { userStore } from '../domain/users.js';
import { roomsStore } from '../domain/rooms.js';
import { gamesStore } from '../domain/games.js';
import type { Ship, Cell } from '../domain/games.js';
import { logError, logInfo } from '../utils/logger.js';
import { broadcastAll, sendError, sendPersonal } from './sender.js';
import { connectionStore } from './connections.js';

export interface WebSocketMessage {
    type: string;
    data: unknown;
    id: number;
}

type CommandHandler = (context: { message: WebSocketMessage; connectionId: number }) => Promise<void>;

const parseShipsPayload = (value: unknown): Ship[] | null => {
    if (!Array.isArray(value)) {
        return null;
    }

    const ships: Ship[] = [];

    for (const candidate of value) {
        if (typeof candidate !== 'object' || candidate === null) {
            return null;
        }

        const { position, direction, length, type } = candidate as Partial<{
            position: unknown;
            direction: unknown;
            length: unknown;
            type: unknown;
        }>;

        if (typeof direction !== 'boolean' || typeof length !== 'number' || typeof type !== 'string') {
            return null;
        }

        if (typeof position !== 'object' || position === null) {
            return null;
        }

        const { x, y } = position as Partial<{ x: unknown; y: unknown }>;
        if (typeof x !== 'number' || typeof y !== 'number' || Number.isNaN(x) || Number.isNaN(y)) {
            return null;
        }

        ships.push({
            position: { x, y },
            direction,
            length,
            type,
        });
    }

    return ships;
};

type GameSession = NonNullable<ReturnType<typeof gamesStore.getById>>;

const forEachPlayerConnection = (
    game: GameSession,
    callback: (connectionId: number, playerId: string, userId: string) => void,
) => {
    game.players.forEach((player) => {
        const connection = connectionStore.findByUserId(player.userId);
        if (!connection) {
            return;
        }
        callback(connection.id, player.playerId, player.userId);
    });
};

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
        const userId = requireAuthenticatedUser(connectionId, message.id);
        if (!userId) {
            return;
        }

        if (typeof message.data !== 'object' || message.data === null) {
            sendError(connectionId, 'Invalid payload for "add_ships"', message.id);
            return;
        }

        const { gameId, ships, indexPlayer } = message.data as Partial<{
            gameId: unknown;
            ships: unknown;
            indexPlayer: unknown;
        }>;

        if (gameId === undefined || ships === undefined || indexPlayer === undefined) {
            sendError(connectionId, 'Incomplete add_ships payload', message.id);
            return;
        }

        const parsedShips = parseShipsPayload(ships);
        if (!parsedShips) {
            sendError(connectionId, 'Invalid ships format', message.id);
            return;
        }

        const resolvedGameId = String(gameId);
        const resolvedPlayerId = String(indexPlayer);

        const game = gamesStore.getById(resolvedGameId);
        if (!game) {
            sendError(connectionId, 'Game not found', message.id);
            return;
        }

        const player = game.players.find((candidate) => candidate.playerId === resolvedPlayerId);
        if (!player || player.userId !== userId) {
            sendError(connectionId, 'Player not part of this game', message.id);
            return;
        }

        try {
            const ready = gamesStore.setPlayerShips(resolvedGameId, resolvedPlayerId, parsedShips);

            if (!ready) {
                return;
            }

            const starter = gamesStore.startGameIfReady(resolvedGameId);
            const updatedGame = gamesStore.getById(resolvedGameId);
            if (!updatedGame) {
                return;
            }

            const currentTurn = updatedGame.currentPlayerId ?? starter ?? resolvedPlayerId;

            forEachPlayerConnection(updatedGame, (targetConnectionId, targetPlayerId) => {
                const personalShips = updatedGame.shipsByPlayer.get(targetPlayerId) ?? [];
                sendPersonal(targetConnectionId, {
                    type: 'start_game',
                    data: {
                        ships: personalShips,
                        currentPlayerIndex: currentTurn,
                    },
                    id: 0,
                });
            });

            forEachPlayerConnection(updatedGame, (targetConnectionId) => {
                sendPersonal(targetConnectionId, {
                    type: 'turn',
                    data: { currentPlayer: currentTurn },
                    id: 0,
                });
            });
        } catch (error) {
            logError('Error in add_ships handler', error);
            const errorText = error instanceof Error ? error.message : 'Server error while placing ships';
            sendError(connectionId, errorText, message.id);
        }
    },
    attack: async ({ message, connectionId }) => {
        const userId = requireAuthenticatedUser(connectionId, message.id);
        if (!userId) {
            return;
        }

        if (typeof message.data !== 'object' || message.data === null) {
            sendError(connectionId, 'Invalid payload for "attack"', message.id);
            return;
        }

        const { gameId, x, y, indexPlayer } = message.data as Partial<{
            gameId: unknown;
            x: unknown;
            y: unknown;
            indexPlayer: unknown;
        }>;

        if (gameId === undefined || x === undefined || y === undefined || indexPlayer === undefined) {
            sendError(connectionId, 'Incomplete attack payload', message.id);
            return;
        }

        if (typeof x !== 'number' || typeof y !== 'number' || Number.isNaN(x) || Number.isNaN(y)) {
            sendError(connectionId, 'Invalid shot coordinates', message.id);
            return;
        }

        const resolvedGameId = String(gameId);
        const resolvedPlayerId = String(indexPlayer);

        const game = gamesStore.getById(resolvedGameId);
        if (!game) {
            sendError(connectionId, 'Game not found', message.id);
            return;
        }

        const player = game.players.find((candidate) => candidate.playerId === resolvedPlayerId);
        if (!player || player.userId !== userId) {
            sendError(connectionId, 'Player not part of this game', message.id);
            return;
        }

        try {
            const result = gamesStore.handleAttack(resolvedGameId, resolvedPlayerId, x, y);
            const updatedGame = gamesStore.getById(resolvedGameId);
            if (!updatedGame) {
                return;
            }

            const currentTurn = result.nextPlayerId;
            const winnerPlayerId = result.winner;
            const targetPosition: Cell = { x, y };

            forEachPlayerConnection(updatedGame, (targetConnectionId) => {
                sendPersonal(targetConnectionId, {
                    type: 'attack',
                    data: {
                        position: targetPosition,
                        currentPlayer: currentTurn,
                        status: result.status,
                    },
                    id: 0,
                });
            });

            if (result.status === 'killed') {
                const extraKilled = (result.killedCells ?? []).filter(
                    (cell) => cell.x !== targetPosition.x || cell.y !== targetPosition.y,
                );

                extraKilled.forEach((cell) => {
                    forEachPlayerConnection(updatedGame, (targetConnectionId) => {
                        sendPersonal(targetConnectionId, {
                            type: 'attack',
                            data: {
                                position: cell,
                                currentPlayer: currentTurn,
                                status: 'killed',
                            },
                            id: 0,
                        });
                    });
                });

                (result.surroundingMisses ?? []).forEach((cell) => {
                    forEachPlayerConnection(updatedGame, (targetConnectionId) => {
                        sendPersonal(targetConnectionId, {
                            type: 'attack',
                            data: {
                                position: cell,
                                currentPlayer: currentTurn,
                                status: 'miss',
                            },
                            id: 0,
                        });
                    });
                });
            }

            forEachPlayerConnection(updatedGame, (targetConnectionId) => {
                sendPersonal(targetConnectionId, {
                    type: 'turn',
                    data: { currentPlayer: currentTurn },
                    id: 0,
                });
            });

            if (winnerPlayerId) {
                forEachPlayerConnection(updatedGame, (targetConnectionId) => {
                    sendPersonal(targetConnectionId, {
                        type: 'finish',
                        data: { winPlayer: winnerPlayerId },
                        id: 0,
                    });
                });

                const winnerPlayer = updatedGame.players.find((entry) => entry.playerId === winnerPlayerId);
                if (winnerPlayer) {
                    userStore.incrementWins(winnerPlayer.userId);
                    broadcastWinners();
                }

                gamesStore.delete(resolvedGameId);
                updatedGame.players.forEach((entry) => {
                    roomsStore.removeUser(entry.userId);
                });
                broadcastRooms();
            }
        } catch (error) {
            logError('Error in attack handler', error);
            const errorText = error instanceof Error ? error.message : 'Server error while processing attack';
            sendError(connectionId, errorText, message.id);
        }
    },
    randomAttack: async ({ message, connectionId }) => {
        const userId = requireAuthenticatedUser(connectionId, message.id);
        if (!userId) {
            return;
        }

        if (typeof message.data !== 'object' || message.data === null) {
            sendError(connectionId, 'Invalid payload for "randomAttack"', message.id);
            return;
        }

        const { gameId, indexPlayer } = message.data as Partial<{
            gameId: unknown;
            indexPlayer: unknown;
        }>;

        if (gameId === undefined || indexPlayer === undefined) {
            sendError(connectionId, 'Incomplete randomAttack payload', message.id);
            return;
        }

        const resolvedGameId = String(gameId);
        const resolvedPlayerId = String(indexPlayer);

        try {
            const game = gamesStore.getById(resolvedGameId);
            if (!game) {
                sendError(connectionId, 'Game not found', message.id);
                return;
            }

            const player = game.players.find((candidate) => candidate.playerId === resolvedPlayerId);
            if (!player || player.userId !== userId) {
                sendError(connectionId, 'Player not part of this game', message.id);
                return;
            }

            const available = gamesStore.getAvailableTargets(resolvedGameId, resolvedPlayerId);
            if (available.length === 0) {
                sendError(connectionId, 'No available cells for random attack', message.id);
                return;
            }

            const randomIndex = Math.floor(Math.random() * available.length);
            const target = available[randomIndex];

            await commandHandlers.attack({
                message: {
                    type: 'attack',
                    data: { gameId: resolvedGameId, x: target.x, y: target.y, indexPlayer: resolvedPlayerId },
                    id: 0,
                },
                connectionId,
            });
        } catch (error) {
            logError('Error in randomAttack handler', error);
            const errorText = error instanceof Error ? error.message : 'Server error while processing randomAttack';
            sendError(connectionId, errorText, message.id);
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
