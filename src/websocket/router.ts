import { userStore } from '../domain/users.js';
import { roomsStore } from '../domain/rooms.js';
import { gamesStore } from '../domain/games.js';
import type { Ship, Cell } from '../domain/games.js';
import type { Room } from '../domain/rooms.js';
import { logError, logInfo } from '../utils/logger.js';
import { broadcastAll, sendError, sendPersonal } from './sender.js';
import { connectionStore } from './connections.js';

export interface WebSocketMessage {
    type: string;
    data: unknown;
    id: number;
}

type CommandHandler = (context: { message: WebSocketMessage; connectionId: number }) => Promise<void>;

const BOT_TURN_DELAY_MS = 600;
const BOT_USER_PREFIX = 'bot-user';

interface SinglePlayerSession {
    botUserId: string;
    botPlayerId: string;
    timeout?: NodeJS.Timeout;
}

const singlePlayerGames = new Map<string, SinglePlayerSession>();

const generateBotFleet = (): Ship[] => [
    { position: { x: 0, y: 0 }, direction: true, length: 4, type: 'huge' },
    { position: { x: 2, y: 0 }, direction: true, length: 3, type: 'large' },
    { position: { x: 4, y: 0 }, direction: true, length: 3, type: 'large' },
    { position: { x: 6, y: 0 }, direction: true, length: 2, type: 'medium' },
    { position: { x: 8, y: 0 }, direction: true, length: 2, type: 'medium' },
    { position: { x: 9, y: 2 }, direction: true, length: 2, type: 'medium' },
    { position: { x: 1, y: 5 }, direction: false, length: 1, type: 'small' },
    { position: { x: 3, y: 5 }, direction: false, length: 1, type: 'small' },
    { position: { x: 5, y: 5 }, direction: false, length: 1, type: 'small' },
    { position: { x: 7, y: 5 }, direction: false, length: 1, type: 'small' },
];

const registerSinglePlayerGame = (gameId: string, session: SinglePlayerSession): void => {
    singlePlayerGames.set(gameId, session);
};

const getSinglePlayerSession = (gameId: string): SinglePlayerSession | undefined =>
    singlePlayerGames.get(gameId);

const cleanupSinglePlayerGame = (gameId: string): void => {
    const session = singlePlayerGames.get(gameId);
    if (!session) {
        return;
    }
    if (session.timeout) {
        clearTimeout(session.timeout);
    }
    singlePlayerGames.delete(gameId);
};

const scheduleBotTurn = (gameId: string, delay = BOT_TURN_DELAY_MS): void => {
    const session = singlePlayerGames.get(gameId);
    if (!session) {
        return;
    }

    if (session.timeout) {
        clearTimeout(session.timeout);
    }

    session.timeout = setTimeout(() => {
        session.timeout = undefined;
        performBotAttack(gameId);
    }, delay);
};

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

