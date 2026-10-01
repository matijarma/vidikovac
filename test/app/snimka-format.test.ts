// The clock words of /snimka/ are fixed UTC+2 arithmetic; Intl for
// Europe/Zagreb proves the offset holds over the window and the comparison
// day, so the labels agree with the real zone everywhere they are used.
import { describe, expect, it } from 'vitest';
import { SNIMKA_COMPARISON, SNIMKA_WINDOW } from '../../shared/snimka';
import { WEEKDAYS, duration, formatZagrebLocal, parseZagrebLocal, zagrebClock, zagrebDateTime, zagrebDay, zagrebMidnight, zagrebTimeOfDay } from '../../app/src/snimka/format';
import { SN } from '../../app/src/snimka/strings';

const MONDAY_0745 = Date.UTC(2026, 8, 28, 5, 45);
const ZAGREB = new Intl.DateTimeFormat('hr-HR', { timeZone: 'Europe/Zagreb', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const OFFSET = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Zagreb', timeZoneName: 'longOffset' });
const offsetOf = (ms: number): string => OFFSET.formatToParts(new Date(ms)).find((p) => p.type === 'timeZoneName')!.value;

describe('Zagreb is UTC+2 for the whole window and the comparison day', () => {
  it('Intl agrees with the fixed offset at every hour of the window and of 24 September', () => {
    for (let sec = SNIMKA_WINDOW.fromSec; sec <= SNIMKA_WINDOW.toSec; sec += 3600) {
      expect(offsetOf(sec * 1000), new Date(sec * 1000).toISOString()).toBe('GMT+02:00');
      expect(zagrebClock(sec * 1000)).toBe(ZAGREB.format(new Date(sec * 1000)));
    }
    for (let sec = SNIMKA_COMPARISON.fromSec; sec < SNIMKA_COMPARISON.fromSec + 86_400; sec += 3600) {
      expect(offsetOf(sec * 1000)).toBe('GMT+02:00');
      expect(zagrebClock(sec * 1000 + 59_000)).toBe(ZAGREB.format(new Date(sec * 1000 + 59_000)));
    }
  });
});

describe('labels', () => {
  it('zagrebClock, zagrebDay and zagrebDateTime', () => {
    expect(zagrebClock(MONDAY_0745)).toBe('07:45');
    expect(zagrebDay(MONDAY_0745)).toBe('pon 28. 9.');
    expect(zagrebDateTime(MONDAY_0745)).toBe('pon 28. 9. u 07:45');
    expect(zagrebDateTime(SNIMKA_WINDOW.fromSec * 1000)).toBe('ned 27. 9. u 20:00');
    expect(zagrebDateTime(SNIMKA_WINDOW.toSec * 1000)).toBe('čet 1. 10. u 08:00');
    expect(zagrebDateTime(SNIMKA_COMPARISON.fromSec * 1000)).toBe('čet 24. 9. u 00:00');
    expect(zagrebDateTime(Date.UTC(2026, 8, 29, 21, 17))).toBe('uto 29. 9. u 23:17');
    expect(zagrebDateTime(Date.UTC(2026, 8, 30, 18, 20))).toBe('sri 30. 9. u 20:20');
    expect(zagrebClock(Date.UTC(2026, 8, 30, 22, 5))).toBe('00:05');
    expect(WEEKDAYS).toEqual(['ned', 'pon', 'uto', 'sri', 'čet', 'pet', 'sub']);
  });

  it('duration', () => {
    expect(duration(45 * 60_000)).toBe('45 min');
    expect(duration(3 * 3_600_000 + 12 * 60_000)).toBe('3 h 12 min');
    expect(duration(66 * 3_600_000 + 5 * 60_000)).toBe('66 h 5 min');
    expect(duration(3 * 3_600_000)).toBe('3 h');
    expect(duration(60_000)).toBe('1 min');
    expect(duration(59_999)).toBe(SN.time.underMinute);
    expect(duration(0)).toBe(SN.time.underMinute);
    expect(duration(-5)).toBe(SN.time.underMinute);
    expect(duration(119_999)).toBe('1 min');
  });

  it('parseZagrebLocal and formatZagrebLocal are inverse to the minute and refuse what is not a time', () => {
    expect(parseZagrebLocal('2026-09-28T07:45')).toBe(MONDAY_0745);
    expect(parseZagrebLocal('2026-09-28T07:45:30')).toBe(MONDAY_0745 + 30_000);
    expect(parseZagrebLocal(' 2026-09-28T07:45 ')).toBe(MONDAY_0745);
    expect(formatZagrebLocal(MONDAY_0745)).toBe('2026-09-28T07:45');
    expect(formatZagrebLocal(MONDAY_0745 + 30_000)).toBe('2026-09-28T07:45');
    expect(formatZagrebLocal(SNIMKA_WINDOW.toSec * 1000)).toBe('2026-10-01T08:00');
    for (const bad of ['', '2026-09-28', '2026-09-28T7:45', '2026-09-28 07:45', '2026-13-01T00:00', '2026-02-31T00:00', '2026-09-28T24:00', '2026-09-28T07:60', 'ponedjeljak', '2026-09-28T07:45Z', '2026-09-28T07:45+02:00']) {
      expect(parseZagrebLocal(bad), bad).toBeNull();
    }
    for (const ms of [SNIMKA_WINDOW.fromSec * 1000, MONDAY_0745, SNIMKA_WINDOW.toSec * 1000, SNIMKA_COMPARISON.fromSec * 1000]) {
      expect(parseZagrebLocal(formatZagrebLocal(ms))).toBe(ms);
    }
  });

  it('zagrebMidnight and zagrebTimeOfDay align a day by Zagreb time', () => {
    expect(zagrebMidnight(MONDAY_0745)).toBe(Date.UTC(2026, 8, 27, 22, 0));
    expect(zagrebTimeOfDay(MONDAY_0745)).toBe((7 * 60 + 45) * 60_000);
    expect(zagrebMidnight(SNIMKA_WINDOW.fromSec * 1000)).toBe(Date.UTC(2026, 8, 26, 22, 0));
    expect(zagrebTimeOfDay(SNIMKA_COMPARISON.fromSec * 1000)).toBe(0);
    expect(zagrebMidnight(Date.UTC(2026, 8, 30, 22, 30))).toBe(Date.UTC(2026, 8, 30, 22, 0));
  });
});
