import { describe, expect, it } from 'vitest';
import { createMatcher, type MatchContext, type PathRank } from '../../shared/motion/match';
import { newTrack, type PlaneFix } from '../../shared/motion/track';
import { corridorSpec, lonLatOf, straight, syntheticNetwork, type SynthSpec, type SynthStop } from './synthetic-network';

const net = syntheticNetwork(corridorSpec());
const matcher = createMatcher(net);
const pathIdx = (id: string) => net.paths.findIndex((p) => p.id === id);
const shapeIdx = (id: string) => net.shapes.findIndex((s) => s.id === id);

function fix(x: number, y: number, atSec: number): PlaneFix {
  const { lon, lat } = lonLatOf({ x, y });
  return { x, y, lon, lat, atSec };
}

// R-TE22 and the matcher rules of the plan: a tram is matched onto the rail
// graph with its trip's path as the prior, a shapeless trip onto its route's
// union, a detour re-derives the path, a vehicle far from every edge goes
// off-graph and comes back, and a bus never touches a rail edge.
describe('matchFix on the corridor', () => {
  it('follows the path prior through the junction, matches a shapeless trip on its route union, re-derives on a detour, leaves and rejoins the graph, and keeps buses off the rails', () => {
    // Route 2 turns north at the junction (edge 2); route 1 continues east
    // (edge 1). At (1530, 30) the tram is on edge 2's bend and 30 m from edge
    // 1: the prior decides, not the raw distance.
    const two = newTrack('a', '2', 'trip-a', 'tram');
    const prior2 = matcher.priorFor('2_0', '2', 0);
    expect(prior2.pathIdx).toBe(pathIdx('2_0'));
    matcher.matchFix(two, fix(1400, 2, 1000), prior2, 'D300');
    matcher.matchFix(two, fix(1530, 30, 1010), prior2, 'D300');
    expect(two.match.pathIdx).toBe(pathIdx('2_0'));
    expect(two.match.edge).toBe(2);
    expect(two.match.s).toBeCloseTo(1500 + Math.hypot(30, 30), 0);
    expect(two.offGraph).toBe(false);

    // A trip whose pattern has no shape and no synthetic path (route 2,
    // direction 1 here): the route's edges decide, and the path of the route
    // that runs the matched edge in the direction of movement is adopted.
    const union = newTrack('b', '2', 'trip-b', 'tram');
    const noPrior = matcher.priorFor(null, '2', 1);
    expect(noPrior.pathIdx).toBeNull();
    matcher.matchFix(union, fix(500, 4, 1000), noPrior, null);
    matcher.matchFix(union, fix(600, -3, 1010), noPrior, null);
    expect(union.match.edge).toBe(0);
    expect(union.match.pathIdx).toBe(pathIdx('2_0'));
    expect(union.match.s).toBeCloseTo(600, 0);
    // A shapeless pattern with a synthetic path uses it directly.
    expect(matcher.priorFor(null, '9', 0).pathIdx).toBe(pathIdx('path:9:0:abc'));
    // F8: the path id the trip index resolved wins over the route-and-
    // direction guess, so a shapeless variant runs the path the timetable
    // has segments for; an id the network does not know is ignored.
    expect(matcher.priorFor(null, '2', 1, 'path:9:0:abc').pathIdx).toBe(pathIdx('path:9:0:abc'));
    expect(matcher.priorFor(null, '2', 1, 'path:nowhere').pathIdx).toBeNull();
    expect(matcher.priorFor('2_0', '2', 0, 'path:9:0:abc').pathIdx).toBe(pathIdx('2_0')); // a real shape still wins

    // A detour: route 1's tram leaves edge 1 for edge 2 (200 m off its path).
    // One stray fix is noise and stays on the path; the second re-derives the
    // match as unplaced: route 1 does not run route 2's branch.
    const detour = newTrack('c', '1', 'trip-c', 'tram');
    const prior1 = matcher.priorFor('1_0', '1', 0);
    matcher.matchFix(detour, fix(1300, 0, 1000), prior1, 'T1500');
    matcher.matchFix(detour, fix(1450, 0, 1010), prior1, 'T1500');
    matcher.matchFix(detour, fix(1560, 200, 1020), prior1, null);
    expect(detour.match.pathIdx).toBe(pathIdx('1_0'));
    expect(detour.offPathCount).toBe(1);
    matcher.matchFix(detour, fix(1560, 400, 1030), prior1, null);
    expect(detour.match.pathIdx).toBeNull();
    expect(detour.match.edge).toBe(2);
    expect(detour.offPathCount).toBe(0);
    expect(detour.offGraph).toBe(false);
    for (const [y, t] of [[600, 1040], [800, 1050], [800, 1060]]) {
      matcher.matchFix(detour, fix(1560, y, t), prior1, null);
      expect(detour.match.pathIdx).toBeNull();
      expect(detour.match.shapeIdx).toBeNull();
      expect(detour.match.edge).toBe(2);
      expect(detour.match.residual).toBeCloseTo(0);
      expect(detour.offGraph).toBe(false);
      expect(detour.fixes.at(-1)).not.toHaveProperty('arc');
    }
    matcher.matchFix(detour, fix(1700, 4, 1070), prior1, null);
    expect(detour.match.pathIdx).toBe(pathIdx('1_0'));
    expect(detour.match.s).toBeCloseTo(1700);

    // Off-graph: two fixes 400 m from every edge, then one back on the trunk.
    const lost = newTrack('d', '1', 'trip-d', 'tram');
    matcher.matchFix(lost, fix(700, 0, 1000), prior1, null);
    matcher.matchFix(lost, fix(700, 400, 1010), prior1, null);
    expect(lost.offGraph).toBe(false);
    expect(lost.offGraphCount).toBe(1);
    matcher.matchFix(lost, fix(720, 420, 1020), prior1, null);
    expect(lost.offGraph).toBe(true);
    expect(lost.match.pathIdx).toBeNull();
    matcher.matchFix(lost, fix(760, 3, 1030), prior1, null);
    expect(lost.offGraph).toBe(false);
    expect(lost.match.pathIdx).toBe(pathIdx('1_0'));
    expect(lost.match.s).toBeCloseTo(760, 0);

    // A bus rides its own polyline 30 m south of the trunk and never a rail edge.
    const bus = newTrack('e', '109', 'trip-e', 'bus');
    const busPrior = matcher.priorFor('B109', '109', 0);
    matcher.matchFix(bus, fix(500, -28, 1000), busPrior, null);
    matcher.matchFix(bus, fix(600, -31, 1010), busPrior, null);
    expect(bus.match.pathIdx).toBeNull();
    expect(bus.match.edge).toBeNull();
    expect(bus.match.shapeIdx).toBe(shapeIdx('B109'));
    expect(bus.match.s).toBeCloseTo(600, 0);
    matcher.matchFix(bus, fix(600, -400, 1020), busPrior, null);
    expect(bus.match.shapeIdx).toBeNull(); // 370 m off its shape: the free plane, not a rail
    expect(bus.match.edge).toBeNull();
  });
});

