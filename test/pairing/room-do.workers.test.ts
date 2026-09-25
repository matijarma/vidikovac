import { env, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it, vi } from 'vitest';
import { indexStub } from '../../worker/do/index-do';
import {
  EVENTS_PER_SOCKET_MAX,
  RoomDO,
  WARN_20_MS,
  WARN_60_MS,
  roomStub,
  type RoomOpenInput,
} from '../../worker/do/room-do';
import type { Env } from '../../worker/env';
import { metricsStub } from '../../worker/metrics';
import { randomId, verifyDataToken } from '../../worker/pairing/tokens';
import {
  CLOSE_REPLACED,
  CLOSE_SESSION_EXPIRED,
  CODES_PER_BATCH,
  type CodeSlot,
} from '../../worker/protocol';
import { connectRoom, waitForRow, type Conn } from './helpers';

const testEnv = env as unknown as Env;

/** A kiosk-opened ten-minute room with one scanner and one kiosk ticket. */
async function openRoom(overrides: Partial<RoomOpenInput> = {}): Promise<{ roomId: string; input: RoomOpenInput }> {
  const roomId = overrides.roomId ?? randomId(10);
  const input: RoomOpenInput = {
    expiresAt: Date.now() + 10 * 60_000,
    beaconType: 'kiosk',
    venueType: 'kafic',
    area: 'donji-grad',
    screenLabel: 'Kavana Velebit',
    tickets: [
      { ticket: randomId(16), role: 'scanner' },
      { ticket: randomId(16), role: 'kiosk' },
    ],
    ...overrides,
    roomId,
  };
  expect(await roomStub(testEnv, roomId).open(input)).toEqual({ participants: 0 });
  return { roomId, input };
}

async function join(roomId: string, ticket: string): Promise<{ conn: Conn; joined: Record<string, unknown> }> {
  const conn = await connectRoom(roomId);
  conn.ws.send(JSON.stringify({ t: 'join', ticket }));
  const joined = await conn.inbox.nextOfType('joined');
  return { conn, joined };
}

