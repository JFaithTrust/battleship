import { userStore } from '../../domain/users.js';
import { roomsStore } from '../../domain/rooms.js';
import { broadcastAll } from '../sender.js';
import { connectionStore } from '../connections.js';
import type { GameSession } from './gameTypes.js';

export const forEachPlayerConnection = (
    game: GameSession,
    callback: (connectionId: number, playerId: string, userId: string) => void,
): void => {
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

export const broadcastWinners = (): void => {
    const data = buildLeaderboard();
    broadcastAll({
        type: 'update_winners',
        data,
        id: 0,
    });
};

const buildRoomsState = () =>
    roomsStore
        .listOpenRooms()
        .reduce<Array<{ roomId: string; roomUsers: Array<{ name: string; index: string }> }>>(
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

export const broadcastRooms = (): void => {
    const data = buildRoomsState();
    broadcastAll({
        type: 'update_room',
        data,
        id: 0,
    });
};
