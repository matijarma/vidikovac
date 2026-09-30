/**
 * Croatia's public holidays (docs/reveal-2026-10.md §5.2(e)): Zakon o blagdanima, spomendanima i neradnim danima,
 * NN 110/19, članak 1. stavak 1. (https://narodne-novine.nn.hr/clanci/sluzbeni/2019_11_110_2212.html): eleven fixed
 * days, Easter Sunday, Easter Monday and Tijelovo (Easter + 60). Oracle for the tests:
 * https://date.nager.at/api/v3/PublicHolidays/2027/HR (read 30 September 2026). Pure; day keys are Zagreb days.
 */

/** The fixed holidays, 'MM-DD'. */
export const FIXED_HOLIDAYS: readonly string[] = Object.freeze([
  '01-01', '01-06', '05-01', '05-30', '06-22', '08-05', '08-15', '11-01', '11-18', '12-25', '12-26',
]);

/** Easter Sunday of a Gregorian year (the anonymous computus of Meeus, Jones and Butcher; integer arithmetic). */
export function easterSunday(year: number): { y: number; m: number; d: number } {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { y: year, m: month, d: day };
}

function dayKeyAfter(e: { y: number; m: number; d: number }, days: number): string {
  return new Date(Date.UTC(e.y, e.m - 1, e.d + days)).toISOString().slice(0, 10);
}

/** True on a Croatian public holiday; `dayKey` is a Zagreb day, 'YYYY-MM-DD'; anything else is false. */
export function isPublicHoliday(dayKey: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) return false;
  const year = Number(dayKey.slice(0, 4));
  const [, mo, da] = dayKey.split('-').map(Number);
  const probe = new Date(Date.UTC(year, mo - 1, da));
  if (probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== da) return false;
  if (FIXED_HOLIDAYS.includes(dayKey.slice(5))) return true;
  const easter = easterSunday(year);
  return [0, 1, 60].some((offset) => dayKeyAfter(easter, offset) === dayKey);
}
