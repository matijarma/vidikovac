// Number and time formatting for a screen read from several steps away:
// Croatian decimal commas, tabular figures, Zagreb wall-clock times. Pure.
import { zagrebDateTime, zagrebDayKey, zagrebTime, zagrebWeekdayDate } from '../format';

/** '12,8' in hr, '12.8' in en; whole numbers stay whole ('21') and nothing is
 *  grouped ('1016 hPa'); amounts of money group through fmtAmount instead. */
export function fmtNumber(locale: string, value: number, maxDigits = 1): string {
  try {
    return new Intl.NumberFormat(locale.startsWith('en') ? 'en-GB' : 'hr-HR', { maximumFractionDigits: maxDigits, useGrouping: false }).format(value);
  } catch {
    return String(Math.round(value * 10 ** maxDigits) / 10 ** maxDigits);
  }
}

/** '12,8 °C' -- the unit spaced the way DHMZ prints it. */
export function fmtTemp(locale: string, value: number): string {
  return `${fmtNumber(locale, value, 1)} °C`;
}

/** Thousands-grouped whole euros for the komunalne register amounts. */
export function fmtAmount(locale: string, value: number): string {
  try {
    return new Intl.NumberFormat(locale.startsWith('en') ? 'en-GB' : 'hr-HR', { maximumFractionDigits: 0 }).format(value);
  } catch {
    return String(Math.round(value));
  }
}

/** 'HH:MM' Zagreb time, '' for nothing. */
export const clock = (value: string | number | Date | null | undefined): string => zagrebTime(value);

/** 'pet 11. 9. 2026.' */
export const weekdayDate = (value: number): string => zagrebWeekdayDate(value);

/** '11. 9. 14:32' -- day-month order, no year. */
export const dayTime = (value: string | number | Date | null | undefined): string => zagrebDateTime(value);

/** '11. 9.' -- day and month only, for an agenda line that already names the weekday. */
export function dayMonth(value: string | number | Date | null | undefined): string {
  const full = zagrebDateTime(value);
  const cut = full.lastIndexOf(' ');
  return cut === -1 ? full : full.slice(0, cut);
}

const WEEKDAY = new Intl.DateTimeFormat('hr-HR', { timeZone: 'Europe/Zagreb', weekday: 'short' });
const WEEKDAY_EN = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Zagreb', weekday: 'short' });

/** 'čet 17. 9.' / 'Thu 17. 9.' */
export function weekdayDayMonth(locale: string, value: string | number | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const wd = (locale.startsWith('en') ? WEEKDAY_EN : WEEKDAY).format(date);
  return `${wd} ${dayMonth(date)}`;
}

/** Same Zagreb calendar day. */
export function sameZagrebDay(a: string | number | Date, b: string | number | Date): boolean {
  const ka = zagrebDayKey(a);
  return ka !== '' && ka === zagrebDayKey(b);
}

/** The Zagreb calendar day `days` after `now` (a coarse step, enough to test "tomorrow"). */
export function zagrebDayAfter(now: number, days: number): string {
  return zagrebDayKey(now + days * 86_400_000);
}

export { zagrebDayKey as dayKey };

/** 'M:SS' for a retry countdown. */
export function mmss(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Distance in metres, rounded the way a person reads it: '350 m', '1,2 km'. */
export function fmtDistance(locale: string, metres: number): string {
  if (!Number.isFinite(metres)) return '';
  if (metres < 950) return `${Math.max(10, Math.round(metres / 10) * 10)} m`;
  return `${fmtNumber(locale, metres / 1000, 1)} km`;
}
