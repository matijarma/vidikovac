// DEV mode's Worker side (worker/routes/dev.ts): the network's DEV screen for the day, a session
// on it without a code (a day long, renewed on use and while held), the wall shown in several tabs
// at once, the four pages the /dev/ grid frames, and /hitno with the chip. What DEV counts is
// test/pairing/dev-metrics.workers.test.ts.
import { SELF, createExecutionContext, env, runInDurableObject, waitOnExecutionContext } from 'cloudflare:test';
import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../../worker/env';
import { beaconStub, type BeaconDO } from '../../worker/do/beacon-do';
import { indexStub, type IndexDO } from '../../worker/do/index-do';
import { DEV_RENEW_MS, DEV_SESSION_MS, WARN_60_MS, roomStub, type RoomDO } from '../../worker/do/room-do';
import type { ModuleSnapshot } from '../../worker/feed/schema';
import type { CodeSlot, CreateBeaconResponse, ScanOk } from '../../worker/protocol';
import { FRAMED_PAGES, devCredentials, handleDev } from '../../worker/routes/dev';
import { handleOpen } from '../../worker/routes/open';
import { APP_CSP, HITNO_SECURITY_HEADERS } from '../../worker/security-headers';
import { connectWs, kioskAnswer, type Conn } from './helpers';

const testEnv = env as unknown as Env;
const HOUR = 60 * 60_000;

const post = (path: string, ip: string, headers: Record<string, string> = {}) =>
  SELF.fetch(`https://vidikovac.test${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'CF-Connecting-IP': ip, ...headers }, body: '{}' });

async function devScreenFor(ip: string): Promise<CreateBeaconResponse> {
  const response = await post('/api/dev/screen', ip);
  expect(response.status).toBe(200);
  return await response.json<CreateBeaconResponse>();
}

async function devSessionFor(ip: string): Promise<ScanOk> {
  const response = await post('/api/dev/session', ip);
  expect(response.status).toBe(201);
  return await response.json<ScanOk>();
}

/** A wall's socket as the kiosk opens it: presentation version 1, so a normal screen would replace an older one. */
async function wall(beaconId: string, secret: string, ip: string): Promise<Conn & { batch: CodeSlot[] }> {
  const conn = await connectWs(`/ws/beacon/${beaconId}`, ip);
  const challenge = await conn.inbox.nextOfType('challenge');
  conn.ws.send(JSON.stringify({ t: 'auth', hmac: await kioskAnswer(secret, String(challenge.nonce)), presentationVersion: 1, capabilities: ['city-v1', 'place-v2'] }));
  const codes = await conn.inbox.nextOfType('codes');
  return { ...conn, batch: codes.batch as CodeSlot[] };
}

describe('the DEV screen: one per network per Zagreb day', () => {
  it('is created by the first call and is the same screen on every later one, at the default place, marked dev', async () => {
    const first = await devScreenFor('203.0.113.10');
    const again = await devScreenFor('203.0.113.10');
    expect(again.beaconId).toBe(first.beaconId);
    expect(again.secret).toBe(first.secret);
    expect(first.screen).toMatchObject({ kind: 'temporary', stop: null, area: 'zagreb', placeSet: false, frame: 4, dev: true });
    expect(first.screen!.expiresAt).toBeGreaterThan(Date.now() + 23 * HOUR);
    expect(first.provisionUrl).toBe(`https://vidikovac.test/kiosk/?DEV#${first.beaconId}.${first.secret}`);
    // Another network has its own.
    expect((await devScreenFor('203.0.113.99')).beaconId).not.toBe(first.beaconId);
  });

  it('is derived from the network and the day: another day is another screen', async () => {
    const today = await devCredentials(testEnv, 'a'.repeat(64), '2026-09-30');
    expect(await devCredentials(testEnv, 'a'.repeat(64), '2026-09-30')).toEqual(today);
    expect((await devCredentials(testEnv, 'a'.repeat(64), '2026-10-01')).beaconId).not.toBe(today.beaconId);
    expect(today.beaconId).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/);
    expect(today.secret).toMatch(/^[0-9A-HJKMNP-TV-Z]{32}$/);
  });

  it('never enters the operator registry or the five-per-hour creation quota', async () => {
    const screen = await devScreenFor('203.0.113.11');
    for (let i = 0; i < 6; i += 1) await devScreenFor('203.0.113.11');
    await runInDurableObject(indexStub(testEnv), (instance: IndexDO, state) => {
      expect(instance.listBeacons().map((b) => b.beaconId)).not.toContain(screen.beaconId);
      expect(state.storage.sql.exec('SELECT COUNT(*) AS n FROM screen_creations').one().n).toBe(0);
    });
  });

  it('answers POST only, from its own origin', async () => {
    expect((await SELF.fetch('https://vidikovac.test/api/dev/screen')).status).toBe(405);
    expect((await post('/api/dev/session', '203.0.113.12', { Origin: 'https://elsewhere.example' })).status).toBe(403);
  });

  it('is shown in as many tabs as are open: a second wall does not replace the first', async () => {
    const screen = await devScreenFor('203.0.113.13');
    const one = await wall(screen.beaconId, screen.secret, '203.0.113.13');
    const two = await wall(screen.beaconId, screen.secret, '203.0.113.13');
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(one.inbox.closeCode).toBeNull();
    one.ws.close(1000, 'done');
    two.ws.close(1000, 'done');
  });

  it('a code from the DEV wall opens a DEV session of a day, with the QR screen still marked dev', async () => {
    const screen = await devScreenFor('203.0.113.14');
    const kiosk = await wall(screen.beaconId, screen.secret, '203.0.113.14');
    const response = await post('/api/scan', '203.0.113.14');
    expect(response.status).toBe(400);
    const scan = await SELF.fetch('https://vidikovac.test/api/scan', {
      method: 'POST', headers: { 'content-type': 'application/json', 'CF-Connecting-IP': '203.0.113.14' }, body: JSON.stringify({ code: kiosk.batch[0]!.code }),
    });
    expect(scan.status).toBe(200);
    const grant = await scan.json<ScanOk>();
    expect(grant.screen?.dev).toBe(true);
    expect(grant.expiresAt).toBeGreaterThan(Date.now() + DEV_SESSION_MS - 60_000);
    expect((await kiosk.inbox.nextOfType('paired')).expiresAt).toBe(grant.expiresAt);
    kiosk.ws.close(1000, 'done');
  });
});

