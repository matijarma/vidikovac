import { describe, expect, it } from 'vitest';
import { isDaylight, sunTimes, ZAGREB } from '../../app/src/ui/solar';

function utcMinutes(d: Date): number {
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}
const at = (h: number, m: number): number => h * 60 + m;

describe('sunTimes for Zagreb (45.815 N, 15.98 E)', () => {
  it('11 September 2026: sunrise about 04:25 UTC, sunset about 17:18 UTC (06:25 / 19:18 CEST)', () => {
    const t = sunTimes(new Date('2026-09-11T12:00:00Z'));
    expect(t.polar).toBe('none');
    expect(utcMinutes(t.sunrise)).toBeGreaterThanOrEqual(at(4, 10));
    expect(utcMinutes(t.sunrise)).toBeLessThanOrEqual(at(4, 45));
    expect(utcMinutes(t.sunset)).toBeGreaterThanOrEqual(at(17, 0));
    expect(utcMinutes(t.sunset)).toBeLessThanOrEqual(at(17, 35));
  });
  it('21 June 2026: sunrise about 03:06 UTC, sunset about 18:50 UTC', () => {
    const t = sunTimes(new Date('2026-06-21T12:00:00Z'));
    expect(utcMinutes(t.sunrise)).toBeGreaterThanOrEqual(at(2, 50));
    expect(utcMinutes(t.sunrise)).toBeLessThanOrEqual(at(3, 20));
    expect(utcMinutes(t.sunset)).toBeGreaterThanOrEqual(at(18, 35));
    expect(utcMinutes(t.sunset)).toBeLessThanOrEqual(at(19, 5));
  });
  it('21 December 2026: sunrise about 06:35 UTC, sunset about 15:19 UTC', () => {
    const t = sunTimes(new Date('2026-12-21T12:00:00Z'));
    expect(utcMinutes(t.sunrise)).toBeGreaterThanOrEqual(at(6, 20));
    expect(utcMinutes(t.sunrise)).toBeLessThanOrEqual(at(6, 50));
    expect(utcMinutes(t.sunset)).toBeGreaterThanOrEqual(at(15, 5));
    expect(utcMinutes(t.sunset)).toBeLessThanOrEqual(at(15, 35));
  });
  it('returns times on the same UTC date that was asked for', () => {
    const t = sunTimes(new Date('2026-09-11T23:30:00Z'));
    expect(t.sunrise.toISOString().slice(0, 10)).toBe('2026-09-11');
    expect(t.sunset.toISOString().slice(0, 10)).toBe('2026-09-11');
  });
  it('defaults to Zagreb', () => {
    const a = sunTimes(new Date('2026-09-11T12:00:00Z'));
    const b = sunTimes(new Date('2026-09-11T12:00:00Z'), ZAGREB.lat, ZAGREB.lon);
    expect(a.sunrise.getTime()).toBe(b.sunrise.getTime());
  });
});

describe('isDaylight', () => {
  it('is light at noon and dark before dawn and after dusk', () => {
    expect(isDaylight(new Date('2026-09-11T10:00:00Z'))).toBe(true);
    expect(isDaylight(new Date('2026-09-11T02:00:00Z'))).toBe(false);
    expect(isDaylight(new Date('2026-09-11T20:00:00Z'))).toBe(false);
  });
  it('handles polar day and night instead of producing NaN', () => {
    const tromso = { lat: 69.65, lon: 18.96 };
    expect(sunTimes(new Date('2026-06-21T00:00:00Z'), tromso.lat, tromso.lon).polar).toBe('day');
    expect(isDaylight(new Date('2026-06-21T00:30:00Z'), tromso.lat, tromso.lon)).toBe(true);
    expect(sunTimes(new Date('2026-12-21T12:00:00Z'), tromso.lat, tromso.lon).polar).toBe('night');
    expect(isDaylight(new Date('2026-12-21T12:00:00Z'), tromso.lat, tromso.lon)).toBe(false);
  });
});
