import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { beaconStub, type BeaconCreateInput } from '../../worker/do/beacon-do';
import { indexStub } from '../../worker/do/index-do';
import type { Env } from '../../worker/env';
import { metricsStub } from '../../worker/metrics';
import type { MetricsDailyRow } from '../../worker/metrics-do';
import { formatCode } from '../../worker/pairing/codes';
import { randomId } from '../../worker/pairing/tokens';
import { SCAN_MESSAGES } from '../../worker/routes/pairing';
import type { CodeSlot, ScanFail, ScanOk } from '../../worker/protocol';
import { authKiosk, Inbox, type Conn } from './helpers';

const testEnv = env as unknown as Env;
const ROOM_ID_RE = /^[0-9A-HJKMNP-TV-Z]{16}$/;
const TICKET_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

/**
 * Connects to a beacon's kiosk socket through the real `/ws/beacon/:id` HTTP
 * route this task wires up. helpers.ts's own `connectWs` deliberately reaches
 * BeaconDO directly through its stub instead (see that file's R-41 comment,
 * which anticipates this task adding "its own helper alongside this one" for
 * the real HTTP upgrade) and takes a beaconId and a net key rather than a
 * path and an address, so it cannot exercise the route under test here.
 */
async function connectWs(path: string, ip: string): Promise<Conn> {
  const response = await SELF.fetch(`https://vidikovac.test${path}`, {
    headers: { Upgrade: 'websocket', 'CF-Connecting-IP': ip },
  });
  if (response.status !== 101) throw new Error(`expected 101, got ${response.status} ${await response.text()}`);
  const ws = response.webSocket;
  if (!ws) throw new Error('expected a webSocket on the 101 response');
  ws.accept();
  return { ws, inbox: new Inbox(ws) };
}

/** A provisioned screen with its kiosk socket authenticated and a live batch of codes. */
async function onlineKiosk(kioskIp: string): Promise<{ beaconId: string; kiosk: Conn; batch: CodeSlot[] }> {
  const beaconId = randomId(5);
  const secret = randomId(20);
  const input: BeaconCreateInput = {
    beaconId,
    venueType: 'kafic',
    area: 'donji-grad',
    operatorLabel: 'Kavana Velebit',
    stopId: null,
    secret,
  };
  expect(await beaconStub(testEnv, beaconId).create(input)).toEqual({ created: true });
  await indexStub(testEnv).registerBeacon({ ...input, createdAt: Date.now() });
  const kiosk = await connectWs(`/ws/beacon/${beaconId}`, kioskIp);
  const codes = await authKiosk(kiosk, secret);
  return { beaconId, kiosk, batch: codes.batch as CodeSlot[] };
}

