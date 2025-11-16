import WebSocket from 'ws';
import { logCommand, logError } from '../utils/logger.js';
import { connectionStore } from './connections.js';

const trySend = (socket, payload, connectionId) => {
    if (socket.readyState !== WebSocket.OPEN) {
        logError(`Cannot send message, socket not open (connection#${connectionId})`);
        return;
    }
    try {
        const raw = JSON.stringify(payload);
        socket.send(raw);
        logCommand({ direction: 'OUT', connectionId, payload });
    } catch (error) {
        logError(`Failed to send message to connection#${connectionId}`, error);
    }
};

export const sendPersonal = (connectionId, payload) => {
    const connection = connectionStore.get(connectionId);
    if (!connection) {
        logError(`Attempted to send message to unknown connection#${connectionId}`);
        return;
    }
    trySend(connection.socket, payload, connectionId);
};

export const broadcastAll = (payload, { exclude = [] } = {}) => {
    const exclusion = new Set(exclude);
    connectionStore.list().forEach((connection) => {
        if (exclusion.has(connection.id)) {
            return;
        }
        trySend(connection.socket, payload, connection.id);
    });
};

export const sendError = (connectionId, message, id = 0) => {
    sendPersonal(connectionId, {
        type: 'error',
        data: { message },
        id,
    });
};
