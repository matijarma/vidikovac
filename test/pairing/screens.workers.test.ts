import { SELF, env, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../../worker/env';
import { beaconStub, type BeaconDO } from '../../worker/do/beacon-do';
import { indexStub } from '../../worker/do/index-do';
import type { CodeSlot, CreateBeaconResponse } from '../../worker/protocol';
import { connectWs, authKiosk, connectRoom } from './helpers';
import { cityRows } from '../../worker/stats/export';
import { handleScreens, networkPrincipal } from '../../worker/routes/screens';
import { districtOf } from '../../worker/feed/geo/districts';
import { screenStop } from '../../worker/pairing/stops';

const testEnv = env as unknown as Env;

const TRG_STOP = screenStop('106_1')!;
const TRG_PLACE = { kind: 'tram', name: TRG_STOP.name, lon: TRG_STOP.lon, lat: TRG_STOP.lat, stopId: '106_1' };

// Each request from its own network (198.18.0.0/15, the benchmarking range), so the
// five-screens-per-hour quota the older tests in this file already use up never answers 429.
let network = 0;
const createScreen = (body: unknown) => SELF.fetch('https://vidikovac.test/api/screens', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'CF-Connecting-IP': `198.18.${Math.floor(++network / 250)}.${network % 250 + 1}` },
  body: typeof body === 'string' ? body : JSON.stringify(body),
});

/** The raw 'place' meta a BeaconDO stored: null when the key is absent, '' for no place. */
const storedPlaceMeta = (beaconId: string): Promise<string | null> => runInDurableObject(beaconStub(testEnv, beaconId), (_instance: BeaconDO, state: DurableObjectState) =>
  (state.storage.sql.exec(`SELECT value FROM meta WHERE key = 'place'`).toArray()[0] as { value: string } | undefined)?.value ?? null);

