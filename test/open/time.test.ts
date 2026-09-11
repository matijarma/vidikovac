import { describe, expect, it } from 'vitest';
import {
  formatZagrebDateTime,
  formatZagrebTime,
  parseIso,
  zagrebDay,
} from '../../worker/open/time';

describe('Europe/Zagreb formatting', () => {
  // 2026-09-11T22:30Z is 12 Sept 00:30 in Zagreb (CEST, UTC+2): the day flips.
  const lateEvening = new Date('2026-09-11T22:30:00Z');

  it('zagrebDay uses the Zagreb calendar day, not UTC', () => {
    expect(zagrebDay(lateEvening)).toBe('2026-09-12');
    expect(zagrebDay(new Date('2026-01-15T23:30:00Z'))).toBe('2026-01-16'); // CET, UTC+1
  });

  it('formats time as HH:mm in 24-hour clock', () => {
    expect(formatZagrebTime(lateEvening)).toBe('00:30');
    expect(formatZagrebTime(new Date('2026-09-11T08:05:00Z'))).toBe('10:05');
  });

  it('formats date and time in Croatian order without a year', () => {
    expect(formatZagrebDateTime(new Date('2026-09-11T03:00:00Z'))).toBe('11. 9. 05:00');
  });

  it('parseIso returns null for missing or garbage input', () => {
    expect(parseIso(undefined)).toBeNull();
    expect(parseIso('nije datum')).toBeNull();
    expect(parseIso('2026-09-11T05:00:00+02:00')?.toISOString()).toBe('2026-09-11T03:00:00.000Z');
  });
});
