// DEV counts nothing (worker/routes/dev.ts, worker/metrics.ts metricScope): /privatnost/ and
// /statistika/ describe real use, so a DEV screen and every session on it must never reach the
// rows /statistika/ and grad.csv are built from. This file drives a DEV session through every
// counting path there is (the wall coming online, a session without a code, one from the wall's
// code, a refused code, a shared code, panel_open and export, the end of a session),
// then the same few steps on an ordinary temporary screen and one plain /hitno as the control that
// the counters are live, and asserts that the counted rows hold the control's rows and nothing
// else: the public cells and the City's rows are exactly the control's. Its own file, so MetricsDO
// starts empty (isolated storage per file).
import { SELF, createExecutionContext, env, runInDurableObject, waitOnExecutionContext } from 'cloudflare:test';
import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../../worker/env';
import { roomStub, type RoomDO } from '../../worker/do/room-do';
import type { ModuleSnapshot } from '../../worker/feed/schema';
import { metricsStub } from '../../worker/metrics';
import type { MetricsDailyRow } from '../../worker/metrics-rows';
import type { CodeSlot, CreateBeaconResponse, ScanOk } from '../../worker/protocol';
import { handleOpen } from '../../worker/routes/open';
import { cityRows } from '../../worker/stats/export';
import { foldPublic } from '../../worker/stats/public';
import { connectWs, kioskAnswer, waitForRows, type Conn } from './helpers';

const testEnv = env as unknown as Env;
const SINCE = '2020-01-01';

const post = (path: string, ip: string, body: unknown = {}) =>
  SELF.fetch(`https://vidikovac.test${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'CF-Connecting-IP': ip }, body: JSON.stringify(body) });

async function wall(beaconId: string, secret: string, ip: string): Promise<Conn & { batch: CodeSlot[] }> {
  const conn = await connectWs(`/ws/beacon/${beaconId}`, ip);
  const challenge = await conn.inbox.nextOfType('challenge');
  conn.ws.send(JSON.stringify({ t: 'auth', hmac: await kioskAnswer(secret, String(challenge.nonce)), presentationVersion: 1 }));
  return { ...conn, batch: (await conn.inbox.nextOfType('codes')).batch as CodeSlot[] };
}

async function join(grant: ScanOk, ip: string): Promise<Conn> {
  const viewer = await connectWs(`/ws/room/${grant.roomId}`, ip);
  viewer.ws.send(JSON.stringify({ t: 'join', ticket: grant.ticket }));
  await viewer.inbox.nextOfType('joined');
  return viewer;
}

/** Everything a session's person does that the room counts. */
function use(viewer: Conn): void {
  viewer.ws.send(JSON.stringify({ t: 'event', name: 'panel_open', dim: 'kultura' }));
  viewer.ws.send(JSON.stringify({ t: 'event', name: 'export', dim: 'kultura/copy' }));
}

/** The room's end, its session_end counter included: the clock at the end, which closes a room whoever holds it. */
async function end(grant: ScanOk, viewer: Conn): Promise<void> {
  const stub = roomStub(testEnv, grant.roomId);
  const expiresAt = await runInDurableObject(stub, (_i: RoomDO, state) => Number(state.storage.sql.exec("SELECT value FROM meta WHERE key = 'expiresAt'").one().value));
  await runInDurableObject(stub, (instance: RoomDO) => { vi.spyOn(instance, 'now').mockReturnValue(expiresAt); });
  await runInDurableObject(stub, (instance: RoomDO) => instance.alarm());
  expect(await runInDurableObject(stub, (instance: RoomDO) => instance.phase())).toBe('none');
  await viewer.inbox.nextOfType('expired');
}

async function hitno(search: string): Promise<void> {
  const request = new Request(`https://metrics-hitno.test/hitno${search}`, { headers: { 'user-agent': 'Mozilla/5.0 (a person)' } });
  const ctx = createExecutionContext();
  const getModules = async (): Promise<ModuleSnapshot[]> => [];
  const response = await handleOpen(request, { ...testEnv, RL_OPEN: { limit: async () => ({ success: true }) } } as Env, ctx, new URL(request.url), { getModules });
  await response!.text();
  await waitOnExecutionContext(ctx);
}

