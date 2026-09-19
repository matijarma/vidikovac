// What the twin learns from the fixes it matches, and how it keeps it. Two
// kinds of evidence come out of a vehicle's own history on a rail path:
//   - a CRUISE sample: two consecutive fixes on the same path, both clear of
//     any platform's zone, with no stop strictly between them, so the whole
//     interval was moving time; their speed says what every rail edge the
//     pair covers takes to run, scaled to the edge's length;
//   - a DWELL sample: a run of fixes inside a stop's zone, bounded by a
//     clean fix before and after it; the interval less the travel between
//     the two clean fixes is the standing time, acceleration and braking
//     included, which is exactly what the planner books at a platform on
//     top of cruise time. The travel comes from the learned edges where they
//     are thick (the fleet's pooled cruise), else from the vehicle's own
//     cruise pooled over its whole history, never from one short pair.
// Aggregates are one small log-spaced histogram per (edge, hour band, day
// type) and per (stop, hour band, day type): a median and a count fall out
// of it, it merges by adding bins, and it is plain arrays, so it rides in a
// SQLite text column and in the twin's state row unchanged. DOM-free, no
// import from worker/ or app/ (R-TE15).

import type { Bands } from './bands';
import { zagrebBands } from './bands';
import { junctionsOnPath, JUNCTION_ZONE_M, MAX_JUNCTION_WAIT_S, nodeKey } from './junction';
import type { GraphNetwork } from './network';
import { DEAD_ZONE_M, MAX_SPEED_MS, STOP_ZONE_M } from './speed';
import { lastFix, type PlaneFix, type Track } from './track';

/** 32 log-spaced bins from 1 s to 1800 s: each bin is 26 % wider than the
 *  one before, so a median read from a bin midpoint is within 13 % of the
 *  truth at any scale from a short edge to a long terminus stand, in 32
 *  integers per cell. */
export const HIST_BINS = 32;
export const HIST_MIN_S = 1;
export const HIST_MAX_S = 1800;
const BIN_RATIO = Math.pow(HIST_MAX_S / HIST_MIN_S, 1 / HIST_BINS);
const LOG_RATIO = Math.log(BIN_RATIO);

/** A dwell longer than this is a terminus or a breakdown, not a platform
 *  stand: the planner should never learn it as one. */
export const MAX_DWELL_S = 600;

/** The slowest cruise that still counts as cruising, m/s: below it a
 *  "moving" pair is a tram creeping onto a platform, and the travel it
 *  implies for a dwell sample would be nonsense. */
export const MIN_CRUISE_MS = 0.5;

/** The least moving distance a vehicle's own history must hold before its
 *  pooled cruise may price the travel inside a dwell sample: an 8 m GPS
 *  scatter on each end of a pair is 11 m on the pair, which over 100 m is
 *  an 11 % speed error, 4 s on a 40 s travel; over one 4 s pair it is a
 *  quarter of the speed and half of the dwell. */
export const MIN_CRUISE_BASELINE_M = 100;

/** One histogram: the count per bin. */
export type Histogram = number[];

export function emptyHistogram(): Histogram {
  return new Array<number>(HIST_BINS).fill(0);
}

export function binOf(seconds: number): number {
  if (!(seconds > HIST_MIN_S)) return 0;
  return Math.min(HIST_BINS - 1, Math.floor(Math.log(seconds / HIST_MIN_S) / LOG_RATIO));
}

/** The geometric midpoint of a bin: what a sample in it is read as. */
export function binMidpoint(bin: number): number {
  return HIST_MIN_S * Math.pow(BIN_RATIO, bin + 0.5);
}

export function addSample(h: Histogram, seconds: number): void {
  h[binOf(seconds)]++;
}

export function histogramCount(h: Histogram): number {
  let n = 0;
  for (const c of h) n += c;
  return n;
}

/** The quantile as a bin midpoint, or null for an empty histogram. */
export function histogramQuantile(h: Histogram, q: number): number | null {
  const n = histogramCount(h);
  if (n === 0) return null;
  const target = Math.max(1, Math.ceil(n * q));
  let seen = 0;
  for (let i = 0; i < h.length; i++) {
    seen += h[i];
    if (seen >= target) return binMidpoint(i);
  }
  return binMidpoint(h.length - 1);
}

export function histogramMedian(h: Histogram): number | null {
  return histogramQuantile(h, 0.5);
}

/** A new histogram with both counts. */
export function mergeHistograms(a: Histogram, b: Histogram): Histogram {
  const out = emptyHistogram();
  for (let i = 0; i < HIST_BINS; i++) out[i] = (a[i] ?? 0) + (b[i] ?? 0);
  return out;
}

