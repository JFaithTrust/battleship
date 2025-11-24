import type { IncomingMessage } from 'node:http';
import WebSocket, { WebSocketServer } from 'ws';
import { logInfo, logError, logCommand } from '../utils/logger.js';
import { connectionStore } from './connections.js';
import { handleMessage } from './router.js';

const WEBSOCKET_PORT = Number(process.env.WS_PORT) || 3000;

type ConnectionHandler = (socket: WebSocket, request: IncomingMessage) => void;

type ErrorHandler = (error: Error) => void;

export const startWebSocketServer = (): WebSocketServer => {
    const server = new WebSocketServer({ port: WEBSOCKET_PORT });

    server.on('listening', () => {
        logInfo(`WebSocket server listening on ws://localhost:${WEBSOCKET_PORT}`);
    });

    server.on('connection', ((socket, request) => {
        const { id } = connectionStore.register(socket, request);

        socket.on('message', (data) => {
            const rawMessage = data.toString();
            logCommand({ direction: 'IN', connectionId: id, payload: rawMessage });
            handleMessage({ rawMessage, connectionId: id }).catch((error) => {
                logError(`Unhandled error in router for connection#${id}`, error);
            });
        });

        socket.on('close', () => {
            connectionStore.unregister(id);
        });

        socket.on('error', ((error) => {
            logError(`Socket error on connection#${id}`, error);
        }) as ErrorHandler);
    }) as ConnectionHandler);

    server.on('error', (error) => {
        logError('WebSocket server error', error);
    });

    return server;
};

export const stopWebSocketServer = (server: WebSocketServer | undefined): void => {
    if (!server) {
        return;
    }

    server.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.close(1001, 'Server shutting down');
        }
    });

    server.close((error) => {
        if (error) {
            logError('Error while closing WebSocket server', error);
            return;
        }
        logInfo('WebSocket server stopped');
    });
};
