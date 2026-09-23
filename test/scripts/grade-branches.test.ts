import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  ACCEPTANCE_ROW_KEYS,
  ACCEPTANCE_TARGETS,
  acceptanceRows,
  classifyEvent,
  countsInA,
  createBranchGrader,
  formatRows,
  formatSummary,
  grade,
  gradeDirectory,
  isParkedEpisode,
  judge,
  loadRealEngine,
  metricA,
  LOOP_HANDOVER_TERMINUS_M,
  PARKED_MIN_S,
  PARKED_RADIUS_M,
  type AcceptanceRows,
  type AcceptanceSource,
  type BranchReport,
  type GradeStop,
} from '../../scripts/grade-branches-core';
import type { GraphNetwork } from '../../shared/motion/network';
import { evalPathPlan } from '../../shared/motion/plan';
import type { Track } from '../../shared/motion/track';
import type { FeedPayload } from '../../worker/feed/payload';
import { createEngine, type Engine } from '../../worker/twin/engine';
import type { TwinState } from '../../worker/twin/state';
import { simulate } from '../motion/simulator';
import { corridorSpec, syntheticNetwork } from '../motion/synthetic-network';
import { corridorIndex, frameAsFeed } from '../twin/engine-fixture';

const root = (path: string): string => fileURLToPath(new URL(`../../${path}`, import.meta.url));

/** The corridor's platforms in the grader's shape (stops.json stands in for them on the real network). */
function corridorStops(net: GraphNetwork): GradeStop[] {
  return net.stops.map((s) => ({ id: s.id, name: s.name, p: s.p, routes: [], terminal: s.terminal }));
}

