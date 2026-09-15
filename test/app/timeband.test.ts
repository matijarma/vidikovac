// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { bucketOf, columnsFor, zagrebInstant } from '../../app/src/experience/timeband';
import { createDefaultI18n } from '../../app/src/i18n/create-default-i18n';

// The time band (plan A.3): one axis, sada · poslijepodne · večeras · sutra ·
// tjedan, cut at the service day's 04:00 and the evening's 18:00 in Zagreb
// wall-clock time. Every worked example of A.3 is a row here, so the cuts, the
// labels and the buckets are pinned where the design argued them.

const hr = createDefaultI18n('hr');
const en = createDefaultI18n('en');
const at = (iso: string): number => Date.parse(iso);

const FRI_AFTERNOON = at('2026-09-11T12:32:00Z'); // Fri 11. 9. 14:32 CEST: the unit fixture
const FRI_MORNING = at('2026-09-11T07:10:00Z');   // Fri 09:10
const FRI_EVENING = at('2026-09-11T17:40:00Z');   // Fri 19:40: night mode
const SAT_NIGHT = at('2026-09-11T23:15:00Z');     // Sat 12. 9. 01:15: before the service day turns
const DST_NIGHT = at('2026-10-24T23:00:00Z');     // Sun 25. 10. 01:00 CEST: the clocks fall back at 03:00

const SAT_0400 = at('2026-09-12T02:00:00Z');
const SUN_0400 = at('2026-09-13T02:00:00Z');
const FRI18_0400 = at('2026-09-18T02:00:00Z');

describe('zagrebInstant: the UTC instant of a Zagreb wall-clock hour, safe across the DST cuts', () => {
  it('reads 18:00 CEST on 11. 9. as 16:00Z', () => {
    expect(zagrebInstant('2026-09-11', 18)).toBe(at('2026-09-11T16:00:00Z'));
  });
  it('reads 04:00 on 25. 10. as 03:00Z: the clocks have already fallen back to CET that night', () => {
    expect(zagrebInstant('2026-10-25', 4)).toBe(at('2026-10-25T03:00:00Z'));
  });
  it('reads 04:00 on 29. 3. as 02:00Z: the clocks have already sprung forward to CEST', () => {
    expect(zagrebInstant('2026-03-29', 4)).toBe(at('2026-03-29T02:00:00Z'));
  });
  it('corrects a CET guess across midnight: 00:00 on 15. 1. is 23:00Z the evening before, 04:00 is 03:00Z', () => {
    expect(zagrebInstant('2026-01-15', 0)).toBe(at('2026-01-14T23:00:00Z'));
    expect(zagrebInstant('2026-01-15', 4)).toBe(at('2026-01-15T03:00:00Z'));
  });
  it('is NaN for a key that is not a date, so every comparison against it is false', () => {
    expect(zagrebInstant('', 4)).toBeNaN();
    expect(zagrebInstant('sutra', 4)).toBeNaN();
  });
});

