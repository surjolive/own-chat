import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { hash, verify } from 'argon2';

export type UserRole = 'SUPER_ADMIN' | 'USER';
export type UserStatus = 'ACTIVE' | 'SUSPENDED' | 'PENDING';

export interface User {
  id: string;
  username: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  status: UserStatus;
  tenantId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuthRegisterInput {
  username: string;
  email: string;
  password: string;
  tenantId?: string;
}

export interface AuthLoginInput {
  usernameOrEmail: string;
  password: string;
  tenantId?: string;
}

export interface AuthResult {
  ok: boolean;
  user?: User;
  token?: string;
  message?: string;
}

export interface AuthRegisterResult {
  user: User;
  token: string;
}

const registerSchema = z.object({
  username: z.string().trim().min(3).max(40).transform((value) => value.toLowerCase()),
  email: z.string().trim().email().transform((value) => value.toLowerCase()),
  password: z.string().min(12).max(128),
});

const loginSchema = z.object({
  usernameOrEmail: z.string().min(3),
  password: z.string().min(12).max(128),
  tenantId: z.string().min(3).optional(),
});

const SESSION_TTL_SECONDS = 60 * 60 * 8;
const jwtHeader = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');

async function hashPassword(password: string): Promise<string> {
  return hash(password);
}

async function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

type SessionClaims = {
  sub: string;
  jti: string;
  iat: number;
  exp: number;
};

export interface AuthDatabase {
  user: {
    findFirst(args: any): Promise<DbUserRecord | null>;
    findUnique(args: any): Promise<DbUserRecord | null>;
    create(args: any): Promise<DbUserRecord>;
    update(args: any): Promise<DbUserRecord>;
  };
}

export interface AuthSessionStore {
  set(key: string, value: string, options: { EX: number }): Promise<unknown>;
  get(key: string): Promise<string | null>;
  del(key: string): Promise<unknown>;
}

export type DbUserRecord = User;

export function createAuthService({
  db,
  sessions,
  secret,
}: {
  db: AuthDatabase;
  sessions: AuthSessionStore;
  secret: string;
}) {
  if (secret.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters long.');
  }

  function signToken(userId: string): { token: string; claims: SessionClaims } {
    const now = Math.floor(Date.now() / 1000);
    const claims: SessionClaims = {
      sub: userId,
      jti: randomUUID(),
      iat: now,
      exp: now + SESSION_TTL_SECONDS,
    };
    const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
    const content = `${jwtHeader}.${payload}`;
    const signature = createHmac('sha256', secret).update(content).digest('base64url');
    return { token: `${content}.${signature}`, claims };
  }

  function verifyToken(token: string): SessionClaims | null {
    const [header, payload, signature, extra] = token.split('.');
    if (!header || !payload || !signature || extra || header !== jwtHeader) return null;

    const content = `${header}.${payload}`;
    const expected = createHmac('sha256', secret).update(content).digest();
    let received: Buffer;
    try {
      received = Buffer.from(signature, 'base64url');
    } catch {
      return null;
    }
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null;

    try {
      const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as SessionClaims;
      if (
        typeof claims.sub !== 'string' ||
        typeof claims.jti !== 'string' ||
        typeof claims.exp !== 'number' ||
        claims.exp <= Math.floor(Date.now() / 1000)
      ) return null;
      return claims;
    } catch {
      return null;
    }
  }

  async function createSession(userId: string): Promise<string> {
    const { token, claims } = signToken(userId);
    await sessions.set(`auth:session:${claims.jti}`, userId, { EX: SESSION_TTL_SECONDS });
    return token;
  }

  async function findLoginUser(usernameOrEmail: string, tenantId?: string): Promise<DbUserRecord | null> {
    const normalized = usernameOrEmail.trim().toLowerCase();
    return db.user.findFirst({
      where: {
        OR: [{ email: normalized }, { username: normalized }],
        ...(tenantId ? { tenantId } : {}),
      },
    });
  }

  return {
    async register(input: AuthRegisterInput): Promise<AuthRegisterResult> {
      const validated = registerSchema.parse(input);
      const existing = await db.user.findFirst({
        where: { OR: [{ email: validated.email }, { username: validated.username }] },
      });

      if (existing) {
        throw new Error('User already exists');
      }

      let user: User;
      try {
        user = await db.user.create({
          data: {
            username: validated.username,
            email: validated.email,
            passwordHash: await hashPassword(validated.password),
            role: 'USER',
            status: 'ACTIVE',
            tenantId: `tenant-${randomUUID()}`,
          },
        });
      } catch (error) {
        if ((error as { code?: string }).code === 'P2002') {
          throw new Error('User already exists');
        }
        throw error;
      }
      return { user, token: await createSession(user.id) };
    },

    async login(input: AuthLoginInput): Promise<AuthResult> {
      const validated = loginSchema.parse(input);
      const user = await findLoginUser(validated.usernameOrEmail, validated.tenantId);

      if (!user) {
        return { ok: false, message: 'Invalid credentials' };
      }
      if (user.status !== 'ACTIVE') {
        return { ok: false, message: 'Account is not active' };
      }

      const valid = await verifyPassword(validated.password, user.passwordHash);
      if (!valid) {
        return { ok: false, message: 'Invalid credentials' };
      }

      return {
        ok: true,
        user,
        token: await createSession(user.id),
      };
    },

    async authenticate(token: string): Promise<User | null> {
      const claims = verifyToken(token);
      if (!claims || (await sessions.get(`auth:session:${claims.jti}`)) !== claims.sub) return null;
      const user = await db.user.findUnique({ where: { id: claims.sub } });
      return user?.status === 'ACTIVE' ? user : null;
    },

    async logout(token: string): Promise<void> {
      const claims = verifyToken(token);
      if (claims) await sessions.del(`auth:session:${claims.jti}`);
    },

    async initializeSuperAdmin(input: { username: string; email: string; password: string }): Promise<User> {
      const validated = registerSchema.parse(input);
      const existing = await db.user.findFirst({
        where: { OR: [{ email: validated.email }, { username: validated.username }] },
      });

      if (existing) {
        if (
          existing.email !== validated.email ||
          existing.username !== validated.username ||
          existing.role !== 'SUPER_ADMIN'
        ) {
          throw new Error('Super Admin bootstrap identity conflicts with an existing user.');
        }
        return existing;
      }

      return db.user.create({
        data: {
          username: validated.username,
          email: validated.email,
          passwordHash: await hashPassword(validated.password),
          role: 'SUPER_ADMIN',
          status: 'ACTIVE',
          tenantId: `tenant-${randomUUID()}`,
        },
      });
    },
  };
}

export { registerSchema, loginSchema };
