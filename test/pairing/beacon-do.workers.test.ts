import { env, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it, vi } from 'vitest';
import { BeaconDO, CAP_PER_HOUR, CLOSE_AUTH_EXHAUSTED, CLOSE_REVOKED, SCREEN_SET_ARRIVAL_SLACK_MS, SCREEN_SET_MIN_MS, SLOW_DOWN_FAILS, beaconStub } from '../../worker/do/beacon-do';
import { indexStub } from '../../worker/do/index-do';
import type { Env } from '../../worker/env';
import { districtOf } from '../../worker/feed/geo/districts';
import { metricsStub } from '../../worker/metrics';
import { defaultScreenPlace, enrichPlace } from '../../worker/pairing/place';
import { screenStop } from '../../worker/pairing/stops';
import { randomId } from '../../worker/pairing/tokens';
import { CODES_PER_BATCH, CODE_GRACE_MS, type CodeSlot, type ScreenMetadata, type ScreenPlace } from '../../worker/protocol';
import { DEFAULT_PLACE_STOP_ID } from '../../shared/city/place';
import { KIOSK_NET_KEY, authKiosk, connectBeaconDirect, kioskAnswer, onlineKiosk, provision } from './helpers';

const testEnv = env as unknown as Env;

const TRG_STOP = screenStop('106_1')!;
const TRG_PLACE = { kind: 'tram', name: TRG_STOP.name, lon: TRG_STOP.lon, lat: TRG_STOP.lat, stopId: '106_1' };
const ILICA = { kind: 'address', name: 'Ilica', lon: 15.97, lat: 45.8135, address: 'Ilica 25' } as const;
const v2 = (place: unknown, frame: unknown) => JSON.stringify({ t: 'screen-set', version: 2, place, frame });

const metaOf = (beaconId: string, key: string): Promise<string | null> => runInDurableObject(beaconStub(testEnv, beaconId), (_instance: BeaconDO, state: DurableObjectState) =>
  (state.storage.sql.exec('SELECT value FROM meta WHERE key = ?', key).toArray()[0] as { value: string } | undefined)?.value ?? null);
const screenOf = (beaconId: string) => runInDurableObject(beaconStub(testEnv, beaconId), (instance: BeaconDO) => instance.screenMetadata());
const setMetaOf = (beaconId: string, key: string, value: string) => runInDurableObject(beaconStub(testEnv, beaconId), (_instance: BeaconDO, state: DurableObjectState) => {
  state.storage.sql.exec('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value', key, value);
});
const clockOf = (beaconId: string, ms: number) => runInDurableObject(beaconStub(testEnv, beaconId), (instance: BeaconDO) => {
  vi.spyOn(instance, 'now').mockReturnValue(ms);
});

// Any 22-char net-key-shaped string is a valid scanner net key for the DO;
// the Worker computes real ones from CF-Connecting-IP and ASN (worker/pairing/netkey.ts).
const OTHER_NET = 'a'.repeat(22);

describe('BeaconDO provisioning', () => {
  it('creates once and refuses a second create', async () => {
    const { beaconId } = await provision();
    const again = await beaconStub(testEnv, beaconId).create({ beaconId, venueType: 'zet', area: 'trnje', operatorLabel: 'x', stopId: null, secret: 'B'.repeat(32) });
    expect(again).toEqual({ created: false });
    expect(await beaconStub(testEnv, beaconId).status()).toMatchObject({ exists: true, revoked: false, kioskOnline: false, codes: 0 });
  });
  it('rejects a malformed create', async () => {
    // Asserted on the instance directly, not through the stub's RPC boundary:
    // a rejection from an RPC method reaches the caller correctly, but
    // vitest-pool-workers also logs it as an unhandled rejection at the
    // workerd level (same artifact documented in metrics-do.workers.test.ts's
    // "query validates the day shape" test), which fails the run's exit code
    // even though the rejection was properly asserted.
    const stub = beaconStub(testEnv, randomId(5));
    await runInDurableObject(stub, async (instance: BeaconDO) => {
      await expect(
        instance.create({ beaconId: 'bad', venueType: 'kafic', area: 'donji-grad', operatorLabel: 'x', stopId: null, secret: 'zz' }),
      ).rejects.toThrow();
    });
  });
});