describe('columnsFor: the axis for this moment', () => {
  it('Fri 14:32: five columns; the afternoon runs to 18:00, the evening from 18:00 to 04:00, sutra is Saturday, the week ends Thursday', () => {
    const cols = columnsFor(hr, FRI_AFTERNOON);
    expect(cols.map((c) => c.id)).toEqual(['sada', 'danas', 'veceras', 'sutra', 'tjedan']);
    expect(cols.map((c) => c.label)).toEqual(['sada', 'poslijepodne', 'večeras', 'sutra', 'tjedan']);
    expect(cols.map((c) => c.seg)).toEqual(['sada', 'popodne', 'večeras', 'sutra', 'tjedan']);
    expect(cols.map((c) => c.head)).toEqual(['', 'do 18:00', 'od 18:00', 'sub 12. 9.', 'do čet 17. 9.']);
    expect(cols.map((c) => [c.start, c.end])).toEqual([
      [FRI_AFTERNOON, FRI_AFTERNOON],
      [FRI_AFTERNOON, at('2026-09-11T16:00:00Z')],
      [at('2026-09-11T16:00:00Z'), SAT_0400],
      [SAT_0400, SUN_0400],
      [SUN_0400, FRI18_0400],
    ]);
  });
  it('speaks English with the same cuts', () => {
    const cols = columnsFor(en, FRI_AFTERNOON);
    expect(cols.map((c) => c.label)).toEqual(['now', 'afternoon', 'tonight', 'tomorrow', 'this week']);
    expect(cols.map((c) => c.seg)).toEqual(['now', 'p.m.', 'tonight', 'tomorrow', 'week']);
    expect(cols.map((c) => c.head)).toEqual(['', 'until 18:00', 'from 18:00', 'sub 12. 9.', 'until čet 17. 9.']);
  });
  it('Fri 09:10: before noon the day column says "danas", still to 18:00', () => {
    const cols = columnsFor(hr, FRI_MORNING);
    expect(cols.map((c) => c.id)).toEqual(['sada', 'danas', 'veceras', 'sutra', 'tjedan']);
    expect(cols[1]).toMatchObject({ label: 'danas', seg: 'danas', head: 'do 18:00', start: FRI_MORNING, end: at('2026-09-11T16:00:00Z') });
    expect(columnsFor(en, FRI_MORNING)[1]).toMatchObject({ label: 'today', seg: 'today' });
  });
  it('Fri 19:40: night mode has four columns; the afternoon has left and "noćas" runs from now to 04:00', () => {
    const cols = columnsFor(hr, FRI_EVENING);
    expect(cols.map((c) => c.id)).toEqual(['sada', 'veceras', 'sutra', 'tjedan']);
    expect(cols[1]).toMatchObject({ label: 'noćas', seg: 'noćas', head: 'do 04:00', start: FRI_EVENING, end: SAT_0400 });
    expect(cols[2]).toMatchObject({ label: 'sutra', head: 'sub 12. 9.', start: SAT_0400, end: SUN_0400 });
    expect(cols[3]).toMatchObject({ label: 'tjedan', head: 'do čet 17. 9.', start: SUN_0400, end: FRI18_0400 });
    expect(columnsFor(en, FRI_EVENING)[1]).toMatchObject({ label: 'overnight', seg: 'night', head: 'until 04:00' });
  });
  it('Sat 01:15: still Friday’s service day; the next column is Saturday and is labelled "danas" with its date', () => {
    const cols = columnsFor(hr, SAT_NIGHT);
    expect(cols.map((c) => c.id)).toEqual(['sada', 'veceras', 'sutra', 'tjedan']);
    expect(cols[1]).toMatchObject({ label: 'noćas', head: 'do 04:00', start: SAT_NIGHT, end: SAT_0400 });
    expect(cols[2]).toMatchObject({ id: 'sutra', label: 'danas', seg: 'danas', head: 'sub 12. 9.', start: SAT_0400, end: SUN_0400 });
    expect(cols[3]).toMatchObject({ label: 'tjedan', head: 'do čet 17. 9.', end: FRI18_0400 });
  });
  it('Sun 25. 10. 01:00, the DST night: the day turns at 04:00 CET (03:00Z) and every later cut follows CET', () => {
    const cols = columnsFor(hr, DST_NIGHT);
    expect(cols.map((c) => c.id)).toEqual(['sada', 'veceras', 'sutra', 'tjedan']);
    expect(cols[1]).toMatchObject({ label: 'noćas', head: 'do 04:00', start: DST_NIGHT, end: at('2026-10-25T03:00:00Z') });
    expect(cols[2]).toMatchObject({ label: 'danas', head: 'ned 25. 10.', start: at('2026-10-25T03:00:00Z'), end: at('2026-10-26T03:00:00Z') });
    expect(cols[3]).toMatchObject({ label: 'tjedan', head: 'do pet 30. 10.', start: at('2026-10-26T03:00:00Z'), end: at('2026-10-31T03:00:00Z') });
  });
});

