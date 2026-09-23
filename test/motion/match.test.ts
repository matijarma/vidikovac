import { describe, expect, it } from 'vitest';
import { createMatcher, type MatchContext, type PathRank } from '../../shared/motion/match';
import { EVICT_S } from '../../shared/motion/plan';
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
    // has segments for; unknown ids and another route's paths are ignored.
    expect(matcher.priorFor(null, '9', 1, 'path:9:0:abc').pathIdx).toBe(pathIdx('path:9:0:abc'));
    expect(matcher.priorFor(null, '2', 1, 'path:9:0:abc').pathIdx).toBeNull();
    expect(matcher.priorFor(null, '2', 1, 'path:nowhere').pathIdx).toBeNull();
    expect(matcher.priorFor('1_0', '2', 1)).toMatchObject({ pathIdx: null, shapeIdx: null });
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

  it('keeps a turnaround through lateral and forward scatter, then a slow westbound departure', () => {
    const turned = newTrack('scatter', '1', 'trip-out', 'tram');
    const outbound = matcher.priorFor('1_0', '1', 0);
    for (const [x, y, t] of [[1300, 0, 2000], [1400, 0, 2010], [1350, 60, 2020], [1250, 60, 2030]]) {
      matcher.matchFix(turned, fix(x, y, t), outbound, null);
    }
    expect(turned.match.pathIdx).toBe(pathIdx('1_1'));
    // The first sideways fix reproduced the reviewed bug. The larger
    // lateral move also exceeds 50 m on the ground, but not longitudinally.
    for (const [x, y, t] of [[1250, 40, 2040], [1250, -10, 2050], [1270, 40, 2060], [1290, 40, 2070]]) {
      matcher.matchFix(turned, fix(x, y, t), outbound, null);
      expect(turned.match.pathIdx).toBe(pathIdx('1_1'));
    }
    let s = turned.match.s;
    for (const [i, x] of [1260, 1230, 1200, 1170, 1140].entries()) {
      matcher.matchFix(turned, fix(x, 40, 2080 + i * 10), outbound, null);
      expect(turned.match.pathIdx).toBe(pathIdx('1_1'));
      expect(turned.match.s).toBeGreaterThan(s);
      s = turned.match.s;
    }
  });

  it('keeps a turnaround through consecutive diagonal scatter without oscillating back to the prior', () => {
    const turned = newTrack('diagonals', '1', 'trip-out', 'tram');
    const outbound = matcher.priorFor('1_0', '1', 0);
    for (const [x, y, t] of [[1300, 0, 2000], [1400, 0, 2010], [1350, 60, 2020], [1250, 60, 2030]]) {
      matcher.matchFix(turned, fix(x, y, t), outbound, null);
    }
    expect(turned.match.pathIdx).toBe(pathIdx('1_1'));
    // Each diagonal exceeds 50 m on the ground but advances only 20 m
    // along either rail. Two eastbound intervals are still only 40 m.
    for (let cycle = 0; cycle < 3; cycle++) {
      for (const [i, [x, y]] of [[1270, 0], [1290, 60], [1270, 0], [1250, 60]].entries()) {
        matcher.matchFix(turned, fix(x, y, 2040 + (cycle * 4 + i) * 10), outbound, null);
        expect(turned.match.pathIdx).toBe(pathIdx('1_1'));
      }
    }
  });

  it.each([0, 60])('returns to the prior during eight slow forward fixes at %d m residual', (y) => {
    const turned = newTrack('slow-return', '1', 'trip-out', 'tram');
    const outbound = matcher.priorFor('1_0', '1', 0);
    for (const [x, y, t] of [[1300, 0, 2000], [1400, 0, 2010], [1350, 60, 2020], [1250, 60, 2030]]) {
      matcher.matchFix(turned, fix(x, y, t), outbound, null);
    }
    expect(turned.match.pathIdx).toBe(pathIdx('1_1'));
    const paths: Array<number | null> = [];
    for (let i = 1; i <= 8; i++) {
      matcher.matchFix(turned, fix(1250 + i * 20, y, 2030 + i * 10), outbound, null);
      paths.push(turned.match.pathIdx);
    }
    expect(paths).toEqual([pathIdx('1_1'), pathIdx('1_1'), ...Array(6).fill(pathIdx('1_0'))]);
    expect(turned.match.s).toBeCloseTo(1410);
  });

  it.each([
    ['backward', 1285, 60],
    ['off-prior', 1290, 61],
    ['off-graph', 1290, 400],
  ] as const)('resets accumulated prior-return progress on a %s fix', (_reason, x, y) => {
    const turned = newTrack('reset-return', '1', 'trip-out', 'tram');
    const outbound = matcher.priorFor('1_0', '1', 0);
    for (const [x, y, t] of [[1300, 0, 2000], [1400, 0, 2010], [1350, 60, 2020], [1250, 60, 2030], [1270, 60, 2040], [1290, 60, 2050]]) {
      matcher.matchFix(turned, fix(x, y, t), outbound, null);
    }
    expect(turned.match.pathIdx).toBe(pathIdx('1_1')); // 40 m, below threshold
    matcher.matchFix(turned, fix(x, y, 2060), outbound, null);
    expect(turned.match.pathIdx).toBe(pathIdx('1_1'));
    for (const [i, dx] of [20, 40, 50].entries()) {
      matcher.matchFix(turned, fix(x + dx, 60, 2070 + i * 10), outbound, null);
      expect(turned.match.pathIdx).toBe(pathIdx(dx < 50 ? '1_1' : '1_0'));
    }
  });

  it('counts neither standing nor repeated fixes as additional prior-return progress', () => {
    const turned = newTrack('standing-return', '1', 'trip-out', 'tram');
    const outbound = matcher.priorFor('1_0', '1', 0);
    for (const [x, y, t] of [[1300, 0, 2000], [1400, 0, 2010], [1350, 60, 2020], [1250, 60, 2030], [1270, 60, 2040], [1290, 60, 2050]]) {
      matcher.matchFix(turned, fix(x, y, t), outbound, null);
    }
    matcher.matchFix(turned, fix(1390, 60, 2050), outbound, null); // ignored duplicate
    matcher.matchFix(turned, fix(1290, 60, 2060), outbound, null); // standing: still 40 m
    expect(turned.match.pathIdx).toBe(pathIdx('1_1'));
    matcher.matchFix(turned, fix(1300, 60, 2070), outbound, null);
    expect(turned.match.pathIdx).toBe(pathIdx('1_0')); // exactly 50 m in total
  });

  it.each([-0.5, 0.5])('ignores %d m longitudinal steps without accumulating or losing prior-return progress', (step) => {
    const turned = newTrack('submetre-return', '1', 'trip-out', 'tram');
    const outbound = matcher.priorFor('1_0', '1', 0);
    for (const [x, y, t] of [[1300, 0, 2000], [1400, 0, 2010], [1350, 60, 2020], [1250, 60, 2030], [1270, 60, 2040], [1290, 60, 2050]]) {
      matcher.matchFix(turned, fix(x, y, t), outbound, null);
    }
    expect(turned.match.pathIdx).toBe(pathIdx('1_1')); // 40 m, below threshold
    // Even one-sided sub-metre drift must not add up, and every ignored
    // interval advances the baseline so it cannot later count as a big step.
    for (let i = 1; i <= 70; i++) {
      matcher.matchFix(turned, fix(1290 + i * step, 60, 2050 + i * 10), outbound, null);
      expect(turned.match.pathIdx, `sub-metre fix ${i}`).toBe(pathIdx('1_1'));
    }
    matcher.matchFix(turned, fix(1300 + 70 * step, 60, 2760), outbound, null);
    expect(turned.match.pathIdx).toBe(pathIdx('1_0')); // the genuine 10 m completes the original 40 m
  });
});

