// Što snimka pokazuje (v3): the three tiles at its head, each a button that
// moves the instrument to its moment, and the six cards under them; every
// number computed in the page from the window series (the comparison days and
// the routes file) by pure functions, each with its method line beside it on
// the page. Times in and out are epoch SECONDS, as the dataset counts;
// the clock's milliseconds stay in strip.ts and screen.ts.
//
// Missing is never zero: a minute whose column is null counts for nothing,
// and a function that finds nothing returns null (the page then says
// "bez podatka" or "U snimci nema takvih minuta"), never a 0 it did not see.
import { FROZEN_AFTER_S, ZAGREB_OFFSET_S, type ScreenIndex, type SentenceFamily, type SeriesFile } from '../../../shared/snimka';
import { ROUTES_MISSING, decodeRoutes } from '../../../shared/snimka-codec';
import { bars, card, empty, tableDetails } from '../statistika/charts';
import { bindTileSeeks, showOnStage } from './alternatives';
import type { Mount, SnimkaContext } from './context';
import type { RoutesLike } from './contracts';
import { escapeHtml } from '../ui/dom/escape';
import { WEEKDAYS, duration, num, plural, zagrebClock, zagrebDateTime, zagrebDay } from './format';
import { colMax, miniPlot } from './paths';
import { SN, fill } from './strings';

const zg = (month: number, day: number, hour: number, minute = 0): number => Date.UTC(2026, month - 1, day, hour, minute) / 1000 - ZAGREB_OFFSET_S;
/** The strike's first minute (Mon 28 Sep 03:30 Zagreb) and the first minute of the normal state after it (Wed 30 Sep
 *  20:16): the window of the alerts and the ghost rule (decision V3-21). */
export const STRIKE_FROM_SEC = zg(9, 28, 3, 30);
export const STRIKE_END_SEC = zg(9, 30, 20, 16);
/** The lines card stops before the relight (Wed 30 Sep 18:00; the first trams left the depots at 18:10). */
export const LINES_TO_SEC = zg(9, 30, 18, 0);
/** The normal day of the bikes: Thursday 1 October, inside the window (the comparison days carry no bikes). */
export const BIKES_REF_DAY_SEC = zg(10, 1, 0, 0);
/** The return card's span: Wed 30 Sep 18:00 to 22:00. */
export const RETURN_FROM_SEC = zg(9, 30, 18, 0);
export const RETURN_TO_SEC = zg(9, 30, 22, 0);
export interface Span { from: number; to: number }
const STRIKE: Span = { from: STRIKE_FROM_SEC, to: STRIKE_END_SEC };

/** ZET's data is "not changing" once the newest header is older than this: the one constant of decision S-19
 *  (shared/snimka.ts), re-exported for the callers that read it here. */
export { FROZEN_AFTER_S };
/** The return starts at the first minute with at least this many vehicles in motion... */
export const RETURN_MIN_SEEN = 10;
/** ...held for this many minutes with data (the events stage's seen-rising-past rule). */
export const RETURN_HOLD_MIN = 5;
/** A difference between the published number and the vehicles with a position counts as a ghost only where it
 *  cannot be the lag between the minute's two samples: a small fleet (under this many in motion)... */
export const GHOST_SMALL_FLEET = 20;
/** ...and at least this many more published; or any published vehicle while none had a position. */
export const GHOST_MIN_EXCESS = 2;

/** The ghosts of one minute (published minus seen) under the rule above, or null where the minute does not count. */
export function ghostExcess(published: number | null | undefined, seen: number | null | undefined): number | null {
  if (published === null || published === undefined || seen === null || seen === undefined) return null;
  const diff = published - seen;
  if (seen === 0 && published > 0) return diff;
  return seen < GHOST_SMALL_FLEET && diff >= GHOST_MIN_EXCESS ? diff : null;
}

/** ...and only once the small fleet has held for more than this many minutes with data: while the fleet shrinks or
 *  grows, the difference is the twin's 180 s hold on vehicles that just stopped reporting (Mon 00:25 on the real
 *  data: 31 published against 15 during the collapse), not a vehicle that was not there. */
export const GHOST_SETTLED_MIN = 10;

/** Per minute, the ghosts under ghostExcess, counted only in a settled small fleet (GHOST_SETTLED_MIN); null where
 *  the minute does not count. A minute without a seen value neither breaks nor extends the settled run. */
export function ghostSeries(s: SeriesFile): (number | null)[] {
  const out = new Array<number | null>(s.n).fill(null);
  const p = s.published;
  if (!p) return out;
  let run = 0;
  for (let m = 0; m < s.n; m++) {
    const seen = s.seen.all[m];
    if (seen === null || seen === undefined) continue;
    run = seen < GHOST_SMALL_FLEET ? run + 1 : 0;
    if (run > GHOST_SETTLED_MIN) out[m] = ghostExcess(p.vehicles[m], seen);
  }
  return out;
}

/** ZET's data did not change at this minute: the series' own `feed.frozen` column where it has a value (decision
 *  S-19), else the newest header older than FROZEN_AFTER_S. */
export function frozenAt(s: SeriesFile, m: number): boolean {
  const flag = s.feed.frozen?.[m];
  if (flag === 0 || flag === 1) return flag === 1;
  const age = s.feed.headerAgeS[m];
  return age !== null && age !== undefined && age > FROZEN_AFTER_S;
}

/** The quartet's and the peak card's minute of day. */
export const MORNING_S = 7 * 3600 + 45 * 60;

const DAY_S = 86_400;

/** The Zagreb midnight at or before an instant, epoch seconds. */
export function midnightOf(sec: number): number {
  return Math.floor((sec + ZAGREB_OFFSET_S) / DAY_S) * DAY_S - ZAGREB_OFFSET_S;
}

const atOf = (s: SeriesFile, m: number): number => s.t0 + m * 60;

/** The minute index of an instant in a series, or null outside it. */
export function minuteOf(s: SeriesFile, sec: number): number | null {
  const m = Math.floor((sec - s.t0) / 60);
  return m >= 0 && m < s.n ? m : null;
}

