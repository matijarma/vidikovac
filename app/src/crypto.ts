// WebCrypto HMAC for the kiosk's challenge answer. Key and message are the
// secret and nonce STRINGS as received, UTF-8 encoded; output base64url without
// padding. The BeaconDO computes the same thing (Area B).
const encoder = new TextEncoder();

export async function hmacSha256(secret: string, message: string, subtle: SubtleCrypto = globalThis.crypto.subtle): Promise<Uint8Array> {
  const key = await subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await subtle.sign('HMAC', key, encoder.encode(message));
  return new Uint8Array(sig);
}

export function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function hmacSha256Base64Url(secret: string, message: string, subtle?: SubtleCrypto): Promise<string> {
  return toBase64Url(await hmacSha256(secret, message, subtle));
}
