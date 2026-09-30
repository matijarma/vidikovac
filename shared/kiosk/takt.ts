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