const parseCommandData = <T = unknown>(
    message: WebSocketMessage,
    connectionId: number,
    commandName: string,
): T | null => {
    let payload: unknown = message.data;

    if (typeof payload === 'string') {
        try {
            payload = JSON.parse(payload);
        } catch (error) {
            logError(`Failed to parse payload for "${commandName}"`, error);
            sendError(connectionId, `Invalid JSON in "${commandName}" payload`, message.id);
            return null;
        }
    }

    return payload as T;
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

const maybeTriggerBotTurn = (game: GameSession): void => {
    const session = getSinglePlayerSession(game.id);
    if (!session) {
        return;
    }

    if (game.currentPlayerId !== session.botPlayerId) {
        return;
    }

    scheduleBotTurn(game.id);
};

const resolveAttack = (gameId: string, attackerPlayerId: string, target: Cell): void => {
    const result = gamesStore.handleAttack(gameId, attackerPlayerId, target.x, target.y);
    const updatedGame = gamesStore.getById(gameId);
    if (!updatedGame) {
        return;
    }

    const currentTurn = result.nextPlayerId;
    const winnerPlayerId = result.winner;

    forEachPlayerConnection(updatedGame, (targetConnectionId) => {
        sendPersonal(targetConnectionId, {
            type: 'attack',
            data: {
                position: target,
                currentPlayer: currentTurn,
                status: result.status,
            },
            id: 0,
        });
    });

    if (result.status === 'killed') {
        const extraKilled = (result.killedCells ?? []).filter(
            (cell) => cell.x !== target.x || cell.y !== target.y,
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

        cleanupSinglePlayerGame(gameId);
        gamesStore.delete(gameId);
        updatedGame.players.forEach((entry) => {
            roomsStore.removeUser(entry.userId);
        });
        broadcastRooms();
        return;
    }

    maybeTriggerBotTurn(updatedGame);
};

const performBotAttack = (gameId: string): void => {
    const session = getSinglePlayerSession(gameId);
    if (!session) {
        return;
    }

    const game = gamesStore.getById(gameId);
    if (!game) {
        cleanupSinglePlayerGame(gameId);
        return;
    }

    if (game.currentPlayerId !== session.botPlayerId) {
        return;
    }

    try {
        const availableTargets = gamesStore.getAvailableTargets(gameId, session.botPlayerId);
        if (availableTargets.length === 0) {
            return;
        }

        const randomIndex = Math.floor(Math.random() * availableTargets.length);
        const target = availableTargets[randomIndex];
        resolveAttack(gameId, session.botPlayerId, target);
    } catch (error) {
        logError('Bot attack failed', error);
    }
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
    const payload = parseCommandData<Partial<{ name: unknown; password: unknown }>>(message, connectionId, 'reg');
    if (!payload) {
        return;
    }

    if (typeof payload !== 'object' || payload === null) {
        sendError(connectionId, 'Invalid payload for "reg" command', message.id);
        return;
    }

    const { name, password } = payload;

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
    const payload = parseCommandData<Partial<{ indexRoom: unknown }>>(message, connectionId, 'add_user_to_room');
    if (!payload) {
        return;
    }

    if (typeof payload !== 'object' || payload === null) {
        sendError(connectionId, 'Invalid payload for "add_user_to_room" command', message.id);
        return;
    }

    const { indexRoom } = payload;

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

const handleSinglePlay: CommandHandler = async ({ message, connectionId }) => {
    const userId = requireAuthenticatedUser(connectionId, message.id);
    if (!userId) {
        return;
    }

    const existingGame = gamesStore.findGameByUserId(userId);
    if (existingGame) {
        sendError(connectionId, 'Finish current game before starting a new one', message.id);
        return;
    }

    roomsStore.removeUser(userId);
    broadcastRooms();

    const timestamp = Date.now();
    const botUserId = `${BOT_USER_PREFIX}-${timestamp}`;
    const pseudoRoom: Room = {
        id: `single-${timestamp}`,
        users: [userId, botUserId],
        status: 'in-game',
        createdAt: timestamp,
        updatedAt: timestamp,
    };

    const game = gamesStore.createFromRoom(pseudoRoom);
    const humanPlayer = game.players.find((player) => player.userId === userId);
    const botPlayer = game.players.find((player) => player.userId === botUserId);

    if (!humanPlayer || !botPlayer) {
        logError('Failed to initialise single player game');
        gamesStore.delete(game.id);
        sendError(connectionId, 'Unable to start single player game', message.id);
        return;
    }

    registerSinglePlayerGame(game.id, {
        botUserId,
        botPlayerId: botPlayer.playerId,
    });

    try {
        gamesStore.setPlayerShips(game.id, botPlayer.playerId, generateBotFleet());
    } catch (error) {
        logError('Failed to place bot ships', error);
        cleanupSinglePlayerGame(game.id);
        gamesStore.delete(game.id);
        sendError(connectionId, 'Unable to start single player game', message.id);
        return;
    }

    sendPersonal(connectionId, {
        type: 'create_game',
        data: {
            idGame: game.id,
            idPlayer: humanPlayer.playerId,
        },
        id: 0,
    });
};

const commandHandlers: Record<string, CommandHandler> = {
    reg: handleReg,
    create_room: handleCreateRoom,
    add_user_to_room: handleAddUserToRoom,
    single_play: handleSinglePlay,
    add_ships: async ({ message, connectionId }) => {
        const userId = requireAuthenticatedUser(connectionId, message.id);
        if (!userId) {
            return;
        }

        const payload = parseCommandData<
            Partial<{
                gameId: unknown;
                ships: unknown;
                indexPlayer: unknown;
            }>
        >(message, connectionId, 'add_ships');
        if (!payload) {
            return;
        }

        if (typeof payload !== 'object' || payload === null) {
            sendError(connectionId, 'Invalid payload for "add_ships"', message.id);
            return;
        }

        const { gameId, ships, indexPlayer } = payload;

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

            maybeTriggerBotTurn(updatedGame);
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

        const payload = parseCommandData<
            Partial<{
                gameId: unknown;
                x: unknown;
                y: unknown;
                indexPlayer: unknown;
            }>
        >(message, connectionId, 'attack');
        if (!payload) {
            return;
        }

        if (typeof payload !== 'object' || payload === null) {
            sendError(connectionId, 'Invalid payload for "attack"', message.id);
            return;
        }

        const { gameId, x, y, indexPlayer } = payload;

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
            resolveAttack(resolvedGameId, resolvedPlayerId, { x, y });
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

        const payload = parseCommandData<Partial<{ gameId: unknown; indexPlayer: unknown }>>(message, connectionId, 'randomAttack');
        if (!payload) {
            return;
        }

        if (typeof payload !== 'object' || payload === null) {
            sendError(connectionId, 'Invalid payload for "randomAttack"', message.id);
            return;
        }

        const { gameId, indexPlayer } = payload;

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

            resolveAttack(resolvedGameId, resolvedPlayerId, target);
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