export function serializeHistogram(h: Histogram): string {
  return JSON.stringify(h);
}

/** Parses a stored histogram; anything malformed reads as empty rather than
 *  poisoning a median with a shape the code never wrote. */
export function parseHistogram(text: string): Histogram {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!Array.isArray(parsed) || parsed.length !== HIST_BINS || parsed.some((v) => typeof v !== 'number' || !Number.isFinite(v) || v < 0)) return emptyHistogram();
    return parsed.map((v) => Math.floor(v));
  } catch {
    return emptyHistogram();
  }
}

// ---- aggregates ----------------------------------------------------------------

/** Keys are `<edge>|<band>|<day>` and `<stopId>|<band>|<day>`; a stop id
 *  never contains `|`. Plain records, so the twin's state row and the
 *  SQLite flush both take them as they are. */
export interface LearnedAggregates {
  edges: Record<string, Histogram>;
  stops: Record<string, Histogram>;
  /** F11: standing time before a junction node, per (node, band, day) -- the
   *  waits, not the passes, so a share can be taken against `nodePasses`. */
  nodes: Record<string, Histogram>;
  /** F11: traversals of that same cell, so p(stop) = count(nodes) / passes.
   *  A plain count, not a histogram: nothing is distributed about a pass. */
  nodePasses: Record<string, number>;
}

export function emptyAggregates(): LearnedAggregates {
  return { edges: {}, stops: {}, nodes: {}, nodePasses: {} };
}

export function edgeKey(edge: number, hourBand: number, dayType: number): string {
  return `${edge}|${hourBand}|${dayType}`;
}

export function stopKey(stopId: string, hourBand: number, dayType: number): string {
  return `${stopId}|${hourBand}|${dayType}`;
}

export function parseKey(key: string): { id: string; hourBand: number; dayType: number } | null {
  const at = key.lastIndexOf('|');
  const mid = key.lastIndexOf('|', at - 1);
  if (at < 0 || mid < 0) return null;
  const hourBand = Number(key.slice(mid + 1, at));
  const dayType = Number(key.slice(at + 1));
  if (!Number.isInteger(hourBand) || !Number.isInteger(dayType)) return null;
  return { id: key.slice(0, mid), hourBand, dayType };
}

function addTo(table: Record<string, Histogram>, key: string, seconds: number): void {
  const h = table[key] ?? (table[key] = emptyHistogram());
  addSample(h, seconds);
}

/** Adds every histogram of `from` into `into`, in place. */
export function mergeAggregates(into: LearnedAggregates, from: Partial<LearnedAggregates>): void {
  for (const [key, h] of Object.entries(from.edges ?? {})) into.edges[key] = into.edges[key] ? mergeHistograms(into.edges[key], h) : [...h];
  for (const [key, h] of Object.entries(from.stops ?? {})) into.stops[key] = into.stops[key] ? mergeHistograms(into.stops[key], h) : [...h];
  for (const [key, h] of Object.entries(from.nodes ?? {})) into.nodes[key] = into.nodes[key] ? mergeHistograms(into.nodes[key], h) : [...h];
  for (const [key, n] of Object.entries(from.nodePasses ?? {})) into.nodePasses[key] = (into.nodePasses[key] ?? 0) + n;
}

export function isEmptyAggregates(agg: LearnedAggregates): boolean {
  return (
    Object.keys(agg.edges).length === 0 &&
    Object.keys(agg.stops).length === 0 &&
    Object.keys(agg.nodes ?? {}).length === 0 &&
    Object.keys(agg.nodePasses ?? {}).length === 0
  );
}

/** Rows and bytes the aggregates would take in SQLite, for reports. */
export function aggregateSize(agg: LearnedAggregates): { rows: number; bytes: number } {
  let bytes = 0;
  let rows = 0;
  for (const table of [agg.edges, agg.stops, agg.nodes ?? {}]) {
    for (const [key, h] of Object.entries(table)) {
      rows++;
      bytes += key.length + serializeHistogram(h).length + 16;
    }
  }
  return { rows, bytes };
}

// ---- evidence -------------------------------------------------------------------

export interface EdgeEvidence {
  edge: number;
  /** Seconds to run the whole edge at the observed cruise. */
  seconds: number;
  /** Report time of the later fix of the pair, for banding. */
  atSec: number;
}

export interface DwellEvidence {
  stopId: string;
  seconds: number;
  /** Report time of the fix that confirmed the departure, for banding. */
  atSec: number;
}

/** One stand short of a junction node, mined off every platform (F11). */
export interface NodeWaitEvidence {
  node: number;
  seconds: number;
  /** Report time of the fix that confirmed the node was crossed, for banding. */
  atSec: number;
}

