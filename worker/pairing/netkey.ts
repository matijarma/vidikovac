// netKey = base64url(HMAC-SHA256(NET_KEY_SECRET, asn + '|' + addr)).slice(0, 22)
// where addr is the IPv4 address or the first 64 bits of the IPv6 address.
// IP addresses are personal data (CJEU Breyer): the raw values are read,
// hashed and dropped in this function; only the key travels further, and only
// in memory (a kiosk socket attachment, a scan comparison, a rate-limit key).
import type { Env } from '../env';
import { base64UrlEncode, hmacSha256, requireSecret } from './tokens';

export const NET_KEY_HEADER = 'X-Net-Key';
export const NET_KEY_LENGTH = 22;
const NET_KEY_SHAPE = /^[A-Za-z0-9_-]{22}$/;

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

export function addressPrefix(ip: string): string {
  const value = ip.trim();
  if (value.length === 0 || value.length > 64) return '';
  if (IPV4.test(value)) return value;
  if (!value.includes(':')) return '';
  // IPv4-mapped IPv6 (::ffff:a.b.c.d): the network is the IPv4 one.
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(value);
  if (mapped !== null) return IPV4.test(mapped[1]!) ? mapped[1]! : '';
  const hextets = expandIpv6(value);
  if (hextets === null) return '';
  return hextets.slice(0, 4).join(':');
}

/** Eight zero-padded lowercase hextets, or null when the text is not IPv6. */
function expandIpv6(value: string): string[] | null {
  const halves = value.toLowerCase().split('::');
  if (halves.length > 2) return null;
  const head = halves[0] === '' ? [] : halves[0]!.split(':');
  const tail = halves.length === 2 ? (halves[1] === '' ? [] : halves[1]!.split(':')) : [];
  const groups = [...head, ...tail];
  if (groups.length > 8 || (halves.length === 1 && groups.length !== 8)) return null;
  for (const group of groups) if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
  const missing = 8 - groups.length;
  const full = [...head, ...Array<string>(missing).fill('0'), ...tail];
  return full.map((g) => g.padStart(4, '0'));
}

export async function netKey(env: Env, request: Request): Promise<string> {
  const cf = (request as Request & { cf?: { asn?: unknown } }).cf;
  const asn = typeof cf?.asn === 'number' && Number.isFinite(cf.asn) ? String(cf.asn) : '0';
  const addr = addressPrefix(request.headers.get('CF-Connecting-IP') ?? '');
  const mac = await hmacSha256(requireSecret(env, 'NET_KEY_SECRET'), `${asn}|${addr}`);
  return base64UrlEncode(mac).slice(0, NET_KEY_LENGTH);
}

export function isNetKey(value: string | null): value is string {
  return typeof value === 'string' && NET_KEY_SHAPE.test(value);
}
