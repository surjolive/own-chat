import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import QRCode from 'qrcode';
import { DisconnectReason, fetchLatestBaileysVersion, makeWASocket, useMultiFileAuthState } from '@whiskeysockets/baileys';

export type ConnectionStatus = 'DISCONNECTED' | 'CONNECTING' | 'CONNECTED' | 'RECONNECTING';

export interface WhatsAppSessionSnapshot {
  id: string;
  ownerId: string;
  status: ConnectionStatus;
  qr?: string;
  displayName?: string;
}

export interface IncomingWhatsAppMessage {
  ownerId: string;
  from: string;
  chatId: string;
  messageId: string;
  content: string;
  displayName?: string;
}

export type IncomingMessageHandler = (message: IncomingWhatsAppMessage) => void | Promise<void>;

export interface WhatsAppAdapter {
  createSession(ownerId: string): Promise<WhatsAppSessionSnapshot>;
  connect(ownerId: string): Promise<WhatsAppSessionSnapshot>;
  requestPairingCode(ownerId: string, phoneNumber: string): Promise<string>;
  disconnect(ownerId: string): Promise<void>;
  deleteSession(ownerId: string): Promise<void>;
  setIncomingMessageHandler(handler: IncomingMessageHandler): void;
  refreshQr(ownerId: string): Promise<string>;
  status(ownerId: string): Promise<WhatsAppSessionSnapshot | null>;
  sendMessage(ownerId: string, to: string, content: string): Promise<{ to: string; content: string; ok: boolean }>;
}

export function createQrDataUrl(payload: string): Promise<string> {
  return QRCode.toDataURL(payload, {
    width: 320,
    margin: 1,
    errorCorrectionLevel: 'M',
  });
}

export function normalizePairingPhoneNumber(phoneNumber: string): string {
  const normalized = phoneNumber.replace(/\D/g, '');
  if (!/^[1-9]\d{6,14}$/.test(normalized)) {
    throw new Error('Enter a valid phone number with country code, using 7 to 15 digits.');
  }
  return normalized;
}

export class BaileysAdapter implements WhatsAppAdapter {
  private readonly sessions = new Map<string, WhatsAppSessionSnapshot>();
  private readonly sockets = new Map<string, ReturnType<typeof makeWASocket>>();
  private readonly removedSessions = new Set<string>();
  private readonly reconnectTimers = new Map<string, NodeJS.Timeout>();
  private incomingMessageHandler?: IncomingMessageHandler;

  setIncomingMessageHandler(handler: IncomingMessageHandler): void {
    this.incomingMessageHandler = handler;
  }

  private scheduleReconnect(ownerId: string, delayMs = 5000): void {
    if (this.removedSessions.has(ownerId) || this.reconnectTimers.has(ownerId)) return;

    const timer = setTimeout(() => {
      this.reconnectTimers.delete(ownerId);
      if (!this.removedSessions.has(ownerId)) {
        void this.connect(ownerId).catch(() => undefined);
      }
    }, delayMs);
    timer.unref();
    this.reconnectTimers.set(ownerId, timer);
  }

  private async buildQrPayload(seed: string): Promise<string> {
    return createQrDataUrl(seed);
  }

  private async ensureSocket(ownerId: string): Promise<ReturnType<typeof makeWASocket>> {
    const existing = this.sockets.get(ownerId);
    if (existing) return existing;

    const authDir = path.join(os.tmpdir(), 'surjo-whatsapp-ai', 'auth', encodeURIComponent(ownerId));
    await fs.mkdir(authDir, { recursive: true });
    const { state, saveCreds } = await useMultiFileAuthState(authDir);
    const { version } = await fetchLatestBaileysVersion();
    const socket = makeWASocket({
      auth: state,
      version,
      printQRInTerminal: false,
    });

    socket.ev.on('creds.update', saveCreds);
    socket.ev.on('messages.upsert', ({ messages, type }) => {
      if (type !== 'notify' || !this.incomingMessageHandler) return;

      for (const message of messages) {
        const chatId = message.key.remoteJid;
        if (!chatId || message.key.fromMe || chatId === 'status@broadcast' || chatId.endsWith('@g.us')) continue;

        const content = message.message?.conversation ??
          message.message?.extendedTextMessage?.text ??
          message.message?.imageMessage?.caption ??
          message.message?.videoMessage?.caption;
        if (!content?.trim()) continue;

        const incoming: IncomingWhatsAppMessage = {
          ownerId,
          from: chatId,
          chatId,
          messageId: message.key.id ?? `${chatId}:${String(message.messageTimestamp ?? Date.now())}`,
          content: content.trim(),
          displayName: message.pushName ?? undefined,
        };
        void Promise.resolve(this.incomingMessageHandler(incoming)).catch(() => undefined);
      }
    });

    socket.ev.on('connection.update', async (update) => {
      if (this.removedSessions.has(ownerId)) return;
      const { connection, lastDisconnect, qr } = update;
      const current = this.sessions.get(ownerId) ?? {
        id: `wa-${ownerId}`,
        ownerId,
        status: 'CONNECTING' as const,
      };

      if (qr) {
        const payload = await this.buildQrPayload(String(qr));
        this.sessions.set(ownerId, { ...current, status: 'CONNECTING', qr: payload });
      }

      if (connection === 'open') {
        this.sessions.set(ownerId, {
          ...current,
          status: 'CONNECTED',
          qr: undefined,
          displayName: socket.user?.name ?? current.displayName,
        });
      }

      if (connection === 'close') {
        const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut && current.status !== 'DISCONNECTED';
        this.sockets.delete(ownerId);
        this.sessions.set(ownerId, {
          ...current,
          status: shouldReconnect ? 'RECONNECTING' : 'DISCONNECTED',
          qr: shouldReconnect ? current.qr : undefined,
        });

        if (shouldReconnect) this.scheduleReconnect(ownerId, 1000);
      }
    });

    this.sockets.set(ownerId, socket);
    return socket;
  }