describe('BeaconDO kiosk socket', () => {
  it('challenges, authenticates and sends an aligned batch of CODES_PER_BATCH slots', async () => {
    const { batch, kiosk } = await onlineKiosk();
    expect(batch).toHaveLength(CODES_PER_BATCH);
    expect(batch[0]!.slotStart % 30_000).toBe(0);
    expect(batch[0]!.slotStart).toBeLessThanOrEqual(Date.now());
    expect(batch[0]!.slotEnd).toBeGreaterThan(Date.now());
    for (const slot of batch) expect(await indexStub(testEnv).resolve(slot.code)).toEqual({ kind: 'kiosk', ownerId: expect.any(String) });
    kiosk.ws.close(1000, 'done');
  });

  it('does not require a network key but still refuses a non-upgrade request', async () => {
    const { beaconId } = await provision();
    const direct = await runInDurableObject(beaconStub(testEnv, beaconId), (instance: BeaconDO) =>
      instance.fetch(new Request('https://do/ws')),
    );
    expect(direct.status).toBe(400);
    const upgrade = await beaconStub(testEnv, beaconId).fetch('https://do/ws', { headers: { Upgrade: 'websocket' } });
    expect(upgrade.status).toBe(101);
    upgrade.webSocket!.accept();
    upgrade.webSocket!.close(1000, 'done');
  });

  it('closes after three wrong answers', async () => {
    const { beaconId } = await provision();
    const kiosk = await connectBeaconDirect(beaconId, KIOSK_NET_KEY);
    await kiosk.inbox.nextOfType('challenge');
    for (let i = 0; i < 3; i += 1) {
      kiosk.ws.send(JSON.stringify({ t: 'auth', hmac: 'AAAA' }));
      if (i < 2) {
        expect((await kiosk.inbox.nextOfType('error')).error).toBe('auth-failed');
        await kiosk.inbox.nextOfType('challenge');
      }
    }
    await kiosk.inbox.waitClose();
    expect(kiosk.inbox.closeCode).toBe(CLOSE_AUTH_EXHAUSTED);
  });

  it('a wrong secret against a fresh nonce fails and the right one then succeeds', async () => {
    const { beaconId, secret } = await provision();
    const kiosk = await connectBeaconDirect(beaconId, KIOSK_NET_KEY);
    const first = await kiosk.inbox.nextOfType('challenge');
    kiosk.ws.send(JSON.stringify({ t: 'auth', hmac: await kioskAnswer('wrong', String(first.nonce)) }));
    await kiosk.inbox.nextOfType('error');
    const second = await kiosk.inbox.nextOfType('challenge');
    expect(second.nonce).not.toBe(first.nonce);
    kiosk.ws.send(JSON.stringify({ t: 'auth', hmac: await kioskAnswer(secret, String(second.nonce)) }));
    expect((await kiosk.inbox.nextOfType('codes')).batch).toHaveLength(CODES_PER_BATCH);
  });

  it("'more' extends the batch instead of replacing it, so the screen never goes codeless", async () => {
    const { beaconId, batch, kiosk } = await onlineKiosk();
    // Three slots left is exactly when the client asks for more.
    const atThreeLeft = batch[CODES_PER_BATCH - 3]!.slotStart;
    await runInDurableObject(beaconStub(testEnv, beaconId), (instance: BeaconDO) => {
      vi.spyOn(instance, 'now').mockReturnValue(atThreeLeft);
    });
    kiosk.ws.send(JSON.stringify({ t: 'more' }));
    const next = (await kiosk.inbox.nextOfType('codes')).batch as CodeSlot[];

    // The code on the screen right now is still in the batch and still
    // redeemable: no dead window at the roll-over.
    const current = next.filter((s) => s.slotStart <= atThreeLeft && atThreeLeft < s.slotEnd);
    expect(current).toHaveLength(1);
    expect(current[0]!.code).toBe(batch[CODES_PER_BATCH - 3]!.code);

    const stillValid = batch.filter((s) => s.slotEnd + CODE_GRACE_MS > atThreeLeft);
    expect(next).toHaveLength(stillValid.length + CODES_PER_BATCH);
    expect(new Set(next.map((s) => s.code)).size).toBe(next.length);
    for (const slot of stillValid) expect(next.some((s) => s.code === slot.code), `${slot.code} dropped`).toBe(true);
    // The minted half still starts where the previous batch ended, and the
    // union is one unbroken run of slots.
    const minted = next.filter((s) => !batch.some((old) => old.code === s.code));
    expect(minted).toHaveLength(CODES_PER_BATCH);
    expect(minted[0]!.slotStart).toBe(batch[batch.length - 1]!.slotEnd);
    for (let i = 1; i < next.length; i += 1) expect(next[i]!.slotStart).toBe(next[i - 1]!.slotEnd);
  });

  it('a reconnecting screen is handed the codes that are still valid, not a batch ten minutes away', async () => {
    const { beaconId, secret, batch, kiosk } = await onlineKiosk();
    kiosk.ws.close(1000, 'wifi blip');
    const again = await connectBeaconDirect(beaconId, KIOSK_NET_KEY);
    const resumed = (await authKiosk(again, secret)).batch as CodeSlot[];
    const now = Date.now();
    const live = resumed.filter((slot) => slot.slotStart <= now && now < slot.slotEnd);
    expect(live, 'the reconnected screen has no current code').toHaveLength(1);
    expect(batch.some((slot) => slot.code === live[0]!.code)).toBe(true);
  });

  it('records kiosk_online once per day', async () => {
    // A distinct area (R-31 note in helpers.ts: METRICS_DO's storage is
    // shared across every `it()` in this file, not reset per test), so no
    // other test's kiosk_online write can be mistaken for this one's.
    const { beaconId, secret, kiosk } = await onlineKiosk('sesvete');
    kiosk.ws.close(1000, 'bye');
    const again = await connectBeaconDirect(beaconId, KIOSK_NET_KEY);
    await authKiosk(again, secret);
    const rows = await metricsStub(testEnv).query('2020-01-01');
    expect(rows.filter((r) => r.event === 'kiosk_online' && r.dim1 === 'sesvete').reduce((s, r) => s + r.count, 0)).toBe(1);
  });
});

