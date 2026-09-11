import { describe, expect, it } from 'vitest';
import type { Env } from '../../worker/env';
import { NET_KEY_LENGTH, addressPrefix, isNetKey, netKey } from '../../worker/pairing/netkey';

const env = { NET_KEY_SECRET: 'unit-net-secret-0123456789' } as unknown as Env;

function fakeRequest(ip: string | null, asn: number | undefined): Request {
  const headers = new Headers();
  if (ip !== null) headers.set('CF-Connecting-IP', ip);
  return { headers, cf: asn === undefined ? undefined : { asn } } as unknown as Request;
}

describe('addressPrefix', () => {
  it('keeps a full IPv4 address', () => {
    expect(addressPrefix('203.0.113.10')).toBe('203.0.113.10');
  });
  it('keeps the first 64 bits of IPv6, normalised', () => {
    expect(addressPrefix('2001:db8:85a3::8a2e:370:7334')).toBe('2001:0db8:85a3:0000');
    expect(addressPrefix('2001:0DB8:85A3:0000:0000:8A2E:0370:7334')).toBe('2001:0db8:85a3:0000');
    expect(addressPrefix('::1')).toBe('0000:0000:0000:0000');
    expect(addressPrefix('fe80::')).toBe('fe80:0000:0000:0000');
  });
  it('unwraps IPv4-mapped IPv6', () => {
    expect(addressPrefix('::ffff:198.51.100.7')).toBe('198.51.100.7');
  });
  it('returns empty for garbage', () => {
    expect(addressPrefix('')).toBe('');
    expect(addressPrefix('not-an-ip')).toBe('');
    expect(addressPrefix('1:2:3:4:5:6:7:8:9')).toBe('');
  });
});

describe('netKey', () => {
  it('is 22 base64url characters and stable for the same asn and address', async () => {
    const a = await netKey(env, fakeRequest('203.0.113.10', 5391));
    const b = await netKey(env, fakeRequest('203.0.113.10', 5391));
    expect(a).toBe(b);
    expect(a).toHaveLength(NET_KEY_LENGTH);
    expect(a).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(isNetKey(a)).toBe(true);
  });
  it('differs across ASN, across address and across secret', async () => {
    const base = await netKey(env, fakeRequest('203.0.113.10', 5391));
    expect(await netKey(env, fakeRequest('203.0.113.10', 31012))).not.toBe(base);
    expect(await netKey(env, fakeRequest('203.0.113.11', 5391))).not.toBe(base);
    const other = { NET_KEY_SECRET: 'another-secret-0123456789' } as unknown as Env;
    expect(await netKey(other, fakeRequest('203.0.113.10', 5391))).not.toBe(base);
  });
  it('treats two IPv6 hosts in one /64 as the same network', async () => {
    const a = await netKey(env, fakeRequest('2001:db8:85a3::1', 5391));
    const b = await netKey(env, fakeRequest('2001:db8:85a3::abcd', 5391));
    expect(a).toBe(b);
  });
  it('still yields a key without cf or header (local dev), and it differs from a real one', async () => {
    const bare = await netKey(env, fakeRequest(null, undefined));
    expect(bare).toHaveLength(NET_KEY_LENGTH);
    expect(bare).not.toBe(await netKey(env, fakeRequest('203.0.113.10', 5391)));
  });
  it('isNetKey rejects other shapes', () => {
    expect(isNetKey(null)).toBe(false);
    expect(isNetKey('short')).toBe(false);
    expect(isNetKey('x'.repeat(22) + '!')).toBe(false);
  });
});