// Fault injection (WP6 §0, verifier correction 4): the clean corridor runs
// through the real loop once, one tick's state is kept, and fresh graders then
// observe that same state three times with one track's match (or plan)
// rewritten in between. No engine behaviour is exercised, so WP0 making the
// matcher refuse foreign paths cannot turn these red; each counter reads 1 with
// the fault and 0 without, proof that it counts what it is named for.
describe('the branch grader, fault injection on the corridor', () => {
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
  const stops = corridorStops(net);
  const pathIdx = (id: string): number => net.paths.findIndex((p) => p.id === id);
  const trunk = pathIdx('1_0');

  let engine: Engine;
  let clean: BranchReport;
  /** One tick of the clean run, kept whole: a route-1 tram on its own path over the shared trunk, its next stop ahead on that path. */
  let kept: { state: TwinState; headerSec: number; payload: FeedPayload; victimId: string } | null = null;

  const isVictim = (state: TwinState, track: Track): boolean => {
    if (track.kind !== 'tram' || track.routeId !== '1' || track.tripId === null) return false;
    if (track.match.pathIdx !== trunk || track.match.edge !== 0 || track.plan?.on !== 'path' || track.plan.pathIdx !== trunk) return false;
    const nextStopId = state.tripUpdates[track.tripId]?.stopId;
    const entry = net.stopsOnPath(trunk).find((e) => e.stop.id === nextStopId);
    return entry !== undefined && entry.s > evalPathPlan(track.plan.knots, 0) + 10;
  };

  beforeAll(() => {
    engine = createEngine(net, index);
    clean = grade(sim.frames.map((f) => frameAsFeed(f, sim)), engine, {
      stops,
      onTick: ({ frameNo, state, headerSec, payload }) => {
        if (kept || frameNo < 20) return;
        const victim = Object.values(state.tracks).find((track) => isVictim(state, track));
        if (victim) kept = { state: structuredClone(state), headerSec, payload: structuredClone(payload), victimId: victim.id };
      },
    });
  });

  /** Three observations of the kept tick, 10 s apart, with `edit(k, victim)` applied before observation k. */
  function observeThrice(edit: (k: number, victim: Track) => void = () => {}): BranchReport {
    expect(kept).not.toBeNull();
    const { state, headerSec, payload, victimId } = structuredClone(kept!);
    const victim = state.tracks[victimId];
    const original = { match: { ...victim.match }, plan: victim.plan };
    const grader = createBranchGrader(engine, { stops });
    for (let k = 0; k < 3; k++) {
      victim.match = { ...original.match };
      victim.plan = original.plan;
      edit(k, victim);
      grader.observe(state, headerSec + 10 * k, payload);
    }
    return grader.report();
  }

  // Only what the loop guarantees whatever the matcher decides: every frame
  // observed, every trip joined by the corridor's own index.
  it('runs the clean corridor through the loop: every frame observed, every trip joined', () => {
    expect(clean.frames).toBe(sim.frames.length);
    expect(clean.tripObservations).toBeGreaterThan(0);
    expect(clean.unknownTripShare).toBe(0);
    expect(kept).not.toBeNull();
  });

  it('counts one excursion onto another route and back exactly once each, and the untouched ticks not at all', () => {
    const untouched = observeThrice();
    expect(untouched.totals.pathChangesSameTrip).toBe(0);
    expect(acceptanceRows(untouched).B).toBe(0);

    // Tick 2 reads the tram on route 2's path over the same trunk edge (2_0
    // starts with edge 0, so the arc is the same number); tick 3 puts it back.
    const other = pathIdx('2_0');
    const injected = observeThrice((k, victim) => {
      if (k === 1) victim.match = { ...victim.match, pathIdx: other };
    });
    expect(injected.totals.pathChangesSameTrip).toBe(2);
    expect(injected.totals.byClass).toEqual({ 'onto-other-route': 1, 'back-to-own-route': 1 });
    expect(injected.otherRoute.onto).toBe(1);
    expect(injected.otherRoute.back).toBe(1);
    expect(injected.otherRoute.foreignDurationS).toMatchObject({ n: 1, max: 10 });
    const rows = acceptanceRows(injected);
    expect(rows.B).toBe(1);
    // 2_0 runs service 'wd', which the frames carry: row I stays 0.
    expect(rows.I).toBe(0);
  });

  it('counts row I only for an adoption onto a path no service of the frames runs', () => {
    // path:9:0:abc runs the same rails as 1_0 but no trip of the index uses it.
    const synthetic = pathIdx('path:9:0:abc');
    const report = observeThrice((k, victim) => {
      if (k === 1) victim.match = { ...victim.match, pathIdx: synthetic };
    });
    expect(report.otherRoute.onto).toBe(1);
    expect(report.serviceFilter).toMatchObject({ adoptions: 1, adoptionsWithoutService: 1, servicesSeen: ['wd'] });
    expect(report.serviceFilter.byPath).toEqual([['path:9:0:abc', 1]]);
    expect(acceptanceRows(report).I).toBe(1);
  });

  // Row S as D1 decision 3 redefined it (23 Sep): after 60 s of silence the
  // published anchor may not move beyond the hold at the next stop (T8), and
  // S-glide, the glide up to that hold, is printed without a target. The
  // corridor's 1_0 serves no platform between T1200 (arc 1200) and C300
  // (1800), so a tram last seen at 1260, past T1200's 40 m zone, is held at
  // C300, 540 m on.
  describe('row S, beyond the hold after 60 s of silence', () => {
    /** The kept tick three times: the fix tick, then 70 and 80 s later (+ the
     *  2 s tick cushion, silent for more than 60 s), with the victim's path
     *  plan starting at the fix (arc `fixS`) and at `anchorAt(k)` at each header. */
    function runSilence(anchorAt: (k: number, fixS: number, holdS: number) => number): BranchReport {
      const copy = structuredClone(kept!);
      const track = copy.state.tracks[copy.victimId];
      // The victim alone: every other track of the kept tick would fall silent too.
      copy.state.tracks = { [copy.victimId]: track };
      const hold = net.stopsOnPath(trunk).find((e) => e.stop.id === 'C300')!;
      const fixS = hold.s - 540;
      // ZET's TripUpdate names C300 as next, so the context counter reads the same stop.
      copy.state.tripUpdates[track.tripId!] = { ...copy.state.tripUpdates[track.tripId!]!, stopId: 'C300' };
      const grader = createBranchGrader(engine, { stops });
      for (let k = 0; k < 3; k++) {
        const s = anchorAt(k, fixS, hold.s);
        track.plan = { on: 'path', pathIdx: trunk, knots: [[-10, fixS], [0, s], [90, s]] };
        grader.observe(copy.state, copy.headerSec + (k === 0 ? 0 : 60 + 10 * k), copy.payload);
      }
      return grader.report();
    }

    it('has no platform of 1_0 between the fix at 1260 and C300', () => {
      const served = net.stopsOnPath(trunk);
      const c300 = served.find((e) => e.stop.id === 'C300')!;
      expect(c300.s).toBe(1800);
      expect(served.filter((e) => e.s > c300.s - 540 - 40 && e.s < c300.s).map((e) => e.stop.id)).toEqual([]);
    });

    it('reads a standing silent tram as 0 beyond the hold and 0 glide', () => {
      const report = runSilence((_k, fixS) => fixS);
      const rows = acceptanceRows(report);
      expect(rows.S_count).toBe(1);
      expect(rows).toMatchObject({ S: 0, S_glide: 0, S_pastNextStop: 0 });
      expect(report.totals.pathChangesSameTrip).toBe(0);
    });

    it('reads a glide to the next stop that holds there as S = 0 and S-glide = 540', () => {
      const report = runSilence((k, fixS, holdS) => (k === 0 ? fixS : holdS));
      const rows = acceptanceRows(report);
      expect(rows).toMatchObject({ S_count: 1, S: 0, S_glide: 540, S_pastNextStop: 0 });
      expect(report.ghostAdvance).toMatchObject({ measured: 1, beyondHold: 0, over50m: 0, largestBeyondHold: [] });
      expect(report.ghostAdvance.largestGlides[0]).toMatchObject({ id: kept!.victimId, route: '1', beyondHoldM: 0, glideM: 540, holdStop: 'C300', holdS: 1800 });
      expect(judge(rows, ACCEPTANCE_TARGETS.stage1).failures.filter((f) => f.startsWith('S'))).toEqual([]);
    });

    it('reads a glide that runs on past the hold as S > 0, the glide still counted up to the hold', () => {
      const report = runSilence((k, fixS, holdS) => (k === 0 ? fixS : k === 1 ? holdS : holdS + 100));
      const rows = acceptanceRows(report);
      expect(rows).toMatchObject({ S_count: 1, S_glide: 540, S_pastNextStop: 1 });
      expect(rows.S).toBeCloseTo(100, 1);
      expect(report.ghostAdvance).toMatchObject({ beyondHold: 1, over50m: 1 });
      expect(report.ghostAdvance.largestBeyondHold[0]).toMatchObject({ id: kept!.victimId, holdStop: 'C300', holdS: 1800, pastNextStop: true });
      expect(judge(rows, ACCEPTANCE_TARGETS.stage1).failures).toContain('S 100 > 50');
    });

    it('reads an overshoot within the rounding slack as the hold itself', () => {
      const report = runSilence((k, fixS, holdS) => (k === 0 ? fixS : holdS + 0.9));
      expect(acceptanceRows(report)).toMatchObject({ S: 0, S_glide: 540 });
    });
  });

  // Decision 16: an unplaced episode of at least PARKED_MIN_S whose fixes never
  // leave PARKED_RADIUS_M of its first one is a parked tram (depot or layover),
  // left out of row U; the raw share keeps it. The victim alone, on no path (its
  // nearest edge kept, not off the graph), observed once a minute for `minutes`
  // minutes with a fresh fix `offsetM(k)` metres east of where it stood.
  function observeUnplaced(minutes: number, offsetM: (k: number) => number): BranchReport {
    const { state, headerSec, payload, victimId } = structuredClone(kept!);
    const victim = state.tracks[victimId];
    state.tracks = { [victimId]: victim };
    victim.match = { ...victim.match, pathIdx: null };
    victim.offGraph = false;
    const fix0 = victim.fixes[victim.fixes.length - 1];
    const grader = createBranchGrader(engine, { stops });
    for (let k = 0; k <= minutes; k++) {
      victim.fixes = [...victim.fixes.slice(0, -1), { ...fix0, x: fix0.x + offsetM(k), atSec: fix0.atSec + 60 * k }];
      grader.observe(state, headerSec + 60 * k, payload);
    }
    return grader.report();
  }

  it('leaves a parked tram out of row U and keeps it in the raw share: ten minutes never beyond 100 m of where it stood', () => {
    expect([PARKED_MIN_S, PARKED_RADIUS_M]).toEqual([600, 100]);
    const jitter = [0, 40, 100, 60, 20, 80, 0, 90, 30, 70, 50];
    const report = observeUnplaced(10, (k) => jitter[k]);
    expect(report.unplaced.episodes).toBe(1);
    expect(report.unplaced.longest[0]).toMatchObject({ id: kept!.victimId, durationS: 600, maxDistFromStartM: 100, parked: true });
    expect(report.unplaced).toMatchObject({ vehicleHours: 0.17, parkedEpisodes: 1, parkedVehicleHours: 0.17, shareOfTramVehicleHoursRaw: 1, shareOfTramVehicleHours: 0 });
    expect(acceptanceRows(report)).toMatchObject({ U: 0, U_raw: 100, U_parkedVh: 0.17 });
  });

  it('counts a slow-moving unplaced tram (ten minutes, 101 m from where it started) and a short standing one (nine minutes) in row U', () => {
    const slow = observeUnplaced(10, (k) => 10.1 * k);
    expect(slow.unplaced.longest[0]).toMatchObject({ durationS: 600, maxDistFromStartM: 101, parked: false });
    const short = observeUnplaced(9, () => 0);
    expect(short.unplaced.longest[0]).toMatchObject({ durationS: 540, maxDistFromStartM: 0, parked: false });
    for (const report of [slow, short]) {
      expect(report.unplaced.episodes).toBe(1);
      expect(report.unplaced).toMatchObject({ parkedEpisodes: 0, parkedVehicleHours: 0, shareOfTramVehicleHoursRaw: 1, shareOfTramVehicleHours: 1 });
      expect(acceptanceRows(report)).toMatchObject({ U: 100, U_raw: 100, U_parkedVh: 0 });
    }
  });

  // Decision 16's boundary is exact: 100.4 m is beyond 100 m even though the
  // episode prints its farthest fix rounded to 100.
  it('judges the parked radius on unrounded metres: ten minutes reaching 100.4 m from where it stood is counted in row U', () => {
    expect(isParkedEpisode(600, 100)).toBe(true);
    expect(isParkedEpisode(600, 100.4)).toBe(false);
    expect(isParkedEpisode(599.9, 0)).toBe(false);
    const edge = observeUnplaced(10, (k) => (k === 5 ? 100.4 : 0));
    expect(edge.unplaced.longest[0]).toMatchObject({ durationS: 600, maxDistFromStartM: 100, parked: false });
    expect(edge.unplaced).toMatchObject({ parkedEpisodes: 0, parkedVehicleHours: 0, shareOfTramVehicleHoursRaw: 1, shareOfTramVehicleHours: 1 });
    expect(acceptanceRows(edge)).toMatchObject({ U: 100, U_raw: 100, U_parkedVh: 0 });
  });

  // Decision 35's far hand-over rule at its boundary (delta review of c449b89,
  // P2). The corridor gets two terminus loop paths appended after its own
  // (its own indices unchanged, so the kept tick reads the same): route 1's over the
  // trunk and route 2's, then, being synthetic, ahead of 'path:9:0:abc' only.
  // The victim stands alone, its fix set `terminalD` metres east of T0 (the
  // nearest terminal platform), and moves onto a loop at the second observation. The rule reads unrounded metres, as decision 16's
  // parked radius does: 300.4 m prints as 300 and is a direction flip, in rows
  // A and E; 300 m is a loop transition. The loops block accounts for every
  // loop-touching event once: own-route transitions, foreign (row B), far
  // (rows A and E).
  describe('a hand-over onto a terminus loop at the 300 m boundary', () => {
    const spec = corridorSpec();
    spec.routes.find((r) => r.id === '1')!.paths!.push({ id: 'loop:1:aaaaaaaa', direction: -1, edges: [0], synthetic: true });
    spec.routes.find((r) => r.id === '2')!.paths!.push({ id: 'loop:2:bbbbbbbb', direction: -1, edges: [0], synthetic: true });
    const netLoop = syntheticNetwork(spec);
    const ownLoop = netLoop.paths.findIndex((p) => p.id === 'loop:1:aaaaaaaa');
    const foreignLoop = netLoop.paths.findIndex((p) => p.id === 'loop:2:bbbbbbbb');

    function observeOntoLoop(terminalD: number, loopIdx: number): BranchReport {
      const { state, headerSec, payload, victimId } = structuredClone(kept!);
      const victim = state.tracks[victimId];
      // The victim's path and plan index read the same path in the loop network (the synthetic 'path:9:0:abc' alone moves, from 3 to 5).
      expect(netLoop.paths[victim.match.pathIdx!].id).toBe('1_0');
      expect(victim.plan?.on === 'path' && netLoop.paths[victim.plan.pathIdx].id).toBe('1_0');
      expect(victim.priorPath === null || victim.priorPath < 3).toBe(true);
      state.tracks = { [victimId]: victim };
      const t0 = netLoop.stops.find((s) => s.id === 'T0')!;
      expect(t0.terminal).toBe(true);
      const fix0 = victim.fixes[victim.fixes.length - 1];
      victim.fixes = [...victim.fixes.slice(0, -1), { ...fix0, x: t0.p.x + terminalD, y: t0.p.y }];
      const original = { ...victim.match };
      const engineLoop = createEngine(netLoop, corridorIndex(netLoop, sim.trams.map((t) => ({ tripId: t.tripId, pathId: t.shapeId }))));
      const grader = createBranchGrader(engineLoop, { stops: corridorStops(netLoop) });
      for (let k = 0; k < 3; k++) {
        victim.match = k === 0 ? { ...original } : { ...original, pathIdx: loopIdx };
        grader.observe(state, headerSec + 10 * k, payload);
      }
      return grader.report();
    }

    it('reads 300.4 m from the terminal as a direction flip that rows A and E count, printed as 300', () => {
      const report = observeOntoLoop(300.4, ownLoop);
      expect(report.totals.pathChangesSameTrip).toBe(1);
      expect(report.totals.byClass).toEqual({ 'direction-flip': 1 });
      expect(report.events[0]).toMatchObject({ from: '1_0', to: 'loop:1:aaaaaaaa', cls: 'direction-flip', nearestTerminal: 'T0', nearestTerminalM: 300, atTerminus: false });
      expect(report.flips).toMatchObject({ total: 1, atTerminus: 0, terminalDistanceHist: { le150: 0, le300: 0, le600: 1, gt600: 0 } });
      expect(report.loops).toMatchObject({ events: 0, onto: 0, foreignEvents: 0, farEvents: 1 });
      expect(metricA(report).n).toBe(1);
      expect(acceptanceRows(report)).toMatchObject({ B: 0, E: 1 });
    });

    it('reads 300 m from the terminal as a loop transition that neither row counts', () => {
      const report = observeOntoLoop(300, ownLoop);
      expect(report.totals.byClass).toEqual({ 'loop-transition': 1 });
      expect(report.events[0]).toMatchObject({ cls: 'loop-transition', nearestTerminalM: 300 });
      expect(report.flips).toMatchObject({ total: 0, terminalDistanceHist: { le150: 0, le300: 0, le600: 0, gt600: 0 } });
      expect(report.loops).toMatchObject({ events: 1, onto: 1, off: 0, loopToLoop: 0, foreignEvents: 0, farEvents: 0 });
      expect(metricA(report).n).toBe(0);
      expect(acceptanceRows(report)).toMatchObject({ B: 0, E: 0 });
    });

    it('reads another route\'s loop as an excursion in row B, foreign to the loops block, at any distance', () => {
      for (const terminalD of [40, 300.4]) {
        const report = observeOntoLoop(terminalD, foreignLoop);
        expect(report.totals.byClass).toEqual({ 'onto-other-route': 1 });
        expect(report.loops).toMatchObject({ events: 0, foreignEvents: 1, farEvents: 0 });
        expect(report.flips.total).toBe(0);
        expect(acceptanceRows(report)).toMatchObject({ B: 1, E: 0 });
      }
    });
  });

  it('refuses an observation after the report', () => {
    const grader = createBranchGrader(engine, { stops });
    grader.observe(kept!.state, kept!.headerSec, kept!.payload);
    grader.report();
    expect(() => grader.observe(kept!.state, kept!.headerSec + 10, kept!.payload)).toThrow(/after report/);
  });
});

