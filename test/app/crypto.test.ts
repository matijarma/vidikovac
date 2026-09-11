import { describe, expect, it } from 'vitest';
import { hmacSha256, hmacSha256Base64Url, toBase64Url, toHex } from '../../app/src/crypto';

describe('HMAC-SHA256 for the beacon challenge', () => {
  it('matches the RFC test vector (key "key", "The quick brown fox…")', async () => {
    const mac = await hmacSha256('key', 'The quick brown fox jumps over the lazy dog');
    expect(toHex(mac)).toBe('f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8');
  });
  it('base64url has no padding and no + or /', async () => {
    const s = await hmacSha256Base64Url('key', 'The quick brown fox jumps over the lazy dog');
    expect(s).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(toBase64Url(new Uint8Array([251, 255, 191]))).toBe('-_-_');
  });
});
