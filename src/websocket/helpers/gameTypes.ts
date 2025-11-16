import type { gamesStore } from '../../domain/games.js';

export type GameSession = NonNullable<ReturnType<typeof gamesStore.getById>>;