// A circuit: out along y = 0, a U-turn, back along y = 6, the two rails as
// close as ZET's are. The nearest point on such a path is ambiguous at every
// metre, so placement must come from the next stop and from movement, and a
// vehicle already placed must stay on its fold (R-TE45).
function circuitSpec(): SynthSpec {
  const stops: SynthStop[] = [];
  for (let s = 300; s < 1500; s += 300) stops.push({ id: `O${s}`, edge: 0, s });
  for (let s = 300; s < 1500; s += 300) stops.push({ id: `R${s}`, edge: 2, s });
  return {
    edges: [
      { from: 0, to: 1, pts: straight(0, 1500) },
      { from: 1, to: 2, pts: [{ x: 1500, y: 0 }, { x: 1515, y: 3 }, { x: 1500, y: 6 }] },
      { from: 2, to: 3, pts: [{ x: 1500, y: 6 }, { x: 0, y: 6 }] },
    ],
    routes: [
      { id: '17', type: 0, paths: [{ id: 'path:17:0:loop', direction: 0, edges: [0, 1, 2], synthetic: true }] },
      { id: '207', type: 3, busShapes: [{ id: 'B207', pts: [{ x: 0, y: -30 }, { x: 2700, y: -30 }, { x: 2700, y: -36 }, { x: 0, y: -36 }] }] },
    ],
    stops,
  };
}

