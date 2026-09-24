// Where a line's rails branch (rail round 2): for every path, the arcs at
// which the path's edge ends at a node that another rail of the same line
// leaves, other than the path's own next edge. The planner reads it for a
// DIVERTED tram (match.ts TramTrack.diverted, a tram running its line's
// rails off its own path): beyond the next branch the way it takes is a
// guess, so the plan runs to the branch and holds there until a fix says
// which way it went. Line 11 on Sunday 20 September 2026 ran a works
// diversion over its depot variants' rails and hopped between them at Trg
// dr. F. Tuđmana, Jukićeva and Frankopanska; the plan extrapolated along
// each variant past the junction while the tram turned, and the correction
// read 100 to 400 m (rows G and H).
//
// Terminus loop paths (direction -1) are neither branched nor counted as
// branches: a diverted tram is never placed on one, and a loop leaving a
// terminus platform is a turn, not a way a diverted tram runs.

import type { GraphNetwork } from './network';

export interface BranchTable {
  /** The arc of the next branch strictly ahead of `s` on the path, or null when the path branches no more. */
  aheadOf(pathIdx: number, s: number): number | null;
  /** Every branch arc of the path, ascending (for tests and the schematic). */
  arcsOf(pathIdx: number): readonly number[];
}

/** A terminus loop path (scripts/gtfs-shapes.mjs LOOP_DIRECTION). */
const LOOP_DIRECTION = -1;

export function createBranchTable(net: GraphNetwork): BranchTable {
  // Per route, the edges its non-loop paths run, by the node each starts at.
  const outByRoute = new Map<string, Map<number, Set<number>>>();
  for (const path of net.paths) {
    if (path.direction === LOOP_DIRECTION) continue;
    let byNode = outByRoute.get(path.route);
    if (!byNode) {
      byNode = new Map();
      outByRoute.set(path.route, byNode);
    }
    for (const e of path.edges) {
      const from = net.edges[e].from;
      let set = byNode.get(from);
      if (!set) {
        set = new Set();
        byNode.set(from, set);
      }
      set.add(e);
    }
  }
  const arcs: readonly number[][] = net.paths.map((path) => {
    if (path.direction === LOOP_DIRECTION) return [];
    const byNode = outByRoute.get(path.route);
    if (!byNode) return [];
    const out: number[] = [];
    // The last edge's end is the path's end: a terminus, held by the planner as such.
    for (let k = 0; k + 1 < path.edges.length; k++) {
      const node = net.edges[path.edges[k]].to;
      const leaving = byNode.get(node);
      if (!leaving) continue;
      for (const e of leaving) {
        if (e !== path.edges[k + 1]) {
          out.push(path.offsets[k + 1]);
          break;
        }
      }
    }
    return out;
  });
  return {
    aheadOf(pathIdx, s) {
      const list = arcs[pathIdx] ?? [];
      for (const arc of list) if (arc > s + 0.5) return arc;
      return null;
    },
    arcsOf(pathIdx) {
      return arcs[pathIdx] ?? [];
    },
  };
}
