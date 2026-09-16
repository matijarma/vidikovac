import { describe, expect, it } from 'vitest';
import { enforceOrder, HEADWAY_M } from '../../shared/motion/laws';
import { createMatcher } from '../../shared/motion/match';
import { buildPlan, evalPathPlan } from '../../shared/motion/plan';
import { estimateSpeed } from '../../shared/motion/speed';
import type { TimesProvider } from '../../shared/motion/times';
import { newTrack, type PlaneFix, type Track } from '../../shared/motion/track';
import { corridorSpec, lonLatOf, syntheticNetwork } from './synthetic-network';

const net = syntheticNetwork(corridorSpec());
const matcher = createMatcher(net);
const BANDS = { hourBand: 12, dayType: 0 as const };
const times: TimesProvider = { segmentSeconds: (_p, a, b) => (b - a) / 10, dwellSeconds: () => 20 };

function fix(x: number, atSec: number): PlaneFix {
  const { lon, lat } = lonLatOf({ x, y: 0 });
  return { x, y: 0, lon, lat, atSec };
}

/** A tram on path 1_0 with the fixes given and its plan built for `header` (seen 2 s later). */
function tram(track: Track, fixes: [x: number, atSec: number][], header: number): Track {
  const prior = matcher.priorFor('1_0', '1', 0);
  for (const [x, at] of fixes) matcher.matchFix(track, fix(x, at), prior, null);
  track.speed = estimateSpeed(track.fixes);
  buildPlan(track, net, times, null, header + 2, header, BANDS);
  return track;
}

const s = (track: Track, tSec: number, header: number) => evalPathPlan(track.plan!.on !== 'free' ? track.plan!.knots : [], tSec - header);
const monotone = (track: Track) => {
  const knots = track.plan!.on !== 'free' ? track.plan!.knots : [];
  for (let i = 1; i < knots.length; i++) if (knots[i][1] < knots[i - 1][1] - 1e-6) return false;
  return true;
};
/** Every second of the shared horizon: the leader at least a tram length ahead. */
const ordered = (leader: Track, follower: Track, header: number) => {
  for (let t = header; t <= header + 90; t++) if (s(leader, t, header) < s(follower, t, header) + HEADWAY_M - 1e-6) return false;
  return true;
};

// R-TE7: on one directed track the order of trams is kept at every knot,
// the vehicle with the OLDER evidence gives way, a pair within one tram
// length is unordered, a silent vehicle constrains nobody, a genuine swap is
// conceded only after three contradictions at a stop, and no plan ever runs
// backwards.
describe('enforceOrder', () => {
  it('pushes a stale leader ahead of a fresh follower, holds a fresh-led follower, leaves ties and silent vehicles alone, concedes a swap only at a stop after three contradictions, and never reverses', () => {
    // Tick 1 (header 1990): A leads at 1000 m, B follows 400 m behind; the
    // order is established and nothing needs moving.
    const A = newTrack('A', '1', 'trip-A', 'tram');
    const B = newTrack('B', '1', 'trip-B', 'tram');
    tram(A, [[950, 1975], [1000, 1985]], 1990); // 5 m/s
    tram(B, [[500, 1980], [600, 1990]], 1990); // 10 m/s
    let report = enforceOrder([A, B], net, 1992, 1990);
    expect(B.order.behind).toEqual(['A']);
    expect(report).toEqual({ pushes: 0, holds: 0, concessions: 0 });

    // Tick 3 (header 2010): A is silent (its fix is 25 s old, constraining
    // nobody) while B's fresh fix lands at 1230 m, ahead of A's plan. The
    // older evidence moves: A is pushed a tram length ahead of B everywhere.
    tram(B, [[1230, 2010]], 2010);
    buildPlan(A, net, times, null, 2012, 2010, BANDS);
    expect(s(A, 2010, 2010)).toBeLessThan(s(B, 2010, 2010));
    report = enforceOrder([A, B], net, 2012, 2010);
    expect(report.pushes).toBe(1);
    expect(ordered(A, B, 2010)).toBe(true);
    expect(monotone(A)).toBe(true);
    expect(B.order.contradictions.A).toBe(1);

    // Fresh leader, older follower: C's fresh fix at 1150 m, D's 10 s older
    // fix at 950 m but fast (1070 m by the header at its own 12 m/s), so D's
    // plan would run into C's dwell at T1200. The newer evidence is C's: D
    // is held behind.
    const C = newTrack('C', '1', 'trip-C', 'tram');
    const D = newTrack('D', '1', 'trip-D', 'tram');
    tram(C, [[1100, 2000], [1150, 2010]], 2010); // 5 m/s
    tram(D, [[830, 1990], [950, 2000]], 2010); // 12 m/s, last fix older
    report = enforceOrder([C, D], net, 2012, 2010);
    expect(D.order.behind).toEqual(['C']);
    buildPlan(D, net, times, null, 2012, 2010, BANDS);
    expect(ordered(C, D, 2010)).toBe(false); // D's own plan would violate the headway
    report = enforceOrder([C, D], net, 2012, 2010);
    expect(report.holds).toBe(1);
    expect(ordered(C, D, 2010)).toBe(true);
    expect(monotone(D)).toBe(true);

    // A tie within one tram length is unordered and untouched.
    const E = newTrack('E', '1', 'trip-E', 'tram');
    const F = newTrack('F', '1', 'trip-F', 'tram');
    tram(E, [[900, 2000], [1000, 2010]], 2010);
    tram(F, [[890, 2000], [990, 2010]], 2010);
    const eKnots = JSON.stringify(E.plan);
    const fKnots = JSON.stringify(F.plan);
    report = enforceOrder([E, F], net, 2012, 2010);
    expect(report).toEqual({ pushes: 0, holds: 0, concessions: 0 });
    expect(JSON.stringify(E.plan)).toBe(eKnots);
    expect(JSON.stringify(F.plan)).toBe(fKnots);
    expect(E.order.behind).toEqual([]);
    expect(F.order.behind).toEqual([]);

    // A silent leader (no fix for 52 s) constrains nobody: G's plan stands
    // even though it runs past H's stale one. G's fresh fix lies 430 m past
    // H's, more than a swap: the stale relation is dropped (R-TE52) and the
    // plans put G ahead; H, silent, can still be moved, and its continued
    // plan (which had run past G) is held behind G.
    const G = newTrack('G', '1', 'trip-G', 'tram');
    const H = newTrack('H', '1', 'trip-H', 'tram');
    tram(H, [[700, 1950], [720, 1960]], 1960); // 2 m/s between stops, then silent
    tram(G, [[500, 1980], [600, 1990]], 1990);
    enforceOrder([G, H], net, 1992, 1990); // H ahead, established
    expect(G.order.behind).toEqual(['H']);
    tram(G, [[1150, 2010]], 2010);
    buildPlan(H, net, times, null, 2012, 2010, BANDS);
    expect(ordered(H, G, 2010)).toBe(false);
    const gBefore = [2010, 2030, 2060].map((t) => s(G, t, 2010));
    report = enforceOrder([G, H], net, 2012, 2010);
    expect(report.holds).toBe(1);
    expect([2010, 2030, 2060].map((t) => s(G, t, 2010))).toEqual(gBefore);
    expect(G.order.behind).toEqual([]);
    expect(H.order.behind).toEqual(['G']);
    expect(ordered(G, H, 2010)).toBe(true);
    expect(monotone(H)).toBe(true);

    // Concession: B keeps landing ahead of A. On the third contradicting fix,
    // with A's last fix within 40 m of stop T1200, the order is conceded and
    // A becomes the follower, held behind B.
    tram(A, [[1190, 2015]], 2020); // A's fix beside T1200
    tram(B, [[1250, 2020]], 2020);
    report = enforceOrder([A, B], net, 2022, 2020);
    expect(B.order.contradictions.A).toBe(2);
    expect(report.concessions).toBe(0);
    tram(B, [[1340, 2030]], 2030);
    buildPlan(A, net, times, null, 2032, 2030, BANDS);
    report = enforceOrder([A, B], net, 2032, 2030);
    expect(report.concessions).toBe(1);
    expect(A.order.behind).toEqual(['B']);
    expect(B.order.behind).toEqual([]);
    expect(ordered(B, A, 2030)).toBe(true);
    expect(monotone(A)).toBe(true);
    expect(monotone(B)).toBe(true);

    // A trip change re-anchors: the order bookkeeping is dropped with the old path.
    matcher.matchFix(A, fix(1400, 2040), matcher.priorFor('1_1', '1', 1), null);
    expect(A.tripId).toBe('trip-A');
    expect(A.order.behind).toEqual([]);
  });
});

