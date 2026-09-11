// B10: the pairing chain end to end, through the real HTTP routes only (no
// direct DO stub access anywhere in this file) — the operator provisions a
// screen behind the Access bypass, the kiosk authenticates and gets a code
// batch, a phone on a different address scans it, both devices join the
// opened room with their one-shot tickets, the phone's chosen view reaches
// only the screen, the spent code is refused a second time, and the two
// privacy-safe counters (session_start, kiosk_online) land in MetricsDO.
import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { Env } from '../../worker/env';
import { metricsStub } from '../../worker/metrics';
// The brief's interface list names this type `MetricsRow`; B6b (already
// committed, see rulings.md R-42) chose the "rename" branch the ruling
// offers rather than "alias it" and shipped the row shape as
// `MetricsDailyRow` only — `MetricsRow` does not exist in worker/metrics-do.ts.
// Using the actual exported name here (see task-B10-report.md, Rulings).
import type { MetricsDailyRow } from '../../worker/metrics-do';
import { formatCode } from '../../worker/pairing/codes';
import { verifyDataToken } from '../../worker/pairing/tokens';
import {
  CODES_PER_BATCH,
  type CodeSlot,
  type CreateBeaconRequest,
  type CreateBeaconResponse,
  type ScanOk,
} from '../../worker/protocol';
import { authKiosk, connectWs, type Conn } from './helpers';

const testEnv = env as unknown as Env;
const BYPASS = String(testEnv.E2E_ADMIN_BYPASS);
const KIOSK_IP = '203.0.113.10';
const PHONE_IP = '198.51.100.7';

async function waitForRow(match: (row: MetricsDailyRow) => boolean): Promise<MetricsDailyRow> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const rows = await metricsStub(testEnv).query('2020-01-01');
    const found = rows.find(match);
    if (found !== undefined) return found;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('counter row never appeared');
}

async function joinRoom(roomId: string, ticket: string, ip: string): Promise<{ conn: Conn; joined: Record<string, unknown> }> {
  const conn = await connectWs(`/ws/room/${roomId}`, ip);
  conn.ws.send(JSON.stringify({ t: 'join', ticket }));
  return { conn, joined: await conn.inbox.nextOfType('joined') };
}

describe('provision, unlock, join, view', () => {
  it('carries one session from the admin route to a forwarded view and a verified data token', async () => {
    // 1. The operator provisions a screen through the Access-gated route.
    const body: CreateBeaconRequest = { venueType: 'kafic', area: 'Donji grad', operatorLabel: 'Kavana Velebit' };
    const provisioned = await SELF.fetch('https://vidikovac.test/api/admin/beacons', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-e2e-admin-bypass': BYPASS },
      body: JSON.stringify(body),
    });
    expect(provisioned.status).toBe(201);
    const created = (await provisioned.json()) as CreateBeaconResponse;
    const [beaconId, secret] = new URL(created.provisionUrl).hash.slice(1).split('.') as [string, string];
    expect(beaconId).toBe(created.beaconId);
    expect(secret).toBe(created.secret);

    // 2. The kiosk opens its socket, answers the challenge and receives a batch.
    const kiosk = await connectWs(`/ws/beacon/${beaconId}`, KIOSK_IP);
    const codes = await authKiosk(kiosk, secret);
    const batch = codes.batch as CodeSlot[];
    expect(batch).toHaveLength(CODES_PER_BATCH);
    expect(batch[0]!.slotStart).toBeLessThanOrEqual(Date.now());
    expect(batch[0]!.slotEnd).toBeGreaterThan(Date.now());

    // 3. A phone on another address scans the code as it is displayed.
    const scanned = await SELF.fetch('https://vidikovac.test/api/scan', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'CF-Connecting-IP': PHONE_IP, Origin: 'https://vidikovac.test' },
      body: JSON.stringify({ code: formatCode(batch[0]!.code) }),
    });
    expect(scanned.status).toBe(200);
    const scan = (await scanned.json()) as ScanOk;
    expect(scan).toMatchObject({ beaconType: 'kiosk', venueType: 'kafic', area: 'Donji grad', screenLabel: 'Kavana Velebit' });

    // 4. The screen learns of the unlock on its own socket.
    const unlocked = await kiosk.inbox.nextOfType('unlocked');
    expect(unlocked.roomId).toBe(scan.roomId);
    expect(unlocked.expiresAt).toBe(scan.expiresAt);

    // 5. Both devices join the room with their one-shot tickets.
    const phone = await joinRoom(scan.roomId, scan.ticket, PHONE_IP);
    expect(phone.joined).toMatchObject({ role: 'scanner', participants: 1, expiresAt: scan.expiresAt });
    expect(await verifyDataToken(testEnv, String(phone.joined.dataToken))).toEqual({
      roomId: scan.roomId,
      expiresAt: scan.expiresAt,
    });
    const screen = await joinRoom(scan.roomId, String(unlocked.ticket), KIOSK_IP);
    expect(screen.joined).toMatchObject({ role: 'kiosk', participants: 2 });

    // 6. The phone drives: its view reaches the screen, and only the screen.
    phone.conn.ws.send(JSON.stringify({ t: 'view', layer: 'u-pokretu', params: { stop: '2040' } }));
    expect(await screen.conn.inbox.nextOfType('view')).toEqual({ t: 'view', layer: 'u-pokretu', params: { stop: '2040' } });

    // 7. The code is spent, and the session was counted without an identifier.
    const replay = await SELF.fetch('https://vidikovac.test/api/scan', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'CF-Connecting-IP': '198.51.100.8' },
      body: JSON.stringify({ code: batch[0]!.code }),
    });
    expect(replay.status).toBe(409);
    const counted = await waitForRow((row) => row.event === 'session_start' && row.dim1 === 'kiosk' && row.dim2 === 'donji-grad');
    expect(counted.count).toBeGreaterThanOrEqual(1);
    expect(counted.hour).toBeGreaterThanOrEqual(0);
    expect(counted.hour).toBeLessThan(24);
    expect(await waitForRow((row) => row.event === 'kiosk_online' && row.dim1 === 'donji-grad')).toBeDefined();

    phone.conn.ws.close(1000, 'done');
    screen.conn.ws.close(1000, 'done');
    kiosk.ws.close(1000, 'done');
  });

  it('refuses the same screen once it is revoked', async () => {
    const body: CreateBeaconRequest = { venueType: 'zet', area: 'Trnje', operatorLabel: 'Stajalište Vukovarska' };
    const created = (await (
      await SELF.fetch('https://vidikovac.test/api/admin/beacons', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-e2e-admin-bypass': BYPASS },
        body: JSON.stringify(body),
      })
    ).json()) as CreateBeaconResponse;
    const kiosk = await connectWs(`/ws/beacon/${created.beaconId}`, '203.0.113.44');
    const batch = (await authKiosk(kiosk, created.secret)).batch as CodeSlot[];

    const revoked = await SELF.fetch(`https://vidikovac.test/api/admin/beacons/${created.beaconId}/revoke`, {
      method: 'POST',
      headers: { 'x-e2e-admin-bypass': BYPASS },
    });
    expect(revoked.status).toBe(200);
    await kiosk.inbox.waitClose();

    const scanned = await SELF.fetch('https://vidikovac.test/api/scan', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'CF-Connecting-IP': '198.51.100.60' },
      body: JSON.stringify({ code: batch[0]!.code }),
    });
    expect([404, 410]).toContain(scanned.status);
    expect(((await scanned.json()) as { error: string }).error).toMatch(/^(revoked|code-unknown)$/);
  });
});