// The rows as WP0 reads them, over the review grader's Monday report
// (review.local/companion/replay/branches-0921.json on the engine before WP0,
// with events, reseeds, priorChangeSamples and arcJumps.all left out). The
// file predates the loops, unplaced and silence blocks and the rows S and I,
// so A subtracts no loop events and U, S and I read "not measured".
// Decision 35 (23 Sep): A' is "the same as A inside the teaser box", so it
// leaves out what A leaves out, terminus flips and loop transitions. The
// review of lane/t-rail (finding 1): a hand-over onto or off a terminus loop
// far from any terminal is no terminus turn; 4 + 5 a day, returns from a plan
// held at the loop stand (seven after 55 to 119 s of silence, two after 14 and
// 27 s) with 249 to 754 m corrections, read as loop transitions and so out of
// rows A and E by construction. They are direction flips, and row E counts them.
describe('event classes and what rows A and A-prime count', () => {
  const base = { vehicleRoute: '13', oldRoute: '13', newRoute: '13', oldId: '13_11', newId: 'path:13:1:129fd87e', oldDirection: 1, newDirection: 1, terminalM: 40 as number | null };

  it('classes a hand-over onto or off a terminus loop as a loop transition only within 300 m of a terminal platform', () => {
    expect(LOOP_HANDOVER_TERMINUS_M).toBe(300);
    expect(classifyEvent({ ...base, oldId: 'loop:13:5c4b96ae', oldDirection: -1 })).toBe('loop-transition');
    expect(classifyEvent({ ...base, newId: 'loop:13:5c4b96ae', newDirection: -1, terminalM: 300 })).toBe('loop-transition');
    expect(classifyEvent({ ...base, oldId: 'loop:11:9297ea46', oldDirection: -1, newId: '11_3', terminalM: 308 })).toBe('direction-flip');
    // The boundary on unrounded metres: 300.4 m prints as 300 and is beyond 300 m.
    expect(classifyEvent({ ...base, newId: 'loop:13:5c4b96ae', newDirection: -1, terminalM: 300.4 })).toBe('direction-flip');
    // With no terminal platform known the loop's own word stands.
    expect(classifyEvent({ ...base, oldId: 'loop:13:5c4b96ae', oldDirection: -1, terminalM: null })).toBe('loop-transition');
    // Another line's loop stays in row B either way.
    expect(classifyEvent({ ...base, newId: 'loop:4:7cceb982', newRoute: '4', newDirection: -1, terminalM: 500 })).toBe('onto-other-route');
    expect(classifyEvent({ ...base, oldId: 'loop:4:7cceb982', oldRoute: '4', oldDirection: -1, terminalM: 10 })).toBe('back-to-own-route');
    // The other classes are untouched.
    expect(classifyEvent({ ...base })).toBe('same-route-variant');
    expect(classifyEvent({ ...base, newDirection: 0 })).toBe('direction-flip');
  });

  it('counts in A, and so in A-prime, everything but a terminus flip and a loop transition', () => {
    expect(countsInA({ cls: 'loop-transition', atTerminus: true })).toBe(false);
    expect(countsInA({ cls: 'loop-transition', atTerminus: false })).toBe(false);
    expect(countsInA({ cls: 'direction-flip', atTerminus: true })).toBe(false);
    expect(countsInA({ cls: 'direction-flip', atTerminus: false })).toBe(true);
    expect(countsInA({ cls: 'same-route-variant', atTerminus: true })).toBe(true);
    expect(countsInA({ cls: 'onto-other-route', atTerminus: false })).toBe(true);
    expect(countsInA({ cls: 'back-to-own-route', atTerminus: true })).toBe(true);
  });
});