describe('bucketOf: which lane a start belongs to (A.3’s worked rows)', () => {
  const cols = columnsFor(hr, FRI_AFTERNOON);
  const bucket = (start: string | undefined, until?: string, allDay?: boolean) => bucketOf(FRI_AFTERNOON, cols, start, until, allDay);

  it('Fri 17:00 is the afternoon', () => expect(bucket('2026-09-11T15:00:00Z')).toBe('danas'));
  it('Fri 20:00 is the evening', () => expect(bucket('2026-09-11T18:00:00Z')).toBe('veceras'));
  it('Sat 01:30 is still the evening: the service day runs to 04:00', () => expect(bucket('2026-09-11T23:30:00Z')).toBe('veceras'));
  it('Sat 04:00 opens sutra', () => expect(bucket('2026-09-12T02:00:00Z')).toBe('sutra'));
  it('Mon 14. 9. 11:00 is the week', () => expect(bucket('2026-09-14T09:00:00Z')).toBe('tjedan'));
  it('Fri 18. 9. 10:00 lies beyond D0+7 04:00: null', () => expect(bucket('2026-09-18T08:00:00Z')).toBeNull());
  it('an all-day item today whose noon has passed still belongs to the first time lane', () => {
    expect(bucket('2026-09-11T00:00:00Z', undefined, true)).toBe('danas');
    expect(bucket('2026-09-11', undefined, true)).toBe('danas');
  });
  it('an all-day item on Sun 13. 9. is the week', () => expect(bucket('2026-09-13T00:00:00Z', undefined, true)).toBe('tjedan'));
  it('an item running from 10. 9. to 1. 10. is sada (the producer decides whether to show it)', () => {
    expect(bucket('2026-09-10T07:00:00Z', '2026-10-01T16:00:00Z')).toBe('sada');
    expect(bucket('2026-09-11T12:32:00Z', '2026-09-11T13:00:00Z')).toBe('sada');
  });
  it('Fri 14:00 with no end has passed: null', () => expect(bucket('2026-09-11T12:00:00Z')).toBeNull());
  it('now Fri 09:10: Fri 11:00 is "danas · do 18:00"', () => {
    const morning = columnsFor(hr, FRI_MORNING);
    expect(bucketOf(FRI_MORNING, morning, '2026-09-11T09:00:00Z')).toBe('danas');
    expect(morning.find((c) => c.id === 'danas')).toMatchObject({ label: 'danas', head: 'do 18:00' });
  });
  it('now Fri 19:40: Fri 22:00 is "noćas · do 04:00" among four columns', () => {
    const evening = columnsFor(hr, FRI_EVENING);
    expect(evening).toHaveLength(4);
    expect(bucketOf(FRI_EVENING, evening, '2026-09-11T20:00:00Z')).toBe('veceras');
    expect(evening.find((c) => c.id === 'veceras')).toMatchObject({ label: 'noćas', head: 'do 04:00' });
  });
  it('now Sat 01:15: Sat 02:30 is noćas, Sat 10:00 is the "danas"-labelled sutra lane, Sun 10:00 is the week', () => {
    const night = columnsFor(hr, SAT_NIGHT);
    expect(bucketOf(SAT_NIGHT, night, '2026-09-12T00:30:00Z')).toBe('veceras');
    expect(bucketOf(SAT_NIGHT, night, '2026-09-12T08:00:00Z')).toBe('sutra');
    expect(night.find((c) => c.id === 'sutra')).toMatchObject({ label: 'danas', head: 'sub 12. 9.' });
    expect(bucketOf(SAT_NIGHT, night, '2026-09-13T08:00:00Z')).toBe('tjedan');
    // Friday's all-day item is still this service day's: the first time lane; Saturday's is the next day's.
    expect(bucketOf(SAT_NIGHT, night, '2026-09-11T00:00:00Z', undefined, true)).toBe('veceras');
    expect(bucketOf(SAT_NIGHT, night, '2026-09-12T00:00:00Z', undefined, true)).toBe('sutra');
  });
  it('now Sun 25. 10. 01:00 (the DST night): Sun 06:00 CET is sutra', () => {
    expect(bucketOf(DST_NIGHT, columnsFor(hr, DST_NIGHT), '2026-10-25T05:00:00Z')).toBe('sutra');
  });
  it('is null without a start, for an unparseable start, for a past all-day item and for an all-day item beyond the horizon', () => {
    expect(bucket(undefined)).toBeNull();
    expect(bucket('')).toBeNull();
    expect(bucket('sutra')).toBeNull();
    expect(bucket('2026-09-10T00:00:00Z', undefined, true)).toBeNull();
    expect(bucket('2026-09-19T00:00:00Z', undefined, true)).toBeNull();
  });
  it('a start exactly on a cut belongs to the lane the cut opens', () => {
    expect(bucket('2026-09-11T16:00:00Z')).toBe('veceras');
    expect(bucket('2026-09-13T02:00:00Z')).toBe('tjedan');
  });
});
