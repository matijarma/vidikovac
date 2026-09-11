import { describe, expect, it } from 'vitest';
import type { MetricsDailyRow } from '../../worker/metrics-do';
import {
  CITY_COLUMNS,
  RAW_COLUMNS,
  cityCsv,
  cityRows,
  csvField,
  rawCsv,
} from '../../worker/stats/export';

const row = (hour: number, event: string, dim1: string, dim2: string, count: number, day = '2026-09-10'): MetricsDailyRow => ({
  day,
  hour,
  event,
  dim1,
  dim2,
  count,
});

const ROWS: MetricsDailyRow[] = [
  row(10, 'session_start', 'kiosk', 'donji-grad', 23),
  row(10, 'session_start', 'kiosk', 'tresnjevka', 4),
  row(10, 'session_start', 'phone', '', 3),
  row(11, 'session_start', 'phone', '', 6),
  row(12, 'over_cap', '', '', 50),
  row(12, 'source_fetch', 'zet-rt', 'ok', 120),
  row(12, 'hitno_view', 'page', '', 12),
  row(13, 'scan_fail', 'code-expired', '', 2),
];

describe('CSV primitives', () => {
  it('quotes fields with commas, quotes or line breaks and doubles inner quotes', () => {
    expect(csvField('plain')).toBe('plain');
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField('two\nlines')).toBe('"two\nlines"');
    expect(csvField(42)).toBe('42');
  });

  it('writes the raw export with CRLF line endings and the documented header', () => {
    const csv = rawCsv(ROWS.slice(0, 2));
    expect([...RAW_COLUMNS]).toEqual(['day', 'hour', 'event', 'dim1', 'dim2', 'count']);
    expect(csv).toBe(
      'day,hour,event,dim1,dim2,count\r\n' +
        '2026-09-10,10,session_start,kiosk,donji-grad,23\r\n' +
        '2026-09-10,10,session_start,kiosk,tresnjevka,4\r\n',
    );
  });
});

describe('City variant (grad.csv)', () => {
  it('drops over_cap and source_fetch, folds cells under 10 into ostalo, rounds to 5', () => {
    const out = cityRows(ROWS);
    expect(out).toEqual([
      { month: '2026-09', day: '2026-09-10', hour: '10', event: 'session_start', dim1: 'kiosk', dim2: 'donji-grad', count: 25 },
      { month: '2026-09', day: '2026-09-10', hour: '12', event: 'hitno_view', dim1: 'page', dim2: '', count: 10 },
      // 4 + 3 (hour 10) and 6 (hour 11) were each under 10; folded to ostalo per hour they were
      // still under 10, so they fold once more to the whole day: 13, rounded to 15.
      { month: '2026-09', day: '2026-09-10', hour: '', event: 'session_start', dim1: 'ostalo', dim2: 'ostalo', count: 15 },
    ]);
    // scan_fail 2 could not reach 10 even at day level and is gone; nothing under 10 survives.
    for (const r of out) expect(r.count).toBeGreaterThanOrEqual(10);
    expect(out.some((r) => r.event === 'scan_fail')).toBe(false);
    expect(out.some((r) => r.event === 'over_cap')).toBe(false);
    expect(out.some((r) => r.event === 'source_fetch')).toBe(false);
  });

  it('keeps days apart when folding', () => {
    const out = cityRows([
      row(9, 'export', 'sigurnost', 'ics', 7, '2026-09-10'),
      row(9, 'export', 'sigurnost', 'ics', 7, '2026-09-11'),
    ]);
    // 7 on each day: never combined across days, so both vanish.
    expect(out).toEqual([]);
  });

  it('writes grad.csv with the month column first', () => {
    const csv = cityCsv(ROWS);
    expect([...CITY_COLUMNS]).toEqual(['month', 'day', 'hour', 'event', 'dim1', 'dim2', 'count']);
    expect(csv.split('\r\n')[0]).toBe('month,day,hour,event,dim1,dim2,count');
    expect(csv).toContain('2026-09,2026-09-10,10,session_start,kiosk,donji-grad,25\r\n');
    expect(csv).toContain('2026-09,2026-09-10,,session_start,ostalo,ostalo,15\r\n');
    expect(csv).not.toContain('23');
  });
});