// D4: at a terminus ZET keeps reporting the old trip id for a fix or two
// after the tram has turned and is running back on the OTHER track, three to
// six metres away. The old matcher read that as its own tram walking
// backwards down its own line (the residual never left the near band, so the
// off-path counter never fired). Two consecutive fixes moving against the
// rail the vehicle is read on, with a directed edge within reach that agrees
// with the movement, are a turnaround: the path is re-derived to the route's
// opposite direction.
describe('matchFix at a terminus turnaround under the old trip id', () => {
  it('re-derives to the route opposite direction within two fixes, and never reads the arc backwards', () => {
    const turned = newTrack('t', '1', 'trip-out', 'tram');
    const outbound = matcher.priorFor('1_0', '1', 0);
    matcher.matchFix(turned, fix(1300, 0, 2000), outbound, null);
    matcher.matchFix(turned, fix(1400, 0, 2010), outbound, null);
    expect(turned.match.pathIdx).toBe(pathIdx('1_0'));
    const before = turned.match.s;
    // The tram has turned: it is on the westbound track (y = 60), 60 m from
    // the rail it was read on -- inside the near band, so nothing here is a
    // detour. ZET still names the outbound trip.
    matcher.matchFix(turned, fix(1350, 60, 2020), outbound, null);
    expect(turned.match.pathIdx).toBe(pathIdx('1_0')); // one fix is not yet evidence
    matcher.matchFix(turned, fix(1250, 60, 2030), outbound, null);
    expect(turned.match.pathIdx).toBe(pathIdx('1_1'));
    expect(net.paths[turned.match.pathIdx!].direction).toBe(1);
    expect(turned.match.edge).toBe(5);
    expect(turned.match.residual).toBeLessThan(5);
    // Westbound path 1_1 runs from x = 1500 to x = 0, so the arc grows as the
    // tram runs west: the turnaround is read forwards, not as a reversal.
    const afterTurn = turned.match.s;
    expect(afterTurn).toBeCloseTo(250, 0);
    matcher.matchFix(turned, fix(1250, 60, 2040), outbound, null);
    expect(turned.match.pathIdx).toBe(pathIdx('1_1')); // a standing fix cannot undo D4
    matcher.matchFix(turned, fix(1150, 60, 2050), outbound, null);
    expect(turned.match.pathIdx).toBe(pathIdx('1_1'));
    expect(turned.match.s).toBeGreaterThan(afterTurn);
    expect(before).toBeCloseTo(1400, 0);
  });
});

