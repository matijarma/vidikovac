// The per-stop dwell table (F11). Before this file the engine asked three
// different questions about one platform and got three different answers:
// the planner took `times.dwellSeconds ?? 20`, the speed estimator charged a
// flat 20 s, and the learner priced the "other stops" inside a dwell sample
// off yet another number. One table now answers all of them, in one fixed
// order of sources, each earlier one more specific than the next:
//
//   1. an OWNER OVERRIDE with `pin: true` -- a number a person put there,
//      which measurement may not argue with (a terminus layover the feed
//      never reports as standing time, a platform the owner knows);
//   2. the RECENT WINDOW -- the DWELL_PLAN_QUANTILE quantile of the last
//      DWELL_RECENT_N samples inside DWELL_RECENT_WINDOW_S, once
//      DWELL_RECENT_MIN of them exist. This is what the platform is doing
//      this hour: a fair, a closed street, a crush load;
//   3. the BANDED HISTOGRAM -- the same quantile of the learned cell for
//      (stop, hour band, day type), with times.ts's borrowing, once the cell
//      is thick enough to mean anything;
//   4. the DEFAULT -- the owner's override where there is one, else the
//      timetable's median where it is above zero, else DWELL_DEFAULT_S.
//
// The quantile is 0.7, not the median, for the round's own rule: a plan that
// leaves a platform before the tram does puts the mark ahead of the tram and
// has to come back, which reads as a broken app; a plan that waits a little
// too long reads as GPS lag. Seven trams in ten are gone by the 0.7 quantile.
//
// DOM-free, no import from worker/ or app/ (R-TE15): the twin builds one per
// engine, the replay harness builds the same one from the same files.

import { histogramQuantile, type LearnedAggregates, stopKey } from './learn';
import type { GraphNetwork } from './network';
import { DWELL_DEFAULT_S } from './plan';
import type { DayType } from './bands';
import { borrowCount, borrowQuantile, LEARN_MIN_SAMPLES, type TimesProvider } from './times';

/** The side of the dwell distribution the planner books. 0.7, not 0.5: the
 *  F7 measurement of ZET's own platforms put the tram dwell at p50 15 s,
 *  p75 23 s, p90 37 s, so the median leaves three trams in ten still at the
 *  platform while the plan has driven off, and 0.7 costs 6 s against the
 *  median where it is wrong and saves 20 s where it is right. */
export const DWELL_PLAN_QUANTILE = 0.7;

/** Recent samples kept per platform. Thirty covers a whole rush hour on any
 *  line that runs every two minutes and still fits in the state row. */
export const DWELL_RECENT_N = 30;

/** How far back a "recent" sample reaches: 90 minutes, about one round trip
 *  of the longest ZET tram line, so the window is always about conditions
 *  the next tram will still meet. */
export const DWELL_RECENT_WINDOW_S = 5400;

/** Samples the window needs before it outranks the banded histogram. Five is
 *  where a 0.7 quantile stops being one tram's opinion: the nearest-rank
 *  0.7 of five samples is the fourth, so a single long stand cannot move it. */
export const DWELL_RECENT_MIN = 5;

/** A dwell above this is a layover, a fault or a blockage and never a
 *  platform stand; the table refuses to plan one however it was measured.
 *  An owner override may exceed it: a person put that number there. */
export const DWELL_PLAN_MAX_S = 300;

// ---- the owner override layer ---------------------------------------------------

/** One line of app/public/data/stop-dwell-overrides.json. `stop` is a GTFS
 *  platform id or a stop NAME (which matches every platform of that name);
 *  `route` narrows the entry to the platforms that route's paths actually
 *  serve. `pin` makes the number the planned dwell outright. */
export interface DwellOverride {
  stop: string;
  route?: string;
  defaultSec: number;
  pin?: boolean;
  reason: string;
}

const OVERRIDE_KEYS = new Set(['stop', 'route', 'defaultSec', 'pin', 'reason']);

/** The longest dwell an override may state: an hour. Beyond it the entry is
 *  a typo (60000 for 60), and a typo that silently parks a tram for a day is
 *  exactly what "fails loudly" is for. */