/** Every Zagreb day the series touches, as its midnight. */
export function daysOf(s: SeriesFile): number[] {
  const out: number[] = [];
  for (let d = midnightOf(s.t0); d < s.t0 + s.n * 60; d += DAY_S) out.push(d);
  return out;
}

/** "0 min" for a counted zero (a count of minutes, not a duration), the duration otherwise. */
export function minutesText(minutes: number): string {
  return minutes === 0 ? '0 min' : duration(minutes * 60_000);
}

const dt = (sec: number): string => zagrebDateTime(sec * 1000);

// ---- the functions -------------------------------------------------------------

export interface SilentResult { total: number; byDay: { day: number; minutes: number }[]; fromSec: number | null; toSec: number | null }

/** Minutes in the replayed "gotovo bez vozila" state, per Zagreb day, with the first and the last such minute. */
export function silentMinutes(s: SeriesFile): SilentResult {
  const days = daysOf(s);
  const byDay = days.map((day) => ({ day, minutes: 0 }));
  let total = 0;
  let first = -1;
  let last = -1;
  for (let m = 0; m < s.n; m++) {
    if (s.service.state[m] !== 'silent') continue;
    total++;
    if (first < 0) first = m;
    last = m;
    const day = days.indexOf(midnightOf(atOf(s, m)));
    if (day >= 0) byDay[day]!.minutes++;
  }
  return { total, byDay, fromSec: first < 0 ? null : atOf(s, first), toSec: last < 0 ? null : atOf(s, last) + 60 };
}

export interface PeakResult { days: { day: number; atSec: number; seen: number | null; expected: number | null; frozen: boolean }[]; normal: number | null }

/** Vehicles in motion at 07:45 on every morning of the window, and on the comparison day at the same minute. */
export function peakAt0745(s: SeriesFile, comparison: SeriesFile | null): PeakResult {
  const days: PeakResult['days'] = [];
  for (const day of daysOf(s)) {
    const atSec = day + MORNING_S;
    const m = minuteOf(s, atSec);
    if (m === null) continue;
    const seen = s.seen.all[m] ?? null;
    // A missing count while ZET's data stood still is not a gap in the recording: the card says which.
    days.push({ day, atSec, seen, expected: s.expected.all[m] ?? null, frozen: seen === null && frozenAt(s, m) });
  }
  let normal: number | null = null;
  if (comparison) {
    const m = minuteOf(comparison, midnightOf(comparison.t0) + MORNING_S);
    normal = m === null ? null : comparison.seen.all[m] ?? null;
  }
  return { days, normal };
}

export interface BikeResult {
  maxTotal: number; maxAt: number; minTotal: number; minAt: number;
  maxEmpty: number | null; maxEmptyAt: number | null; stations: number | null;
  byDay: { day: number; minTotal: number | null; maxEmpty: number | null }[];
}

/** The most bikes on the stations, the fewest after that (the drain), the most empty stations, and per day the
 *  fewest bikes and the most empty stations. Null without a bike series or without one bike count. */
export function bikeDrain(s: SeriesFile): BikeResult | null {
  const b = s.bikes;
  if (!b) return null;
  let maxM = -1;
  for (let m = 0; m < s.n; m++) {
    const v = b.total[m];
    if (v !== null && v !== undefined && (maxM < 0 || v > b.total[maxM]!)) maxM = m;
  }
  if (maxM < 0) return null;
  let minM = maxM;
  for (let m = maxM; m < s.n; m++) {
    const v = b.total[m];
    if (v !== null && v !== undefined && v < b.total[minM]!) minM = m;
  }
  let emptyM = -1;
  let stations: number | null = null;
  for (let m = 0; m < s.n; m++) {
    const e = b.empty[m];
    if (e !== null && e !== undefined && (emptyM < 0 || e > b.empty[emptyM]!)) emptyM = m;
    const r = b.reporting[m];
    if (r !== null && r !== undefined && (stations === null || r > stations)) stations = r;
  }
  const days = daysOf(s);
  const byDay = days.map((day) => ({ day, minTotal: null as number | null, maxEmpty: null as number | null }));
  for (let m = 0; m < s.n; m++) {
    const row = byDay[days.indexOf(midnightOf(atOf(s, m)))];
    if (!row) continue;
    const t = b.total[m];
    const e = b.empty[m];
    if (t !== null && t !== undefined && (row.minTotal === null || t < row.minTotal)) row.minTotal = t;
    if (e !== null && e !== undefined && (row.maxEmpty === null || e > row.maxEmpty)) row.maxEmpty = e;
  }
  return {
    maxTotal: b.total[maxM]!, maxAt: atOf(s, maxM), minTotal: b.total[minM]!, minAt: atOf(s, minM),
    maxEmpty: emptyM < 0 ? null : b.empty[emptyM]!, maxEmptyAt: emptyM < 0 ? null : atOf(s, emptyM), stations,
    byDay: byDay.filter((d) => d.minTotal !== null || d.maxEmpty !== null),
  };
}

export interface GhostResult {
  max: number; maxAt: number | null; publishedAtMax: number | null; seenAtMax: number | null; minutes: number; fromSec: number | null; toSec: number | null;
  /** Per Zagreb day with both numbers: the minutes it said more and the most it said more. */
  byDay: { day: number; minutes: number; max: number }[];
}

/** The number the product published against the vehicles with a position, minute by minute: how many minutes it
 *  counted vehicles that were not there (ghostSeries: a settled small fleet and at least two more, or any while none
 *  had a position), by how much at most, and when, in all and per day. Only minutes where both numbers exist are
 *  compared, and only strike minutes count (v3): inside `span` (Mon 03:30 to Wed 20:16 by default) and in the
 *  "gotovo bez vozila" or "smanjeno" state, so the midnight collapse before the strike and the night fleet of a
 *  normal day are not ghosts. Null without a published series (the comparison day). */
