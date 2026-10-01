// Što se vidjelo and the hero numbers of /snimka/: every number the report
// states, computed in the page from the window series (and the comparison day
// and the screen index) by pure functions, each with its method line beside
// it on the page. Times in and out are epoch SECONDS, as the dataset counts;
// the clock's milliseconds stay in strip.ts and screen.ts.
//
// Missing is never zero: a minute whose column is null counts for nothing,
// and a function that finds nothing returns null (the page then says
// "bez podatka" or "U snimci nema takvih minuta"), never a 0 it did not see.
import { ZAGREB_OFFSET_S, type ScreenIndex, type SentenceFamily, type SeriesFile } from '../../../shared/snimka';
import { bars, card, empty } from '../statistika/charts';
import { escapeHtml } from '../ui/dom/escape';
import { count, duration, num, plural, zagrebClock, zagrebDateTime, zagrebDay, type Forms } from './format';
import { SN, fill } from './strings';

/** ZET's data is "not changing" once the newest header is older than this (the same rule as the events stage's
 *  header-age-over chapters, scripts/snimka/events.json). */
export const FROZEN_AFTER_S = 300;
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

/** ZET's data did not change at this minute (the newest header older than five minutes). */
export function frozenAt(s: SeriesFile, m: number): boolean {
  const age = s.feed.headerAgeS[m];
  return age !== null && age !== undefined && age > FROZEN_AFTER_S;
}

/** The quartet's and the peak card's minute of day. */
export const MORNING_S = 7 * 3600 + 45 * 60;

const DAY_S = 86_400;
const VOZILO: Forms = ['vozilo', 'vozila', 'vozila'];

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
 *  had a position), by how much at most, and when, in all and per day. Only minutes where both numbers exist are compared.
 *  Null without a published series (the comparison day). */
