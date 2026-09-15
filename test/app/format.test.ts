import { describe, expect, it } from 'vitest';
import { countdown, minutesSince, parseIso, zagrebDateTime, zagrebDayKey, zagrebDayMonth, zagrebHour, zagrebTime, zagrebWeekdayDate, zagrebWeekdayShort } from '../../app/src/format';

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

// The two helpers the time band (plan A.1, A.3) reads its columns from: the
// Zagreb wall-clock hour decides day or night mode and the service day, and
// the short weekday date is the head of the sutra and tjedan columns, where
// the year would not fit a 1fr head at 24 px.
describe('zagrebHour', () => {
  it('is the wall-clock hour in Zagreb, 0 to 23, in summer and winter time', () => {
    expect(zagrebHour('2026-09-11T12:32:00Z')).toBe(14); // CEST
    expect(zagrebHour('2026-01-15T23:30:00Z')).toBe(0); // CET: 00:30 the next day, never 24
    expect(zagrebHour(Date.parse('2026-01-15T07:05:00Z'))).toBe(8);
    expect(zagrebHour('2026-09-11T01:59:00Z')).toBe(3); // the last hour before the 04:00 service day
  });
  it('is null when there is nothing to read', () => {
    expect(zagrebHour(undefined)).toBeNull();
    expect(zagrebHour('nije datum')).toBeNull();
    expect(zagrebHour('')).toBeNull();
  });
});

describe('zagrebDayMonth', () => {
  it('is the Croatian day and month alone, no weekday, no year, in Zagreb time', () => {
    expect(zagrebDayMonth('2026-09-10T00:00:00Z')).toBe('10. 9.');
    expect(zagrebDayMonth('2026-09-11T22:30:00Z')).toBe('12. 9.');
    expect(zagrebDayMonth(Date.parse('2026-01-05T07:05:00Z'))).toBe('5. 1.');
  });
  it('returns an empty string rather than "Invalid Date"', () => {
    expect(zagrebDayMonth(undefined)).toBe('');
    expect(zagrebDayMonth('nije datum')).toBe('');
  });
});

describe('zagrebWeekdayShort', () => {
  it('is the short weekday and the Croatian day-month, no year', () => {
    expect(zagrebWeekdayShort('2026-09-15T10:00:00Z')).toBe('uto 15. 9.');
    expect(zagrebWeekdayShort('2026-09-11T12:32:00Z')).toBe('pet 11. 9.');
    expect(zagrebWeekdayShort(Date.parse('2026-01-15T07:05:00Z'))).toBe('čet 15. 1.');
    expect(zagrebWeekdayShort('2026-09-11T22:30:00Z')).toBe('sub 12. 9.'); // next day in Zagreb
  });
  it('returns an empty string rather than "Invalid Date"', () => {
    expect(zagrebWeekdayShort(undefined)).toBe('');
    expect(zagrebWeekdayShort('nije datum')).toBe('');
  });
});