/** One traversal of a junction node, wait or no wait: the denominator of p(stop). */
export interface NodePassEvidence {
  node: number;
  atSec: number;
}

export interface Evidence {
  edges: EdgeEvidence[];
  dwells: DwellEvidence[];
  waits: NodeWaitEvidence[];
  passes: NodePassEvidence[];
  /** Report time of the newest fix mined; the next extraction starts after it. */
  upTo: number;
}

export function emptyEvidence(upTo = 0): Evidence {
  return { edges: [], dwells: [], waits: [], passes: [], upTo };
}

interface ArcFix {
  fix: PlaneFix;
  s: number;
  atStop: boolean;
}

/**
 * Mines a track's history for evidence newer than `sinceSec` (the report
 * time of the newest fix mined last time, so nothing is counted twice).
 * Only fixes on the vehicle's current rail path count; a bus shape has no
 * timetable mapping and is left alone (the B3 report's concern 5).
 */
export type TravelOf = (pathIdx: number, fromS: number, toS: number, atSec: number) => number | null;

export function extractEvidence(net: GraphNetwork, track: Track, sinceSec: number, dwellOf: (stopId: string) => number, travelOf?: TravelOf): Evidence {
  const last = lastFix(track);
  if (!last || !last.arc || !last.arc.key.startsWith('p')) return emptyEvidence(last?.atSec ?? 0);
  const key = last.arc.key;
  const pathIdx = Number(key.slice(1));
  const path = net.paths[pathIdx];
  if (!path) return emptyEvidence(last.atSec);

  // The run of fixes on this path, oldest first.
  const onPath: ArcFix[] = [];
  for (const fix of track.fixes) {
    if (fix.arc?.key === key) onPath.push({ fix, s: fix.arc.s, atStop: fix.arc.atStop });
  }
  const evidence = emptyEvidence(last.atSec);
  if (onPath.length < 2) return evidence;

  const stops = net.stopsOnPath(pathIdx);
  const stopsBetween = (fromS: number, toS: number): { stopId: string; s: number }[] =>
    stops.filter((entry) => entry.s > fromS && entry.s < toS).map((entry) => ({ stopId: entry.stop.id, s: entry.s }));
  const edgeSpan = (k: number): { start: number; end: number } => ({ start: path.offsets[k], end: k + 1 < path.edges.length ? path.offsets[k + 1] : path.len });

  // Cruise samples: consecutive clean pairs with no platform between. Every
  // such pair in the history, mined before or not, also feeds the vehicle's
  // pooled cruise for the dwell samples below.
  let pooledDs = 0;
  let pooledDt = 0;
  for (let i = 1; i < onPath.length; i++) {
    const a = onPath[i - 1];
    const b = onPath[i];
    if (a.atStop || b.atStop) continue;
    const ds = b.s - a.s;
    const dt = b.fix.atSec - a.fix.atSec;
    if (ds < DEAD_ZONE_M || dt <= 0) continue;
    if (stopsBetween(a.s, b.s).length > 0) continue;
    const speed = ds / dt;
    if (speed < MIN_CRUISE_MS || speed > MAX_SPEED_MS) continue;
    pooledDs += ds;
    pooledDt += dt;
    if (b.fix.atSec <= sinceSec) continue;
    for (let k = 0; k < path.edges.length; k++) {
      const { start, end } = edgeSpan(k);
      if (end <= a.s || start >= b.s) continue;
      evidence.edges.push({ edge: path.edges[k], seconds: (end - start) / speed, atSec: b.fix.atSec });
    }
  }

  // Dwell samples: a run inside a stop's zone, bounded by clean fixes, with
  // at least one STATIONARY pair inside the zone (F11). Without that check a
  // tram that merely passed the platform between two clean fixes wrote a
  // dwell sample of whatever the interval happened to exceed the travel by,
  // and the table learned a standing time from trams that never stood --
  // the learner poisoning of D1.
  const pooledCruise = pooledDs >= MIN_CRUISE_BASELINE_M && pooledDt > 0 ? pooledDs / pooledDt : null;
  const travelBetween = (fromS: number, toS: number, atSec: number): number | null => {
    const learnedTravel = travelOf?.(pathIdx, fromS, toS, atSec) ?? null;
    return learnedTravel ?? (pooledCruise !== null && pooledCruise >= MIN_CRUISE_MS ? (toS - fromS) / pooledCruise : null);
  };
  {
    for (const entry of stops) {
      const S = entry.s;
      let first = -1;
      let lastIdx = -1;
      for (let i = 0; i < onPath.length; i++) {
        if (Math.abs(onPath[i].s - S) <= STOP_ZONE_M) {
          if (first < 0) first = i;
          lastIdx = i;
        }
      }
      if (first < 0) continue;
      const before = first > 0 ? onPath[first - 1] : null;
      const after = lastIdx + 1 < onPath.length ? onPath[lastIdx + 1] : null;
      if (!before || !after) continue;
      if (before.atStop || after.atStop || before.s >= S - STOP_ZONE_M || after.s <= S + STOP_ZONE_M) continue;
      if (after.fix.atSec <= sinceSec) continue;
      if (!stationaryRun(onPath, first, lastIdx)) continue;
      const interval = after.fix.atSec - before.fix.atSec;
      const travel = travelBetween(before.s, after.s, after.fix.atSec);
      if (travel === null) continue;
      let others = 0;
      for (const other of stopsBetween(before.s, after.s)) if (other.stopId !== entry.stop.id) others += dwellOf(other.stopId);
      const dwell = Math.max(0, Math.min(MAX_DWELL_S, interval - travel - others));
      evidence.dwells.push({ stopId: entry.stop.id, seconds: dwell, atSec: after.fix.atSec });
    }
  }

  // Junction waits (F11): the same shape of evidence one zone earlier, at
  // the rail nodes where three ways meet. Every crossing of the node is a
  // PASS, so p(stop) is a share and not a count; a stationary pair inside
  // the zone, off every platform the line serves, is a WAIT.
  for (const junction of junctionsOnPath(net, pathIdx)) {
    const S = junction.s;
    const zoneFrom = S - JUNCTION_ZONE_M;
    const j = onPath.findIndex((entry) => entry.s > S);
    if (j <= 0) continue;
    const after = onPath[j];
    if (after.atStop || after.fix.atSec <= sinceSec) continue;
    // Back over every fix still inside the zone to the clean fix before it.
    let k = j - 1;
    while (k > 0 && onPath[k].s >= zoneFrom) k--;
    const before = onPath[k];
    if (before.s >= zoneFrom || before.atStop) continue;
    evidence.passes.push({ node: junction.node, atSec: after.fix.atSec });
    // A stationary pair inside the zone and off every served platform: the
    // stand that is the junction's and not a dwell the table already books.
    let stood = false;
    for (let i = k + 1; i < j - 1; i++) {
      if (onPath[i].atStop || onPath[i + 1].atStop) continue;
      if (Math.abs(onPath[i + 1].s - onPath[i].s) < DEAD_ZONE_M) {
        stood = true;
        break;
      }
    }
    if (!stood) continue;
    const travel = travelBetween(before.s, after.s, after.fix.atSec);
    if (travel === null) continue;
    let others = 0;
    for (const other of stopsBetween(before.s, after.s)) others += dwellOf(other.stopId);
    const wait = Math.max(0, Math.min(MAX_JUNCTION_WAIT_S, after.fix.atSec - before.fix.atSec - travel - others));
    if (wait <= 0) continue;
    evidence.waits.push({ node: junction.node, seconds: wait, atSec: after.fix.atSec });
  }

  return evidence;
}