describe('BeaconDO redeem', () => {
  it('opens a room, pushes unlocked to the kiosk and returns ScanOk', async () => {
    const { beaconId, batch, kiosk } = await onlineKiosk();
    const result = await beaconStub(testEnv, beaconId).redeem(batch[0]!.code, OTHER_NET);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scan).toMatchObject({ beaconType: 'kiosk', venueType: 'kafic', area: 'Donji grad', screenLabel: 'Kavana Velebit', participants: 0 });
    expect(result.scan.roomId).toMatch(/^[0-9A-HJKMNP-TV-Z]{16}$/);
    expect(result.scan.expiresAt).toBeGreaterThan(Date.now() + 9 * 60_000);
    const unlocked = await kiosk.inbox.nextOfType('unlocked');
    expect(unlocked.roomId).toBe(result.scan.roomId);
    expect(unlocked.ticket).not.toBe(result.scan.ticket);
    expect(unlocked.expiresAt).toBe(result.scan.expiresAt);
    const rows = await metricsStub(testEnv).query('2020-01-01');
    expect(rows.some((r) => r.event === 'session_start' && r.dim1 === 'kafic' && r.dim2 === 'donji-grad')).toBe(true);
  });

  it('a code is single use', async () => {
    const { beaconId, batch } = await onlineKiosk();
    // batch[0] is always inside its open window right now; batch[1] starts
    // up to CODE_ROTATE_SECONDS later and is only open within the last
    // CODE_EARLY_MS of batch[0]'s window, which would make this assertion
    // depend on wall-clock timing.
    expect((await beaconStub(testEnv, beaconId).redeem(batch[0]!.code, OTHER_NET)).ok).toBe(true);
    expect(await beaconStub(testEnv, beaconId).redeem(batch[0]!.code, OTHER_NET)).toEqual({ ok: false, error: 'code-used' });
  });

  it('honours the early window and the grace window', async () => {
    const { beaconId, batch } = await onlineKiosk();
    const stub = beaconStub(testEnv, beaconId);
    const late = batch[5]!;
    expect(await stub.redeem(late.code, OTHER_NET)).toEqual({ ok: false, error: 'code-expired' });
    await runInDurableObject(stub, (instance: BeaconDO) => {
      vi.spyOn(instance, 'now').mockReturnValue(late.slotEnd + CODE_GRACE_MS);
    });
    expect((await stub.redeem(late.code, OTHER_NET)).ok).toBe(true);
    await runInDurableObject(stub, (instance: BeaconDO) => {
      vi.spyOn(instance, 'now').mockReturnValue(batch[6]!.slotEnd + CODE_GRACE_MS + 1);
    });
    expect(await stub.redeem(batch[6]!.code, OTHER_NET)).toEqual({ ok: false, error: 'code-expired' });
  });

  it('rejects an unknown code and a code when the kiosk is offline', async () => {
    const { beaconId, batch, kiosk } = await onlineKiosk();
    expect(await beaconStub(testEnv, beaconId).redeem('ZZZZZZZZ', OTHER_NET)).toEqual({ ok: false, error: 'code-unknown' });
    kiosk.ws.close(1000, 'wifi drop');
    await kiosk.inbox.waitClose();
    expect(await beaconStub(testEnv, beaconId).redeem(batch[0]!.code, OTHER_NET)).toEqual({ ok: false, error: 'screen-offline' });
  });

  // R-30: redeem's optional third `mode` argument lets a test pin the
  // network-check mode without mutating instance.env (the test bindings fix
  // NETWORK_CHECK to 'off', so production behaviour must be exercised this way).
  it('allows the same network even when an old deployment still says enforce', async () => {
    const { beaconId, batch } = await onlineKiosk();
    const stub = beaconStub(testEnv, beaconId);
    expect((await stub.redeem(batch[0]!.code, KIOSK_NET_KEY, 'enforce')).ok).toBe(true);
    expect(await stub.redeem(batch[0]!.code, KIOSK_NET_KEY, 'warn')).toEqual({ ok: false, error: 'code-used' });
  });

  it('slows down after 20 failed redeems in 60 s', async () => {
    const { beaconId, batch } = await onlineKiosk();
    const stub = beaconStub(testEnv, beaconId);
    for (let i = 0; i < SLOW_DOWN_FAILS; i += 1) expect(await stub.redeem(batch[19]!.code, OTHER_NET)).toEqual({ ok: false, error: 'code-expired' });
    expect(await stub.redeem(batch[0]!.code, OTHER_NET)).toEqual({ ok: false, error: 'slow-down' });
    await runInDurableObject(stub, (instance: BeaconDO) => {
      vi.spyOn(instance, 'now').mockReturnValue(Date.now() + 61_000);
    });
    expect(await stub.redeem(batch[1]!.code, OTHER_NET)).not.toEqual({ ok: false, error: 'slow-down' });
  });

  // Thirty-one sequential redeems through the Durable Object, each with a spied clock, take about five seconds
  // inside workerd; vitest's default limit sat on that edge and tripped whenever the unit project's heavier
  // files ran alongside. The limit below is the run's real shape; the assertions are unchanged.
  it('counts at most CAP_PER_HOUR sessions and records over_cap beyond', { timeout: 60_000 }, async () => {
    // A distinct area, for the same reason as the kiosk_online test above:
    // METRICS_DO's storage is shared across every `it()` in this file.
    const { beaconId, batch, kiosk } = await onlineKiosk('stenjevec');
    const stub = beaconStub(testEnv, beaconId);
    let codes = [...batch];
    for (let i = 0; i < CAP_PER_HOUR + 1; i += 1) {
      if (codes.length === 0) {
        kiosk.ws.send(JSON.stringify({ t: 'more' }));
        codes = (await kiosk.inbox.nextOfType('codes')).batch as CodeSlot[];
        await runInDurableObject(stub, (instance: BeaconDO) => {
          vi.spyOn(instance, 'now').mockReturnValue(codes[0]!.slotStart);
        });
      }
      const slot = codes.shift()!;
      await runInDurableObject(stub, (instance: BeaconDO) => {
        vi.spyOn(instance, 'now').mockReturnValue(slot.slotStart);
      });
      expect((await stub.redeem(slot.code, OTHER_NET)).ok).toBe(true);
    }
    const rows = await metricsStub(testEnv).query('2020-01-01');
    const starts = rows.filter((r) => r.event === 'session_start' && r.dim2 === 'stenjevec').reduce((s, r) => s + r.count, 0);
    const over = rows.filter((r) => r.event === 'over_cap' && r.dim2 === 'stenjevec').reduce((s, r) => s + r.count, 0);
    expect(starts).toBe(CAP_PER_HOUR);
    expect(over).toBe(1);
  });

  it('revoke closes the kiosk socket, voids codes and rejects redeems', async () => {
    const { beaconId, batch, kiosk } = await onlineKiosk();
    await beaconStub(testEnv, beaconId).revoke();
    await kiosk.inbox.nextOfType('revoked');
    await kiosk.inbox.waitClose();
    expect(kiosk.inbox.closeCode).toBe(CLOSE_REVOKED);
    expect(await beaconStub(testEnv, beaconId).redeem(batch[0]!.code, OTHER_NET)).toEqual({ ok: false, error: 'revoked' });
    expect(await indexStub(testEnv).resolve(batch[0]!.code)).toBeNull();
  });
});

