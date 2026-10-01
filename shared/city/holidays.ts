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

/**
 * The school year 2026/27 (R3): Odluka o početku i završetku nastavne godine, broju radnih dana i trajanju odmora
 * učenika osnovnih i srednjih škola za školsku godinu 2026./2027., NN 58/2026
 * (https://narodne-novine.nn.hr/clanci/sluzbeni/2026_06_58_724.html, read 30 September 2026). Lessons run from 7 Sep to
 * 23 Dec 2026 and from 7 Jan to 15 Jun 2027; the breaks are below, every day of each inclusive. 6 Jan 2027 lies between
 * the winter break and the first school day; summer runs from 16 Jun to the end of the school year, 31 Aug 2027. The next
 * decision is published in June 2027 and is added here then; outside this school year the table decides nothing.
 */
const SCHOOL_YEAR: { first: string; last: string } = { first: '2026-09-07', last: '2027-08-31' };
const SCHOOL_BREAKS: readonly (readonly [string, string])[] = [
  ['2026-12-24', '2027-01-06'], // winter break, 24 Dec to 5 Jan, and 6 Jan before the first school day
  ['2027-02-22', '2027-02-26'], // winter break, second part
  ['2027-03-25', '2027-04-02'], // spring break
  ['2027-06-16', '2027-08-31'], // summer
];

/**
 * True on a day without lessons by the school calendar: inside a break, or a public holiday on a day of the school year.
 * A weekend is not a holiday (false); outside 2026-09-07..2027-08-31 the table has no decision (false).
 */
export function isSchoolHoliday(dayKey: string): boolean {   // R3
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey) || dayKey < SCHOOL_YEAR.first || dayKey > SCHOOL_YEAR.last) return false;
  if (SCHOOL_BREAKS.some(([first, last]) => dayKey >= first && dayKey <= last)) return true;
  return isPublicHoliday(dayKey);
}
