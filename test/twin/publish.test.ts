import { describe, expect, it } from 'vitest';
import { DATA_KEYS } from '../../worker/feed/schema';
import { FEED_TICK_MS } from '../../worker/twin/clock';
import { emptyState, type TwinState } from '../../worker/twin/history';
import { buildPayload, type TripJoin } from '../../worker/twin/publish';
import type { ZetRoutes } from '../../worker/feed/modules/zet-routes';
import { isHistoryMotion } from '../../shared/motion/wire';

const T0 = 1_789_514_335;
const ROUTES: ZetRoutes = {
  '6': { shortName: '6', longName: 'Črnomerec - Sopot', type: 0 },
  '33': { shortName: '33', longName: 'Savišće - Dubrava', type: 3 },
};

function state(): TwinState {
  const s = emptyState();
  s.headerTs = T0;
  s.etag = 'W/"abc"';
  s.tickAtMs = T0 * 1000 + 1500;
  s.vehicles = {
    a: { vehicleId: 'a', routeId: '6', tripId: 't6', startDate: '20260916', fixes: [[T0 - 25, 15.97, 45.81], [T0 - 15, 15.971, 45.811], [T0 - 4, 15.972, 45.812]] },
    b: { vehicleId: 'b', routeId: '33', tripId: 't33', startDate: '20260916', fixes: [[T0 - 2, 16.03709, 45.79139]] },
    c: { vehicleId: 'c', routeId: '6', tripId: 'unknown-trip', startDate: '20260916', fixes: [[T0 - 8, 15.96, 45.80]] },
  };
  s.tripUpdates = {
    t6: { routeId: '6', seq: 4, stopId: '231_2', delaySec: 45, timeSec: T0 + 60, delays: [30, 45] },
    t33: { routeId: '33', seq: 34, stopId: '266_4', delaySec: -637, timeSec: T0 + 44, delays: [-160, -469, -637] },
  };
  return s;
}

const JOINS = new Map<string, TripJoin>([
  ['t6', { direction: 1, headsign: 'Črnomerec', shapeId: '6_12' }],
  ['t33', { direction: 0, headsign: 'Savišće', shapeId: '33_28' }],
]);

describe('buildPayload', () => {
  const nowMs = T0 * 1000 + 2_000;
  const validUntilMs = T0 * 1000 + FEED_TICK_MS + 1_500;
  const payload = buildPayload(state(), JOINS, ROUTES, nowMs, validUntilMs);
  const pins = payload.items.filter((item) => item.id.startsWith('vehicle:'));
  const rows = payload.items.filter((item) => item.id.startsWith('route:'));

  it('stamps the header time as the source time and the next tick as validUntil', () => {
    expect(payload.sourceUpdatedAt).toBe(new Date(T0 * 1000).toISOString());
    expect(payload.validUntil).toBe(new Date(validUntilMs).toISOString());
  });

  it('emits one pin per tracked vehicle at its latest fix, dated by that fix', () => {
    expect(pins.map((p) => p.id).sort()).toEqual(['vehicle:a', 'vehicle:b', 'vehicle:c']);
    const a = pins.find((p) => p.id === 'vehicle:a')!;
    expect(a.geo).toEqual({ type: 'Point', coordinates: [15.972, 45.812] });
    expect(a.at).toBe(new Date((T0 - 4) * 1000).toISOString());
    expect(a.kind).toBe('vehicle');
    expect(a.title).toBe('6 Črnomerec - Sopot');
  });

  it('carries the join and the trip update as scalars inside the closed vocabulary', () => {
    const a = pins.find((p) => p.id === 'vehicle:a')!;
    expect(a.data).toEqual({
      routeId: '6',
      tripId: 't6',
      vehicleId: 'a',
      routeShortName: '6',
      routeType: 0,
      direction: 1,
      headsign: 'Črnomerec',
      shapeId: '6_12',
      nextStopId: '231_2',
      delaySeconds: 45,
    });
    for (const item of payload.items) {
      for (const key of Object.keys(item.data ?? {})) expect(DATA_KEYS.vehicle, `${item.id} emitted ${key}`).toContain(key);
    }
  });

  it('leaves the join out for a trip the index does not know, and never guesses', () => {
    const c = pins.find((p) => p.id === 'vehicle:c')!;
    expect(c.data).not.toHaveProperty('direction');
    expect(c.data).not.toHaveProperty('headsign');
    expect(c.data).not.toHaveProperty('shapeId');
    expect(c.data).not.toHaveProperty('nextStopId');
    expect(c.data).toMatchObject({ routeId: '6', tripId: 'unknown-trip' });
  });

  it('publishes the fix history relative to the header time, oldest first', () => {
    const a = pins.find((p) => p.id === 'vehicle:a')!;
    expect(a.motion && isHistoryMotion(a.motion)).toBe(true);
    expect(a.motion && 'history' in a.motion ? a.motion.history : null).toEqual([
      [-25, 15.97, 45.81],
      [-15, 15.971, 45.811],
      [-4, 15.972, 45.812],
    ]);
  });

  it('keeps the one median-delay row per route, as the module publishes today', () => {
    expect(rows.map((r) => r.id)).toEqual(['route:33', 'route:6']);
    const six = rows.find((r) => r.id === 'route:6')!;
    // 30 and 45 -> the module rounds the even-count median, as zet-rt.ts does.
    expect(six.data).toEqual({ routeId: '6', routeShortName: '6', medianDelaySeconds: 38, vehicles: 1 });
    expect(six.summary).toBe('kasni 1 min');
    expect(rows.find((r) => r.id === 'route:33')!.data).toMatchObject({ medianDelaySeconds: -469, vehicles: 1 });
  });

  it('reports ZET as live while the header is fresh and stale once it is three ticks old', () => {
    expect(payload.sources?.zet).toEqual({
      status: 'live',
      itemCount: 3,
      fetchedAt: new Date(T0 * 1000 + 1500).toISOString(),
      sourceUpdatedAt: new Date(T0 * 1000).toISOString(),
    });
    const old = buildPayload(state(), JOINS, ROUTES, T0 * 1000 + 3 * FEED_TICK_MS + 1, validUntilMs);
    expect(old.sources?.zet.status).toBe('stale');
  });

  it('publishes nothing but the source line before the first successful frame', () => {
    const blank = buildPayload(emptyState(), JOINS, ROUTES, nowMs, validUntilMs);
    expect(blank.items).toEqual([]);
    expect(blank.sourceUpdatedAt).toBeUndefined();
    expect(blank.sources?.zet.status).toBe('stale');
  });
});
