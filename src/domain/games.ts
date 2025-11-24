import type { Room } from './rooms.js';

const BOARD_SIZE = 10;

interface GamePlayer {
    userId: string;
    playerId: string;
}

export type Cell = { x: number; y: number };

export interface Ship {
    position: Cell;
    direction: boolean;
    length: number;
    type: string;
}

interface GameState {
    id: string;
    roomId: string;
    players: GamePlayer[];
    shipsByPlayer: Map<string, Ship[]>; /* key: playerId */
    hitsByPlayer: Map<string, Set<string>>; /* keys as "x:y" */
    shotsByPlayer: Map<string, Set<string>>;
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

const isWithinBoard = (cell: Cell): boolean =>
    cell.x >= 0 && cell.x < BOARD_SIZE && cell.y >= 0 && cell.y < BOARD_SIZE;

const enumerateShipCells = (ship: Ship): Cell[] => {
    const cells: Cell[] = [];
    for (let i = 0; i < ship.length; i += 1) {
        const x = ship.position.x + (ship.direction ? 0 : i);
        const y = ship.position.y + (ship.direction ? i : 0);
        cells.push({ x, y });
    }
    return cells;
};

const surroundingCells = (cell: Cell): Cell[] => {
    const res: Cell[] = [];
    for (let dx = -1; dx <= 1; dx += 1) {
        for (let dy = -1; dy <= 1; dy += 1) {
            const neighbour = { x: cell.x + dx, y: cell.y + dy };
            if (isWithinBoard(neighbour)) {
                res.push(neighbour);
            }
        }
    }
    return res;
};

const validateShips = (ships: Ship[]): string | null => {
    const occupied = new Set<string>();

    for (const ship of ships) {
        if (typeof ship.length !== 'number' || Number.isNaN(ship.length) || ship.length <= 0) {
            return 'Ship length must be a positive number';
        }

        const cells = enumerateShipCells(ship);

        for (const cell of cells) {
            if (!isWithinBoard(cell)) {
                return 'Ship position is out of board bounds';
            }

            const key = keyOf(cell);
            if (occupied.has(key)) {
                return 'Ships cannot overlap';
            }

            occupied.add(key);
        }
    }

    return null;
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
            shotsByPlayer: new Map(),
            createdAt: Date.now(),
            updatedAt: Date.now(),
        };

        gamesById.set(id, session);
        players.forEach((player) => {
            playerIdToGameId.set(player.playerId, id);
            session.hitsByPlayer.set(player.playerId, new Set());
            session.shotsByPlayer.set(player.playerId, new Set());
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

        if (game.currentPlayerId) {
            throw new Error('Game already started');
        }

        const clonedShips: Ship[] = ships.map((ship) => ({
            position: { x: ship.position.x, y: ship.position.y },
            direction: Boolean(ship.direction),
            length: ship.length,
            type: ship.type,
        }));

        const error = validateShips(clonedShips);
        if (error) {
            throw new Error(error);
        }

        game.shipsByPlayer.set(playerId, clonedShips);
        game.hitsByPlayer.set(playerId, new Set());
        game.shotsByPlayer.set(playerId, new Set());
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

    getAvailableTargets(gameId: string, playerId: string): Cell[] {
        const game = gamesById.get(gameId);
        if (!game) {
            throw new Error('Game not found');
        }

        const shots = game.shotsByPlayer.get(playerId);
        if (!shots) {
            throw new Error('Player not found in game');
        }

        const available: Cell[] = [];
        for (let cx = 0; cx < BOARD_SIZE; cx += 1) {
            for (let cy = 0; cy < BOARD_SIZE; cy += 1) {
                const cell = { x: cx, y: cy };
                if (!shots.has(keyOf(cell))) {
                    available.push(cell);
                }
            }
        }

        return available;
    },

    handleAttack(gameId: string, attackerPlayerId: string, x: number, y: number): {
        status: 'miss' | 'shot' | 'killed';
        killedCells?: Cell[];
        surroundingMisses?: Cell[];
        nextPlayerId: string;
        winner: string | null;
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

        const target: Cell = { x, y };
        if (!isWithinBoard(target)) {
            throw new Error('Shot is out of board bounds');
        }

        const key = keyOf(target);
        const shots = game.shotsByPlayer.get(attackerPlayerId);
        if (!shots) {
            throw new Error('Internal state corrupted');
        }

        if (shots.has(key)) {
            const next = opponent.playerId;
            game.currentPlayerId = next;
            touchGame(game);
            return { status: 'miss', nextPlayerId: next, winner: game.winnerPlayerId ?? null };
        }
        shots.add(key);

        const opponentShips = game.shipsByPlayer.get(opponent.playerId) ?? [];
        const attackerHits = game.hitsByPlayer.get(attackerPlayerId);
        if (!attackerHits) {
            throw new Error('Internal state corrupted');
        }

        let hitShip: Ship | null = null;
        let hitShipCells: Cell[] = [];
        let hitShipKeys: string[] = [];

        for (const ship of opponentShips) {
            const cells = enumerateShipCells(ship);
            const cellKeys = cells.map(keyOf);
            if (cellKeys.includes(key)) {
                hitShip = ship;
                hitShipCells = cells;
                hitShipKeys = cellKeys;
                break;
            }
        }

        if (!hitShip) {
            const next = opponent.playerId;
            game.currentPlayerId = next;
            touchGame(game);
            return { status: 'miss', nextPlayerId: next, winner: game.winnerPlayerId ?? null };
        }

        attackerHits.add(key);

        const allHit = hitShipKeys.every((cellKey) => attackerHits.has(cellKey));
        if (!allHit) {
            game.currentPlayerId = attackerPlayerId;
            touchGame(game);
            return { status: 'shot', nextPlayerId: attackerPlayerId, winner: game.winnerPlayerId ?? null };
        }

        const killedCells = hitShipCells;
        killedCells.forEach((cell) => {
            shots.add(keyOf(cell));
        });

        const surroundingSet = new Set<string>();
        for (const cell of killedCells) {
            for (const neighbour of surroundingCells(cell)) {
                const neighbourKey = keyOf(neighbour);
                if (!hitShipKeys.includes(neighbourKey)) {
                    surroundingSet.add(neighbourKey);
                }
            }
        }

        const surroundingMisses: Cell[] = Array.from(surroundingSet).map((value) => {
            const [sx, sy] = value.split(':').map(Number);
            return { x: sx, y: sy };
        });
        surroundingMisses.forEach((cell) => shots.add(keyOf(cell)));

        const opponentAllCells = opponentShips.flatMap((ship) => enumerateShipCells(ship)).map(keyOf);
        const allOpponentKilled = opponentAllCells.every((cellKey) => attackerHits.has(cellKey));

        if (allOpponentKilled) {
            game.winnerPlayerId = attackerPlayerId;
        }

        game.currentPlayerId = attackerPlayerId;
        touchGame(game);

        return {
            status: 'killed',
            killedCells,
            surroundingMisses,
            nextPlayerId: game.currentPlayerId,
            winner: game.winnerPlayerId ?? null,
        };
    },
};
