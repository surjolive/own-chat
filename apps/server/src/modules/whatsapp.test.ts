import { describe, expect, it } from 'vitest';
import { createWhatsAppService } from './whatsapp.js';

describe('whatsapp service', () => {
  it('creates a QR session and processes a message', async () => {
    const service = createWhatsAppService();

    const account = await service.createAccount('user-1', { displayName: 'Alice' });
    expect(account.connectionStatus).toBe('CONNECTING');

    const session = await service.connectAccount('user-1', account.id);
    expect(session.qrCode).toBeTruthy();

    const result = await service.processIncomingMessage('user-1', account.id, {
      sender: '555-100',
      content: 'Hello bot',
      chatId: 'chat-1',
    });

    expect(result.reply).toContain('Hello');
    expect(result.status).toBe('processed');
  });

  it('uses an AI provider when configured', async () => {
    const service = createWhatsAppService({
      provider: {
        async generateResponse(prompt: string) {
          return `OmniRoute response for: ${prompt}`;
        },
      },
    });

    const account = service.createAccount('user-3', { displayName: 'Charlie' });
    const result = await service.processIncomingMessage('user-3', account.id, {
      sender: '555-505',
      content: 'Summarize this update',
      chatId: 'chat-ai',
    });

    expect(result.reply).toContain('OmniRoute response for: Summarize this update');
  });

  it('logs in a WhatsApp account and sends an outbound message automatically', async () => {
    const service = createWhatsAppService({
      provider: {
        async generateResponse(prompt: string) {
          return `Auto reply for: ${prompt}`;
        },
      },
    });

    const account = service.createAccount('user-4', { displayName: 'Dana' });
    const loggedIn = service.loginAccount('user-4', account.id);
    const sent = await service.sendMessage('user-4', account.id, {
      to: '555-123',
      content: 'Hello from the app',
      chatId: 'chat-outbound',
    });

    expect(loggedIn.connectionStatus).toBe('CONNECTED');
    expect(sent.status).toBe('sent');
    expect(sent.content).toContain('Hello from the app');
  });

  it('refreshes the QR code for an active session', () => {
    const service = createWhatsAppService();
    const account = service.createAccount('user-2', { displayName: 'Bob' });

    const refreshed = service.refreshQrCode('user-2', account.id);

    expect(refreshed.qrCode).toBeTruthy();
    expect(refreshed.qrCode).not.toBe(account.qrCode);
  });
});
