import { SELF, env, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../../worker/env';
import { beaconStub, type BeaconDO } from '../../worker/do/beacon-do';
import { indexStub } from '../../worker/do/index-do';
import type { CodeSlot, CreateBeaconResponse } from '../../worker/protocol';
import { connectWs, authKiosk, connectRoom } from './helpers';
import { cityRows } from '../../worker/stats/export';
import { handleScreens, networkPrincipal } from '../../worker/routes/screens';

const testEnv = env as unknown as Env;

describe('real temporary screens', () => {
  it('creates a real stop-scoped screen, redeems on the same IP and passes context to the session', async () => {
    const response = await SELF.fetch('https://vidikovac.test/api/screens', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ area: 'donji-grad', stopId: '106_1' }),
    });
    expect(response.status).toBe(201);
    const screen = await response.json<CreateBeaconResponse>();
    expect(screen.screen?.kind).toBe('temporary');
    expect(screen.screen?.stop?.name).toContain('Jelačića');
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
    await runInDurableObject(index, (instance) => { vi.spyOn(instance, 'now').mockReturnValue(Date.now() + 3_600_001); });
    expect((await index.reserveScreen(principal)).allowed).toBe(true);
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
