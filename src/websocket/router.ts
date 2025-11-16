import { logError, logInfo } from '../utils/logger.js';
import { sendError } from './sender.js';

export interface WebSocketMessage {
    type: string;
    data: unknown;
    id: number;
}

const validateMessage = (message: unknown): string | null => {
    if (typeof message !== 'object' || message === null) {
        return 'Payload must be an object';
    }

    const typedMessage = message as Partial<WebSocketMessage>;

    if (typeof typedMessage.type !== 'string') {
        return 'Payload "type" must be a string';
    }

    if (!Object.prototype.hasOwnProperty.call(typedMessage, 'id')) {
        return 'Payload must contain "id" field';
    }

    if (typedMessage.id !== 0) {
        return 'Payload "id" must equal 0';
    }

    return null;
};

export const handleMessage = async ({
    rawMessage,
    connectionId,
}: {
    rawMessage: string;
    connectionId: number;
}): Promise<void> => {
    let parsed: unknown;

    try {
        parsed = JSON.parse(rawMessage);
    } catch (error) {
        logError(`Invalid JSON received from connection#${connectionId}`, error);
        sendError(connectionId, 'Invalid JSON');
        return;
    }

    const validationError = validateMessage(parsed);
    if (validationError) {
        logInfo(`Validation failed for connection#${connectionId}: ${validationError}`);
        const responseId = typeof (parsed as Partial<WebSocketMessage>).id === 'number' ? (parsed as WebSocketMessage).id : 0;
        sendError(connectionId, validationError, responseId);
        return;
    }

    const message = parsed as WebSocketMessage;
    logInfo(`Received command "${message.type}" from connection#${connectionId}`);

    sendError(connectionId, `Command "${message.type}" is not implemented yet`, message.id);
};
