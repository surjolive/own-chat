import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { PrismaClient } from '@prisma/client';
import { createClient } from 'redis';
import { z } from 'zod';
import { BaileysAdapter, type IncomingWhatsAppMessage } from '@surjo/whatsapp-engine';
import { decryptValue, encryptValue } from '@surjo/security';
import { createAuthService } from './modules/auth.js';
import { createOmniRouteService } from './modules/omniroute.js';
import { env } from './config/env.js';

const app = Fastify({
  logger: {
    level: 'info',
    transport: env.NODE_ENV === 'development'
      ? {
          target: 'pino-pretty',
          options: { colorize: true },
        }
      : undefined,
  },
});

const prisma = new PrismaClient();
const redis = createClient({ url: env.REDIS_URL });
redis.on('error', (error) => app.log.error(error, 'Redis client error'));
const authService = createAuthService({ db: prisma, sessions: redis, secret: env.JWT_SECRET });
const omnirouteService = createOmniRouteService();
const whatsappAdapter = new BaileysAdapter();

async function loadOmniRouteSettings(userId: string) {
  const saved = await prisma.aIProviderConfig.findFirst({
    where: { userId, provider: 'OMNIROUTE' },
    orderBy: { updatedAt: 'desc' },
  });
  if (!saved) return omnirouteService.getSettings(userId);

  const apiKey = saved.encryptedApiKey
    ? decryptValue(saved.encryptedApiKey, env.SESSION_ENCRYPTION_KEY)
    : undefined;
  return omnirouteService.saveSettings(userId, {
    baseUrl: saved.baseUrl ?? 'http://127.0.0.1:20128',
    apiKey,
    defaultModel: saved.defaultModel ?? undefined,
    enabled: saved.enabled,
  });
}

async function hydrateWhatsAppAccount(userId: string, account: Record<string, any>) {
  const sessionKey = `${userId}:${account.id}`;
  const session = await whatsappAdapter.status(sessionKey);
  const connectionStatus = session?.status ?? account.connectionStatus ?? 'DISCONNECTED';
  await prisma.whatsAppAccount.update({
    where: { id: account.id },
    data: { connectionStatus },
  }).catch(() => undefined);

  return {
    ...account,
    connectionStatus,
    qrCode: session?.qr ?? account.qrCode ?? undefined,
  };
}

async function recordActivity(actorId: string, event: string, resourceType: string, resourceId?: string) {
  await prisma.auditLog.create({
    data: { actorId, event, resourceType, resourceId },
  }).catch(() => undefined);
}

async function sendAndStoreMessage(userId: string, accountId: string, to: string, content: string, chatId?: string) {
  const result = await whatsappAdapter.sendMessage(`${userId}:${accountId}`, to, content);
  const conversationChatId = chatId ?? to;
  let conversation = await prisma.conversation.findFirst({
    where: { userId, accountId, chatId: conversationChatId },
  });
  if (!conversation) {
    conversation = await prisma.conversation.create({
      data: { userId, accountId, chatId: conversationChatId, title: to },
    });
  }
  await prisma.message.create({
    data: {
      userId,
      conversationId: conversation.id,
      senderType: 'USER',
      content,
      messageType: 'TEXT',
      deliveryStatus: 'SENT',
    },
  });
  await prisma.conversation.update({ where: { id: conversation.id }, data: { updatedAt: new Date() } });
  await recordActivity(userId, 'whatsapp.message.sent', 'conversation', conversation.id);
  return result;
}

