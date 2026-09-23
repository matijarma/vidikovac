// Map matching for the twin: where on the rail graph (a tram) or on its
// route's polylines (a bus) a reported fix puts the vehicle. The trip's own
// path is checked at every fix; geometry decides where it no longer fits.
// Nothing here draws anything: the match is the
// planner's anchor (plan.ts) and the ordering register's frame (order.ts).
//
// Rules (plan "Engine core", R-TE22, the reviewer's A10):
//   - return to the trip's own path within NEAR_M after cumulative forward
//     longitudinal movement beyond scatter; backward/off-path fixes reset it;
//   - use only the route's own paths, excluding known non-running services;
//     prefer the prior, current path, edge sequence, direction, then trip count;
//   - a fix off its path by more than NEAR_M once is noise and stays on the
//     path; twice in a row it is a detour, and the path is re-derived from
//     the edge the vehicle is actually on;
//   - off the route's rails, stay unplaced (free plane) and retry each fix;
//     another line's path is never a substitute for missing own-route rails;
//   - a confirmed backward adopted rail with no directed departure fit
//     also uses real free-plane fixes until eligible forward rails fit;
//   - two fixes further than OFF_GRAPH_M from every edge put the vehicle off
//     the graph (a balloon loop, a depot track, a works detour no shape
//     draws), a fix within NEAR_M of an edge brings it back;
//   - a bus never touches a rail edge: it matches its route's bus shapes with
//     model.ts's own hysteresis, or rides the free plane;
//   - (R-TE45) a geometry that passes itself (a circuit's two rails metres
//     apart, a balloon loop) offers several nearest points; a placed vehicle
//     chooses among those within reach of its last arc, by residual and by
//     how far the arc lies from where its own speed puts it, and a first
//     placement by residual, direction of movement and the stop ZET names
//     next; a vehicle found moving against the rail it stands on is on the
//     wrong fold and is placed afresh.

import { dist, type XY } from './geo';
import type { GraphNetwork } from './network';
import { arcOnPath } from './order';
import { SILENCE_HOLD_S } from './plan';
import { project, projectionsWithin, tangent } from './polyline';
import { DEAD_ZONE_M, MAX_SPEED_MS, STOP_ZONE_M } from './speed';
import { lastFix, noMatch, pushFix, resetOrder, type Match, type PlaneFix, type Track } from './track';

/** A fix within this of an edge is on it: ZET's GPS scatters up to about
 *  30 m around the track it is on (the side of the street reads right in
 *  the probe of 16 Sept), and twice that admits the rare wide fix without
 *  admitting a parallel street. */
export const NEAR_M = 60;
/** A candidate whose direction of travel disagrees with the vehicle's own
 *  last movement is probably the other track of the line; 60 m swings the
 *  choice without overriding a genuinely large gap in distance (model.ts). */
export const DIRECTION_PENALTY_M = 60;
/** A candidate the vehicle could not have reached since its last fix at the
 *  fleet's top speed, plus a fix's worth of slack, is probably a stray. */
export const REACH_PENALTY_M = 60;
export const REACH_SLACK_M = 50;
/** A match already past the stop ZET says is next is suspect, but not
 *  wrong: the update can be a tick stale. */
export const PAST_NEXT_STOP_PENALTY_M = 40;
/** Off-path fixes in a row before the path is re-derived: one is noise. */
export const OFF_PATH_FIXES = 2;
/** Beyond this from every edge the vehicle is not "a bit off", it is
 *  somewhere the graph does not go (model.ts's DISCREPANCY_LIMIT_M). */
export const OFF_GRAPH_M = 150;
export const OFF_GRAPH_FIXES = 2;
/** A bus keeps its shape unless a sibling beats it by this (model.ts). */
export const BUS_HYSTERESIS_M = 25;
/** How far back along its geometry a placed vehicle may be read: platform
 *  scatter and the dead zone, never a reversal (R-TE45). */
export const BACK_WINDOW_M = 60;
/** Metres of residual one metre of arc away from the expected arc (the last
 *  arc plus own speed times the interval) is worth when choosing among the
 *  folds within reach: a fold 200 m from expectation costs a 100 m residual,
 *  so scatter of a few metres never flips a standing tram to the other rail. */
export const ARC_PRIOR_WEIGHT = 0.5;
/** Metres of residual one metre of arc before the next stop is worth at a
 *  first placement: the fold whose platform is the next one wins over the
 *  fold a whole circuit earlier, and nothing else changes. */
export const NEXT_STOP_DISTANCE_WEIGHT = 0.01;
/** Movement beyond scatter: fold placement uses one ground interval, D4
 *  uses one longitudinal interval, and prior return accumulates forward metres. */
export const FOLD_MOVE_M = 50;
/** Smaller longitudinal intervals are noise, not accumulated return progress
 *  or reversals. Also covers the sub-metre rounding of a legacy stored fix. */