// WP4: the screen's own settings panel. The kiosk sends one frame; the DO
// validates it, stores it and answers through the ordinary codes+screen path,
// which is what re-frames the wall (app/src/kiosk.ts applyScreen).
describe('BeaconDO screen-set', () => {
  it('stores a validated stop and area and answers with the codes frame carrying the new screen', async () => {
    const { kiosk } = await onlineKiosk('podsljeme');
    kiosk.ws.send(JSON.stringify({ t: 'screen-set', version: 1, stopId: '106_1', area: 'zagreb' }));
    const answer = await kiosk.inbox.nextOfType('codes');
    expect(answer.screen).toMatchObject({ kind: 'venue', area: 'zagreb' });
    expect((answer.screen as { stop: { id: string; name: string; district?: string } }).stop).toMatchObject({ id: '106_1', district: 'gornji-grad-medvescak' });
    // Version 1 names a stop: the stop is the place the operator chose; the frame stays 6.
    expect(answer.screen).toMatchObject({ place: TRG_PLACE, placeSet: true, frame: 6 });
    expect((answer.batch as CodeSlot[]).length).toBeGreaterThan(0);
    kiosk.ws.close(1000, 'done');
  });

  it('clears the stop when none is chosen, keeping the area', async () => {
    const { kiosk } = await onlineKiosk('sesvete');
    kiosk.ws.send(JSON.stringify({ t: 'screen-set', version: 1, stopId: '106_1', area: 'trnje' }));
    expect((await kiosk.inbox.nextOfType('codes')).screen).toMatchObject({ area: 'trnje' });
    kiosk.ws.send(JSON.stringify({ t: 'screen-set', version: 1, stopId: null, area: 'trnje' }));
    // The window is per socket: the second frame is answered, not acted on.
    expect((await kiosk.inbox.nextOfType('error')).error).toBe('screen-set-rate');
    kiosk.ws.close(1000, 'done');
  });

  it('refuses an area or a stop it does not know, and changes nothing', async () => {
    const { beaconId, kiosk } = await onlineKiosk('brezovica');
    kiosk.ws.send(JSON.stringify({ t: 'screen-set', version: 1, stopId: null, area: 'pariz' }));
    expect((await kiosk.inbox.nextOfType('error')).error).toBe('bad-area');
    kiosk.ws.send(JSON.stringify({ t: 'screen-set', version: 1, stopId: 'invented', area: 'trnje' }));
    expect((await kiosk.inbox.nextOfType('error')).error).toBe('bad-stop');
    await runInDurableObject(beaconStub(testEnv, beaconId), (instance: BeaconDO) => {
      expect(instance.screenMetadata()).toMatchObject({ area: 'brezovica', stop: null });
    });
    kiosk.ws.close(1000, 'done');
  });

  it('drops a second frame inside the five-second window and takes the next one after it', async () => {
    const { beaconId, kiosk } = await onlineKiosk('gornja-dubrava');
    const stub = beaconStub(testEnv, beaconId);
    const at = Date.now();
    await runInDurableObject(stub, (instance: BeaconDO) => { vi.spyOn(instance, 'now').mockReturnValue(at); });
    kiosk.ws.send(JSON.stringify({ t: 'screen-set', version: 1, stopId: null, area: 'trnje' }));
    expect((await kiosk.inbox.nextOfType('codes')).screen).toMatchObject({ area: 'trnje' });
    kiosk.ws.send(JSON.stringify({ t: 'screen-set', version: 1, stopId: null, area: 'maksimir' }));
    // Answered, so the panel can say which of the two it is -- and nothing else:
    // no meta written, no batch minted.
    expect((await kiosk.inbox.nextOfType('error')).error).toBe('screen-set-rate');
    await kiosk.inbox.expectSilence(200);
    await runInDurableObject(stub, (instance: BeaconDO) => {
      expect(instance.screenMetadata()).toMatchObject({ area: 'trnje' });
      vi.spyOn(instance, 'now').mockReturnValue(at + SCREEN_SET_MIN_MS);
    });
    kiosk.ws.send(JSON.stringify({ t: 'screen-set', version: 1, stopId: null, area: 'maksimir' }));
    expect((await kiosk.inbox.nextOfType('codes')).screen).toMatchObject({ area: 'maksimir' });
    kiosk.ws.close(1000, 'done');
  });

  it('is not a way past the challenge: an unauthenticated socket that sends it is refused', async () => {
    const { beaconId } = await provision();
    const kiosk = await connectBeaconDirect(beaconId, KIOSK_NET_KEY);
    await kiosk.inbox.nextOfType('challenge');
    kiosk.ws.send(JSON.stringify({ t: 'screen-set', version: 1, stopId: '106_1', area: 'zagreb' }));
    expect((await kiosk.inbox.nextOfType('error')).error).toBe('auth-required');
    kiosk.ws.send(v2({ kind: 'stop', stopId: '106_1' }, 8));
    expect((await kiosk.inbox.nextOfType('error')).error).toBe('auth-required');
    await runInDurableObject(beaconStub(testEnv, beaconId), (instance: BeaconDO) => {
      expect(instance.screenMetadata().stop).toBeNull();
      expect(instance.screenMetadata().frame).toBe(6);
    });
    kiosk.ws.close(1000, 'done');
  });
});