describe('the DEV session: no code, a day long, renewed on use and while held', () => {
  it('opens without a code and without a wall online, bound to the DEV screen', async () => {
    const screen = await devScreenFor('203.0.113.20');
    const grant = await devSessionFor('203.0.113.20');
    expect(grant).toMatchObject({ beaconType: 'kiosk', venueType: 'ostalo', area: 'Zagreb', screenLabel: 'Kaj ima? · Zagreb' });
    expect(grant.screen).toEqual(screen.screen);
    expect(grant.expiresAt).toBeGreaterThan(Date.now() + DEV_SESSION_MS - 60_000);
    const viewer = await connectWs(`/ws/room/${grant.roomId}`, '203.0.113.20');
    viewer.ws.send(JSON.stringify({ t: 'join', ticket: grant.ticket }));
    const joined = await viewer.inbox.nextOfType('joined');
    expect(joined.role).toBe('scanner');
    expect(joined.expiresAt as number).toBeGreaterThanOrEqual(grant.expiresAt);
    expect(typeof joined.dataToken).toBe('string');
    viewer.ws.close(1000, 'done');
  });

  it('a resume renews the day, and so does the room itself while a socket holds it; the screen grant follows', async () => {
    const screen = await devScreenFor('203.0.113.21');
    const grant = await devSessionFor('203.0.113.21');
    const first = await connectWs(`/ws/room/${grant.roomId}`, '203.0.113.21');
    first.ws.send(JSON.stringify({ t: 'join', ticket: grant.ticket }));
    const joined = await first.inbox.nextOfType('joined');
    const stub = roomStub(testEnv, grant.roomId);
    // An hour on, the same person resumes: the day starts again from then.
    const later = Date.now() + HOUR;
    await runInDurableObject(stub, (instance: RoomDO) => { vi.spyOn(instance, 'now').mockReturnValue(later); });
    const second = await connectWs(`/ws/room/${grant.roomId}`, '203.0.113.21');
    second.ws.send(JSON.stringify({ t: 'resume', resumeToken: joined.resumeToken }));
    const resumed = await second.inbox.nextOfType('joined');
    expect(resumed.expiresAt).toBe(later + DEV_SESSION_MS);
    // The room's own renewal point, with the socket still there: a fresh 'joined' and no warning.
    const renewAt = later + DEV_SESSION_MS - DEV_RENEW_MS + 1_000;
    await runInDurableObject(stub, (instance: RoomDO) => { vi.spyOn(instance, 'now').mockReturnValue(renewAt); });
    await runInDurableObject(stub, (instance: RoomDO) => instance.alarm());
    const renewed = await second.inbox.nextWhere((f) => f.t === 'joined' || f.t === 'expiring');
    expect(renewed.t).toBe('joined');
    expect(renewed.expiresAt).toBe(renewAt + DEV_SESSION_MS);
    expect(await runInDurableObject(stub, (_i: RoomDO, state) => state.storage.getAlarm())).toBe(renewAt + DEV_SESSION_MS - DEV_RENEW_MS);
    // The DEV screen's grant to present follows the room (BeaconDO.renewBinding, through waitUntil).
    await vi.waitFor(async () => {
      const binding = await runInDurableObject(beaconStub(testEnv, screen.beaconId), (_i: BeaconDO, state) =>
        state.storage.sql.exec('SELECT expires_at FROM presentation_rooms WHERE room_id = ?', grant.roomId).one().expires_at);
      expect(binding).toBe(renewAt + DEV_SESSION_MS);
    });
    second.ws.close(1000, 'done');
  });

  it('a room nobody holds runs out like any other at the end of its day', async () => {
    const grant = await devSessionFor('203.0.113.22');
    const stub = roomStub(testEnv, grant.roomId);
    await runInDurableObject(stub, (instance: RoomDO) => { vi.spyOn(instance, 'now').mockReturnValue(grant.expiresAt - DEV_RENEW_MS + 1_000); });
    await runInDurableObject(stub, (instance: RoomDO) => instance.alarm());
    expect(await runInDurableObject(stub, (_i: RoomDO, state) => state.storage.getAlarm())).toBe(grant.expiresAt - WARN_60_MS);
    await runInDurableObject(stub, (instance: RoomDO) => { vi.spyOn(instance, 'now').mockReturnValue(grant.expiresAt); });
    await runInDurableObject(stub, (instance: RoomDO) => instance.alarm());
    expect(await runInDurableObject(stub, (instance: RoomDO) => instance.phase())).toBe('none');
  });
});

