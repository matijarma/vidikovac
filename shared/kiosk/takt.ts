/**
 * The values of the wall's rows and their static order (docs/reveal-2026-10.md §5.2(a), seam (a)).
 *
 * A row becomes a candidate (`TaktCandidate`); its value is `BASE_VALUE[kind] × imminence × freshness`. The wall's
 * fitter (app/src/kiosk/timeline.ts) keeps the reserved rows, then the most valuable, and drops the least valuable
 * first. R2 extends this file with the beat scheduler (`takt()`, seam (b)) below this code, without changing it.
 * Pure: the file never reads the clock or the DOM.
 */
import type { NearbyKind } from '../../app/src/city/nearby';

export type TaktKind = NearbyKind | 'departures' | 'next-departures';
export type RevealKind = 'advance' | 'page';
export interface TaktCandidate { id: string; kind: TaktKind; atMs?: number; untilMs?: number; reserved: boolean; imminent: boolean; }
export interface TaktHistory { beat: number; shownAt: Readonly<Record<string, number>>; lastReveal: { kind: RevealKind; beat: number } | null; }

/** Imminence bands (brief §3): 1.0 within 30 min, 0.8 within 2 h, 0.5 within 6 h, 0.3 later today, 0.1 tomorrow. */
export const SOON_MS = 30 * 60_000;
export const NEAR_MS = 2 * 3_600_000;
export const TODAY_MS = 6 * 3_600_000;
/** Rain counts in full within the hour. */
export const RAIN_SOON_MS = 60 * 60_000;
/** From this Zagreb hour a cut tomorrow counts 0.6. */
export const CUT_EVENING_HOUR = 18;
/** A candidate not shown in the last 10 minutes counts ×1.2. */
export const FRESHNESS = 1.2;
export const FRESH_AFTER_MS = 10 * 60_000;

/** Base values by kind (brief §3). `next-departures` has no brief value: 100 is a placeholder R2 may change. */
export const BASE_VALUE: Readonly<Record<TaktKind, number>> = Object.freeze({
  departure: 100,
  departures: 100,
  'next-departures': 100,
  notice: 90,
  last: 80,
  rain: 70,
  cut: 70,
  closure: 60,
  event: 60,
  first: 60,
  rail: 50,
  road: 40,
  pharmacy: 40,
  open: 30,
  opening: 30,
  solar: 20,
  always: 10,
});

const DAY_PARTS = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Zagreb', year: 'numeric', month: '2-digit', day: '2-digit' });
const HOUR_PARTS = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Zagreb', hour: '2-digit', hourCycle: 'h23' });

/** The Zagreb day of an instant, 'YYYY-MM-DD'. */
export function zagrebDay(ms: number): string {
  return DAY_PARTS.format(new Date(ms));
}

function zagrebHour(ms: number): number {
  return Number(HOUR_PARTS.format(new Date(ms)));
}

