import { gamesStore } from '../../domain/games.js';
import { roomsStore } from '../../domain/rooms.js';
import type { Room } from '../../domain/rooms.js';
import { logError } from '../../utils/logger.js';
import { sendPersonal, sendError } from '../sender.js';
import { broadcastRooms } from '../helpers/broadcast.js';
import { requireAuthenticatedUser } from '../helpers/auth.js';
import { createBotUserId, generateBotFleet, registerSinglePlayerGame } from '../helpers/gameFlow.js';
import type { CommandHandler } from '../types.js';

export const handleSinglePlay: CommandHandler = async ({ message, connectionId }) => {
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
    const botUserId = createBotUserId();
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

    try {
        gamesStore.setPlayerShips(game.id, botPlayer.playerId, generateBotFleet());
    } catch (error) {
        logError('Failed to place bot ships', error);
        gamesStore.delete(game.id);
        sendError(connectionId, 'Unable to start single player game', message.id);
        return;
    }

    registerSinglePlayerGame(game.id, {
        botUserId,
        botPlayerId: botPlayer.playerId,
    });

    sendPersonal(connectionId, {
        type: 'create_game',
        data: {
            idGame: game.id,
            idPlayer: humanPlayer.playerId,
        },
        id: 0,
    });
};