describe('the pages the /dev/ grid frames', () => {
  const assets = (response: () => Response) => ({ ...testEnv, ASSETS: { fetch: async () => response() } }) as unknown as Env;
  const page = () => new Response('<!doctype html>', { headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': APP_CSP, 'x-frame-options': 'DENY' } });

  it('/kiosk/, /d/ and /s/ allow their own origin as a frame ancestor and nothing wider', async () => {
    expect([...FRAMED_PAGES].sort()).toEqual(['/d', '/d/', '/kiosk', '/kiosk/', '/s', '/s/']);
    for (const path of ['/kiosk/', '/d/', '/s/']) {
      const url = new URL(`https://vidikovac.test${path}?DEV`);
      const response = (await handleDev(new Request(url), assets(page), createExecutionContext(), url))!;
      expect(response.headers.get('x-frame-options'), path).toBe('SAMEORIGIN');
      expect(response.headers.get('content-security-policy'), path).toBe(APP_CSP.replace("frame-ancestors 'none'", "frame-ancestors 'self'"));
    }
  });

  it('leaves a redirect as it is and every other page to the handlers after it', async () => {
    const url = new URL('https://vidikovac.test/kiosk');
    const redirect = () => new Response(null, { status: 307, headers: { location: '/kiosk/', 'x-frame-options': 'DENY' } });
    expect((await handleDev(new Request(url), assets(redirect), createExecutionContext(), url))!.headers.get('x-frame-options')).toBe('DENY');
    for (const path of ['/privatnost/', '/', '/dev/', '/statistika/', '/izvori/']) {
      const other = new URL(`https://vidikovac.test${path}`);
      expect(await handleDev(new Request(other), assets(page), createExecutionContext(), other), path).toBeNull();
    }
  });
});

describe('/hitno?DEV', () => {
  const CAP: ModuleSnapshot = {
    module: 'dhmz-cap', tier: 'open', status: 'live', fetchedAt: new Date().toISOString(),
    attribution: { text: 'Izvor: DHMZ', url: 'https://meteo.hr', licence: 'Otvorena dozvola' }, items: [],
  };
  /** The page and its headers; the body is read before the context settles, as a client reads it (the edge cache's copy is a branch of the same stream). */
  const hitno = async (host: string, search: string, headers: Record<string, string> = {}) => {
    const request = new Request(`https://${host}/hitno${search}`, { headers });
    const ctx = createExecutionContext();
    const response = (await handleOpen(request, { ...testEnv, RL_OPEN: { limit: async () => ({ success: true }) } } as Env, ctx, new URL(request.url), { getModules: async () => [CAP] }))!;
    const html = await response.text();
    await waitOnExecutionContext(ctx);
    return { headers: response.headers, html };
  };

  it('is the same page with the mark written in after the wordmark, no script, never cached as the public copy', async () => {
    expect((await hitno('dev-hitno.test', '')).html).not.toContain('data-dev');
    const { headers, html } = await hitno('dev-hitno.test', '?DEV');
    expect(headers.get('cache-control')).toBe('private, no-store');
    for (const [k, v] of Object.entries(HITNO_SECURITY_HEADERS)) expect(headers.get(k), k).toBe(v);
    expect(html).toContain('<html lang="hr" data-dev="1" data-page="hitno" data-dev-chip="1">');
    expect(html).toContain('data-testid="dev-chip"');
    // The header reads "Kaj ima?dev": the mark follows the wordmark on its line.
    expect(html).toContain('<a class="brand" href="/">Kaj ima<span class="mark">?</span></a><nav class="dev" id="dev-mark" data-testid="dev"');
    expect(html).not.toMatch(/<script/i);
    const links = [...html.matchAll(/data-dev-surface="([a-z]+)"[^>]*>([^<]+)</g)].map((m) => [m[1], m[2]]);
    expect(links).toEqual([['screen', 'Zaslon'], ['phone', 'Telefon'], ['desktop', 'Računalo'], ['hitno', 'Hitno'], ['all', 'Sve zajedno']]);
    expect(html).toContain('<a class="dev-off" data-testid="dev-off" data-dev-off href="/hitno" aria-label="Isključi razvojni način rada"');
    expect(html).toContain('href="/hitno?DEV" data-dev-surface="hitno" aria-current="page"');
    // The public copy in the edge cache is still the plain page.
    expect((await hitno('dev-hitno.test', '')).html).not.toContain('data-dev');
  });

  it('framed by the /dev/ grid, is marked DEV but draws no mark and no scrollbar', async () => {
    const { html } = await hitno('dev-hitno-frame.test', '?DEV', { 'sec-fetch-dest': 'iframe' });
    expect(html).toContain('<html lang="hr" data-dev="1" data-page="hitno">');
    expect(html).not.toContain('dev-chip');
    expect(html).toContain('<style>html{scrollbar-width:none}</style></head>');
  });
});