describe('own-path return and service eligibility', () => {
  it.each([0, 60])('returns from an eligible sibling on the first forward movement beyond scatter at %d m residual', (residual) => {
    const spec = corridorSpec();
    spec.routes[0].paths!.push({ id: 'sibling', direction: 0, edges: [0, 1], synthetic: true });
    const returnNet = syntheticNetwork(spec);
    const m = createMatcher(returnNet);
    const track = newTrack('return', '1', 'trip', 'tram');
    const prior = m.priorFor('1_0', '1', 0);
    m.matchFix(track, fix(600, 0, 1000), prior, null);
    const adopted = returnNet.paths.findIndex((path) => path.id === 'sibling');
    track.match = { pathIdx: adopted, shapeIdx: null, edge: 0, s: 600, residual: 0 };
    m.matchFix(track, fix(600, 0, 1010), prior, null);
    expect(track.match.pathIdx).toBe(adopted);
    track.order.leader = 'old-leader';
    track.offPathCount = 1;
    track.againstCount = 1;
    m.matchFix(track, fix(650, residual, 1020), prior, null);
    expect(track.match.pathIdx).toBe(prior.pathIdx);
    expect(track.match.s).toBeCloseTo(650);
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

  it.each([false, true])('invalidates a weekend path as service evidence changes (explicit prior: %s)', (explicit) => {
    const pathRanks = net.paths.map(() => ({ services: new Set(['sat']), trips: 1 }));
    const m = createMatcher(net, { pathRanks });
    const prior = m.priorFor(null, '9', null, explicit ? 'path:9:0:abc' : null);
    const track = newTrack('context-change', '9', 'trip', 'tram');
    const weekday = { runningServices: new Set(['wd']) };
    // Even a valid index prior is not eligible under known contrary service evidence.
    m.matchFix(track, fix(500, 0, 990), prior, null, weekday);
    expect(track.match.pathIdx).toBeNull();
    m.matchFix(track, fix(500, 0, 1000), prior, null);
    expect(track.match.pathIdx).toBe(pathIdx('path:9:0:abc'));
    track.order.leader = 'old-leader';
    track.againstCount = 1;
    for (const t of [1000, 1010, 1020]) {
      m.matchFix(track, fix(500, 0, t), prior, null, weekday);
      expect(track.match.pathIdx).toBeNull();
      expect(track.match.shapeIdx).toBeNull();
      expect(track.offPathCount).toBe(0);
      expect(track.againstCount).toBe(0);
      expect(track.order.leader).toBeNull();
      expect(track.fixes.at(-1)).not.toHaveProperty('arc');
    }
    m.matchFix(track, fix(500, 0, 1030), prior, null, { runningServices: new Set(['sat']) });
    expect(track.match.pathIdx).toBe(pathIdx('path:9:0:abc'));
  });

  it.each([0, 10])('prefers an eligible prior after a route change with a %d-second GPS interval', (interval) => {
    const track = newTrack('eligible-route-change', '9', 'trip', 'tram');
    matcher.matchFix(track, fix(600, 55, 1000), matcher.priorFor(null, '9', 0), null);
    expect(track.match.pathIdx).toBe(pathIdx('path:9:0:abc'));
    const prior = matcher.priorFor('1_0', '1', 0);
    track.routeId = '1';
    matcher.matchFix(track, fix(600, 55, 1000 + interval), prior, null);
    expect(track.match.pathIdx).toBe(prior.pathIdx); // 55 m prior beats the 5 m opposite rail
    expect(track.match.residual).toBeCloseTo(55);
    expect(track.fixes).toHaveLength(interval === 0 ? 1 : 2);
  });

  it('immediately re-derives an invalidated match when its eligible prior is outside the near band', () => {
    const track = newTrack('remote-route-change', '9', 'trip', 'tram');
    matcher.matchFix(track, fix(600, 90, 1000), matcher.priorFor(null, '9', 0), null);
    track.routeId = '1';
    matcher.matchFix(track, fix(600, 90, 1010), matcher.priorFor('1_0', '1', 0), null);
    expect(track.match.pathIdx).toBe(pathIdx('1_1')); // not a 90 m stray-fix hold on the prior
    expect(track.offPathCount).toBe(0);
  });

  it.each([0, 10])('prefers a newly running prior over closer eligible rails after invalidation (%d-second interval)', (interval) => {
    const spec = corridorSpec();
    spec.routes[0].paths!.push({ id: 'weekday-return', direction: 1, edges: [5], synthetic: true });
    const serviceNet = syntheticNetwork(spec);
    const pathRanks = serviceNet.paths.map((path) => ({ services: new Set([path.id === '1_1' ? 'sat' : 'wd']), trips: 1 }));
    const m = createMatcher(serviceNet, { pathRanks });
    const prior = m.priorFor('1_0', '1', 0);
    const track = newTrack('prior-resumes', '1', 'trip', 'tram');
    m.matchFix(track, fix(600, 55, 1000), prior, null, { runningServices: new Set(['sat']) });
    expect(serviceNet.paths[track.match.pathIdx!].id).toBe('1_1');
    expect(track.priorPath).toBeNull();
    m.matchFix(track, fix(600, 55, 1000 + interval), prior, null, { runningServices: new Set(['wd']) });
    expect(track.match.pathIdx).toBe(prior.pathIdx);
    expect(track.priorPath).toBe(prior.pathIdx);
    expect(track.fixes).toHaveLength(interval === 0 ? 1 : 2);
  });

  it.each([0, 10])('places a newly eligible prior even if the adopted path remains eligible (%d-second interval)', (interval) => {
    const pathRanks = net.paths.map((path) => ({ services: new Set([path.id === '1_0' ? 'wd' : 'sat']), trips: 1 }));
    const m = createMatcher(net, { pathRanks });
    const prior = m.priorFor('1_0', '1', 0);
    const track = newTrack('prior-now-eligible', '1', 'trip', 'tram');
    m.matchFix(track, fix(600, 55, 1000), prior, null, { runningServices: new Set(['sat']) });
    expect(track.match.pathIdx).toBe(pathIdx('1_1'));
    m.matchFix(track, fix(600, 55, 1000 + interval), prior, null, { runningServices: new Set(['sat', 'wd']) });
    expect(track.match.pathIdx).toBe(prior.pathIdx);
    expect(track.priorPath).toBe(prior.pathIdx);
    expect(track.fixes).toHaveLength(interval === 0 ? 1 : 2);
  });

  it.each(['foreign', 'non-running'])('does not return to a %s prior on an agreeing moving fix', (reason) => {
    const pathRanks = net.paths.map(() => ({ services: new Set(['wd']), trips: 1 }));
    pathRanks[pathIdx('1_0')].services = new Set(['sat']);
    const m = createMatcher(net, { pathRanks });
    const prior = { pathIdx: pathIdx(reason === 'foreign' ? 'path:9:0:abc' : '1_0'), shapeIdx: null, routeId: '1', direction: 0 as const };
    const track = newTrack('bad-prior', '1', 'trip', 'tram');
    track.priorPath = prior.pathIdx;
    track.match = { pathIdx: pathIdx('1_1'), shapeIdx: shapeIdx('1_1'), edge: 5, s: 900, residual: 0 };
    track.fixes.push(fix(600, 60, 1000));
    m.matchFix(track, fix(700, 60, 1010), prior, null, { runningServices: new Set(['wd']) });
    expect(track.match.pathIdx).toBe(pathIdx('1_1'));
  });

  it.each([0, 400])('discards a persisted foreign match before an off-graph noise hold (y = %d)', (y) => {
    const track = newTrack('foreign-state', '1', 'trip', 'tram');
    track.match = { pathIdx: pathIdx('path:9:0:abc'), shapeIdx: null, edge: 0, s: 600, residual: 0 };
    matcher.matchFix(track, fix(600, y, 1000), matcher.priorFor(null, '1', null), null);
    expect(track.match.pathIdx).toBe(y === 0 ? pathIdx('1_0') : null);
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

describe('terminal placement continuity', () => {
  it.each(['own', 'foreign'] as const)('releases an endpoint after two off-path fixes onto an %s branch', (owner) => {
    const branch = { id: 'branch', direction: 0 as const, edges: [1] };
    const n = syntheticNetwork({
      edges: [
        { from: 0, to: 1, pts: straight(0, 1000) },
        { from: 1, to: 2, pts: [{ x: 1000, y: 0 }, { x: 1000, y: 1000 }] },
      ],
      routes: [
        { id: '1', type: 0, paths: [{ id: 'out', direction: 0, edges: [0] }, ...(owner === 'own' ? [branch] : [])] },
        ...(owner === 'foreign' ? [{ id: '2', type: 0 as const, paths: [branch] }] : []),
      ],
      stops: [],
    });
    const m = createMatcher(n);
    const t = newTrack('endpoint', '1', 'trip', 'tram');
    const p = m.priorFor('out', '1', 0);
    m.matchFix(t, fix(950, 0, 1000), p, null);
    m.matchFix(t, fix(1000, 0, 1010), p, null);
    m.matchFix(t, fix(1000, 55, 1020), p, null);
    m.matchFix(t, fix(1000, 80, 1030), p, null);
    expect(n.paths[t.match.pathIdx!].id).toBe('out'); // one off-path fix
    expect(t.offPathCount).toBe(1);
    for (let at = 1040; at <= 1640; at += 10) {
      m.matchFix(t, fix(1000, 130, at), p, null);
      expect(t.offGraph).toBe(false);
      expect(t.match.residual).toBeCloseTo(0);
      if (owner === 'own') {
        expect(n.paths[t.match.pathIdx!].id).toBe('branch');
        expect(t.match.s).toBeCloseTo(130);
      } else {
        expect(t.match.pathIdx).toBeNull();
        expect(t.match.shapeIdx).toBeNull();
        expect(t.fixes.at(-1)).not.toHaveProperty('arc');
      }
    }
  });

  it('bounds even a longitudinal truncated-end hold instead of renewing it on standing reports', () => {
    const n = syntheticNetwork({
      edges: [
        { from: 0, to: 1, pts: straight(0, 1000) },
        { from: 2, to: 3, pts: straight(1150, 0, 6) },
      ],
      routes: [{ id: '1', type: 0, paths: [
        { id: 'out', direction: 0, edges: [0] },
        { id: 'back', direction: 1, edges: [1] },
      ] }],
      stops: [],
    });
    const m = createMatcher(n);
    let t = newTrack('truncated', '1', 'trip', 'tram');
    const p = m.priorFor('out', '1', 0);
    m.matchFix(t, fix(990, 0, 1000), p, null);
    for (let at = 1010; at <= 1610; at += 10) {
      m.matchFix(t, fix(1100, 0, at), p, null);
      if (at <= 1040) expect(n.paths[t.match.pathIdx!].id).toBe('out');
      if (at === 1030) t = JSON.parse(JSON.stringify(t)); // cold restore cannot renew the hold
      if (at === 1050) expect(t.offPathCount).toBe(1);
      if (at >= 1060) expect(t.match.pathIdx === null || t.match.residual <= 60).toBe(true);
    }
  });

  it('stays unplaced through a missing directed departure instead of running an adopted arrival backwards', () => {
    const n = syntheticNetwork({
      edges: [
        { from: 0, to: 1, pts: straight(600, 1600) },
        { from: 2, to: 3, pts: straight(600, 0, 6) },
      ],
      routes: [{ id: '1', type: 0, paths: [
        { id: 'departure', direction: 0, edges: [0] },
        // Same direction_id is not evidence that the actual rail points the
        // same way (the recorded Mandlova variants have this shape).
        { id: 'arrival', direction: 0, edges: [1] },
      ] }],
      stops: [],
    });
    const m = createMatcher(n);
    const t = newTrack('missing-departure', '1', 'trip', 'tram');
    const p = m.priorFor('departure', '1', 0);
    m.matchFix(t, fix(0, 6, 1000), p, null);
    expect(n.paths[t.match.pathIdx!].id).toBe('arrival');
    m.matchFix(t, fix(100, 6, 1010), p, null);
    m.matchFix(t, fix(200, 6, 1020), p, null);
    expect(t.match.pathIdx).toBeNull();
    for (const [i, x] of [200, 200, 300, 400, 500].entries()) {
      m.matchFix(t, fix(x, 6, 1030 + i * 20), p, null);
      expect(t.match.pathIdx).toBeNull();
      expect(t.offGraph).toBe(false);
    }
    m.matchFix(t, fix(650, 0, 1140), p, null);
    expect(n.paths[t.match.pathIdx!].id).toBe('departure');
  });

  it('does not seed a remote prior when the first fix is outside the near band of every eligible rail', () => {
    const n = syntheticNetwork({
      edges: [
        { from: 0, to: 1, pts: straight(0, 600) },
        { from: 1, to: 2, pts: straight(600, 1600) },
      ],
      routes: [{ id: '1', type: 0, paths: [
        { id: 'departure', direction: 0, edges: [1] },
        { id: 'approach', direction: 0, edges: [0, 1] },
      ] }],
      stops: [],
    });
    const m = createMatcher(n);
    const t = newTrack('off-departure', '1', 'trip', 'tram');
    const p = m.priorFor('departure', '1', 0);
    m.matchFix(t, fix(0, 80, 1000), p, null);
    expect(t.match.pathIdx).toBeNull();
    expect(t.match.edge).toBe(0);
    expect(t.offGraph).toBe(false);
    m.matchFix(t, fix(0, 0, 1010), p, null);
    expect(n.paths[t.match.pathIdx!].id).toBe('approach');
  });

  it('uses the recent approach direction when a diverted tram stops between opposite rails', () => {
    const n = syntheticNetwork({
      edges: [
        { from: 0, to: 1, pts: straight(0, 1000) },
        { from: 1, to: 2, pts: [{ x: 1000, y: 0 }, { x: 1000, y: 400 }] },
        { from: 3, to: 4, pts: [{ x: 1006, y: 400 }, { x: 1006, y: 0 }] },
        { from: 1, to: 5, pts: straight(1000, 2000) },
      ],
      routes: [{ id: '1', type: 0, paths: [
        { id: 'prior', direction: 0, edges: [0, 3] },
        { id: 'diversion', direction: 0, edges: [0, 1] },
        { id: 'opposite', direction: 1, edges: [2] },
      ] }],
      stops: [],
    });
    const m = createMatcher(n);
    const t = newTrack('diverted', '1', 'trip', 'tram');
    const p = m.priorFor('prior', '1', 0);
    m.matchFix(t, fix(950, 0, 980), p, null);
    m.matchFix(t, fix(1000, 58, 1000), p, null);
    m.matchFix(t, fix(1000, 90, 1010), p, null);
    expect(n.paths[t.match.pathIdx!].id).toBe('prior'); // one stray is still tolerated
    m.matchFix(t, fix(1006, 90, 1020), p, null);
    expect(n.paths[t.match.pathIdx!].id).toBe('diversion');
  });

  it.each([53, EVICT_S, EVICT_S + 1])('keeps approach evidence through a standing fix, bounded by report lifetime (%i s)', (age) => {
    // 22134, 20 Sep 11:50:34 -> 11:50:56 -> 11:51:17:
    // a southbound approach followed by a stopped report; the 30 s
    // lookback lost the approach and adopted the nearer northbound rail.
    const n = syntheticNetwork({
      edges: [
        { from: 0, to: 1, pts: straight(0, 2000) },
        { from: 2, to: 3, pts: [{ x: 1000, y: 0 }, { x: 1000, y: 400 }] },
        { from: 4, to: 5, pts: [{ x: 1006, y: 400 }, { x: 1006, y: 0 }] },
      ],
      routes: [{ id: '1', type: 0, paths: [
        { id: 'prior', direction: 0, edges: [0] },
        { id: 'diversion', direction: 0, edges: [1] },
        { id: 'opposite', direction: 1, edges: [2] },
      ] }],
      stops: [],
    });
    const m = createMatcher(n);
    const t = newTrack('stopped-diversion', '1', 'trip', 'tram');
    const p = m.priorFor('prior', '1', 0);
    m.matchFix(t, fix(1000, 58, 1000), p, null);
    m.matchFix(t, fix(1000, 90, 1010), p, null);
    m.matchFix(t, fix(1006, 90, 1000 + age), p, null);
    expect(n.paths[t.match.pathIdx!].id).toBe(age <= EVICT_S ? 'diversion' : 'opposite');
  });

  it('holds a truncated trip endpoint instead of adopting the arrival variant', () => {
    const n = syntheticNetwork({
      edges: [
        { from: 0, to: 1, pts: straight(0, 1000) },
        { from: 2, to: 3, pts: straight(1150, 0, 6) },
      ],
      routes: [{ id: '1', type: 0, paths: [
        { id: 'out', direction: 0, edges: [0] },
        { id: 'back', direction: 1, edges: [1] },
      ] }],
      stops: [],
    });
    const m = createMatcher(n);
    const t = newTrack('terminal', '1', 'trip', 'tram');
    const p = m.priorFor('out', '1', 0);
    for (const [i, x] of [950, 990, 1070, 1100, 1100, 1100].entries()) {
      m.matchFix(t, fix(x, 0, 1000 + i * 10), p, null);
      expect(n.paths[t.match.pathIdx!].id).toBe('out');
      expect(t.offGraph).toBe(false);
    }
    expect(t.match.s).toBe(1000);
    // Actual return movement is still a turnaround, not a permanent hold.
    m.matchFix(t, fix(980, 6, 1060), p, null);
    m.matchFix(t, fix(880, 6, 1070), p, null);
    expect(n.paths[t.match.pathIdx!].id).toBe('back');
  });

  it('places a new trip on nearby eligible rails without a remote-prior tick', () => {
    const n = syntheticNetwork({
      edges: [
        { from: 0, to: 1, pts: straight(0, 600) },
        { from: 1, to: 2, pts: straight(600, 1600) },
      ],
      routes: [{ id: '1', type: 0, paths: [
        { id: 'departure', direction: 0, edges: [1] },
        { id: 'approach', direction: 0, edges: [0, 1] },
      ] }],
      stops: [],
    });
    const m = createMatcher(n);
    const t = newTrack('new-departure', '1', 'trip', 'tram');
    m.matchFix(t, fix(0, 0, 1000), m.priorFor('departure', '1', 0), null);
    expect(n.paths[t.match.pathIdx!].id).toBe('approach');
    expect(t.match.residual).toBe(0);
    expect(t.match.s).toBe(0);
  });

  it('allows one approaching fix at a nearby cropped prior after a trip handover', () => {
    // 10324, 21 Sep 17:37:30: the new prior starts 62 m away, then
    // 43 m away at the next fix. The arrival is real, but need not be
    // adopted for one fix while entering the new trip's own near band.
    const n = syntheticNetwork({
      edges: [
        { from: 0, to: 1, pts: straight(-200, 0) },
        { from: 1, to: 2, pts: straight(0, 1000) },
      ],
      routes: [{ id: '1', type: 0, paths: [
        { id: 'departure', direction: 0, edges: [1] },
        { id: 'approach', direction: 0, edges: [0, 1] },
      ] }],
      stops: [],
    });
    const m = createMatcher(n);
    const t = newTrack('handover', '1', 'old-trip', 'tram');
    m.matchFix(t, fix(-77, 0, 1000), m.priorFor('approach', '1', 0), null);
    t.tripId = 'new-trip';
    const p = m.priorFor('departure', '1', 0);
    m.matchFix(t, fix(-62, 0, 1010), p, null);
    expect(n.paths[t.match.pathIdx!].id).toBe('departure');
    expect(t.offPathCount).toBe(1);
    m.matchFix(t, fix(-43, 0, 1020), p, null);
    expect(n.paths[t.match.pathIdx!].id).toBe('departure');
    expect(t.offPathCount).toBe(0);
  });

  it('keeps a genuinely placed arrival at a handover until the cropped departure is entered', () => {
    // 102419 at 17:27:11 and 102417 at 17:41:55 on 20 Sep:
    // the new trip is named while the tram still occupies its arrival.
    // A clipped departure 55-60 m away is not evidence of entering it.
    const n = syntheticNetwork({
      edges: [
        { from: 0, to: 1, pts: straight(0, 1000) },
        { from: 2, to: 3, pts: straight(1060, 2060) },
      ],
      routes: [{ id: '1', type: 0, paths: [
        { id: 'arrival', direction: 0, edges: [0] },
        { id: 'departure', direction: 1, edges: [1] },
      ] }],
      stops: [],
    });
    const m = createMatcher(n);
    const t = newTrack('still-arriving', '1', 'old-trip', 'tram');
    m.matchFix(t, fix(990, 0, 1000), m.priorFor('arrival', '1', 0), null);
    t.tripId = 'new-trip';
    const p = m.priorFor('departure', '1', 1);
    m.matchFix(t, fix(1001, 0, 1010), p, null);
    expect(n.paths[t.match.pathIdx!].id).toBe('arrival');
    for (let at = 1020; at <= 1620; at += 10) {
      m.matchFix(t, fix(999, 0, at), p, null);
      expect(n.paths[t.match.pathIdx!].id).toBe('arrival');
      expect(t.match.residual).toBe(0); // genuine placement, not endpoint grace
    }
    m.matchFix(t, fix(1070, 0, 1630), p, null);
    expect(n.paths[t.match.pathIdx!].id).toBe('departure');
  });

  it('does not return to a clipped departure endpoint while approaching it', () => {
    const n = syntheticNetwork({
      edges: [
        { from: 0, to: 1, pts: straight(-200, 0) },
        { from: 1, to: 2, pts: straight(0, 1000) },
      ],
      routes: [{ id: '1', type: 0, paths: [
        { id: 'departure', direction: 0, edges: [1] },
        { id: 'approach', direction: 0, edges: [0, 1] },
      ] }],
      stops: [],
    });
    const m = createMatcher(n);
    const t = newTrack('approaching', '1', 'trip', 'tram');
    const p = m.priorFor('departure', '1', 0);
    for (const [i, x] of [-140, -80, -20, 0].entries()) {
      m.matchFix(t, fix(x, 0, 1000 + i * 10), p, null);
      expect(n.paths[t.match.pathIdx!].id).toBe('approach');
    }
    // Genuine motion onto the shared departure rail still restores the prior.
    m.matchFix(t, fix(60, 0, 1040), p, null);
    expect(n.paths[t.match.pathIdx!].id).toBe('departure');
  });

  it('accumulates a return around a bend using the current projected tangent', () => {
    // 102301, 20 Sep 17:51:07 and 17:51:17: the adopted rail's
    // previous arc points along the new movement, but its CURRENT
    // projection runs backwards. Losing the first interval deferred the
    // return until the next fix, 118 s and 753 m later.
    const n = syntheticNetwork({
      edges: [
        { from: 0, to: 1, pts: [{ x: 0, y: 0 }, { x: -100, y: -100 }] },
        { from: 1, to: 2, pts: straight(-100, 0, -100) },
        { from: 3, to: 4, pts: [{ x: -50, y: -30 }, { x: -50, y: 970 }] },
      ],
      routes: [{ id: '1', type: 0, paths: [
        { id: 'adopted', direction: 1, edges: [0, 1] },
        { id: 'departure', direction: 0, edges: [2] },
      ] }],
      stops: [],
    });
    const m = createMatcher(n);
    const t = newTrack('return-at-bend', '1', 'trip', 'tram');
    const p = m.priorFor('departure', '1', 0);
    m.matchFix(t, fix(-100, -100, 1000), p, null);
    expect(n.paths[t.match.pathIdx!].id).toBe('adopted');
    m.matchFix(t, fix(-70, -65, 1010), p, null);
    expect(n.paths[t.match.pathIdx!].id).toBe('adopted'); // only 35 forward metres
    m.matchFix(t, fix(-55, -40, 1020), p, null);
    expect(n.paths[t.match.pathIdx!].id).toBe('departure'); // 35 + 25, at the real near endpoint
    expect(t.match.s).toBe(0);
    expect(t.match.residual).toBeLessThan(12);
  });
});

describe('parallel-street stability', () => {
  it('does not alternate paths when residuals alternate across streets 40 m apart', () => {
    const parallel = syntheticNetwork({
      edges: [
        { from: 0, to: 1, pts: straight(0, 2700) },
        { from: 2, to: 3, pts: straight(0, 2700, 40) },
      ],
      routes: [{ id: '7', type: 0, paths: [
        { id: 'prior', direction: 0, edges: [0] },
        { id: 'sibling', direction: 0, edges: [1] },
      ] }],
      stops: [],
    });
    const m = createMatcher(parallel);
    const prior = m.priorFor('prior', '7', 0);
    const track = newTrack('parallel', '7', 'trip', 'tram');
    track.priorPath = prior.pathIdx;
    track.match = { pathIdx: 1, shapeIdx: 1, edge: 1, s: 400, residual: 0 };
    track.fixes.push(fix(400, 40, 1000));
    // Alternating 5/35 m residuals do not cause oscillation. The third
    // 20 m interval reaches the cumulative threshold and returns just once.
    const paths: Array<number | null> = [track.match.pathIdx];
    for (let i = 1; i <= 12; i++) {
      const x = i <= 6 ? 400 + i * 20 : 520 + (i - 6) * 100;
      m.matchFix(track, fix(x, i % 2 ? 5 : 35, 1000 + i * 10), prior, null);
      paths.push(track.match.pathIdx);
      expect(track.match.pathIdx).toBe(i < 3 ? 1 : 0);
    }
    expect(paths.slice(1).filter((path, i) => path !== paths[i])).toHaveLength(1);
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
