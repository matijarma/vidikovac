// Everything a person reads on /hitno and /stats is in Europe/Zagreb local
// time. Counters are stored by Zagreb day and hour (worker/metrics-do.ts), so
// the same helpers decide the window boundaries of the operator page.
const ZAGREB = 'Europe/Zagreb';

const PARTS = new Intl.DateTimeFormat('hr-HR', {
  timeZone: ZAGREB,
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export interface ZagrebParts {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
}

export function zagrebParts(date: Date): ZagrebParts {
  const out: Record<string, string> = {};
  for (const part of PARTS.formatToParts(date)) {
    if (part.type !== 'literal') out[part.type] = part.value;
  }
  return {
    year: out.year ?? '',
    month: out.month ?? '',
    day: out.day ?? '',
    hour: out.hour ?? '',
    minute: out.minute ?? '',
  };
}

/** `YYYY-MM-DD` of the Zagreb calendar day the instant falls on. */
export function zagrebDay(date: Date): string {
  const p = zagrebParts(date);
  return `${p.year}-${p.month.padStart(2, '0')}-${p.day.padStart(2, '0')}`;
}

/** `HH:mm`, 24-hour clock. */
export function formatZagrebTime(date: Date): string {
  const p = zagrebParts(date);
  return `${p.hour.padStart(2, '0')}:${p.minute.padStart(2, '0')}`;
}

/** `11. 9. 05:00`: Croatian day-month order, no year (the page states the year once). */
export function formatZagrebDateTime(date: Date): string {
  const p = zagrebParts(date);
  return `${Number(p.day)}. ${Number(p.month)}. ${formatZagrebTime(date)}`;
}

export function parseIso(value: string | undefined): Date | null {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? new Date(t) : null;
}
