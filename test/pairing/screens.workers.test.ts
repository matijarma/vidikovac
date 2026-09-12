import { SELF, env, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../../worker/env';
import { beaconStub, type BeaconDO } from '../../worker/do/beacon-do';
import { indexStub } from '../../worker/do/index-do';
import type { CodeSlot, CreateBeaconResponse } from '../../worker/protocol';
import { connectWs, authKiosk, connectRoom } from './helpers';
import { cityRows } from '../../worker/stats/export';

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

  it('expires the screen, never revokes an already issued room grant', async () => {
    const response = await SELF.fetch('https://vidikovac.test/api/screens', { method: 'POST', body: '{}' });
    const screen = await response.json<CreateBeaconResponse>();
    const stub = beaconStub(testEnv, screen.beaconId);
    await runInDurableObject(stub, (instance: BeaconDO) => { vi.spyOn(instance, 'now').mockReturnValue(Date.now() + 25 * 60 * 60_000); });
    expect((await stub.status()).revoked).toBe(true);
    expect(await stub.redeem('ABCDEFGH')).toEqual({ ok: false, error: 'revoked' });
  });

  it('never includes evaluation activity in a City venue-demand export', () => {
    expect(cityRows([{ day: '2026-09-12', hour: 12, event: 'evaluation', dim1: 'session_start', dim2: '', count: 100 }])).toEqual([]);
  });
});
