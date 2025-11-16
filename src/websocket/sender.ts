import WebSocket from 'ws';
import { logCommand, logError } from '../utils/logger.js';
import { connectionStore } from './connections.js';

type BroadcastOptions = {
    exclude?: number[];
};

const trySend = (socket: WebSocket, payload: unknown, connectionId?: number): void => {
    if (socket.readyState !== WebSocket.OPEN) {
        const target = connectionId ? `connection#${connectionId}` : 'recipient';
        logError(`Cannot send message, socket not open (${target})`);
        return;
    }

    try {
        const serialized = JSON.stringify(payload);
        socket.send(serialized);
        logCommand({ direction: 'OUT', connectionId, payload });
    } catch (error) {
        const target = connectionId ? `connection#${connectionId}` : 'recipient';
        logError(`Failed to send message to ${target}`, error);
    }
};

export const sendPersonal = (connectionId: number, payload: unknown): void => {
    const connection = connectionStore.get(connectionId);
    if (!connection) {
        logError(`Attempted to send message to unknown connection#${connectionId}`);
        return;
    }

    trySend(connection.socket, payload, connectionId);
};

export const broadcastAll = (payload: unknown, options: BroadcastOptions = {}): void => {
    const exclusion = new Set(options.exclude ?? []);
    connectionStore.list().forEach((connection) => {
        if (exclusion.has(connection.id)) {
            return;
        }
        trySend(connection.socket, payload, connection.id);
    });
};

export const sendError = (connectionId: number, message: string, id = 0): void => {
    sendPersonal(connectionId, {
        type: 'error',
        data: { message },
        id,
    });
};