export function ghostInflation(s: SeriesFile, span: Span | null = STRIKE): GhostResult | null {
  const p = s.published;
  if (!p) return null;
  let max = 0;
  let maxM = -1;
  let minutes = 0;
  let first = -1;
  let last = -1;
  let compared = 0;
  const days = daysOf(s);
  const byDay = days.map((day) => ({ day, minutes: 0, max: 0, compared: 0 }));
  const excess = ghostSeries(s);
  for (let m = 0; m < s.n; m++) {
    const pub = p.vehicles[m];
    const seen = s.seen.all[m];
    if (pub === null || pub === undefined || seen === null || seen === undefined) continue;
    if (span) {
      const sec = atOf(s, m);
      const state = s.service.state[m];
      if (sec < span.from || sec >= span.to || (state !== 'silent' && state !== 'reduced')) continue;
    }
    compared++;
    const row = byDay[days.indexOf(midnightOf(atOf(s, m)))];
    if (row) row.compared++;
    const diff = excess[m] ?? null;
    if (diff === null) continue;
    minutes++;
    if (row) { row.minutes++; row.max = Math.max(row.max, diff); }
    if (first < 0) first = m;
    last = m;
    if (diff > max) { max = diff; maxM = m; }
  }
  if (compared === 0) return null;
  return {
    max, maxAt: maxM < 0 ? null : atOf(s, maxM),
    publishedAtMax: maxM < 0 ? null : p.vehicles[maxM]!, seenAtMax: maxM < 0 ? null : s.seen.all[maxM]!,
    minutes, fromSec: first < 0 ? null : atOf(s, first), toSec: last < 0 ? null : atOf(s, last) + 60,
    byDay: byDay.filter((d) => d.compared > 0).map(({ day, minutes: dm, max: dmax }) => ({ day, minutes: dm, max: dmax })),
  };
}

/** The longest stretch of minutes in the "silent" state (a minute without a frame carries the state), as indices. */
export function longestSilent(s: SeriesFile): [from: number, to: number] | null {
  let best: [number, number] | null = null;
  let start = -1;
  for (let m = 0; m <= s.n; m++) {
    const silent = m < s.n && s.service.state[m] === 'silent';
    if (silent && start < 0) start = m;
    if (!silent && start >= 0) {
      if (!best || m - 1 - start > best[1] - best[0]) best = [start, m - 1];
      start = -1;
    }
  }
  return best;
}

export interface ReturnResult { fromSec: number; toSec: number; minutes: number; seenFrom: number | null; seenTo: number | null }

/** From the first minute after the long silence with at least ten vehicles in motion (held five minutes with data,
 *  and only once the fleet has been under ten) to the first minute of the "uobičajeno" state after it. */
export function returnDuration(s: SeriesFile): ReturnResult | null {
  const silence = longestSilent(s);
  if (!silence) return null;
  const [a, b] = silence;
  let normalM = -1;
  for (let m = b + 1; m < s.n; m++) {
    if (s.service.state[m] === 'normal' && s.service.hold[m] !== 'gap') { normalM = m; break; }
  }
  if (normalM < 0) return null;
  const seen = s.seen.all;
  const test = (i: number): boolean | null => (seen[i] === null || seen[i] === undefined ? null : seen[i]! >= RETURN_MIN_SEEN);
  const holds = (m: number): boolean => {
    let counted = 0;
    for (let i = m; i < s.n && counted < RETURN_HOLD_MIN; i++) {
      const ok = test(i);
      if (ok === null) continue;
      if (!ok) return false;
      counted++;
    }
    return counted >= RETURN_HOLD_MIN;
  };
  let low = -1;
  for (let m = a; m <= normalM; m++) if (test(m) === false) { low = m; break; }
  if (low < 0) return null;
  let fromM = -1;
  for (let m = low; m <= normalM; m++) if (test(m) === true && holds(m)) { fromM = m; break; }
  if (fromM < 0) return null;
  const fromSec = atOf(s, fromM);
  const since = s.service.since[normalM];
  const toSec = since !== null && since !== undefined && since >= atOf(s, b) + 60 && since <= atOf(s, normalM) + 60 ? since : atOf(s, normalM);
  return { fromSec, toSec, minutes: Math.max(0, Math.round((toSec - fromSec) / 60)), seenFrom: seen[fromM] ?? null, seenTo: seen[normalM] ?? null };
}

export interface FeedResult {
  emptyMinutes: number; emptyFrom: number | null; emptyTo: number | null; emptyLongest: { minutes: number; fromSec: number } | null;
  frozenMinutes: number; frozenLongest: { minutes: number; fromSec: number } | null;
  missingMinutes: number;
}

/** Minutes in which ZET's data carried no vehicle at all and the longest such stretch, minutes in which it did not
 *  change (frozenAt: the frozen column, else the newest header older than three minutes) and the longest such stretch from the moment the data
 *  stopped, and minutes with no frame. */
export function feedHealth(s: SeriesFile): FeedResult {
  let emptyMinutes = 0;
  let emptyFirst = -1;
  let emptyLast = -1;
  let emptyLongest: { minutes: number; fromSec: number } | null = null;
  let emptyStart = -1;
  const closeEmpty = (end: number): void => {
    if (emptyStart < 0) return;
    if (!emptyLongest || end - emptyStart > emptyLongest.minutes) emptyLongest = { minutes: end - emptyStart, fromSec: atOf(s, emptyStart) };
    emptyStart = -1;
  };
  let frozenMinutes = 0;
  let missingMinutes = 0;
  let longest: { minutes: number; fromSec: number } | null = null;
  let runStart = -1;
  const closeRun = (end: number): void => {
    if (runStart < 0) return;
    const minutes = end - runStart;
    const age = s.feed.headerAgeS[runStart];
    // The moment the data stopped: the header's own age at the run's first minute, or that minute without one.
    const fromSec = age === null || age === undefined ? atOf(s, runStart) : atOf(s, runStart) + 60 - age;
    if (!longest || minutes > longest.minutes) longest = { minutes, fromSec };
    runStart = -1;
  };
  for (let m = 0; m < s.n; m++) {
    const entities = s.feed.entities[m];
    const age = s.feed.headerAgeS[m];
    if (entities === null && age === null) missingMinutes++;
    if (entities === 0) {
      emptyMinutes++;
      if (emptyFirst < 0) emptyFirst = m;
      emptyLast = m;
      if (emptyStart < 0) emptyStart = m;
    } else closeEmpty(m);
    if (frozenAt(s, m)) {
      frozenMinutes++;
      if (runStart < 0) runStart = m;
    } else closeRun(m);
  }
  closeRun(s.n);
  closeEmpty(s.n);
  return {
    emptyMinutes, emptyFrom: emptyFirst < 0 ? null : atOf(s, emptyFirst), emptyTo: emptyLast < 0 ? null : atOf(s, emptyLast) + 60, emptyLongest,
    frozenMinutes, frozenLongest: longest, missingMinutes,
  };
}

