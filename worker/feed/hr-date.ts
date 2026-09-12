import { zagrebIso, zagrebOffsetMinutes } from './time';

// Kulturpunkt (E2), the Skupština rokovnik and session pages (E3) and the ZET
// RSS feeds (E5) all name their date only as Croatian sentence prose, never a
// machine field, and the year is routinely left out because the reader is
// assumed to know it's "this year" (see test/fixtures/dogadanja/sources.json
// for the live examples this file is built against). This module is the one
// place that turns that prose into an instant, so no sub-fetcher invents its
// own date grammar.

export type Precision = 'time' | 'day' | 'range';

export interface HrDate {
  startIso: string;
  endIso?: string;
  precision: Precision;
}

// Genitive forms only ("11. rujna", never the nominative "rujan" or the
// locative "u rujnu") -- the only shape Croatian date prose actually uses.
const MONTHS: Record<string, number> = {
  siječnja: 1,
  veljače: 2,
  ožujka: 3,
  travnja: 4,
  svibnja: 5,
  lipnja: 6,
  srpnja: 7,
  kolovoza: 8,
  rujna: 9,
  listopada: 10,
  studenoga: 11,
  prosinca: 12,
};

const MONTHS_ALT = Object.keys(MONTHS).join('|');

/** "The year is inferred ... only when the resulting date is within six months either way" (task brief). */
const SIX_MONTHS_DAYS = 183;
const MS_PER_DAY = 86_400_000;

function zagrebCalendarDate(instant: Date): { year: number; month: number; day: number } {
  const offsetMinutes = zagrebOffsetMinutes(instant);
  const shifted = new Date(instant.getTime() + offsetMinutes * 60_000);
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}

function addCalendarDays(date: { year: number; month: number; day: number }, delta: number): { year: number; month: number; day: number } {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + delta));
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}

/** Rejects a calendar date that doesn't exist (e.g. 30 February): JS silently rolls that into early March, which must never pass for a real date. */
function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const rolled = new Date(Date.UTC(year, month - 1, day));
  return rolled.getUTCFullYear() === year && rolled.getUTCMonth() === month - 1 && rolled.getUTCDate() === day;
}

/**
 * The year is never in the text, so it is inferred as the current Zagreb-local
 * year at `now` -- and accepted only when that lands the date within six
 * months of `now` either way. This is a single guess, not a search across
 * neighbouring years: a date that reads as "clearly next year" from a source
 * published near a year boundary is exactly the case the brief says must come
 * back `null` rather than be guessed at.
 */
function inferYear(now: Date, month: number, day: number): number | null {
  const today = zagrebCalendarDate(now);
  if (!isValidCalendarDate(today.year, month, day)) return null;
  const diffDays = Math.abs(new Date(zagrebIso(today.year, month, day)).getTime() - now.getTime()) / MS_PER_DAY;
  return diffDays <= SIX_MONTHS_DAYS ? today.year : null;
}

interface TimeOfDay {
  hour: number;
  minute: number;
}

interface TimeSpan {
  start: TimeOfDay;
  end?: TimeOfDay;
}

// "od 19 do 20.30 sati" / "od 8 do 15 sati" -- always ends in the word "sati",
// which is exactly what keeps this from ever matching a day range such as
// "od 22. do 29. rujna" (that one ends in a month name instead).
const TIME_RANGE_PATTERN = /\bod\s+(\d{1,2})(?:[.:](\d{2}))?\s*do\s+(\d{1,2})(?:[.:](\d{2}))?\s*sati\b/i;
// "u 20 sati" / "s početkom u 9:00 sati" -- the longer alternative is tried
// first only because it reads more naturally; both start at a different
// literal word ("s" vs "u") so there is no real precedence conflict.
const SINGLE_TIME_PATTERN = /\b(?:s\s+početkom\s+u|u)\s+(\d{1,2})(?:[.:](\d{2}))?\s*sati\b/i;

/** Looks for a time only inside `window` -- the text between one date mention and the next -- so a second event's time can never attach to the first. */
function findTimeSpan(window: string): TimeSpan | null {
  const range = TIME_RANGE_PATTERN.exec(window);
  if (range) {
    return {
      start: { hour: Number(range[1]), minute: range[2] ? Number(range[2]) : 0 },
      end: { hour: Number(range[3]), minute: range[4] ? Number(range[4]) : 0 },
    };
  }
  const single = SINGLE_TIME_PATTERN.exec(window);
  if (single) {
    return { start: { hour: Number(single[1]), minute: single[2] ? Number(single[2]) : 0 } };
  }
  return null;
}

