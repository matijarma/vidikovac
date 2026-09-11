// Shared helpers for Area B's workers-pool tests (R-12: test/pairing/** is
// Area B's test directory). The Inbox idiom is psdlat's
// worker/test/mesh-do.test.ts.
import { env } from 'cloudflare:test';
import { expect } from 'vitest';
import { beaconStub, type BeaconCreateInput } from '../../worker/do/beacon-do';
import { indexStub } from '../../worker/do/index-do';
import { roomStub } from '../../worker/do/room-do';
import type { Env } from '../../worker/env';
import type { MetricsDailyRow, MetricsDO } from '../../worker/metrics-do';
import { NET_KEY_HEADER } from '../../worker/pairing/netkey';
import { base64UrlEncode, hmacSha256, randomId } from '../../worker/pairing/tokens';
import type { CodeSlot } from '../../worker/protocol';

const EPOCH_DAY = '2020-01-01';
const testEnv = (): Env => env as unknown as Env;

/**
 * Polls MetricsDO until predicate(rows) is true or timeoutMs elapses (R-31).
 * `recordMetric` is void and fire-and-forget (R-29): a caller has no promise
 * to await, so a test observes the resulting row this way instead of a fixed
 * setTimeout or an immediate read that may race the write.
 *
 * Named `waitForRows` (plural: the predicate sees the whole row list) to
 * leave `waitForRow` free for B7's single-row variant below — same polling
 * idiom, different granularity, so both live under names that say which.
 */
export async function waitForRows(
  stub: DurableObjectStub<MetricsDO>,
  predicate: (rows: MetricsDailyRow[]) => boolean,
  timeoutMs = 1000,
): Promise<MetricsDailyRow[]> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const rows = await stub.query(EPOCH_DAY);
    if (predicate(rows)) return rows;
    if (Date.now() >= deadline) throw new Error(`waitForRows: timed out after ${timeoutMs}ms`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

// --- WebSocket client helpers -----------------------------------------------
//
// R-41 pins how a Beacon test reaches the socket: directly through the
// Durable Object's own stub (`env.BEACON_DO.get(id).fetch(...)`), never
// through SELF's `/ws/beacon/:id` — that HTTP route is wired by task B8, so a
// SELF fetch would 404 today. `connectWs` therefore takes a beaconId and a
// net key rather than a path and an IP; a later task that needs the real
// HTTP upgrade (once routing exists) adds its own helper alongside this one.

export type Frame = Record<string, unknown>;

export class Inbox {
  private messages: string[] = [];
  private resolvers: Array<(m: string) => void> = [];
  closeCode: number | null = null;
  closeReason = '';
  private closed = false;
  private closeWaiters: Array<() => void> = [];

  constructor(ws: WebSocket) {
    ws.addEventListener('message', (event: MessageEvent) => {
      const data = typeof event.data === 'string' ? event.data : '';
      const next = this.resolvers.shift();
      if (next) next(data);
      else this.messages.push(data);
    });
    ws.addEventListener('close', (event: CloseEvent) => {
      this.closeCode = event.code;
      this.closeReason = event.reason;
      this.closed = true;
      for (const w of this.closeWaiters) w();
      this.closeWaiters = [];
    });
  }

  private nextRaw(timeoutMs: number): Promise<string> {
    const buffered = this.messages.shift();
    if (buffered !== undefined) return Promise.resolve(buffered);
    return new Promise((resolve, reject) => {
      const resolver = (value: string): void => {
        clearTimeout(timer);
        resolve(value);
      };
      const timer = setTimeout(() => {
        const idx = this.resolvers.indexOf(resolver);
        if (idx !== -1) this.resolvers.splice(idx, 1);
        reject(new Error('inbox timeout'));
      }, timeoutMs);
      this.resolvers.push(resolver);
    });
  }

  async nextWhere(pred: (f: Frame) => boolean, timeoutMs = 2000): Promise<Frame> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error('timeout waiting for matching frame');
      const obj = JSON.parse(await this.nextRaw(remaining)) as Frame;
      if (pred(obj)) return obj;
    }
  }

  nextOfType(t: string, timeoutMs = 2000): Promise<Frame> {
    return this.nextWhere((f) => f.t === t, timeoutMs);
  }

  async expectSilence(ms = 300): Promise<void> {
    await expect(this.nextRaw(ms)).rejects.toThrow('inbox timeout');
  }

  waitClose(timeoutMs = 2000): Promise<void> {
    if (this.closed) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('close timeout')), timeoutMs);
      this.closeWaiters.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
}

export interface Conn {
  ws: WebSocket;
  inbox: Inbox;
}