describe('real temporary screens', () => {
  it('creates a real stop-scoped screen from the legacy stopId body, redeems on the same IP and passes context to the session', async () => {
    const response = await SELF.fetch('https://vidikovac.test/api/screens', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ area: 'donji-grad', stopId: '106_1' }),
    });
    expect(response.status).toBe(201);
    const screen = await response.json<CreateBeaconResponse>();
    expect(screen.screen?.kind).toBe('temporary');
    expect(screen.screen?.stop?.name).toContain('Jelačića');
    // The legacy body's stop is the place, chosen by the operator; the area stays as sent.
    expect(screen.screen).toMatchObject({ area: 'donji-grad', place: TRG_PLACE, placeSet: true, frame: 6 });
    expect(screen.screen?.expiresAt).toBeGreaterThan(Date.now() + 23 * 60 * 60_000);
    const kiosk = await connectWs(`/ws/beacon/${screen.beaconId}`, '192.0.2.4');
    const frame = await authKiosk(kiosk, screen.secret);
    const code = (frame.batch as CodeSlot[])[0]!.code;
    const scanResponse = await SELF.fetch('https://vidikovac.test/api/scan', {
      method: 'POST', headers: { 'content-type': 'application/json', 'CF-Connecting-IP': '192.0.2.4' },
      body: JSON.stringify({ code }),
    });
    expect(scanResponse.status).toBe(200);
    const grant = await scanResponse.json<{ roomId: string; ticket: string; screen: unknown }>();
    expect(grant.screen).toEqual(screen.screen);
    const viewer = await connectRoom(grant.roomId);
    viewer.ws.send(JSON.stringify({ t: 'join', ticket: grant.ticket }));
    expect((await viewer.inbox.nextOfType('joined')).screen).toEqual(screen.screen);
    viewer.ws.send(JSON.stringify({ t: 'view', layer: 'u-pokretu', params: { kind: 'stop', id: '106_1', address: 'private' } }));
    expect((await viewer.inbox.nextOfType('error')).error).toBe('bad-frame');
    viewer.ws.close(1000, 'done');
    kiosk.ws.close(1000, 'done');
  });

  it('one button, an empty body: the whole city, no stop, and the city in the label', async () => {
    const response = await SELF.fetch('https://vidikovac.test/api/screens', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    });
    expect(response.status).toBe(201);
    const screen = await response.json<CreateBeaconResponse>();
    // The record stores no place; every read names Trg bana Jelačića with placeSet false, so
    // the list and the departures have a place while the map keeps the whole-city window.
    expect(screen.screen).toEqual({
      kind: 'temporary', expiresAt: screen.screen!.expiresAt, stop: null, area: 'zagreb', place: TRG_PLACE, placeSet: false, frame: 6,
    });
    expect(await storedPlaceMeta(screen.beaconId)).toBe('');
    const kiosk = await connectWs(`/ws/beacon/${screen.beaconId}`, '192.0.2.9');
    const frame = await authKiosk(kiosk, screen.secret);
    expect(frame.screen).toEqual(screen.screen);
    // The settings panel's frame, over that same socket, re-frames the screen.
    kiosk.ws.send(JSON.stringify({ t: 'screen-set', version: 1, stopId: '106_1', area: 'trnje' }));
    const after = await kiosk.inbox.nextOfType('codes');
    expect(after.screen).toMatchObject({ area: 'trnje', place: TRG_PLACE, placeSet: true, frame: 6 });
    expect((after.screen as { stop: { name: string } }).stop.name).toContain('Jelačića');
    kiosk.ws.close(1000, 'done');
    const listed = (await indexStub(testEnv).listBeacons()).find((b) => b.beaconId === screen.beaconId);
    expect(listed).toMatchObject({ area: 'zagreb', stopId: null, operatorLabel: 'Kaj ima? · Zagreb' });
  });

  it('keeps an area without a stop, and names the area in the default label', async () => {
    const response = await SELF.fetch('https://vidikovac.test/api/screens', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ area: 'trnje' }),
    });
    expect(response.status).toBe(201);
    const screen = await response.json<CreateBeaconResponse>();
    expect(screen.screen).toMatchObject({ stop: null, area: 'trnje' });
  });

  it('rejects unknown stops and cross-origin creation', async () => {
    const response = await SELF.fetch('https://vidikovac.test/api/screens', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"stopId":"invented"}',
    });
    expect(response.status).toBe(400);
    const foreign = await SELF.fetch('https://vidikovac.test/api/screens', {
      method: 'POST', headers: { Origin: 'https://foreign.test' }, body: '{}',
    });
    expect(foreign.status).toBe(403);
  });

  it('rate limits principals independently and expires their quota rows', async () => {
    const index = indexStub(testEnv);
    const principal = 'a'.repeat(64);
    for (let i = 0; i < 5; i++) expect((await index.reserveScreen(principal)).allowed).toBe(true);
    expect((await index.reserveScreen(principal)).allowed).toBe(false);
    expect((await index.reserveScreen('b'.repeat(64))).allowed).toBe(true);
    let clock: { mockRestore(): void } | undefined;
    await runInDurableObject(index, (instance: { now(): number }) => { clock = vi.spyOn(instance, 'now').mockReturnValue(Date.now() + 3_600_001); });
    try {
      expect((await index.reserveScreen(principal)).allowed).toBe(true);
    } finally {
      // The index is one object for the whole file: an hour-ahead clock left behind would
      // expire every code a later test registers (a scan then answers code-unknown).
      clock?.mockRestore();
    }
  });
  it('uses the actual network quota in test mode too, retaining the five-screen limit', async () => {
    const request = (ip: string) => new Request('https://vidikovac.test/api/screens', {
      method: 'POST', headers: { 'content-type': 'application/json', 'CF-Connecting-IP': ip }, body: '{}',
    });
    const ip = '2001:db8:10:20::1';
    const principal = await networkPrincipal(testEnv, request(ip));
    expect(principal).toBeTruthy();
    for (let i = 0; i < 5; i++) await indexStub(testEnv).reserveScreen(principal!);
    const limited = await SELF.fetch(request(ip));
    expect(limited.status).toBe(429);
    expect((await limited.json<{ error: string }>()).error).toBe('screen-limit');
    const independent = await SELF.fetch(request('2001:db8:30:40::1'));
    expect(independent.status).toBe(201);
  });

  it('expires the screen, never revokes an already issued room grant', async () => {
    const response = await SELF.fetch('https://vidikovac.test/api/screens', { method: 'POST', body: '{}' });
    const screen = await response.json<CreateBeaconResponse>();
    const stub = beaconStub(testEnv, screen.beaconId);
    await runInDurableObject(stub, (instance: BeaconDO) => { vi.spyOn(instance, 'now').mockReturnValue(Date.now() + 25 * 60 * 60_000); });
    expect((await stub.status()).revoked).toBe(true);
    expect(await stub.redeem('ABCDEFGH')).toEqual({ ok: false, error: 'revoked' });
  });
  it('keeps an expired object callable after its cleanup alarm drops stored data', async () => {
    const response = await SELF.fetch('https://vidikovac.test/api/screens', { method: 'POST', body: '{}' });
    const screen = await response.json<CreateBeaconResponse>();
    const stub = beaconStub(testEnv, screen.beaconId);
    await runInDurableObject(stub, async (instance: BeaconDO) => {
      vi.spyOn(instance, 'now').mockReturnValue(Date.now() + 25 * 60 * 60_000);
      await instance.alarm();
    });
    expect(await stub.status()).toMatchObject({ exists: false, revoked: false, kioskOnline: false, codes: 0 });
    expect(await stub.redeem('ABCDEFGH')).toEqual({ ok: false, error: 'code-unknown' });
  });
  it('releases exactly a failed provisioning reservation', async () => {
    const index = indexStub(testEnv);
    const key = 'e'.repeat(64);
    const first = await index.reserveScreen(key);
    for (let i = 0; i < 4; i++) await index.reserveScreen(key);
    expect((await index.reserveScreen(key)).allowed).toBe(false);
    await index.releaseScreen(first.reservation!);
    expect((await index.reserveScreen(key)).allowed).toBe(true);
    expect((await index.reserveScreen(key)).allowed).toBe(false);
  });

  it('never includes evaluation activity in a City venue-demand export', () => {
    expect(cityRows([{ day: '2026-09-12', hour: 12, event: 'evaluation', dim1: 'session_start', dim2: '', count: 100 }])).toEqual([]);
    expect(cityRows([{ day: '2026-09-12', hour: 12, event: 'scan_fail', dim1: 'code-unknown', dim2: 'unattributed', count: 100 }])).toEqual([]);
  });
});