// "od 22. do 29. rujna [2026.]" -- a closed day range in one month. The
// literal "od"/"do" is what tells this apart from the dual-day form below.
const RANGE_PATTERN = new RegExp(`\\bod\\s+(?<!\\d)(\\d{1,2})\\.\\s*do\\s+(?<!\\d)(\\d{1,2})\\.\\s*(${MONTHS_ALT})\\.?(?:\\s+(\\d{4})\\.?)?`, 'i');
// "9. i 10. rujna" / "24. i 25. kolovoza" -- two days named together instead
// of "od ... do ...", equally real in the Kulturpunkt fixture and read the
// same way: a closed range across the named days.
const DUAL_DAY_PATTERN = new RegExp(`(?<!\\d)(\\d{1,2})\\.\\s+i\\s+(?<!\\d)(\\d{1,2})\\.\\s*(${MONTHS_ALT})\\.?(?:\\s+(\\d{4})\\.?)?`, 'i');
// One anchor date, either "11. rujna [2026.]" or the all-numeric "11.9.2026.".
// Matched with a global flag so every occurrence in the text can be found:
// the second occurrence (if any) bounds how far `findTimeSpan` is allowed to
// look for the first occurrence's own time, so a later sentence's time never
// gets attached to an earlier date.
const ANCHOR_PATTERN = new RegExp(
  `(?<![\\d.])(\\d{1,2})\\.(\\d{1,2})\\.(\\d{4})\\.?|(?<![\\d.])(\\d{1,2})\\.\\s*(${MONTHS_ALT})\\.?(?:\\s+(\\d{4}))?\\.?`,
  'gi',
);
const RELATIVE_PATTERN = /\b(danas|sutra)\b/i;
const RELATIVE_OFFSET: Record<string, number> = { danas: 0, sutra: 1 };

function buildRange(now: Date, startDay: number, endDay: number, month: number, explicitYear?: number): HrDate | null {
  if (!Number.isInteger(startDay) || !Number.isInteger(endDay) || startDay < 1 || startDay > 31 || endDay < 1 || endDay > 31) return null;
  const year = explicitYear ?? inferYear(now, month, startDay);
  if (year === null) return null;
  if (!isValidCalendarDate(year, month, startDay) || !isValidCalendarDate(year, month, endDay)) return null;
  return {
    startIso: zagrebIso(year, month, startDay, 0, 0),
    endIso: zagrebIso(year, month, endDay, 23, 59),
    precision: 'range',
  };
}

function buildDayOrTime(now: Date, year: number, month: number, day: number, span: TimeSpan | null): HrDate | null {
  if (!isValidCalendarDate(year, month, day)) return null;
  if (!span) {
    return { startIso: zagrebIso(year, month, day, 0, 0), precision: 'day' };
  }
  const startIso = zagrebIso(year, month, day, span.start.hour, span.start.minute);
  if (!span.end) return { startIso, precision: 'time' };
  return { startIso, endIso: zagrebIso(year, month, day, span.end.hour, span.end.minute), precision: 'time' };
}

/**
 * Parses Croatian prose against a reference instant, in Europe/Zagreb.
 * Returns null when the text does not carry a date. Never guesses a year.
 *
 * Tries, in order: a day range ("od 22. do 29. rujna"), a dual-day range
 * ("9. i 10. rujna"), a single anchor date -- numeric ("11.9.2026.") or named
 * ("11. rujna 2026.") -- with an optional attached time, and finally a
 * relative day ("sutra"/"danas") with a time. The first pattern that matches
 * wins; `null` means none of them found a date at all.
 */
export function parseHrDate(text: string, now: Date): HrDate | null {
  const range = RANGE_PATTERN.exec(text);
  if (range) {
    const month = MONTHS[range[3].toLowerCase()];
    const explicitYear = range[4] ? Number(range[4]) : undefined;
    const result = buildRange(now, Number(range[1]), Number(range[2]), month, explicitYear);
    if (result) return result;
  }

  const dualDay = DUAL_DAY_PATTERN.exec(text);
  if (dualDay) {
    const month = MONTHS[dualDay[3].toLowerCase()];
    const explicitYear = dualDay[4] ? Number(dualDay[4]) : undefined;
    const result = buildRange(now, Number(dualDay[1]), Number(dualDay[2]), month, explicitYear);
    if (result) return result;
  }

  const anchors = [...text.matchAll(ANCHOR_PATTERN)];
  if (anchors.length > 0) {
    const anchor = anchors[0];
    const isNumeric = anchor[1] !== undefined;
    const day = Number(isNumeric ? anchor[1] : anchor[4]);
    const month = isNumeric ? Number(anchor[2]) : MONTHS[anchor[5].toLowerCase()];
    const explicitYearText = isNumeric ? anchor[3] : anchor[6];
    const year = explicitYearText ? Number(explicitYearText) : inferYear(now, month, day);
    if (year !== null && Number.isInteger(month) && month >= 1 && month <= 12) {
      const boundary = anchors.length > 1 ? anchors[1].index! : text.length;
      const window = text.slice(anchor.index! + anchor[0].length, boundary);
      const result = buildDayOrTime(now, year, month, day, findTimeSpan(window));
      if (result) return result;
    }
  }

  const relative = RELATIVE_PATTERN.exec(text);
  if (relative) {
    const today = zagrebCalendarDate(now);
    const target = addCalendarDays(today, RELATIVE_OFFSET[relative[1].toLowerCase()]);
    const window = text.slice(relative.index! + relative[0].length);
    const span = findTimeSpan(window);
    return buildDayOrTime(now, target.year, target.month, target.day, span);
  }

  return null;
}
