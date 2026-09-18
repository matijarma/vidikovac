// What a segment of track "should" take and how long a stop "should" hold a
// vehicle: the timetable's answer today, the learned medians' answer once C1
// wraps this (a wrapper answers from its aggregates and falls through to
// the schedule where they are thin). The planner asks in path arcs; the
// timetable speaks in stop pairs, so the mapping from stops to arcs is done
// once per path here.

import { type DayType, zagrebBands } from './bands';
import { edgeKey, histogramCount, histogramMedian, stopKey, type Histogram, type LearnedAggregates } from './learn';
import type { GraphNetwork } from './network';
import { DWELL_DEFAULT_S } from './plan';
import type { TripIndex } from './trips';

export { zagrebBands, type DayType };

export interface TimesProvider {
  /** Expected seconds to travel from arc `fromS` to arc `toS` on the path,
   *  or null where nothing is known about that stretch. */
  segmentSeconds(pathIdx: number, fromS: number, toS: number, hourBand: number, dayType: DayType): number | null;
  /** Expected standing time at the stop, or null when unknown. */
  dwellSeconds(stopId: string, hourBand: number, dayType: DayType): number | null;
}

interface Segment {
  fromS: number;
  toS: number;
  /** Seconds by hour band 0..23. */
  seconds: number[];
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[sorted.length >> 1];
}

/** The length of `needle` when it appears contiguously inside `hay`, else 0. */
function contiguousRun(needle: readonly string[], hay: readonly string[]): number {
  if (needle.length === 0 || needle.length > hay.length) return 0;
  outer: for (let start = 0; start + needle.length <= hay.length; start++) {
    for (let k = 0; k < needle.length; k++) if (hay[start + k] !== needle[k]) continue outer;
    return needle.length;
  }
  return 0;
}

/** Why a pattern reached the path it did, counted so a test can see it. */
export interface PatternPathReport {
  /** Mapped by shape id: the path IS that shape. */
  byShape: number;
  /** Shapeless, and a synthetic path's stop sequence equals the pattern's. */
  exact: number;
  /** Shapeless, and a synthetic path's sequence is a contiguous run of the
   *  pattern's: the builder trimmed an off-graph terminus stretch off it. */
  trimmed: number;
  /** Shapeless, and neither matched: the route and direction's first
   *  synthetic path, which is what every shapeless pattern used to get and
   *  is a guess, so it is counted as one. */
  firstOfRouteAndDirection: number;
  /** A tram pattern with no path at all: its trips run on geometric matching
   *  alone (the builder could route no path through its stops). */
  unmapped: number;
  /** A pattern of a bus route, which runs a polyline and never a path. */
  nonTram: number;
}

export interface PatternPaths {
  /** Path index per pattern index, or null. */
  pathOf: readonly (number | null)[];
  /** Path id per pattern index, or null: what a twin's join carries. */
  pathIdOf: readonly (string | null)[];
  report: PatternPathReport;
}

/** Everything the resolution below needs of a pattern. A TripPattern is one;
 *  so is a row of the twin's own SQLite copy of the index (persist.ts), which
 *  is how an evicted twin resolves the same path before the index is back in
 *  memory. `shape` is '' or null where the pattern's trips carry none. */
export interface PatternShape {
  route: string;
  /** GTFS direction_id; anything but 1 reads as 0, as every decoder here does. */
  direction: number;
  shape: string | null;
  stops: readonly string[];
}

/** Resolves one pattern at a time against a network, with the path indexes
 *  built once. mapPatternsToPaths is this over a whole trip index. */
export interface PatternPathResolver {
  resolve(pattern: PatternShape): { pathIdx: number | null; rung: keyof PatternPathReport };
}