const OVERRIDE_MAX_SEC = 3600;

function bad(entry: unknown, why: string): never {
  throw new Error(`stop-dwell-overrides: ${why} in ${JSON.stringify(entry)}`);
}

/**
 * Parses the override file, strictly. Accepts either a bare array or an
 * object with `entries` (so the file can carry a `_comment` documenting its
 * own shape). Anything unexpected throws with the offending entry printed:
 * a dwell table quietly ignoring half of what the owner wrote would be worse
 * than a twin that will not start.
 */
export function parseDwellOverrides(raw: unknown): DwellOverride[] {
  const list = Array.isArray(raw) ? raw : raw !== null && typeof raw === 'object' ? (raw as { entries?: unknown }).entries : undefined;
  if (!Array.isArray(list)) throw new Error(`stop-dwell-overrides: expected an array or an object with "entries", got ${JSON.stringify(raw).slice(0, 200)}`);
  return list.map((entry): DwellOverride => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) bad(entry, 'not an object');
    const e = entry as Record<string, unknown>;
    for (const key of Object.keys(e)) if (!OVERRIDE_KEYS.has(key)) bad(entry, `unknown key "${key}"`);
    if (typeof e.stop !== 'string' || e.stop.trim() === '') bad(entry, '"stop" must be a platform id or a stop name');
    if (e.route !== undefined && (typeof e.route !== 'string' || e.route.trim() === '')) bad(entry, '"route" must be a route id');
    if (typeof e.defaultSec !== 'number' || !Number.isFinite(e.defaultSec) || e.defaultSec < 0 || e.defaultSec > OVERRIDE_MAX_SEC) {
      bad(entry, `"defaultSec" must be a number of seconds between 0 and ${OVERRIDE_MAX_SEC}`);
    }
    if (e.pin !== undefined && typeof e.pin !== 'boolean') bad(entry, '"pin" must be true or false');
    if (typeof e.reason !== 'string' || e.reason.trim() === '') bad(entry, '"reason" must say why the number is there');
    return {
      stop: e.stop,
      ...(e.route === undefined ? {} : { route: e.route }),
      defaultSec: e.defaultSec,
      ...(e.pin === undefined ? {} : { pin: e.pin }),
      reason: e.reason,
    };
  });
}

// ---- the recent window ----------------------------------------------------------

/** [report time of the fix that closed the dwell, seconds stood]. */
export type DwellSample = [atSec: number, seconds: number];

/** Per platform, the last DWELL_RECENT_N samples, oldest first. Plain data:
 *  it rides in the twin's state row and in SQLite unchanged. */
export type DwellRecent = Record<string, DwellSample[]>;

/** Appends one measured dwell, keeping the newest DWELL_RECENT_N. */
export function pushDwellRecent(recent: DwellRecent, stopId: string, atSec: number, seconds: number): void {
  const list = recent[stopId] ?? (recent[stopId] = []);
  list.push([atSec, seconds]);
  if (list.length > DWELL_RECENT_N) list.splice(0, list.length - DWELL_RECENT_N);
}

/** The newest DWELL_RECENT_N samples per platform inside the window, oldest
 *  first: what a cold restore keeps of what SQLite held. */
export function trimDwellRecent(recent: DwellRecent, nowSec: number, windowSec = DWELL_RECENT_WINDOW_S): DwellRecent {
  const out: DwellRecent = {};
  for (const [stopId, list] of Object.entries(recent)) {
    const kept = list
      .filter(([at]) => at > nowSec - windowSec)
      .sort((a, b) => a[0] - b[0])
      .slice(-DWELL_RECENT_N);
    if (kept.length > 0) out[stopId] = kept;
  }
  return out;
}

/** Nearest-rank quantile of a small sample: the value at ceil(q*n), so the
 *  0.7 of five samples is the fourth and no interpolation invents a number
 *  no tram ever stood for. */
export function sampleQuantile(values: readonly number[], q: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))];
}

// ---- the table ------------------------------------------------------------------

