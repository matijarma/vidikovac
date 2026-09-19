import { describe, expect, it } from 'vitest';
import { createMatcher, type Matcher } from '../../shared/motion/match';
import type { GraphNetwork } from '../../shared/motion/network';
import {
  edgeAt,
  enforceOrder,
  HEADWAY_M,
  mapArc,
  mapArcNear,
  onSharedRails,
  sharedStretch,
  type OrderReport,
} from '../../shared/motion/order';
import { buildPlan, evalPathPlan } from '../../shared/motion/plan';
import { estimateSpeed } from '../../shared/motion/speed';
import type { TimesProvider } from '../../shared/motion/times';
import { newTrack, type PlaneFix, type Track } from '../../shared/motion/track';
import { corridorSpec, lonLatOf, straight, syntheticNetwork } from './synthetic-network';

// The geometry the ordering register and the client's clamp share (E3): the
// corridor's trunk (edge 0, 0 to 1500 m) is run by route 1 east (path 1_0,
// edges 0 and 1), route 2 north (path 2_0, edges 0 and 2) and the shapeless
// pattern of route 9 (edges 0 and 1); edge 5 is the opposite track, which
// path 1_1 runs alone.
describe('order.ts over the corridor', () => {
  const net = syntheticNetwork(corridorSpec());
  const path = (id: string) => net.paths[net.paths.findIndex((p) => p.id === id)];
  const east = path('1_0');
  const north = path('2_0');
  const shapeless = path('path:9:0:abc');
  const back = path('1_1');

  it('reads the edge under an arc and maps an arc into another path frame', () => {
    expect(edgeAt(east, 700)).toEqual({ edge: 0, arc: 700 });
    expect(edgeAt(east, 1500)).toEqual({ edge: 1, arc: 0 });
    expect(edgeAt(east, 2000)).toEqual({ edge: 1, arc: 500 });
    // On the trunk the two routes share the edge, so the arc is the same
    // number; past the junction route 2 does not run route 1's edge at all.
    expect(mapArc(east, 700, north)).toBe(700);
    expect(mapArc(north, 700, east)).toBe(700);
    expect(mapArc(east, 2000, north)).toBeNull();
    expect(mapArc(east, 700, back)).toBeNull();
  });

  it('maps an arc onto the occurrence nearest a reference arc, not the first one', () => {
    // A circuit: line 6's path runs its own edges twice in one trip. The
    // first occurrence of the edge is a whole lap behind the second, so a
    // ceiling read from it sits a kilometre back and freezes the follower
    // (the F9 review's finding); the occurrence nearest the reader's own arc
    // is the one on the stretch the two share.
    const circuit = syntheticNetwork({
      edges: [
        { from: 0, to: 1, pts: straight(0, 1000) },
        { from: 1, to: 0, pts: [{ x: 1000, y: 0 }, { x: 1000, y: 500 }, { x: 0, y: 500 }, { x: 0, y: 0 }] },
      ],
      routes: [{ id: '6', type: 0, paths: [{ id: 'C6', direction: 0, edges: [0, 1, 0, 1], served: ['S0'] }] }],
      stops: [{ id: 'S0', edge: 0, s: 0, terminal: true }],
    });
    const laps = circuit.paths[circuit.paths.findIndex((p) => p.id === 'C6')];
    const lap = laps.offsets[2];
    expect(mapArc(laps, lap + 300, laps)).toBeCloseTo(300, 6);
    expect(mapArcNear(laps, lap + 300, laps, lap + 200)).toBeCloseTo(lap + 300, 6);
    expect(mapArcNear(laps, lap + 300, laps, 200)).toBeCloseTo(300, 6);
    // Still null where the edge is not run at all.
    expect(mapArcNear(east, 2000, north, 0)).toBeNull();
  });

  it('pairs two vehicles when either one is on rails the other runs', () => {
    // Both on the trunk, and one past the junction while the other is still
    // on the trunk the first one's path also runs: still the same rails.
    expect(onSharedRails({ path: east, s: 700 }, { path: north, s: 200 })).toBe(true);
    expect(onSharedRails({ path: east, s: 2000 }, { path: north, s: 200 })).toBe(true);
    // Past the junction on both: route 1 runs east, route 2 north.
    expect(onSharedRails({ path: east, s: 2000 }, { path: north, s: 1800 })).toBe(false);
    // The opposite track is never the same rails as the trunk.
    expect(onSharedRails({ path: east, s: 700 }, { path: back, s: 700 })).toBe(false);
  });

  it('gives the run of edges both paths keep running from where the first one stands', () => {
    // Route 1 and route 2 share the trunk and part at the junction.
    expect(sharedStretch({ path: east, s: 700 }, { path: north, s: 200 })).toEqual({ edges: [0] });
    // Route 1 and the shapeless pattern of route 9 run the same two edges.
    expect(sharedStretch({ path: east, s: 700 }, { path: shapeless, s: 100 })).toEqual({ edges: [0, 1] });
    expect(sharedStretch({ path: east, s: 1600 }, { path: shapeless, s: 100 })).toEqual({ edges: [1] });
    // Nothing in common where the first one stands, whatever they share behind it.
    expect(sharedStretch({ path: east, s: 2000 }, { path: north, s: 200 })).toBeNull();
    expect(sharedStretch({ path: east, s: 700 }, { path: back, s: 700 })).toBeNull();
  });
});