function scan(body: unknown, ip: string, headers: Record<string, string> = {}): Promise<Response> {
  return SELF.fetch('https://vidikovac.test/api/scan', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'CF-Connecting-IP': ip, ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

/** Counters are written fire-and-forget, so poll instead of guessing a delay. */
async function waitForRow(match: (row: MetricsDailyRow) => boolean): Promise<MetricsDailyRow> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const rows = await metricsStub(testEnv).query('2020-01-01');
    const found = rows.find(match);
    if (found !== undefined) return found;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('counter row never appeared');
}

describe('POST /api/scan', () => {
  it('redeems a live code, answers ScanOk and pushes unlocked to the screen', async () => {
    const { kiosk, batch } = await onlineKiosk('203.0.113.10');
    const response = await scan({ code: formatCode(batch[0]!.code) }, '198.51.100.20');
    expect(response.status).toBe(200);
    const ok = (await response.json()) as ScanOk;
    expect(ok).toMatchObject({
      beaconType: 'kiosk',
      venueType: 'kafic',
      area: 'Donji grad',
      screenLabel: 'Kavana Velebit',
      participants: 0,
    });
    expect(ok.roomId).toMatch(ROOM_ID_RE);
    expect(ok.ticket).toMatch(TICKET_RE);
    expect(ok.expiresAt).toBeGreaterThan(Date.now() + 9 * 60_000);
    const unlocked = await kiosk.inbox.nextOfType('unlocked');
    expect(unlocked.roomId).toBe(ok.roomId);
    expect(unlocked.ticket).not.toBe(ok.ticket);
    expect(await waitForRow((row) => row.event === 'session_start' && row.dim1 === 'kiosk' && row.dim2 === 'donji-grad')).toBeDefined();
  });

  it('accepts the typed lowercase form and refuses the same code twice', async () => {
    // batch[0] is the current 30 s rotation slot, open the instant the kiosk
    // authenticates; batch[1] is the NEXT slot and is still 'early' by
    // codeWindow() at this point in the test, so it must not be used here.
    const { batch } = await onlineKiosk('203.0.113.11');
    const first = await scan({ code: formatCode(batch[0]!.code).toLowerCase() }, '198.51.100.21');
    expect(first.status).toBe(200);
    const again = await scan({ code: batch[0]!.code }, '198.51.100.22');
    expect(again.status).toBe(409);
    expect((await again.json()) as ScanFail).toEqual({ error: 'code-used', message: SCAN_MESSAGES['code-used'] });
  });

  it('answers code-unknown for a well-formed code nobody minted and counts the failure', async () => {
    const response = await scan({ code: 'ZZZZZZZZ' }, '198.51.100.23');
    expect(response.status).toBe(404);
    expect((await response.json()) as ScanFail).toEqual({ error: 'code-unknown', message: SCAN_MESSAGES['code-unknown'] });
    expect(await waitForRow((row) => row.event === 'scan_fail' && row.dim1 === 'code-unknown')).toBeDefined();
  });

  it('answers bad-request for junk, for a missing code and for a body over 64 bytes', async () => {
    expect((await scan('not json', '198.51.100.24')).status).toBe(400);
    expect((await scan({ nope: 1 }, '198.51.100.25')).status).toBe(400);
    expect((await scan({ code: 'AB' }, '198.51.100.26')).status).toBe(400);
    const oversize = await scan({ code: 'ABCD-EFGH', padding: 'x'.repeat(80) }, '198.51.100.27');
    expect(oversize.status).toBe(400);
    expect(((await oversize.json()) as ScanFail).message).toBe(SCAN_MESSAGES['bad-request']);
  });

  it('refuses another method and a cross-origin post', async () => {
    const wrongMethod = await SELF.fetch('https://vidikovac.test/api/scan', { method: 'GET' });
    expect(wrongMethod.status).toBe(405);
    const crossOrigin = await scan({ code: 'ZZZZZZZZ' }, '198.51.100.28', { Origin: 'https://zlonamjerni.example' });
    expect(crossOrigin.status).toBe(403);
    const sameOrigin = await scan({ code: 'ZZZZZZZZ' }, '198.51.100.29', { Origin: 'https://vidikovac.test' });
    expect(sameOrigin.status).toBe(404);
  });

  it('rate-limits one address with RL_SCAN', async () => {
    const ip = '203.0.113.99';
    const first = await scan({ code: 'ZZZZZZZZ' }, ip);
    expect(first.status).toBe(404);
    let limited: Response | null = null;
    for (let attempt = 0; attempt < 24 && limited === null; attempt += 1) {
      const response = await scan({ code: 'ZZZZZZZZ' }, ip);
      if (response.status === 429) limited = response;
      else await response.body?.cancel();
    }
    expect(limited, 'RL_SCAN (10 per 60 s) never refused 25 scans from one address').not.toBeNull();
    expect((await limited!.json()) as ScanFail).toEqual({ error: 'rate-limited', message: SCAN_MESSAGES['rate-limited'] });
  });

  it('keeps the same-network sentence exactly as the spec writes it', () => {
    expect(SCAN_MESSAGES['same-network']).toBe(
      'Ovaj kod trenutačno nije moguće iskoristiti s ove veze. Skeniraj ponovno.',
    );
  });
});
