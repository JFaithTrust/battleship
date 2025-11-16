type RoomStatus = 'open' | 'in-game';

export interface Room {
    id: string;
    users: string[];
    status: RoomStatus;
    createdAt: number;
    updatedAt: number;
    gameId?: string;
}

let roomSequence = 0;
const roomsById = new Map<string, Room>();

const generateRoomId = (): string => {
    roomSequence += 1;
    return `room-${roomSequence}`;
};

const touchRoom = (room: Room): void => {
    room.updatedAt = Date.now();
};

const removeUserFromRoom = (room: Room, userId: string): void => {
    const index = room.users.indexOf(userId);
    if (index === -1) {
        return;
    }
    room.users.splice(index, 1);
    touchRoom(room);
};

export const roomsStore = {
    createRoomForUser(userId: string): Room {
        this.removeUser(userId);

        const room: Room = {
            id: generateRoomId(),
            users: [userId],
            status: 'open',
            createdAt: Date.now(),
            updatedAt: Date.now(),
        };

        roomsById.set(room.id, room);
        return room;
    },

    addUserToRoom(roomId: string, userId: string): Room | null {
        const room = roomsById.get(roomId);
        if (!room) {
            return null;
        }

        if (room.status !== 'open') {
            return null;
        }

        if (room.users.includes(userId)) {
            return null;
        }

        if (room.users.length >= 2) {
            return null;
        }

        this.removeUser(userId);

        room.users.push(userId);
        room.status = 'in-game';
        touchRoom(room);
        return room;
    },

    attachGame(roomId: string, gameId: string): void {
        const room = roomsById.get(roomId);
        if (!room) {
            return;
        }
        room.gameId = gameId;
        touchRoom(room);
    },

    listOpenRooms(): Room[] {
        return Array.from(roomsById.values()).filter((room) => room.status === 'open');
    },

    getById(roomId: string): Room | undefined {
        return roomsById.get(roomId);
    },

    removeUser(userId: string): void {
        Array.from(roomsById.values()).forEach((room) => {
            if (!room.users.includes(userId)) {
                return;
            }

            removeUserFromRoom(room, userId);

            if (room.users.length === 0) {
                roomsById.delete(room.id);
                return;
            }

            if (room.users.length === 1 && room.status === 'in-game') {
                room.status = 'open';
            }
        });
    },
};