describe('own-path return and service eligibility', () => {
  it.each([0, 60])('returns from an adopted path on the first agreeing moving fix at %d m residual, but not on a standing fix', (residual) => {
    const track = newTrack('return', '1', 'trip', 'tram');
    const prior = matcher.priorFor('1_0', '1', 0);
    matcher.matchFix(track, fix(600, 0, 1000), prior, null);
    // A previously adopted path on the shared trunk, as in the dossier.
    const adopted = pathIdx('path:9:0:abc');
    track.match = { pathIdx: adopted, shapeIdx: null, edge: 0, s: 600, residual: 0 };
    matcher.matchFix(track, fix(600, 0, 1010), prior, null);
    expect(track.match.pathIdx).toBe(adopted);
    track.order.leader = 'old-leader';
    track.offPathCount = 1;
    track.againstCount = 1;
    matcher.matchFix(track, fix(700, residual, 1020), prior, null);
    expect(track.match.pathIdx).toBe(prior.pathIdx);
    expect(track.match.s).toBeCloseTo(700);
    expect(track.offPathCount).toBe(0);
    expect(track.againstCount).toBe(0);
    expect(track.order.leader).toBeNull();
  });

  it('excludes non-running services, retries unplaced fixes immediately, and permits missing service evidence', () => {
    const pathRanks: PathRank[] = net.paths.map(() => ({ services: new Set<string>(), trips: 0 }));
    pathRanks[pathIdx('path:9:0:abc')] = { services: new Set(['sat', 'sun']), trips: 10 };
    const m = createMatcher(net, { pathRanks });
    const prior = m.priorFor(null, '9', null);
    const track = newTrack('service', '9', 'unknown', 'tram');
    const ctx = { runningServices: new Set(['wd']) };
    m.matchFix(track, fix(500, 0, 1000), prior, null, ctx);
    expect(track.match.pathIdx).toBeNull();
    m.matchFix(track, fix(600, 0, 1010), prior, null, ctx);
    expect(track.match.pathIdx).toBeNull();
    expect(track.offGraph).toBe(false);
    // No movement and no off-path wait needed when valid rails become known.
    m.matchFix(track, fix(600, 0, 1020), prior, null, { runningServices: new Set(['wd', 'sun']) });
    expect(track.match.pathIdx).toBe(pathIdx('path:9:0:abc'));

    for (const context of [undefined, { runningServices: null }, { runningServices: new Set<string>() }]) {
      const unknownDay = newTrack('unknown-day', '9', 'unknown', 'tram');
      m.matchFix(unknownDay, fix(500, 0, 1000), prior, null, context);
      expect(unknownDay.match.pathIdx).toBe(pathIdx('path:9:0:abc'));
    }
    const noRanks = createMatcher(net);
    const legacy = newTrack('legacy', '9', 'unknown', 'tram');
    noRanks.matchFix(legacy, fix(500, 0, 1000), prior, null, ctx);
    expect(legacy.match.pathIdx).toBe(pathIdx('path:9:0:abc'));
    const unindexed = newTrack('unindexed', '2', 'unknown', 'tram');
    m.matchFix(unindexed, fix(500, 0, 1000), m.priorFor(null, '2', null), null, ctx);
    expect(unindexed.match.pathIdx).toBe(pathIdx('2_0')); // empty path service set
  });

  it('never borrows a foreign path when a route has no paths of its own', () => {
    const track = newTrack('no-route', '999', 'unknown', 'tram');
    matcher.matchFix(track, fix(600, 0, 1000), matcher.priorFor(null, '999', null), null);
    expect(track.match.pathIdx).toBeNull();
    expect(track.match.edge).toBe(0);
    expect(track.offGraph).toBe(false);
  });

  it('does not use a non-running opposite-direction path for a D4 turnaround', () => {
    const pathRanks = net.paths.map((path) => ({ services: new Set([path.direction === 1 ? 'sat' : 'wd']), trips: 1 }));
    const m = createMatcher(net, { pathRanks });
    const prior = m.priorFor('1_0', '1', 0);
    const track = newTrack('turn', '1', 'outbound', 'tram');
    for (const [x, y, t] of [[1300, 0, 1000], [1400, 0, 1010], [1350, 60, 1020], [1250, 60, 1030]]) {
      m.matchFix(track, fix(x, y, t), prior, null, { runningServices: new Set(['wd']) });
    }
    expect(track.match.pathIdx).toBe(prior.pathIdx);
  });
});

