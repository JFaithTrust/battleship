import type { Room } from './rooms.js';

interface GamePlayer {
    userId: string;
    playerId: string;
}

export type Cell = { x: number; y: number };

export interface Ship {
    position: Cell;
    direction: boolean; /* true - horizontal? frontend uses boolean; keep as-is */
    length: number;
    type: string;
}

interface GameState {
    id: string;
    roomId: string;
    players: GamePlayer[];
    shipsByPlayer: Map<string, Ship[]>; /* key: playerId */
    hitsByPlayer: Map<string, Set<string>>; /* keys as "x:y" */
    currentPlayerId?: string;
    winnerPlayerId?: string;
    createdAt: number;
    updatedAt: number;
}

let gameSequence = 0;
const gamesById = new Map<string, GameState>();
const playerIdToGameId = new Map<string, string>();

const generateGameId = (): string => {
    gameSequence += 1;
    return `game-${gameSequence}`;
};

const keyOf = (c: Cell) => `${c.x}:${c.y}`;

const enumerateShipCells = (ship: Ship): Cell[] => {
    const cells: Cell[] = [];
    for (let i = 0; i < ship.length; i += 1) {
        const x = ship.position.x + (ship.direction ? i : 0);
        const y = ship.position.y + (ship.direction ? 0 : i);
        cells.push({ x, y });
    }
    return cells;
};

const surroundingCells = (cell: Cell): Cell[] => {
    const res: Cell[] = [];
    for (let dx = -1; dx <= 1; dx += 1) {
        for (let dy = -1; dy <= 1; dy += 1) {
            res.push({ x: cell.x + dx, y: cell.y + dy });
        }
    }
    return res;
};

const touchGame = (game: GameState): void => {
    game.updatedAt = Date.now();
};

export const gamesStore = {
    createFromRoom(room: Room): GameState {
        const id = generateGameId();
        const players: GamePlayer[] = room.users.map((userId, index) => ({
            userId,
            playerId: `${id}-player-${index + 1}`,
        }));

        const session: GameState = {
            id,
            roomId: room.id,
            players,
            shipsByPlayer: new Map(),
            hitsByPlayer: new Map(),
            createdAt: Date.now(),
            updatedAt: Date.now(),
        };

        gamesById.set(id, session);
        players.forEach((player) => {
            playerIdToGameId.set(player.playerId, id);
            session.hitsByPlayer.set(player.playerId, new Set());
        });

        return session;
    },

    getById(gameId: string): GameState | undefined {
        return gamesById.get(gameId);
    },

    getPlayer(gameId: string, userId: string): GamePlayer | undefined {
        const game = gamesById.get(gameId);
        if (!game) {
            return undefined;
        }
        return game.players.find((player) => player.userId === userId);
    },

    findGameByUserId(userId: string): GameState | undefined {
        for (const game of gamesById.values()) {
            if (game.players.some((player) => player.userId === userId)) {
                return game;
            }
        }
        return undefined;
    },

    findByPlayerId(playerId: string): GameState | undefined {
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

    setPlayerShips(gameId: string, playerId: string, ships: Ship[]): boolean {
        const game = gamesById.get(gameId);
        if (!game) {
            throw new Error('Game not found');
        }
        game.shipsByPlayer.set(playerId, ships);
        touchGame(game);

        // return true if all players have placed ships
        return game.players.every((p) => game.shipsByPlayer.has(p.playerId));
    },

    startGameIfReady(gameId: string): string | null {
        const game = gamesById.get(gameId);
        if (!game) {
            return null;
        }

        if (!game.players.every((p) => game.shipsByPlayer.has(p.playerId))) {
            return null;
        }

        // choose random starting player
        const starter = game.players[Math.floor(Math.random() * game.players.length)].playerId;
        game.currentPlayerId = starter;
        touchGame(game);
        return starter;
    },

    handleAttack(gameId: string, attackerPlayerId: string, x: number, y: number): {
        status: 'miss' | 'shot' | 'killed';
        killedCells?: Cell[];
        surroundingMisses?: Cell[];
        nextPlayerId?: string;
        winner?: string | null;
    } {
        const game = gamesById.get(gameId);
        if (!game) {
            throw new Error('Game not found');
        }

        if (!game.currentPlayerId) {
            throw new Error('Game not started');
        }

        if (game.currentPlayerId !== attackerPlayerId) {
            throw new Error('Not your turn');
        }

        const opponent = game.players.find((p) => p.playerId !== attackerPlayerId);
        if (!opponent) {
            throw new Error('Opponent not found');
        }

        const opponentShips = game.shipsByPlayer.get(opponent.playerId) ?? [];
        const key = `${x}:${y}`;

        // already hit? ignore as miss
        const attackerHits = game.hitsByPlayer.get(attackerPlayerId)!;
        if (attackerHits.has(key)) {
            // treat as miss
            // switch turn
            const next = opponent.playerId;
            game.currentPlayerId = next;
            touchGame(game);
            return { status: 'miss', nextPlayerId: next, winner: null };
        }

        // check each ship
        for (const ship of opponentShips) {
            const cells = enumerateShipCells(ship);
            const cellKeys = cells.map(keyOf);
            if (cellKeys.includes(key)) {
                // hit
                // record hit for attacker
                attackerHits.add(key);

                // check if ship killed
                const allHit = cellKeys.every((ck) => attackerHits.has(ck));
                if (allHit) {
                    // mark killed cells and surrounding misses
                    const killedCells = cells;
                    const surroundingSet = new Set<string>();
                    for (const c of cells) {
                        for (const s of surroundingCells(c)) {
                            surroundingSet.add(keyOf(s));
                        }
                    }

                    const surroundingMisses: Cell[] = Array.from(surroundingSet)
                        .map((k) => {
                            const [sx, sy] = k.split(':').map(Number);
                            return { x: sx, y: sy };
                        })
                        .filter((c) => !cellKeys.includes(keyOf(c)));

                    // check victory: all opponent ship cells are in attackerHits
                    const opponentAllCells = opponentShips.flatMap((s) => enumerateShipCells(s)).map(keyOf);
                    const allOpponentKilled = opponentAllCells.every((ck) => attackerHits.has(ck));

                    if (allOpponentKilled) {
                        game.winnerPlayerId = attackerPlayerId;
                        touchGame(game);
                        return {
                            status: 'killed',
                            killedCells,
                            surroundingMisses,
                            nextPlayerId: attackerPlayerId,
                            winner: attackerPlayerId,
                        };
                    }

                    // attacker continues turn
                    touchGame(game);
                    return { status: 'killed', killedCells, surroundingMisses, nextPlayerId: attackerPlayerId, winner: null };
                }

                // simple shot
                touchGame(game);
                return { status: 'shot', nextPlayerId: attackerPlayerId, winner: null };
            }
        }

        // miss: switch turn
        const next = opponent.playerId;
        game.currentPlayerId = next;
        touchGame(game);
        return { status: 'miss', nextPlayerId: next, winner: null };
    },
};
