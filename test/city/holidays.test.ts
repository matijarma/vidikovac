// Croatia's public holidays (shared/city/holidays.ts, brief §5.2(e)): the computus and the NN 110/19 list, checked
// against the Nager.Date lists of 2026 and 2027 (https://date.nager.at/api/v3/PublicHolidays/<year>/HR, 30 Sep 2026).
import { describe, expect, it } from 'vitest';
import { easterSunday, isPublicHoliday, isSchoolHoliday } from '../../shared/city/holidays';

const NAGER: Readonly<Record<number, readonly string[]>> = {
  2026: ['01-01', '01-06', '04-05', '04-06', '05-01', '05-30', '06-04', '06-22', '08-05', '08-15', '11-01', '11-18', '12-25', '12-26'],
  2027: ['01-01', '01-06', '03-28', '03-29', '05-01', '05-27', '05-30', '06-22', '08-05', '08-15', '11-01', '11-18', '12-25', '12-26'],
};

describe('public holidays (R0)', () => {
  it('computes Easter Sunday', () => {
    expect(easterSunday(2024)).toEqual({ y: 2024, m: 3, d: 31 });
    expect(easterSunday(2025)).toEqual({ y: 2025, m: 4, d: 20 });
    expect(easterSunday(2026)).toEqual({ y: 2026, m: 4, d: 5 });
    expect(easterSunday(2027)).toEqual({ y: 2027, m: 3, d: 28 });
    expect(easterSunday(2038)).toEqual({ y: 2038, m: 4, d: 25 });
  });

  it('matches the Nager.Date lists of 2026 and 2027, 14 days each', () => {
    for (const [year, days] of Object.entries(NAGER)) {
      for (const day of days) expect(isPublicHoliday(`${year}-${day}`), `${year}-${day}`).toBe(true);
      const found: string[] = [];
      for (let t = Date.UTC(Number(year), 0, 1); new Date(t).getUTCFullYear() === Number(year); t += 86_400_000) {
        const key = new Date(t).toISOString().slice(0, 10);
        if (isPublicHoliday(key)) found.push(key.slice(5));
      }
      expect(found).toEqual([...days]);
    }
  });

  it('says no to ordinary days and to anything that is not a day key', () => {
    for (const key of ['2027-04-06', '2026-10-01', '2026-12-24', '2026-02-29', '', '2026-11-1']) {
      expect(isPublicHoliday(key), key).toBe(false);
    }
  });
});

// R3: the school calendar of NN 58/2026 (read 30 September 2026).
describe('school holidays 2026/27 (R3)', () => {
  it.each([
    ['2026-09-07', false], ['2026-12-23', false], ['2026-12-24', true], ['2027-01-05', true], ['2027-01-06', true],
    ['2027-01-07', false], ['2027-02-22', true], ['2027-02-26', true], ['2027-03-01', false], ['2027-03-25', true],
    ['2027-04-02', true], ['2027-04-05', false], ['2027-06-15', false], ['2027-06-16', true], ['2027-08-31', true],
    // A public holiday on a Sunday and one on a Wednesday; a Saturday is not a holiday.
    ['2026-11-01', true], ['2026-11-18', true], ['2026-10-03', false],
    // Outside the school year the table has no decision.
    ['2026-09-01', false], ['2027-09-06', false],
  ] as const)('%s is %s', (day, expected) => {
    expect(isSchoolHoliday(day)).toBe(expected);
  });

  it('refuses what is not a day key', () => {
    expect(isSchoolHoliday('2026-12-24T10:00')).toBe(false);
    expect(isSchoolHoliday('')).toBe(false);
  });
});