/**
 * Which path each pattern of the trip index runs (D11, F8). A pattern with a
 * shape_id runs the path of that id. A shapeless pattern runs the synthetic
 * path the builder made FROM it: those are keyed by the pattern's own stop
 * sequence, so equality settles nearly all of them. The rung below exists for
 * the few the builder trimmed -- it drops up to TERMINUS_TRIM_STOPS stops at
 * EITHER end where no shape draws the rails (line 1 out of Zapadni kolodvor),
 * so what survives is a contiguous run of the pattern's sequence and only
 * sometimes a prefix: on feed 000395 line 1's busiest direction-0 pattern,
 * 152 trips, is trimmed at the head, and a prefix-only rung would hand it a
 * sibling path. Last comes the old behaviour, the route and direction's first
 * synthetic path.
 */
export function patternPathResolver(net: GraphNetwork): PatternPathResolver {
  const pathByShapeId = new Map<string, number>(net.paths.map((p, idx) => [p.id, idx] as const));
  const syntheticByRouteDir = new Map<string, number[]>();
  const syntheticByStops = new Map<string, number>();
  net.paths.forEach((path, idx) => {
    if (path.shape !== null) return;
    const key = `${path.route}|${path.direction}`;
    const list = syntheticByRouteDir.get(key);
    if (list) list.push(idx);
    else syntheticByRouteDir.set(key, [idx]);
    const stopsKey = `${key}|${(path.stops ?? []).join(',')}`;
    if (!syntheticByStops.has(stopsKey)) syntheticByStops.set(stopsKey, idx);
  });

  return {
    resolve(pattern: PatternShape): { pathIdx: number | null; rung: keyof PatternPathReport } {
      if (net.routes.get(pattern.route)?.type !== 0) return { pathIdx: null, rung: 'nonTram' };
      if (pattern.shape !== null && pattern.shape !== '') {
        const idx = pathByShapeId.get(pattern.shape);
        return idx === undefined ? { pathIdx: null, rung: 'unmapped' } : { pathIdx: idx, rung: 'byShape' };
      }
      const key = `${pattern.route}|${pattern.direction === 1 ? 1 : 0}`;
      const exact = syntheticByStops.get(`${key}|${pattern.stops.join(',')}`);
      if (exact !== undefined) return { pathIdx: exact, rung: 'exact' };
      const candidates = syntheticByRouteDir.get(key) ?? [];
      let best: number | null = null;
      let bestRun = 0;
      for (const idx of candidates) {
        const run = contiguousRun(net.paths[idx].stops ?? [], pattern.stops);
        if (run > bestRun) {
          bestRun = run;
          best = idx;
        }
      }
      if (best !== null) return { pathIdx: best, rung: 'trimmed' };
      if (candidates.length > 0) return { pathIdx: candidates[0], rung: 'firstOfRouteAndDirection' };
      return { pathIdx: null, rung: 'unmapped' };
    },
  };
}

export function mapPatternsToPaths(net: GraphNetwork, index: TripIndex): PatternPaths {
  const resolver = patternPathResolver(net);
  const report: PatternPathReport = { byShape: 0, exact: 0, trimmed: 0, firstOfRouteAndDirection: 0, unmapped: 0, nonTram: 0 };
  const pathOf: (number | null)[] = [];
  for (const pattern of index.patterns) {
    const { pathIdx, rung } = resolver.resolve(pattern);
    report[rung]++;
    pathOf.push(pathIdx);
  }
  return { pathOf, pathIdOf: pathOf.map((idx) => (idx === null ? null : net.paths[idx].id)), report };
}

/** What scheduleTimes made of the index, for the tests and the round's reports. */
export interface ScheduleReport extends PatternPathReport {
  /** Paths that ended with segments. */
  pathsWithSegments: number;
  /** Patterns whose stop sequence its path could not place whole: a terminus
   *  stretch the builder trimmed off, or a platform outside the build's stop
   *  radius. The segment spanning such a stop carries its scheduled time. */
  clipped: number;
  /** Patterns whose path placed fewer than two of their stops, or placed them
   *  out of order: no segments come from those. */
  unusable: number;
}

/**
 * The static timetable as a TimesProvider. A pattern maps to its own path
 * (mapPatternsToPaths); where several patterns share a path (short-turn
 * variants), the one with the most trips speaks for it. A stop the path
 * cannot place -- a terminus the builder trimmed off, a platform outside its
 * stop radius -- no longer throws the whole pattern away: the segment either
 * side of it spans it and carries its scheduled seconds, so the stretch keeps
 * its timetable. Dwell is the median over every pattern naming the stop.
 */
