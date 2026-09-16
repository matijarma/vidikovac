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

/**
 * The static timetable as a TimesProvider. A pattern maps to the path with
 * its shape id, or to the synthetic path of its route and direction; where
 * several patterns share a path (short-turn variants), the one with the most
 * trips speaks for it. Dwell is the median over every pattern naming the stop.
 */
export function scheduleTimes(net: GraphNetwork, index: TripIndex): TimesProvider {
  const segmentsByPath = new Map<number, Segment[]>();
  const tripsByPath = new Map<number, number>();
  const dwellSamples = new Map<string, number[]>();
  const pathByShapeId = new Map<string, number>(net.paths.map((p, idx) => [p.id, idx] as const));

  for (const pattern of index.patterns) {
    pattern.stops.forEach((stopId, i) => {
      const dwell = pattern.dwell[i];
      if (typeof dwell === 'number' && Number.isFinite(dwell)) {
        const list = dwellSamples.get(stopId) ?? [];
        list.push(dwell);
        dwellSamples.set(stopId, list);
      }
    });
    let pathIdx: number | undefined = pattern.shape !== '' ? pathByShapeId.get(pattern.shape) : undefined;
    if (pathIdx === undefined) {
      const synthetic = net.paths.findIndex((p) => p.shape === null && p.route === pattern.route && p.direction === pattern.direction);
      if (synthetic >= 0) pathIdx = synthetic;
    }
    if (pathIdx === undefined) continue;
    if ((tripsByPath.get(pathIdx) ?? -1) >= pattern.trips) continue;
    const arcs = new Map<string, number>();
    for (const entry of net.stopsOnPath(pathIdx)) if (!arcs.has(entry.stop.id)) arcs.set(entry.stop.id, entry.s);
    const segments: Segment[] = [];
    let ok = true;
    for (let i = 0; i + 1 < pattern.stops.length; i++) {
      const fromS = arcs.get(pattern.stops[i]);
      const toS = arcs.get(pattern.stops[i + 1]);
      if (fromS === undefined || toS === undefined || toS <= fromS) {
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
      const arrivalUnknown = i + 1 < pattern.stops.length - 1 && pattern.dwell[i + 1] === 0;
      const seconds = Array.from({ length: 24 }, (_, band) => {
        const scheduled = pattern.sched[band]?.[i] ?? pattern.sched[0]?.[i] ?? 0;
        return arrivalUnknown ? Math.max(scheduled / 3, scheduled - DWELL_DEFAULT_S) : scheduled;
      });
      segments.push({ fromS, toS, seconds });
    }
    if (!ok || segments.length === 0) continue;
    segmentsByPath.set(pathIdx, segments);
    tripsByPath.set(pathIdx, pattern.trips);
  }

  return {
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
