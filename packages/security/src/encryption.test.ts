import { describe, expect, it } from 'vitest';
import { decryptValue, encryptValue } from './index.js';

describe('security encryption', () => {
  it('round-trips encrypted values', () => {
    const secret = 'super-secret-key';
    const encrypted = encryptValue('hello world', secret);

    expect(encrypted).not.toBe('hello world');
    expect(decryptValue(encrypted, secret)).toBe('hello world');
  });
});
