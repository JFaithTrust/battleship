import { roomsStore } from '../../domain/rooms.js';
import { gamesStore } from '../../domain/games.js';
import { logError } from '../../utils/logger.js';
import { connectionStore } from '../connections.js';
import { sendPersonal, sendError } from '../sender.js';
import { broadcastRooms } from '../helpers/broadcast.js';
import { parseCommandData } from '../helpers/parsers.js';
import { requireAuthenticatedUser } from '../helpers/auth.js';
import type { CommandHandler } from '../types.js';

export const handleCreateRoom: CommandHandler = async ({ message, connectionId }) => {
    const userId = requireAuthenticatedUser(connectionId, message.id);
    if (!userId) {
        return;
    }

    roomsStore.createRoomForUser(userId);
    broadcastRooms();
};

export const handleAddUserToRoom: CommandHandler = async ({ message, connectionId }) => {
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
