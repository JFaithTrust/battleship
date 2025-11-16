import type { IncomingMessage } from 'node:http';
import type WebSocket from 'ws';
import { logInfo } from '../utils/logger.js';

export interface ConnectionEntry {
    id: number;
    socket: WebSocket;
    request: IncomingMessage;
    createdAt: number;
}

const clients = new Map<number, ConnectionEntry>();
let connectionSequence = 0;

export const connectionStore = {
    register(socket: WebSocket, request: IncomingMessage): ConnectionEntry {
        connectionSequence += 1;
        const id = connectionSequence;
        const entry: ConnectionEntry = {
            id,
            socket,
            request,
            createdAt: Date.now(),
        };

        clients.set(id, entry);

        const remote = request.socket?.remoteAddress ?? 'unknown address';
        logInfo(`WebSocket client connected: connection#${id} from ${remote}`);

        return entry;
    },

    unregister(id: number): void {
        if (clients.has(id)) {
            clients.delete(id);
            logInfo(`WebSocket client disconnected: connection#${id}`);
        }
    },

    get(id: number): ConnectionEntry | undefined {
        return clients.get(id);
    },

    list(): ConnectionEntry[] {
        return Array.from(clients.values());
    },
};