async function processIncomingWhatsAppMessage(incoming: IncomingWhatsAppMessage): Promise<void> {
  const separator = incoming.ownerId.indexOf(':');
  if (separator < 1) return;

  const userId = incoming.ownerId.slice(0, separator);
  const accountId = incoming.ownerId.slice(separator + 1);
  const account = await prisma.whatsAppAccount.findFirst({ where: { id: accountId, userId } });
  if (!account) return;

  let conversation = await prisma.conversation.findFirst({
    where: { userId, accountId, chatId: incoming.chatId },
  });
  if (!conversation) {
    conversation = await prisma.conversation.create({
      data: {
        userId,
        accountId,
        chatId: incoming.chatId,
        title: incoming.displayName ?? incoming.from,
      },
    });
  }

  const duplicate = await prisma.message.findFirst({
    where: { conversationId: conversation.id, externalMessageId: incoming.messageId },
  });
  if (duplicate) return;

  await prisma.message.create({
    data: {
      userId,
      conversationId: conversation.id,
      externalMessageId: incoming.messageId,
      senderType: 'CONTACT',
      content: incoming.content,
      messageType: 'TEXT',
      deliveryStatus: 'DELIVERED',
    },
  });
  await prisma.conversation.update({ where: { id: conversation.id }, data: { updatedAt: new Date() } });
  await recordActivity(userId, 'whatsapp.message.received', 'conversation', conversation.id);

  const [botSettings, contactPolicy] = await Promise.all([
    prisma.botSetting.findFirst({ where: { userId, accountId: null }, orderBy: { updatedAt: 'desc' } }),
    prisma.contactPolicy.findFirst({ where: { userId, contactId: incoming.from } }),
  ]);
  if (!botSettings?.autoReplyEnabled) return;
  if (contactPolicy && (contactPolicy.blocked || !contactPolicy.optedIn || !contactPolicy.autoReplyEnabled)) return;

  const providerSettings = await loadOmniRouteSettings(userId);
  if (!providerSettings.enabled || !providerSettings.defaultModel) {
    await recordActivity(userId, 'whatsapp.auto_reply.skipped', 'conversation', conversation.id);
    return;
  }

  const prompt = [
    botSettings.systemPrompt ? `System instructions:\n${botSettings.systemPrompt}` : '',
    botSettings.personality ? `Personality: ${botSettings.personality}` : '',
    botSettings.language ? `Reply in language: ${botSettings.language}` : '',
    'Write a concise WhatsApp reply to the incoming message. Return only the reply text.',
    `Incoming message: ${incoming.content}`,
  ].filter(Boolean).join('\n\n');
  const response = await omnirouteService.generateResponse(userId, prompt, providerSettings);
  await whatsappAdapter.sendMessage(incoming.ownerId, incoming.chatId, response);
  await prisma.message.create({
    data: {
      userId,
      conversationId: conversation.id,
      senderType: 'BOT',
      content: response,
      messageType: 'TEXT',
      deliveryStatus: 'SENT',
    },
  });
  await prisma.conversation.update({ where: { id: conversation.id }, data: { updatedAt: new Date() } });
  await recordActivity(userId, 'whatsapp.auto_reply.sent', 'conversation', conversation.id);
}

async function restoreWhatsAppSessions(): Promise<void> {
  const accounts = await prisma.whatsAppAccount.findMany({
    select: { id: true, userId: true },
  });

  for (const account of accounts) {
    const sessionKey = `${account.userId}:${account.id}`;
    try {
      const session = await whatsappAdapter.connect(sessionKey);
      await prisma.whatsAppAccount.update({
        where: { id: account.id },
        data: { connectionStatus: session.status },
      });
      app.log.info({ accountId: account.id, status: session.status }, 'WhatsApp session restoration started');
    } catch (error) {
      app.log.error({ err: error, accountId: account.id }, 'WhatsApp session restoration failed; retry scheduled');
      await prisma.whatsAppAccount.update({
        where: { id: account.id },
        data: { connectionStatus: 'RECONNECTING' },
      }).catch(() => undefined);
    }
  }
}

whatsappAdapter.setIncomingMessageHandler(async (incoming) => {
  try {
    await processIncomingWhatsAppMessage(incoming);
  } catch (error) {
    app.log.error({ err: error }, 'Incoming WhatsApp message processing failed');
  }
});

function sanitizeUser(user: Record<string, any>) {
  if (!user) return user;
  const {
    passwordHash,
    ...safe
  } = user;
  return safe;
}

