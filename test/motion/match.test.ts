import { describe, expect, it } from 'vitest';
import { createMatcher } from '../../shared/motion/match';
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

    // A detour: route 1's tram leaves edge 1 for edge 2 (200 m off its path).
    // One stray fix is noise and stays on the path; the second re-derives the
    // path to one that runs the edge it is on.
    const detour = newTrack('c', '1', 'trip-c', 'tram');
    const prior1 = matcher.priorFor('1_0', '1', 0);
    matcher.matchFix(detour, fix(1300, 0, 1000), prior1, 'T1500');
    matcher.matchFix(detour, fix(1450, 0, 1010), prior1, 'T1500');
    matcher.matchFix(detour, fix(1560, 200, 1020), prior1, null);
    expect(detour.match.pathIdx).toBe(pathIdx('1_0'));
    expect(detour.offPathCount).toBe(1);
    matcher.matchFix(detour, fix(1560, 400, 1030), prior1, null);
    expect(detour.match.pathIdx).toBe(pathIdx('2_0'));
    expect(detour.match.edge).toBe(2);
    expect(detour.offPathCount).toBe(0);

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