describe('RoomDO open and join', () => {
  it('refuses a malformed open and a second open of the same room', async () => {
    // Asserted on the instance directly, not through the stub's RPC boundary:
    // a rejection from an RPC method reaches the caller correctly, but
    // vitest-pool-workers also logs it as an unhandled rejection at the
    // workerd level (same artifact documented in metrics-do.workers.test.ts's
    // "query validates the day shape" test and beacon-do.workers.test.ts's
    // "rejects a malformed create"), which fails the run's exit code even
    // though the rejection was properly asserted.
    const roomId = randomId(10);
    const stub = roomStub(testEnv, roomId);
    await runInDurableObject(stub, async (instance: RoomDO) => {
      await expect(
        instance.open({
          roomId: 'PREKRATAK',
          expiresAt: Date.now() + 60_000,
          beaconType: 'kiosk',
          venueType: null,
          area: null,
          screenLabel: null,
          tickets: [{ ticket: randomId(16), role: 'scanner' }],
        }),
      ).rejects.toThrow(/room-open-invalid/);
    });
    const { input } = await openRoom({ roomId });
    await runInDurableObject(stub, async (instance: RoomDO) => {
      await expect(instance.open(input)).rejects.toThrow(/room-already-open/);
    });
  });

  it('joins with each ticket once, assigns roles, hands out resume and data tokens', async () => {
    const { roomId, input } = await openRoom();
    const scanner = await join(roomId, input.tickets[0]!.ticket);
    expect(scanner.joined).toMatchObject({ role: 'scanner', expiresAt: input.expiresAt, participants: 1 });
    expect(typeof scanner.joined.serverNow).toBe('number');
    expect(String(scanner.joined.resumeToken)).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(await verifyDataToken(testEnv, String(scanner.joined.dataToken))).toEqual({
      roomId,
      expiresAt: input.expiresAt,
    });

    const kiosk = await join(roomId, input.tickets[1]!.ticket);
    expect(kiosk.joined).toMatchObject({ role: 'kiosk', participants: 2 });
    expect((await scanner.conn.inbox.nextOfType('count')).participants).toBe(2);

    const reuse = await connectRoom(roomId);
    reuse.ws.send(JSON.stringify({ t: 'join', ticket: input.tickets[0]!.ticket }));
    expect((await reuse.inbox.nextOfType('error')).error).toBe('ticket-invalid');
  });

  it('counts down again when a joined socket leaves', async () => {
    const { roomId, input } = await openRoom();
    const scanner = await join(roomId, input.tickets[0]!.ticket);
    const kiosk = await join(roomId, input.tickets[1]!.ticket);
    expect((await scanner.conn.inbox.nextOfType('count')).participants).toBe(2);
    kiosk.conn.ws.close(1000, 'bye');
    expect((await scanner.conn.inbox.nextOfType('count')).participants).toBe(1);
  });

  it('rejects junk, an unknown ticket, an unjoined command and a room nobody opened', async () => {
    const { roomId } = await openRoom();
    const c = await connectRoom(roomId);
    c.ws.send('not json');
    expect((await c.inbox.nextOfType('error')).error).toBe('bad-frame');
    c.ws.send(JSON.stringify({ t: 'join', ticket: 'NOPE' }));
    expect((await c.inbox.nextOfType('error')).error).toBe('ticket-invalid');
    c.ws.send(JSON.stringify({ t: 'share' }));
    expect((await c.inbox.nextOfType('error')).error).toBe('join-required');

    const ghost = await connectRoom(randomId(10));
    ghost.ws.send(JSON.stringify({ t: 'join', ticket: randomId(16) }));
    expect((await ghost.inbox.nextOfType('error')).error).toBe('room-closed');
  });

  it('answers a keepalive ping from the runtime, without waking the object', async () => {
    const { roomId } = await openRoom();
    const c = await connectRoom(roomId);
    c.ws.send('{"t":"ping"}');
    expect((await c.inbox.nextOfType('pong')).t).toBe('pong');
  });

  it('treats a ping the auto-response missed as a silent no-op, not a bad-frame error', async () => {
    const { roomId, input } = await openRoom();
    const scanner = await join(roomId, input.tickets[0]!.ticket);
    // Not byte-identical to KEEPALIVE_REQUEST, so setWebSocketAutoResponse's
    // exact-match fast path does not intercept it and the frame reaches
    // webSocketMessage as RoomClientMessage's own `{ t: 'ping' }` variant —
    // the same "best-effort, not a guarantee" race beacon-do.ts documents.
    scanner.conn.ws.send(JSON.stringify({ t: 'ping', stray: true }));
    await scanner.conn.inbox.expectSilence();
    // The socket is still fully live afterward, not errored into some broken state.
    scanner.conn.ws.send(JSON.stringify({ t: 'view', layer: 'not-a-layer' }));
    expect((await scanner.conn.inbox.nextOfType('error')).error).toBe('bad-frame');
  });

  it('resume re-attaches with the same role and closes the previous socket', async () => {
    const { roomId, input } = await openRoom();
    const first = await join(roomId, input.tickets[0]!.ticket);
    const second = await connectRoom(roomId);
    second.ws.send(JSON.stringify({ t: 'resume', resumeToken: first.joined.resumeToken }));
    const joined = await second.inbox.nextOfType('joined');
    expect(joined).toMatchObject({
      role: 'scanner',
      resumeToken: first.joined.resumeToken,
      dataToken: first.joined.dataToken,
      participants: 1,
    });
    await first.conn.inbox.waitClose();
    expect(first.conn.inbox.closeCode).toBe(CLOSE_REPLACED);

    const bogus = await connectRoom(roomId);
    bogus.ws.send(JSON.stringify({ t: 'resume', resumeToken: randomId(16) }));
    expect((await bogus.inbox.nextOfType('error')).error).toBe('resume-invalid');

    second.ws.send(JSON.stringify({ t: 'join', ticket: input.tickets[1]!.ticket }));
    expect((await second.inbox.nextOfType('error')).error).toBe('already-joined');
  });
});

describe('RoomDO view forwarding', () => {
  it('forwards view only from the driver to kiosk sockets', async () => {
    const { roomId, input } = await openRoom();
    const scanner = await join(roomId, input.tickets[0]!.ticket);
    const kiosk = await join(roomId, input.tickets[1]!.ticket);
    await scanner.conn.inbox.nextOfType('count');

    scanner.conn.ws.send(JSON.stringify({ t: 'view', layer: 'u-pokretu', params: { kind: 'stop', id: '2040' } }));
    expect(await kiosk.conn.inbox.nextOfType('view')).toEqual({ t: 'view', layer: 'u-pokretu', params: { kind: 'stop', id: '2040' } });
    await scanner.conn.inbox.expectSilence();

    kiosk.conn.ws.send(JSON.stringify({ t: 'view', layer: 'kultura' }));
    await scanner.conn.inbox.expectSilence();
    await kiosk.conn.inbox.expectSilence();

    scanner.conn.ws.send(JSON.stringify({ t: 'view', layer: 'not-a-layer' }));
    expect((await scanner.conn.inbox.nextOfType('error')).error).toBe('bad-frame');
  });
});