export function scheduleTimes(net: GraphNetwork, index: TripIndex): TimesProvider & { report: ScheduleReport } {
  const segmentsByPath = new Map<number, Segment[]>();
  const tripsByPath = new Map<number, number>();
  const dwellSamples = new Map<string, number[]>();
  const mapping = mapPatternsToPaths(net, index);
  const report: ScheduleReport = { ...mapping.report, pathsWithSegments: 0, clipped: 0, unusable: 0 };

  index.patterns.forEach((pattern, patternIdx) => {
    pattern.stops.forEach((stopId, i) => {
      const dwell = pattern.dwell[i];
      if (typeof dwell === 'number' && Number.isFinite(dwell)) {
        const list = dwellSamples.get(stopId) ?? [];
        list.push(dwell);
        dwellSamples.set(stopId, list);
      }
    });
    const pathIdx = mapping.pathOf[patternIdx];
    if (pathIdx === null) return;
    if ((tripsByPath.get(pathIdx) ?? -1) >= pattern.trips) return;
    const arcs = new Map<string, number>();
    for (const entry of net.stopsOnPath(pathIdx)) if (!arcs.has(entry.stop.id)) arcs.set(entry.stop.id, entry.s);
    const placed: { i: number; s: number }[] = [];
    for (let i = 0; i < pattern.stops.length; i++) {
      const s = arcs.get(pattern.stops[i]);
      if (s !== undefined) placed.push({ i, s });
    }
    if (placed.length < pattern.stops.length) report.clipped++;
    const segments: Segment[] = [];
    let ok = true;
    for (let k = 1; k < placed.length; k++) {
      const from = placed[k - 1];
      const to = placed[k];
      if (to.s <= from.s) {
        ok = false;
        break;
      }
      // R-TE34: ZET's stop_times give arrival = departure at intermediate
      // stops, so a timetable dwell of 0 there is unknown, not zero, and the
      // stop's real standing time is folded into the seconds of the segment
      // that arrives at it. The planner's default dwell is booked out of that
      // segment, never below a third of it (R-F10's floor), so the timetable's
      // stop-to-stop time stays whole. The last stop is a terminus and is left
      // alone: the planner holds there until the trip changes.
      const arrivalUnknown = to.i < pattern.stops.length - 1 && pattern.dwell[to.i] === 0;
      const seconds = Array.from({ length: 24 }, (_, band) => {
        // Every stop pair this segment spans, plus the standing time the
        // timetable does record at a stop the path could not place.
        let scheduled = 0;
        for (let j = from.i; j < to.i; j++) scheduled += pattern.sched[band]?.[j] ?? pattern.sched[0]?.[j] ?? 0;
        for (let j = from.i + 1; j < to.i; j++) scheduled += pattern.dwell[j] ?? 0;
        return arrivalUnknown ? Math.max(scheduled / 3, scheduled - DWELL_DEFAULT_S) : scheduled;
      });
      segments.push({ fromS: from.s, toS: to.s, seconds });
    }
    if (!ok || segments.length === 0) {
      report.unusable++;
      return;
    }
    segmentsByPath.set(pathIdx, segments);
    tripsByPath.set(pathIdx, pattern.trips);
  });
  report.pathsWithSegments = segmentsByPath.size;

  return {
    report,
    segmentSeconds(pathIdx, fromS, toS, hourBand) {
      if (toS <= fromS) return 0;
      const segments = segmentsByPath.get(pathIdx);
      if (!segments) return null;
      if (fromS < segments[0].fromS - 1e-6 || toS > segments[segments.length - 1].toS + 1e-6) return null;
      let total = 0;
      for (const seg of segments) {
        const lo = Math.max(fromS, seg.fromS);
        const hi = Math.min(toS, seg.toS);
        if (hi <= lo) continue;
        total += ((hi - lo) / (seg.toS - seg.fromS)) * seg.seconds[hourBand % 24];
      }
      return total;
    },
    dwellSeconds(stopId) {
      const samples = dwellSamples.get(stopId);
      if (!samples || samples.length === 0) return null;
      // R-TE34: a timetable that says 0 says nothing; the planner's default stands in.
      const value = median(samples);
      return value > 0 ? value : null;
    },
  };
}