// place-v2: the one field "Adresa ili stajalište" posts `{ place, frame? }`. A stop
// travels by its id only (the server fills its name and point); an address carries
// its point, which must lie inside Zagreb. The area follows from the place.
describe('screens with a place (place-v2)', () => {
  it('a stop place and frame 8: the stop, its district and its name in the label, read back unchanged by the grant and the room', async () => {
    const response = await createScreen({ place: { kind: 'stop', stopId: '106_1', address: 'Trg bana Josipa Jelačića 3' }, frame: 8 });
    expect(response.status).toBe(201);
    const screen = await response.json<CreateBeaconResponse>();
    expect(screen.screen).toMatchObject({
      stop: { id: '106_1' }, area: TRG_STOP.district, frame: 8, placeSet: true,
      place: { ...TRG_PLACE, address: 'Trg bana Josipa Jelačića 3' },
    });
    expect(screen.screen!.place!.name).toContain('Jelačića');
    expect(JSON.parse((await storedPlaceMeta(screen.beaconId))!)).toEqual(screen.screen!.place);
    const listed = (await indexStub(testEnv).listBeacons()).find((b) => b.beaconId === screen.beaconId);
    expect(listed).toMatchObject({ area: TRG_STOP.district, stopId: '106_1', operatorLabel: `Kaj ima? · ${TRG_STOP.name}` });
    const kiosk = await connectWs(`/ws/beacon/${screen.beaconId}`, '192.0.2.21');
    const codes = await authKiosk(kiosk, screen.secret);
    expect(codes.screen).toEqual(screen.screen);
    const scan = await SELF.fetch('https://vidikovac.test/api/scan', {
      method: 'POST', headers: { 'content-type': 'application/json', 'CF-Connecting-IP': '192.0.2.21' },
      body: JSON.stringify({ code: (codes.batch as CodeSlot[])[0]!.code }),
    });
    expect(scan.status).toBe(200);
    const grant = await scan.json<{ roomId: string; ticket: string; screen: unknown }>();
    expect(grant.screen).toEqual(screen.screen);
    const viewer = await connectRoom(grant.roomId);
    viewer.ws.send(JSON.stringify({ t: 'join', ticket: grant.ticket }));
    expect((await viewer.inbox.nextOfType('joined')).screen).toEqual(screen.screen);
    viewer.ws.close(1000, 'done');
    kiosk.ws.close(1000, 'done');
  });

  it('an address place: no stop, the area from the point, the street in the label', async () => {
    const response = await createScreen({ place: { kind: 'address', name: ' Ilica ', lon: 15.97, lat: 45.8135, address: 'Ilica 25' } });
    expect(response.status).toBe(201);
    const screen = await response.json<CreateBeaconResponse>();
    expect(screen.screen).toMatchObject({
      stop: null, area: districtOf(15.97, 45.8135) ?? 'zagreb', frame: 6, placeSet: true,
    });
    expect(screen.screen!.place).toEqual({ kind: 'address', name: 'Ilica', lon: 15.97, lat: 45.8135, address: 'Ilica 25' });
    const listed = (await indexStub(testEnv).listBeacons()).find((b) => b.beaconId === screen.beaconId);
    expect(listed).toMatchObject({ stopId: null, operatorLabel: 'Kaj ima? · Ilica' });
  });

  it('keeps an explicit area beside a place, and a frame without a place', async () => {
    const withArea = await (await createScreen({ place: { kind: 'stop', stopId: '106_1' }, area: 'trnje' })).json<CreateBeaconResponse>();
    expect(withArea.screen).toMatchObject({ area: 'trnje', place: TRG_PLACE, placeSet: true });
    const frameOnly = await (await createScreen({ frame: 4 })).json<CreateBeaconResponse>();
    expect(frameOnly.screen).toMatchObject({ area: 'zagreb', stop: null, place: TRG_PLACE, placeSet: false, frame: 4 });
  });

  it('shortens a default label that a long street name would push past 80 characters', async () => {
    const name = 'Ulica ' + 'Velikog Imena '.repeat(5) + 'kraj';
    expect(name.length).toBeLessThanOrEqual(80);
    const response = await createScreen({ place: { kind: 'address', name, lon: 15.97, lat: 45.8135 } });
    expect(response.status).toBe(201);
    const screen = await response.json<CreateBeaconResponse>();
    const listed = (await indexStub(testEnv).listBeacons()).find((b) => b.beaconId === screen.beaconId)!;
    expect(listed.operatorLabel.length).toBeLessThanOrEqual(80);
    expect(listed.operatorLabel.startsWith('Kaj ima? · Ulica Velikog Imena')).toBe(true);
    expect(listed.operatorLabel.endsWith('…')).toBe(true);
  });

  it('answers 400 with the field for a place it cannot take, a frame outside 4/6/8, or a place beside a stopId', async () => {
    const cases: Array<[unknown, string]> = [
      [{ place: { kind: 'address', name: 'X', lon: 0, lat: 0 } }, 'place'],
      [{ place: { kind: 'address', name: 'Beč', lon: 16.37, lat: 48.21 } }, 'place'],
      [{ place: { kind: 'address', name: '', lon: 15.97, lat: 45.8135 } }, 'place'],
      [{ place: { kind: 'address', name: 'Ilica\u0007', lon: 15.97, lat: 45.8135 } }, 'place'],
      [{ place: { kind: 'address', name: 'I'.repeat(81), lon: 15.97, lat: 45.8135 } }, 'place'],
      [{ place: { kind: 'address', name: 'Ilica', lon: 15.97, lat: 45.8135, address: 'A'.repeat(121) } }, 'place'],
      [{ place: { kind: 'stop', stopId: 'invented' } }, 'place'],
      [{ place: { kind: 'stop', stopId: '106_1; drop' } }, 'place'],
      [{ place: { kind: 'tram', name: 'Trg', lon: 15.97, lat: 45.81, stopId: '106_1' } }, 'place'],
      [{ place: 'Ilica 25' }, 'place'],
      [{ place: { kind: 'stop', stopId: '106_1' }, stopId: '106_1' }, 'stopId'],
      [{ frame: 5 }, 'frame'],
      [{ frame: '6' }, 'frame'],
      [{ place: { kind: 'stop', stopId: '106_1' }, frame: null }, 'frame'],
    ];
    for (const [body, field] of cases) {
      const response = await createScreen(body);
      expect({ body, status: response.status }).toEqual({ body, status: 400 });
      expect(await response.json()).toEqual({ error: 'bad-request', field });
    }
  });
});

