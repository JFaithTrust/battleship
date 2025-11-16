const formatTimestamp = () => new Date().toISOString();

const stringifyPayload = (payload) => {
    try {
        if (typeof payload === 'string') {
            return payload;
        }
        return JSON.stringify(payload);
    } catch (error) {
        return '[unserializable payload]';
    }
};

export const logInfo = (message) => {
    console.log(`[${formatTimestamp()}] ${message}`);
};

export const logError = (message, error) => {
    const details = error ? `: ${error.message || error}` : '';
    console.error(`[${formatTimestamp()}] ERROR ${message}${details}`);
    if (error?.stack) {
        console.error(error.stack);
    }
};

export const logCommand = ({ direction, connectionId, payload }) => {
    const formattedPayload = stringifyPayload(payload);
    const meta = connectionId ? `connection#${connectionId}` : 'broadcast';
    console.log(`[${formatTimestamp()}] WS ${direction} ${meta} ${formattedPayload}`);
};