// R-TE52: an established order the two fixes themselves contradict by more
// than two stop spacings is a stale relation (the leader began its next trip
// at a circuit's start, a fold flipped), dropped rather than enforced; and a
// hold never places a follower behind its own fix.
describe('enforceOrder against stale relations', () => {
  it('drops a relation the fixes contradict by more than two stop spacings, and never holds a follower behind its own fix', () => {
    // P leads at 1000 m, Q follows at 600 m: established.
    const P = newTrack('P', '1', 'trip-P', 'tram');
    const Q = newTrack('Q', '1', 'trip-Q', 'tram');
    tram(P, [[950, 1975], [1000, 1985]], 1990);
    tram(Q, [[500, 1980], [600, 1990]], 1990);
    enforceOrder([P, Q], net, 1992, 1990);
    expect(Q.order.behind).toEqual(['P']);
    // P reports afresh from the path's start (its next trip), 450 m behind Q's
    // own fix: Q's plan is not dragged there; the relation goes, and the plans
    // establish the new order the other way round.
    tram(P, [[100, 2000], [150, 2010]], 2010);
    const qBefore = [2010, 2030, 2060].map((t) => s(Q, t, 2010));
    const report = enforceOrder([P, Q], net, 2012, 2010);
    expect(report).toEqual({ pushes: 0, holds: 0, concessions: 0 });
    expect([2010, 2030, 2060].map((t) => s(Q, t, 2010))).toEqual(qBefore);
    expect(Q.order.behind).toEqual([]);
    expect(P.order.behind).toEqual(['Q']);

    // R's fresh fix lands 20 m ahead of S's older one: the headway would put S
    // behind its own fix, so S is held at that fix, never behind it.
    const R = newTrack('R', '1', 'trip-R', 'tram');
    const S = newTrack('S', '1', 'trip-S', 'tram');
    tram(R, [[970, 2000], [1020, 2010]], 2010); // 5 m/s
    tram(S, [[880, 1990], [1000, 2000]], 2010); // 12 m/s, older
    S.order.behind = ['R'];
    S.order.contradictions = { R: 0 };
    const held = enforceOrder([R, S], net, 2012, 2010);
    expect(held.holds).toBe(1);
    expect(s(S, 2000, 2010)).toBeCloseTo(1000, 0);
    expect(monotone(S)).toBe(true);
  });
});
