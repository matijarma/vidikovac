// The two axes a Zagreb timetable and a Zagreb street vary along: the hour
// of the day and whether it is a working day. Both the timetable provider
// (times.ts) and the learned aggregates (learn.ts) key on them, so they live
// here where neither has to import the other.

/** 0 Monday to Friday, 1 Saturday, Sunday and holidays. */
export type DayType = 0 | 1;

export interface Bands {
  hourBand: number;
  dayType: DayType;
}

const ZAGREB_BANDS = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Zagreb', hour: '2-digit', hourCycle: 'h23', weekday: 'short' });

/** The hour band and day type of an instant, Zagreb wall clock. */
export function zagrebBands(epochSec: number): Bands {
  const parts: Record<string, string> = {};
  for (const part of ZAGREB_BANDS.formatToParts(new Date(epochSec * 1000))) parts[part.type] = part.value;
  const hourBand = Number(parts.hour) % 24;
  const dayType: DayType = parts.weekday === 'Sat' || parts.weekday === 'Sun' ? 1 : 0;
  return { hourBand, dayType };
}

const ZAGREB_HOUR = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Zagreb', hour: '2-digit', hourCycle: 'h23' });

/**
 * When the service day a GTFS-Realtime `startDate` (YYYYMMDD) names begins,
 * in epoch seconds: twelve hours before that date's Zagreb noon, GTFS's own
 * definition, so a trip's `start` (seconds past service midnight, past 86400
 * for a night trip) adds straight onto it whatever the clocks did that night.
 * Null for a malformed date.
 */
export function serviceDayStartSec(startDate: string): number | null {
  if (!/^\d{8}$/.test(startDate)) return null;
  const year = Number(startDate.slice(0, 4));
  const month = Number(startDate.slice(4, 6));
  const day = Number(startDate.slice(6, 8));
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const utcNoon = Date.UTC(year, month - 1, day, 12);
  const zagrebHourAtUtcNoon = Number(ZAGREB_HOUR.format(new Date(utcNoon)));
  const offsetHours = zagrebHourAtUtcNoon - 12;
  const localNoon = utcNoon - offsetHours * 3_600_000;
  return localNoon / 1000 - 12 * 3600;
}
