import { describe, expect, it } from 'vitest';
import { countdown, minutesSince, parseIso, zagrebDateTime, zagrebDayKey, zagrebTime, zagrebWeekdayDate } from '../../app/src/format';

describe('Europe/Zagreb formatting in the browser', () => {
  it('formats HH:MM on the 24-hour clock, in summer and winter time', () => {
    expect(zagrebTime('2026-09-11T12:32:00Z')).toBe('14:32'); // CEST, UTC+2
    expect(zagrebTime('2026-01-15T07:05:00Z')).toBe('08:05'); // CET, UTC+1
    expect(zagrebTime('2026-09-11T22:30:00Z')).toBe('00:30'); // next day in Zagreb
  });
  it('formats day and month in Croatian order without a year', () => {
    expect(zagrebDateTime('2026-09-11T12:32:00Z')).toBe('11. 9. 14:32');
    expect(zagrebDateTime(Date.parse('2026-01-15T07:05:00Z'))).toBe('15. 1. 08:05');
  });
  it('returns an empty string rather than "Invalid Date"', () => {
    expect(zagrebTime(undefined)).toBe('');
    expect(zagrebTime('nije datum')).toBe('');
    expect(zagrebDateTime(null)).toBe('');
  });
  it('parseIso keeps the instant and rejects garbage', () => {
    expect(parseIso('2026-09-11T14:32:00+02:00')?.toISOString()).toBe('2026-09-11T12:32:00.000Z');
    expect(parseIso('')).toBeNull();
  });
  it('minutesSince counts whole minutes of age', () => {
    const now = Date.parse('2026-09-11T12:32:00Z');
    expect(minutesSince('2026-09-11T12:30:30Z', now)).toBe(1);
    expect(minutesSince('2026-09-11T11:32:00Z', now)).toBe(60);
    expect(minutesSince('bez datuma', now)).toBeNull();
  });
  it('countdown is M:SS and never negative', () => {
    expect(countdown(600)).toBe('10:00');
    expect(countdown(65)).toBe('1:05');
    expect(countdown(-3)).toBe('0:00');
  });
  it('zagrebWeekdayDate names the weekday and spells the full Croatian date (R-O2)', () => {
    expect(zagrebWeekdayDate('2026-09-11T12:32:00Z')).toBe('pet 11. 9. 2026.');
    expect(zagrebWeekdayDate(Date.parse('2026-01-15T07:05:00Z'))).toBe('čet 15. 1. 2026.');
    expect(zagrebWeekdayDate(undefined)).toBe('');
  });
  it('zagrebDayKey is a stable YYYY-MM-DD grouping key in Zagreb local time, the en-CA trick worker/feed/time.ts also uses', () => {
    expect(zagrebDayKey('2026-09-11T12:32:00Z')).toBe('2026-09-11');
    expect(zagrebDayKey('2026-09-11T22:30:00Z')).toBe('2026-09-12'); // next day in Zagreb (CEST)
    expect(zagrebDayKey(null)).toBe('');
  });
});
