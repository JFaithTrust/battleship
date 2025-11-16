import type { Room } from './rooms.js';

interface GamePlayer {
    userId: string;
    playerId: string;
}

export interface GameSession {
    id: string;
    roomId: string;
    players: GamePlayer[];
    createdAt: number;
    updatedAt: number;
}

let gameSequence = 0;
const gamesById = new Map<string, GameSession>();
const playerIdToGameId = new Map<string, string>();

const generateGameId = (): string => {
    gameSequence += 1;
    return `game-${gameSequence}`;
};

const touchGame = (game: GameSession): void => {
    game.updatedAt = Date.now();
};

export const gamesStore = {
    createFromRoom(room: Room): GameSession {
        const id = generateGameId();
        const players: GamePlayer[] = room.users.map((userId, index) => ({
            userId,
            playerId: `${id}-player-${index + 1}`,
        }));

        const session: GameSession = {
            id,
            roomId: room.id,
            players,
            createdAt: Date.now(),
            updatedAt: Date.now(),
        };

        gamesById.set(id, session);
        players.forEach((player) => {
            playerIdToGameId.set(player.playerId, id);
        });

        return session;
    },

    getById(gameId: string): GameSession | undefined {
        return gamesById.get(gameId);
    },

    getPlayer(gameId: string, userId: string): GamePlayer | undefined {
        const game = gamesById.get(gameId);
        if (!game) {
            return undefined;
        }
        return game.players.find((player) => player.userId === userId);
    },

    findGameByUserId(userId: string): GameSession | undefined {
        for (const game of gamesById.values()) {
            if (game.players.some((player) => player.userId === userId)) {
                return game;
            }
        }
        return undefined;
    },

    findByPlayerId(playerId: string): GameSession | undefined {
        const gameId = playerIdToGameId.get(playerId);
        if (!gameId) {
            return undefined;
        }
        return gamesById.get(gameId);
    },

    delete(gameId: string): void {
        const game = gamesById.get(gameId);
        if (!game) {
            return;
        }
        gamesById.delete(gameId);
        game.players.forEach((player) => playerIdToGameId.delete(player.playerId));
    },

    touch(gameId: string): void {
        const game = gamesById.get(gameId);
        if (!game) {
            return;
        }
        touchGame(game);
    },
};