export interface FamiliesResult { families: { family: SentenceFamily; count: number }[]; total: number; departureRows: number; liveRows: number; runs: number }

/** The header sentences of every recorded run by family (from the index's summaries), the most frequent first. */
export function sentenceFamilies(index: ScreenIndex): FamiliesResult {
  const counts = new Map<SentenceFamily, number>();
  let departureRows = 0;
  let liveRows = 0;
  for (const run of index.runs) {
    for (const [family, n] of Object.entries(run.summary.sentences) as [SentenceFamily, number | undefined][]) {
      if (typeof n === 'number' && n > 0) counts.set(family, (counts.get(family) ?? 0) + n);
    }
    departureRows += run.summary.departureRows;
    liveRows += run.summary.liveRows;
  }
  const families = [...counts].map(([family, c]) => ({ family, count: c })).sort((x, y) => y.count - x.count || x.family.localeCompare(y.family));
  return { families, total: families.reduce((sum, f) => sum + f.count, 0), departureRows, liveRows, runs: index.runs.length };
}

export interface LinesDay { day: number; count: number; total: number; shortNames: string[] }

/** Per Zagreb day, the routes with a vehicle in motion in any five-minute slot of that day (`count`, with their short
 *  names, trams first) against the routes scheduled or seen that day (`total`). A missing slot (255) counts for
 *  nothing; a day without one known slot is left out. With `span`, only the slots starting inside it count. */
export function linesByDay(routes: RoutesLike, span: Span | null = null): LinesDay[] {
  const { seen, expected } = decodeRoutes(routes as Parameters<typeof decodeRoutes>[0]);
  const step = routes.step;
  const out = new Map<number, { count: Set<number>; total: Set<number>; known: boolean }>();
  for (let j = 0; j < routes.n; j++) {
    if (span && (routes.t0 + j * step < span.from || routes.t0 + j * step >= span.to)) continue;
    const day = midnightOf(routes.t0 + j * step);
    let row = out.get(day);
    if (!row) { row = { count: new Set(), total: new Set(), known: false }; out.set(day, row); }
    for (let i = 0; i < routes.routes.length; i++) {
      const sv = seen[i]![j]!;
      const ev = expected[i]![j]!;
      if (sv !== ROUTES_MISSING || ev !== ROUTES_MISSING) row.known = true;
      if (sv !== ROUTES_MISSING && sv > 0) { row.count.add(i); row.total.add(i); }
      if (ev !== ROUTES_MISSING && ev > 0) row.total.add(i);
    }
  }
  const order = (a: number, b: number): number => {
    const ra = routes.routes[a]!;
    const rb = routes.routes[b]!;
    return ra.type - rb.type || (Number(ra.shortName) || 9999) - (Number(rb.shortName) || 9999) || ra.shortName.localeCompare(rb.shortName);
  };
  return [...out]
    .filter(([, r]) => r.known)
    .sort(([a], [b]) => a - b)
    .map(([day, r]) => ({ day, count: r.count.size, total: r.total.size, shortNames: [...r.count].sort(order).map((i) => routes.routes[i]!.shortName) }));
}

export interface LinesRan {
  /** Routes with a vehicle in motion in at least one five-minute slot of the span. */
  count: number;
  /** Every route the routes file carries (the timetable's lines). */
  total: number;
  /** Of `count`, the routes that never had more than one vehicle in a slot. */
  single: number;
  /** The routes that ran, trams first, each with its most vehicles in one slot and its slots with a vehicle. */
  lines: { id: string; shortName: string; type: number; max: number; slots: number }[];
}

/** The lines that ran during the strike (decision V3-21): a vehicle in motion in at least one five-minute slot from
 *  Mon 03:30 to Wed 18:00 (on the real routes file: 8 of 154, 7 of them with one vehicle). A missing slot is no vehicle. */
export function linesRan(routes: RoutesLike, span: Span = { from: STRIKE_FROM_SEC, to: LINES_TO_SEC }): LinesRan {
  const { seen } = decodeRoutes(routes as Parameters<typeof decodeRoutes>[0]);
  const j0 = Math.max(0, Math.ceil((span.from - routes.t0) / routes.step));
  const j1 = Math.min(routes.n, Math.ceil((span.to - routes.t0) / routes.step));
  const lines: LinesRan['lines'] = [];
  routes.routes.forEach((r, i) => {
    let max = 0;
    let slots = 0;
    for (let j = j0; j < j1; j++) {
      const v = seen[i]![j]!;
      if (v === ROUTES_MISSING || v === 0) continue;
      slots++;
      if (v > max) max = v;
    }
    if (slots > 0) lines.push({ id: r.id, shortName: r.shortName, type: r.type, max, slots });
  });
  lines.sort((a, b) => a.type - b.type || (Number(a.shortName) || 9999) - (Number(b.shortName) || 9999) || a.shortName.localeCompare(b.shortName));
  return { count: lines.length, total: routes.routes.length, single: lines.filter((l) => l.max === 1).length, lines };
}

export interface AlertsEpisode { fromSec: number; toSec: number; alerts: number; cancelled: number; toEnd: boolean }
export interface AlertsResult {
  /** The most alerts (and cancelled trips) standing in ZET's data in any one minute of the span: a count, not alert-minutes. */
  alerts: number; cancelled: number;
  /** Hours of the span with a known value. */
  hours: number;
  /** After the span, the longest stretch of minutes with an alert standing (the Friday 2 October episode on the real data). */
  episode: AlertsEpisode | null;
}

/** ZET's own alerts and cancelled trips (v3, decision V3-21): the most in any one minute of the strike, never the sum
 *  over minutes (one alert standing for 54 hours is one alert); the episode after it counted on its own. Null when the
 *  span has no known value (never a 0 by assumption). */