describe('ranked own-route adoption', () => {
  // All variants run edge 1. Only `continuing` runs edge 0 immediately
  // before it. `remote` is a prior that cannot explain a fix on edge 1.
  const rankedNet = syntheticNetwork({
    edges: [
      { from: 0, to: 1, pts: straight(0, 1000) },
      { from: 1, to: 2, pts: Array.from({ length: 21 }, (_, i) => ({ x: 1000 + 50 * i, y: 0 })) },
      { from: 3, to: 1, pts: [{ x: 1000, y: 1000 }, { x: 1000, y: 0 }] },
      { from: 4, to: 5, pts: straight(0, 2000, 100) },
    ],
    routes: [{
      id: '7', type: 0, paths: [
        { id: 'popular', direction: 0, edges: [2, 1] },
        { id: 'continuing', direction: 1, edges: [0, 1] },
        { id: 'current', direction: 0, edges: [1] },
        { id: 'remote', direction: 0, edges: [3] },
      ],
    }],
    stops: [],
  });
  const ranks = (counts = [100, 1, 2, 1]): PathRank[] => counts.map((trips) => ({ services: new Set(['wd']), trips }));
  const ctx: MatchContext = { runningServices: new Set(['wd']) };

  it('prefers the prior over current path, edge sequence, direction, and trip count when re-deriving', () => {
    const m = createMatcher(rankedNet, { pathRanks: ranks() });
    const prior = m.priorFor('current', '7', 0);
    const track = newTrack('prior-first', '7', 'trip', 'tram');
    track.priorPath = prior.pathIdx;
    track.match = { pathIdx: 1, shapeIdx: 1, edge: 0, s: 1000, residual: 0 };
    track.fixes.push(fix(1200, 0, 1000));
    // A standing fix blocks the separate own-path return check. The
    // stale current arc forces re-derivation; prior still wins on this edge.
    track.offPathCount = 1;
    m.matchFix(track, fix(1200, 0, 1001), prior, null, ctx);
    expect(track.match.pathIdx).toBe(prior.pathIdx);
    expect(track.match.s).toBeCloseTo(200);
  });

  it('prefers the current path before a more popular variant when the prior is absent from the pool', () => {
    const m = createMatcher(rankedNet, { pathRanks: ranks() });
    const prior = m.priorFor('remote', '7', 0);
    const track = newTrack('current-first', '7', 'trip', 'tram');
    track.priorPath = prior.pathIdx;
    track.match = { pathIdx: 2, shapeIdx: 2, edge: 1, s: 0, residual: 0 };
    track.fixes.push(fix(1100, 0, 1000));
    track.offPathCount = 1;
    m.matchFix(track, fix(1200, 0, 1001), prior, null, ctx);
    expect(track.match.pathIdx).toBe(2);
    expect(track.match.s).toBeCloseTo(200);
    expect(track.offPathCount).toBe(0); // actually went through re-derivation
  });

  it('prefers the immediate edge sequence before direction or trip count on an unplaced fix', () => {
    const m = createMatcher(rankedNet, { pathRanks: ranks() });
    const prior = m.priorFor('remote', '7', 0);
    const track = newTrack('edge-first', '7', 'trip', 'tram');
    track.priorPath = prior.pathIdx;
    track.match = { pathIdx: null, shapeIdx: null, edge: 0, s: 0, residual: 0 };
    m.matchFix(track, fix(1500, 0, 1000), prior, null, ctx);
    expect(track.match.pathIdx).toBe(1); // direction 1 and only one trip
  });

  it('prefers direction, then trip count, and skips direction for an unknown trip before the lowest-index tie-break', () => {
    const m = createMatcher(rankedNet, { pathRanks: ranks([10, 100, 20, 1]) });
    const known = newTrack('direction', '7', 'unknown', 'tram');
    m.matchFix(known, fix(1500, 0, 1000), m.priorFor(null, '7', 0), null, ctx);
    expect(known.match.pathIdx).toBe(2); // direction 0, then more trips than path 0
    const unknown = newTrack('count', '7', 'unknown', 'tram');
    m.matchFix(unknown, fix(1500, 0, 1000), m.priorFor(null, '7', null), null, ctx);
    expect(unknown.match.pathIdx).toBe(1); // unknown direction: most trips
    const tied = createMatcher(rankedNet, { pathRanks: ranks([5, 5, 5, 5]) });
    const first = newTrack('index', '7', 'unknown', 'tram');
    tied.matchFix(first, fix(1500, 0, 1000), tied.priorFor(null, '7', null), null, ctx);
    expect(first.match.pathIdx).toBe(0);
  });

  it('filters service eligibility before applying current-path or popularity preference', () => {
    const pathRanks = ranks();
    pathRanks[0].services = new Set(['sat']);
    pathRanks[1].services = new Set(['sat']);
    const m = createMatcher(rankedNet, { pathRanks });
    const prior = m.priorFor('remote', '7', 0);
    const track = newTrack('eligible', '7', 'trip', 'tram');
    track.priorPath = prior.pathIdx;
    track.match = { pathIdx: 1, shapeIdx: 1, edge: 0, s: 1000, residual: 0 };
    track.fixes.push(fix(1100, 0, 1000));
    track.offPathCount = 1;
    m.matchFix(track, fix(1200, 0, 1001), prior, null, ctx);
    expect(track.match.pathIdx).toBe(2);
  });
});

