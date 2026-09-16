import { describe, expect, it } from 'vitest';
import { DATA_KEYS } from '../../worker/feed/schema';
import { FEED_TICK_MS } from '../../worker/twin/clock';
import { emptyState, type TwinState } from '../../worker/twin/history';
import { buildPayload, type TripJoin } from '../../worker/twin/publish';
import type { ZetRoutes } from '../../worker/feed/modules/zet-routes';

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
    c: { vehicleId: 'c', routeId: '6', tripId: 'unknown-trip', startDate: '20260916', fixes: [[T0 - 8, 15.96, 45.8]] },
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

  it('publishes one pin per vehicle at its latest fix with the join as scalars and the history relative to the header, and no guess for a trip the index does not know', () => {
    expect(payload.sourceUpdatedAt).toBe(new Date(T0 * 1000).toISOString());
    expect(payload.validUntil).toBe(new Date(validUntilMs).toISOString());
    const a = pins.find((p) => p.id === 'vehicle:a')!;
    expect(a).toMatchObject({ kind: 'vehicle', title: '6 Črnomerec - Sopot', at: new Date((T0 - 4) * 1000).toISOString(), geo: { type: 'Point', coordinates: [15.972, 45.812] } });
    expect(a.data).toEqual({
      routeId: '6', tripId: 't6', vehicleId: 'a', routeShortName: '6', routeType: 0,
      direction: 1, headsign: 'Črnomerec', shapeId: '6_12', nextStopId: '231_2', delaySeconds: 45,
    });
    expect(a.motion).toEqual({ history: [[-25, 15.97, 45.81], [-15, 15.971, 45.811], [-4, 15.972, 45.812]] });
    const c = pins.find((p) => p.id === 'vehicle:c')!;
    for (const key of ['direction', 'headsign', 'shapeId', 'nextStopId']) expect(c.data).not.toHaveProperty(key);
    for (const item of payload.items) for (const key of Object.keys(item.data ?? {})) expect(DATA_KEYS.vehicle, `${item.id} emitted ${key}`).toContain(key);
  });

  it('keeps the one median-delay row per route, as the module always published', () => {
    const rows = payload.items.filter((r) => r.id.startsWith('route:'));
    expect(rows.map((r) => r.id)).toEqual(['route:33', 'route:6']);
    expect(rows.find((r) => r.id === 'route:6')).toMatchObject({ summary: 'kasni 1 min', data: { routeId: '6', routeShortName: '6', medianDelaySeconds: 38, vehicles: 1 } });
    expect(rows.find((r) => r.id === 'route:33')!.data).toMatchObject({ medianDelaySeconds: -469, vehicles: 1 });
  });

  it('reports ZET live while the header is fresh, stale once three ticks old, and publishes only the source line before the first frame', () => {
    expect(payload.sources?.zet).toEqual({ status: 'live', itemCount: 3, fetchedAt: new Date(T0 * 1000 + 1500).toISOString(), sourceUpdatedAt: new Date(T0 * 1000).toISOString() });
    expect(buildPayload(state(), JOINS, ROUTES, T0 * 1000 + 3 * FEED_TICK_MS + 1, validUntilMs).sources?.zet.status).toBe('stale');
    const blank = buildPayload(emptyState(), JOINS, ROUTES, nowMs, validUntilMs);
    expect(blank.items).toEqual([]);
    expect(blank.sourceUpdatedAt).toBeUndefined();
    expect(blank.sources?.zet.status).toBe('stale');
  });
});
