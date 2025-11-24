interface UserRecord {
    id: string;
    name: string;
    password: string;
    wins: number;
    createdAt: number;
    updatedAt: number;
}

interface RegistrationSuccess {
    user: UserRecord;
    created: boolean;
}

interface RegistrationError {
    error: string;
}

export type RegistrationResult = RegistrationSuccess | RegistrationError;

let userSequence = 0;
const usersById = new Map<string, UserRecord>();
const usersByName = new Map<string, UserRecord>();

const generateUserId = (): string => {
    userSequence += 1;
    return `player-${userSequence}`;
};

const normalizeName = (name: string): string => name.trim();

export const userStore = {
    registerOrLogin(rawName: string, password: string): RegistrationResult {
        const name = normalizeName(rawName);

        if (name.length === 0) {
            return { error: 'Name must not be empty' };
        }

        const existing = usersByName.get(name);

        if (!existing) {
            const newUser: UserRecord = {
                id: generateUserId(),
                name,
                password,
                wins: 0,
                createdAt: Date.now(),
                updatedAt: Date.now(),
            };

            usersById.set(newUser.id, newUser);
            usersByName.set(newUser.name, newUser);

            return { user: newUser, created: true };
        }

        if (existing.password !== password) {
            return { error: 'Wrong password' };
        }

        existing.updatedAt = Date.now();

        return { user: existing, created: false };
    },

    getById(id: string): UserRecord | undefined {
        return usersById.get(id);
    },

    getByName(name: string): UserRecord | undefined {
        return usersByName.get(normalizeName(name));
    },

    listLeaderboard(): Array<{ id: string; name: string; wins: number }> {
        return Array.from(usersById.values())
            .sort((a, b) => {
                if (b.wins !== a.wins) {
                    return b.wins - a.wins;
                }
                return a.name.localeCompare(b.name);
            })
            .map((user) => ({ id: user.id, name: user.name, wins: user.wins }));
    },

    incrementWins(userId: string): void {
        const user = usersById.get(userId);
        if (!user) {
            return;
        }
        user.wins += 1;
        user.updatedAt = Date.now();
    },
};