// ---- the register (E3) ------------------------------------------------------

const BANDS = { hourBand: 12, dayType: 0 as const };
const times: TimesProvider = { segmentSeconds: (_p, a, b) => (b - a) / 10, dwellSeconds: () => 20 };

function planFix(x: number, atSec: number, y = 0): PlaneFix {
  const { lon, lat } = lonLatOf({ x, y });
  return { x, y, lon, lat, atSec };
}

/** Builds a tram's fixes and its plan for `header` (the tick seen 2 s later). */
function feed(net: GraphNetwork, matcher: Matcher, track: Track, shapeId: string, direction: 0 | 1, fixes: [x: number, atSec: number, y?: number][], header: number): Track {
  const prior = matcher.priorFor(shapeId, track.routeId, direction);
  for (const [x, at, y] of fixes) matcher.matchFix(track, planFix(x, at, y ?? 0), prior, null);
  track.speed = estimateSpeed(track.fixes);
  buildPlan(track, net, times, null, header + 2, header, BANDS);
  return track;
}

const planAt = (track: Track, tSec: number, header: number): number => evalPathPlan(track.plan!.on !== 'free' ? track.plan!.knots : [], tSec - header);
const isMonotone = (track: Track): boolean => {
  const knots = track.plan!.on !== 'free' ? track.plan!.knots : [];
  for (let i = 1; i < knots.length; i++) if (knots[i][1] < knots[i - 1][1] - 1e-6) return false;
  return true;
};
/** Every second of the shared horizon: the leader at least a tram length ahead. */
const ordered = (leader: Track, follower: Track, header: number): boolean => {
  for (let t = header; t <= header + 90; t++) if (planAt(leader, t, header) < planAt(follower, t, header) + HEADWAY_M - 1e-6) return false;
  return true;
};