const PRIOR_RETURN_NOISE_M = 1;
/** Keep a recent approach bearing across a stopped fix at a junction.
 *  This is candidate selection evidence only, never D4/return movement. */
const DIRECTION_MEMORY_S = 30;
/** Consecutive fixes moving against the rail the vehicle is read on before
 *  the path is re-derived to the other direction (D4). One is a stray or a
 *  platform shuffle; two in a row, both further than FOLD_MOVE_M, is a tram
 *  that has turned at its terminus while ZET still names the old trip. */
export const FOLD_FIXES = 2;

export interface Prior {
  /** The rail path the trip runs, or null for a shapeless pattern without a synthetic path (and for buses). */
  pathIdx: number | null;
  /** The bus shape the trip runs, or null for trams and unknown trips. */
  shapeIdx: number | null;
  routeId: string;
  direction: 0 | 1 | null;
}

export interface PathRank {
  /** Empty for paths no indexed trip uses, including terminus loops. */
  services: ReadonlySet<string>;
  trips: number;
}

export interface MatchContext {
  /** Services observed in the frame's joins; null/empty means unknown. */
  runningServices: ReadonlySet<string> | null;
}

export interface Matcher {
  priorFor(shapeId: string | null, routeId: string, direction: 0 | 1 | null, pathId?: string | null): Prior;
  /** Pushes the fix into the track and matches it; returns the new match. */
  matchFix(track: Track, fix: PlaneFix, prior: Prior, nextStopId: string | null, ctx?: MatchContext): Match;
  /** Stops strictly between two arcs of a geometry key (`p<path>` or
   *  `b<shape>`), by id, for the speed estimate's per-stop dwell charge. */
  stopsBetween(key: string, fromS: number, toS: number): string[];
}

interface Candidate {
  edge: number;
  pathIdx: number;
  s: number;
  d: number;
  score: number;
}

/** Matcher-owned, optional on older tracks. Kept on the track (not in a
 *  matcher cache) so the existing state serialization preserves progress. */
interface TramTrack extends Track {
  /** The short grace for a cropped terminal starts once, not on every
   *  standing report. Optional so older persisted tracks remain readable. */
  endpointHold?: { pathIdx: number; since: number };
  /** A confirmed wrong-way adopted rail has no directed placement. Keep
   *  its observed bearing while unplaced, including through standing fixes. */
  unplacedDirection?: XY;
  priorReturn?: {
    pathIdx: number;
    fromPathIdx: number;
    atSec: number;
    forwardM: number;
    /** Last raw point, preserved by persist.ts's track spread while the fix
     *  history is rounded. Absent in older state rows. */
    baseline?: XY;
  };
}

