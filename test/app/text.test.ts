import { describe, expect, it } from 'vitest';
import type { FeedItem } from '../../worker/feed/schema';
import { createDefaultI18n } from '../../app/src/i18n/create-default-i18n';
import { bearingDeg, compassWord, conditionText, coversDay, dayLabel, dayOffset, distanceKm, eventWhen, relativeTime, windBearing, ZAGREB_LON_LAT } from '../../app/src/experience/text';

const NOW = Date.parse('2026-09-11T12:32:00Z'); // Friday 14:32 in Zagreb
const hr = createDefaultI18n('hr');
const en = createDefaultI18n('en');
const event = (over: Partial<FeedItem>): FeedItem => ({ id: 'e', module: 'dogadanja', kind: 'event', tier: 'session', title: 'E', dateBasis: 'event', ...over });

describe('days and relative time', () => {
  it('counts whole days between Zagreb day keys', () => {
    expect(dayOffset('2026-09-12', '2026-09-11')).toBe(1);
    expect(dayOffset('2026-09-10', '2026-09-11')).toBe(-1);
    expect(dayOffset('x', '2026-09-11')).toBeNull();
  });
  it('says today, tomorrow and yesterday in the active language, else the weekday date', () => {
    expect(dayLabel(hr, '2026-09-11T20:00:00Z', NOW)).toBe('danas');
    expect(dayLabel(en, '2026-09-12T05:00:00Z', NOW)).toBe('tomorrow');
    expect(dayLabel(hr, '2026-09-10T20:00:00Z', NOW)).toBe('jučer');
    expect(dayLabel(hr, '2026-09-14T09:00:00Z', NOW)).toMatch(/14\. 9\. 2026\./);
  });
  it('relative time never invents a time for a missing date', () => {
    expect(relativeTime(hr, undefined, NOW)).toBe('vrijeme nepoznato');
    expect(relativeTime(hr, new Date(NOW - 5 * 60_000).toISOString(), NOW)).toBe('prije 5 minuta');
    expect(relativeTime(en, new Date(NOW - 2 * 3_600_000).toISOString(), NOW)).toBe('2 hours ago');
    expect(relativeTime(hr, '2026-09-10T10:00:00Z', NOW)).toBe('jučer u 12:00');
  });
});

describe('eventWhen', () => {
  it('reads a date-only or day-precision entry as all day, never midnight', () => {
    expect(eventWhen(hr, event({ at: '2026-09-11T00:00:00+02:00', data: { precision: 'day' } }), NOW)).toBe('danas, cijeli dan');
    expect(eventWhen(en, event({ at: '2026-09-12' }), NOW)).toBe('tomorrow, all day');
  });
  it('keeps a timed start and a multi-day range', () => {
    expect(eventWhen(hr, event({ at: '2026-09-12T18:00:00+02:00', data: { precision: 'time' } }), NOW)).toBe('sutra 18:00');
    expect(eventWhen(hr, event({ at: '2026-09-10T09:00:00+02:00', until: '2026-10-01T18:00:00+02:00', data: { precision: 'time' } }), NOW)).toMatch(/^jučer 09:00 – .*1\. 10\. 2026\.$/);
  });
  it('says unknown for a notice without a date basis', () => {
    expect(eventWhen(hr, event({ at: undefined, dateBasis: 'unknown' }), NOW)).toBe('vrijeme nepoznato');
    expect(coversDay(event({ at: undefined, dateBasis: 'unknown' }), NOW)).toBe(false);
  });
});

describe('wind and conditions', () => {
  it('reads DHMZ English points and Croatian points, and never calls a moving wind calm', () => {
    expect(windBearing('NW')).toBe(315);
    expect(windBearing('SZ')).toBe(315);
    expect(windBearing('S')).toBe(180);
    expect(windBearing('J')).toBe(180);
    expect(windBearing('C')).toBeNull();
    expect(windBearing('')).toBeNull();
    expect(compassWord(hr, 315)).toBe('sjeverozapad');
    expect(compassWord(en, 90)).toBe('east');
  });
  it('drops a lone dash as a condition phrase', () => {
    expect(conditionText('-')).toBe('');
    expect(conditionText(' vedro ')).toBe('vedro');
  });
});

describe('distance and bearing', () => {
  it('measures Zagreb to Split at roughly 258 km, roughly south-south-east', () => {
    const km = distanceKm(ZAGREB_LON_LAT[0], ZAGREB_LON_LAT[1], 16.44, 43.51);
    expect(Math.round(km)).toBeGreaterThan(250);
    expect(Math.round(km)).toBeLessThan(265);
    const bearing = bearingDeg(ZAGREB_LON_LAT[0], ZAGREB_LON_LAT[1], 16.44, 43.51);
    expect(bearing).toBeGreaterThan(160);
    expect(bearing).toBeLessThan(180);
  });
});
