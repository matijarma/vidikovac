// DHMZ publishes wall-clock times without an offset (`<Datum>11.09.2026`,
// `<Termin>12`), and the gazette dates acts in words. Both name Zagreb local
// time, so the feed layer needs the inverse of a formatter: wall clock -> instant.

export const ZAGREB_TZ = 'Europe/Zagreb';

const ZAGREB_PARTS = new Intl.DateTimeFormat('en-CA', {
  timeZone: ZAGREB_TZ,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/** Offset of Europe/Zagreb from UTC in minutes at that instant: 60 (CET) or 120 (CEST). */
export function zagrebOffsetMinutes(instant: Date): number {
  const parts: Record<string, string> = {};
  for (const part of ZAGREB_PARTS.formatToParts(instant)) {
    if (part.type !== 'literal') parts[part.type] = part.value;
  }
  const asIfUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return Math.round((asIfUtc - instant.getTime()) / 60000);
}

/** Zagreb wall-clock parts -> the ISO 8601 instant they name. */
export function zagrebIso(year: number, month: number, day: number, hour = 0, minute = 0): string {
  const naive = Date.UTC(year, month - 1, day, hour, minute);
  // Two passes: the first guess can sit on the wrong side of a DST switch.
  const firstGuess = zagrebOffsetMinutes(new Date(naive));
  const offset = zagrebOffsetMinutes(new Date(naive - firstGuess * 60000));
  return new Date(naive - offset * 60000).toISOString();
}

/** Normalise any source timestamp (ISO, RFC 822) to ISO 8601, or drop it. */
export function isoOrUndefined(value: string | undefined | null): string | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
}
