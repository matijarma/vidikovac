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