export function feedAlerts(s: SeriesFile, span: Span = STRIKE): AlertsResult | null {
  let alerts = 0;
  let cancelled = 0;
  let known = 0;
  let best: AlertsEpisode | null = null;
  let run: AlertsEpisode | null = null;
  const close = (): void => {
    if (run && (!best || run.toSec - run.fromSec > best.toSec - best.fromSec)) best = run;
    run = null;
  };
  for (let m = 0; m < s.n; m++) {
    const sec = atOf(s, m);
    const a = s.feed.alerts[m];
    const c = s.feed.cancelledTrips[m];
    if (sec >= span.from && sec < span.to) {
      if (a !== null && a !== undefined) { known++; alerts = Math.max(alerts, a); }
      if (c !== null && c !== undefined) { known++; cancelled = Math.max(cancelled, c); }
      continue;
    }
    if (sec < span.to) continue;
    if (a === null || a === undefined) continue; // a missing minute neither breaks nor extends the episode
    if (a > 0) {
      if (!run) run = { fromSec: sec, toSec: sec + 60, alerts: 0, cancelled: 0, toEnd: false };
      run.toSec = sec + 60;
      run.alerts = Math.max(run.alerts, a);
      run.cancelled = Math.max(run.cancelled, c ?? 0);
      run.toEnd = m === s.n - 1;
    } else close();
  }
  close();
  if (known === 0) return null;
  return { alerts, cancelled, hours: Math.round((Math.min(span.to, atOf(s, s.n)) - Math.max(span.from, s.t0)) / 3600), episode: best };
}

export interface MorningRow { day: number; atSec: number; seen: number | null; frozen: boolean; empty: number | null }

/** Every morning of the window at 07:45: vehicles in motion (frozen where the count is missing while ZET's data stood
 *  still) and empty BAJS stations. */
export function mornings(s: SeriesFile): MorningRow[] {
  return peakAt0745(s, null).days.map((d) => {
    const m = minuteOf(s, d.atSec);
    const e = m === null ? null : s.bikes?.empty[m] ?? null;
    return { day: d.day, atSec: d.atSec, seen: d.seen, frozen: d.frozen, empty: e };
  });
}

/** The value of a bikes column at the same Zagreb time of day on Thursday 1 October (the bikes' normal day), or null. */
export function bikesOnThursday(s: SeriesFile, atSec: number, col: 'empty' | 'total' = 'empty'): number | null {
  const tod = atSec - midnightOf(atSec);
  const m = minuteOf(s, BIKES_REF_DAY_SEC + tod);
  return m === null || !s.bikes ? null : s.bikes[col][m] ?? null;
}

/** Trams and buses in motion as a percentage of their own timetable, per minute of the span (the return card): null
 *  where either number is missing or nothing was scheduled. */
export function returnShares(s: SeriesFile, span: Span = { from: RETURN_FROM_SEC, to: RETURN_TO_SEC }): { tram: (number | null)[]; bus: (number | null)[]; fromSec: number } {
  const m0 = minuteOf(s, span.from);
  const m1 = minuteOf(s, span.to - 60);
  const out = { tram: [] as (number | null)[], bus: [] as (number | null)[], fromSec: span.from };
  if (m0 === null || m1 === null) return out;
  const share = (seen: number | null | undefined, exp: number | null | undefined): number | null =>
    seen === null || seen === undefined || exp === null || exp === undefined || exp <= 0 ? null : Math.round((seen / exp) * 1000) / 10;
  for (let m = m0; m <= m1; m++) {
    out.tram.push(share(s.seen.tram[m], s.expected.tram[m]));
    out.bus.push(share(s.seen.bus[m], s.expected.bus[m]));
  }
  return out;
}

// ---- the tiles -------------------------------------------------------------------

export interface HeroTile { key: 'silent' | 'bikes' | 'return'; value: string; label: string; sub: string | null; /** The tile's moment (epoch seconds) the instrument seeks to; null when it has none. */ atSec: number | null }

/** The normal day to set against a morning: its series and its first instant (for the day's name). */
export interface PeakComparison { series: SeriesFile; fromSec: number }

/** The three tiles at the head of Što snimka pokazuje (decision V3-21), from the window series alone: hours almost
 *  without vehicles (seeks to the first such minute), the most empty BAJS stations against Thursday 1 October at the
 *  same time of day (seeks to that minute), and the return (seeks to its first held ten). The comparison arguments
 *  stay for the callers of v2 and are not read. */
export function heroTiles(s: SeriesFile, _comparison: SeriesFile | null = null, _peak: PeakComparison | null = null): HeroTile[] {
  void _comparison; void _peak;
  const none = SN.strip.noValue;
  const silent = silentMinutes(s);
  const bikes = bikeDrain(s);
  const back = returnDuration(s);
  const hours = Math.round(silent.total / 60);
  const thu = bikes && bikes.maxEmptyAt !== null ? bikesOnThursday(s, bikes.maxEmptyAt) : null;
  return [
    {
      key: 'silent',
      value: silent.total > 0 ? num(hours) : none,
      label: plural(hours, SN.kpi.silent),
      sub: silent.fromSec !== null && silent.toSec !== null ? fill(SN.kpi.silentSub, { from: dt(silent.fromSec), to: dt(silent.toSec) }) : null,
      atSec: silent.fromSec,
    },
    {
      key: 'bikes',
      value: bikes && bikes.maxEmpty !== null ? num(bikes.maxEmpty) : none,
      label: fill(plural(bikes?.maxEmpty ?? 0, SN.kpi.bikes), { stations: bikes && bikes.stations !== null ? num(bikes.stations) : none }),
      sub: bikes && bikes.maxEmptyAt !== null
        ? fill(SN.kpi.bikesSub, { day: zagrebDay(bikes.maxEmptyAt * 1000), time: zagrebClock(bikes.maxEmptyAt * 1000), normal: thu === null ? none : num(thu) })
        : null,
      atSec: bikes?.maxEmptyAt ?? null,
    },
    {
      key: 'return',
      value: back ? num(back.minutes) : none,
      label: plural(back?.minutes ?? 0, SN.kpi.return),
      sub: back ? fill(SN.kpi.returnSub, { from: zagrebClock(back.fromSec * 1000), to: zagrebClock(back.toSec * 1000) }) : null,
      atSec: back?.fromSec ?? null,
    },
  ];
}