// place-v2: the settings panel's toggles send { place, frame }. A stop place carries only its
// id and is resolved against the DO's own table; the area follows from the place.
describe('BeaconDO screen-set version: 2', () => {
  it('stores a stop place and frame 8 (version: 2), the stop and its district with it', async () => {
    const { beaconId, kiosk } = await onlineKiosk('podsljeme');
    kiosk.ws.send(v2({ kind: 'stop', stopId: '106_1', address: 'Trg bana Josipa Jelačića 3' }, 8));
    const answer = await kiosk.inbox.nextOfType('codes');
    expect(answer.screen).toMatchObject({
      frame: 8, area: 'gornji-grad-medvescak', stop: { id: '106_1' }, placeSet: true,
      place: { ...TRG_PLACE, address: 'Trg bana Josipa Jelačića 3' },
    });
    expect((answer.batch as CodeSlot[]).length).toBeGreaterThan(0);
    expect(await screenOf(beaconId)).toEqual(answer.screen);
    expect(await metaOf(beaconId, 'stopId')).toBe('106_1');
    kiosk.ws.close(1000, 'done');
  });

  it('stores an address place with no stop (version: 2), the area from its point', async () => {
    const { beaconId, kiosk } = await onlineKiosk('stenjevec');
    kiosk.ws.send(v2({ ...ILICA, name: '  Ilica ', stray: 'dropped' }, 4));
    const answer = await kiosk.inbox.nextOfType('codes');
    expect(answer.screen).toMatchObject({ stop: null, area: districtOf(ILICA.lon, ILICA.lat) ?? 'zagreb', frame: 4, placeSet: true });
    expect((answer.screen as ScreenMetadata).place).toEqual(ILICA);
    expect(await metaOf(beaconId, 'stopId')).toBe('');
    kiosk.ws.close(1000, 'done');
  });

  it('place null (version: 2) is the whole city: no stop, area zagreb, read back as Trg with placeSet false', async () => {
    const { beaconId, kiosk } = await onlineKiosk('crnomerec');
    kiosk.ws.send(v2(null, 6));
    const answer = await kiosk.inbox.nextOfType('codes');
    expect(answer.screen).toMatchObject({ stop: null, area: 'zagreb', place: TRG_PLACE, placeSet: false, frame: 6 });
    expect(await metaOf(beaconId, 'place')).toBe('');
    kiosk.ws.close(1000, 'done');
  });

  it('refuses a place it cannot resolve with bad-place and a frame outside 4/6/8 with bad-frame: one error frame each, nothing written, the window untouched', async () => {
    const { beaconId, kiosk } = await onlineKiosk('novi-zagreb-istok');
    const before = await screenOf(beaconId);
    const refusals: Array<[string, string]> = [
      [v2({ kind: 'stop', stopId: 'invented' }, 6), 'bad-place'],
      [v2({ kind: 'address', name: 'X', lon: 0, lat: 0 }, 6), 'bad-place'],
      [v2({ kind: 'address', name: 'Ilica\u0000', lon: 15.97, lat: 45.8135 }, 6), 'bad-place'],
      [v2({ kind: 'tram', name: 'Trg', lon: 15.97, lat: 45.81, stopId: '106_1' }, 6), 'bad-place'],
      [v2({ ...ILICA, stopId: '106_1' }, 6), 'bad-place'],
      [v2('Ilica 25', 6), 'bad-place'],
      [JSON.stringify({ t: 'screen-set', version: 2, frame: 6 }), 'bad-place'],
      [v2({ kind: 'stop', stopId: '106_1' }, 5), 'bad-frame'],
      [v2(null, '6'), 'bad-frame'],
      [JSON.stringify({ t: 'screen-set', version: 2, place: null }), 'bad-frame'],
    ];
    for (const [message, error] of refusals) {
      kiosk.ws.send(message);
      expect({ message, error: (await kiosk.inbox.nextOfType('error')).error }).toEqual({ message, error });
      // The refusal is the whole answer: no codes frame follows it.
      await kiosk.inbox.expectSilence(100);
    }
    expect(await screenOf(beaconId)).toEqual(before);
    expect(await metaOf(beaconId, 'place')).toBeNull();
    // No refusal stamped the window: a good frame is taken at once.
    kiosk.ws.send(v2({ kind: 'stop', stopId: '106_1' }, 8));
    expect((await kiosk.inbox.nextOfType('codes')).screen).toMatchObject({ place: TRG_PLACE, frame: 8 });
    kiosk.ws.close(1000, 'done');
  });

  it('answers screen-set-rate inside the window from the socket\'s own stamp, writes nothing, and a refused frame does not move the window', async () => {
    const { beaconId, kiosk } = await onlineKiosk('novi-zagreb-zapad');
    const stub = beaconStub(testEnv, beaconId);
    const at = Date.now();
    const clock = (ms: number) => runInDurableObject(stub, (instance: BeaconDO) => { vi.spyOn(instance, 'now').mockReturnValue(ms); });
    await clock(at);
    kiosk.ws.send(v2({ kind: 'stop', stopId: '106_1' }, 8));
    const applied = (await kiosk.inbox.nextOfType('codes')).screen;
    const earliest = at + SCREEN_SET_MIN_MS - SCREEN_SET_ARRIVAL_SLACK_MS;
    await clock(earliest - 1);
    kiosk.ws.send(v2(ILICA, 4));
    expect((await kiosk.inbox.nextOfType('error')).error).toBe('screen-set-rate');
    await kiosk.inbox.expectSilence(200);
    expect(await screenOf(beaconId)).toEqual(applied);
    // Measured from the last accepted frame, not from the refused one; a frame the panel
    // spaced by the full window still counts when the first one arrived a little late.
    await clock(earliest);
    kiosk.ws.send(v2(ILICA, 4));
    expect((await kiosk.inbox.nextOfType('codes')).screen).toMatchObject({ place: ILICA, frame: 4, stop: null });
    kiosk.ws.close(1000, 'done');
  });

  it('the window belongs to the beacon: a second socket and a reconnect share it, and every open socket gets each accepted change', async () => {
    const { beaconId, secret, kiosk: a } = await onlineKiosk('donja-dubrava');
    const b = await connectBeaconDirect(beaconId, KIOSK_NET_KEY);
    await authKiosk(b, secret);
    const at = Date.now();
    await clockOf(beaconId, at);
    a.ws.send(v2({ kind: 'stop', stopId: '106_1' }, 8));
    const applied = (await a.inbox.nextOfType('codes')).screen;
    expect(applied).toMatchObject({ place: TRG_PLACE, frame: 8 });
    // The other socket hears the change too, so its copy is the DO's state.
    expect((await b.inbox.nextOfType('codes')).screen).toEqual(applied);
    await clockOf(beaconId, at + 1_000);
    b.ws.send(v2(ILICA, 4));
    expect((await b.inbox.nextOfType('error')).error).toBe('screen-set-rate');
    await b.inbox.expectSilence(150);
    expect(await screenOf(beaconId)).toEqual(applied);
    // Reconnecting does not open a new window either.
    a.ws.close(1000, 'reconnect');
    const c = await connectBeaconDirect(beaconId, KIOSK_NET_KEY);
    expect((await authKiosk(c, secret)).screen).toEqual(applied);
    c.ws.send(v2(ILICA, 4));
    expect((await c.inbox.nextOfType('error')).error).toBe('screen-set-rate');
    expect(await screenOf(beaconId)).toEqual(applied);
    await clockOf(beaconId, at + SCREEN_SET_MIN_MS);
    c.ws.send(v2(ILICA, 4));
    const next = (await c.inbox.nextOfType('codes')).screen;
    expect(next).toMatchObject({ place: ILICA, frame: 4 });
    expect((await b.inbox.nextOfType('codes')).screen).toEqual(next);
    expect(await screenOf(beaconId)).toEqual(next);
    b.ws.close(1000, 'done');
    c.ws.close(1000, 'done');
  });

  it('version 1 from an old bundle keeps the frame a version 2 panel chose', async () => {
    const { beaconId, kiosk } = await onlineKiosk('pescenica-zitnjak');
    const stub = beaconStub(testEnv, beaconId);
    const at = Date.now();
    await runInDurableObject(stub, (instance: BeaconDO) => { vi.spyOn(instance, 'now').mockReturnValue(at); });
    kiosk.ws.send(v2(ILICA, 8));
    expect((await kiosk.inbox.nextOfType('codes')).screen).toMatchObject({ place: ILICA, frame: 8 });
    await runInDurableObject(stub, (instance: BeaconDO) => { vi.spyOn(instance, 'now').mockReturnValue(at + SCREEN_SET_MIN_MS); });
    kiosk.ws.send(JSON.stringify({ t: 'screen-set', version: 1, stopId: null, area: 'trnje' }));
    // No stop: no place stored, read back as Trg with placeSet false; the area stays as sent.
    expect((await kiosk.inbox.nextOfType('codes')).screen).toMatchObject({ area: 'trnje', stop: null, place: TRG_PLACE, placeSet: false, frame: 8 });
    kiosk.ws.close(1000, 'done');
  });

  it('keeps place-v2 beside city-v1 from the auth frame and drops anything else', async () => {
    const { beaconId, secret } = await provision('podsused-vrapce');
    const kiosk = await connectBeaconDirect(beaconId, KIOSK_NET_KEY);
    const { nonce } = await kiosk.inbox.nextOfType('challenge');
    kiosk.ws.send(JSON.stringify({ t: 'auth', hmac: await kioskAnswer(secret, String(nonce)), capabilities: ['place-v2', 'bogus', 'city-v1'] }));
    await kiosk.inbox.nextOfType('codes');
    const capabilities = await runInDurableObject(beaconStub(testEnv, beaconId), (_instance: BeaconDO, state: DurableObjectState) =>
      state.getWebSockets().map((ws: WebSocket) => (ws.deserializeAttachment() as { capabilities?: string[] }).capabilities));
    expect(capabilities).toEqual([['city-v1', 'place-v2']]);
    kiosk.ws.close(1000, 'done');
  });
});

