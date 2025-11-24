import { roomsStore } from '../../domain/rooms.js';
import { userStore } from '../../domain/users.js';
import { gamesStore } from '../../domain/games.js';
import type { Cell, Ship } from '../../domain/games.js';
import { logError } from '../../utils/logger.js';
import { broadcastRooms, broadcastWinners, forEachPlayerConnection } from './broadcast.js';
import type { GameSession } from './gameTypes.js';
import { sendPersonal } from '../sender.js';

const BOT_TURN_DELAY_MS = 600;
const BOT_USER_PREFIX = 'bot-user';

interface SinglePlayerSession {
    botUserId: string;
    botPlayerId: string;
    timeout?: NodeJS.Timeout;
}

const singlePlayerGames = new Map<string, SinglePlayerSession>();

export const generateBotFleet = (): Ship[] => [
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

export const createBotUserId = () => `${BOT_USER_PREFIX}-${Date.now()}`;

export const registerSinglePlayerGame = (gameId: string, session: SinglePlayerSession): void => {
    singlePlayerGames.set(gameId, session);
};

export const getSinglePlayerSession = (gameId: string): SinglePlayerSession | undefined =>
    singlePlayerGames.get(gameId);

export const cleanupSinglePlayerGame = (gameId: string): void => {
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

export const maybeTriggerBotTurn = (game: GameSession): void => {
    const session = singlePlayerGames.get(game.id);
    if (!session) {
        return;
    }

    if (game.currentPlayerId !== session.botPlayerId) {
        return;
    }

    scheduleBotTurn(game.id);
};

export const resolveAttack = (gameId: string, attackerPlayerId: string, target: Cell): void => {
    const result = gamesStore.handleAttack(gameId, attackerPlayerId, target.x, target.y);
    const updatedGame = gamesStore.getById(gameId);
    if (!updatedGame) {
        return;
    }

    const currentTurn = result.nextPlayerId;
    const winnerPlayerId = result.winner;

    forEachPlayerConnection(updatedGame, (targetConnectionId) => {
        sendAttack(targetConnectionId, target, currentTurn, result.status);
    });

    if (result.status === 'killed') {
        const extraKilled = (result.killedCells ?? []).filter(
            (cell) => cell.x !== target.x || cell.y !== target.y,
        );

        extraKilled.forEach((cell) => {
            forEachPlayerConnection(updatedGame, (targetConnectionId) => {
                sendAttack(targetConnectionId, cell, currentTurn, 'killed');
            });
        });

        (result.surroundingMisses ?? []).forEach((cell) => {
            forEachPlayerConnection(updatedGame, (targetConnectionId) => {
                sendAttack(targetConnectionId, cell, currentTurn, 'miss');
            });
        });
    }

    forEachPlayerConnection(updatedGame, (targetConnectionId) => {
        sendTurn(targetConnectionId, currentTurn);
    });

    if (winnerPlayerId) {
        finalizeVictory(updatedGame, winnerPlayerId);
        return;
    }

    maybeTriggerBotTurn(updatedGame);
};

const sendAttack = (connectionId: number, position: Cell, currentPlayer: string, status: 'miss' | 'shot' | 'killed') => {
    sendPersonal(connectionId, {
        type: 'attack',
        data: {
            position,
            currentPlayer,
            status,
        },
        id: 0,
    });
};

const sendTurn = (connectionId: number, currentPlayer: string) => {
    sendPersonal(connectionId, {
        type: 'turn',
        data: { currentPlayer },
        id: 0,
    });
};

const finalizeVictory = (game: GameSession, winnerPlayerId: string): void => {
    forEachPlayerConnection(game, (targetConnectionId) => {
        sendPersonal(targetConnectionId, {
            type: 'finish',
            data: { winPlayer: winnerPlayerId },
            id: 0,
        });
    });

    const winnerPlayer = game.players.find((entry) => entry.playerId === winnerPlayerId);
    if (winnerPlayer) {
        userStore.incrementWins(winnerPlayer.userId);
        broadcastWinners();
    }

    cleanupSinglePlayerGame(game.id);
    gamesStore.delete(game.id);
    game.players.forEach((entry) => {
        roomsStore.removeUser(entry.userId);
    });
    broadcastRooms();
};

export const performBotAttack = (gameId: string): void => {
    const session = singlePlayerGames.get(gameId);
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