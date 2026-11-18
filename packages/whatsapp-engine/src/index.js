import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import QRCode from 'qrcode';
import { DisconnectReason, makeWASocket, useMultiFileAuthState } from '@whiskeysockets/baileys';
export class BaileysAdapter {
    sessions = new Map();
    sockets = new Map();
    async buildQrPayload(seed) {
        return QRCode.toDataURL(seed, {
            width: 320,
            margin: 1,
            errorCorrectionLevel: 'M',
        });
    }
    async ensureSocket(ownerId) {
        const existing = this.sockets.get(ownerId);
        if (existing)
            return existing;
        const authDir = path.join(os.tmpdir(), 'surjo-whatsapp-ai', 'auth', ownerId);
        await fs.mkdir(authDir, { recursive: true });
        const { state, saveCreds } = await useMultiFileAuthState(authDir);
        const socket = makeWASocket({
            auth: state,
            printQRInTerminal: false,
        });
        socket.ev.on('creds.update', saveCreds);
        socket.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;
            const current = this.sessions.get(ownerId) ?? {
                id: `wa-${ownerId}`,
                ownerId,
                status: 'CONNECTING',
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
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                this.sessions.set(ownerId, {
                    ...current,
                    status: shouldReconnect ? 'RECONNECTING' : 'DISCONNECTED',
                    qr: shouldReconnect ? current.qr : undefined,
                });
            }
        });
        this.sockets.set(ownerId, socket);
        return socket;
    }
    async createSession(ownerId) {
        const seed = `wa-${ownerId}-${Date.now()}`;
        const qr = await this.buildQrPayload(seed);
        const session = {
            id: `wa-${ownerId}`,
            ownerId,
            status: 'CONNECTING',
            qr,
        };
        this.sessions.set(ownerId, session);
        return session;
    }
    async connect(ownerId) {
        const existing = this.sessions.get(ownerId) ?? {
            id: `wa-${ownerId}`,
            ownerId,
            status: 'CONNECTING',
        };
        this.sessions.set(ownerId, { ...existing, status: 'CONNECTING' });
        try {
            await this.ensureSocket(ownerId);
            return this.sessions.get(ownerId) ?? { ...existing, status: 'CONNECTING' };
        }
        catch (error) {
            const fallback = {
                ...existing,
                status: 'DISCONNECTED',
                qr: undefined,
            };
            this.sessions.set(ownerId, fallback);
            throw error;
        }
    }
    async disconnect(ownerId) {
        const socket = this.sockets.get(ownerId);
        if (socket) {
            socket.ws?.close();
            this.sockets.delete(ownerId);
        }
        const existing = this.sessions.get(ownerId);
        if (existing) {
            this.sessions.set(ownerId, { ...existing, status: 'DISCONNECTED', qr: undefined });
        }
    }
    async refreshQr(ownerId) {
        const existing = this.sessions.get(ownerId) ?? { id: `wa-${ownerId}`, ownerId, status: 'CONNECTING' };
        const qr = await this.buildQrPayload(`wa-${ownerId}-${Date.now()}`);
        this.sessions.set(ownerId, { ...existing, qr, status: 'CONNECTING' });
        return qr;
    }
    async status(ownerId) {
        return this.sessions.get(ownerId) ?? null;
    }
    async sendMessage(ownerId, to, content) {
        const socket = this.sockets.get(ownerId);
        if (!socket || !socket.user) {
            throw new Error('WhatsApp Web session is not connected. Connect the account before sending messages.');
        }
        await socket.sendMessage(to, { text: content });
        return { to, content, ok: true };
    }
}
