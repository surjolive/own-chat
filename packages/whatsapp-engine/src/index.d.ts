export type ConnectionStatus = 'DISCONNECTED' | 'CONNECTING' | 'CONNECTED' | 'RECONNECTING';
export interface WhatsAppSessionSnapshot {
    id: string;
    ownerId: string;
    status: ConnectionStatus;
    qr?: string;
    displayName?: string;
}
export interface WhatsAppAdapter {
    createSession(ownerId: string): Promise<WhatsAppSessionSnapshot>;
    connect(ownerId: string): Promise<WhatsAppSessionSnapshot>;
    requestPairingCode(ownerId: string, phoneNumber: string): Promise<string>;
    disconnect(ownerId: string): Promise<void>;
    refreshQr(ownerId: string): Promise<string>;
    status(ownerId: string): Promise<WhatsAppSessionSnapshot | null>;
    sendMessage(ownerId: string, to: string, content: string): Promise<{
        to: string;
        content: string;
        ok: boolean;
    }>;
}
export declare function normalizePairingPhoneNumber(phoneNumber: string): string;
export declare class BaileysAdapter implements WhatsAppAdapter {
    private readonly sessions;
    private readonly sockets;
    private buildQrPayload;
    private ensureSocket;
    createSession(ownerId: string): Promise<WhatsAppSessionSnapshot>;
    connect(ownerId: string): Promise<WhatsAppSessionSnapshot>;
    requestPairingCode(ownerId: string, phoneNumber: string): Promise<string>;
    disconnect(ownerId: string): Promise<void>;
    refreshQr(ownerId: string): Promise<string>;
    status(ownerId: string): Promise<WhatsAppSessionSnapshot | null>;
    sendMessage(ownerId: string, to: string, content: string): Promise<{
        to: string;
        content: string;
        ok: boolean;
    }>;
}
