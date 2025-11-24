import { userStore } from '../../domain/users.js';
import { connectionStore } from '../connections.js';
import { sendPersonal, sendError } from '../sender.js';
import { broadcastRooms, broadcastWinners } from '../helpers/broadcast.js';
import { parseCommandData } from '../helpers/parsers.js';
import type { CommandHandler } from '../types.js';

export const handleReg: CommandHandler = async ({ message, connectionId }) => {
    const payload = parseCommandData<Partial<{ name: unknown; password: unknown }>>(message, connectionId, 'reg');
    if (!payload) {
        return;
    }

    if (typeof payload !== 'object' || payload === null) {
        sendError(connectionId, 'Invalid payload for "reg" command', message.id);
        return;
    }

    const { name, password } = payload;

    if (typeof name !== 'string' || typeof password !== 'string') {
        sendError(connectionId, 'Name and password must be provided as strings', message.id);
        return;
    }

    const result = userStore.registerOrLogin(name, password);

    if ('error' in result) {
        sendPersonal(connectionId, {
            type: 'reg',
            data: {
                name,
                index: '',
                error: true,
                errorText: result.error,
            },
            id: message.id,
        });
        return;
    }

    const { user } = result;

    connectionStore.setUser(connectionId, user.id);

    sendPersonal(connectionId, {
        type: 'reg',
        data: {
            name: user.name,
            index: user.id,
            error: false,
            errorText: '',
        },
        id: message.id,
    });

    broadcastRooms();
    broadcastWinners();
};
