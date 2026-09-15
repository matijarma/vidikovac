// Europe/Zagreb wall-clock formatting for the browser. The Worker keeps its own
// copy in worker/open/time.ts (Area D owns that file and the app must not reach
// across the ownership line); both produce the same strings on purpose.
export const ZAGREB_TZ = 'Europe/Zagreb';

const PARTS = new Intl.DateTimeFormat('hr-HR', {
  timeZone: ZAGREB_TZ,
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export type TimeInput = string | number | Date | null | undefined;

export function parseIso(value: TimeInput): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function parts(date: Date): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of PARTS.formatToParts(date)) {
    if (part.type !== 'literal') out[part.type] = part.value;
  }
  return out;
}

/** 'HH:MM' in Zagreb local time; '' when there is nothing to format. */
export function zagrebTime(value: TimeInput): string {
  const date = parseIso(value);
  if (!date) return '';
  const p = parts(date);
  return `${(p.hour ?? '').padStart(2, '0')}:${(p.minute ?? '').padStart(2, '0')}`;
}

/** '7. 9.': the Croatian day and month alone, for a context line where a weekday would only take the room. */
export function zagrebDayMonth(value: TimeInput): string {
  const date = parseIso(value);
  if (!date) return '';
  const p = parts(date);
  return `${Number(p.day)}. ${Number(p.month)}.`;
}

/** The wall-clock hour in Zagreb, 0 to 23; null when there is nothing to read.
 *  The time band reads its service day (04:00) and its day or night mode from it. */
export function zagrebHour(value: TimeInput): number | null {
  const date = parseIso(value);
  if (!date) return null;
  return Number(parts(date).hour);
}

/** '11. 9. 14:32' — Croatian day-month order, no year (pages state the year once). */
export function zagrebDateTime(value: TimeInput): string {
  const date = parseIso(value);
  if (!date) return '';
  const p = parts(date);
  return `${Number(p.day)}. ${Number(p.month)}. ${zagrebTime(date)}`;
}

/** '11. 9. 2026. 15:00' — the with-year form R-62's attribution fill needs
 *  (zagrebDateTime above deliberately omits the year: pages state it once,
 *  but a citation embedded in a template has to stand on its own). */
export function zagrebDateTimeWithYear(value: TimeInput): string {
  const date = parseIso(value);
  if (!date) return '';
  const p = parts(date);
  return `${Number(p.day)}. ${Number(p.month)}. ${p.year}. ${zagrebTime(date)}`;
}

const WEEKDAY_PARTS = new Intl.DateTimeFormat('hr-HR', {
  timeZone: ZAGREB_TZ,
  weekday: 'short',
  day: 'numeric',
  month: 'numeric',
  year: 'numeric',
});

// en-CA's date order is already ISO's (year-month-day), so formatting through
// that locale is a documented trick for "YYYY-MM-DD" without hand-padding —
// the same one worker/feed/time.ts uses (ZAGREB_PARTS there) to read Zagreb
// wall-clock parts back out of a formatter.
const DAY_KEY_PARTS = new Intl.DateTimeFormat('en-CA', {
  timeZone: ZAGREB_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** 'pet 11. 9. 2026.' — short weekday + the Croatian day-month-year order
 *  (with year, unlike zagrebDateTime): the kiosk header's date line, paired
 *  with a separate clock that already states the time. */
export function zagrebWeekdayDate(value: TimeInput): string {
  const date = parseIso(value);
  if (!date) return '';
  const p: Record<string, string> = {};
  for (const part of WEEKDAY_PARTS.formatToParts(date)) {
    if (part.type !== 'literal') p[part.type] = part.value;
  }
  return `${p.weekday} ${Number(p.day)}. ${Number(p.month)}. ${p.year}.`;
}

const WEEKDAY_SHORT_PARTS = new Intl.DateTimeFormat('hr-HR', {
  timeZone: ZAGREB_TZ,
  weekday: 'short',
  day: 'numeric',
  month: 'numeric',
});

/** 'uto 15. 9.': the short weekday and the Croatian day-month, no year. The
 *  head of a time-band column (sutra, tjedan), where zagrebWeekdayDate's year
 *  would not fit a 1fr head at 24 px; the band reaches seven days, so the
 *  year is never in doubt. */
export function zagrebWeekdayShort(value: TimeInput): string {
  const date = parseIso(value);
  if (!date) return '';
  const p: Record<string, string> = {};
  for (const part of WEEKDAY_SHORT_PARTS.formatToParts(date)) {
    if (part.type !== 'literal') p[part.type] = part.value;
  }
  return `${p.weekday} ${Number(p.day)}. ${Number(p.month)}.`;
}

/** 'YYYY-MM-DD' in Zagreb local time (R-O2): a stable per-day grouping key,
 *  not a display string — E's events module groups by this. */
export function zagrebDayKey(value: TimeInput): string {
  const date = parseIso(value);
  return date ? DAY_KEY_PARTS.format(date) : '';
}

/** Whole minutes of age; null when the instant is unparseable. */
export function minutesSince(value: TimeInput, now: number): number | null {
  const date = parseIso(value);
  return date ? Math.floor((now - date.getTime()) / 60_000) : null;
}

/** 'M:SS' for the session ring. */
export function countdown(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
