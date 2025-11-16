import { logError } from '../../utils/logger.js';
import { sendError } from '../sender.js';
import type { Ship } from '../../domain/games.js';
import type { WebSocketMessage } from '../types.js';

export const parseShipsPayload = (value: unknown): Ship[] | null => {
    if (!Array.isArray(value)) {
        return null;
    }

    const ships: Ship[] = [];

    for (const candidate of value) {
        if (typeof candidate !== 'object' || candidate === null) {
            return null;
        }

        const { position, direction, length, type } = candidate as Partial<{
            position: unknown;
            direction: unknown;
            length: unknown;
            type: unknown;
        }>;

        if (typeof direction !== 'boolean' || typeof length !== 'number' || typeof type !== 'string') {
            return null;
        }

        if (typeof position !== 'object' || position === null) {
            return null;
        }

        const { x, y } = position as Partial<{ x: unknown; y: unknown }>;
        if (typeof x !== 'number' || typeof y !== 'number' || Number.isNaN(x) || Number.isNaN(y)) {
            return null;
        }

        ships.push({
            position: { x, y },
            direction,
            length,
            type,
        });
    }

    return ships;
};

export const parseCommandData = <T = unknown>(
    message: WebSocketMessage,
    connectionId: number,
    commandName: string,
): T | null => {
    let payload: unknown = message.data;

    if (typeof payload === 'string') {
        try {
            payload = JSON.parse(payload);
        } catch (error) {
            logError(`Failed to parse payload for "${commandName}"`, error);
            sendError(connectionId, `Invalid JSON in "${commandName}" payload`, message.id);
            return null;
        }
    }

    return payload as T;
};