describe('RoomDO events', () => {
  it('counts panel_open and export with closed dims and caps at 60 per socket', async () => {
    const { roomId, input } = await openRoom();
    const scanner = await join(roomId, input.tickets[0]!.ticket);
    scanner.conn.ws.send(JSON.stringify({ t: 'event', name: 'panel_open', dim: 'zrak-i-nebo' }));
    scanner.conn.ws.send(JSON.stringify({ t: 'event', name: 'export', dim: 'u-pokretu/ics' }));
    scanner.conn.ws.send(JSON.stringify({ t: 'event', name: 'export', dim: 'u-pokretu/zip' }));
    scanner.conn.ws.send(JSON.stringify({ t: 'event', name: 'page_view', dim: 'x' }));
    for (let i = 0; i < EVENTS_PER_SOCKET_MAX + 10; i += 1) {
      scanner.conn.ws.send(JSON.stringify({ t: 'event', name: 'panel_open', dim: 'kultura' }));
    }

    const stub = metricsStub(testEnv);
    await waitForRow(
      stub,
      (row) => row.event === 'panel_open' && row.dim1 === 'kultura' && row.count === EVENTS_PER_SOCKET_MAX - 2,
      30_000,
    );
    const rows = await stub.query('2020-01-01');
    const sum = (event: string, dim1: string, dim2: string): number =>
      rows.filter((r) => r.event === event && r.dim1 === dim1 && r.dim2 === dim2).reduce((s, r) => s + r.count, 0);
    expect(sum('panel_open', 'zrak-i-nebo', 'kiosk')).toBe(1);
    expect(sum('export', 'u-pokretu', 'ics')).toBe(1);
    expect(sum('export', 'u-pokretu', 'zip')).toBe(0);
    expect(rows.some((r) => r.event === 'page_view')).toBe(false);
  }, 60_000);
});

describe('RoomDO share and redeemPeer', () => {
  it('a kiosk-opened room mints peer codes and a redeemed code opens a fresh five-minute phone room', async () => {
    const { roomId, input } = await openRoom();
    const scanner = await join(roomId, input.tickets[0]!.ticket);
    scanner.conn.ws.send(JSON.stringify({ t: 'share' }));
    const batch = (await scanner.conn.inbox.nextOfType('codes')).batch as CodeSlot[];
    expect(batch.length).toBeGreaterThan(0);
    expect(batch.length).toBeLessThanOrEqual(CODES_PER_BATCH);
    expect(batch[batch.length - 1]!.slotStart).toBeLessThan(input.expiresAt);
    expect(await indexStub(testEnv).resolve(batch[0]!.code)).toEqual({ kind: 'room', ownerId: roomId });

    const result = await roomStub(testEnv, roomId).redeemPeer(batch[0]!.code);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scan).toMatchObject({
      beaconType: 'phone',
      venueType: null,
      area: null,
      screenLabel: null,
      participants: 0,
    });
    expect(result.scan.roomId).toMatch(/^[0-9A-HJKMNP-TV-Z]{16}$/);
    expect(result.scan.roomId).not.toBe(roomId);
    expect(result.scan.expiresAt).toBeGreaterThan(Date.now() + 4 * 60_000);
    expect(result.scan.expiresAt).toBeLessThanOrEqual(Date.now() + 5 * 60_000 + 1000);

    expect(await roomStub(testEnv, roomId).redeemPeer(batch[0]!.code)).toEqual({ ok: false, error: 'code-used' });
    expect(await roomStub(testEnv, roomId).redeemPeer('ZZZZZZZZ')).toEqual({ ok: false, error: 'code-unknown' });

    const peer = await join(result.scan.roomId, result.scan.ticket);
    expect(peer.joined.role).toBe('phone');
    peer.conn.ws.send(JSON.stringify({ t: 'share' }));
    expect((await peer.conn.inbox.nextOfType('error')).error).toBe('share-not-allowed');
    await waitForRow(metricsStub(testEnv), (row) => row.event === 'session_start' && row.dim1 === 'phone');
  });

  it('share is refused from a kiosk socket and from a phone-opened room, and repeats the live batch', async () => {
    const { roomId, input } = await openRoom();
    const kiosk = await join(roomId, input.tickets[1]!.ticket);
    kiosk.conn.ws.send(JSON.stringify({ t: 'share' }));
    expect((await kiosk.conn.inbox.nextOfType('error')).error).toBe('share-not-allowed');

    const scanner = await join(roomId, input.tickets[0]!.ticket);
    scanner.conn.ws.send(JSON.stringify({ t: 'share' }));
    const first = (await scanner.conn.inbox.nextOfType('codes')).batch as CodeSlot[];
    scanner.conn.ws.send(JSON.stringify({ t: 'share' }));
    const second = (await scanner.conn.inbox.nextOfType('codes')).batch as CodeSlot[];
    expect(second.map((s) => s.code)).toEqual(first.map((s) => s.code));

    const phoneRoom = await openRoom({
      beaconType: 'phone',
      venueType: null,
      area: null,
      screenLabel: null,
      tickets: [{ ticket: randomId(16), role: 'scanner' }],
    });
    const phone = await join(phoneRoom.roomId, phoneRoom.input.tickets[0]!.ticket);
    expect(phone.joined.role).toBe('phone');
    phone.conn.ws.send(JSON.stringify({ t: 'share' }));
    expect((await phone.conn.inbox.nextOfType('error')).error).toBe('share-not-allowed');
  });
});