/** Fills the tiles the HTML holds (data-sn="kpi-*"): each a button "Pokaži u snimci" carrying its moment
 *  (data-sn-seek, epoch seconds); a tile without a moment stays plain text. The v2 tiles (peak, alerts) are removed
 *  if an old page still holds them. With `onSeek`, the row's clicks are bound here (alternatives.ts bindTileSeeks). */
export function renderHero(doc: Document, s: SeriesFile, comparison: SeriesFile | null = null, peakComparison: PeakComparison | null = null, onSeek?: (atSec: number) => void): void {
  const tiles = heroTiles(s, comparison, peakComparison);
  for (const tile of tiles) {
    const el = doc.querySelector<HTMLElement>(`[data-sn="kpi-${tile.key}"]`);
    if (!el) continue;
    const inner = `<span class="st-kpi-value sn-kpi-value">${escapeHtml(tile.value)}</span><span class="st-kpi-label sn-kpi-label">${escapeHtml(tile.label)}</span>` +
      (tile.sub ? `<span class="st-kpi-sub sn-kpi-sub">${escapeHtml(tile.sub)}</span>` : '');
    el.classList.add('sn-kpi');
    el.innerHTML = tile.atSec === null
      ? inner
      : `<button type="button" class="sn-kpi-button" data-sn-seek="${tile.atSec}">${inner}<span class="sn-kpi-show">${escapeHtml(SN.kpi.show)}<span aria-hidden="true"> →</span></span></button>`;
  }
  for (const key of ['peak', 'alerts']) doc.querySelector(`[data-sn="kpi-${key}"]`)?.remove();
  const row = doc.querySelector<HTMLElement>('[data-sn="kpis"]');
  row?.removeAttribute('aria-busy');
  if (row && onSeek) bindTileSeeks(row, onSeek);
}

// ---- the cards ---------------------------------------------------------------------

const R = SN.reckoning;
/** Strings this lane needs that Appendix A lacks (new for the read-through; they move into strings.ts reckoning.* at
 *  integration: lane W4a may not edit strings.ts). */
export const RECKONING_NEW = {
  /** The legend of the ghost card's second line: the vehicles ZET's data placed on the map. */
  ghostsSeen: 's položajem',
  /** The silent card's days without a silent minute after the strike: "čet i pet: 0 min". */
  silentNone: '{days}: 0 min',
  /** The alerts line where the strike did carry alerts (never on the real data). */
  zetAlertsSome: 'Od pon 28. 9. u 03:30 do sri 30. 9. u 20:16: najviše {alerts} upozorenja i {cancelled} otkazanih vožnji u istoj minuti',
  /** The episode after the strike, with its real span (W0's zetFriday hard-codes 06:54 to 11:21; the real data holds alerts to the end). */
  zetEpisode: 'U {weekday} {date} od {from} do {to} u podacima je stajalo do {n} upozorenja s otkazanim vožnjama.',
  zetEpisodeToEnd: 'U {weekday} {date} od {from} do kraja snimke u {to} u podacima je stajalo do {n} upozorenja s otkazanim vožnjama.',
  /** The lines card: the lines by name. */
  linesList: 'linije: {lines}',
  /** The plots' tables. */
  ghostsTable: 'Ponedjeljak 28. 9.: brojevi po satu',
  returnTable: 'Povratak: udio voznog reda po pola sata',
  share: 'udio voznog reda',
} as const;
/** The weekday as it follows "u" (accusative), from Sunday. */
const WEEKDAY_ACC = ['nedjelju', 'ponedjeljak', 'utorak', 'srijedu', 'četvrtak', 'petak', 'subotu'] as const;
const weekdayOf = (sec: number): number => new Date((sec + ZAGREB_OFFSET_S) * 1000).getUTCDay();
const dateOf = (sec: number): string => zagrebDay(sec * 1000).split(' ').slice(1).join(' ');
const dayClock = (sec: number): string => `${WEEKDAYS[weekdayOf(sec)]} ${zagrebClock(sec * 1000)}`;

/** One big number at the head of a card (the answer), proportional figures. */
function figure(value: string, label?: string): HTMLElement {
  const p = document.createElement('p');
  p.className = 'sn-figure';
  p.innerHTML = `<span class="sn-figure-value">${escapeHtml(value)}</span>${label ? ` <span class="sn-figure-label">${escapeHtml(label)}</span>` : ''}`;
  return p;
}

/** Label and value pairs, read as a list. */
function facts(rows: readonly [label: string, value: string][]): HTMLElement {
  const dl = document.createElement('dl');
  dl.className = 'sn-facts';
  dl.innerHTML = rows.map(([k, v]) => `<div><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd></div>`).join('');
  return dl;
}

/** Sentences, one per line. */
function lines(items: readonly string[]): HTMLElement {
  const ul = document.createElement('ul');
  ul.className = 'sn-card-lines';
  ul.innerHTML = items.map((t) => `<li>${escapeHtml(t)}</li>`).join('');
  return ul;
}

/** Bars that may hold a missing value: the row says "bez podatka" and its track stays hatched, never a zero bar. */
function nullableBars(items: readonly { key: string; label: string; value: number | null; text: string; normal?: boolean }[], label: string): HTMLElement {
  const max = Math.max(0, ...items.map((i) => i.value ?? 0));
  const list = document.createElement('ul');
  list.className = 'st-bars';
  list.setAttribute('aria-label', label);
  list.innerHTML = items
    .map((i) => `<li class="st-bar${i.value === null ? ' sn-bar-null' : ''}${i.normal ? ' sn-card-bar-normal' : ''}" data-key="${escapeHtml(i.key)}"><span class="st-bar-label">${escapeHtml(i.label)}</span>` +
      `<span class="st-bar-track" aria-hidden="true">${i.value === null ? '' : `<span class="st-bar-fill" style="--w:${max > 0 ? (i.value / max).toFixed(4) : 0}"></span>`}</span>` +
      `<span class="st-bar-value">${escapeHtml(i.text)}</span></li>`)
    .join('');
  return list;
}

function tagged(el: HTMLElement, key: string): HTMLElement {
  el.dataset.card = key;
  return el;
}

