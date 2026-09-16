import { describe, expect, it } from 'vitest';
import { toLonLat, toPlane } from '../../shared/motion/geo';
import { HEADWAY_M } from '../../shared/motion/laws';
import { evalFreePlan, evalPathPlan } from '../../shared/motion/plan';
import { at } from '../../shared/motion/polyline';
import { isFreeMotion, isPathMotion } from '../../shared/motion/wire';
import { DATA_KEYS } from '../../worker/feed/schema';
import { createEngine } from '../../worker/twin/engine';
import { emptyState, type TwinState } from '../../worker/twin/state';
import { runTick } from '../../worker/twin/tick';
import { simulate } from '../motion/simulator';
import { corridorSpec, lonLatOf, syntheticNetwork } from '../motion/synthetic-network';
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
      for (const horizon of Object.values(result.hindsight)) {
        for (const [bucket, n] of Object.entries(horizon)) {
          hindsightSamples += n;
          tally[bucket as keyof typeof tally] += n;
        }
      }
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

  it('gives a bus a shape plan, an unknown route a free plan, evicts five minutes of silence, and still publishes free plans without any geometry', () => {
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

    // Silence: only the bus reports for five minutes; the other vehicle is gone.
    result = runTick({ state, feed: { headerTs: T + 320, vehicles: [feed(T + 320, 900, 0).vehicles[0]], tripUpdates: [] }, nowMs: (T + 322) * 1000, joins: new Map(), routes, engine, validUntilMs: 0 });
    expect(result.evicted).toBe(1);
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
});