describe('acceptanceRows and judge over the recorded Monday aggregates', () => {
  let aggregates: AcceptanceSource;
  let rows: AcceptanceRows;

  beforeAll(async () => {
    aggregates = JSON.parse(await readFile(root('test/fixtures/frames/branches-0921-aggregates.json'), 'utf8')) as AcceptanceSource;
    rows = acceptanceRows(aggregates);
  });

  it('reproduces the baseline table of the brief', () => {
    expect(rows.A).toBeCloseTo(136.5, 1);
    expect(rows).toMatchObject({ Aprime: 130.9, B: 483, C_vh: 116.4, C_fixes: 19700, D: 620, E: 196, F: 191, G: 1922, G_p95: 629.4, H: 387 });
    expect(rows).toMatchObject({ U: null, U_raw: null, U_parkedVh: null, S_count: null, S: null, S_glide: null, S_pastNextStop: null, I: null });
  });

  it('reads an unplaced block from before decision 16 as its raw share, parked time not measured', () => {
    const before16 = acceptanceRows({ ...aggregates, unplaced: { shareOfTramVehicleHours: 0.030177 } });
    expect(before16).toMatchObject({ U: 3.0177, U_raw: 3.0177, U_parkedVh: null });
    expect(judge(before16, ACCEPTANCE_TARGETS.stage1).failures).toContain('U 3.02 > 3');
  });

  it('fails stage 1 on every row, the unmeasured ones included, and passes an all-zero row set', () => {
    const verdict = judge(rows, ACCEPTANCE_TARGETS.stage1);
    expect(verdict.ok).toBe(false);
    expect(verdict.failures).toContain('B 483 > 0');
    expect(verdict.failures).toContain('S: not measured (target <= 50)');
    expect(verdict.failures).toContain('U: not measured (target <= 3)');
    expect(verdict.failures).toHaveLength(14);

    const zero = Object.fromEntries(ACCEPTANCE_ROW_KEYS.map((key) => [key, 0])) as unknown as AcceptanceRows;
    expect(judge(zero, ACCEPTANCE_TARGETS.stage1)).toEqual({ ok: true, failures: [] });
    expect(judge(zero, ACCEPTANCE_TARGETS.stage2)).toEqual({ ok: true, failures: [] });
  });

  it('holds stage 2 to A and A-prime of at most 1 and every other row as stage 1', () => {
    const three = { ...(Object.fromEntries(ACCEPTANCE_ROW_KEYS.map((key) => [key, 0])) as unknown as AcceptanceRows), A: 3, Aprime: 3, G_p95: 50, H: 60, S: 50, S_glide: 540, S_pastNextStop: 1 };
    expect(judge(three, ACCEPTANCE_TARGETS.stage1).ok).toBe(true);
    expect(judge(three, ACCEPTANCE_TARGETS.stage2).failures).toEqual(['A 3 > 1', 'Aprime 3 > 1']);
    expect(ACCEPTANCE_TARGETS.stage1.stage).toBe('stage1');
    expect(ACCEPTANCE_TARGETS.stage2.stage).toBe('stage2');
    expect(formatRows(three, ACCEPTANCE_TARGETS.stage2)).toMatch(/A\s+3\s+<= 1\s+FAIL/);
  });
});

// The committed sample through the real engine, no thresholds (those are the
// accept tier's, test/accept/wrong-turn.test.ts): it loads, every frame is
// graded and every row is a number, so `npm test` notices a sample or an
// artefact the grader can no longer read.
describe('the committed 162-frame sample', () => {
  it('grades every frame through the real engine and yields a finite row set', async () => {
    const engine = await loadRealEngine(root('app/public/data/zet-network.json'), root('app/public/data/zet-trips.json'), root('app/public/data/stop-dwell-overrides.json'));
    const report = await gradeDirectory(root('test/fixtures/frames/2026-09-21-1715-1744'), engine, { clientHz: 4, stopsPath: root('app/public/data/stops.json'), label: 'sample' });
    expect(report.frames).toBe(162);
    expect(report.droppedFrames).toBe(0);
    expect(report.tramVehicles).toBeGreaterThan(100);
    expect(report.unknownTripShare).not.toBeNull();
    const rows = acceptanceRows(report);
    for (const key of ACCEPTANCE_ROW_KEYS) expect(Number.isFinite(rows[key]), `${key} = ${rows[key]}`).toBe(true);
    expect(formatSummary(report)).toContain('acceptance rows');
  }, 180_000);
});
