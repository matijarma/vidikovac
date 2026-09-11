// Europe/Zagreb wall-clock formatting for the browser. The Worker keeps its own
// copy in worker/open/time.ts (Area D owns that file and the app must not reach
// across the ownership line); both produce the same strings on purpose.
export const ZAGREB_TZ = 'Europe/Zagreb';

const PARTS = new Intl.DateTimeFormat('hr-HR', {
  timeZone: ZAGREB_TZ,
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export type TimeInput = string | number | Date | null | undefined;

export function parseIso(value: TimeInput): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function parts(date: Date): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of PARTS.formatToParts(date)) {
    if (part.type !== 'literal') out[part.type] = part.value;
  }
  return out;
}

/** 'HH:MM' in Zagreb local time; '' when there is nothing to format. */
export function zagrebTime(value: TimeInput): string {
  const date = parseIso(value);
  if (!date) return '';
  const p = parts(date);
  return `${(p.hour ?? '').padStart(2, '0')}:${(p.minute ?? '').padStart(2, '0')}`;
}

/** '11. 9. 14:32' — Croatian day-month order, no year (pages state the year once). */
export function zagrebDateTime(value: TimeInput): string {
  const date = parseIso(value);
  if (!date) return '';
  const p = parts(date);
  return `${Number(p.day)}. ${Number(p.month)}. ${zagrebTime(date)}`;
}

/** Whole minutes of age; null when the instant is unparseable. */
export function minutesSince(value: TimeInput, now: number): number | null {
  const date = parseIso(value);
  return date ? Math.floor((now - date.getTime()) / 60_000) : null;
}

/** 'M:SS' for the session ring. */
export function countdown(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
