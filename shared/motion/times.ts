// What a segment of track "should" take and how long a stop "should" hold a
// vehicle: the timetable's answer today, the learned medians' answer once C1
// wraps this (a wrapper answers from its aggregates and falls through to
// the schedule where they are thin). The planner asks in path arcs; the
// timetable speaks in stop pairs, so the mapping from stops to arcs is done
// once per path here.

import type { GraphNetwork } from './network';
import type { TripIndex } from './trips';

/** 0 Monday to Friday, 1 Saturday, Sunday and holidays: the two shapes a
 *  Zagreb timetable and a Zagreb street have. */
export type DayType = 0 | 1;

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

const ZAGREB_BANDS = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Zagreb', hour: '2-digit', hourCycle: 'h23', weekday: 'short' });

/** The hour band and day type of an instant, Zagreb wall clock. */
export function zagrebBands(epochSec: number): { hourBand: number; dayType: DayType } {
  const parts: Record<string, string> = {};
  for (const part of ZAGREB_BANDS.formatToParts(new Date(epochSec * 1000))) parts[part.type] = part.value;
  const hourBand = Number(parts.hour) % 24;
  const dayType: DayType = parts.weekday === 'Sat' || parts.weekday === 'Sun' ? 1 : 0;
  return { hourBand, dayType };
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
      const seconds = Array.from({ length: 24 }, (_, band) => pattern.sched[band]?.[i] ?? pattern.sched[0]?.[i] ?? 0);
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
      return samples && samples.length > 0 ? median(samples) : null;
    },
  };
}
