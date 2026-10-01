// Clock words for /snimka/. The whole window and the comparison day are CEST
// (UTC+2; test/app/snimka-format.test.ts proves it with Intl), so every
// label is fixed-offset arithmetic over epoch milliseconds: the same text in
// every reader's zone, with no Date formatting in the reader's own zone.
// Numbers and Croatian plurals come from /statistika/'s formatter.
import { ZAGREB_OFFSET_S } from '../../../shared/snimka';
import { SN } from './strings';

export { count, num, plural, type Forms } from '../statistika/format';

const OFFSET_MS = ZAGREB_OFFSET_S * 1000;
const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;

/** Weekday abbreviations in Zagreb's own order from Sunday, as JavaScript's getUTCDay counts. */
export const WEEKDAYS = ['ned', 'pon', 'uto', 'sri', 'čet', 'pet', 'sub'] as const;

const two = (n: number): string => String(n).padStart(2, '0');

/** The Zagreb wall clock of an instant as the fields of a Date read in UTC. */
function zagreb(ms: number): Date {
  return new Date(ms + OFFSET_MS);
}

/** "07:45" */
export function zagrebClock(ms: number): string {
  const d = zagreb(ms);
  return `${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`;
}

/** "pon 28. 9." */
export function zagrebDay(ms: number): string {
  const d = zagreb(ms);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()}. ${d.getUTCMonth() + 1}.`;
}

/** "pon 28. 9. u 07:45" */
export function zagrebDateTime(ms: number): string {
  return `${zagrebDay(ms)} u ${zagrebClock(ms)}`;
}

/** "45 min", "3 h", "3 h 12 min", "66 h 5 min"; under a minute the word, never "0 min". */
export function duration(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / MINUTE_MS);
  if (minutes < 1) return SN.time.underMinute;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

const LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

/** '2026-09-28T07:45' (seconds optional) in Zagreb time to epoch milliseconds; null when malformed or not a real instant. */
export function parseZagrebLocal(text: string): number | null {
  const m = LOCAL.exec(text.trim());
  if (!m) return null;
  const [y, mo, d, h, mi, s] = [m[1], m[2], m[3], m[4], m[5], m[6] ?? '0'].map(Number) as [number, number, number, number, number, number];
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null;
  const utc = Date.UTC(y, mo - 1, d, h, mi, s);
  const back = new Date(utc);
  // Date.UTC rolls 31 February into March; a real calendar date reads back as itself.
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return utc - OFFSET_MS;
}

/** The inverse of parseZagrebLocal to the minute: '2026-09-28T07:45'. */
export function formatZagrebLocal(ms: number): string {
  const d = zagreb(ms);
  return `${d.getUTCFullYear()}-${two(d.getUTCMonth() + 1)}-${two(d.getUTCDate())}T${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`;
}

/** The Zagreb midnight at or before the instant, in epoch milliseconds (day lines on the scrubber and the strip). */
export function zagrebMidnight(ms: number): number {
  return Math.floor((ms + OFFSET_MS) / (24 * HOUR_MS)) * 24 * HOUR_MS - OFFSET_MS;
}

/** Milliseconds since the Zagreb midnight of the instant's day (aligning the comparison day by time of day). */
export function zagrebTimeOfDay(ms: number): number {
  return ms - zagrebMidnight(ms);
}
