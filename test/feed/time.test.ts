import { describe, expect, it } from 'vitest';
import { ZAGREB_TZ, isoOrUndefined, zagrebIso, zagrebOffsetMinutes } from '../../worker/feed/time';

describe('Europe/Zagreb wall clock to instant', () => {
  it('knows summer and winter offsets', () => {
    expect(ZAGREB_TZ).toBe('Europe/Zagreb');
    expect(zagrebOffsetMinutes(new Date('2026-09-11T10:00:00Z'))).toBe(120);
    expect(zagrebOffsetMinutes(new Date('2026-01-15T10:00:00Z'))).toBe(60);
  });

  it('turns DHMZ term hours into instants', () => {
    // Termin 12 on 11 Sept 2026 is 12:00 CEST = 10:00 UTC.
    expect(zagrebIso(2026, 9, 11, 12)).toBe('2026-09-11T10:00:00.000Z');
    // Midnight of a January day is 23:00 UTC of the day before (CET).
    expect(zagrebIso(2026, 1, 15)).toBe('2026-01-14T23:00:00.000Z');
    // The spring switch: 03:00 local on 29 March 2026 is 01:00 UTC.
    expect(zagrebIso(2026, 3, 29, 3)).toBe('2026-03-29T01:00:00.000Z');
  });

  it('isoOrUndefined normalises whatever the sources publish', () => {
    expect(isoOrUndefined(undefined)).toBeUndefined();
    expect(isoOrUndefined('')).toBeUndefined();
    expect(isoOrUndefined('nije datum')).toBeUndefined();
    expect(isoOrUndefined('2026-09-11T05:00:00+02:00')).toBe('2026-09-11T03:00:00.000Z');
    expect(isoOrUndefined('Fri, 11 Sep 2026 09:25:44 +0000')).toBe('2026-09-11T09:25:44.000Z');
    expect(isoOrUndefined('2026-09-09T17:11:21.79Z')).toBe('2026-09-09T17:11:21.790Z');
  });
});
