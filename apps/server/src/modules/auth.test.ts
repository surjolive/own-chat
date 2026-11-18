import { describe, expect, it } from 'vitest';
import { createAuthService } from './auth.js';

function createTestStores() {
  const users: any[] = [];
  const sessions = new Map<string, string>();
  const db = {
    user: {
      async findFirst({ where }: any) {
        return users.find((user) => where.OR.some((entry: any) =>
          (entry.email && user.email === entry.email) || (entry.username && user.username === entry.username),
        )) ?? null;
      },
      async findUnique({ where }: any) {
        return users.find((user) =>
          (where.id && user.id === where.id) ||
          (where.email && user.email === where.email),
        ) ?? null;
      },
      async create({ data }: any) {
        const now = new Date();
        const user = { id: `user-${users.length + 1}`, role: 'USER', status: 'ACTIVE', createdAt: now, updatedAt: now, ...data };
        users.push(user);
        return user;
      },
      async update({ where, data }: any) {
        const user = users.find((candidate) => candidate.id === where.id);
        if (!user) throw new Error('User not found');
        Object.assign(user, data, { updatedAt: new Date() });
        return user;
      },
    },
  };
  const sessionStore = {
    async set(key: string, value: string) { sessions.set(key, value); },
    async get(key: string) { return sessions.get(key) ?? null; },
    async del(key: string) { sessions.delete(key); },
  };
  return { db, sessionStore, users };
}

describe('auth service', () => {
  it('registers, authenticates, and revokes an expiring JWT session', async () => {
    const { db, sessionStore } = createTestStores();
    const auth = createAuthService({
      db,
      sessions: sessionStore,
      secret: 'test-secret-that-is-at-least-32-characters',
    });

    const registered = await auth.register({
      username: 'bob',
      email: 'bob@example.com',
      password: 'StrongPass!123',
    });

    expect(registered.user.username).toBe('bob');
    expect(registered.user.status).toBe('ACTIVE');
    expect(registered.token).toBeTruthy();

    const result = await auth.login({
      usernameOrEmail: 'bob@example.com',
      password: 'StrongPass!123',
    });

    expect(result.ok).toBe(true);
    if (!result.user || !result.token) throw new Error('Expected authenticated session');
    expect(result.user.username).toBe('bob');
    expect(await auth.authenticate(result.token)).toMatchObject({ id: registered.user.id });
    await auth.logout(result.token);
    expect(await auth.authenticate(result.token)).toBeNull();
  });

  it('initializes one Super Admin and refuses to promote a conflicting account', async () => {
    const { db, sessionStore, users } = createTestStores();
    const auth = createAuthService({
      db,
      sessions: sessionStore,
      secret: 'test-secret-that-is-at-least-32-characters',
    });
    const bootstrap = {
      username: 'rootadmin',
      email: 'rootadmin@example.com',
      password: 'UniqueStrongPass!123',
    };

    const admin = await auth.initializeSuperAdmin(bootstrap);
    expect(admin.role).toBe('SUPER_ADMIN');
    expect((await auth.initializeSuperAdmin(bootstrap)).id).toBe(admin.id);
    await expect(auth.initializeSuperAdmin({ ...bootstrap, username: 'otheradmin' })).rejects.toThrow('conflicts');
    expect(users).toHaveLength(1);
  });
});
