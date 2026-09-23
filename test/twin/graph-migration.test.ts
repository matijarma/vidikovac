import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { TwinDO } from '../../worker/do/twin-do';
import { decodeNetwork, type GraphNetwork } from '../../shared/motion/network';
import { dist, toLonLat, toPlane } from '../../shared/motion/geo';
import { emptyAggregates } from '../../shared/motion/learn';
import { createEngine } from '../../worker/twin/engine';
import { emptyState, type TwinState } from '../../worker/twin/state';
import { runTick } from '../../worker/twin/tick';
import { deserializeState, serializeState } from '../../worker/twin/persist';
import { corridorIndex } from './engine-fixture';
import type { FeedPayload } from '../../worker/feed/payload';
import type { TripJoin } from '../../worker/twin/publish';

vi.mock('cloudflare:workers', () => ({ DurableObject: class {} }));
vi.mock('../../worker/metrics', () => ({ metricsStub: () => ({ recordMany: async () => {} }), recordMetric: () => {} }));
vi.mock('../../worker/twin/persist', async importOriginal => ({
  ...await importOriginal<typeof import('../../worker/twin/persist')>(),
  loadLatestState: () => saved,
  loadDwellRecent: () => ({}),
  saveState: () => 0,
}));
vi.mock('../../worker/feed/modules/zet-routes', async importOriginal => ({
  ...await importOriginal<typeof import('../../worker/feed/modules/zet-routes')>(),
  loadZetRoutes: async () => ({}),
}));

// Mechanical extracts of 0dc34d5 and aff7945's committed artefacts: one
// complete route-6 path, its edges and served stops; only indices/deltas
// are re-encoded. Same path ID, genuinely different Glavni kolodvor routing.
export const before = decodeNetwork(JSON.parse(readFileSync(new URL('../fixtures/graph-migration/before.json', import.meta.url), 'utf8')));
export const after = decodeNetwork(JSON.parse(readFileSync(new URL('../fixtures/graph-migration/after.json', import.meta.url), 'utf8')));
const pathId = 'path:6:1:e641be7c';
const T = 1_800_000_000;
let saved: TwinState;

function seed(): TwinState {
  const engine = createEngine(before, corridorIndex(before, [{ tripId: 't6', pathId }]), emptyAggregates());
  const stop = before.stops.find(s => s.name === 'Zrinjevac')!;
  const [lon, lat] = toLonLat(stop.p);
  return runTick({
    state: emptyState(), engine, nowMs: T * 1000, validUntilMs: (T + 10) * 1000, routes: {},
    joins: new Map([['t6', { direction: 1, headsign: 'Črnomerec', shapeId: null, pathId, service: 'wd' }]]),
    feed: { headerTs: T, vehicles: [{ vehicleId: 'v6', tripId: 't6', routeId: '6', lon, lat, atSec: T }], tripUpdates: [] },
  }).state;
}

async function restore(net: GraphNetwork | null, changed = true) {
  const engine = net && createEngine(net, corridorIndex(net, [{ tripId: 't6', pathId }]), emptyAggregates());
  const twin = Object.assign(Object.create(TwinDO.prototype), {
    ctx: { storage: { sql: {} } }, env: {}, net, engine, graphChanged: changed,
    learned: emptyAggregates(), dwellRecent: {}, now: () => T * 1000,
    ensureAssets: async () => {}, loadLearnedOnce: () => {}, flushLearnedIfDue: () => false,
    joinsFor: () => new Map<string, TripJoin>([['t6', { direction: 1, headsign: 'Črnomerec', shapeId: null, pathId, service: 'wd' }]]),
  }) as { restore(): Promise<void>; payload: FeedPayload; state: TwinState };
  await twin.restore();
  return twin;
}

describe('TwinDO persisted graph migration', () => {
  it('rematches Zrinjevac from real old to new geometry before its first publication', async () => {
    saved = deserializeState(serializeState(seed()));
    const oldArc = saved.tracks.v6.match.s;
    expect(oldArc).toBeCloseTo(10924.2, 0);
    const stop = after.stops.find(s => s.name === 'Zrinjevac')!;
    expect(dist(after.toPathPoint(0, oldArc), stop.p)).toBeGreaterThan(2000);
    const twin = await restore(after);
    expect(twin.state.tracks.v6.match.s).toBeCloseTo(8427.7, 0);
    const item = twin.payload.items.find(i => i.id === 'vehicle:v6')!;
    const [lon, lat] = (item.geo as { coordinates: number[] }).coordinates;
    // The platform is 2.3 m beside the rail, so compare the published
    // estimate with its real rail projection, not the platform centre.
    expect(dist(toPlane(lon, lat), after.toPathPoint(0, 8427.7))).toBeLessThan(1);
    expect(twin.state.tracks.v6.fixes.every(f => !f.arc || f.arc.s < 8500)).toBe(true);
  });

  it('keeps a changed graph unplaced while its engine is unavailable', async () => {
    saved = deserializeState(serializeState(seed()));
    const twin = await restore(null);
    expect(twin.state.tracks.v6.match.pathIdx).toBeNull();
    expect(twin.state.tracks.v6.match.shapeIdx).toBeNull();
    expect(twin.state.tracks.v6.fixes.every(f => !f.arc)).toBe(true);
    expect(twin.payload.items[0].motion).not.toHaveProperty('path');
  });

  it('preserves same-graph matches without replaying evidence', async () => {
    saved = deserializeState(serializeState(seed()));
    const match = { ...saved.tracks.v6.match };
    const twin = await restore(before, false);
    expect(twin.state.tracks.v6.match).toEqual(match);
  });
});