export interface DwellRow {
  stopId: string;
  name: string;
  /** What the table plans when nothing is measured: the override, the timetable, the default. */
  defaultSec: number;
  override: { defaultSec: number; pin: boolean; route: string | null; reason: string } | null;
  /** The banded histogram at the median and at DWELL_PLAN_QUANTILE, or null where the cell is thin. */
  p50: number | null;
  p70: number | null;
  /** Samples of the banded cell the two quantiles were read from. */
  samples: number;
  /** Samples inside the recent window. */
  recent: number;
  lastSampleSec: number | null;
  /** What the planner books right now. */
  plannedSec: number;
}

export interface DwellTable {
  /** The dwell with nothing measured: the owner's override, else the
   *  timetable's median where it is above zero, else DWELL_DEFAULT_S. */
  defaultSec(stopId: string): number;
  /** What the platform is measured to do, or null where nothing is known. */
  dynamicSec(stopId: string, nowSec: number, hourBand: number, dayType: DayType): number | null;
  /** What the planner books: a pinned override, else the measurement, else the default. */
  plannedSec(stopId: string, nowSec: number, hourBand: number, dayType: DayType): number;
  /** One row per platform anything is known about, for /stats. */
  rows(nowSec: number, hourBand: number, dayType: DayType): DwellRow[];
  /** Overrides that matched no platform of this network: a renamed stop, a
   *  typo. Reported rather than thrown, so a rebuilt artefact cannot take the
   *  twin down over one stale line of a hand-edited file. */
  unmatchedOverrides: readonly DwellOverride[];
}

export interface DwellTableInput {
  net: GraphNetwork;
  /** The timetable, for the default where no override speaks. */
  schedule: TimesProvider;
  /** The learned aggregates, read live: what the twin learns this minute
   *  shapes the dwell it books next tick. */
  aggregates: LearnedAggregates;
  overrides?: readonly DwellOverride[];
  /** The rolling window, read live for the same reason. */
  recent?: DwellRecent;
  /** Samples a banded cell needs before it speaks; the learner's own bar. */
  minSamples?: number;
  quantile?: number;
}

/** An override naming a platform id beats one naming the place, and a
 *  route-scoped entry beats an unscoped one; between equals the owner's last
 *  line wins. Nothing here is a guess the code makes -- it is the order a
 *  person writing the file would expect their more specific line to take. */
function specificity(entry: DwellOverride, byId: boolean): number {
  return (byId ? 2 : 0) + (entry.route === undefined ? 0 : 1);
}