// A public deployment (no Cloudflare Access in front of the site) still lets a
// person set up a screen: the quota key is then the caller's network, never an
// address in the clear.
describe('self-service screens on a public deployment', () => {
  const publicEnv = { ...testEnv, APP_ENV: 'production' } as Env;
  const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
  const post = (headers: Record<string, string>) => {
    const request = new Request('https://vidikovac.test/api/screens', {
      method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ area: 'donji-grad', stopId: '106_1' }),
    });
    return handleScreens(request, publicEnv, ctx, new URL(request.url));
  };

  it('creates a screen for a caller Cloudflare identifies only by address, and refuses one it cannot identify at all', async () => {
    const created = await post({ 'CF-Connecting-IP': '203.0.113.7' });
    expect(created?.status).toBe(201);
    const refused = await post({});
    expect(refused?.status).toBe(403);
    expect(await refused?.json()).toEqual({ error: 'evaluation-access-required' });
  });

  it('keys the quota by network: one address maps to one stable key, a different address to another, and no key carries the address', async () => {
    const a1 = await networkPrincipal(publicEnv, new Request('https://vidikovac.test/api/screens', { headers: { 'CF-Connecting-IP': '203.0.113.7' } }));
    const a2 = await networkPrincipal(publicEnv, new Request('https://vidikovac.test/api/screens', { headers: { 'CF-Connecting-IP': '203.0.113.7' } }));
    const b = await networkPrincipal(publicEnv, new Request('https://vidikovac.test/api/screens', { headers: { 'CF-Connecting-IP': '198.51.100.9' } }));
    const v6a = await networkPrincipal(publicEnv, new Request('https://vidikovac.test/api/screens', { headers: { 'CF-Connecting-IP': '2001:db8:1:2:aaaa::1' } }));
    const v6b = await networkPrincipal(publicEnv, new Request('https://vidikovac.test/api/screens', { headers: { 'CF-Connecting-IP': '2001:db8:1:2:bbbb::9' } }));
    expect(a1).toBe(a2);
    expect(a1).not.toBe(b);
    expect(v6a).toBe(v6b); // the same /64 is one network
    for (const key of [a1, b, v6a]) { expect(key).toMatch(/^[0-9a-f]{64}$/); expect(key).not.toContain('203'); }
    expect(await networkPrincipal(publicEnv, new Request('https://vidikovac.test/api/screens'))).toBeNull();
  });
});
