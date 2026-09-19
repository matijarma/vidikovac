// Map matching for the twin: where on the rail graph (a tram) or on its
// route's polylines (a bus) a reported fix puts the vehicle. The trip's own
// path is the prior; geometry only decides where the prior is silent or has
// been proven wrong twice. Nothing here draws anything: the match is the
// planner's anchor (plan.ts) and the ordering law's frame (laws.ts).
//
// Rules (plan "Engine core", R-TE22, the reviewer's A10):
//   - candidates come from the edges within NEAR_M of the fix, on-path first;
//   - a fix off its path by more than NEAR_M once is noise and stays on the
//     path; twice in a row it is a detour, and the path is re-derived from
//     the edge the vehicle is actually on;
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
/** Ground movement in one interval that is motion, not scatter: a vehicle
 *  that moved this far against its rail's direction is on the wrong fold. */
export const FOLD_MOVE_M = 50;
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

export interface Matcher {
  priorFor(shapeId: string | null, routeId: string, direction: 0 | 1 | null, pathId?: string | null): Prior;
  /** Pushes the fix into the track and matches it; returns the new match. */
  matchFix(track: Track, fix: PlaneFix, prior: Prior, nextStopId: string | null): Match;
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

export function createMatcher(net: GraphNetwork): Matcher {
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
      if (shapeIdx !== undefined) {
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
      if (own !== undefined) return { pathIdx: own, shapeIdx: null, routeId, direction };
    }
    if (direction !== null) {
      const synthetic = net.paths.findIndex((p) => p.shape === null && p.route === routeId && p.direction === direction);
      if (synthetic >= 0) return { pathIdx: synthetic, shapeIdx: null, routeId, direction };
    }
    return { pathIdx: null, shapeIdx: null, routeId, direction };
  }

  /** The path to adopt for a vehicle found on `edge`: the route's own path
   *  running the edge the way the vehicle moves, else any path of the route
   *  on the edge, else any path at all (a diversion over another line's
   *  rails), preferring the direction of movement throughout. */
  function adoptPath(edge: number, sOnEdge: number, routeId: string, dir: XY | null, direction: 0 | 1 | null): number | null {
    const candidates = pathsByEdge.get(edge) ?? [];
    if (candidates.length === 0) return null;
    const own = candidates.filter((p) => net.paths[p].route === routeId);
    const pool = own.length > 0 ? own : candidates;
    if (direction === null) return pool[0];
    // Every path runs the edge in the edge's own direction (edges are
    // directed), so agreement is a property of the EDGE, not of the paths
    // over it: what it chooses among them is the service direction the
    // vehicle is evidently running. Moving along the edge, it is still
    // running the direction its prior named; moving against it, it is
    // running the other one -- which is what a terminus turnaround is.
    const agrees = edgeTangentAgrees(edge, sOnEdge, dir);
    const wanted = agrees ? direction : direction === 0 ? 1 : 0;
    return pool.find((p) => net.paths[p].direction === wanted) ?? pool[0];
  }

