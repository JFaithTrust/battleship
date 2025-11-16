import { logInfo } from '../utils/logger.js';

const clients = new Map();
let connectionSequence = 0;

export const connectionStore = {
    register(socket, request) {
        connectionSequence += 1;
        const id = connectionSequence;
        const entry = {
            id,
            socket,
            request,
            createdAt: Date.now(),
        };
        clients.set(id, entry);
        const remote = request?.socket?.remoteAddress || 'unknown address';
        logInfo(`WebSocket client connected: connection#${id} from ${remote}`);
        return entry;
    },
    unregister(id) {
        if (clients.has(id)) {
            clients.delete(id);
            logInfo(`WebSocket client disconnected: connection#${id}`);
        }
    },
    get(id) {
        return clients.get(id);
    },
    list() {
        return Array.from(clients.values());
    },
};
