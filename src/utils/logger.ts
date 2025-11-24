type CommandDirection = 'IN' | 'OUT';

interface CommandLogPayload {
    direction: CommandDirection;
    connectionId?: number;
    payload: unknown;
}

const formatTimestamp = () => new Date().toISOString();

const stringifyPayload = (payload: unknown): string => {
    if (typeof payload === 'string') {
        return payload;
    }

    try {
        return JSON.stringify(payload);
    } catch (error) {
        return '[unserializable payload]';
    }
};

export const logInfo = (message: string): void => {
    console.log(`[${formatTimestamp()}] ${message}`);
};

export const logError = (message: string, error?: unknown): void => {
    const details = (() => {
        if (!error) {
            return '';
        }
        if (error instanceof Error) {
            return `: ${error.message}`;
        }
        return `: ${String(error)}`;
    })();

    console.error(`[${formatTimestamp()}] ERROR ${message}${details}`);

    if (error instanceof Error && error.stack) {
        console.error(error.stack);
    }
};

export const logCommand = ({ direction, connectionId, payload }: CommandLogPayload): void => {
    const formattedPayload = stringifyPayload(payload);
    const meta = connectionId ? `connection#${connectionId}` : 'broadcast';
    console.log(`[${formatTimestamp()}] WS ${direction} ${meta} ${formattedPayload}`);
};