function silentCard(s: SeriesFile): HTMLElement {
  const r = silentMinutes(s);
  let body: HTMLElement[];
  if (r.total === 0) body = [empty(R.none)];
  else {
    const withSilence = r.byDay.filter((d) => d.minutes > 0);
    const lastSilent = withSilence[withSilence.length - 1]!.day;
    // The days after the strike carry their counted zero in one line ("čet i pet: 0 min"), not as empty bars.
    const after = r.byDay.filter((d) => d.minutes === 0 && d.day > lastSilent).map((d) => WEEKDAYS[weekdayOf(d.day)]!);
    body = [
      figure(minutesText(r.total), fill(R.span, { from: dt(r.fromSec!), to: dt(r.toSec!) })),
      bars(withSilence.map((d) => ({ key: String(d.day), label: zagrebDay(d.day * 1000), count: d.minutes })), R.silent, { valueText: minutesText }),
      ...(after.length ? [lines([fill(RECKONING_NEW.silentNone, { days: after.join(' i ') })])] : []),
    ];
  }
  return tagged(card({ id: 'vidjelo-tisina', title: R.silent, body, method: R.silentMethod }), 'silent');
}

function morningsCard(s: SeriesFile, normals: readonly ReckoningComparison[]): HTMLElement {
  const rows = mornings(s);
  const vehicle = (v: number | null, frozen = false): string => (v === null ? (frozen ? R.feedFrozen : SN.strip.noValue) : num(v));
  const fleet = [
    ...rows.map((d) => ({ key: String(d.day), label: zagrebDay(d.day * 1000), value: d.seen, text: vehicle(d.seen, d.frozen) })),
    ...normals.map((c) => {
      const v = peakAt0745(s, c.series).normal;
      return { key: `normal-${c.id}`, label: fill(R.normalDay, { day: zagrebDay(c.fromSec * 1000) }), value: v, text: vehicle(v), normal: true };
    }),
  ];
  const empties = rows.map((d) => ({ key: String(d.day), label: zagrebDay(d.day * 1000), value: d.empty, text: d.empty === null ? SN.strip.noValue : num(d.empty), normal: d.day >= BIKES_REF_DAY_SEC }));
  const col = (title: string, items: typeof fleet): HTMLElement => {
    const box = document.createElement('div');
    box.className = 'sn-card-col';
    const h = document.createElement('h4');
    h.className = 'sn-card-col-title';
    h.textContent = title;
    box.append(h, nullableBars(items, title));
    return box;
  };
  const cols = document.createElement('div');
  cols.className = 'sn-card-cols';
  cols.append(col(SN.strip.fleet, fleet), col(SN.strip.bikesEmpty, empties));
  return tagged(card({ id: 'vidjelo-jutra', title: R.mornings, body: [cols], method: R.morningsMethod, wide: true }), 'mornings');
}

function linesCard(routes: RoutesLike): HTMLElement {
  const r = linesRan(routes);
  const body = r.count === 0
    ? [empty(SN.strip.noValue)]
    : [
      figure(fill(plural(r.total, R.linesValueForms), { n: num(r.count), total: num(r.total), single: num(r.single) })),
      lines([fill(RECKONING_NEW.linesList, { lines: r.lines.map((l) => l.shortName).join(', ') }), R.linesModes]),
    ];
  return tagged(card({ id: 'vidjelo-linije', title: R.lines, body, method: R.linesMethod }), 'lines');
}

/** The published number and the vehicles in motion at Monday 07:45 ("7 umjesto 2"), or null where either is missing. */
export function ghostsAt(s: SeriesFile, atSec: number = zg(9, 28, 7, 45)): { shown: number; real: number } | null {
  const m = minuteOf(s, atSec);
  if (m === null || !s.published) return null;
  const shown = s.published.vehicles[m];
  const real = s.seen.all[m];
  return shown === null || shown === undefined || real === null || real === undefined ? null : { shown, real };
}

function ghostsCard(s: SeriesFile): HTMLElement {
  const r = ghostInflation(s);
  const at = ghostsAt(s);
  const monday = zg(9, 28, 0, 0);
  let body: HTMLElement[];
  if (!r || !s.published) body = [empty(SN.strip.noValue)];
  else {
    const mon = r.byDay.find((d) => d.day === monday) ?? null;
    body = [];
    if (at) body.push(figure(fill(R.ghostsValue, { shown: num(at.shown), real: num(at.real) }), zagrebDateTime(zg(9, 28, 7, 45) * 1000)));
    body.push(facts([[R.ghostsMinutes, mon ? `${zagrebDay(monday * 1000)}: ${minutesText(mon.minutes)}` : SN.strip.noValue]]));
    // The Monday from midnight to midnight, both numbers on one scale.
    const m0 = minuteOf(s, monday);
    if (m0 !== null) {
      const m1 = Math.min(s.n, m0 + 1440);
      const pub = s.published.vehicles.slice(m0, m1).map((v) => v ?? null);
      const seen = s.seen.all.slice(m0, m1).map((v) => v ?? null);
      const max = Math.max(1, colMax(pub, seen));
      body.push(miniPlot(document, {
        series: [{ values: seen, kind: 'line', tone: 'sn-card-tone-seen', label: RECKONING_NEW.ghostsSeen }, { values: pub, kind: 'line', tone: 'sn-card-tone-shown', label: SN.strip.productScreen }],
        max, scale: num(max), label: R.ghostsLede,
        ticks: [0, 6, 12, 18].map((h) => ({ x: h / 24, label: `${String(h).padStart(2, '0')}:00` })),
      }));
      const rows: string[][] = [];
      for (let k = 0; k < pub.length; k += 60) rows.push([zagrebClock((monday + k * 60) * 1000), pub[k] === null ? SN.strip.noValue : num(pub[k]!), seen[k] === null ? SN.strip.noValue : num(seen[k]!)]);
      body.push(tableDetails(RECKONING_NEW.ghostsTable, [SN.strip.hour, SN.strip.productScreen, RECKONING_NEW.ghostsSeen], rows, SN.strip.table));
    }
  }
  return tagged(card({ id: 'vidjelo-broj', title: R.ghosts, lede: R.ghostsLede, body, method: R.ghostsMethod }), 'ghosts');
}