/** At least two fixes of the run within the dead zone of each other ALONG
 *  THE ARC: the proof that the vehicle actually stood, rather than crossing
 *  the zone between two reports. One fix alone proves nothing either way. */
function stationaryRun(onPath: readonly ArcFix[], first: number, last: number): boolean {
  for (let i = first; i < last; i++) if (Math.abs(onPath[i + 1].s - onPath[i].s) < DEAD_ZONE_M) return true;
  return false;
}

/** Counts the evidence into the aggregates, banded by when it was seen. */
export function recordEvidence(
  agg: LearnedAggregates,
  evidence: Pick<Evidence, 'edges' | 'dwells'> & Partial<Pick<Evidence, 'waits' | 'passes'>>,
  bandsOf: (atSec: number) => Bands = zagrebBands,
): void {
  for (const e of evidence.edges) {
    const { hourBand, dayType } = bandsOf(e.atSec);
    addTo(agg.edges, edgeKey(e.edge, hourBand, dayType), e.seconds);
  }
  for (const d of evidence.dwells) {
    const { hourBand, dayType } = bandsOf(d.atSec);
    addTo(agg.stops, stopKey(d.stopId, hourBand, dayType), d.seconds);
  }
  for (const w of evidence.waits ?? []) {
    const { hourBand, dayType } = bandsOf(w.atSec);
    addTo(agg.nodes, nodeKey(w.node, hourBand, dayType), w.seconds);
  }
  for (const p of evidence.passes ?? []) {
    const { hourBand, dayType } = bandsOf(p.atSec);
    const key = nodeKey(p.node, hourBand, dayType);
    agg.nodePasses[key] = (agg.nodePasses[key] ?? 0) + 1;
  }
}