describe('RoomDO expiry chain', () => {
  it('live -> warned60 -> warned20 -> closed, idempotent, with session_end and deleteAll', async () => {
    const { roomId, input } = await openRoom();
    const stub = roomStub(testEnv, roomId);
    const scanner = await join(roomId, input.tickets[0]!.ticket);
    const kiosk = await join(roomId, input.tickets[1]!.ticket);
    await scanner.conn.inbox.nextOfType('count');
    expect(await stub.phase()).toBe('live');

    // Far from expiry: the alarm only re-arms.
    await runInDurableObject(stub, (instance: RoomDO) => instance.alarm());
    expect(await stub.phase()).toBe('live');
    await scanner.conn.inbox.expectSilence();

    await runInDurableObject(stub, (instance: RoomDO) => {
      vi.spyOn(instance, 'now').mockReturnValue(input.expiresAt - WARN_60_MS);
    });
    await runInDurableObject(stub, (instance: RoomDO) => instance.alarm());
    expect((await scanner.conn.inbox.nextOfType('expiring')).secondsLeft).toBe(60);
    expect((await kiosk.conn.inbox.nextOfType('expiring')).secondsLeft).toBe(60);
    expect(await stub.phase()).toBe('warned60');
    // Alarms are at-least-once: a second delivery at the same instant is silent.
    await runInDurableObject(stub, (instance: RoomDO) => instance.alarm());
    await scanner.conn.inbox.expectSilence();

    await runInDurableObject(stub, (instance: RoomDO) => {
      vi.spyOn(instance, 'now').mockReturnValue(input.expiresAt - WARN_20_MS);
    });
    await runInDurableObject(stub, (instance: RoomDO) => instance.alarm());
    expect((await scanner.conn.inbox.nextOfType('expiring')).secondsLeft).toBe(20);
    expect((await kiosk.conn.inbox.nextOfType('expiring')).secondsLeft).toBe(20);
    expect(await stub.phase()).toBe('warned20');

    await runInDurableObject(stub, (instance: RoomDO) => {
      vi.spyOn(instance, 'now').mockReturnValue(input.expiresAt);
    });
    await runInDurableObject(stub, (instance: RoomDO) => instance.alarm());
    await scanner.conn.inbox.nextOfType('expired');
    await kiosk.conn.inbox.nextOfType('expired');
    await scanner.conn.inbox.waitClose();
    await kiosk.conn.inbox.waitClose();
    expect(scanner.conn.inbox.closeCode).toBe(CLOSE_SESSION_EXPIRED);
    expect(scanner.conn.inbox.closeReason).toBe('session-expired');
    expect(kiosk.conn.inbox.closeCode).toBe(CLOSE_SESSION_EXPIRED);

    expect(await stub.phase()).toBe('none');
    const metaRows = await runInDurableObject(stub, (_instance: RoomDO, state) =>
      state.storage.sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM meta`).one().n,
    );
    expect(metaRows).toBe(0);
    expect(await runInDurableObject(stub, (_instance: RoomDO, state) => state.storage.getAlarm())).toBeNull();
    await waitForRow(
      metricsStub(testEnv),
      (row) => row.event === 'session_end' && row.dim1 === 'expired' && row.dim2 === '10min',
    );

    // A wiped room grants nothing more.
    expect(await stub.redeemPeer('ZZZZZZZZ')).toEqual({ ok: false, error: 'code-unknown' });
    await runInDurableObject(stub, (instance: RoomDO) => instance.alarm());
    expect(await stub.phase()).toBe('none');
  });

  it('a session too short for the warnings still closes itself on its own alarm', async () => {
    const { roomId, input } = await openRoom({ expiresAt: Date.now() + 3000 });
    const stub = roomStub(testEnv, roomId);
    const scanner = await join(roomId, input.tickets[0]!.ticket);
    await scanner.conn.inbox.nextOfType('expired', 10_000);
    await scanner.conn.inbox.waitClose(5000);
    expect(scanner.conn.inbox.closeCode).toBe(CLOSE_SESSION_EXPIRED);
    expect(await stub.phase()).toBe('none');
    await waitForRow(
      metricsStub(testEnv),
      (row) => row.event === 'session_end' && row.dim1 === 'expired' && row.dim2 === '<1min',
      30_000,
    );
  }, 60_000);
});
