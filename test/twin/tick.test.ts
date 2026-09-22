import { describe, expect, it } from 'vitest';
import { toLonLat, toPlane } from '../../shared/motion/geo';
import { HEADWAY_M } from '../../shared/motion/order';
import { evalFreePlan, evalPathPlan } from '../../shared/motion/plan';
import { at } from '../../shared/motion/polyline';
import { isFreeMotion, isPathMotion } from '../../shared/motion/wire';
import { DATA_KEYS } from '../../worker/feed/schema';
import { createEngine } from '../../worker/twin/engine';
import { emptyState, type TwinState } from '../../worker/twin/state';
import { runTick } from '../../worker/twin/tick';
import { simulate } from '../motion/simulator';
import { corridorSpec, lonLatOf, syntheticNetwork } from '../motion/synthetic-network';
import type { TripJoin } from '../../worker/twin/publish';
import { corridorIndex, corridorJoins, frameAsFeed } from './engine-fixture';

// The twin's tick over the corridor: the simulator's frames go in, the
// wire comes out. What the client must be able to rely on: every tram rides
// a path plan with monotone knots, the plan's own position at the header is
// the pin, the scalars are there, the order on the shared trunk is the
// truth's, an unchanged frame still re-plans, the hindsight histogram fills
// from the second frame, buses and unknown routes get the other two plan
// forms, silence evicts, and a twin without geometry still publishes free
// plans instead of nothing.
describe('runTick on the corridor', () => {
  const net = syntheticNetwork(corridorSpec());
  const start = 1_800_000_000;
  const sim = simulate(net, ['1_0', '2_0'], {
    trams: 4,
    headwaySec: 90,
    cruiseMs: 10,
    dwellSec: 20,
    noiseM: 8,
    refreshP: 2 / 3,
    latencyMinSec: 2,
    latencyMaxSec: 25,
    tickSec: 10,
    durationSec: 600,
    seed: 11,
    startSec: start,
  });
  const index = corridorIndex(net, sim.trams.map((t) => ({ tripId: t.tripId, pathId: t.shapeId })));
  const engine = createEngine(net, index);
  const joins = corridorJoins(sim);
  const routes = { '1': { shortName: '1', longName: 'Trunk east', type: 0 }, '2': { shortName: '2', longName: 'Trunk north', type: 0 }, '109': { shortName: '109', longName: 'Bus', type: 3 } };
  const tramById = new Map(sim.trams.map((t) => [t.id, t]));

  it('learns path services and trip counts from the resolved trip records, leaving unused paths eligible', () => {
    const rankedIndex = corridorIndex(net, [
      { tripId: 'weekday-a', pathId: '1_0' },
      { tripId: 'weekday-b', pathId: '1_0' },
      { tripId: 'weekend', pathId: '1_0' },
      { tripId: 'north', pathId: '2_0' },
    ]);
    rankedIndex.tripsById.get('weekend')!.service = 'sat';
    // Count actual indexed trips, not a possibly stale pattern summary.
    rankedIndex.patterns[rankedIndex.tripsById.get('weekday-a')!.pattern].trips = 999;
    const rankedEngine = createEngine(net, rankedIndex);
    const rank = (id: string) => rankedEngine.pathRanks[net.paths.findIndex((path) => path.id === id)];
    expect(rankedEngine.pathRanks).toHaveLength(net.paths.length);
    expect(rank('1_0')).toEqual({ services: new Set(['wd', 'sat']), trips: 3 });
    expect(rank('2_0')).toEqual({ services: new Set(['wd']), trips: 1 });
    expect(rank('path:9:0:abc')).toEqual({ services: new Set(), trips: 0 });
    expect(rankedEngine.patternPathIds[rankedIndex.tripsById.get('weekday-a')!.pattern]).toBe('1_0');
  });

  it('passes services from all joins before matching the first vehicle and publishes unplaced fixes on the free plane', () => {
    const serviceIndex = corridorIndex(net, [
      { tripId: 'weekday', pathId: '1_0' },
      { tripId: 'weekend', pathId: 'path:9:0:abc' },
    ]);
    serviceIndex.tripsById.get('weekend')!.service = 'sat';
    const serviceEngine = createEngine(net, serviceIndex);
    const serviceJoins = new Map<string, TripJoin>([
      ['weekday', { direction: 0, headsign: 'Terminus', shapeId: '1_0', service: 'wd' }],
    ]);
    const feed = (offset: number) => ({
      headerTs: start + offset,
      vehicles: [
        { vehicleId: 'unknown', tripId: 'unknown-trip', routeId: '9', ...lonLatOf({ x: 500 + offset, y: 0 }), atSec: start + offset },
        { vehicleId: 'known', tripId: 'weekday', routeId: '1', ...lonLatOf({ x: 900 + offset, y: 0 }), atSec: start + offset },
      ],
      tripUpdates: [],
    });
    let state = emptyState();
    for (const offset of [0, 10, 20]) {
      const result = runTick({ state, feed: feed(offset), nowMs: (start + offset + 2) * 1000, joins: serviceJoins, routes, engine: serviceEngine, validUntilMs: 0 });
      state = result.state;
      expect(state.tracks.unknown.match.pathIdx).toBeNull();
      expect(state.tracks.unknown.offGraph).toBe(false);
      const pin = result.payload.items.find((item) => item.id === 'vehicle:unknown')!;
      expect(isFreeMotion(pin.motion!)).toBe(true);
      expect(pin.geo!.coordinates[0]).toBeCloseTo(lonLatOf({ x: 500 + offset, y: 0 }).lon, 5);
    }
    // No service information is unknown, not an empty allowed-service list.
    const result = runTick({ state, feed: feed(30), nowMs: (start + 32) * 1000, joins: new Map(), routes, engine: serviceEngine, validUntilMs: 0 });
    expect(net.paths[result.state.tracks.unknown.match.pathIdx!].id).toBe('path:9:0:abc');
    const weekdayAgain = runTick({ state: result.state, feed: feed(40), nowMs: (start + 42) * 1000, joins: serviceJoins, routes, engine: serviceEngine, validUntilMs: 0 });
    expect(weekdayAgain.state.tracks.unknown.match.pathIdx).toBeNull();
    expect(isFreeMotion(weekdayAgain.payload.items.find((item) => item.id === 'vehicle:unknown')!.motion!)).toBe(true);
  });

  it.each([0, 10])('re-matches a route change with null priors even with a %d-second GPS interval', (interval) => {
    const feed = (routeId: string, offset: number, atOffset: number) => ({
      headerTs: start + offset,
      vehicles: [{ vehicleId: 'changing', tripId: 'unknown', routeId, ...lonLatOf({ x: 600, y: 0 }), atSec: start + atOffset }],
      tripUpdates: [],
    });
    const first = runTick({ state: emptyState(), feed: feed('9', 0, 0), nowMs: (start + 2) * 1000, joins: new Map(), routes, engine, validUntilMs: 0 });
    expect(first.state.tracks.changing.priorPath).toBeNull();
    expect(net.paths[first.state.tracks.changing.match.pathIdx!].route).toBe('9');
    const changed = runTick({ state: first.state, feed: feed('1', 10, interval), nowMs: (start + 12) * 1000, joins: new Map(), routes, engine, validUntilMs: 0 });
    const track = changed.state.tracks.changing;
    expect(track.routeId).toBe('1');
    expect(track.priorPath).toBeNull();
    expect(net.paths[track.match.pathIdx!].route).toBe('1');
    expect(track.fixes).toHaveLength(interval === 0 ? 1 : 2);
    const pin = changed.payload.items.find((item) => item.id === 'vehicle:changing')!;
    expect(isPathMotion(pin.motion!) && pin.motion.path).toBe('1_0');
  });

  it('publishes path plans whose position at the header is the pin, keeps the trunk order, re-plans on an unchanged frame, and grades itself from the second frame', () => {
    let state: TwinState = emptyState();
    let hindsightSamples = 0;
    let orderChecks = 0;
    const tally = { lt25: 0, lt50: 0, lt100: 0, lt200: 0, ge200: 0 };
    for (let k = 0; k < 30; k++) {
      const frame = sim.frames[k];
      const nowMs = (frame.headerSec + 2) * 1000;
      const result = runTick({ state, feed: frameAsFeed(frame, sim), nowMs, joins, routes, engine, validUntilMs: nowMs + 10_000 });
      state = result.state;
      const pins = result.payload.items.filter((item) => item.id.startsWith('vehicle:'));
      for (const pin of pins) {
        const motion = pin.motion!;
        expect(isPathMotion(motion)).toBe(true);
        if (!isPathMotion(motion)) continue;
        const pathIdx = net.paths.findIndex((p) => p.id === motion.path);
        expect(pathIdx).toBeGreaterThanOrEqual(0);
        for (let i = 1; i < motion.plan.length; i++) expect(motion.plan[i][1]).toBeGreaterThanOrEqual(motion.plan[i - 1][1] - 1e-6);
        const [lon, lat] = toLonLat(net.toPathPoint(pathIdx, evalPathPlan(motion.plan, 0)));
        expect(pin.geo?.coordinates[0]).toBeCloseTo(lon, 5);
        expect(pin.geo?.coordinates[1]).toBeCloseTo(lat, 5);
        expect(pin.data).toMatchObject({ direction: expect.any(Number), headsign: expect.stringContaining('Kraj'), shapeId: motion.path });
        expect(typeof pin.data?.speed).toBe('number');
        expect(typeof pin.data?.confidence).toBe('number');
        expect(typeof pin.data?.held).toBe('boolean');
        expect(pin.motion).not.toHaveProperty('history');
        for (const key of Object.keys(pin.data ?? {})) expect(DATA_KEYS.vehicle, `${pin.id} emitted ${key}`).toContain(key);
      }
      // The law on the shared trunk: pairs more than a tram length apart keep the truth's order at the header.
      for (let i = 0; i < pins.length; i++) {
        for (let j = i + 1; j < pins.length; j++) {
          const a = tramById.get(pins[i].id.slice('vehicle:'.length))!.truth(frame.headerSec);
          const b = tramById.get(pins[j].id.slice('vehicle:'.length))!.truth(frame.headerSec);
          if (!a.started || !b.started || a.s >= 1500 || b.s >= 1500 || Math.abs(a.s - b.s) <= HEADWAY_M) continue;
          const pa = evalPathPlan((pins[i].motion as { plan: [number, number][] }).plan, 0);
          const pb = evalPathPlan((pins[j].motion as { plan: [number, number][] }).plan, 0);
          orderChecks++;
          expect(Math.sign(pa - pb), `frame ${k}: ${pins[i].id} vs ${pins[j].id}`).toBe(Math.sign(a.s - b.s));
        }
      }
      let signSamples = 0;
      for (const horizon of Object.values(result.hindsight)) {
        for (const [bucket, n] of Object.entries(horizon)) {
          hindsightSamples += n;
          tally[bucket as keyof typeof tally] += n;
        }
      }
      // F7: every graded fix is counted once more by its sign, in the same tick result.
      for (const horizon of Object.values(result.hindsightSign)) for (const n of Object.values(horizon)) signSamples += n;
      expect(signSamples).toBe(Object.values(result.hindsight).reduce((sum, h) => sum + Object.values(h).reduce((a, b) => a + b, 0), 0));
      if (k === 1) expect(hindsightSamples).toBe(0); // nothing to grade before a plan has aged
    }
    expect(orderChecks).toBeGreaterThan(10);
    expect(hindsightSamples).toBeGreaterThan(40);
    // Most graded predictions land within 50 m; the histogram is the operator's report card.
    const total = Object.values(tally).reduce((a, b) => a + b, 0);
    expect((tally.lt25 + tally.lt50) / total).toBeGreaterThan(0.7);

    // An unchanged frame (304, or the same header again) re-plans on the old evidence: the pins stay, validUntil moves.
    const before = runTick({ state, feed: null, nowMs: (sim.frames[29].headerSec + 12) * 1000, joins, routes, engine, validUntilMs: (sim.frames[29].headerSec + 22) * 1000 });
    expect(before.payload.items.filter((item) => item.id.startsWith('vehicle:')).length).toBeGreaterThan(0);
    expect(before.payload.validUntil).toBe(new Date((sim.frames[29].headerSec + 22) * 1000).toISOString());
    expect(before.newFixes).toBe(0);
  });

  it('keeps the track and its register through a trip change that continues on the same rails, and starts over when it does not', () => {
    // D14: ZET's vehicle ids are stable through the day; its trip ids change
    // at every terminus. Throwing the Track away at a trip change threw away
    // the fixes, the speed estimate and the order with them -- for a tram
    // that had simply started its next run on the same rails.
    const trunkAt = (x: number) => lonLatOf({ x, y: 0 });
    const twoTrams = (headerTs: number, xA: number, tripA: string, xB: number) => ({
      headerTs,
      vehicles: [
        { vehicleId: 'A', tripId: tripA, routeId: '1', lon: trunkAt(xA).lon, lat: trunkAt(xA).lat, atSec: headerTs },
        { vehicleId: 'B', tripId: 'tb', routeId: '1', lon: trunkAt(xB).lon, lat: trunkAt(xB).lat, atSec: headerTs },
      ],
      tripUpdates: [],
    });
    const on = (pathId: string, direction: 0 | 1): TripJoin => ({ direction, headsign: `Kraj ${pathId}`, shapeId: pathId, pathId });
    const identityJoins = new Map<string, TripJoin>([
      ['ta', on('1_0', 0)],
      ['ta2', on('1_0', 0)],
      ['tnorth', on('2_0', 0)],
      ['tb', on('1_0', 0)],
    ]);
    const T = start;
    let state = emptyState();
    let result = runTick({ state, feed: twoTrams(T, 1000, 'ta', 600), nowMs: (T + 2) * 1000, joins: identityJoins, routes, engine, validUntilMs: 0 });
    state = result.state;
    result = runTick({ state, feed: twoTrams(T + 10, 1100, 'ta', 700), nowMs: (T + 12) * 1000, joins: identityJoins, routes, engine, validUntilMs: 0 });
    state = result.state;
    expect(state.tracks['B'].order.leader).toBe('A');
    const fixesBefore = state.tracks['A'].fixes.length;

    // A's next trip runs the same path: the vehicle is followed straight
    // through, fixes, speed and the relation behind it intact.
    result = runTick({ state, feed: twoTrams(T + 20, 1200, 'ta2', 800), nowMs: (T + 22) * 1000, joins: identityJoins, routes, engine, validUntilMs: 0 });
    state = result.state;
    expect(state.tracks['A'].tripId).toBe('ta2');
    expect(state.tracks['A'].fixes.length).toBe(fixesBefore + 1);
    expect(state.tracks['A'].speed).toBeGreaterThan(0);
    expect(state.tracks['B'].order.leader).toBe('A');

    // Past the junction, A is on edge 1, which route 2's path never runs and
    // whose start is a kilometre and a half back: that is a different
    // vehicle's worth of evidence, and the track starts over.
    for (const [k, x] of [[30, 1700], [40, 2000]] as const) {
      result = runTick({ state, feed: twoTrams(T + k, x, 'ta2', 900), nowMs: (T + k + 2) * 1000, joins: identityJoins, routes, engine, validUntilMs: 0 });
      state = result.state;
    }
    expect(state.tracks['A'].match.edge).toBe(1);
    result = runTick({ state, feed: twoTrams(T + 50, 2100, 'tnorth', 1000), nowMs: (T + 52) * 1000, joins: identityJoins, routes, engine, validUntilMs: 0 });
    state = result.state;
    expect(state.tracks['A'].tripId).toBe('tnorth');
    expect(state.tracks['A'].fixes.length).toBe(1);
  });

  it('gives a bus a shape plan, an unknown route a free plan, evicts three minutes of silence, and still publishes free plans without any geometry', () => {
    const T = start;
    const busAt = (x: number) => lonLatOf({ x, y: -30 });
    const farAt = (x: number) => lonLatOf({ x, y: 5000 });
    const feed = (headerTs: number, xBus: number, xFar: number) => ({
      headerTs,
      vehicles: [
        { vehicleId: 'bus1', tripId: 'tb', routeId: '109', lon: busAt(xBus).lon, lat: busAt(xBus).lat, atSec: headerTs - 3 },
        { vehicleId: 'ufo', tripId: 'tu', routeId: '777', lon: farAt(xFar).lon, lat: farAt(xFar).lat, atSec: headerTs - 3 },
      ],
      tripUpdates: [],
    });
    let state = emptyState();
    let result = runTick({ state, feed: feed(T, 100, 100), nowMs: (T + 2) * 1000, joins: new Map(), routes, engine, validUntilMs: 0 });
    state = result.state;
    result = runTick({ state, feed: feed(T + 10, 180, 180), nowMs: (T + 12) * 1000, joins: new Map(), routes, engine, validUntilMs: 0 });
    state = result.state;
    const bus = result.payload.items.find((item) => item.id === 'vehicle:bus1')!;
    expect(bus.motion && isPathMotion(bus.motion) && bus.motion.path).toBe('B109');
    const shape = net.shapes[net.shapes.findIndex((s) => s.id === 'B109')];
    const busPlan = (bus.motion as { plan: [number, number][] }).plan;
    const [blon, blat] = toLonLat(at(shape.pts, shape.cum, evalPathPlan(busPlan, 0)));
    expect(bus.geo?.coordinates[0]).toBeCloseTo(blon, 5);
    expect(bus.geo?.coordinates[1]).toBeCloseTo(blat, 5);
    const ufo = result.payload.items.find((item) => item.id === 'vehicle:ufo')!;
    expect(ufo.motion && isFreeMotion(ufo.motion)).toBe(true);
    const [ulon, ulat] = evalFreePlan((ufo.motion as { plan: [number, number, number][] }).plan, 0);
    expect(ufo.geo?.coordinates[0]).toBeCloseTo(ulon, 5);
    expect(ufo.geo?.coordinates[1]).toBeCloseTo(ulat, 5);
    expect(ufo.data).not.toHaveProperty('headsign');

    // The ufo last reported at T+7: T+170 is still inside 180 seconds,
    // T+190 is outside. Keep the later frame to verify it stays gone.
    result = runTick({ state, feed: { headerTs: T + 170, vehicles: [feed(T + 170, 800, 0).vehicles[0]], tripUpdates: [] }, nowMs: (T + 172) * 1000, joins: new Map(), routes, engine, validUntilMs: 0 });
    state = result.state;
    expect(result.evicted).toBe(0);
    expect(result.payload.items.some((item) => item.id === 'vehicle:ufo')).toBe(true);
    result = runTick({ state, feed: { headerTs: T + 190, vehicles: [feed(T + 190, 850, 0).vehicles[0]], tripUpdates: [] }, nowMs: (T + 192) * 1000, joins: new Map(), routes, engine, validUntilMs: 0 });
    state = result.state;
    expect(result.evicted).toBe(1);
    expect(result.payload.items.some((item) => item.id === 'vehicle:ufo')).toBe(false);
    result = runTick({ state, feed: { headerTs: T + 320, vehicles: [feed(T + 320, 900, 0).vehicles[0]], tripUpdates: [] }, nowMs: (T + 322) * 1000, joins: new Map(), routes, engine, validUntilMs: 0 });
    expect(result.evicted).toBe(0);
    expect(result.payload.items.some((item) => item.id === 'vehicle:ufo')).toBe(false);

    // No geometry loaded at all: every vehicle rides a free plan from its own last fixes, the pin at its latest fix.
    let blind = emptyState();
    blind = runTick({ state: blind, feed: feed(T, 100, 100), nowMs: (T + 2) * 1000, joins: new Map(), routes, engine: null, validUntilMs: 0 }).state;
    const noGeometry = runTick({ state: blind, feed: feed(T + 10, 180, 180), nowMs: (T + 12) * 1000, joins: new Map(), routes, engine: null, validUntilMs: 0 });
    const blindBus = noGeometry.payload.items.find((item) => item.id === 'vehicle:bus1')!;
    expect(blindBus.motion && isFreeMotion(blindBus.motion)).toBe(true);
    expect(blindBus.geo?.coordinates[0]).toBeCloseTo(busAt(180).lon, 5);
    expect(toPlane(blindBus.geo!.coordinates[0] as number, blindBus.geo!.coordinates[1] as number).x).toBeCloseTo(180, 0);
  });

  // E3: the register's leader reaches the client on the wire, and it is
  // withdrawn the moment the register drops the relation -- `behind` is
  // derived from track.order.leader at every publish, never latched.
  it('publishes the register leader as data.behind and withdraws it when the relation goes', () => {
    const trunkAt = (x: number) => lonLatOf({ x, y: 0 });
    const twoTrams = (headerTs: number, xA: number, xB: number) => ({
      headerTs,
      vehicles: [
        { vehicleId: 'A', tripId: 'ta', routeId: '1', lon: trunkAt(xA).lon, lat: trunkAt(xA).lat, atSec: headerTs },
        { vehicleId: 'B', tripId: 'tb', routeId: '1', lon: trunkAt(xB).lon, lat: trunkAt(xB).lat, atSec: headerTs },
      ],
      tripUpdates: [],
    });
    const pairJoins = new Map<string, TripJoin>([
      ['ta', { direction: 0, headsign: 'Kraj 1_0', shapeId: '1_0', pathId: '1_0' }],
      ['tb', { direction: 0, headsign: 'Kraj 1_0', shapeId: '1_0', pathId: '1_0' }],
    ]);
    const behindOf = (result: { payload: { items: { id: string; data?: Record<string, unknown> }[] } }, id: string): unknown =>
      result.payload.items.find((item) => item.id === `vehicle:${id}`)?.data?.behind;

    const T = start;
    let state = emptyState();
    let result = runTick({ state, feed: twoTrams(T, 1000, 600), nowMs: (T + 2) * 1000, joins: pairJoins, routes, engine, validUntilMs: 0 });
    state = result.state;
    // One reading is not yet a relation, so nothing is on the wire.
    expect(behindOf(result, 'B')).toBeUndefined();
    result = runTick({ state, feed: twoTrams(T + 10, 1100, 700), nowMs: (T + 12) * 1000, joins: pairJoins, routes, engine, validUntilMs: 0 });
    state = result.state;
    expect(state.tracks['B'].order.leader).toBe('A');
    expect(behindOf(result, 'B')).toBe('A');
    expect(behindOf(result, 'A')).toBeUndefined();
    for (const key of Object.keys(result.payload.items.find((item) => item.id === 'vehicle:B')!.data ?? {})) {
      expect(DATA_KEYS.vehicle, `vehicle:B emitted ${key}`).toContain(key);
    }
    // B's next fix lands 400 m past A: more than any swap on single track,
    // so the relation is dropped -- and `behind` goes with it, that tick.
    result = runTick({ state, feed: twoTrams(T + 20, 1150, 1600), nowMs: (T + 22) * 1000, joins: pairJoins, routes, engine, validUntilMs: 0 });
    expect(result.state.tracks['B'].order.leader).toBeNull();
    expect(behindOf(result, 'B')).toBeUndefined();
  });
});
