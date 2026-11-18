import { randomUUID } from 'node:crypto';
import { z } from 'zod';

export type WhatsAppConnectionStatus = 'DISCONNECTED' | 'CONNECTING' | 'CONNECTED' | 'RECONNECTING';

export interface WhatsAppAccount {
  id: string;
  userId: string;
  displayName: string;
  phoneNumber?: string;
  connectionStatus: WhatsAppConnectionStatus;
  qrCode?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface IncomingMessageInput {
  sender: string;
  content: string;
  chatId: string;
}

export interface ProcessedMessageResult {
  status: 'processed';
  reply: string;
  conversationId: string;
  sender: string;
  dedupeKey: string;
}

const accountSchema = z.object({
  displayName: z.string().min(2).max(80),
  phoneNumber: z.string().optional(),
});

const incomingSchema = z.object({
  sender: z.string().min(2),
  content: z.string().min(1).max(4000),
  chatId: z.string().min(2),
});

export interface MessageReplyProvider {
  generateResponse(prompt: string, userId?: string): Promise<string>;
}

export interface OutboundMessageInput {
  to: string;
  content: string;
  chatId?: string;
}

export interface OutboundMessageResult {
  status: 'sent';
  messageId: string;
  to: string;
  content: string;
  response: string;
  chatId: string;
  accountId: string;
  sentAt: Date;
}

export function createWhatsAppService({
  provider,
}: {
  provider?: MessageReplyProvider;
} = {}) {
  const accounts = new Map<string, WhatsAppAccount>();
  const dedupeSet = new Set<string>();

  const getByUser = (userId: string) => {
    const values = Array.from(accounts.values()).filter((account) => account.userId === userId);
    return values;
  };

  return {
    createAccount(userId: string, payload: unknown): WhatsAppAccount {
      const parsed = accountSchema.parse(payload);
      const account: WhatsAppAccount = {
        id: randomUUID(),
        userId,
        displayName: parsed.displayName,
        phoneNumber: parsed.phoneNumber,
        connectionStatus: 'CONNECTING',
        qrCode: `wa-qr-${randomUUID()}`,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      accounts.set(account.id, account);
      return account;
    },

    connectAccount(userId: string, accountId: string): WhatsAppAccount {
      const account = accounts.get(accountId);
      if (!account || account.userId !== userId) {
        throw new Error('Account not found for this user.');
      }

      const connected: WhatsAppAccount = {
        ...account,
        connectionStatus: 'CONNECTED',
        qrCode: account.qrCode ?? `wa-session-${randomUUID()}`,
        updatedAt: new Date(),
      };
      accounts.set(accountId, connected);
      return connected;
    },

    loginAccount(userId: string, accountId: string): WhatsAppAccount {
      return this.connectAccount(userId, accountId);
    },

    refreshQrCode(userId: string, accountId: string): WhatsAppAccount {
      const account = accounts.get(accountId);
      if (!account || account.userId !== userId) {
        throw new Error('Account not found for this user.');
      }

      const refreshed: WhatsAppAccount = {
        ...account,
        connectionStatus: 'CONNECTING',
        qrCode: `wa-qr-${randomUUID()}`,
        updatedAt: new Date(),
      };
      accounts.set(accountId, refreshed);
      return refreshed;
    },

    disconnectAccount(userId: string, accountId: string): WhatsAppAccount {
      const account = accounts.get(accountId);
      if (!account || account.userId !== userId) {
        throw new Error('Account not found for this user.');
      }

      const disconnected: WhatsAppAccount = {
        ...account,
        connectionStatus: 'DISCONNECTED',
        qrCode: undefined,
        updatedAt: new Date(),
      };
      accounts.set(accountId, disconnected);
      return disconnected;
    },

    listAccounts(userId: string): WhatsAppAccount[] {
      return getByUser(userId);
    },

    getAccount(userId: string, accountId: string): WhatsAppAccount | null {
      const account = accounts.get(accountId);
      if (!account || account.userId !== userId) return null;
      return account;
    },

    async sendMessage(
      userId: string,
      accountId: string,
      payload: unknown,
    ): Promise<OutboundMessageResult> {
      const parsed = z.object({
        to: z.string().min(3),
        content: z.string().min(1).max(4000),
        chatId: z.string().min(2).optional(),
      }).parse(payload);

      const account = accounts.get(accountId);
      if (!account || account.userId !== userId) {
        throw new Error('Account not found for this user.');
      }

      if (account.connectionStatus !== 'CONNECTED') {
        throw new Error('WhatsApp account must be logged in before sending messages.');
      }

      const response = provider ? await provider.generateResponse(parsed.content, userId) : parsed.content;
      const sentAt = new Date();

      return {
        status: 'sent',
        messageId: randomUUID(),
        to: parsed.to,
        content: parsed.content,
        response,
        chatId: parsed.chatId ?? parsed.to,
        accountId,
        sentAt,
      };
    },

    async processIncomingMessage(
      userId: string,
      accountId: string,
      payload: unknown,
    ): Promise<ProcessedMessageResult> {
      const parsed = incomingSchema.parse(payload);
      const account = accounts.get(accountId);
      if (!account || account.userId !== userId) {
        throw new Error('Account not found for this user.');
      }

      const dedupeKey = `${accountId}:${parsed.chatId}:${parsed.sender}:${parsed.content.trim()}`;
      if (dedupeSet.has(dedupeKey)) {
        return {
          status: 'processed',
          reply: 'Duplicate message ignored.',
          conversationId: parsed.chatId,
          sender: parsed.sender,
          dedupeKey,
        };
      }

      dedupeSet.add(dedupeKey);
      const fallbackReply = `Thanks for the message: "${parsed.content}". I have received it and stored it in the conversation for ${account.displayName}.`;
      const reply = provider ? await provider.generateResponse(parsed.content, userId) : fallbackReply;
      return {
        status: 'processed',
        reply,
        conversationId: parsed.chatId,
        sender: parsed.sender,
        dedupeKey,
      };
    },
  };
}
