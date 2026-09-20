import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { beaconStub } from '../../worker/do/beacon-do';
import { indexStub, type BeaconRecord } from '../../worker/do/index-do';
import type { Env } from '../../worker/env';
import { BEACON_ID_LENGTH, type CreateBeaconRequest, type CreateBeaconResponse } from '../../worker/protocol';

const testEnv = env as unknown as Env;
const BYPASS = String(testEnv.E2E_ADMIN_BYPASS);

function admin(path: string, init: { method?: string; body?: unknown; bypass?: boolean } = {}): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (init.bypass !== false) headers['x-e2e-admin-bypass'] = BYPASS;
  return SELF.fetch(`https://vidikovac.test${path}`, {
    method: init.method ?? 'GET',
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

const VALID: CreateBeaconRequest = { venueType: 'kafic', area: 'Donji grad', operatorLabel: 'Kavana Velebit' };

describe('the admin gate', () => {
  it('has a bypass value long enough to be a token', () => {
    expect(BYPASS.length).toBeGreaterThanOrEqual(32);
  });

  it('answers one uniform 404 to every admin path without the bypass', async () => {
    for (const response of [
      await admin('/api/admin/beacons', { method: 'POST', body: VALID, bypass: false }),
      await admin('/api/admin/beacons', { bypass: false }),
      await admin('/api/admin/beacons/ABCDEFGH/revoke', { method: 'POST', bypass: false }),
      await admin('/api/admin/nepoznato', { bypass: false }),
    ]) {
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: 'not-found' });
    }
  });
});

describe('POST /api/admin/beacons', () => {
  it('provisions a screen and returns the one-time kiosk URL', async () => {
    const response = await admin('/api/admin/beacons', { method: 'POST', body: VALID });
    expect(response.status).toBe(201);
    const created = (await response.json()) as CreateBeaconResponse;
    expect(created.beaconId).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/);
    expect(created.beaconId).toHaveLength(BEACON_ID_LENGTH);
    expect(created.secret).toMatch(/^[0-9A-HJKMNP-TV-Z]{32}$/);
    expect(created.provisionUrl).toBe(`https://zagreb.aningfilm.hr/kiosk/#${created.beaconId}.${created.secret}`);

    expect(await beaconStub(testEnv, created.beaconId).status()).toMatchObject({ exists: true, revoked: false });
    const listed = (await indexStub(testEnv).listBeacons()).find((row) => row.beaconId === created.beaconId);
    expect(listed).toMatchObject({ venueType: 'kafic', area: 'donji-grad', operatorLabel: 'Kavana Velebit', revokedAt: null });
  });

  it('accepts a slug as well as the written name and refuses everything else', async () => {
    const slug = await admin('/api/admin/beacons', { method: 'POST', body: { ...VALID, area: 'pescenica-zitnjak', stopId: '2040' } });
    expect(slug.status).toBe(201);
    const written = await admin('/api/admin/beacons', { method: 'POST', body: { ...VALID, area: 'PEŠČENICA - ŽITNJAK' } });
    expect(written.status).toBe(201);
    // The whole city is an area a screen may be set to (WP4), though never a četvrt.
    const city = await admin('/api/admin/beacons', { method: 'POST', body: { ...VALID, area: 'Zagreb' } });
    expect(city.status).toBe(201);
    for (const body of [
      { ...VALID, area: 'Sisak' },
      { ...VALID, venueType: 'bar' },
      { ...VALID, operatorLabel: '   ' },
      { ...VALID, operatorLabel: 'x'.repeat(81) },
      { ...VALID, stopId: 'ne valja!' },
    ]) {
      const response = await admin('/api/admin/beacons', { method: 'POST', body });
      expect(response.status, JSON.stringify(body)).toBe(400);
    }
    const junk = await SELF.fetch('https://vidikovac.test/api/admin/beacons', {
      method: 'POST',
      headers: { 'x-e2e-admin-bypass': BYPASS },
      body: 'nije json',
    });
    expect(junk.status).toBe(400);
  });
});

describe('GET /api/admin/beacons and revoke', () => {
  it('lists screens, revokes one and 404s an unknown id', async () => {
    const created = (await (await admin('/api/admin/beacons', { method: 'POST', body: VALID })).json()) as CreateBeaconResponse;

    const list = await admin('/api/admin/beacons');
    expect(list.status).toBe(200);
    const { beacons } = (await list.json()) as { beacons: BeaconRecord[] };
    expect(beacons.some((row) => row.beaconId === created.beaconId)).toBe(true);
    expect(JSON.stringify(beacons)).not.toContain(created.secret);

    const revoked = await admin(`/api/admin/beacons/${created.beaconId}/revoke`, { method: 'POST' });
    expect(revoked.status).toBe(200);
    expect(await revoked.json()).toEqual({ beaconId: created.beaconId, revoked: true });
    expect(await beaconStub(testEnv, created.beaconId).status()).toMatchObject({ revoked: true });
    const after = (await indexStub(testEnv).listBeacons()).find((row) => row.beaconId === created.beaconId);
    expect(after?.revokedAt).toBeGreaterThan(0);

    expect((await admin('/api/admin/beacons/ZZZZZZZZ/revoke', { method: 'POST' })).status).toBe(404);
    expect((await admin('/api/admin/beacons/kratko/revoke', { method: 'POST' })).status).toBe(404);
    expect((await admin('/api/admin/beacons', { method: 'DELETE' })).status).toBe(405);
  });
});
