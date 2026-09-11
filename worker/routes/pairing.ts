// worker/routes/pairing.ts
// The three public pairing endpoints. This module is the only place in the
// system that reads a visitor's address: it turns it into a netKey
// (worker/pairing/netkey.ts) and hands that to the Durable Objects, which
// never see request.cf, CF-Connecting-IP or a user agent. Nothing here is
// stored; the code, the address and the key live for one request.
import { beaconStub, BEACON_ID_SHAPE } from '../do/beacon-do';
import { indexStub } from '../do/index-do';
import { roomStub, ROOM_ID_SHAPE } from '../do/room-do';
import type { Env, RateLimiter } from '../env';
import { clientIp, json } from '../http';
import type { RouteHandler } from '../index';
import { logError } from '../log';
import { recordMetric } from '../metrics';
import { normalizeCode } from '../pairing/codes';
import { NET_KEY_HEADER, netKey } from '../pairing/netkey';
import { SCAN_MESSAGES_HR, type ScanError, type ScanFail, type ScanOk, type ScanRequest } from '../protocol';

/** `{"code":"ABCD-EFGH"}` is 22 bytes; 64 is generous and bounds the read. */
export const SCAN_BODY_MAX_BYTES = 64;

/**
 * Croatian, singular imperative, safe to render as text. `SCAN_MESSAGES_HR`
 * in protocol.ts is the single source for this text (its own header: shared
 * with app/src/i18n/hr.json's scan.errors.*, which a test asserts equal) —
 * this is a straight alias of that record, not a second, hand-typed copy
 * that could drift from it.
 */
export const SCAN_MESSAGES: Record<ScanError, string> = SCAN_MESSAGES_HR;

/** Every scan failure is a 4xx, so the phone reads ScanFail from the body in one branch. */
export const SCAN_STATUS: Record<ScanError, number> = {
  'bad-request': 400,
  'code-unknown': 404,
  'code-expired': 410,
  'code-used': 409,
  'screen-offline': 409,
  'same-network': 403,
  'slow-down': 429,
  'rate-limited': 429,
  revoked: 410,
};

/**
 * A browser attaches Origin to every cross-origin POST and to the WebSocket
 * handshake. A request without one is not a browser (a native app, curl, a
 * test) and cannot be a cross-site forgery, so absence is allowed.
 */
export function isSameOrigin(request: Request, url: URL): boolean {
  const origin = request.headers.get('Origin');
  return origin === null || origin === url.origin;
}

/**
 * Reads at most `maxBytes` and returns null the moment the body is longer. A
 * declared content-length over the cap is refused before a chunk is buffered.
 */
export async function readCappedBody(request: Request, maxBytes: number): Promise<string | null> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  const body = request.body as ReadableStream<Uint8Array> | null;
  if (body === null) return '';
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value === undefined) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(joined);
}

function scanFail(error: ScanError): Response {
  const body: ScanFail = { error, message: SCAN_MESSAGES[error] };
  return json(body, SCAN_STATUS[error]);
}

/** Fails open: a limiter that cannot answer must not close the door on real visitors. */
async function overLimit(limiter: RateLimiter | undefined, key: string): Promise<boolean> {
  if (limiter === undefined) return false;
  try {
    const { success } = await limiter.limit({ key });
    return !success;
  } catch (error) {
    logError('rate-limit-failed', error);
    return false;
  }
}

/**
 * `recordMetric` is void and fire-and-forget by design (worker/metrics.ts:
 * "never awaited or passed to ctx.waitUntil by a caller") — the same
 * un-wrapped call worker/hitno/route.ts already makes from its own top-level
 * route handler. `ctx` stays in this handler's signature only because
 * `RouteHandler` requires it.
 */
