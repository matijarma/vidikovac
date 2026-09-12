import { env, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../../worker/env';
import { IndexDO, PURGE_INTERVAL_MS, indexStub } from '../../worker/do/index-do';

const testEnv = env as unknown as Env;

describe('IndexDO codes', () => {
  it('registers a batch and resolves each code to its owner', async () => {
    const stub = indexStub(testEnv);
    const now = Date.now();
    const result = await stub.register([
      { code: 'AAAA0001', kind: 'kiosk', ownerId: 'B34C0N01', expiresAt: now + 60_000 },
      { code: 'AAAA0002', kind: 'room', ownerId: 'R00M0000000001XY', expiresAt: now + 60_000 },
    ]);
    expect(result).toEqual({ accepted: 2 });
    expect(await stub.resolve('AAAA0001')).toEqual({ kind: 'kiosk', ownerId: 'B34C0N01' });
    expect(await stub.resolve('AAAA0002')).toEqual({ kind: 'room', ownerId: 'R00M0000000001XY' });
    expect(await stub.resolve('ZZZZ9999')).toBeNull();
  });

  it('does not resolve an expired code and purges it', async () => {
    const stub = indexStub(testEnv);
    const now = Date.now();
    await stub.register([{ code: 'AAAA0003', kind: 'kiosk', ownerId: 'B34C0N01', expiresAt: now - 1 }]);
    expect(await stub.resolve('AAAA0003')).toBeNull();
    const removed = await stub.purge(now);
    expect(removed).toBe(1);
  });

  it('a later registration of the same code replaces the earlier owner', async () => {
    const stub = indexStub(testEnv);
    const now = Date.now();
    await stub.register([{ code: 'AAAA0004', kind: 'kiosk', ownerId: 'FIRST000', expiresAt: now + 60_000 }]);
    await stub.register([{ code: 'AAAA0004', kind: 'kiosk', ownerId: 'SECOND00', expiresAt: now + 60_000 }]);
    expect(await stub.resolve('AAAA0004')).toEqual({ kind: 'kiosk', ownerId: 'SECOND00' });
  });

  it('drops malformed registrations instead of throwing', async () => {
    const stub = indexStub(testEnv);
    const result = await stub.register([
      { code: 'short', kind: 'kiosk', ownerId: 'B34C0N01', expiresAt: Date.now() + 1000 },
      { code: 'AAAA0005', kind: 'other' as never, ownerId: 'B34C0N01', expiresAt: Date.now() + 1000 },
      { code: 'AAAA0006', kind: 'kiosk', ownerId: '', expiresAt: Date.now() + 1000 },
      { code: 'AAAA0007', kind: 'kiosk', ownerId: 'B34C0N01', expiresAt: Number.NaN },
    ]);
    expect(result).toEqual({ accepted: 0 });
  });

  it('arms the purge alarm on register and the alarm re-arms itself', async () => {
    const stub = indexStub(testEnv);
    const now = Date.now();
    await stub.register([{ code: 'AAAA0008', kind: 'kiosk', ownerId: 'B34C0N01', expiresAt: now + 1000 }]);
    const armedAt = await runInDurableObject(stub, (_i: IndexDO, state) => state.storage.getAlarm());
    expect(armedAt).not.toBeNull();
    expect(armedAt!).toBeLessThanOrEqual(now + PURGE_INTERVAL_MS + 1000);
    await runInDurableObject(stub, (instance: IndexDO) => {
      vi.spyOn(instance, 'now').mockReturnValue(now + 10 * 60_000);
    });
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect(await stub.resolve('AAAA0008')).toBeNull();
    const rearmed = await runInDurableObject(stub, (_i: IndexDO, state) => state.storage.getAlarm());
    expect(rearmed).toBeNull();
  });
});

describe('IndexDO beacon registry', () => {
  it('registers, lists and revokes beacons', async () => {
    const stub = indexStub(testEnv);
    await stub.registerBeacon({ beaconId: 'B34C0N01', venueType: 'kafic', area: 'donji-grad', operatorLabel: 'Kavana Velebit', stopId: null, createdAt: 1_000 });
    await stub.registerBeacon({ beaconId: 'B34C0N02', venueType: 'knjiznica', area: 'sesvete', operatorLabel: 'KGZ Sesvete', stopId: '2040', createdAt: 2_000 });
    const list = await stub.listBeacons();
    expect(list.map((b) => b.beaconId)).toEqual(['B34C0N02', 'B34C0N01']);
    expect(list[1]).toEqual({ beaconId: 'B34C0N01', venueType: 'kafic', area: 'donji-grad', operatorLabel: 'Kavana Velebit', stopId: null, createdAt: 1_000, revokedAt: null, kind: 'venue', expiresAt: null });
    await stub.markBeaconRevoked('B34C0N01', 3_000);
    expect((await stub.listBeacons()).find((b) => b.beaconId === 'B34C0N01')!.revokedAt).toBe(3_000);
  });
});