export function ghostInflation(s: SeriesFile): GhostResult | null {
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
 *  change (the newest header older than five minutes) and the longest such stretch from the moment the data
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
    const age = s.feed.headerAgeS[runStart]!;
    const fromSec = atOf(s, runStart) + 60 - age;
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
    const frozen = age !== null && age !== undefined && age > FROZEN_AFTER_S;
    if (frozen) {
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

// ---- the hero numbers ----------------------------------------------------------

export interface HeroTile { key: 'silent' | 'peak' | 'bikes' | 'return'; value: string; label: string; sub: string | null }

/** The four tiles of Ukratko: values and the lines under them, from the series alone. */
export function heroTiles(s: SeriesFile, comparison: SeriesFile | null): HeroTile[] {
  const none = SN.strip.noValue;
  const silent = silentMinutes(s);
  const peak = peakAt0745(s, comparison);
  const monday = peak.days.find((d) => new Date((d.day + ZAGREB_OFFSET_S) * 1000).getUTCDay() === 1) ?? null;
  const bikes = bikeDrain(s);
  const back = returnDuration(s);
  return [
    {
      key: 'silent',
      value: silent.total > 0 ? num(Math.round(silent.total / 60)) : none,
      label: SN.kpi.silent,
      sub: silent.fromSec !== null && silent.toSec !== null ? fill(SN.kpi.silentSub, { from: dt(silent.fromSec), to: dt(silent.toSec) }) : null,
    },
    {
      key: 'peak',
      value: monday?.seen !== null && monday?.seen !== undefined ? num(monday.seen) : none,
      label: SN.kpi.peak,
      sub: fill(SN.kpi.peakSub, { normal: peak.normal === null ? none : num(peak.normal) }),
    },
    {
      key: 'bikes',
      value: bikes ? num(bikes.maxTotal - bikes.minTotal) : none,
      label: SN.kpi.bikes,
      sub: bikes ? fill(SN.kpi.bikesSub, { from: num(bikes.maxTotal), to: num(bikes.minTotal), empty: bikes.maxEmpty === null ? none : num(bikes.maxEmpty), stations: bikes.stations === null ? none : num(bikes.stations) }) : null,
    },
    {
      key: 'return',
      value: back ? num(back.minutes) : none,
      label: SN.kpi.return,
      sub: back ? fill(SN.kpi.returnSub, { from: zagrebClock(back.fromSec * 1000), to: zagrebClock(back.toSec * 1000) }) : null,
    },
  ];
}

/** Fills the four tiles the HTML holds (data-sn="kpi-*") and clears the row's busy mark. */
export function renderHero(doc: Document, s: SeriesFile, comparison: SeriesFile | null): void {
  for (const tile of heroTiles(s, comparison)) {
    const el = doc.querySelector<HTMLElement>(`[data-sn="kpi-${tile.key}"]`);
    if (!el) continue;
    el.innerHTML = `<p class="st-kpi-value">${escapeHtml(tile.value)}</p><p class="st-kpi-label">${escapeHtml(tile.label)}</p>${tile.sub ? `<p class="st-kpi-sub">${escapeHtml(tile.sub)}</p>` : ''}`;
  }
  doc.querySelector('[data-sn="kpis"]')?.removeAttribute('aria-busy');
}

// ---- the cards ---------------------------------------------------------------------

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

/** Bars that may hold a missing value: the row says "bez podatka" and its track stays hatched, never a zero bar. */
function nullableBars(items: readonly { key: string; label: string; value: number | null; text: string }[], label: string): HTMLElement {
  const max = Math.max(0, ...items.map((i) => i.value ?? 0));
  const list = document.createElement('ul');
  list.className = 'st-bars';
  list.setAttribute('aria-label', label);
  list.innerHTML = items
    .map((i) => `<li class="st-bar${i.value === null ? ' sn-bar-null' : ''}" data-key="${escapeHtml(i.key)}"><span class="st-bar-label">${escapeHtml(i.label)}</span>` +
      `<span class="st-bar-track" aria-hidden="true">${i.value === null ? '' : `<span class="st-bar-fill" style="--w:${max > 0 ? (i.value / max).toFixed(4) : 0}"></span>`}</span>` +
      `<span class="st-bar-value">${escapeHtml(i.text)}</span></li>`)
    .join('');
  return list;
}

function smallTable(caption: string, head: readonly string[], rows: readonly (readonly string[])[]): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'st-table sn-small-table';
  wrap.innerHTML = `<div class="st-table-scroll" tabindex="0" role="region" aria-label="${escapeHtml(caption)}"><table><caption class="visually-hidden">${escapeHtml(caption)}</caption>` +
    `<thead><tr>${head.map((h) => `<th scope="col">${escapeHtml(h)}</th>`).join('')}</tr></thead>` +
    `<tbody>${rows.map((r) => `<tr>${r.map((c, i) => (i === 0 ? `<th scope="row">${escapeHtml(c)}</th>` : `<td>${escapeHtml(c)}</td>`)).join('')}</tr>`).join('')}</tbody></table></div>`;
  return wrap;
}

const R = SN.reckoning;
const FAMILY_LABELS: Record<SentenceFamily, string> = R.families;

function silentCard(s: SeriesFile): HTMLElement {
  const r = silentMinutes(s);
  const body = r.total > 0
    ? [figure(minutesText(r.total), fill(R.span, { from: dt(r.fromSec!), to: dt(r.toSec!) })),
      bars(r.byDay.map((d) => ({ key: String(d.day), label: zagrebDay(d.day * 1000), count: d.minutes })), R.silent, { valueText: minutesText })]
    : [empty(R.none)];
  return card({ id: 'vidjelo-tisina', title: R.silent, body, method: R.silentMethod });
}

function peakCard(s: SeriesFile, comparison: SeriesFile | null): HTMLElement {
  const r = peakAt0745(s, comparison);
  const text = (v: number | null, frozen = false): string => (v === null ? (frozen ? R.feedFrozen : SN.strip.noValue) : count(v, VOZILO));
  const items = [
    ...r.days.map((d) => ({ key: String(d.day), label: zagrebDay(d.day * 1000), value: d.seen, text: text(d.seen, d.frozen) })),
    { key: 'normal', label: R.peakCompare, value: r.normal, text: text(r.normal) },
  ];
  return card({ id: 'vidjelo-jutra', title: R.peak, body: [nullableBars(items, R.peak)], method: R.peakMethod });
}

function bikesCard(s: SeriesFile): HTMLElement {
  const r = bikeDrain(s);
  const body = r
    ? [figure(num(r.maxTotal - r.minTotal), SN.kpi.bikes),
      smallTable(R.bikes, [R.day, R.bikesMin, R.bikesEmptyMax], r.byDay.map((d) => [zagrebDay(d.day * 1000), d.minTotal === null ? SN.strip.noValue : num(d.minTotal), d.maxEmpty === null ? SN.strip.noValue : num(d.maxEmpty)]))]
    : [empty(SN.strip.noValue)];
  return card({ id: 'vidjelo-bicikli', title: R.bikes, body, method: R.bikesMethod });
}

function ghostsCard(s: SeriesFile): HTMLElement {
  const r = ghostInflation(s);
  let body: HTMLElement[];
  if (!r) body = [empty(SN.strip.noValue)];
  else if (r.minutes === 0 || r.maxAt === null) body = [empty(R.none)];
  else {
    body = [
      figure(`+${num(r.max)}`, plural(r.max, VOZILO)),
      facts([
        [R.ghostsMax, fill(R.ghostsMaxValue, { count: count(r.max, VOZILO), day: zagrebDay(r.maxAt * 1000), time: zagrebClock(r.maxAt * 1000) })],
        [R.ghostsMinutes, `${R.total} ${minutesText(r.minutes)}`],
      ]),
      bars(r.byDay.map((d) => ({ key: String(d.day), label: zagrebDay(d.day * 1000), count: d.minutes })), R.ghostsMinutes, { valueText: minutesText }),
    ];
  }
  return card({ id: 'vidjelo-broj', title: R.ghosts, lede: R.ghostsLede, body, method: R.ghostsMethod });
}

function returnCard(s: SeriesFile): HTMLElement {
  const r = returnDuration(s);
  const seenText = (v: number | null): string => (v === null ? '' : `, ${SN.strip.fleetSeen} ${num(v)}`);
  const body = r
    ? [figure(minutesText(r.minutes)), facts([[R.returnFrom, `${dt(r.fromSec)}${seenText(r.seenFrom)}`], [R.returnTo, `${dt(r.toSec)}${seenText(r.seenTo)}`]])]
    : [empty(R.none)];
  return card({ id: 'vidjelo-povratak', title: R.return, body, method: R.returnMethod });
}

function feedCard(s: SeriesFile): HTMLElement {
  const r = feedHealth(s);
  const rows: [string, string][] = [];
  const emptyLongest = r.emptyLongest;
  rows.push([R.feedEmpty, emptyLongest ? `${minutesText(r.emptyMinutes)}; ${fill(R.feedLongest, { duration: minutesText(emptyLongest.minutes), from: dt(emptyLongest.fromSec) })}` : minutesText(0)]);
  const longest = r.frozenLongest;
  rows.push([R.feedFrozen, longest ? `${minutesText(r.frozenMinutes)}; ${fill(R.feedLongest, { duration: minutesText(longest.minutes), from: dt(longest.fromSec) })}` : minutesText(0)]);
  return card({ id: 'vidjelo-podaci', title: R.feed, body: [facts(rows)], method: R.feedMethod });
}

function sentencesCard(index: ScreenIndex | null, failed: boolean): HTMLElement {
  let body: HTMLElement[];
  if (failed) body = [empty(SN.error.load)];
  else if (!index) {
    const sk = document.createElement('span');
    sk.className = 'skeleton sn-skeleton-card';
    body = [sk];
  } else {
    const r = sentenceFamilies(index);
    body = r.total > 0
      ? [bars(r.families.map((f) => ({ key: f.family, label: FAMILY_LABELS[f.family] ?? FAMILY_LABELS.other, count: f.count })), R.sentences, { shares: true }),
        facts([[R.liveRows, fill(R.liveRowsValue, { live: num(r.liveRows), rows: num(r.departureRows) })]])]
      : [empty(R.none)];
  }
  const el = card({ id: 'vidjelo-recenice', title: R.sentences, body, method: R.sentencesMethod });
  el.dataset.card = 'sentences';
  if (!index && !failed) el.setAttribute('aria-busy', 'true');
  return el;
}

export interface ReckoningHandle { setIndex(index: ScreenIndex | null, failed?: boolean): void }

/** Fills Što se vidjelo: one card per insight; the screen card waits for the index. */
export function renderReckoning(root: HTMLElement, s: SeriesFile, comparison: SeriesFile | null): ReckoningHandle {
  const grid = document.createElement('div');
  grid.className = 'st-grid sn-reckoning-grid';
  let sentences = sentencesCard(null, false);
  grid.append(silentCard(s), peakCard(s, comparison), ghostsCard(s), returnCard(s), bikesCard(s), feedCard(s), sentences);
  root.replaceChildren(grid);
  root.removeAttribute('aria-busy');
  return {
    setIndex(index, failed = false) {
      const next = sentencesCard(index, failed);
      sentences.replaceWith(next);
      sentences = next;
    },
  };
}
