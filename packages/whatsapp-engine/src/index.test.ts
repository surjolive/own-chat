import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error Vitest must load the TypeScript source, not the stale sibling JavaScript file.
import { BaileysAdapter, createQrDataUrl, normalizePairingPhoneNumber } from './index.ts';

describe('BaileysAdapter', () => {
  it('encodes a QR payload as a PNG image', async () => {
    const qr = await createQrDataUrl('test-whatsapp-pairing-payload');

    expect(qr).toMatch(/^data:image\/png;base64,/i);
  });

  it('normalizes international phone numbers for pairing codes', () => {
    expect(normalizePairingPhoneNumber('+1 (555) 123-4567')).toBe('15551234567');
    expect(() => normalizePairingPhoneNumber('555')).toThrow('with country code');
  });

  it('removes saved authentication files when deleting a session', async () => {
    const ownerId = `delete-test-${Date.now()}`;
    const authDir = path.join(os.tmpdir(), 'surjo-whatsapp-ai', 'auth', encodeURIComponent(ownerId));
    await fs.mkdir(authDir, { recursive: true });
    await fs.writeFile(path.join(authDir, 'creds.json'), '{}');

    const adapter = new BaileysAdapter();
    await adapter.deleteSession(ownerId);

    await expect(fs.access(authDir)).rejects.toThrow();
  });
});