// The register writes an order from FIXES and then keeps it: two fresh fixes
// that read the same way round, or ZET's own TripUpdates; bunching, a
// junction's micro-edge and a crossing pair of plans all leave it standing.
describe('the ordering register', () => {
  const net = syntheticNetwork(corridorSpec());
  const tram = (id: string, routeId = '1') => newTrack(id, routeId, `trip-${id}`, 'tram');

  it('needs two fresh fixes that agree, and never reads the order off the plans', () => {
    const matcher = createMatcher(net);
    const A = tram('A');
    const B = tram('B');
    feed(net, matcher, A, '1_0', 0, [[950, 1975], [1000, 1985]], 1990);
    feed(net, matcher, B, '1_0', 0, [[500, 1980], [600, 1990]], 1990);
    // One reading is a reading: the plans put A 400 m ahead and the register
    // still writes nothing.
    let report = enforceOrder([A, B], net, 1992, 1990);
    expect(B.order.leader).toBeNull();
    expect(A.order.leader).toBeNull();
    expect(report.established).toBe(0);
    // A second pass over the SAME fixes is the same observation, not a second one.
    report = enforceOrder([A, B], net, 1992, 1990);
    expect(report.established).toBe(0);
    // The next tick's fixes agree: the relation is written, in B's favour of nothing.
    feed(net, matcher, A, '1_0', 0, [[1050, 1995]], 2000);
    feed(net, matcher, B, '1_0', 0, [[700, 2000]], 2000);
    report = enforceOrder([A, B], net, 2002, 2000);
    expect(report.established).toBe(1);
    expect(B.order.leader).toBe('A');
    expect(A.order.leader).toBeNull();
    expect(report.relations).toBe(1);
  });

  it('keeps a bunched pair in order through sixty seconds nose to tail', () => {
    const matcher = createMatcher(net);
    const A = tram('A');
    const B = tram('B');
    feed(net, matcher, A, '1_0', 0, [[900, 1980], [1000, 1990]], 1990);
    feed(net, matcher, B, '1_0', 0, [[800, 1980], [880, 1990]], 1990);
    enforceOrder([A, B], net, 1992, 1990);
    feed(net, matcher, A, '1_0', 0, [[1080, 2000]], 2000);
    feed(net, matcher, B, '1_0', 0, [[960, 2000]], 2000);
    enforceOrder([A, B], net, 2002, 2000);
    expect(B.order.leader).toBe('A');
    // Now they close up: six ticks with the pair inside a tram length, the
    // gap the pairwise law called "unordered" and re-derived from scratch.
    for (let k = 1; k <= 6; k++) {
      const header = 2000 + k * 10;
      feed(net, matcher, A, '1_0', 0, [[1080 + k * 20, header]], header);
      feed(net, matcher, B, '1_0', 0, [[1060 + k * 20, header]], header);
      enforceOrder([A, B], net, header + 2, header);
      expect(B.order.leader, `tick ${k}`).toBe('A');
      // And B's plan never passes A's anywhere on the horizon.
      for (let t = header; t <= header + 60; t++) expect(planAt(B, t, header)).toBeLessThanOrEqual(planAt(A, t, header) + 1e-6);
    }
  });

  it('survives the leader crossing a junction micro-edge the follower never runs', () => {
    // A noded junction leaves a metre-long edge behind (edge 1 here, 1400 to
    // 1406 m): route 1 runs it on its way east, route 2 turns north before
    // it. Keying a relation to the leader's CURRENT edge drops it the moment
    // the leader stands on that sliver (D7); keying it to the rails the two
    // share does not.
    const junction = syntheticNetwork({
      edges: [
        { from: 0, to: 1, pts: straight(0, 1400) },
        { from: 1, to: 2, pts: straight(1400, 1406) },
        { from: 2, to: 3, pts: straight(1406, 2600) },
        { from: 1, to: 4, pts: [{ x: 1400, y: 0 }, { x: 1400, y: 1200 }] },
      ],
      routes: [
        { id: '1', type: 0, paths: [{ id: 'J1', direction: 0, edges: [0, 1, 2], served: ['J0', 'J600', 'J1200', 'J2000'] }] },
        { id: '2', type: 0, paths: [{ id: 'J2', direction: 0, edges: [0, 3], served: ['J0', 'J600', 'J1200'] }] },
      ],
      stops: [
        { id: 'J0', edge: 0, s: 0, terminal: true },
        { id: 'J600', edge: 0, s: 600 },
        { id: 'J1200', edge: 0, s: 1200 },
        { id: 'J2000', edge: 2, s: 594 },
      ],
    });
    const matcher = createMatcher(junction);
    const L = tram('L', '1');
    const F = tram('F', '2');
    feed(junction, matcher, L, 'J1', 0, [[1200, 1980], [1300, 1990]], 1990);
    feed(junction, matcher, F, 'J2', 0, [[900, 1980], [1000, 1990]], 1990);
    enforceOrder([L, F], junction, 1992, 1990);
    feed(junction, matcher, L, 'J1', 0, [[1380, 2000]], 2000);
    feed(junction, matcher, F, 'J2', 0, [[1080, 2000]], 2000);
    enforceOrder([L, F], junction, 2002, 2000);
    expect(F.order.leader).toBe('L');
    // The leader steps onto the six-metre sliver: its current edge is on no
    // path of route 2 at all, and the relation stands.
    feed(junction, matcher, L, 'J1', 0, [[1403, 2010]], 2010);
    feed(junction, matcher, F, 'J2', 0, [[1160, 2010]], 2010);
    const report = enforceOrder([L, F], junction, 2012, 2010);
    expect(L.match.edge).toBe(1);
    expect(F.order.leader).toBe('L');
    expect(report.dropped).toBe(0);
  });

  it('never files a fresher tram, whose fix is ahead, behind a stale one', () => {
    const matcher = createMatcher(net);
    const stale = tram('S');
    const fresh = tram('F');
    // S last reported 50 s ago at 1200 m; F is reporting now, ahead of it.
    feed(net, matcher, stale, '1_0', 0, [[1150, 1950], [1200, 1960]], 2010);
    feed(net, matcher, fresh, '1_0', 0, [[1300, 2000], [1400, 2010]], 2010);
    enforceOrder([stale, fresh], net, 2012, 2010);
    feed(net, matcher, fresh, '1_0', 0, [[1500, 2020]], 2020);
    buildPlan(stale, net, times, null, 2022, 2020, BANDS);
    enforceOrder([stale, fresh], net, 2022, 2020);
    expect(fresh.order.leader).toBeNull();
    expect(stale.order.leader).toBe('F');
  });

  it("takes ZET's TripUpdates as the order when the two fixes are a tram length apart", () => {
    const matcher = createMatcher(net);
    const A = tram('A');
    const B = tram('B');
    // Twenty metres apart: no gap witness could ever fire here.
    feed(net, matcher, A, '1_0', 0, [[900, 1980], [1000, 1990]], 1990);
    feed(net, matcher, B, '1_0', 0, [[880, 1980], [980, 1990]], 1990);
    const bare = enforceOrder([A, B], net, 1992, 1990);
    expect(bare.established).toBe(0);
    // ZET says A calls at C300 next and B at T900, which the path serves in
    // that order: A is ahead, and one pass is enough.
    const report = enforceOrder([A, B], net, 1992, 1990, { 'trip-A': { stopId: 'C300' }, 'trip-B': { stopId: 'T900' } });
    expect(report.established).toBe(1);
    expect(B.order.leader).toBe('A');
  });

  it('concedes a swap only after three fresh contradicting fixes with the leader at a served stop', () => {
    const matcher = createMatcher(net);
    const A = tram('A');
    const B = tram('B');
    feed(net, matcher, A, '1_0', 0, [[1100, 1980], [1150, 1990]], 1990);
    feed(net, matcher, B, '1_0', 0, [[900, 1980], [1000, 1990]], 1990);
    enforceOrder([A, B], net, 1992, 1990);
    feed(net, matcher, A, '1_0', 0, [[1190, 2000]], 2000);
    feed(net, matcher, B, '1_0', 0, [[1080, 2000]], 2000);
    enforceOrder([A, B], net, 2002, 2000);
    expect(B.order.leader).toBe('A');
    // A stands beside T1200 while B keeps landing well past it.
    const contradict = (header: number, xB: number): OrderReport => {
      feed(net, matcher, A, '1_0', 0, [[1190, header]], header);
      feed(net, matcher, B, '1_0', 0, [[xB, header]], header);
      return enforceOrder([A, B], net, header + 2, header);
    };
    let report = contradict(2010, 1270);
    expect(B.order.contradictions).toBe(1);
    expect(report.concessions).toBe(0);
    report = contradict(2020, 1360);
    expect(B.order.contradictions).toBe(2);
    expect(report.concessions).toBe(0);
    // A second pass over the same fixes is not a third observation.
    expect(enforceOrder([A, B], net, 2022, 2020).concessions).toBe(0);
    expect(B.order.contradictions).toBe(2);
    report = contradict(2030, 1450);
    expect(report.concessions).toBe(1);
    expect(A.order.leader).toBe('B');
    expect(B.order.leader).toBeNull();
    expect(ordered(B, A, 2030)).toBe(true);
    expect(isMonotone(A)).toBe(true);
  });

  it('holds a follower behind a fresher leader, never behind the follower own fix, and keeps both plans monotone', () => {
    const matcher = createMatcher(net);
    const C = tram('C');
    const D = tram('D');
    feed(net, matcher, C, '1_0', 0, [[1000, 1980], [1100, 1990]], 1990);
    feed(net, matcher, D, '1_0', 0, [[800, 1980], [900, 1990]], 1990);
    enforceOrder([C, D], net, 1992, 1990);
    feed(net, matcher, C, '1_0', 0, [[1150, 2010]], 2010); // the fresher fix
    feed(net, matcher, D, '1_0', 0, [[1000, 2000]], 2010); // ten seconds older, and fast
    const report = enforceOrder([C, D], net, 2012, 2010);
    expect(D.order.leader).toBe('C');
    expect(report.holds).toBe(1);
    expect(ordered(C, D, 2010)).toBe(true);
    expect(isMonotone(D)).toBe(true);
    // The hold never puts D behind its own fix, whatever the headway asks.
    for (const knot of D.plan!.on === 'path' ? D.plan!.knots : []) expect(knot[1]).toBeGreaterThanOrEqual(1000 - 1e-6);
  });

  it('pushes a stale leader forward from the follower fix time on, and never before it', () => {
    const matcher = createMatcher(net);
    const A = tram('A');
    const B = tram('B');
    feed(net, matcher, A, '1_0', 0, [[1000, 1965], [1050, 1975]], 1980);
    feed(net, matcher, B, '1_0', 0, [[500, 1970], [600, 1980]], 1980);
    enforceOrder([A, B], net, 1982, 1980);
    feed(net, matcher, A, '1_0', 0, [[1150, 1985]], 1990);
    feed(net, matcher, B, '1_0', 0, [[700, 1990]], 1990);
    enforceOrder([A, B], net, 1992, 1990);
    expect(B.order.leader).toBe('A');

    // A falls silent at 1150 m, twenty-five seconds before this header, and
    // its own plan already carries knots inside those twenty-five seconds
    // (it was approaching T1200). B's fresh fix lands at 1230 m, past A's
    // plan. The push may raise A only from B's fix time on: that fix is a
    // lower bound on where A was FROM THEN ON, and says nothing whatever
    // about where A was fifteen seconds earlier (D6's teleport).
    feed(net, matcher, B, '1_0', 0, [[1230, 2010]], 2010);
    buildPlan(A, net, times, null, 2012, 2010, BANDS);
    const before = (A.plan!.on === 'path' ? A.plan!.knots : []).map((k) => [...k] as [number, number]);
    const anchor = before[0];
    const middle = before.filter((k) => k[0] > anchor[0] && k[0] < 0);
    // The scenario only tests the time bound if there IS a knot between the
    // anchor and the follower's fix time; assert the world before the rule.
    expect(middle.length).toBeGreaterThan(0);
    expect(planAt(A, 2010, 2010)).toBeLessThan(planAt(B, 2010, 2010));

    const report = enforceOrder([A, B], net, 2012, 2010);
    expect(report.pushes).toBe(1);
    const after = A.plan!.on === 'path' ? A.plan!.knots : [];
    // (a) the anchor is A's own fix and is untouched.
    expect(after[0][0]).toBe(anchor[0]);
    expect(after[0][1]).toBeCloseTo(anchor[1], 6);
    // (b) so is every knot between it and B's fix.
    for (const [t, s] of middle) expect(evalPathPlan(after, t)).toBeCloseTo(s, 6);
    // (c) from B's fix on, A is a tram length ahead of B.
    for (const t of [2010, 2020, 2040]) expect(planAt(A, t, 2010)).toBeGreaterThanOrEqual(planAt(B, t, 2010) + HEADWAY_M - 1e-6);
    expect(isMonotone(A)).toBe(true);
  });

  it('leaves the anchor alone even when the follower fix falls in the leader own anchor second', () => {
    // The time bound alone does not protect the anchor when the two fixes
    // round onto the same relative second: `knot[0] < tFrom` is then false
    // for the anchor itself, and only the loop starting at the second knot
    // keeps A's own reported position from being overwritten by B's.
    const matcher = createMatcher(net);
    const A = tram('A');
    const B = tram('B');
    feed(net, matcher, A, '1_0', 0, [[1100, 1975], [1150, 1985]], 1990);
    feed(net, matcher, B, '1_0', 0, [[1000, 1980], [1050, 1990]], 1990);
    enforceOrder([A, B], net, 1992, 1990);
    feed(net, matcher, A, '1_0', 0, [[1220, 1995]], 2000);
    feed(net, matcher, B, '1_0', 0, [[1150, 2000]], 2000);
    enforceOrder([A, B], net, 2002, 2000);
    expect(B.order.leader).toBe('A');

    // Both report inside the same second before the header, B a tenth later:
    // A's anchor and the push's lower time bound are both tRel 0.
    feed(net, matcher, A, '1_0', 0, [[1250, 2009.6]], 2010);
    feed(net, matcher, B, '1_0', 0, [[1290, 2009.7]], 2010);
    const anchorBefore = [...(A.plan!.on === 'path' ? A.plan!.knots[0] : [0, 0])] as [number, number];
    expect(anchorBefore[0]).toBeCloseTo(0, 6); // tRel -0: the same second as the follower's fix
    expect(anchorBefore[1]).toBeCloseTo(1250, 0);
    const report = enforceOrder([A, B], net, 2012, 2010);
    expect(report.pushes).toBe(1);
    const after = A.plan!.on === 'path' ? A.plan!.knots : [];
    expect(after[0][1]).toBeCloseTo(1250, 0);
    expect(isMonotone(A)).toBe(true);
  });

  it('swaps at once when the follower fix has left the shared stretch ahead of its leader', () => {
    // Route 2 turns north at the junction; route 1 carries straight on. A
    // follower whose own fix is no longer on its leader's path at all, while
    // it reads ahead of it, has run out of the stretch in front of the tram
    // it is supposed to be behind. No ordering of these rails allows that,
    // and it is decided on the spot rather than after three fixes.
    const matcher = createMatcher(net);
    const L = tram('L', '1');
    const F = tram('F', '2');
    feed(net, matcher, L, '1_0', 0, [[1100, 1965], [1200, 1975]], 1980);
    feed(net, matcher, F, '2_0', 0, [[900, 1970], [1000, 1980]], 1980);
    enforceOrder([L, F], net, 1982, 1980);
    feed(net, matcher, L, '1_0', 0, [[1300, 1990]], 1990);
    feed(net, matcher, F, '2_0', 0, [[1100, 1990]], 1990);
    enforceOrder([L, F], net, 1992, 1990);
    expect(F.order.leader).toBe('L');
    feed(net, matcher, L, '1_0', 0, [[1400, 2000]], 2000);
    feed(net, matcher, F, '2_0', 0, [[1450, 2000]], 2000);
    expect(enforceOrder([L, F], net, 2002, 2000).swaps).toBe(0); // 50 m apart: still nothing to decide
    expect(F.order.leader).toBe('L');

    // F is now fifty metres up the north branch, which route 1 never runs,
    // and a hundred metres ahead of L read on F's own path.
    feed(net, matcher, L, '1_0', 0, [[1450, 2010]], 2010);
    feed(net, matcher, F, '2_0', 0, [[1535.4, 2010, 35.4]], 2010);
    expect(F.match.s).toBeGreaterThan(1500);
    expect(F.match.edge).toBe(2);
    const report = enforceOrder([L, F], net, 2012, 2010);
    expect(report.swaps).toBe(1);
    expect(report.concessions).toBe(0);
    expect(F.order.leader).toBeNull();
    expect(L.order.leader).toBe('F');
  });

  it('re-files a follower onto a nearer leader that comes between them, without reversing anything', () => {
    // The wire carries ONE leader per vehicle, so a queue of three whose
    // members all point at the tram in front of the queue leaves its middle
    // pair with no headway at all. A nearer leader takes the relation over;
    // the order itself is not reversed, which still takes a concession.
    const matcher = createMatcher(net);
    const A = tram('A');
    const M = tram('M');
    const B = tram('B');
    feed(net, matcher, A, '1_0', 0, [[1300, 1965], [1400, 1975]], 1980);
    feed(net, matcher, B, '1_0', 0, [[700, 1970], [800, 1980]], 1980);
    enforceOrder([A, B], net, 1982, 1980);
    feed(net, matcher, A, '1_0', 0, [[1450, 1990]], 1990);
    feed(net, matcher, B, '1_0', 0, [[850, 1990]], 1990);
    enforceOrder([A, B], net, 1992, 1990);
    expect(B.order.leader).toBe('A');

    // M joins the trunk between the two.
    feed(net, matcher, M, '1_0', 0, [[1000, 1990], [1100, 2000]], 2000);
    feed(net, matcher, A, '1_0', 0, [[1500, 2000]], 2000);
    feed(net, matcher, B, '1_0', 0, [[900, 2000]], 2000);
    enforceOrder([A, B, M], net, 2002, 2000);
    expect(B.order.leader).toBe('A'); // one reading of the new pair is not yet evidence
    feed(net, matcher, A, '1_0', 0, [[1550, 2010]], 2010);
    feed(net, matcher, M, '1_0', 0, [[1200, 2010]], 2010);
    feed(net, matcher, B, '1_0', 0, [[950, 2010]], 2010);
    enforceOrder([A, B, M], net, 2012, 2010);
    expect(M.order.leader).toBe('A');
    expect(B.order.leader).toBe('M');
    expect(A.order.leader).toBeNull();
  });

  it('forgets a witness nobody has refreshed, so it can never stand in for a fresh one', () => {
    const matcher = createMatcher(net);
    const A = tram('A');
    const B = tram('B');
    feed(net, matcher, A, '1_0', 0, [[1000, 1975], [1050, 1980]], 1980);
    feed(net, matcher, B, '1_0', 0, [[600, 1975], [700, 1980]], 1980);
    enforceOrder([A, B], net, 1982, 1980);
    expect(A.order.witnesses['B'].n).toBe(1);

    // Two minutes later the pair meets again. The old reading is not the
    // first of two CONSECUTIVE fresh fixes any more, so it counts for
    // nothing and this reading is the first.
    feed(net, matcher, A, '1_0', 0, [[1200, 2100]], 2100);
    feed(net, matcher, B, '1_0', 0, [[900, 2100]], 2100);
    enforceOrder([A, B], net, 2102, 2100);
    expect(A.order.witnesses['B'].n).toBe(1);
    expect(B.order.leader).toBeNull();
    // And the next fresh reading is the second, as it always was.
    feed(net, matcher, A, '1_0', 0, [[1300, 2110]], 2110);
    feed(net, matcher, B, '1_0', 0, [[1000, 2110]], 2110);
    enforceOrder([A, B], net, 2112, 2110);
    expect(B.order.leader).toBe('A');
  });

  it('breaks a ring of relations the same way whichever end it is read from', () => {
    // Nothing in the register writes a cycle -- a relation is only ever
    // written for a follower that has none -- but a restored state row could
    // carry one, and a sweep that recursed into it would never return.
    const build = (): [Track, Track] => {
      const matcher = createMatcher(net);
      const A = tram('A');
      const B = tram('B');
      feed(net, matcher, A, '1_0', 0, [[1000, 1980], [1100, 1990]], 1990);
      feed(net, matcher, B, '1_0', 0, [[700, 1980], [800, 1990]], 1990);
      A.order.leader = 'B';
      B.order.leader = 'A';
      return [A, B];
    };
    const forwards = build();
    const report = enforceOrder(forwards, net, 1992, 1990);
    expect(report.dropped).toBe(1);
    // The ring is entered at the oldest fix, then by id, and the relation
    // that closes it is the one dropped: A keeps its leader, B loses its.
    expect([forwards[0].order.leader, forwards[1].order.leader]).toEqual(['B', null]);
    // Read from the other end, the same ring breaks at the same place.
    const backwards = build();
    enforceOrder([backwards[1], backwards[0]], net, 1992, 1990);
    expect([backwards[0].order.leader, backwards[1].order.leader]).toEqual(['B', null]);
  });

  it('drops a relation the two fixes contradict by more than two stop spacings, and leaves the plans alone', () => {
    const matcher = createMatcher(net);
    const P = tram('P');
    const Q = tram('Q');
    feed(net, matcher, P, '1_0', 0, [[950, 1975], [1000, 1985]], 1990);
    feed(net, matcher, Q, '1_0', 0, [[500, 1980], [600, 1990]], 1990);
    enforceOrder([P, Q], net, 1992, 1990);
    feed(net, matcher, P, '1_0', 0, [[1050, 1995]], 2000);
    feed(net, matcher, Q, '1_0', 0, [[700, 2000]], 2000);
    enforceOrder([P, Q], net, 2002, 2000);
    expect(Q.order.leader).toBe('P');
    // P reports afresh from the start of the path (its next trip), 450 m
    // behind Q's own fix: Q is not dragged back there, the relation goes.
    feed(net, matcher, P, '1_0', 0, [[100, 2010], [150, 2020]], 2020);
    feed(net, matcher, Q, '1_0', 0, [[600, 2020]], 2020);
    const before = [2020, 2040, 2070].map((t) => planAt(Q, t, 2020));
    const report = enforceOrder([P, Q], net, 2022, 2020);
    expect(report.dropped).toBeGreaterThanOrEqual(1);
    expect(Q.order.leader).toBeNull();
    expect([2020, 2040, 2070].map((t) => planAt(Q, t, 2020))).toEqual(before);
  });

  it('writes nothing and moves nothing for a pair inside the establishing gap', () => {
    const matcher = createMatcher(net);
    const E = tram('E');
    const F = tram('F');
    feed(net, matcher, E, '1_0', 0, [[900, 2000], [1000, 2010]], 2010);
    feed(net, matcher, F, '1_0', 0, [[890, 2000], [990, 2010]], 2010);
    const eKnots = JSON.stringify(E.plan);
    const fKnots = JSON.stringify(F.plan);
    const report = enforceOrder([E, F], net, 2012, 2010);
    expect(report).toEqual({ relations: 0, established: 0, dropped: 0, holds: 0, pushes: 0, concessions: 0, swaps: 0 });
    expect(JSON.stringify(E.plan)).toBe(eKnots);
    expect(JSON.stringify(F.plan)).toBe(fKnots);
  });

  it('reads the same whatever order the tracks arrive in', () => {
    const run = (reversed: boolean): string => {
      const matcher = createMatcher(net);
      const A = tram('A');
      const B = tram('B');
      const C = tram('C');
      feed(net, matcher, A, '1_0', 0, [[1200, 1980], [1300, 1990]], 1990);
      feed(net, matcher, B, '1_0', 0, [[900, 1980], [1000, 1990]], 1990);
      feed(net, matcher, C, '1_0', 0, [[600, 1980], [700, 1990]], 1990);
      const list = reversed ? [C, B, A] : [A, B, C];
      enforceOrder(list, net, 1992, 1990);
      feed(net, matcher, A, '1_0', 0, [[1380, 2000]], 2000);
      feed(net, matcher, B, '1_0', 0, [[1080, 2000]], 2000);
      feed(net, matcher, C, '1_0', 0, [[780, 2000]], 2000);
      enforceOrder(list, net, 2002, 2000);
      return JSON.stringify([A, B, C].map((t) => [t.id, t.order.leader, t.plan]));
    };
    expect(run(false)).toBe(run(true));
  });
});
