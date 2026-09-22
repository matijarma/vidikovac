import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEngine } from '../../worker/twin/engine';
import { createGrader, formatTable, ORDER_FIX_WINDOW_S, ORDER_MIN_GAP_M, phantomStops, REGRESSION_M, replayDirectory, type ReplayReport, type TickSnapshot } from '../../scripts/replay-core';
import type { PathKnot } from '../../shared/motion/track';
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
  /** Every tick as the grader saw it, for the fault-injection tests below. */
  const snapshots: TickSnapshot[] = [];

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
    report = await replayDirectory(dir, engine, { onSnapshot: (snapshot) => snapshots.push(snapshot) });
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('reads every frame in header order, keeps the trunk order, never reverses a plan, keeps its 30 s error behind the tram, and starts every vehicle moving', () => {
    const expectedVehicles = new Set(sim.frames.flatMap((f) => f.fixes.map((fx) => fx.id))).size;

    expect(report.frames).toBe(sim.frames.length);
    expect(report.droppedFrames).toBe(0);
    expect(report.vehicles).toBe(expectedVehicles);
    expect(report.vehicles).toBeGreaterThan(0);

    // The law (R-TE7): a swap the engine did not concede is a bug.
    expect(report.overtakes).toBe(0);
    // A tram's plan is non-decreasing on its path (R-TE7).
    expect(report.reversals).toBe(0);

    // Hindsight at 30 s. Since F11 the planner is late BY DESIGN over this
    // perfectly punctual simulated fleet, so the UNSIGNED bucket p95 moved
    // from under 60 m to under 100 m: the error went to the side the round
    // wants it on. The bound that matters is the signed one -- plans 50 m or
    // more AHEAD of their tram, which the round forbids, against plans that
    // far behind, which read as GPS lag.
    //
    // T8 took the unsigned p95 past the last bucket: a tram whose newest fix
    // is more than 30 s old is held at its next stop, and at this
    // simulator's 2 to 25 s latency that is about one plan in six (about one
    // tram tick in eleven on ZET's feed), each of them far behind a punctual
    // tram by design. test/motion/engine-envelope.test.ts pins the moving
    // fleet's unsigned p95 on its own; here the median stays within 25 m,
    // the ahead tail stays under a tenth, and the behind tail under a fifth.
    const at30 = report.hindsight[30];
    expect(at30.samples).toBeGreaterThan(50);
    expect(at30.p50).not.toBeNull();
    expect(at30.p50!.upperBoundM).toBeLessThanOrEqual(25);
    expect(at30.p95).not.toBeNull();
    const signed = report.hindsightSign[30];
    const graded = signed.ahead_ge50 + signed.within50 + signed.behind_ge50;
    expect(signed.behind_ge50).toBeGreaterThan(signed.ahead_ge50);
    expect(signed.ahead_ge50 / graded).toBeLessThan(0.1);
    expect(signed.behind_ge50 / graded).toBeLessThan(0.2);

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
    // F11's two new rows: what the planner had to intervene about, and what
    // the run taught the engine (the replay feeds evidence back as the twin does).
    expect(table).toContain('planner interventions:');
    expect(table).toContain('learned by the end:');
    expect(report.learned.dwellSamples).toBeGreaterThan(0);
  });

  // F7: the grader rows. The order law the engine already enforces holds
  // (0 fix-order violations), the signed histogram counts every graded fix
  // exactly once beside the unsigned one, and the between-plan regressions
  // are measured, not assumed away: today's engine re-plans a tram back past
  // 25 m on a small minority of consecutive plan pairs (21 of 572 on this
  // corridor at seed 7 -- almost all of them a plan that had sailed a tram
  // through a stop being pulled back onto a fix that had not), which is the
  // baseline the engine tasks of round F exist to drive to zero. The bound
  // here is the order of magnitude, so the test records the pathology
  // without breaking the moment it is fixed.
  it('grades the clean corridor: 0 fix-order violations, between-plan regressions a small minority of pairs, and a signed histogram over every graded fix', () => {
    expect(snapshots.length).toBe(sim.frames.length);
    expect(report.regressions.pairs).toBeGreaterThan(100);
    expect(report.regressions.count).toBeLessThan(report.regressions.pairs / 10);
    expect(report.orderViolations.count).toBe(0);
    expect(report.orderViolations.pairs).toBeGreaterThan(0);
    for (const horizon of [10, 30, 60] as const) {
      const signed = report.hindsightSign[horizon];
      expect(signed.ahead_ge50 + signed.within50 + signed.behind_ge50).toBe(report.hindsight[horizon].samples);
    }
    const table = formatTable(report);
    expect(table).toMatch(/between-plan regressions \(>25 m\): +\d+ {2}\(of \d+ consecutive plan pairs\)/);
    expect(table).toMatch(/fix-order violations \(<=5 s, >35 m\): +0 {2}\(of \d+ fresh pairs on shared rails\)/);
    expect(table).toMatch(/30s: {2}ahead \d+\.\d%/);
  });

  it('simulates the client over the payloads at 12 Hz with polls landing at header + 3.5 s and draws no crossing on the clean corridor', () => {
    const client = report.client;
    expect(client.frames).toBeGreaterThan(sim.frames.length * 100);
    expect(client.tramFrames).toBeGreaterThan(client.frames);
    expect(client.crossings).toBe(0);
    expect(client.holdShare).not.toBeNull();
    const table = formatTable(report);
    expect(table).toMatch(/visible crossings \(must be 0\): +0\n/);
    expect(table).toMatch(/backward frames \(must be 0\): +\d+\n/);
    expect(table).toMatch(/hold-time share:\s+\d+\.\d%  mean hold length: (\d+\.\d|n\/a) s/);
  });

  it("counts phantom stops per path: the engine's list against the trip index, against the geometric derivation the served lists replace", () => {
    const phantoms = phantomStops(engine);
    const byId = new Map(phantoms.paths.map((p) => [p.id, p]));
    const trunkIdx = net.paths.findIndex((p) => p.id === '1_0');
    const trunk = byId.get('1_0')!;
    // The corridor's served lists leave the westbound platform and route 2's
    // own platform off route 1's trunk path, so the geometric row is larger
    // than the served one and no phantom survives.
    expect(trunk.geometric).toBe(net.stopsOnPathGeometric(trunkIdx).length);
    expect(trunk.served).toBe(net.stopsOnPath(trunkIdx).length);
    expect(trunk.geometric).toBeGreaterThan(trunk.served);
    expect(trunk.phantom).toBe(0);
    const synthetic = byId.get('path:9:0:abc')!;
    expect(synthetic.phantom).toBe(0);
    expect(synthetic.served).toBeGreaterThan(0);
    expect(report.phantoms.total.phantom).toBe(0);
    expect(formatTable(report)).toContain(`phantom stops:           0 of ${report.phantoms.total.geometric} geometric entries`);
  });

  // Fault injection: a pair of consecutive ticks the grader already reads
  // clean, with exactly one fault written into the second tick's published
  // plans and nothing else changed. Each counter must read 1 with the fault
  // and 0 without -- proof that it counts the thing it is named for, and
  // only that.
  it('counts an injected between-plan regression exactly once, and the same pair without it not at all', () => {
    const PULL_BACK_M = REGRESSION_M + 15; // clear of the threshold, well inside a tick's travel
    let before: TickSnapshot | null = null;
    let after: TickSnapshot | null = null;
    for (let k = 1; k < snapshots.length && after === null; k++) {
      const probe = createGrader(net);
      probe.observe(snapshots[k - 1]);
      probe.observe(snapshots[k]);
      const clean = probe.report().regressions;
      if (clean.count !== 0 || clean.pairs === 0) continue;
      // A tram planned at both ticks on the same trip, far enough along its
      // path that pulling the whole plan back stays on the geometry.
      const carried = new Set(snapshots[k - 1].vehicles.map((v) => `${v.id}|${v.tripId}`));
      const victim = snapshots[k].vehicles.find((v) => carried.has(`${v.id}|${v.tripId}`) && v.knots[0][1] > PULL_BACK_M);
      if (!victim) continue;
      before = snapshots[k - 1];
      after = {
        headerSec: snapshots[k].headerSec,
        vehicles: snapshots[k].vehicles.map((v) => (v === victim ? { ...v, knots: v.knots.map(([t, s]) => [t, s - PULL_BACK_M] as PathKnot) } : v)),
      };
    }
    expect(after).not.toBeNull();

    const injected = createGrader(net);
    injected.observe(before!);
    injected.observe(after!);
    expect(injected.report().regressions.count).toBe(1);

    // The same pair with the tram's own plan back in place reads clean.
    const clean = createGrader(net);
    clean.observe(before!);
    clean.observe(snapshots[snapshots.indexOf(before!) + 1]);
    expect(clean.report().regressions.count).toBe(0);
  });

  it('counts an injected fix-order crossing exactly once', () => {
    // A tick where two trams on the shared trunk both reported within the
    // window, more than a tram length apart: their plans are swapped, so
    // the published order contradicts the two fixes.
    let tick: TickSnapshot | null = null;
    for (const s of snapshots) {
      const onTrunk = s.vehicles.filter((v) => v.fresh && v.edge === 0);
      for (let i = 0; i < onTrunk.length && !tick; i++) {
        for (let j = i + 1; j < onTrunk.length; j++) {
          const a = onTrunk[i];
          const b = onTrunk[j];
          if (Math.abs(a.fixSec - b.fixSec) <= ORDER_FIX_WINDOW_S && Math.abs(a.fixS - b.fixS) > ORDER_MIN_GAP_M) {
            tick = { headerSec: s.headerSec, vehicles: [{ ...a, knots: b.knots }, { ...b, knots: a.knots }] };
            break;
          }
        }
      }
      if (tick) break;
    }
    expect(tick).not.toBeNull();
    const grader = createGrader(net);
    grader.observe(tick!);
    expect(grader.report().orderViolations.count).toBe(1);
    // The same two trams with their own plans read clean.
    const clean = createGrader(net);
    clean.observe({ headerSec: tick!.headerSec, vehicles: [{ ...tick!.vehicles[0], knots: tick!.vehicles[1].knots }, { ...tick!.vehicles[1], knots: tick!.vehicles[0].knots }] });
    expect(clean.report().orderViolations.count).toBe(0);
  });
});