  function candidatesFor(track: Track, p: XY, dir: XY | null, dtSec: number, routeId: string, direction: 0 | 1 | null, restrictToRoute: boolean, nextStopId: string | null): Candidate[] {
    const hits = net.edgesNear(p, NEAR_M);
    const routeEdges = new Set<number>();
    if (restrictToRoute) for (const pathIdx of pathsByRoute.get(routeId) ?? []) for (const e of net.paths[pathIdx].edges) routeEdges.add(e);
    const out: Candidate[] = [];
    for (const hit of hits) {
      if (restrictToRoute && routeEdges.size > 0 && !routeEdges.has(hit.edge)) continue;
      const pathIdx = adoptPath(hit.edge, hit.s, routeId, dir, direction);
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
  function turnaroundMatch(fromPathIdx: number, p: XY, dir: XY, routeId: string): Match | null {
    const current = net.paths[fromPathIdx];
    let best: { pathIdx: number; edge: number; s: number; d: number } | null = null;
    for (const hit of net.edgesNear(p, NEAR_M)) {
      if (!edgeTangentAgrees(hit.edge, hit.s, dir)) continue;
      for (const pathIdx of pathsByEdge.get(hit.edge) ?? []) {
        const path = net.paths[pathIdx];
        if (path.route !== routeId || pathIdx === fromPathIdx) continue;
        if (path.direction === current.direction) continue;
        const s = arcOnPath(path, hit.edge, hit.s, null);
        if (s === null) continue;
        if (best === null || hit.d < best.d) best = { pathIdx, edge: hit.edge, s, d: hit.d };
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
    const groundM = prev ? dist(prev, p) : 0;
    const dir: XY | null = prev && groundM >= DEAD_ZONE_M ? normalise({ x: p.x - prev.x, y: p.y - prev.y }) : null;
    return { dir, groundM, dtSec: prev ? fix.atSec - prev.atSec : 0, speed: track.speed };
  }

  function matchTram(track: Track, fix: PlaneFix, prior: Prior, nextStopId: string | null, prev: PlaneFix | null): Match {
    const p = { x: fix.x, y: fix.y };
    const motion = motionOf(track, fix, prev);
    const dir = motion.dir;
    const dtSec = motion.dtSec;

    // A new prior (a new trip, or the twin re-deriving from the index) starts
    // the vehicle over ON THAT PATH: only the path-derived state goes. The
    // ordering register stays (E3, D14) -- the tram is the same tram, and a
    // relation the new path leaves behind is dropped by the register's own
    // divergence rule, not by a change of trip id.
    if (prior.pathIdx !== track.priorPath) {
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

    const working = track.match.pathIdx ?? prior.pathIdx;
    if (working !== null) {
      const onPath = onPathMatch(track, working, p, motion, nextStopId);
      if (onPath.residual <= NEAR_M) {
        track.offPathCount = 0;
        // (D4) Two consecutive fixes moving AGAINST the rail the vehicle is
        // read on, each further than scatter, with a rail within reach that
        // agrees: the tram turned at its terminus and is running back on the
        // other track while ZET still names the outbound trip. Re-derive
        // rather than read its own line backwards.
        const against = dir !== null && motion.groundM >= FOLD_MOVE_M && !pathTangentAgrees(working, onPath.s, dir);
        track.againstCount = against ? (track.againstCount ?? 0) + 1 : 0;
        if (dir !== null && track.againstCount >= FOLD_FIXES) {
          track.againstCount = 0;
          const turned = turnaroundMatch(working, p, dir, prior.routeId);
          if (turned) {
            resetOrder(track);
            track.match = turned;
            return track.match;
          }
        }
        track.match = onPath;
        return track.match;
      }
      track.offPathCount++;
      if (track.offPathCount < OFF_PATH_FIXES) {
        // One stray fix: noise. The vehicle stays on its path, at the projection.
        track.match = onPath;
        return track.match;
      }
      // A detour: the path is re-derived from the edge the vehicle is on.
      const best = candidatesFor(track, p, dir, dtSec, prior.routeId, prior.direction, false, nextStopId)[0];
      track.offPathCount = 0;
      if (!best) {
        track.match = { ...onPath }; // nothing within reach: keep the projection, the residual says how far off
        return track.match;
      }
      if (best.pathIdx !== track.match.pathIdx) resetOrder(track);
      track.match = { pathIdx: best.pathIdx, shapeIdx: net.paths[best.pathIdx].shape, edge: best.edge, s: best.s, residual: best.d };
      return track.match;
    }

    // No path known (R-TE22): the route's own edges decide, then any edge.
    let best = candidatesFor(track, p, dir, dtSec, prior.routeId, prior.direction, true, nextStopId)[0];
    if (!best) best = candidatesFor(track, p, dir, dtSec, prior.routeId, prior.direction, false, nextStopId)[0];
    if (!best) {
      // Between NEAR_M and OFF_GRAPH_M of every edge with no path to stand on: the free plane, not yet off-graph.
      track.match = { pathIdx: null, shapeIdx: null, edge: anyNear[0].edge, s: 0, residual: anyNear[0].d };
      return track.match;
    }
    track.match = { pathIdx: best.pathIdx, shapeIdx: net.paths[best.pathIdx].shape, edge: best.edge, s: best.s, residual: best.d };
    return track.match;
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
    matchFix(track, fix, prior, nextStopId) {
      const prev = lastFix(track);
      if (!pushFix(track, fix)) return track.match;
      const match = track.kind === 'bus' ? matchBus(track, fix, prior, prev) : matchTram(track, fix, prior, nextStopId, prev);
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