/** The Zagreb day after a 'YYYY-MM-DD' day key. */
function nextDayKey(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

/** How near a row's moment is: a timeless row and a fact under way count 1, a past fact 0, a future one by its band. */
export function imminence(atMs: number | undefined, untilMs: number | undefined, now: number): number {
  if (!Number.isFinite(now)) return 1;
  if (atMs === undefined && untilMs === undefined) return 1;
  if (atMs === undefined) return (untilMs as number) > now ? 1 : 0;
  if (atMs <= now) return untilMs === undefined || untilMs > now ? 1 : 0;
  const d = atMs - now;
  if (d <= SOON_MS) return 1;
  if (d <= NEAR_MS) return 0.8;
  if (d <= TODAY_MS) return 0.5;
  if (zagrebDay(atMs) === zagrebDay(now)) return 0.3;
  return 0.1;
}

/** Imminence with the two kind overrides of brief §3: rain within the hour counts 1; a cut tomorrow 0.6 after 18:00. */
function kindImminence(c: TaktCandidate, now: number): number {
  if (Number.isFinite(now)) {
    if (c.kind === 'rain' && (c.atMs === undefined || c.atMs - now <= RAIN_SOON_MS)) return 1;
    if (c.kind === 'cut' && c.atMs !== undefined && zagrebDay(c.atMs) === nextDayKey(zagrebDay(now))
      && zagrebHour(now) >= CUT_EVENING_HOUR) return 0.6;
  }
  return imminence(c.atMs, c.untilMs, now);
}

/** A candidate's value: base × imminence × freshness (×1.2 when not shown in the last 10 minutes, or without history). */
export function candidateValue(c: TaktCandidate, now: number, history: TaktHistory | null): number {
  const shownAt = history?.shownAt[c.id];
  const fresh = history === null || shownAt === undefined || now - shownAt > FRESH_AFTER_MS ? FRESHNESS : 1;
  return BASE_VALUE[c.kind] * kindImminence(c, now) * fresh;
}

export const EMPTY_HISTORY: TaktHistory = Object.freeze({ beat: 0, shownAt: Object.freeze({}), lastReveal: null });

// --- The scheduler (reveal pass R2) ---
//
// The beat scheduler of the wall (docs/reveal-2026-10-plan/R2.md §0.2 is the rule text; brief §5.2(b), seam (b)).
// On each beat of the header's rhythm `takt` decides whether one region shows something more for exactly one beat:
// the departures line advances to the next departures, or the list turns a page (its least valuable rows give way to
// the most valuable ones it had no room for). Pure, like the rest of this file: `takt` never reads the clock, the
// DOM or any store, never draws a random number, and the same inputs give the same result (a fixture day replays
// into a committed beat log, test/fixtures/takt/beat-log.jsonl). The constants are the brief §3 numbers.

export interface TaktReveal { kind: RevealKind; ids: readonly string[]; replaces: readonly string[]; beat: number; }
export interface TaktOptions { capacity: number; rhythmMs: number; quiet: boolean; reduced: boolean; }
export interface TaktResult { page1: readonly string[]; reveal: TaktReveal | null; history: TaktHistory; }

/** Brief §3 "Reveal cadence": an advance may start on a beat `b` with `b % 4 === 0`. */
export const ADVANCE_EVERY_BEATS = 4;
/** Brief §3 "Reveal cadence": a page turn may start on a beat `b` with `b % 3 === 0`. */
export const PAGE_EVERY_BEATS = 3;
/** Brief §3 "Reveal cadence": a reveal starts only when the last one started at least 3 beats earlier (R2.md §0.5 item 1). */
export const REVEAL_GAP_BEATS = 3;
/** Brief §3 "Page turn": a page turn replaces at most 2 rows. */
export const PAGE_MAX_ROWS = 2;
/** Brief §3 "Reveal cadence": the first shown departure must be more than 10 min away for an advance. */
export const ADVANCE_LEAD_MS = 600_000;
/** Brief §3 "Page turn": a row within 30 min of its moment is imminent and never replaced (the imminence band's own edge, SOON_MS). */
export const REVEAL_IMMINENT_MS = SOON_MS;
/** Brief §3 "Freshness": the freshness window (R0's FRESH_AFTER_MS, one number); `shownAt` entries older than it are pruned. */
export const FRESH_MS = FRESH_AFTER_MS;
/** Brief §3 "Page turn": kinds never replaced and never revealed (R2.md §0.5 item 5: a closure is a fact about now). */
export const REVEAL_EXEMPT_KINDS: readonly TaktKind[] = Object.freeze(['closure']);

/** The beat an instant falls in on the absolute grid of the epoch (20, 30 and 60 s all divide a minute); -1 off the grid. */
export function beatIndex(now: number, rhythmMs: number): number {
  if (!Number.isFinite(now) || !Number.isFinite(rhythmMs) || rhythmMs <= 0) return -1;
  return Math.floor(now / rhythmMs);
}

/** A candidate a page turn may move: not reserved, not a departure or the line, not of an exempt kind. */
const moves = (c: TaktCandidate): boolean =>
  !c.reserved && c.kind !== 'departure' && c.kind !== 'departures' && !REVEAL_EXEMPT_KINDS.includes(c.kind);

/**
 * One beat of the wall (R2.md §0.2, rules 1 to 11). Page 1 is the reserved candidates and the most valuable of the
 * rest by the static value (R0's order, the fitter's), cut to `capacity`; freshness ranks page 2 only, and a page-2
 * candidate seen in the last FRESH_MS waits while page 2 holds another (the repeat gate of R2.md Risks). A quiet beat,
 * a beat off the grid or one inside the gap after the last reveal carries none; else an advance when the beat and
 * the lead allow it, else a page turn of at most PAGE_MAX_ROWS rows. The history returned is a new object: `shownAt`
 * holds every page-1 and revealed id at `now`, pruned to FRESH_MS, keys sorted; `reduced` changes nothing here.
 */
export function takt(candidates: readonly TaktCandidate[], history: TaktHistory, now: number, options: TaktOptions): TaktResult {
  const b = beatIndex(now, options.rhythmMs);
  const index = new Map<string, number>();
  candidates.forEach((c, i) => { if (!index.has(c.id)) index.set(c.id, i); });
  const order = (c: TaktCandidate): number => index.get(c.id)!;
  const still = (c: TaktCandidate): number => candidateValue(c, now, null);
  const fresh = (c: TaktCandidate): number => candidateValue(c, now, history);
  /** On the wall (page 1 or a reveal) within the freshness window: R0's boundary, read the same way as candidateValue. */
  const seen = (c: TaktCandidate): boolean => { const at = history.shownAt[c.id]; return at !== undefined && now - at <= FRESH_MS; };
  const listed = candidates.filter((c) => c.kind !== 'next-departures');
  const next = candidates.filter((c) => c.kind === 'next-departures');
  const reserved = listed.filter((c) => c.reserved);
  const rest = listed.filter((c) => !c.reserved).sort((x, y) => still(y) - still(x) || order(x) - order(y));
  const room = Math.max(0, Math.floor(Number.isFinite(options.capacity) ? options.capacity : 0) - reserved.length);
  const onPage1 = new Set([...reserved, ...rest.slice(0, room)].map((c) => c.id));
  const page1 = listed.filter((c) => onPage1.has(c.id)).map((c) => c.id);
  let reveal: TaktReveal | null = null;
  const gap = history.lastReveal === null || b - history.lastReveal.beat >= REVEAL_GAP_BEATS;
  if (!options.quiet && b >= 0 && gap) {
    const line = listed.find((c) => c.kind === 'departures' && onPage1.has(c.id));
    if (b % ADVANCE_EVERY_BEATS === 0 && line?.atMs !== undefined && line.atMs - now > ADVANCE_LEAD_MS && next.length > 0) {
      reveal = { kind: 'advance', ids: next.slice(0, 3).map((c) => c.id), replaces: [line.id], beat: b };
    } else if (b % PAGE_EVERY_BEATS === 0) {
      // The repeat gate (R2.md Risks, measured on the fixture day: without it the ten minutes from 13:20 revealed the
      // same train ten times, its value after one showing, 50, still over the next train's 48; with the unseen merely
      // first, the best seen row filled the second slot every minute from 17:00, and the least recently seen first
      // did the same from 19:00 over three rows and two slots): a page-2 candidate seen within FRESH_MS waits while
      // page 2 holds another, so no revealed row returns within ten minutes while the list has anything else to show;
      // a lone page-2 row is revealed on every eligible beat.
      const page2All = listed.filter((c) => !onPage1.has(c.id) && moves(c) && fresh(c) > 0);
      const page2 = (page2All.length > 1 ? page2All.filter((c) => !seen(c)) : page2All).sort((x, y) => fresh(y) - fresh(x) || order(x) - order(y));
      const out = listed.filter((c) => onPage1.has(c.id) && moves(c) && !c.imminent)
        .sort((x, y) => still(x) - still(y) || order(y) - order(x));
      const k = Math.min(PAGE_MAX_ROWS, out.length, page2.length);
      if (k > 0) reveal = { kind: 'page', ids: page2.slice(0, k).map((c) => c.id), replaces: out.slice(0, k).map((c) => c.id), beat: b };
    }
  }
  const kept: Record<string, number> = {};
  for (const [id, at] of Object.entries(history.shownAt)) if (at <= now && now - at <= FRESH_MS) kept[id] = at;
  for (const id of [...page1, ...(reveal?.ids ?? [])]) kept[id] = now;
  const shownAt: Record<string, number> = {};
  for (const id of Object.keys(kept).sort()) shownAt[id] = kept[id]!;
  return { page1, reveal, history: { beat: b, shownAt, lastReveal: reveal ? { kind: reveal.kind, beat: b } : history.lastReveal } };
}
