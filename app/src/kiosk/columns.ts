// The five time columns of a Zagreb day, sada · poslijepodne · večeras ·
// sutra · tjedan, and the wall-clock arithmetic they are cut with: 18:00 and
// the service day's 04:00, in Zagreb time and safe across the DST cuts. After
// 18:00 the afternoon leaves and the axis shifts left one column. The paired
// wall (paired.ts) reads a column's window to filter the agenda by the time
// word a phone sent (PresentationTarget.time), and experience/presentation.ts
// names the same words. The phone's time band that first held them is gone
// (WP4, WP5 B1).
import type { PresentationTime } from '../../../worker/presentation';
import { zagrebDayKey, zagrebHour, zagrebTime, zagrebWeekdayShort } from '../format';
import type { I18n } from '../i18n/i18n';

/** A column's id: the wire's time words (worker/presentation.ts). */
export type ColumnId = PresentationTime;

/** One column of the band: its lane id, the time word, the segment word, the head line and its half-open window. */
export interface ColumnSpec {
  id: ColumnId;
  /** The time word the head and the h3 read: sada, poslijepodne, večeras, noćas, sutra, tjedan. */
  label: string;
  /** The shorter word the phone's segment button shows (popodne for poslijepodne). */
  seg: string;
  /** "do 18:00", "od 18:00", "sub 12. 9.", "do čet 17. 9."; '' for sada, where the clock stands. */
  head: string;
  start: number;
  end: number;
}

/** The service day starts at 04:00: a night bus at 01:30 still belongs to the evening before. */
export const DAY_START_HOUR = 4;
export const EVENING_HOUR = 18;
export const NOON_HOUR = 12;
export const HORIZON_DAYS = 7;

const HOUR_MS = 3_600_000;
const DAY_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `dayKey` shifted by whole days, in the same 'YYYY-MM-DD' form; '' when the key is not a date. */
function shiftDay(dayKey: string, days: number): string {
  const m = DAY_KEY.exec(dayKey);
  if (!m) return '';
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/**
 * The UTC instant at which Zagreb's wall clock reads `hour`:00 on `dayKey`.
 * The guess assumes CEST (UTC+2); when the clock disagrees, the difference in
 * hours (counting a day boundary the guess may have crossed) is subtracted,
 * at most twice, which settles on either side of a DST cut. The band's cuts
 * (04:00, 12:00, 18:00) never fall inside the repeated or the skipped hour.
 * NaN for a key that is not a date, so every comparison against it is false.
 */
export function zagrebInstant(dayKey: string, hour: number): number {
  const m = DAY_KEY.exec(dayKey);
  if (!m) return NaN;
  let guess = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), hour) - 2 * HOUR_MS;
  for (let i = 0; i < 2; i += 1) {
    const day = zagrebDayKey(guess);
    const dayOffset = day < dayKey ? -1 : day > dayKey ? 1 : 0;
    const delta = (zagrebHour(guess) ?? hour) - hour + 24 * dayOffset;
    if (delta === 0) break;
    guess -= delta * HOUR_MS;
  }
  return guess;
}

/** The band's frame for one moment: the service day and the cuts every column is built from. */
export interface ColumnFrame {
  hour: number;
  today: string;
  /** The service day: today, or yesterday before 04:00. */
  d0: string;
  mode: 'day' | 'night';
  b18: number;
  b04: number;
  b04b: number;
  bEnd: number;
}

export function frameFor(now: number): ColumnFrame {
  const hour = zagrebHour(now) ?? 0;
  const today = zagrebDayKey(now);
  const d0 = hour < DAY_START_HOUR ? shiftDay(today, -1) : today;
  return {
    hour,
    today,
    d0,
    mode: hour >= DAY_START_HOUR && hour < EVENING_HOUR ? 'day' : 'night',
    b18: zagrebInstant(d0, EVENING_HOUR),
    b04: zagrebInstant(shiftDay(d0, 1), DAY_START_HOUR),
    b04b: zagrebInstant(shiftDay(d0, 2), DAY_START_HOUR),
    bEnd: zagrebInstant(shiftDay(d0, HORIZON_DAYS), DAY_START_HOUR),
  };
}

/**
 * The columns for this moment. Day mode (04:00 to 18:00): sada, the day
 * column ("danas" before noon, "poslijepodne" after, to 18:00), večeras (from
 * 18:00 to 04:00), sutra, tjedan. Night mode: sada, noćas (now to 04:00),
 * sutra, tjedan. Between 00:00 and 04:00 the sutra column is this calendar
 * day, so it is labelled "danas" with its date, like dayLabel().
 */
export function columnsFor(i18n: I18n, now: number): ColumnSpec[] {
  const t = (key: string, vars?: Record<string, string | number>): string => i18n.t(key, vars);
  const f = frameFor(now);
  const columns: ColumnSpec[] = [{ id: 'sada', label: t('timeband.sada'), seg: t('timeband.seg.sada'), head: '', start: now, end: now }];
  if (f.mode === 'day') {
    const morning = f.hour < NOON_HOUR;
    columns.push(
      { id: 'danas', label: t(morning ? 'timeband.today' : 'timeband.afternoon'), seg: t(morning ? 'timeband.seg.today' : 'timeband.seg.afternoon'), head: t('timeband.headUntil', { time: zagrebTime(f.b18) }), start: now, end: f.b18 },
      { id: 'veceras', label: t('timeband.tonight'), seg: t('timeband.seg.tonight'), head: t('timeband.headFrom', { time: zagrebTime(f.b18) }), start: f.b18, end: f.b04 },
    );
  } else {
    columns.push({ id: 'veceras', label: t('timeband.night'), seg: t('timeband.seg.night'), head: t('timeband.headUntil', { time: zagrebTime(f.b04) }), start: now, end: f.b04 });
  }
  const nextIsToday = zagrebDayKey(f.b04) === f.today;
  columns.push(
    { id: 'sutra', label: t(nextIsToday ? 'timeband.today' : 'timeband.tomorrow'), seg: t(nextIsToday ? 'timeband.seg.today' : 'timeband.seg.tomorrow'), head: zagrebWeekdayShort(f.b04), start: f.b04, end: f.b04b },
    { id: 'tjedan', label: t('timeband.week'), seg: t('timeband.seg.week'), head: t('timeband.headUntilDate', { date: zagrebWeekdayShort(zagrebInstant(shiftDay(f.d0, HORIZON_DAYS - 1), NOON_HOUR)) }), start: f.b04b, end: f.bEnd },
  );
  return columns;
}
