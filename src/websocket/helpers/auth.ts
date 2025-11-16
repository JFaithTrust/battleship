import { connectionStore } from '../connections.js';
import { sendError } from '../sender.js';

export const requireAuthenticatedUser = (connectionId: number, messageId: number): string | null => {
    const userId = connectionStore.getUserId(connectionId);
    if (!userId) {
        sendError(connectionId, 'Authentication required', messageId);
        return null;
    }
    return userId;
};
