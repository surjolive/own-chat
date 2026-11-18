import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { hash, verify } from 'argon2';

const ALGORITHM = 'aes-256-gcm';

function deriveKey(secret: string): Buffer {
  return createHash('sha256').update(secret).digest();
}

export function encryptValue(value: string, secret: string): string {
  const key = deriveKey(secret);
  const iv = randomBytes(16);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${encrypted.toString('hex')}:${tag.toString('hex')}`;
}

export function decryptValue(payload: string, secret: string): string {
  const [ivHex, contentHex, tagHex] = payload.split(':');
  if (!ivHex || !contentHex || !tagHex) {
    throw new Error('Invalid encrypted payload');
  }

  const key = deriveKey(secret);
  const iv = Buffer.from(ivHex, 'hex');
  const encrypted = Buffer.from(contentHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString('utf8');
}

export async function hashPassword(password: string): Promise<string> {
  return hash(password);
}

export async function verifyPassword(password: string, hashedPassword: string): Promise<boolean> {
  if (!hashedPassword || hashedPassword.length === 0) {
    return false;
  }

  try {
    return await verify(hashedPassword, password);
  } catch {
    return false;
  }
}

export function redactSecrets(value: string): string {
  return value
    .replace(/(session[_-]?token=)[^\s&]+/gi, '$1[REDACTED]')
    .replace(/(api[_-]?key=)[^\s&]+/gi, '$1[REDACTED]')
    .replace(/(Authorization:\s*Bearer\s+)[A-Za-z0-9._-]+/gi, '$1[REDACTED]')
    .replace(/(password\s*[:=]\s*)([^\s,;]+)/gi, '$1[REDACTED]');
}
