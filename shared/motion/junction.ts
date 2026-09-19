// Junction waits (F11). A tram held at a signal short of a crossing is
// standing off every platform, so the dwell table never hears about it: the
// stand shows up nowhere, and the planner drove the tram straight through
// the crossing at cruise. Round E's diagnosis put a good share of the
// between-plan regressions there -- the plan runs ahead, the next fix says
// the tram never moved, and the re-plan falls back onto the tram.
//
// So the learner mines those stands per rail NODE of degree above two (a
// node where three or more edge ends meet: a junction, a triangle, a
// crossing the F8c builder split), and counts every PASS of the node beside
// them. Two numbers come out per (node, hour band, day type): how often a
// tram stops there at all -- p(stop) -- and how long it stands when it does.
// The planner books the median wait only where p(stop) is high enough to be
// a rule of that crossing rather than one bad morning, because a wait booked
// at a crossing trams sail through is exactly the "plan behind the tram"
// that the client then holds through.
//
// DOM-free, no import from worker/ or app/ (R-TE15).

import { histogramCount, histogramQuantile, type LearnedAggregates } from './learn';
import type { GraphNetwork } from './network';
import { STOP_ZONE_M } from './speed';
import type { DayType } from './bands';
import { borrowOrder } from './times';

/** How far before the node a stand counts as waiting FOR the node: 60 m is
 *  about where a ZET signal stands ahead of a crossing, and two GPS
 *  scatters' worth of room for the fix that reports the standing tram. */
export const JUNCTION_ZONE_M = 60;

/** How often trams must actually stop at a crossing before the planner books
 *  a wait there: below this the wait is the exception, and booking it would
 *  hold six plans in ten behind trams that sailed through. */
export const JUNCTION_STOP_SHARE = 0.4;

/** The side of the wait distribution the planner books. The MEDIAN, not the
 *  dwell table's 0.7: a junction wait is already conditional on stopping at
 *  all, so the share and the quantile would otherwise tilt the same plan
 *  late twice over. */
export const JUNCTION_WAIT_QUANTILE = 0.5;

/** Passes a cell needs before its share means anything -- the learner's own
 *  bar for a histogram (times.ts LEARN_MIN_SAMPLES), for the same reason:
 *  ten traversals separate a crossing that holds trams from one that does
 *  not, and fewer would let one stuck tram write the rule of an hour. */
export const JUNCTION_MIN_PASSES = 10;

/** A wait longer than this is a blockage or a fault, not a signal cycle; the
 *  learner refuses to remember it as one. */
export const MAX_JUNCTION_WAIT_S = 300;

/** Keys are `<node>|<band>|<day>`, the same shape as the edge and stop keys
 *  (learn.ts parseKey reads all three). */
export function nodeKey(node: number, hourBand: number, dayType: number): string {
  return `${node}|${hourBand}|${dayType}`;
}

/** How many edge ends meet at each node: 2 for an ordinary two-way stretch
 *  (one edge in, one out), more where the rails branch. */
export function nodeDegrees(net: GraphNetwork): Map<number, number> {
  const degrees = new Map<number, number>();
  for (const edge of net.edges) {
    degrees.set(edge.from, (degrees.get(edge.from) ?? 0) + 1);
    degrees.set(edge.to, (degrees.get(edge.to) ?? 0) + 1);
  }
  return degrees;
}

/** Per network, per path: the junctions once. Both the learner (every tick,
 *  per fresh vehicle) and the planner ask, and the answer is static for the
 *  life of an artefact. A WeakMap so a rebuilt network is not kept alive. */
const cache = new WeakMap<GraphNetwork, { degrees: Map<number, number>; byPath: Map<number, { node: number; s: number }[]> }>();

/**
 * The junction nodes the path crosses, in arc order: the node at the END of
 * each of its edges, where three or more edge ends meet and no platform the
 * path serves stands within a stop zone of it (a stand there is a dwell, and
 * the dwell table already books it). A node the path crosses twice is listed
 * once, at its first arc, so a balloon terminus cannot double-count a pass.
 */