export function createMatcher(net: GraphNetwork, { pathRanks }: { pathRanks?: readonly PathRank[] } = {}): Matcher {
  const shapeIndexById = new Map<string, number>(net.shapes.map((shape, idx) => [shape.id, idx] as const));
  const pathIndexById = new Map<string, number>(net.paths.map((path, idx) => [path.id, idx] as const));
  const pathsByEdge = new Map<number, number[]>();
  net.paths.forEach((path, pathIdx) => {
    for (const e of path.edges) {
      const list = pathsByEdge.get(e);
      if (list) list.push(pathIdx);
      else pathsByEdge.set(e, [pathIdx]);
    }
  });
  const pathsByRoute = new Map<string, number[]>();
  net.paths.forEach((path, pathIdx) => {
    const list = pathsByRoute.get(path.route);
    if (list) list.push(pathIdx);
    else pathsByRoute.set(path.route, [pathIdx]);
  });
  const stopArcCache = new Map<number, Map<string, number>>();

  function stopArc(pathIdx: number, stopId: string): number | null {
    let byId = stopArcCache.get(pathIdx);
    if (!byId) {
      byId = new Map();
      for (const entry of net.stopsOnPath(pathIdx)) if (!byId.has(entry.stop.id)) byId.set(entry.stop.id, entry.s);
      stopArcCache.set(pathIdx, byId);
    }
    return byId.get(stopId) ?? null;
  }

  /** The index of the edge under arc `s` of a path. */
  function edgeIndexAt(pathIdx: number, s: number): number {
    const path = net.paths[pathIdx];
    let k = 0;
    while (k + 1 < path.edges.length && path.offsets[k + 1] <= s) k++;
    return k;
  }

  function edgeTangentAgrees(edge: number, sOnEdge: number, dir: XY | null): boolean {
    if (!dir) return true;
    const e = net.edges[edge];
    const tan = tangent(e.pts, e.cum, sOnEdge);
    return tan.x * dir.x + tan.y * dir.y >= 0;
  }

  function priorFor(shapeId: string | null, routeId: string, direction: 0 | 1 | null, pathId?: string | null): Prior {
    if (shapeId !== null) {
      const shapeIdx = shapeIndexById.get(shapeId);
      if (shapeIdx !== undefined && net.shapes[shapeIdx].route === routeId) {
        const pathIdx = net.pathOfShape(shapeIdx);
        const shapeDir = net.shapes[shapeIdx].direction;
        return { pathIdx, shapeIdx, routeId, direction: shapeDir === 0 || shapeDir === 1 ? shapeDir : direction };
      }
    }
    // The path the trip index resolved for this trip's pattern (F8): a
    // shapeless variant gets the synthetic path built from its own stop
    // sequence, which is the one the timetable has segments for.
    if (pathId) {
      const own = pathIndexById.get(pathId);
      if (own !== undefined && pathEligible(own, routeId)) return { pathIdx: own, shapeIdx: null, routeId, direction };
    }
    if (direction !== null) {
      const synthetic = net.paths.findIndex((p) => p.shape === null && p.route === routeId && p.direction === direction);
      if (synthetic >= 0) return { pathIdx: synthetic, shapeIdx: null, routeId, direction };
    }
    return { pathIdx: null, shapeIdx: null, routeId, direction };
  }

  function pathEligible(pathIdx: number, routeId: string, ctx?: MatchContext): boolean {
    if (net.paths[pathIdx]?.route !== routeId) return false;
    const running = ctx?.runningServices;
    const services = pathRanks?.[pathIdx]?.services;
    if (!running?.size || !services?.size) return true;
    for (const service of services) if (running.has(service)) return true;
    return false;
  }

  function wantedDirection(edge: number, sOnEdge: number, dir: XY | null, prior: Prior): 0 | 1 | null {
    if (prior.direction === null) return null;
    // Every path runs the edge in the edge's own direction (edges are
    // directed), so agreement is a property of the EDGE, not of the paths
    // over it: what it chooses among them is the service direction the
    // vehicle is evidently running. Moving along the edge, it is still
    // running the direction its prior named; moving against it, it is
    // running the other one -- which is what a terminus turnaround is.
    const agrees = edgeTangentAgrees(edge, sOnEdge, dir);
    return agrees ? prior.direction : prior.direction === 0 ? 1 : 0;
  }

  /** Lexicographic path preference; direction is no evidence for an unknown
   *  trip. The final index tie-break makes the answer independent of the
   *  edge index's insertion order, even when no trip counts are available. */
  function comparePaths(a: number, b: number, edge: number, wanted: 0 | 1 | null, track: Track, prior: Prior): number {
    const continues = (idx: number): boolean => track.match.edge !== null
      && net.paths[idx].edges.some((e, i, edges) => e === track.match.edge && edges[i + 1] === edge);
    return Number(b === prior.pathIdx) - Number(a === prior.pathIdx)
      || Number(b === track.match.pathIdx) - Number(a === track.match.pathIdx)
      || Number(continues(b)) - Number(continues(a))
      || (wanted === null ? 0 : Number(net.paths[b].direction === wanted) - Number(net.paths[a].direction === wanted))
      || (pathRanks?.[b]?.trips ?? 0) - (pathRanks?.[a]?.trips ?? 0)
      || a - b;
  }

  /** Only own-route, running paths can be adopted. No foreign-path fallback. */
  function adoptPath(edge: number, sOnEdge: number, track: Track, prior: Prior, dir: XY | null, ctx?: MatchContext): number | null {
    const wanted = wantedDirection(edge, sOnEdge, dir, prior);
    let best: number | null = null;
    for (const pathIdx of pathsByEdge.get(edge) ?? []) {
      if (!pathEligible(pathIdx, prior.routeId, ctx)) continue;
      if (best === null || comparePaths(pathIdx, best, edge, wanted, track, prior) < 0) best = pathIdx;
    }
    return best;
  }

  function candidatesFor(track: TramTrack, p: XY, dir: XY | null, dtSec: number, prior: Prior, nextStopId: string | null, ctx?: MatchContext): Candidate[] {
    const hits = net.edgesNear(p, NEAR_M);
    const routeEdges = new Set<number>();
    for (const pathIdx of pathsByRoute.get(prior.routeId) ?? []) {
      if (pathEligible(pathIdx, prior.routeId, ctx)) for (const e of net.paths[pathIdx].edges) routeEdges.add(e);
    }
    const out: Candidate[] = [];
    for (const hit of hits) {
      if (!routeEdges.has(hit.edge)) continue;
      if (track.unplacedDirection && !edgeTangentAgrees(hit.edge, hit.s, dir ?? track.unplacedDirection)) continue;
      const pathIdx = adoptPath(hit.edge, hit.s, track, prior, dir, ctx);
      if (pathIdx === null) continue;
      const path = net.paths[pathIdx];
      // A path that runs this edge twice (a circuit, a balloon) offers two
      // arcs a lap apart: the one nearest where the vehicle already was is
      // the one it is on, and the first occurrence is a lap out (R-TE45).
      const s = arcOnPath(path, hit.edge, hit.s, track.match.pathIdx === pathIdx ? track.match.s : null);
      if (s === null) continue;
      let score = hit.d;
      if (!edgeTangentAgrees(hit.edge, hit.s, dir)) score += DIRECTION_PENALTY_M;
      if (track.match.pathIdx === pathIdx && dtSec > 0 && Math.abs(s - track.match.s) > MAX_SPEED_MS * dtSec + REACH_SLACK_M) score += REACH_PENALTY_M;
      if (nextStopId !== null) {
        const sNext = stopArc(pathIdx, nextStopId);
        if (sNext !== null && s > sNext + PAST_NEXT_STOP_PENALTY_M) score += PAST_NEXT_STOP_PENALTY_M;
      }
      out.push({ edge: hit.edge, pathIdx, s, d: hit.d, score });
    }
    out.sort((a, b) => a.score - b.score || a.d - b.d);
    return out;
  }

  interface Placement {
    s: number;
    d: number;
  }

  /** What the vehicle's last interval says about where it is now. */
  interface Motion {
    /** Raw displacement, including slow movement below the direction dead zone. */
    delta: XY;
    /** Unit direction of the ground movement, null under the dead zone. */
    dir: XY | null;
    /** Metres moved on the ground since the previous fix. */
    groundM: number;
    dtSec: number;
    /** The speed estimate carried on the track, m/s. */
    speed: number;
  }

  /**
   * Places a fix on one geometry (R-TE45). Continuing on it: the folds within
   * reach of the last arc, scored by residual plus the arc prior; a choice
   * that has the vehicle moving against the rail is a wrong fold and falls to
   * a first placement. First placement: every fold within the near band,
   * scored by residual, direction of movement and the stop named next. With
   * no fold within the near band, the plain nearest point (its residual tells
   * the caller it is a stray or a detour).
   */
  function place(pts: readonly XY[], cum: readonly number[], len: number, p: XY, motion: Motion, prevS: number | null, sNext: number | null): Placement {
    const agrees = (s: number): boolean => motion.dir === null || dot(tangent(pts, cum, s), motion.dir) >= 0;
    if (prevS !== null) {
      const dt = Math.max(motion.dtSec, 0);
      const window = projectionsWithin(pts, cum, p, prevS - BACK_WINDOW_M, prevS + MAX_SPEED_MS * dt + REACH_SLACK_M, OFF_GRAPH_M);
      if (window.length > 0) {
        const expected = prevS + Math.min(Math.max(motion.speed, 0), MAX_SPEED_MS) * dt;
        let best = window[0];
        let bestScore = Number.POSITIVE_INFINITY;
        for (const c of window) {
          const score = c.d + ARC_PRIOR_WEIGHT * Math.abs(c.s - expected);
          if (score < bestScore) {
            best = c;
            bestScore = score;
          }
        }
        const against = motion.dir !== null && motion.groundM >= FOLD_MOVE_M && !agrees(best.s);
        if (!against) return { s: best.s, d: best.d };
      }
    }
    // Every fold within the off-graph band, the residual weighing itself in
    // the score: at a circuit's terminus the arrival platform is the path's
    // end and the departure platform, a hundred metres on, its start, and a
    // vehicle whose next stop is the first one belongs at the start even
    // while it still stands at the end. Failing any fold that close, the
    // plain nearest point, whose residual says the vehicle is far off.
    const all = projectionsWithin(pts, cum, p, 0, len, OFF_GRAPH_M);
    if (all.length === 0) {
      const proj = project(pts, cum, p);
      return { s: proj.s, d: proj.d };
    }
    let best = all[0];
    let bestScore = Number.POSITIVE_INFINITY;
    for (const c of all) {
      let score = c.d;
      if (!agrees(c.s)) score += DIRECTION_PENALTY_M;
      if (sNext !== null) {
        if (c.s > sNext + PAST_NEXT_STOP_PENALTY_M) score += PAST_NEXT_STOP_PENALTY_M;
        score += NEXT_STOP_DISTANCE_WEIGHT * Math.max(0, sNext - c.s);
      }
      if (score < bestScore) {
        best = c;
        bestScore = score;
      }
    }
    return { s: best.s, d: best.d };
  }

  /** The path a vehicle found running against its own rails belongs on (D4):
   *  the nearest edge within NEAR_M whose direction agrees with the movement,
   *  on a path of the same route running the OPPOSITE direction. At a
   *  terminus ZET names the old trip for a fix or two after the tram has
   *  turned, and the other track is three to six metres away -- well inside
   *  the near band, so nothing here ever looked like a detour. Null when no
   *  such rail is within reach, and then the vehicle keeps its projection. */
  function turnaroundMatch(fromPathIdx: number, p: XY, motion: Motion, track: Track, prior: Prior, ctx?: MatchContext): Match | null {
    const current = net.paths[fromPathIdx];
    let best: { pathIdx: number; edge: number; s: number; d: number } | null = null;
    for (const hit of net.edgesNear(p, NEAR_M)) {
      for (const pathIdx of pathsByEdge.get(hit.edge) ?? []) {
        const path = net.paths[pathIdx];
        if (pathIdx === fromPathIdx || !pathEligible(pathIdx, prior.routeId, ctx)) continue;
        if (path.direction === current.direction) continue;
        const s = arcOnPath(path, hit.edge, hit.s, null);
        if (s === null) continue;
        // D4 must not bypass the prior-return gate through a large lateral
        // diagonal. Measure forward metres on the candidate's own tangent.
        if (pathForwardM(pathIdx, s, motion.delta) < FOLD_MOVE_M) continue;
        if (best === null || hit.d < best.d
          || (hit.d === best.d && comparePaths(pathIdx, best.pathIdx, hit.edge, wantedDirection(hit.edge, hit.s, motion.dir, prior), track, prior) < 0)) {
          best = { pathIdx, edge: hit.edge, s, d: hit.d };
        }
      }
    }
    if (best === null) return null;
    return { pathIdx: best.pathIdx, shapeIdx: net.paths[best.pathIdx].shape, edge: best.edge, s: best.s, residual: best.d };
  }

  /** Does the path's own tangent at arc `s` agree with the ground movement? */
  function pathTangentAgrees(pathIdx: number, s: number, dir: XY | null): boolean {
    if (!dir) return true;
    const geo = net.pathGeometry(pathIdx);
    return dot(tangent(geo.pts, geo.cum, s), dir) >= 0;
  }

  function pathForwardM(pathIdx: number, s: number, delta: XY): number {
    const geo = net.pathGeometry(pathIdx);
    return dot(tangent(geo.pts, geo.cum, s), delta);
  }

  function onPathMatch(track: Track, pathIdx: number, p: XY, motion: Motion, nextStopId: string | null): Match {
    const path = net.paths[pathIdx];
    const geo = net.pathGeometry(pathIdx);
    const prevS = track.match.pathIdx === pathIdx ? track.match.s : null;
    const sNext = nextStopId !== null ? stopArc(pathIdx, nextStopId) : null;
    const placed = place(geo.pts, geo.cum, path.len, p, motion, prevS, sNext);
    return { pathIdx, shapeIdx: path.shape, edge: path.edges[edgeIndexAt(pathIdx, placed.s)] ?? null, s: placed.s, residual: placed.d };
  }

  function motionOf(track: Track, fix: PlaneFix, prev: PlaneFix | null): Motion {
    const p = { x: fix.x, y: fix.y };
    const delta = prev ? { x: p.x - prev.x, y: p.y - prev.y } : { x: 0, y: 0 };
    const groundM = prev ? dist(prev, p) : 0;
    const dir: XY | null = prev && groundM >= DEAD_ZONE_M ? normalise(delta) : null;
    return { delta, dir, groundM, dtSec: prev ? fix.atSec - prev.atSec : 0, speed: track.speed };
  }

  function matchTram(track: TramTrack, fix: PlaneFix, prior: Prior, nextStopId: string | null, prev: PlaneFix | null, ctx?: MatchContext): Match {
    const p = { x: fix.x, y: fix.y };
    const motion = motionOf(track, fix, prev);
    const dir = motion.dir;
    let candidateDir = dir;
    if (candidateDir === null) {
      // The second off-path fix often arrives after the tram has stopped
      // at the diverted platform. At Frankopanska the nearest rail then
      // used to win by centimetres, despite the preceding southbound run.
      for (let i = track.fixes.length - 2; i >= 0; i--) {
        const before = track.fixes[i];
        if (fix.atSec - before.atSec > DIRECTION_MEMORY_S) break;
        if (dist(before, p) >= DEAD_ZONE_M) {
          candidateDir = normalise({ x: p.x - before.x, y: p.y - before.y });
          break;
        }
      }
    }
    const dtSec = motion.dtSec;
    const previousReturn = track.priorReturn;
    // Every early exit or off-path fix breaks the run unless the eligible
    // near-prior check below explicitly carries its progress forward.
    delete track.priorReturn;

    // Route and service evidence can change without a new trip or prior.
    // Reject stale/foreign matches before even the off-graph noise hold.
    const invalidMatch = track.match.pathIdx !== null && !pathEligible(track.match.pathIdx, prior.routeId, ctx);
    if (prior.pathIdx !== null && !pathEligible(prior.pathIdx, prior.routeId, ctx)) {
      prior = { ...prior, pathIdx: null, shapeIdx: null };
    }
    if (invalidMatch) {
      delete track.endpointHold;
      delete track.unplacedDirection;
      track.match = noMatch();
      track.offPathCount = 0;
      track.againstCount = 0;
      resetOrder(track);
    }

    // A new prior (a new trip, or the twin re-deriving from the index) starts
    // the vehicle over ON THAT PATH: only the path-derived state goes. The
    // ordering register stays (E3, D14) -- the tram is the same tram, and a
    // relation the new path leaves behind is dropped by the register's own
    // divergence rule, not by a change of trip id.
    if (prior.pathIdx !== track.priorPath) {
      delete track.endpointHold;
      delete track.unplacedDirection;
      track.priorPath = prior.pathIdx;
      track.match = noMatch();
      track.offPathCount = 0;
      track.againstCount = 0;
    }

    // Off the graph entirely?
    const anyNear = net.edgesNear(p, OFF_GRAPH_M);
    if (anyNear.length === 0) {
      track.offGraphCount++;
      if (track.offGraphCount >= OFF_GRAPH_FIXES) {
        delete track.endpointHold;
        delete track.unplacedDirection;
        track.offGraph = true;
        track.match = noMatch();
        resetOrder(track);
      }
      return track.match;
    }
    track.offGraphCount = 0;
    const within = anyNear[0].d <= NEAR_M;
    if (track.offGraph && !within) return track.match; // between the bands: still off, until a fix lands on an edge
    if (track.offGraph && within) track.offGraph = false;

    // Check the eligible own path before the adopted path on every fresh
    // fix. Slow genuine returns accumulate; lateral scatter adds no metres.
    // A backward interval >=1 m or off-prior fix breaks the run. Standing
    // and sub-metre intervals preserve progress but never add to it, and a
    // single >=50 m interval still wins.
    if (prior.pathIdx !== null && track.match.pathIdx !== null && track.match.pathIdx !== prior.pathIdx) {
      const own = onPathMatch(track, prior.pathIdx, p, motion, nextStopId);
      const continued = previousReturn?.pathIdx === prior.pathIdx
        && previousReturn.fromPathIdx === track.match.pathIdx
        && previousReturn.atSec === prev?.atSec;
      // Never repeatedly subtract rounded history from an unrounded fix:
      // after restoration that would turn a stationary point into progress.
      const baseline = (continued ? previousReturn.baseline : null) ?? prev;
      const delta = baseline ? { x: p.x - baseline.x, y: p.y - baseline.y } : motion.delta;
      const longitudinalM = pathForwardM(prior.pathIdx, own.s, delta);
      const forwardM = Math.abs(longitudinalM) < PRIOR_RETURN_NOISE_M ? 0 : longitudinalM;
      // A tangent at a clipped endpoint is not evidence of entering the
      // path. At Kvaternikov trg the arrival loop passes the departure
      // path's start: accumulating approach motion there returned a tram
      // before it had finished the loop, then immediately re-derived it.
      const insidePrior = own.s > 0.5 && own.s < net.paths[prior.pathIdx].len - 0.5;
      // A wrong-direction arrival rail is different: return as soon as the
      // prior fits, including at its endpoint (Mandlova -> Ravnice). Waiting
      // until past the endpoint only prolongs a known backward match.
      const againstCurrent = pathForwardM(track.match.pathIdx, track.match.s, delta) <= -PRIOR_RETURN_NOISE_M;
      if (prev !== null && (insidePrior || againstCurrent) && own.residual <= NEAR_M && forwardM >= 0) {
        const total = (continued ? previousReturn.forwardM : 0) + forwardM;
        if (total >= FOLD_MOVE_M) {
          delete track.unplacedDirection;
          resetOrder(track);
          track.match = own;
          track.offPathCount = 0;
          track.againstCount = 0;
          return track.match;
        }
        // Advance even for ignored noise, so it cannot later add up as one
        // apparent interval. JSON preserves this raw point without rounding.
        track.priorReturn = { pathIdx: prior.pathIdx, fromPathIdx: track.match.pathIdx, atSec: fix.atSec, forwardM: total, baseline: p };
      }
    }

    // Unplaced fixes carry their nearest edge as evidence, not as a path to
    // animate along. Re-derive on every such fix, including while standing.
    const rederive = (): Match => {
      delete track.endpointHold;
      delete track.priorReturn;
      const best = candidatesFor(track, p, candidateDir, dtSec, prior, nextStopId, ctx)[0];
      if (!best || best.pathIdx !== track.match.pathIdx) resetOrder(track);
      track.offPathCount = 0;
      track.againstCount = 0;
      track.match = best
        ? { pathIdx: best.pathIdx, shapeIdx: net.paths[best.pathIdx].shape, edge: best.edge, s: best.s, residual: best.d }
        : { pathIdx: null, shapeIdx: null, edge: anyNear[0].edge, s: 0, residual: anyNear[0].d };
      if (best) delete track.unplacedDirection;
      return track.match;
    };

    // Eligibility invalidation drops the old match, not the new context's
    // eligible prior. Give that prior the same near-band placement as a new trip.
    const working = track.match.pathIdx ?? prior.pathIdx;
    if (working !== null) {
      const onPath = onPathMatch(track, working, p, motion, nextStopId);
      const unplaced = track.match.pathIdx === null && track.match.edge !== null;
      if (unplaced) {
        if (onPath.residual <= NEAR_M && pathTangentAgrees(working, onPath.s, dir ?? track.unplacedDirection ?? null)) {
          delete track.unplacedDirection;
          resetOrder(track);
          track.match = onPath;
          track.offPathCount = 0;
          track.againstCount = 0;
          return track.match;
        }
        // Never take the one-stray-fix branch with an unplaced track: doing
        // so alternates a remote projection and free-plane on every fix.
        return rederive();
      }
      if (onPath.residual <= NEAR_M) {
        delete track.endpointHold;
        track.offPathCount = 0;
        // (D4) Two consecutive fixes moving AGAINST the rail the vehicle is
        // read on, each further than scatter, with a rail within reach that
        // agrees: the tram turned at its terminus and is running back on the
        // other track while ZET still names the outbound trip. Re-derive
        // rather than read its own line backwards.
        const against = pathForwardM(working, onPath.s, motion.delta) <= -FOLD_MOVE_M;
        track.againstCount = against ? (track.againstCount ?? 0) + 1 : 0;
        if (dir !== null && track.againstCount >= FOLD_FIXES) {
          track.againstCount = 0;
          const turned = turnaroundMatch(working, p, motion, track, prior, ctx);
          if (turned) {
            delete track.unplacedDirection;
            delete track.priorReturn;
            resetOrder(track);
            track.match = turned;
            return track.match;
          }
          if (working !== prior.pathIdx) {
            // An adopted arrival rail running backwards is not a usable
            // departure path. At Mandlova the directed departure is absent
            // until Ravnice. Publish real fixes through that gap instead of
            // planning forward on the wrong-way rail and freezing the mark.
            track.unplacedDirection = dir;
            return rederive();
          }
        }
        track.match = onPath;
        return track.match;
      }
      // A cropped terminal permits a short longitudinal grace, not an
      // indefinite placement off the rails. Lateral departures use the
      // normal two-fix rule; a forward branch/loop also ends the grace.
      // Standing reports cannot restart the shared 30-second hold window.
      const atOwnEnd = working === prior.pathIdx
        && (onPath.s <= 0.5 || onPath.s >= net.paths[working].len - 0.5);
      if (track.match.pathIdx === working && atOwnEnd && onPath.residual <= OFF_GRAPH_M) {
        const geo = net.pathGeometry(working);
        const end = onPath.s <= 0.5 ? geo.pts[0] : geo.pts[geo.pts.length - 1];
        const tan = tangent(geo.pts, geo.cum, onPath.s);
        const lateralM = Math.abs((p.x - end.x) * tan.y - (p.y - end.y) * tan.x);
        const continuation = candidatesFor(track, p, candidateDir, dtSec, prior, nextStopId, ctx)
          .some(candidate => net.paths[candidate.pathIdx].direction === -1
            || (candidateDir !== null && pathTangentAgrees(candidate.pathIdx, candidate.s, candidateDir)));
        if (!track.endpointHold || track.endpointHold.pathIdx !== working) {
          track.endpointHold = { pathIdx: working, since: fix.atSec };
        }
        if (lateralM <= NEAR_M && !continuation && fix.atSec - track.endpointHold.since <= SILENCE_HOLD_S) {
          track.match = onPath;
          track.offPathCount = 0;
          track.againstCount = 0;
          return track.match;
        }
      }
      // An invalidated path gets no one-stray-fix hold. If the eligible
      // prior cannot explain this fix, immediately try other eligible rails.
      if (invalidMatch) return rederive();
      // A new trip has no established placement to protect from a stray.
      // Prefer an eligible nearby rail immediately to publishing a remote
      // prior for one tick (Mandlova departures were placed 631 m away).
      // A nearby cropped departure approached at a handover is different:
      // allow the ordinary one-fix grace while entering its near band
      // (10324 at Kvaternikov, 62 m then 43 m). Never grant this to a
      // standing, receding, or remote initial fix.
      const approachingStart = working === prior.pathIdx && prev !== null
        && onPath.s <= 0.5 && onPath.residual <= OFF_GRAPH_M
        && dir !== null && pathForwardM(working, onPath.s, motion.delta) >= PRIOR_RETURN_NOISE_M
        && net.projectOntoPath(working, prev).d > onPath.residual;
      if (track.match.pathIdx === null && (onPath.residual > OFF_GRAPH_M
        || (!approachingStart && candidatesFor(track, p, candidateDir, dtSec, prior, nextStopId, ctx).length > 0))) return rederive();
      track.offPathCount++;
      if (track.offPathCount < OFF_PATH_FIXES) {
        // One stray fix: noise. The vehicle stays on its path, at the projection.
        track.match = onPath;
        return track.match;
      }
      // A detour: the path is re-derived from the edge the vehicle is on.
      return rederive();
    }

    // No prior, or already unplaced without one: own-route rails or free plane.
    return rederive();
  }

  function matchBus(track: Track, fix: PlaneFix, prior: Prior, prev: PlaneFix | null): Match {
    const p = { x: fix.x, y: fix.y };
    const motion = motionOf(track, fix, prev);
    const dir = motion.dir;
    const route = net.routes.get(prior.routeId);
    const shapes = (route?.shapes ?? []).filter((idx) => !net.shapes[idx].edges);
    const pool = prior.shapeIdx !== null && !net.shapes[prior.shapeIdx].edges ? [prior.shapeIdx] : shapes;
    if (pool.length === 0) {
      track.match = noMatch();
      return track.match;
    }
    const scored = pool.map((shapeIdx) => {
      const shape = net.shapes[shapeIdx];
      const prevS = track.match.shapeIdx === shapeIdx ? track.match.s : null;
      const placed = place(shape.pts, shape.cum, shape.len, p, motion, prevS, null);
      let score = placed.d;
      if (dir) {
        const tan = tangent(shape.pts, shape.cum, placed.s);
        if (tan.x * dir.x + tan.y * dir.y < 0) score += DIRECTION_PENALTY_M;
      }
      return { shapeIdx, s: placed.s, d: placed.d, score };
    });
    let best = scored[0];
    for (const c of scored) if (c.score < best.score) best = c;
    const current = track.match.shapeIdx !== null ? scored.find((c) => c.shapeIdx === track.match.shapeIdx) : undefined;
    if (current && current.d <= OFF_GRAPH_M && !(best.shapeIdx !== current.shapeIdx && best.score + BUS_HYSTERESIS_M < current.score && best.d <= OFF_GRAPH_M)) {
      best = current;
    }
    if (best.d > OFF_GRAPH_M) {
      track.match = noMatch();
      return track.match;
    }
    track.match = { pathIdx: null, shapeIdx: best.shapeIdx, edge: null, s: best.s, residual: best.d };
    return track.match;
  }

  /** Records on the fix where it was matched, for the speed estimate. */
  function annotate(fix: PlaneFix, match: Match): void {
    if (match.pathIdx !== null) {
      const nearStop = net.stopsOnPath(match.pathIdx).some((entry) => Math.abs(entry.s - match.s) <= STOP_ZONE_M);
      fix.arc = { key: `p${match.pathIdx}`, s: match.s, atStop: nearStop };
    } else if (match.shapeIdx !== null) {
      const before = net.nextStop(match.shapeIdx, match.s - STOP_ZONE_M);
      const nearStop = before !== null && Math.abs(before.s - match.s) <= STOP_ZONE_M;
      fix.arc = { key: `b${match.shapeIdx}`, s: match.s, atStop: nearStop };
    } else {
      delete fix.arc;
    }
  }

  function stopsBetween(key: string, fromS: number, toS: number): string[] {
    const idx = Number(key.slice(1));
    if (!Number.isFinite(idx)) return [];
    if (key.startsWith('p')) return net.stopsOnPath(idx).filter((entry) => entry.s > fromS && entry.s < toS).map((entry) => entry.stop.id);
    const out: string[] = [];
    let cursor = fromS;
    for (;;) {
      const next = net.nextStop(idx, cursor);
      if (!next || next.s >= toS) break;
      out.push(next.stop.id);
      cursor = next.s;
    }
    return out;
  }

  return {
    priorFor,
    stopsBetween,
    matchFix(track, fix, prior, nextStopId, ctx) {
      const prev = lastFix(track);
      if (!pushFix(track, fix)) {
        if (track.kind !== 'tram' || prev === null) return track.match;
        const eligiblePrior = prior.pathIdx !== null && pathEligible(prior.pathIdx, prior.routeId, ctx) ? prior.pathIdx : null;
        const currentEligible = track.match.pathIdx === null || pathEligible(track.match.pathIdx, prior.routeId, ctx);
        if (currentEligible && eligiblePrior === track.priorPath) return track.match;
        // A repeated GPS timestamp is not motion evidence, but changed
        // route/service evidence can invalidate the match or restore a prior.
        const match = matchTram(track, prev, prior, nextStopId, null, ctx);
        annotate(prev, match);
        return match;
      }
      const match = track.kind === 'bus' ? matchBus(track, fix, prior, prev) : matchTram(track, fix, prior, nextStopId, prev, ctx);
      annotate(fix, match);
      return match;
    },
  };
}

function normalise(v: XY): XY {
  const len = Math.hypot(v.x, v.y);
  return len > 0 ? { x: v.x / len, y: v.y / len } : { x: 0, y: 0 };
}

function dot(a: XY, b: XY): number {
  return a.x * b.x + a.y * b.y;
}
