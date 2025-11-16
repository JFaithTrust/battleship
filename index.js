import { httpServer } from './src/http_server/index.js';
import { logError, logInfo } from './src/utils/logger.js';
import { startWebSocketServer, stopWebSocketServer } from './src/websocket/server.js';

const HTTP_PORT = Number(process.env.HTTP_PORT) || 8181;

httpServer.listen(HTTP_PORT, () => {
	logInfo(`Static HTTP server listening on http://localhost:${HTTP_PORT}`);
});

const wsServer = startWebSocketServer();

const gracefulShutdown = () => {
	logInfo('Shutting down servers');
	stopWebSocketServer(wsServer);
	httpServer.close((error) => {
		if (error) {
			logError('Error while closing HTTP server', error);
			process.exit(1);
		}
		process.exit(0);
	});
};

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);
