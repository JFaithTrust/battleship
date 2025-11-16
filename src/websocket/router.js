import { logError, logInfo } from '../utils/logger.js';
import { sendError } from './sender.js';

const validateMessage = (message) => {
    if (typeof message !== 'object' || message === null) {
        return 'Payload must be an object';
    }
    if (typeof message.type !== 'string') {
        return 'Payload "type" must be a string';
    }
    if (!Object.prototype.hasOwnProperty.call(message, 'id')) {
        return 'Payload must contain "id" field';
    }
    if (message.id !== 0) {
        return 'Payload "id" must equal 0';
    }
    return null;
};

export const handleMessage = async ({ rawMessage, connectionId }) => {
    let parsed;
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
        sendError(connectionId, validationError, parsed?.id ?? 0);
        return;
    }

    logInfo(`Received command "${parsed.type}" from connection#${connectionId}`);
    // Stub implementation until specific handlers are added in later phases.
    sendError(connectionId, `Command "${parsed.type}" is not implemented yet`, parsed.id);
};