// Records written before place-v2 carry no 'place' and no 'frame' meta. Nothing is
// migrated: every read derives them, so an old screen keeps naming its stop.
describe('BeaconDO legacy records', () => {
  const legacyCreate = async (stopId: string | null) => {
    const beaconId = randomId(5);
    const secret = randomId(20);
    const stop = stopId ? screenStop(stopId)! : undefined;
    expect(await beaconStub(testEnv, beaconId).create({
      beaconId, venueType: 'kafic', area: 'donji-grad', operatorLabel: 'Kavana Velebit', stopId, secret, ...(stop ? { stop } : {}),
    })).toEqual({ created: true });
    return { beaconId, secret };
  };

  it('a legacy record with a stop and no place meta reads its place from the stop, frame 6, on every path', async () => {
    const { beaconId, secret } = await legacyCreate('106_1');
    expect(await metaOf(beaconId, 'place')).toBeNull();
    expect(await metaOf(beaconId, 'frame')).toBeNull();
    const screen = await screenOf(beaconId);
    expect(screen).toMatchObject({ stop: { id: '106_1' }, area: 'donji-grad', place: TRG_PLACE, placeSet: true, frame: 6 });
    const kiosk = await connectBeaconDirect(beaconId, KIOSK_NET_KEY);
    expect((await authKiosk(kiosk, secret)).screen).toEqual(screen);
    kiosk.ws.close(1000, 'done');
  });

  it('a legacy record without a stop reads as Trg bana Jelačića with placeSet false', async () => {
    const { beaconId } = await legacyCreate(null);
    expect(await screenOf(beaconId)).toMatchObject({ stop: null, area: 'donji-grad', place: TRG_PLACE, placeSet: false, frame: 6 });
  });

  it('the default place is the table\'s Trg bana J. Jelačića, a tram place', () => {
    expect(defaultScreenPlace()).toEqual(TRG_PLACE);
    expect(DEFAULT_PLACE_STOP_ID).toBe('106_1');
    expect(TRG_STOP.name).toBe('Trg bana J. Jelačića');
    expect(enrichPlace(null, null)).toEqual({ place: TRG_PLACE, placeSet: false });
  });

  it('tells an absent place from a stored null: absent derives from the stop, null reads as Trg with placeSet false, null beside a stop is refused', async () => {
    const kvaternikov = screenStop('236_2')!;
    const legacy = await legacyCreate('236_2');
    expect(await screenOf(legacy.beaconId)).toMatchObject({
      stop: { id: '236_2' }, placeSet: true, place: { kind: 'tram', name: kvaternikov.name, stopId: '236_2' },
    });
    const cityId = randomId(5);
    expect(await beaconStub(testEnv, cityId).create({
      beaconId: cityId, venueType: 'kafic', area: 'zagreb', operatorLabel: 'x', stopId: null, secret: randomId(20), place: null, frame: 6,
    })).toEqual({ created: true });
    expect(await metaOf(cityId, 'place')).toBe('');
    expect(await screenOf(cityId)).toMatchObject({ stop: null, place: TRG_PLACE, placeSet: false });
    await runInDurableObject(beaconStub(testEnv, randomId(5)), async (instance: BeaconDO) => {
      await expect(instance.create({
        beaconId: randomId(5), venueType: 'kafic', area: 'donji-grad', operatorLabel: 'x', secret: randomId(20),
        stopId: '236_2', stop: kvaternikov, place: null,
      })).rejects.toThrow('beacon-create-invalid');
      // The stop id alone, without its stop object, is refused the same way.
      await expect(instance.create({
        beaconId: randomId(5), venueType: 'kafic', area: 'donji-grad', operatorLabel: 'x', secret: randomId(20),
        stopId: '236_2', place: null,
      })).rejects.toThrow('beacon-create-invalid');
    });
    // Should a record ever hold both, the stored null still wins on read.
    await setMetaOf(legacy.beaconId, 'place', '');
    expect(await screenOf(legacy.beaconId)).toMatchObject({ stop: { id: '236_2' }, place: TRG_PLACE, placeSet: false });
  });

  it('create() refuses a place that is not a stored place, disagrees with the stop table or names another stop than stopId', async () => {
    const stub = beaconStub(testEnv, randomId(5));
    await runInDurableObject(stub, async (instance: BeaconDO) => {
      const base = { beaconId: randomId(5), venueType: 'kafic' as const, area: 'donji-grad', operatorLabel: 'x', secret: randomId(20) };
      const refused: Array<Partial<Parameters<BeaconDO['create']>[0]>> = [
        { stopId: null, place: { ...TRG_PLACE, kind: 'tram' } },
        { stopId: '106_1', place: { kind: 'address', name: 'Ilica', lon: 15.97, lat: 45.8135 } },
        { stopId: null, place: { kind: 'address', name: 'Beč', lon: 16.37, lat: 48.21 } },
        { stopId: null, place: { kind: 'address', name: 'Ilica', lon: 15.97, lat: 45.8135, stopId: '106_1' } },
        // An invented stop id, a real one under an invented name, point or kind.
        { stopId: 'X9_9', place: { kind: 'tram', name: 'Izmišljeno', lon: 15.97, lat: 45.81, stopId: 'X9_9' } },
        { stopId: '106_1', place: { ...TRG_PLACE, kind: 'tram', name: 'Kavana Velebit' } },
        { stopId: '106_1', place: { ...TRG_PLACE, kind: 'tram', lon: 15.99 } },
        { stopId: '106_1', place: { ...TRG_PLACE, kind: 'bus' } },
        { stopId: null, place: null, frame: 5 as 6 },
      ];
      for (const shape of refused) {
        await expect(instance.create({ ...base, stopId: null, ...shape })).rejects.toThrow('beacon-create-invalid');
      }
    });
  });

  it('stores only the known fields of a place, and reads back only those', async () => {
    const stopId = randomId(5);
    const extras = { note: '<b>x</b>', secret: 'leak' };
    expect(await beaconStub(testEnv, stopId).create({
      beaconId: stopId, venueType: 'kafic', area: 'donji-grad', operatorLabel: 'x', stopId: '106_1', stop: TRG_STOP, secret: randomId(20),
      place: { ...TRG_PLACE, kind: 'tram', address: 'Trg bana Josipa Jelačića 3', ...extras } as ScreenPlace, frame: 6,
    })).toEqual({ created: true });
    expect(JSON.parse((await metaOf(stopId, 'place'))!)).toEqual({ ...TRG_PLACE, address: 'Trg bana Josipa Jelačića 3' });
    const addressId = randomId(5);
    expect(await beaconStub(testEnv, addressId).create({
      beaconId: addressId, venueType: 'kafic', area: 'donji-grad', operatorLabel: 'x', stopId: null, secret: randomId(20),
      place: { ...ILICA, ...extras } as ScreenPlace,
    })).toEqual({ created: true });
    expect(JSON.parse((await metaOf(addressId, 'place'))!)).toEqual(ILICA);
    // The read path whitelists too, and a stored stop the table no longer knows falls back to the stored stop.
    await setMetaOf(addressId, 'place', JSON.stringify({ ...ILICA, ...extras }));
    expect((await screenOf(addressId)).place).toEqual(ILICA);
    await setMetaOf(stopId, 'place', JSON.stringify({ kind: 'tram', name: 'Nestalo', lon: 15.97, lat: 45.81, stopId: 'X9_9' }));
    expect(await screenOf(stopId)).toMatchObject({ place: TRG_PLACE, placeSet: true });
  });
});