async function handleScan(request: Request, env: Env, _ctx: ExecutionContext, url: URL): Promise<Response> {
  if (!isSameOrigin(request, url)) return json({ error: 'forbidden' }, 403);
  if (request.method !== 'POST') return json({ error: 'method-not-allowed' }, 405, { allow: 'POST' });
  // The key is the address itself and never leaves this line: not logged, not stored.
  if (await overLimit(env.RL_SCAN, clientIp(request) || 'no-ip')) {
    recordMetric(env, 'scan_fail', 'rate-limited');
    return scanFail('rate-limited');
  }

  const raw = await readCappedBody(request, SCAN_BODY_MAX_BYTES);
  let code: string | null = null;
  if (raw !== null) {
    try {
      const parsed = JSON.parse(raw) as Partial<ScanRequest>;
      code = typeof parsed?.code === 'string' ? normalizeCode(parsed.code) : null;
    } catch {
      code = null;
    }
  }
  if (code === null) {
    recordMetric(env, 'scan_fail', 'bad-request');
    return scanFail('bad-request');
  }

  const scannerNetKey = await netKey(env, request);
  const owner = await indexStub(env).resolve(code);
  if (owner === null) {
    recordMetric(env, 'scan_fail', 'code-unknown');
    return scanFail('code-unknown');
  }
  const result =
    owner.kind === 'kiosk'
      ? await beaconStub(env, owner.ownerId).redeem(code, scannerNetKey)
      : await roomStub(env, owner.ownerId).redeemPeer(code);
  if (!result.ok) {
    recordMetric(env, 'scan_fail', result.error, owner.kind);
    return scanFail(result.error);
  }
  const ok: ScanOk = result.scan;
  return json(ok, 200);
}

interface Upgradable {
  fetch(request: Request): Promise<Response>;
}

function upgradeGuard(request: Request, url: URL): Response | null {
  if (!isSameOrigin(request, url)) return json({ error: 'forbidden' }, 403);
  if (request.method !== 'GET') return json({ error: 'method-not-allowed' }, 405, { allow: 'GET' });
  if ((request.headers.get('Upgrade') ?? '').toLowerCase() !== 'websocket') {
    return json({ error: 'upgrade-required' }, 426, { upgrade: 'websocket' });
  }
  return null;
}

/** Hands the handshake to the Durable Object with the one header it cannot compute itself. */
async function upgradeTo(stub: Upgradable, request: Request, env: Env): Promise<Response> {
  const headers = new Headers(request.headers);
  // Whatever the client sent under this name is discarded: only the Worker mints net keys.
  headers.set(NET_KEY_HEADER, await netKey(env, request));
  headers.set('Upgrade', 'websocket');
  return stub.fetch(new Request(request.url, { method: 'GET', headers }));
}

const BEACON_PATH = /^\/ws\/beacon\/([^/]+)$/;
const ROOM_PATH = /^\/ws\/room\/([^/]+)$/;

export const handlePairing: RouteHandler = async (request, env, ctx, url) => {
  try {
    if (url.pathname === '/api/scan') return await handleScan(request, env, ctx, url);

    const beacon = BEACON_PATH.exec(url.pathname);
    if (beacon !== null) {
      const beaconId = beacon[1]!;
      if (!BEACON_ID_SHAPE.test(beaconId)) return json({ error: 'not-found' }, 404);
      const refusal = upgradeGuard(request, url);
      if (refusal !== null) return refusal;
      return await upgradeTo(beaconStub(env, beaconId), request, env);
    }

    const room = ROOM_PATH.exec(url.pathname);
    if (room !== null) {
      const roomId = room[1]!;
      if (!ROOM_ID_SHAPE.test(roomId)) return json({ error: 'not-found' }, 404);
      const refusal = upgradeGuard(request, url);
      if (refusal !== null) return refusal;
      return await upgradeTo(roomStub(env, roomId), request, env);
    }

    return null;
  } catch (error) {
    logError('pairing-route-failed', error, { path: url.pathname });
    return json({ error: 'internal' }, 500);
  }
};