describe('a DEV session never reaches the counted rows', () => {
  it('drives every counting path in DEV, then a control; the rows, the public cells and the City rows are the control\'s alone', async () => {
    const metrics = metricsStub(testEnv);
    expect(await metrics.query(SINCE)).toEqual([]);

    // --- DEV: the wall online, a session without a code, a session from the wall's code, a
    // refused (spent) code, a code shared from the DEV session and redeemed, every event, the ends.
    const ip = '198.51.100.7';
    const devScreen = await (await post('/api/dev/screen', ip)).json<CreateBeaconResponse>();
    expect(devScreen.screen?.dev).toBe(true);
    const devWall = await wall(devScreen.beaconId, devScreen.secret, ip);
    const noCode = await (await post('/api/dev/session', ip)).json<ScanOk>();
    const fromCode = await (await post('/api/scan', ip, { code: devWall.batch[0]!.code })).json<ScanOk>();
    expect(fromCode.screen?.dev).toBe(true);
    expect((await post('/api/scan', ip, { code: devWall.batch[0]!.code })).status).toBe(409);
    const a = await join(noCode, ip);
    const b = await join(fromCode, ip);
    a.ws.send(JSON.stringify({ t: 'share' }));
    const shared = (await a.inbox.nextOfType('codes')).batch as CodeSlot[];
    const peer = await (await post('/api/scan', ip, { code: shared[0]!.code })).json<ScanOk>();
    expect(peer.beaconType).toBe('phone');
    const c = await join(peer, ip);
    for (const viewer of [a, b, c]) use(viewer);
    await end(noCode, a);
    await end(fromCode, b);
    await end(peer, c);
    devWall.ws.close(1000, 'done');

    // --- The control: an ordinary temporary screen online, one scan, one plain /hitno.
    const control = await (await post('/api/screens', '198.51.100.8')).json<CreateBeaconResponse>();
    expect(control.screen?.dev).toBeUndefined();
    const controlWall = await wall(control.beaconId, control.secret, '198.51.100.8');
    const scanned = await (await post('/api/scan', '198.51.100.8', { code: controlWall.batch[0]!.code })).json<ScanOk>();
    const d = await join(scanned, '198.51.100.8');
    use(d);
    await hitno('');
    const expected = (rows: MetricsDailyRow[]) =>
      rows.some((r) => r.event === 'hitno_view') && rows.some((r) => r.event === 'evaluation' && r.dim1 === 'export')
      && rows.some((r) => r.event === 'evaluation' && r.dim1 === 'session_start');
    await waitForRows(metrics, expected);
    // The writes are fire-and-forget; give any stray DEV write every chance to land before the read.
    await new Promise((resolve) => setTimeout(resolve, 500));
    const rows = await metrics.query(SINCE);

    const cells = rows.map(({ event, dim1, dim2, count }) => ({ event, dim1, dim2, count }))
      .sort((x, y) => `${x.event}/${x.dim1}`.localeCompare(`${y.event}/${y.dim1}`));
    expect(cells).toEqual([
      { event: 'evaluation', dim1: 'export', dim2: 'kultura', count: 1 },
      { event: 'evaluation', dim1: 'kiosk_online', dim2: 'zagreb', count: 1 },
      { event: 'evaluation', dim1: 'panel_open', dim2: 'kultura', count: 1 },
      { event: 'evaluation', dim1: 'session_start', dim2: 'zagreb', count: 1 },
      { event: 'hitno_view', dim1: 'page', dim2: '', count: 1 },
    ]);
    // What /statistika/ and grad.csv are built from: nothing but the control.
    const folded = foldPublic(rows);
    expect(folded.city).toEqual(cityRows(rows));
    expect(folded.city.every((r) => r.event === 'hitno_view' || r.event === 'ostalo' || r.dim1 === 'ostalo')).toBe(true);
    expect(JSON.stringify(folded)).not.toMatch(/"(session_end|scan_fail|over_cap)"/);
    expect(await metrics.publicCells(SINCE)).toEqual(folded);
    d.ws.close(1000, 'done');
    controlWall.ws.close(1000, 'done');
  });
});
