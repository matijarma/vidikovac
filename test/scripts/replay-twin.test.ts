import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEngine } from '../../worker/twin/engine';
import { formatTable, replayDirectory, type ReplayReport } from '../../scripts/replay-core';
import { simulate } from '../motion/simulator';
import { corridorSpec, syntheticNetwork } from '../motion/synthetic-network';
import { corridorIndex } from '../twin/engine-fixture';
import { frame as encodeFrame, type FrameTrip, type FrameVehicle } from '../twin/frames';

// The harness core over a short recorded run: the same corridor and
// simulator parameters test/motion/engine-envelope.test.ts already proves
// keeps order, never reverses and predicts within 60 m at p95 (30 s, seed
// 7), but here encoded as real GTFS-Realtime bytes (test/twin/frames.ts's
// encoder) written to a temp directory under scrambled file names, so a
// pass genuinely exercises "sorted by header time", not "sorted by name".
describe('the replay harness over a recorded corridor run', () => {
  const net = syntheticNetwork(corridorSpec());
  const sim = simulate(net, ['1_0', '2_0'], {
    trams: 6,
    headwaySec: 90,
    cruiseMs: 10,
    dwellSec: 20,
    noiseM: 8,
    refreshP: 2 / 3,
    latencyMinSec: 2,
    latencyMaxSec: 25,
    tickSec: 10,
    durationSec: 1200,
    seed: 7,
    startSec: 1_800_000_000,
  });
  const index = corridorIndex(net, sim.trams.map((t) => ({ tripId: t.tripId, pathId: t.shapeId })));
  const engine = createEngine(net, index);
  const routeOf = new Map(sim.trams.map((t) => [t.tripId, t.routeId]));

  let dir: string;
  let report: ReplayReport;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'replay-twin-test-'));
    for (let i = 0; i < sim.frames.length; i++) {
      const f = sim.frames[i];
      const vehicles: FrameVehicle[] = f.fixes.map((fx) => ({ vehicleId: fx.id, tripId: fx.tripId, routeId: fx.routeId, lat: fx.lat, lon: fx.lon, at: fx.atSec }));
      const trips: FrameTrip[] = f.updates.map((u) => ({ tripId: u.tripId, routeId: routeOf.get(u.tripId) ?? '', stops: [{ seq: 1, stopId: u.stopId, time: u.timeSec }] }));
      const bytes = encodeFrame(f.headerSec, vehicles, trips);
      // Named in the OPPOSITE order from the frame's own header time: only
      // decoding every file and sorting on its header can read this run
      // correctly, which is the property under test (deterministic, not
      // Math.random -- R-TE9 keeps randomness out of anything the engine
      // touches, and this fixture is generated once per test run).
      const name = String(sim.frames.length - 1 - i).padStart(5, '0');
      await writeFile(join(dir, `${name}.pb`), bytes);
    }
    report = await replayDirectory(dir, engine);
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('reads every frame in header order, keeps the trunk order, never reverses a plan, predicts 30 s ahead within 60 m at p95, and starts every vehicle moving', () => {
    const expectedVehicles = new Set(sim.frames.flatMap((f) => f.fixes.map((fx) => fx.id))).size;

    expect(report.frames).toBe(sim.frames.length);
    expect(report.droppedFrames).toBe(0);
    expect(report.vehicles).toBe(expectedVehicles);
    expect(report.vehicles).toBeGreaterThan(0);

    // The law (R-TE7): a swap the engine did not concede is a bug.
    expect(report.overtakes).toBe(0);
    // A tram's plan is non-decreasing on its path (R-TE7).
    expect(report.reversals).toBe(0);

    // Hindsight at 30 s: the corridor envelope's own bound (R-TE30).
    const at30 = report.hindsight[30];
    expect(at30.samples).toBeGreaterThan(50);
    expect(at30.p95).not.toBeNull();
    expect(at30.p95!.upperBoundM).toBeLessThan(60);

    // Every vehicle's first published plan is already moving, not standing.
    expect(report.neverMoved).toBe(0);
    expect(report.firstMovingS.p50).toBe(0);
    expect(report.firstMovingS.p95).toBe(0);

    // The corridor's own index resolves every trip it ever sees.
    expect(report.unknownTripShare).toBe(0);
    expect(report.directionKnownShare).toBe(1);

    const table = formatTable(report);
    console.log(table);
    expect(table).toContain(`frames processed:        ${sim.frames.length}`);
    expect(table).toContain('overtakes (must be 0):   0');
    expect(table).toContain('reversals (must be 0):   0');
  });
});
