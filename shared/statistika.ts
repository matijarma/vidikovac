// The wire shape of /api/statistika, the public report behind /statistika/.
// Built by worker/stats/public.ts, drawn by app/src/statistika/. Two kinds of
// numbers, never mixed:
//
//   people   sessions, scans, panels, exports, screens online, /hitno views.
//            Every one is a sum of cells the City fold (worker/stats/export.ts
//            foldCells) would publish: rounded to 5, no cell under 10, the
//            folded part named "ostalo". /privatnost/ point 7 promises exactly
//            this, and the page says so beside each chart.
//   system   the sources' fetches and the tram model's own measurements. No
//            person is in them, so they are exact.

/** The windows the page offers; any other `dani` reads as the default. */
export const STATISTIKA_WINDOWS = [7, 30, 90, 365] as const;
export type StatistikaWindow = (typeof STATISTIKA_WINDOWS)[number];
export const STATISTIKA_DEFAULT_WINDOW: StatistikaWindow = 30;

export function statistikaWindow(raw: string | null | undefined): StatistikaWindow {
  const n = Number(raw);
  return (STATISTIKA_WINDOWS as readonly number[]).includes(n) ? (n as StatistikaWindow) : STATISTIKA_DEFAULT_WINDOW;
}

/** The key the fold gives every folded part. */
export const OSTALO_KEY = 'ostalo';

/** One bar of a breakdown: a dimension value and its sum over the window. */
export interface Share {
  key: string;
  /** A human name where the key is a slug the server can name (districts). */
  label?: string;
  count: number;
}

/** One person-event of one scope, from folded cells only. */
export interface PeopleEvent {
  /** Every published cell of the window, summed. */
  total: number;
  /** Aligned with PublicStats.days; null where the day published nothing
   *  (under the threshold, or nothing at all: the fold does not say which). */
  daily: (number | null)[];
  /** The cells that kept their hour, summed per hour of the day (0 to 23). */
  hours: number[];
  /** The cells folded to a whole day: counted, but without an hour. */
  wholeDay: number;
  /** Sums by the first and the second dimension, largest first, the folded
   *  part (OSTALO_KEY) last. Empty strings are the dimension a row lacks. */
  dim1: Share[];
  dim2: Share[];
}

/** The person-events a screen scope carries. */
export const PEOPLE_EVENTS = ['session_start', 'session_end', 'scan_fail', 'kiosk_online', 'panel_open', 'export'] as const;
export type PeopleEventName = (typeof PEOPLE_EVENTS)[number];

export type UsageScope = Record<PeopleEventName, PeopleEvent>;

export interface SourceStats {
  module: string;
  ok: number;
  partial: number;
  stale: number;
  error: number;
}

export interface HindsightStats {
  horizon: string;
  /** Graded plans per error band, lt25 .. ge200. */
  buckets: Record<string, number>;
  /** The same plans by sign: ahead_ge50, within50, behind_ge50. */
  sign: Record<string, number>;
}

export interface LiveStop {
  name: string;
  /** Median and planning quantile of the measured stands, seconds; null where thin. */
  p50: number | null;
  pPlan: number | null;
  /** What the planner books at this platform right now, seconds. */
  plannedSec: number;
  samples: number;
}

export interface LiveJunction {
  /** The nearest named stop within JUNCTION_NAME_RADIUS_M, or null. */
  near: string | null;
  lon: number;
  lat: number;
  passes: number;
  waits: number;
  /** waits / passes. */
  share: number;
  /** Median wait of the trams that stood, seconds; null when none did. */
  p50: number | null;
}

export interface LiveTables {
  /** Epoch seconds the tables were read at. */
  at: number;
  stops: LiveStop[];
  junctions: LiveJunction[];
  /** How many platforms and crossings the model knows anything about. */
  stopsKnown: number;
  junctionsKnown: number;
}

export interface SystemStats {
  sources: SourceStats[];
  /** Tick outcomes over the window: ok, unchanged, error, stale_index, overrides_unreadable. */
  ticks: Record<string, number>;
  /** Ticks that followed a cold start of the object. */
  coldTicks: number;
  /** Aligned with PublicStats.days: ticks that read the feed (ok + unchanged), and all ticks. */
  ticksGood: number[];
  ticksAll: number[];
  hindsight: HindsightStats[];
  plan: Share[];
  order: Share[];
  /** The hourly timetable check: current, newer, unknown, error. */
  timetable: Record<string, number>;
  /** The model's live tables, or null when the twin did not answer. */
  live: LiveTables | null;
}

export interface PublicStats {
  version: 1;
  generatedAt: string;
  window: { days: StatistikaWindow; since: string; today: string; timeZone: 'Europe/Zagreb' };
  /** Every Zagreb day of the window, oldest first. */
  days: string[];
  rules: { roundTo: number; minCell: number };
  /** Screens at venues: the City's own set. */
  venue: UsageScope;
  /** Temporary screens anyone can start at /kiosk/: the prototype's evaluation, kept apart. */
  evaluation: UsageScope;
  /** The open safety page, no scan needed. */
  hitno: PeopleEvent;
  system: SystemStats;
}