function zetCard(s: SeriesFile): HTMLElement {
  const a = feedAlerts(s);
  const h = feedHealth(s);
  const items: string[] = [];
  if (!a) items.push(`${R.zet}: ${SN.strip.noValue}`);
  else if (a.alerts === 0 && a.cancelled === 0) items.push(R.zetAlerts);
  else items.push(fill(RECKONING_NEW.zetAlertsSome, { alerts: num(a.alerts), cancelled: num(a.cancelled) }));
  if (h.emptyLongest) {
    const from = h.emptyLongest.fromSec;
    items.push(fill(R.zetEmpty, { d: minutesText(h.emptyLongest.minutes), from: dayClock(from), to: dayClock(from + h.emptyLongest.minutes * 60) }));
  }
  if (h.frozenMinutes > 0) items.push(fill(R.zetFrozen, { d: minutesText(h.frozenMinutes) }));
  const ep = a?.episode ?? null;
  if (ep) {
    items.push(fill(ep.toEnd ? RECKONING_NEW.zetEpisodeToEnd : RECKONING_NEW.zetEpisode, {
      weekday: WEEKDAY_ACC[weekdayOf(ep.fromSec)]!, date: dateOf(ep.fromSec), from: zagrebClock(ep.fromSec * 1000), to: zagrebClock(ep.toSec * 1000), n: num(ep.alerts),
    }));
  }
  const totals = facts([
    [R.feedEmpty, `${R.total} ${minutesText(h.emptyMinutes)}`],
    [R.feedFrozen, `${R.total} ${minutesText(h.frozenMinutes)}${h.frozenLongest ? `; ${fill(R.feedLongest, { duration: minutesText(h.frozenLongest.minutes), from: dt(h.frozenLongest.fromSec) })}` : ''}`],
  ]);
  return tagged(card({ id: 'vidjelo-podaci', title: R.zet, body: [lines(items), totals], method: R.zetMethod }), 'zet');
}

function returnCard(s: SeriesFile): HTMLElement {
  const r = returnDuration(s);
  const shares = returnShares(s);
  const seenText = (v: number | null): string => (v === null ? '' : `, ${SN.strip.fleetSeen} ${num(v)}`);
  const body: HTMLElement[] = [];
  if (!r) body.push(empty(R.none));
  else body.push(figure(minutesText(r.minutes)), facts([[R.returnFrom, `${dt(r.fromSec)}${seenText(r.seenFrom)}`], [R.returnTo, `${dt(r.toSec)}${seenText(r.seenTo)}`]]));
  if (shares.tram.some((v) => v !== null) || shares.bus.some((v) => v !== null)) {
    const max = Math.max(100, colMax(shares.tram, shares.bus));
    const span = shares.tram.length;
    body.push(miniPlot(document, {
      series: [{ values: shares.tram, kind: 'line', tone: 'sn-card-tone-tram', label: SN.strip.tram }, { values: shares.bus, kind: 'line', tone: 'sn-card-tone-bus', label: SN.strip.bus }],
      max, scale: `${num(Math.round(max))} %`, label: R.returnModes,
      ticks: [0, 60, 120, 180].map((k) => ({ x: k / span, label: zagrebClock((shares.fromSec + k * 60) * 1000) })),
    }));
    const pct = (v: number | null | undefined): string => (v === null || v === undefined ? SN.strip.noValue : `${num(Math.round(v))} %`);
    const rows: string[][] = [];
    for (let k = 0; k < span; k += 30) rows.push([zagrebClock((shares.fromSec + k * 60) * 1000), pct(shares.tram[k]), pct(shares.bus[k])]);
    body.push(tableDetails(RECKONING_NEW.returnTable, [SN.strip.hour, SN.strip.tram, SN.strip.bus], rows, SN.strip.table));
  }
  body.push(lines([R.returnModes]));
  return tagged(card({ id: 'vidjelo-povratak', title: R.return, body, method: R.returnMethod }), 'return');
}

export interface ReckoningHandle { setIndex(index: ScreenIndex | null, failed?: boolean): void }

/** One loaded normal day as the mornings card names it. */
export interface ReckoningComparison { id: string; fromSec: number; series: SeriesFile }

export interface ReckoningExtras {
  /** The window's per-line counts: the card "Što je vozilo". */
  routes?: RoutesLike | null;
  /** The normal days for the mornings card (Mon 21 and Thu 24 Sep). */
  comparisons?: readonly ReckoningComparison[];
}

/** Fills the six cards of Što snimka pokazuje (decision V3-21). `setIndex` stays for the v2 caller and does nothing:
 *  the screen's sentence families left the page. */
export function renderReckoning(root: HTMLElement, s: SeriesFile, _comparison: SeriesFile | null = null, extras: ReckoningExtras = {}): ReckoningHandle {
  void _comparison;
  const grid = document.createElement('div');
  grid.className = 'st-grid sn-reckoning-grid sn-card-grid';
  grid.append(silentCard(s), morningsCard(s, extras.comparisons ?? []));
  if (extras.routes) grid.append(linesCard(extras.routes));
  grid.append(ghostsCard(s), zetCard(s), returnCard(s));
  root.replaceChildren(grid);
  root.removeAttribute('aria-busy');
  return { setIndex() { /* v3: no card reads the screen index */ } };
}

/** Što snimka pokazuje on the page: the tiles (into [data-sn-mount="brojke"]) bound to the instrument, and the six
 *  cards into `root` ([data-sn-mount="reckoning"]). */
export const mountReckoning: Mount = (ctx: SnimkaContext, root: HTMLElement) => {
  const doc = ctx.doc;
  const normals: ReckoningComparison[] = [...ctx.comparisons].sort((a, b) => a.fromSec - b.fromSec).map((c) => ({ id: c.id, fromSec: c.fromSec, series: c.series }));
  renderHero(doc, ctx.series, null, null, (atSec) => showOnStage(ctx, atSec));
  doc.querySelector<HTMLElement>('[data-sn-mount="brojke"]')?.removeAttribute('aria-busy');
  renderReckoning(root, ctx.series, null, { routes: ctx.routes, comparisons: normals });
  return () => {};
};
