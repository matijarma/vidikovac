import { describe, expect, it } from 'vitest';
import { createMatcher } from '../../shared/motion/match';
import {
  ANCHOR_NOISE_M,
  buildPlan,
  emptyPlanCounts,
  evalPathPlan,
  PLAN_QUANTILE,
  STAND_SCATTER_M,
} from '../../shared/motion/plan';
import { estimateSpeed } from '../../shared/motion/speed';
import type { TimesProvider } from '../../shared/motion/times';
import { newTrack, type PlaneFix, type Track } from '../../shared/motion/track';
import { corridorSpec, lonLatOf, syntheticNetwork } from './synthetic-network';

// F11's planner fixes (design section E2, D8). Each one closes a way the
// plan could run AHEAD of the tram, which is the round's forbidden error:
// a mark ahead has to come back and reads as a broken app, a mark behind
// reads as GPS lag. Plus the published floor, which is the opposite trade:
// a plan that starts a few metres behind the one published a tick ago buys
// nothing, because the client holds rather than drawing backwards.
const net = syntheticNetwork(corridorSpec());
const matcher = createMatcher(net);
const BANDS = { hourBand: 12, dayType: 0 as const };
const pathIdx = net.paths.findIndex((p) => p.id === '1_0');

function fix(x: number, atSec: number): PlaneFix {
  const { lon, lat } = lonLatOf({ x, y: 0 });
  return { x, y: 0, lon, lat, atSec };
}

/** A timetable that says 8 m/s between stops and 20 s at each. */
const eightMs: TimesProvider = {
  segmentSeconds: (_path, fromS, toS) => (toS - fromS) / 8,
  dwellSeconds: () => 20,
};

function tramOn1(id: string, fixes: [x: number, atSec: number][]): Track {
  const track = newTrack(id, '1', `trip-${id}`, 'tram');
  const prior = matcher.priorFor('1_0', '1', 0);
  for (const [x, at] of fixes) matcher.matchFix(track, fix(x, at), prior, null);
  track.speed = estimateSpeed(track.fixes);
  return track;
}

const knotsOf = (track: Track) => (track.plan && track.plan.on !== 'free' ? track.plan.knots : []);
const at = (track: Track, tSec: number, headerSec: number) => evalPathPlan(knotsOf(track), tSec - headerSec);