  async createSession(ownerId: string): Promise<WhatsAppSessionSnapshot> {
    const session: WhatsAppSessionSnapshot = {
      id: `wa-${ownerId}`,
      ownerId,
      status: 'CONNECTING',
    };
    this.sessions.set(ownerId, session);
    await this.ensureSocket(ownerId);
    return this.sessions.get(ownerId) ?? session;
  }

  async connect(ownerId: string): Promise<WhatsAppSessionSnapshot> {
    const existing = this.sessions.get(ownerId) ?? {
      id: `wa-${ownerId}`,
      ownerId,
      status: 'CONNECTING' as const,
    };

    this.sessions.set(ownerId, { ...existing, status: 'CONNECTING' });
    const reconnectTimer = this.reconnectTimers.get(ownerId);
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      this.reconnectTimers.delete(ownerId);
    }

    try {
      await this.ensureSocket(ownerId);
      return this.sessions.get(ownerId) ?? { ...existing, status: 'CONNECTING' };
    } catch (error) {
      const fallback: WhatsAppSessionSnapshot = {
        ...existing,
        status: 'RECONNECTING',
        qr: undefined,
      };
      this.sessions.set(ownerId, fallback);
      this.scheduleReconnect(ownerId);
      throw error;
    }
  }

  async requestPairingCode(ownerId: string, phoneNumber: string): Promise<string> {
    const normalizedPhoneNumber = normalizePairingPhoneNumber(phoneNumber);
    const socket = await this.ensureSocket(ownerId);
    const pairingCode = await socket.requestPairingCode(normalizedPhoneNumber);
    const current = this.sessions.get(ownerId) ?? {
      id: `wa-${ownerId}`,
      ownerId,
      status: 'CONNECTING' as const,
    };
    this.sessions.set(ownerId, { ...current, status: 'CONNECTING', qr: undefined });
    return pairingCode;
  }

  async disconnect(ownerId: string): Promise<void> {
    const reconnectTimer = this.reconnectTimers.get(ownerId);
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      this.reconnectTimers.delete(ownerId);
    }

    const existing = this.sessions.get(ownerId);
    if (existing) {
      this.sessions.set(ownerId, { ...existing, status: 'DISCONNECTED', qr: undefined });
    }

    const socket = this.sockets.get(ownerId);
    if (socket) {
      this.sockets.delete(ownerId);
      socket.ws?.close();
    }
  }

  async deleteSession(ownerId: string): Promise<void> {
    this.removedSessions.add(ownerId);
    const reconnectTimer = this.reconnectTimers.get(ownerId);
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      this.reconnectTimers.delete(ownerId);
    }
    await this.disconnect(ownerId);

    const authDir = path.join(os.tmpdir(), 'surjo-whatsapp-ai', 'auth', encodeURIComponent(ownerId));
    try {
      await fs.rm(authDir, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 });
      this.sessions.delete(ownerId);
    } catch (error) {
      this.removedSessions.delete(ownerId);
      throw error;
    }
  }

  async refreshQr(ownerId: string): Promise<string> {
    const existing = this.sessions.get(ownerId);
    await this.disconnect(ownerId);
    this.sessions.set(ownerId, {
      id: existing?.id ?? `wa-${ownerId}`,
      ownerId,
      status: 'CONNECTING',
    });
    await this.ensureSocket(ownerId);
    return this.sessions.get(ownerId)?.qr ?? '';
  }

  async status(ownerId: string): Promise<WhatsAppSessionSnapshot | null> {
    return this.sessions.get(ownerId) ?? null;
  }

  async sendMessage(ownerId: string, to: string, content: string): Promise<{ to: string; content: string; ok: boolean }> {
    const socket = this.sockets.get(ownerId);
    if (!socket || !socket.user) {
      throw new Error('WhatsApp Web session is not connected. Connect the account before sending messages.');
    }

    await socket.sendMessage(to, { text: content });
    return { to, content, ok: true };
  }
}
