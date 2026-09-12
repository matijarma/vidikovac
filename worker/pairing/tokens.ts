// Byte helpers, WebCrypto HMAC, stateless data tokens and random ids. Runs in
// workerd, browsers and Node without Buffer.
import type { Env } from '../env';
import { CODE_ALPHABET } from '../protocol';

const ENCODER = new TextEncoder();
const DECODER = new TextDecoder();

export function utf8(text: string): Uint8Array {
  return ENCODER.encode(text);
}

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlDecode(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) return null;
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  try {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

export function hexEncode(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}

export function hexDecode(hex: string): Uint8Array | null {
  if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

/** Length-safe, data-independent comparison; no `crypto.subtle.timingSafeEqual` because Node lacks it. */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

export async function sha256(data: string | Uint8Array): Promise<Uint8Array> {
  const bytes = typeof data === 'string' ? utf8(data) : data;
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource));
}

const hmacKeys = new Map<string, Promise<CryptoKey>>();

function hmacKey(secret: string | Uint8Array): Promise<CryptoKey> {
  const raw = typeof secret === 'string' ? utf8(secret) : secret;
  const cacheKey = typeof secret === 'string' ? `s:${secret}` : `b:${hexEncode(secret)}`;
  let pending = hmacKeys.get(cacheKey);
  if (!pending) {
    pending = crypto.subtle.importKey('raw', raw as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    hmacKeys.set(cacheKey, pending);
    if (hmacKeys.size > 16) hmacKeys.delete(hmacKeys.keys().next().value!);
  }
  return pending;
}

export async function hmacSha256(secretKey: string | Uint8Array, message: string | Uint8Array): Promise<Uint8Array> {
  const key = await hmacKey(secretKey);
  const data = typeof message === 'string' ? utf8(message) : message;
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, data as BufferSource));
}

export type SecretName = 'SESSION_SECRET' | 'NET_KEY_SECRET';

/**
 * Every environment must configure signing keys explicitly. Changing pairing
 * policy can never enable a known development key.
 */
export function requireSecret(env: Env, name: SecretName): string {
  const value = env[name];
  if (typeof value === 'string' && value.length >= 16) return value;
  throw new Error(`${name} is not configured (set it with: wrangler secret put ${name}); refusing to run with a default`);
}

function tokenMessage(roomId: string, expiresAt: number): string {
  return `${roomId}|${expiresAt}`;
}

export async function signDataToken(env: Env, roomId: string, expiresAt: number): Promise<string> {
  if (!Number.isInteger(expiresAt) || expiresAt <= 0) throw new Error('signDataToken: expiresAt must be a positive integer (ms)');
  const mac = await hmacSha256(requireSecret(env, 'SESSION_SECRET'), tokenMessage(roomId, expiresAt));
  return `${base64UrlEncode(utf8(roomId))}.${expiresAt}.${base64UrlEncode(mac)}`;
}

export async function verifyDataToken(env: Env, token: string): Promise<{ roomId: string; expiresAt: number } | null> {
  try {
    if (typeof token !== 'string' || token.length > 256) return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [roomPart, expPart, macPart] = parts as [string, string, string];
    if (!/^\d{1,16}$/.test(expPart)) return null;
    const expiresAt = Number(expPart);
    const roomBytes = base64UrlDecode(roomPart);
    const mac = base64UrlDecode(macPart);
    if (roomBytes === null || mac === null || roomBytes.length === 0 || mac.length !== 32) return null;
    const roomId = DECODER.decode(roomBytes);
    const expected = await hmacSha256(requireSecret(env, 'SESSION_SECRET'), tokenMessage(roomId, expiresAt));
    if (!constantTimeEqual(expected, mac)) return null;
    if (Date.now() >= expiresAt) return null;
    return { roomId, expiresAt };
  } catch {
    return null;
  }
}

export function randomBytes(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n));
}

/** `bytes` random bytes as Crockford base32 with full 5-bit packing (no bias, no entropy loss). */
export function randomId(bytes: number): string {
  if (!Number.isInteger(bytes) || bytes <= 0) throw new Error('randomId: bytes must be a positive integer');
  const data = randomBytes(bytes);
  let out = '';
  let buffer = 0;
  let bits = 0;
  for (const byte of data) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += CODE_ALPHABET[(buffer >>> (bits - 5)) & 31];
      bits -= 5;
    }
    buffer &= (1 << bits) - 1;
  }
  if (bits > 0) out += CODE_ALPHABET[(buffer << (5 - bits)) & 31];
  return out;
}