/** Samples a cell needs before its median speaks for a stretch or a stop:
 *  ten traversals separate a rush-hour edge from a quiet one and still fill
 *  within a morning on any line that runs every ten minutes; fewer would let
 *  one stuck tram write the timetable of an hour. */
export const LEARN_MIN_SAMPLES = 10;

/** The neighbouring hour bands a thin cell borrows from before falling
 *  through to the schedule: the same band on the other day type first (a
 *  Saturday noon is more like a Tuesday noon than like a Tuesday dawn), then
 *  one band either side, then two. */
const BAND_REACH = 2;

function borrowOrder(hourBand: number, dayType: DayType): [number, DayType][] {
  const other: DayType = dayType === 0 ? 1 : 0;
  const order: [number, DayType][] = [[hourBand, dayType], [hourBand, other]];
  for (let reach = 1; reach <= BAND_REACH; reach++) {
    for (const band of [hourBand - reach, hourBand + reach]) {
      order.push([(band + 24) % 24, dayType]);
    }
    for (const band of [hourBand - reach, hourBand + reach]) {
      order.push([(band + 24) % 24, other]);
    }
  }
  return order;
}

function lookup(table: Record<string, Histogram>, keyFor: (band: number, day: DayType) => string, hourBand: number, dayType: DayType, minSamples: number): number | null {
  for (const [band, day] of borrowOrder(hourBand, dayType)) {
    const h = table[keyFor(band, day)];
    if (h && histogramCount(h) >= minSamples) return histogramMedian(h);
  }
  return null;
}

/**
 * The learned medians in front of the schedule (C1): a stretch is summed
 * edge by edge over the covered arc shares, each edge answering from its
 * learned cell when it holds `minSamples` or more (borrowing from the same
 * band on the other day type and from neighbouring bands first), and from the
 * schedule otherwise; a stop's dwell the same way. The aggregates are read
 * live, so what the twin learns this minute shapes its next plan.
 */
export function learnedTimes(schedule: TimesProvider, aggregates: LearnedAggregates, net: GraphNetwork, minSamples = LEARN_MIN_SAMPLES): TimesProvider {
  return {
    segmentSeconds(pathIdx, fromS, toS, hourBand, dayType) {
      if (toS <= fromS) return 0;
      const path = net.paths[pathIdx];
      if (!path) return schedule.segmentSeconds(pathIdx, fromS, toS, hourBand, dayType);
      let total = 0;
      for (let k = 0; k < path.edges.length; k++) {
        const start = path.offsets[k];
        const end = k + 1 < path.edges.length ? path.offsets[k + 1] : path.len;
        const lo = Math.max(fromS, start);
        const hi = Math.min(toS, end);
        if (hi <= lo) continue;
        const learned = lookup(aggregates.edges, (band, day) => edgeKey(path.edges[k], band, day), hourBand, dayType, minSamples);
        if (learned !== null && end > start) {
          total += (learned * (hi - lo)) / (end - start);
          continue;
        }
        const scheduled = schedule.segmentSeconds(pathIdx, lo, hi, hourBand, dayType);
        if (scheduled === null) return schedule.segmentSeconds(pathIdx, fromS, toS, hourBand, dayType);
        total += scheduled;
      }
      // Anything beyond the path's edges is the schedule's to answer.
      if (toS > path.len + 1e-6 || fromS < -1e-6) return schedule.segmentSeconds(pathIdx, fromS, toS, hourBand, dayType);
      return total;
    },
    dwellSeconds(stopId, hourBand, dayType) {
      return lookup(aggregates.stops, (band, day) => stopKey(stopId, band, day), hourBand, dayType, minSamples) ?? schedule.dwellSeconds(stopId, hourBand, dayType);
    },
  };
}