describe('matchFix on a circuit', () => {
  it('places by the next stop, keeps a placed vehicle on its fold, finds a wrong fold out by the backward arc it implies, and holds a bus on the leg of its loop', () => {
    const loop = syntheticNetwork(circuitSpec());
    const m = createMatcher(loop);
    const pathIdx = loop.paths.findIndex((p) => p.id === 'path:17:0:loop');
    const returnLegAt = (x: number) => loop.paths[pathIdx].offsets[2] + (1500 - x);
    const prior = m.priorFor(null, '17', 0);
    expect(prior.pathIdx).toBe(pathIdx);

    // Between the rails, heading for a return platform: the return fold.
    const a = newTrack('a', '17', 'trip-a', 'tram');
    m.matchFix(a, fix(1200, 3, 1000), prior, 'R600');
    expect(a.match.s).toBeCloseTo(returnLegAt(1200), 0);
    // Nearer the outbound rail now (1 m against 5 m): continuity keeps the fold.
    m.matchFix(a, fix(1100, 1, 1010), prior, 'R600');
    expect(a.match.s).toBeCloseTo(returnLegAt(1100), 0);
    m.matchFix(a, fix(1000, 5, 1020), prior, 'R600');
    expect(a.match.s).toBeCloseTo(returnLegAt(1000), 0);
    for (let i = 1; i < a.fixes.length; i++) expect(a.fixes[i].arc!.s).toBeGreaterThan(a.fixes[i - 1].arc!.s);

    // No next stop, no movement yet: the first fold is a guess. Westward
    // movement would read as 100 m backward on the outbound fold, which a
    // tram cannot do: the guess is corrected to the fold that runs west.
    const b = newTrack('b', '17', 'trip-b', 'tram');
    m.matchFix(b, fix(1200, 3, 1000), prior, null);
    m.matchFix(b, fix(1100, 3, 1010), prior, null);
    expect(b.match.s).toBeCloseTo(returnLegAt(1100), 0);
    m.matchFix(b, fix(1000, 3, 1020), prior, null);
    expect(b.match.s).toBeCloseTo(returnLegAt(1000), 0);

    // A stray first fix, 64 m from the return rail and 70 m from the outbound
    // one (outside the near band on both): the fold of the next stop wins,
    // not the nearer rail, and the residual still says the fix is a stray.
    const d = newTrack('d', '17', 'trip-d', 'tram');
    m.matchFix(d, fix(750, 70, 1000), prior, 'O900');
    expect(d.match.s).toBeCloseTo(750, 0);
    expect(d.match.residual).toBeCloseTo(70, 0);
    expect(d.offPathCount).toBe(1);

    // A bus on the return leg of its loop, its fixes scattered between the
    // two legs: the arc keeps growing along the leg it is on.
    const c = newTrack('c', '207', 'trip-c', 'bus');
    const busPrior = m.priorFor('B207', '207', 0);
    m.matchFix(c, fix(2000, -34, 1000), busPrior, null);
    m.matchFix(c, fix(1900, -33, 1010), busPrior, null);
    m.matchFix(c, fix(1800, -35, 1020), busPrior, null);
    const shape = loop.shapes[c.match.shapeIdx!];
    expect(shape.id).toBe('B207');
    expect(c.fixes.map((f) => f.arc!.s)).toEqual([expect.closeTo(2706 + 700, 0), expect.closeTo(2706 + 800, 0), expect.closeTo(2706 + 900, 0)]);
  });
});
