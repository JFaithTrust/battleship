import { gamesStore } from '../../domain/games.js';
import { logError } from '../../utils/logger.js';
import { sendPersonal, sendError } from '../sender.js';
import { parseCommandData, parseShipsPayload } from '../helpers/parsers.js';
import { requireAuthenticatedUser } from '../helpers/auth.js';
import { forEachPlayerConnection } from '../helpers/broadcast.js';
import { maybeTriggerBotTurn, resolveAttack } from '../helpers/gameFlow.js';
import type { CommandHandler } from '../types.js';

export const handleAddShips: CommandHandler = async ({ message, connectionId }) => {
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
};

export const handleAttack: CommandHandler = async ({ message, connectionId }) => {
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
};

export const handleRandomAttack: CommandHandler = async ({ message, connectionId }) => {
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
};
