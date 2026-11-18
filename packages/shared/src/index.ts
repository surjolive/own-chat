export type UserRole = 'SUPER_ADMIN' | 'USER';
export type UserStatus = 'ACTIVE' | 'SUSPENDED' | 'PENDING';
export type ProviderType = 'OMNIROUTE' | 'OLLAMA';
export type ConnectionStatus = 'DISCONNECTED' | 'CONNECTING' | 'CONNECTED' | 'RECONNECTING';

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

export const DEFAULT_SYSTEM_PROMPT =
  'You are a helpful WhatsApp assistant for the account owner. Be polite, concise, and avoid inventing facts.';