export function createDwellTable(input: DwellTableInput): DwellTable {
  const { net, schedule, aggregates } = input;
  const overrides = input.overrides ?? [];
  const recent = input.recent ?? {};
  const minSamples = input.minSamples ?? LEARN_MIN_SAMPLES;
  const quantile = input.quantile ?? DWELL_PLAN_QUANTILE;

  const stopById = new Map(net.stops.map((stop) => [stop.id, stop] as const));
  const idsByName = new Map<string, string[]>();
  for (const stop of net.stops) {
    const list = idsByName.get(stop.name);
    if (list) list.push(stop.id);
    else idsByName.set(stop.name, [stop.id]);
  }
  /** The platforms a route's own paths call at (the served lists, F8). */
  const servedByRoute = new Map<string, Set<string>>();
  net.paths.forEach((path, pathIdx) => {
    const set = servedByRoute.get(path.route) ?? new Set<string>();
    for (const entry of net.stopsOnPath(pathIdx)) set.add(entry.stop.id);
    servedByRoute.set(path.route, set);
  });

  const chosen = new Map<string, { entry: DwellOverride; score: number }>();
  const unmatched: DwellOverride[] = [];
  for (const entry of overrides) {
    const byId = stopById.has(entry.stop);
    const targets = byId ? [entry.stop] : idsByName.get(entry.stop) ?? [];
    const scoped = entry.route === undefined ? targets : targets.filter((id) => servedByRoute.get(entry.route!)?.has(id));
    if (scoped.length === 0) {
      unmatched.push(entry);
      continue;
    }
    const score = specificity(entry, byId);
    for (const id of scoped) {
      const standing = chosen.get(id);
      if (!standing || score >= standing.score) chosen.set(id, { entry, score });
    }
  }

  const overrideOf = (stopId: string): DwellOverride | null => chosen.get(stopId)?.entry ?? null;

  const defaultSec = (stopId: string): number => {
    const override = overrideOf(stopId);
    if (override) return override.defaultSec;
    const scheduled = schedule.dwellSeconds(stopId, 0, 0);
    return scheduled !== null && scheduled > 0 ? scheduled : DWELL_DEFAULT_S;
  };

  const recentIn = (stopId: string, nowSec: number): number[] => {
    const list = recent[stopId];
    if (!list) return [];
    const out: number[] = [];
    for (const [at, seconds] of list) if (at > nowSec - DWELL_RECENT_WINDOW_S) out.push(seconds);
    return out;
  };

  const bandedAt = (stopId: string, hourBand: number, dayType: DayType, q: number): number | null =>
    borrowQuantile(aggregates.stops, (band, day) => stopKey(stopId, band, day), hourBand, dayType, minSamples, q);

  const dynamicSec = (stopId: string, nowSec: number, hourBand: number, dayType: DayType): number | null => {
    const window = recentIn(stopId, nowSec);
    const measured = window.length >= DWELL_RECENT_MIN ? sampleQuantile(window, quantile) : bandedAt(stopId, hourBand, dayType, quantile);
    return measured === null ? null : Math.max(0, Math.min(DWELL_PLAN_MAX_S, measured));
  };

  const plannedSec = (stopId: string, nowSec: number, hourBand: number, dayType: DayType): number => {
    const override = overrideOf(stopId);
    if (override?.pin) return override.defaultSec;
    return dynamicSec(stopId, nowSec, hourBand, dayType) ?? defaultSec(stopId);
  };

  return {
    defaultSec,
    dynamicSec,
    plannedSec,
    unmatchedOverrides: unmatched,
    rows(nowSec, hourBand, dayType) {
      // Every platform anything is known about: an override, a recent sample,
      // or a learned cell. The whole served table would be a thousand rows of
      // "20 s, nothing measured", which tells an operator nothing.
      const ids = new Set<string>([...chosen.keys(), ...Object.keys(recent)]);
      for (const key of Object.keys(aggregates.stops)) {
        const at = key.lastIndexOf('|');
        const mid = key.lastIndexOf('|', at - 1);
        if (mid > 0) ids.add(key.slice(0, mid));
      }
      const rows: DwellRow[] = [];
      for (const stopId of ids) {
        const stop = stopById.get(stopId);
        if (!stop) continue;
        const override = overrideOf(stopId);
        const window = recent[stopId]?.filter(([at]) => at > nowSec - DWELL_RECENT_WINDOW_S) ?? [];
        rows.push({
          stopId,
          name: stop.name,
          defaultSec: defaultSec(stopId),
          override: override === null ? null : { defaultSec: override.defaultSec, pin: override.pin === true, route: override.route ?? null, reason: override.reason },
          p50: bandedAt(stopId, hourBand, dayType, 0.5),
          p70: bandedAt(stopId, hourBand, dayType, quantile),
          samples: borrowCount(aggregates.stops, (band, day) => stopKey(stopId, band, day), hourBand, dayType, minSamples),
          recent: window.length,
          lastSampleSec: window.length > 0 ? window[window.length - 1][0] : null,
          plannedSec: plannedSec(stopId, nowSec, hourBand, dayType),
        });
      }
      rows.sort((a, b) => b.recent - a.recent || b.samples - a.samples || a.name.localeCompare(b.name, 'hr'));
      return rows;
    },
  };
}

/** The dwell every consumer of the table asks for, bound to one instant and
 *  band: the planner, the speed estimator's charge and the learner's "other
 *  stops" all take one of these, so none of them can disagree with another
 *  about one platform. */
export interface DwellPlanner {
  plannedSec(stopId: string): number;
}

export function dwellPlannerAt(table: DwellTable, nowSec: number, hourBand: number, dayType: DayType): DwellPlanner {
  return { plannedSec: (stopId) => table.plannedSec(stopId, nowSec, hourBand, dayType) };
}

/** A histogram's quantile, re-exported so a caller reading a dwell cell does
 *  not have to know which module the histograms live in. */
export { histogramQuantile };