function getSessionToken(request: any): string | null {
  const authorization = request.headers.authorization as string | undefined;
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  if (match?.[1]) return match[1];

  const cookies = (request.headers.cookie as string | undefined)?.split(';') ?? [];
  const sessionCookie = cookies.map((cookie) => cookie.trim()).find((cookie) => cookie.startsWith('swai_session='));
  if (!sessionCookie) return null;
  try {
    return decodeURIComponent(sessionCookie.slice('swai_session='.length));
  } catch {
    return null;
  }
}

function sessionCookie(token: string, maxAge: number): string {
  const secure = env.NODE_ENV === 'production' ? '; Secure' : '';
  return `swai_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure}`;
}

async function requireAuth(request: any, reply: any) {
  const token = getSessionToken(request);
  if (!token) return reply.code(401).send({ error: 'Authentication required' });

  try {
    const user = await authService.authenticate(token);
    if (!user) return reply.code(401).send({ error: 'Session is invalid or expired' });
    request.user = sanitizeUser(user);
  } catch (error) {
    request.log.error(error, 'Authentication dependencies unavailable');
    return reply.code(503).send({ error: 'Authentication service unavailable' });
  }
}

async function start() {
  await app.register(cors, {
    origin: true,
    credentials: true,
  });

  await app.register(helmet);
  await app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
    keyGenerator: (req) => req.headers['x-forwarded-for']?.toString() ?? req.ip ?? 'unknown',
  });

  app.get('/', async () => ({
    ok: true,
    app: 'surjo-whatsapp-ai',
    status: 'running',
    version: '1.0.0',
    endpoints: {
      health: '/health',
      auth: '/api/v1/auth',
      whatsapp: '/api/v1/whatsapp',
      ai: '/api/v1/ai',
    },
    timestamp: new Date().toISOString(),
  }));

  const readiness = async (_request: unknown, reply: any) => {
    const [database, cache] = await Promise.allSettled([
      prisma.$queryRaw`SELECT 1`,
      redis.ping(),
    ]);
    const dependencies = {
      postgres: database.status === 'fulfilled' ? 'connected' : 'unavailable',
      redis: cache.status === 'fulfilled' ? 'connected' : 'unavailable',
    };
    const ready = database.status === 'fulfilled' && cache.status === 'fulfilled';
    return reply.code(ready ? 200 : 503).send({
      status: ready ? 'ready' : 'degraded',
      app: 'surjo-whatsapp-ai',
      dependencies,
      timestamp: new Date().toISOString(),
    });
  };
  app.get('/health', readiness);
  app.get('/health/ready', readiness);

  app.get('/api/v1/auth/me', { preHandler: requireAuth }, async (request: any) => {
    return { user: request.user };
  });

  app.post('/api/v1/auth/register', async (request, reply) => {
    const schema = z.object({
      username: z.string().min(3),
      email: z.string().email(),
      password: z.string().min(12).max(128),
    });

    const parsed = schema.parse(request.body);

    try {
      const result = await authService.register(parsed);
      return reply
        .code(201)
        .header('set-cookie', sessionCookie(result.token, 60 * 60 * 8))
        .send({ ok: true, user: sanitizeUser(result.user) });
    } catch (error) {
      if (error instanceof Error && error.message === 'User already exists') {
        return reply.code(409).send({ error: error.message });
      }
      request.log.error(error, 'Registration failed');
      return reply.code(503).send({ error: 'Registration service unavailable' });
    }
  });

  app.post('/api/v1/auth/login', async (request, reply) => {
    const schema = z.object({
      usernameOrEmail: z.string().min(3),
      password: z.string().min(12).max(128),
      tenantId: z.string().optional(),
    });

    const payload = schema.parse(request.body);
    try {
      const result = await authService.login(payload);
      if (!result.ok || !result.user || !result.token) {
        return reply.code(401).send({ error: result.message ?? 'Invalid credentials' });
      }
      return reply
        .header('set-cookie', sessionCookie(result.token, 60 * 60 * 8))
        .send({ ok: true, user: sanitizeUser(result.user) });
    } catch (error) {
      request.log.error(error, 'Login failed');
      return reply.code(503).send({ error: 'Authentication service unavailable' });
    }
  });

  app.post('/api/v1/auth/logout', async (request: any, reply) => {
    const token = getSessionToken(request);
    if (token) await authService.logout(token);
    return reply
      .header('set-cookie', sessionCookie('', 0))
      .send({ ok: true, message: 'Logged out' });
  });

  app.get('/api/v1/whatsapp/accounts', { preHandler: requireAuth }, async (request: any, reply) => {
    const accounts = await prisma.whatsAppAccount.findMany({
      where: { userId: request.user.id },
      orderBy: { createdAt: 'desc' },
    });
    const hydrated = await Promise.all(accounts.map((account) => hydrateWhatsAppAccount(request.user.id, account)));
    return reply.send({ accounts: hydrated, count: hydrated.length });
  });

  app.post('/api/v1/whatsapp/accounts', { preHandler: requireAuth }, async (request: any, reply) => {
    const schema = z.object({
      displayName: z.string().trim().min(2).max(80),
      phoneNumber: z.string().trim().max(32).optional(),
    });
    const parsed = schema.parse(request.body);
    const account = await prisma.whatsAppAccount.create({
      data: { ...parsed, userId: request.user.id, connectionStatus: 'DISCONNECTED' },
    });
    const sessionKey = `${request.user.id}:${account.id}`;
    const session = await whatsappAdapter.createSession(sessionKey);
    await prisma.whatsAppAccount.update({
      where: { id: account.id },
      data: { connectionStatus: session.status },
    });
    await recordActivity(request.user.id, 'whatsapp.account.created', 'whatsappAccount', account.id);
    return reply.code(201).send({ account: { ...account, connectionStatus: session.status, qrCode: session.qr } });
  });

  app.get('/api/v1/whatsapp/accounts/:id/status', { preHandler: requireAuth }, async (request: any, reply) => {
    const account = await prisma.whatsAppAccount.findFirst({
      where: { id: request.params.id, userId: request.user.id },
    });
    if (!account) {
      return reply.code(404).send({ error: 'Account not found.' });
    }
    const hydrated = await hydrateWhatsAppAccount(request.user.id, account);
    return reply.send({ account: hydrated });
  });

  app.delete('/api/v1/whatsapp/accounts/:id', { preHandler: requireAuth }, async (request: any, reply) => {
    const account = await prisma.whatsAppAccount.findFirst({
      where: { id: request.params.id, userId: request.user.id },
    });
    if (!account) return reply.code(404).send({ error: 'Account not found.' });

    await whatsappAdapter.deleteSession(`${request.user.id}:${account.id}`);
    await prisma.whatsAppAccount.delete({ where: { id: account.id } });
    await recordActivity(request.user.id, 'whatsapp.account.deleted', 'whatsappAccount', account.id);
    return reply.send({ ok: true, id: account.id });
  });

  app.post('/api/v1/whatsapp/accounts/:id/disconnect', { preHandler: requireAuth }, async (request: any, reply) => {
    const existing = await prisma.whatsAppAccount.findFirst({
      where: { id: request.params.id, userId: request.user.id },
    });
    if (!existing) return reply.code(404).send({ error: 'Account not found.' });
    const sessionKey = `${request.user.id}:${existing.id}`;
    await whatsappAdapter.disconnect(sessionKey);
    const account = await prisma.whatsAppAccount.update({
      where: { id: existing.id },
      data: { connectionStatus: 'DISCONNECTED' },
    });
    await recordActivity(request.user.id, 'whatsapp.account.disconnected', 'whatsappAccount', account.id);
    return reply.send({ ok: true, account: { ...account, connectionStatus: 'DISCONNECTED' } });
  });

  app.post('/api/v1/whatsapp/accounts/:id/connect', { preHandler: requireAuth }, async (request: any, reply) => {
    const existing = await prisma.whatsAppAccount.findFirst({
      where: { id: request.params.id, userId: request.user.id },
    });
    if (!existing) return reply.code(404).send({ error: 'Account not found.' });

    const sessionKey = `${request.user.id}:${existing.id}`;
    const session = await whatsappAdapter.connect(sessionKey);
    const account = await prisma.whatsAppAccount.update({
      where: { id: existing.id },
      data: { connectionStatus: session.status },
    });
    await recordActivity(request.user.id, 'whatsapp.account.login_started', 'whatsappAccount', account.id);
    return reply.send({ ok: true, account: { ...account, connectionStatus: session.status, qrCode: session.qr } });
  });

  app.post('/api/v1/whatsapp/accounts/:id/login', { preHandler: requireAuth }, async (request: any, reply) => {
    const existing = await prisma.whatsAppAccount.findFirst({
      where: { id: request.params.id, userId: request.user.id },
    });
    if (!existing) return reply.code(404).send({ error: 'Account not found.' });

    const sessionKey = `${request.user.id}:${existing.id}`;
    const session = await whatsappAdapter.connect(sessionKey);
    const account = await prisma.whatsAppAccount.update({
      where: { id: existing.id },
      data: { connectionStatus: session.status },
    });
    await recordActivity(request.user.id, 'whatsapp.account.login_started', 'whatsappAccount', account.id);
    return reply.send({ ok: true, account: { ...account, connectionStatus: session.status, qrCode: session.qr } });
  });

  app.post('/api/v1/whatsapp/accounts/:id/qr/refresh', { preHandler: requireAuth }, async (request: any, reply) => {
    const existing = await prisma.whatsAppAccount.findFirst({
      where: { id: request.params.id, userId: request.user.id },
    });
    if (!existing) return reply.code(404).send({ error: 'Account not found.' });

    const sessionKey = `${request.user.id}:${existing.id}`;
    const qrCode = await whatsappAdapter.refreshQr(sessionKey);
    const account = await prisma.whatsAppAccount.update({
      where: { id: existing.id },
      data: { connectionStatus: 'CONNECTING' },
    });
    return reply.send({ ok: true, account: { ...account, connectionStatus: 'CONNECTING', qrCode } });
  });

  app.post('/api/v1/whatsapp/accounts/:id/pairing-code', { preHandler: requireAuth }, async (request: any, reply) => {
    const existing = await prisma.whatsAppAccount.findFirst({
      where: { id: request.params.id, userId: request.user.id },
    });
    if (!existing) return reply.code(404).send({ error: 'Account not found.' });

    const parsed = z.object({
      phoneNumber: z.string().trim().min(7).max(32),
    }).parse(request.body);
    const phoneNumber = parsed.phoneNumber.replace(/\D/g, '');
    if (!/^[1-9]\d{6,14}$/.test(phoneNumber)) {
      return reply.code(400).send({ error: 'Enter a valid phone number with country code, using 7 to 15 digits.' });
    }
    const sessionKey = `${request.user.id}:${existing.id}`;

    try {
      const pairingCode = await whatsappAdapter.requestPairingCode(sessionKey, phoneNumber);
      const account = await prisma.whatsAppAccount.update({
        where: { id: existing.id },
        data: { phoneNumber, connectionStatus: 'CONNECTING' },
      });
      await recordActivity(request.user.id, 'whatsapp.account.pairing_code_requested', 'whatsappAccount', account.id);
      return reply.send({ ok: true, pairingCode, account: { ...account, connectionStatus: 'CONNECTING' } });
    } catch (error) {
      return reply.code(503).send({
        error: error instanceof Error ? error.message : 'Unable to request a WhatsApp pairing code.',
      });
    }
  });

  app.get('/api/v1/whatsapp/accounts/:id/qr', { preHandler: requireAuth }, async (request: any, reply) => {
    const existing = await prisma.whatsAppAccount.findFirst({
      where: { id: request.params.id, userId: request.user.id },
    });
    if (!existing) return reply.code(404).send({ error: 'Account not found.' });

    const session = await whatsappAdapter.status(`${request.user.id}:${existing.id}`);
    return reply.send({ qrCode: session?.qr ?? null, status: session?.status ?? existing.connectionStatus });
  });

  app.post('/api/v1/whatsapp/test-message', { preHandler: requireAuth }, async (request: any, reply) => {
    const schema = z.object({
      to: z.string().trim().min(1),
      content: z.string().trim().min(1),
      accountId: z.string().trim().min(1).optional(),
    });
    const parsed = schema.parse(request.body);

    const account = await prisma.whatsAppAccount.findFirst({
      where: { id: parsed.accountId ?? request.body?.accountId ?? '', userId: request.user.id },
    });
    if (!account) return reply.code(404).send({ error: 'Account not found.' });

    const result = await sendAndStoreMessage(request.user.id, account.id, parsed.to, parsed.content);
    return reply.send({ ok: true, result });
  });

  app.post('/api/v1/whatsapp/accounts/:id/send', { preHandler: requireAuth }, async (request: any, reply) => {
    const account = await prisma.whatsAppAccount.findFirst({
      where: { id: request.params.id, userId: request.user.id },
    });
    if (!account) return reply.code(404).send({ error: 'Account not found.' });

    const schema = z.object({
      to: z.string().trim().min(1),
      content: z.string().trim().min(1),
      chatId: z.string().trim().optional(),
    });
    const parsed = schema.parse(request.body);
    const result = await sendAndStoreMessage(request.user.id, account.id, parsed.to, parsed.content, parsed.chatId);
    return reply.send({ ok: true, result });
  });

  app.get('/api/v1/dashboard/overview', { preHandler: requireAuth }, async (request: any, reply) => {
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const [connectedAccounts, incomingMessages, aiResponses, database, cache] = await Promise.all([
      prisma.whatsAppAccount.count({ where: { userId: request.user.id, connectionStatus: 'CONNECTED' } }),
      prisma.message.count({ where: { userId: request.user.id, senderType: 'CONTACT', createdAt: { gte: dayStart } } }),
      prisma.message.count({ where: { userId: request.user.id, senderType: 'BOT', createdAt: { gte: dayStart } } }),
      prisma.$queryRaw`SELECT 1`.then(() => 'connected').catch(() => 'unavailable'),
      redis.ping().then(() => 'connected').catch(() => 'unavailable'),
    ]);
    return reply.send({
      connectedAccounts,
      incomingMessages,
      aiResponses,
      dependencies: { postgres: database, redis: cache },
    });
  });

  app.get('/api/v1/conversations', { preHandler: requireAuth }, async (request: any, reply) => {
    const conversations = await prisma.conversation.findMany({
      where: { userId: request.user.id },
      orderBy: { updatedAt: 'desc' },
      include: {
        account: { select: { displayName: true, phoneNumber: true } },
        messages: { orderBy: { createdAt: 'desc' } },
      },
    });
    return reply.send({ conversations });
  });

  app.get('/api/v1/contacts', { preHandler: requireAuth }, async (request: any, reply) => {
    const contacts = await prisma.contactPolicy.findMany({
      where: { userId: request.user.id },
      orderBy: { updatedAt: 'desc' },
    });
    return reply.send({ contacts });
  });

  app.post('/api/v1/contacts', { preHandler: requireAuth }, async (request: any, reply) => {
    const parsed = z.object({
      contactId: z.string().trim().min(3).max(120),
      optedIn: z.boolean().default(false),
      blocked: z.boolean().default(false),
      autoReplyEnabled: z.boolean().default(false),
    }).parse(request.body);
    const existing = await prisma.contactPolicy.findFirst({
      where: { userId: request.user.id, contactId: parsed.contactId },
    });
    if (existing) return reply.code(409).send({ error: 'A policy for this contact already exists.' });

    const contact = await prisma.contactPolicy.create({
      data: { ...parsed, userId: request.user.id },
    });
    await recordActivity(request.user.id, 'contact.policy.created', 'contactPolicy', contact.id);
    return reply.code(201).send({ contact });
  });

  app.patch('/api/v1/contacts/:id', { preHandler: requireAuth }, async (request: any, reply) => {
    const parsed = z.object({
      optedIn: z.boolean().optional(),
      blocked: z.boolean().optional(),
      autoReplyEnabled: z.boolean().optional(),
    }).refine((value) => Object.keys(value).length > 0, 'At least one field is required.').parse(request.body);
    const existing = await prisma.contactPolicy.findFirst({
      where: { id: request.params.id, userId: request.user.id },
    });
    if (!existing) return reply.code(404).send({ error: 'Contact policy not found.' });

    const contact = await prisma.contactPolicy.update({
      where: { id: existing.id },
      data: parsed,
    });
    await recordActivity(request.user.id, 'contact.policy.updated', 'contactPolicy', contact.id);
    return reply.send({ contact });
  });

  app.get('/api/v1/bot/settings', { preHandler: requireAuth }, async (request: any, reply) => {
    const settings = await prisma.botSetting.findFirst({
      where: { userId: request.user.id, accountId: null },
      orderBy: { updatedAt: 'desc' },
    });
    return reply.send({ settings: settings ?? {
      autoReplyEnabled: false,
      personality: '',
      language: 'en',
      systemPrompt: '',
    } });
  });

  app.patch('/api/v1/bot/settings', { preHandler: requireAuth }, async (request: any, reply) => {
    const parsed = z.object({
      autoReplyEnabled: z.boolean().optional(),
      personality: z.string().max(120).optional(),
      language: z.string().trim().min(2).max(20).optional(),
      systemPrompt: z.string().max(4000).optional(),
    }).refine((value) => Object.keys(value).length > 0, 'At least one field is required.').parse(request.body);
    const existing = await prisma.botSetting.findFirst({
      where: { userId: request.user.id, accountId: null },
      orderBy: { updatedAt: 'desc' },
    });
    const settings = existing
      ? await prisma.botSetting.update({ where: { id: existing.id }, data: parsed })
      : await prisma.botSetting.create({
          data: {
            userId: request.user.id,
            accountId: null,
            autoReplyEnabled: false,
            language: 'en',
            ...parsed,
          },
        });
    await recordActivity(request.user.id, 'bot.settings.updated', 'botSetting', settings.id);
    return reply.send({ settings });
  });

  app.get('/api/v1/activity', { preHandler: requireAuth }, async (request: any, reply) => {
    const events = await prisma.auditLog.findMany({
      where: { actorId: request.user.id },
      orderBy: { createdAt: 'desc' },
    });
    return reply.send({ events });
  });

  app.get('/api/v1/ai/providers', { preHandler: requireAuth }, async (_request, reply) => {
    return reply.send({ providers: ['OMNIROUTE'] });
  });

  app.get('/api/v1/ai/settings', { preHandler: requireAuth }, async (request: any, reply) => {
    const settings = await loadOmniRouteSettings(request.user.id);
    return reply.send({
      settings: {
        baseUrl: settings.baseUrl,
        defaultModel: settings.defaultModel,
        enabled: settings.enabled,
        hasApiKey: Boolean(settings.apiKey),
      },
    });
  });

  app.patch('/api/v1/ai/settings', { preHandler: requireAuth }, async (request: any, reply) => {
    const existing = await prisma.aIProviderConfig.findFirst({
      where: { userId: request.user.id, provider: 'OMNIROUTE' },
      orderBy: { updatedAt: 'desc' },
    });
    await loadOmniRouteSettings(request.user.id);
    const payload = { ...(request.body ?? {}) };
    if (typeof payload.apiKey === 'string' && !payload.apiKey.trim()) {
      payload.apiKey = undefined;
    }
    const settings = await omnirouteService.saveSettings(request.user.id, payload);
    const data = {
      userId: request.user.id,
      provider: 'OMNIROUTE' as const,
      baseUrl: settings.baseUrl,
      encryptedApiKey: settings.apiKey
        ? encryptValue(settings.apiKey, env.SESSION_ENCRYPTION_KEY)
        : existing?.encryptedApiKey ?? null,
      defaultModel: settings.defaultModel ?? null,
      enabled: settings.enabled,
    };
    if (existing) {
      await prisma.aIProviderConfig.update({ where: { id: existing.id }, data });
    } else {
      await prisma.aIProviderConfig.create({ data });
    }
    await recordActivity(request.user.id, 'ai.omniroute.settings_updated', 'aiProviderConfig');
    return reply.send({
      settings: {
        baseUrl: settings.baseUrl,
        defaultModel: settings.defaultModel,
        enabled: settings.enabled,
        hasApiKey: Boolean(settings.apiKey),
      },
    });
  });

  app.post('/api/v1/ai/test', { preHandler: requireAuth }, async (request: any, reply) => {
    await loadOmniRouteSettings(request.user.id);
    const result = await omnirouteService.testConnection(request.user.id);
    return reply.send(result);
  });

  app.get('/api/v1/ai/models', { preHandler: requireAuth }, async (request: any, reply) => {
    await loadOmniRouteSettings(request.user.id);
    const models = await omnirouteService.listModels(request.user.id);
    return reply.send({ models });
  });

  app.post('/api/v1/ai/generate', { preHandler: requireAuth }, async (request: any, reply) => {
    const parsed = z.object({ prompt: z.string().trim().min(1).max(4000) }).parse(request.body);
    await loadOmniRouteSettings(request.user.id);
    const botSettings = await prisma.botSetting.findFirst({
      where: { userId: request.user.id, accountId: null },
      orderBy: { updatedAt: 'desc' },
    });
    const prompt = [
      botSettings?.systemPrompt ? `System instructions:\n${botSettings.systemPrompt}` : '',
      botSettings?.personality ? `Personality: ${botSettings.personality}` : '',
      botSettings?.language ? `Reply in language: ${botSettings.language}` : '',
      'Draft a concise WhatsApp reply. Return only the reply text; do not send it.',
      `Request: ${parsed.prompt}`,
    ].filter(Boolean).join('\n\n');

    try {
      const response = await omnirouteService.generateResponse(request.user.id, prompt);
      await recordActivity(request.user.id, 'ai.omniroute.draft_generated', 'aiProviderConfig');
      return reply.send({ response });
    } catch (error) {
      return reply.code(503).send({ error: error instanceof Error ? error.message : 'OmniRoute could not generate a draft.' });
    }
  });

  app.get('/api/v1/admin/overview', { preHandler: requireAuth }, async (request: any, reply) => {
    if (request.user.role !== 'SUPER_ADMIN') {
      return reply.code(403).send({ error: 'Forbidden' });
    }

    const [totalUsers, activeUsers, connectedAccounts] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { status: 'ACTIVE' } }),
      prisma.whatsAppAccount.count({ where: { connectionStatus: 'CONNECTED' } }),
    ]);

    return reply.send({
      totalUsers,
      activeUsers,
      connectedAccounts,
      systemStatus: 'healthy',
    });
  });

  app.addHook('onClose', async () => {
    if (redis.isOpen) await redis.quit();
    await prisma.$disconnect();
  });

  await prisma.$connect();
  await redis.connect();
  await redis.ping();
  await authService.initializeSuperAdmin({
    username: env.SUPER_ADMIN_USERNAME,
    email: env.SUPER_ADMIN_EMAIL,
    password: env.SUPER_ADMIN_PASSWORD,
  });
  await app.listen({ host: env.APP_HOST, port: env.APP_PORT });
  console.log(`Server listening at http://${env.APP_HOST}:${env.APP_PORT}`);
  void restoreWhatsAppSessions().catch((error) => {
    app.log.error({ err: error }, 'Unable to restore saved WhatsApp sessions');
  });
}

void start().catch(async (error) => {
  app.log.error(error, 'Server startup failed');
  if (redis.isOpen) await redis.quit();
  await prisma.$disconnect();
  process.exitCode = 1;
});

export { app };
