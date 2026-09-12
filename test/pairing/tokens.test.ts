import { describe, expect, it } from 'vitest';
import type { Env } from '../../worker/env';
import { CODE_ALPHABET } from '../../worker/protocol';
import {
  base64UrlDecode,
  base64UrlEncode,
  constantTimeEqual,
  hexDecode,
  hexEncode,
  hmacSha256,
  randomId,
  requireSecret,
  sha256,
  signDataToken,
  utf8,
  verifyDataToken,
} from '../../worker/pairing/tokens';

const env = { SESSION_SECRET: 'unit-session-secret', NET_KEY_SECRET: 'unit-net-secret' } as unknown as Env;

describe('base64url and hex', () => {
  it('round-trips bytes without padding', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    const text = base64UrlEncode(bytes);
    expect(text).not.toMatch(/[+/=]/);
    expect(base64UrlDecode(text)).toEqual(bytes);
  });
  it('rejects non-base64url input', () => {
    expect(base64UrlDecode('ab$c')).toBeNull();
    expect(base64UrlDecode('a')).toBeNull();
  });
  it('hex round-trips and rejects odd or foreign input', () => {
    expect(hexEncode(new Uint8Array([0, 15, 255]))).toBe('000fff');
    expect(hexDecode('000fff')).toEqual(new Uint8Array([0, 15, 255]));
    expect(hexDecode('abc')).toBeNull();
    expect(hexDecode('zz')).toBeNull();
  });
});

describe('sha256 and hmacSha256', () => {
  it('matches the known SHA-256 of "abc"', async () => {
    expect(hexEncode(await sha256('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
  it('matches RFC 4231 test case 2', async () => {
    const mac = await hmacSha256('Jefe', 'what do ya want for nothing?');
    expect(hexEncode(mac)).toBe(
      '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
    );
  });
});

describe('constantTimeEqual', () => {
  it('compares equal and unequal arrays, and length mismatch is false', () => {
    expect(constantTimeEqual(utf8('abc'), utf8('abc'))).toBe(true);
    expect(constantTimeEqual(utf8('abc'), utf8('abd'))).toBe(false);
    expect(constantTimeEqual(utf8('abc'), utf8('abcd'))).toBe(false);
  });
});

describe('requireSecret', () => {
  it('returns the configured secret', () => {
    expect(requireSecret(env, 'SESSION_SECRET')).toBe('unit-session-secret');
  });
  it('throws loudly when missing and NETWORK_CHECK is not off', () => {
    expect(() => requireSecret({} as Env, 'SESSION_SECRET')).toThrow(/SESSION_SECRET/);
    expect(() => requireSecret({ NETWORK_CHECK: 'warn' } as Env, 'NET_KEY_SECRET')).toThrow(/NET_KEY_SECRET/);
  });
  it('never enables a known secret through network policy or test environment', () => {
    expect(() => requireSecret({ NETWORK_CHECK: 'off' } as Env, 'SESSION_SECRET')).toThrow(/SESSION_SECRET/);
    expect(() => requireSecret({ APP_ENV: 'test' } as Env, 'SESSION_SECRET')).toThrow(/SESSION_SECRET/);
  });
});

describe('data tokens', () => {
  const expiresAt = Date.now() + 600_000;

  it('signs the documented shape and verifies', async () => {
    const token = await signDataToken(env, 'R00M1D', expiresAt);
    const [roomPart, expPart, macPart] = token.split('.');
    expect(base64UrlDecode(roomPart!)).toEqual(utf8('R00M1D'));
    expect(expPart).toBe(String(expiresAt));
    expect(macPart).toHaveLength(43);
    await expect(verifyDataToken(env, token)).resolves.toEqual({ roomId: 'R00M1D', expiresAt });
  });

  it('is deterministic for the same inputs', async () => {
    expect(await signDataToken(env, 'R00M1D', expiresAt)).toBe(await signDataToken(env, 'R00M1D', expiresAt));
  });

  it('rejects a tampered room id, expiry or MAC', async () => {
    const token = await signDataToken(env, 'R00M1D', expiresAt);
    const [r, e, m] = token.split('.') as [string, string, string];
    expect(await verifyDataToken(env, `${base64UrlEncode(utf8('R00M1E'))}.${e}.${m}`)).toBeNull();
    expect(await verifyDataToken(env, `${r}.${expiresAt + 1}.${m}`)).toBeNull();
    const flipped = (m[0] === 'A' ? 'B' : 'A') + m.slice(1);
    expect(await verifyDataToken(env, `${r}.${e}.${flipped}`)).toBeNull();
  });

  it('rejects an expired token and a token signed with another secret', async () => {
    const stale = await signDataToken(env, 'R00M1D', Date.now() - 1);
    expect(await verifyDataToken(env, stale)).toBeNull();
    const other = { SESSION_SECRET: 'someone-else' } as unknown as Env;
    expect(await verifyDataToken(other, await signDataToken(env, 'R00M1D', expiresAt))).toBeNull();
  });

  it('rejects malformed tokens without throwing', async () => {
    for (const bad of ['', 'a', 'a.b', 'a.b.c.d', 'a.notanumber.c', '$$.1.2', `${base64UrlEncode(utf8('x'))}.1e3.abc`]) {
      expect(await verifyDataToken(env, bad)).toBeNull();
    }
  });
});

describe('randomId', () => {
  it('encodes n bytes into ceil(8n/5) Crockford symbols', () => {
    expect(randomId(5)).toHaveLength(8);
    expect(randomId(10)).toHaveLength(16);
    expect(randomId(16)).toHaveLength(26);
    expect(randomId(20)).toHaveLength(32);
    for (const ch of randomId(20)) expect(CODE_ALPHABET.includes(ch)).toBe(true);
  });
  it('rejects non-positive sizes', () => {
    expect(() => randomId(0)).toThrow();
  });
});