describe('the planner reads the vehicle state honestly (F11, D8)', () => {
  it('books the dwell for a first fix 20 m past the stop point, and drives off only when the fixes prove it drove through', () => {
    // A tram seen for the first time at T600 + 20 m: inside the platform's
    // zone, past the stop point by more than the dead zone. One fix says
    // NOTHING about whether it stood, and the round's rule is to bias behind.
    const counts = emptyPlanCounts();
    const first = tramOn1('first', [[620, 1000]]);
    buildPlan(first, net, eightMs, null, 1002, 1002, BANDS, { counts });
    expect(at(first, 1015, 1002)).toBeCloseTo(620, 0); // still at its platform
    expect(counts.stand_fix).toBe(1);
    expect(first.next?.stopId).toBe('T600');

    // The same arc reached by a run of fixes that MOVED through the zone at
    // every step: that tram is leaving, and no dwell is booked.
    const rolling = tramOn1('rolling', [[560, 1000], [620, 1008]]);
    buildPlan(rolling, net, eightMs, null, 1010, 1010, BANDS);
    expect(at(rolling, 1025, 1010)).toBeGreaterThan(660);

    // And a run that stood inside the zone keeps the rest of its dwell.
    const stood = tramOn1('stood', [[612, 1000], [618, 1010]]);
    buildPlan(stood, net, eightMs, null, 1012, 1012, BANDS);
    expect(at(stood, 1020, 1012)).toBeLessThan(640);
  });

  it('reads a stand along the arc at the GPS scatter, not at the dead zone', () => {
    // Two fixes 25 m apart in 10 s: 2.5 m/s is a tram at rest inside ZET's
    // own scatter, and the plan used to drive off at the last cruise.
    const scattered = tramOn1('scatter', [[420, 1000], [445, 1010]]);
    buildPlan(scattered, net, eightMs, null, 1012, 1012, BANDS);
    expect(at(scattered, 1020, 1012)).toBeCloseTo(445, 0);
    expect(STAND_SCATTER_M).toBe(30);

    // 40 m in 10 s is motion, and the plan moves on.
    const moving = tramOn1('moving', [[420, 1000], [460, 1010]]);
    buildPlan(moving, net, eightMs, null, 1012, 1012, BANDS);
    expect(at(moving, 1022, 1012)).toBeGreaterThan(480);
  });

  it('does not let a TripUpdate naming the next stop drive a standing tram off its platform', () => {
    // A late tram standing at T600 for 40 s. ZET's update names T900 -- the
    // very next platform -- at the header. Before F11 that alone bounded the
    // departure at the header and the plan left without the tram.
    const counts = emptyPlanCounts();
    const late = tramOn1('late', [[600, 1000], [600, 1010], [600, 1020], [600, 1030], [600, 1040]]);
    buildPlan(late, net, eightMs, { stopId: 'T900', timeSec: null, delaySec: 300, atSec: 1042 }, 1042, 1042, BANDS, { counts });
    expect(at(late, 1045, 1042)).toBeCloseTo(600, 0);
    expect(counts.eta_bound_skipped).toBe(1);

    // A stop two ahead is different evidence: something was passed in
    // between, so the tram cannot still be standing here.
    const passed = tramOn1('passed', [[600, 1000], [600, 1010], [600, 1020], [600, 1030], [600, 1040]]);
    buildPlan(passed, net, eightMs, { stopId: 'T1200', timeSec: null, delaySec: 0, atSec: 1042 }, 1042, 1042, BANDS);
    expect(at(passed, 1050, 1042)).toBeGreaterThan(600);
  });

  it('starts from the published arc when the anchor steps back inside the scatter, and from the honest anchor beyond it', () => {
    const counts = emptyPlanCounts();
    const noisy = tramOn1('noisy', [[300, 1000], [400, 1010]]);
    const anchor = noisy.match.s;
    // 20 m behind what was published a tick ago: scatter, not a reversal.
    buildPlan(noisy, net, eightMs, null, 1012, 1012, BANDS, { publishedArcS: anchor + 20, counts });
    expect(at(noisy, 1010, 1012)).toBeCloseTo(anchor + 20, 0);
    expect(counts.floor).toBe(1);

    // 40 m behind it: that is a real disagreement, and the honest plan goes
    // out even though the client will hold the mark.
    const moved = tramOn1('moved', [[300, 1000], [400, 1010]]);
    const floored = emptyPlanCounts();
    buildPlan(moved, net, eightMs, null, 1012, 1012, BANDS, { publishedArcS: anchor + 40, counts: floored });
    expect(at(moved, 1010, 1012)).toBeCloseTo(anchor, 0);
    expect(floored.floor).toBe(0);
    expect(ANCHOR_NOISE_M).toBe(25);
  });

  it('books a junction wait where trams stop, and books none where they do not', () => {
    const counts = emptyPlanCounts();
    const running = tramOn1('junction', [[1200, 1000], [1300, 1010]]);
    const junctions = { aheadOf: (path: number, s: number) => (path === pathIdx && s < 1500 ? [{ s: 1500, waitSec: 24 }] : []) };
    buildPlan(running, net, eightMs, null, 1012, 1012, BANDS, { junctions, counts });
    expect(counts.junction_wait).toBe(1);
    // The plan reaches the crossing and holds there before running on.
    const arrival = knotsOf(running).find(([, s]) => Math.abs(s - 1500) < 1);
    expect(arrival).toBeDefined();
    const held = knotsOf(running).filter(([, s]) => Math.abs(s - 1500) < 1);
    expect(held.length).toBeGreaterThanOrEqual(2);
    expect(held[held.length - 1][0] - held[0][0]).toBeGreaterThanOrEqual(20);

    // No table, no wait: the plan runs through the crossing as before.
    const straight = tramOn1('straight', [[1200, 1000], [1300, 1010]]);
    buildPlan(straight, net, eightMs, null, 1012, 1012, BANDS);
    const throughKnots = knotsOf(straight).filter(([, s]) => Math.abs(s - 1500) < 1);
    expect(throughKnots.length).toBeLessThanOrEqual(1);
  });

  it('books stretches at the planner quantile and dwells from the table', () => {
    // The provider is asked for PLAN_QUANTILE, not the median, and the dwell
    // comes from the table rather than from times.dwellSeconds.
    const asked: (number | undefined)[] = [];
    const times: TimesProvider = {
      segmentSeconds: (_p, fromS, toS, _b, _d, quantile) => {
        asked.push(quantile);
        return (toS - fromS) / 8;
      },
      dwellSeconds: () => 20,
    };
    const tram = tramOn1('q', [[350, 1000], [450, 1010]]);
    buildPlan(tram, net, times, null, 1012, 1012, BANDS, { dwell: { plannedSec: () => 45 } });
    expect(asked.every((q) => q === PLAN_QUANTILE)).toBe(true);
    expect(PLAN_QUANTILE).toBe(0.65);
    // T600 at arc 600, reached at ~8 m/s from 450 m; the 45 s dwell holds it.
    const dwellKnots = knotsOf(tram).filter(([, s]) => Math.abs(s - 600) < 1);
    expect(dwellKnots.length).toBeGreaterThanOrEqual(2);
    expect(dwellKnots[dwellKnots.length - 1][0] - dwellKnots[0][0]).toBeGreaterThanOrEqual(44);
  });
});

describe('own speed falls to zero when the vehicle stops (F11)', () => {
  it('reads an interval under the dead zone as evidence of speed about zero, within two fixes', () => {
    const cruising = [fix(100, 1000), fix(200, 1010)];
    expect(estimateSpeed(cruising)).toBeCloseTo(10, 1);
    // Two more fixes that did not move: the median of the last three
    // intervals is 0, so the planner falls back to the stretch's own time
    // rather than driving the plan off at a cruise measured before the stop.
    const stopped = [...cruising, fix(201, 1020), fix(202, 1030)];
    expect(estimateSpeed(stopped)).toBe(0);
    // One still-interval is not enough to unseat a cruise.
    expect(estimateSpeed([...cruising, fix(201, 1020)])).toBeGreaterThan(0);
  });
});