/** Connects directly to a beacon's kiosk socket through its Durable Object stub (R-41). */
export async function connectWs(beaconId: string, netKey: string): Promise<Conn> {
  const stub = beaconStub(testEnv(), beaconId);
  const response = await stub.fetch('https://beacon/ws', {
    headers: { Upgrade: 'websocket', [NET_KEY_HEADER]: netKey },
  });
  if (response.status !== 101) throw new Error(`expected 101, got ${response.status} ${await response.text()}`);
  const ws = response.webSocket;
  if (!ws) throw new Error('expected a webSocket on the 101 response');
  ws.accept();
  return { ws, inbox: new Inbox(ws) };
}

/**
 * The kiosk side of the challenge: HMAC over the nonce with the raw
 * provisioning secret as the key — protocol.ts's BEACON_AUTH: hmac =
 * base64url_unpadded(HMAC-SHA256(key = utf8(secret), message = utf8(nonce))),
 * no pre-hashing of the secret (rulings.md R-32). BeaconDO stores this same
 * raw secret (`BeaconCreateInput.secret`) so both sides key the HMAC
 * identically. `hmacSha256` accepts a string key/message and utf8-encodes it
 * internally.
 */
export async function kioskAnswer(secret: string, nonce: string): Promise<string> {
  return base64UrlEncode(await hmacSha256(secret, nonce));
}

export async function authKiosk(conn: Conn, secret: string): Promise<Frame> {
  const challenge = await conn.inbox.nextOfType('challenge');
  conn.ws.send(JSON.stringify({ t: 'auth', hmac: await kioskAnswer(secret, String(challenge.nonce)) }));
  return conn.inbox.nextOfType('codes');
}

// --- Provisioning helpers (R-31: live once here for every Area B test) -----

/** Any 22-char net-key-shaped string works for BeaconDO; the kiosk's own connection uses this one. */
export const KIOSK_NET_KEY = 'K'.repeat(22);

/**
 * `area` defaults to 'donji-grad'. METRICS_DO and INDEX_DO are singletons
 * whose storage is isolated per test *file*, not per `it()` (proven by the
 * existing metrics-do.workers.test.ts, whose tests each use a distinct dim
 * for exactly this reason) — a test asserting an *exact* metrics count for
 * an area must provision with an area no other test in the file touches.
 */
export async function provision(area = 'donji-grad'): Promise<{ beaconId: string; secret: string }> {
  const beaconId = randomId(5);
  const secret = randomId(20);
  const input: BeaconCreateInput = {
    beaconId,
    venueType: 'kafic',
    area,
    operatorLabel: 'Kavana Velebit',
    stopId: null,
    secret,
  };
  expect(await beaconStub(testEnv(), beaconId).create(input)).toEqual({ created: true });
  await indexStub(testEnv()).registerBeacon({ ...input, createdAt: Date.now() });
  return { beaconId, secret };
}

export async function onlineKiosk(area = 'donji-grad'): Promise<{ beaconId: string; secret: string; kiosk: Conn; batch: CodeSlot[] }> {
  const { beaconId, secret } = await provision(area);
  const kiosk = await connectWs(beaconId, KIOSK_NET_KEY);
  const codes = await authKiosk(kiosk, secret);
  return { beaconId, secret, kiosk, batch: codes.batch as CodeSlot[] };
}

// --- added in B7 -----------------------------------------------------------

/**
 * A room socket opened straight against the Durable Object. The `/ws/room/:id`
 * route arrives in B8; the object's own `fetch` is the contract under test
 * here, and it answers the same 101 the Worker forwards.
 */
export async function connectRoom(roomId: string): Promise<Conn> {
  const response = await roomStub(testEnv(), roomId).fetch('https://room.do/ws', {
    headers: { Upgrade: 'websocket' },
  });
  if (response.status !== 101) throw new Error(`expected 101, got ${response.status} ${await response.text()}`);
  const ws = response.webSocket;
  if (!ws) throw new Error('expected a webSocket on the 101 response');
  ws.accept();
  return { ws, inbox: new Inbox(ws) };
}

/**
 * R-31: counters are written fire-and-forget, so a test polls for the single
 * row it expects instead of sleeping a guessed number of milliseconds.
 * Single-row counterpart to {@link waitForRows} above (whole-list predicate);
 * this one hands the caller the one row that matched.
 */
export async function waitForRow(
  stub: DurableObjectStub<MetricsDO>,
  predicate: (row: MetricsDailyRow) => boolean,
  timeoutMs = 3000,
): Promise<MetricsDailyRow> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const rows = await stub.query(EPOCH_DAY);
    const found = rows.find(predicate);
    if (found !== undefined) return found;
    if (Date.now() >= deadline) throw new Error('waitForRow: no metrics row matched the predicate within the timeout');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