export function junctionsOnPath(net: GraphNetwork, pathIdx: number): { node: number; s: number }[] {
  let entry = cache.get(net);
  if (!entry) {
    entry = { degrees: nodeDegrees(net), byPath: new Map() };
    cache.set(net, entry);
  }
  const found = entry.byPath.get(pathIdx);
  if (found) return found;
  const path = net.paths[pathIdx];
  const out: { node: number; s: number }[] = [];
  if (path) {
    const stops = net.stopsOnPath(pathIdx);
    const seen = new Set<number>();
    for (let k = 0; k < path.edges.length; k++) {
      const edge = net.edges[path.edges[k]];
      if (!edge) continue;
      const s = k + 1 < path.edges.length ? path.offsets[k + 1] : path.len;
      if ((entry.degrees.get(edge.to) ?? 0) <= 2 || seen.has(edge.to)) continue;
      if (stops.some((stop) => Math.abs(stop.s - s) <= STOP_ZONE_M)) continue;
      seen.add(edge.to);
      out.push({ node: edge.to, s });
    }
    out.sort((a, b) => a.s - b.s);
  }
  entry.byPath.set(pathIdx, out);
  return out;
}

export interface JunctionRow {
  node: number;
  /** Traversals counted in the cell the lookup read. */
  passes: number;
  /** Of those, the ones that held the tram. */
  waits: number;
  /** waits / passes: p(stop) at this crossing. */
  share: number;
  /** The median wait of those that stood, or null when none did. */
  p50: number | null;
  /** True when the planner books this one at the given band. */
  booked: boolean;
}

export interface JunctionTable {
  /** The waits to book on this path after arc `s`, nearest first. */
  waitsAhead(pathIdx: number, s: number, hourBand: number, dayType: DayType): { node: number; s: number; waitSec: number }[];
  /** One row per crossing anything is known about, for /stats. */
  rows(hourBand: number, dayType: DayType): JunctionRow[];
}

export interface JunctionTableInput {
  net: GraphNetwork;
  /** Read live: what the twin learns this minute shapes the next plan. */
  aggregates: LearnedAggregates;
  minShare?: number;
  minPasses?: number;
  quantile?: number;
}

export function createJunctionTable(input: JunctionTableInput): JunctionTable {
  const { net, aggregates } = input;
  const minShare = input.minShare ?? JUNCTION_STOP_SHARE;
  const minPasses = input.minPasses ?? JUNCTION_MIN_PASSES;
  const quantile = input.quantile ?? JUNCTION_WAIT_QUANTILE;

  /** The first cell of the borrow order with enough passes to speak. The
   *  share and the wait must come from the SAME cell, or a crossing could
   *  book a rush-hour wait on a midnight share. */
  const read = (node: number, hourBand: number, dayType: DayType): { passes: number; waits: number; share: number; p50: number | null } | null => {
    for (const [band, day] of borrowOrder(hourBand, dayType)) {
      const key = nodeKey(node, band, day);
      const passes = aggregates.nodePasses[key] ?? 0;
      if (passes < minPasses) continue;
      const h = aggregates.nodes[key];
      const waits = h ? histogramCount(h) : 0;
      return { passes, waits, share: waits / passes, p50: h && waits > 0 ? histogramQuantile(h, quantile) : null };
    }
    return null;
  };

  return {
    waitsAhead(pathIdx, s, hourBand, dayType) {
      const out: { node: number; s: number; waitSec: number }[] = [];
      for (const junction of junctionsOnPath(net, pathIdx)) {
        if (junction.s <= s + 0.5) continue;
        const cell = read(junction.node, hourBand, dayType);
        if (!cell || cell.share < minShare || cell.p50 === null || cell.p50 <= 0) continue;
        out.push({ node: junction.node, s: junction.s, waitSec: Math.min(MAX_JUNCTION_WAIT_S, cell.p50) });
      }
      return out;
    },
    rows(hourBand, dayType) {
      const nodes = new Set<number>();
      for (const key of Object.keys(aggregates.nodePasses)) {
        const node = Number(key.slice(0, key.indexOf('|')));
        if (Number.isInteger(node)) nodes.add(node);
      }
      const rows: JunctionRow[] = [];
      for (const node of nodes) {
        const cell = read(node, hourBand, dayType);
        if (!cell) continue;
        rows.push({ node, ...cell, booked: cell.share >= minShare && cell.p50 !== null && cell.p50 > 0 });
      }
      rows.sort((a, b) => b.share - a.share || b.passes - a.passes || a.node - b.node);
      return rows;
    },
  };
}
