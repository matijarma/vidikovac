import { env, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it, vi } from 'vitest';
import { BeaconDO, CAP_PER_HOUR, CLOSE_AUTH_EXHAUSTED, CLOSE_REVOKED, SLOW_DOWN_FAILS, beaconStub } from '../../worker/do/beacon-do';
import { indexStub } from '../../worker/do/index-do';
import type { Env } from '../../worker/env';
import { metricsStub } from '../../worker/metrics';
import { randomId } from '../../worker/pairing/tokens';
import { CODES_PER_BATCH, CODE_GRACE_MS, type CodeSlot } from '../../worker/protocol';
import { KIOSK_NET_KEY, authKiosk, connectBeaconDirect, kioskAnswer, onlineKiosk, provision } from './helpers';

const testEnv = env as unknown as Env;

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
    expect(rows.some((r) => r.event === 'session_start' && r.dim1 === 'kiosk' && r.dim2 === 'donji-grad')).toBe(true);
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

  it('counts at most CAP_PER_HOUR sessions and records over_cap beyond', async () => {
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
