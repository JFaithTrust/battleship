import { httpServer } from './http_server/index.js';
import { logError, logInfo } from './utils/logger.js';
import { startWebSocketServer, stopWebSocketServer } from './websocket/server.js';

const HTTP_PORT = Number(process.env.HTTP_PORT) || 8181;

httpServer.listen(HTTP_PORT, () => {
    logInfo(`Static HTTP server listening on http://localhost:${HTTP_PORT}`);
});

httpServer.on('error', (error: Error) => {
    logError('HTTP server error', error);
});

const wsServer = startWebSocketServer();

let shuttingDown = false;

const gracefulShutdown = () => {
    if (shuttingDown) {
        return;
    }
    shuttingDown = true;

    logInfo('Shutting down servers');
    stopWebSocketServer(wsServer);

    httpServer.close(() => {
        process.exit(0);
    });
};

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);
