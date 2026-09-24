// Numbers, days and Croatian plurals for /statistika/. The report's days are
// already Zagreb calendar days (YYYY-MM-DD), so they are formatted as text,
// never through a Date in the reader's own zone.
const INTEGER = new Intl.NumberFormat('hr-HR', { maximumFractionDigits: 0 });
const PLURAL = new Intl.PluralRules('hr-HR');

export function num(n: number): string {
  return INTEGER.format(n);
}

/** part/whole as "99,8 %"; a dash when there is no whole to divide by. */
export function pct(part: number, whole: number, digits = 1): string {
  if (!(whole > 0)) return '–';
  const value = (part / whole) * 100;
  return `${new Intl.NumberFormat('hr-HR', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value)} %`;
}

/** Croatian noun forms: [one, few, other], e.g. ['sesija', 'sesije', 'sesija']. */
export type Forms = readonly [string, string, string];

export function plural(n: number, forms: Forms): string {
  const rule = PLURAL.select(n);
  return rule === 'one' ? forms[0] : rule === 'few' ? forms[1] : forms[2];
}

export function count(n: number, forms: Forms): string {
  return `${num(n)} ${plural(n, forms)}`;
}

/** "24. 9." */
export function dayShort(day: string): string {
  const [, m, d] = day.split('-');
  return `${Number(d)}. ${Number(m)}.`;
}

/** "24. 9. 2026." */
export function dayLong(day: string): string {
  const [y, m, d] = day.split('-');
  return `${Number(d)}. ${Number(m)}. ${y}.`;
}

/** "17 h" */
export function hourLabel(hour: number): string {
  return `${hour} h`;
}

/** "18 s" or "1 min 5 s" */
export function seconds(value: number | null): string {
  if (value === null) return '–';
  const s = Math.round(value);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return rest === 0 ? `${m} min` : `${m} min ${rest} s`;
}

/** Zagreb wall clock of an instant, "17:45". */
export function clock(at: Date): string {
  return new Intl.DateTimeFormat('hr-HR', { timeZone: 'Europe/Zagreb', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at);
}

export const FORMS = {
  sesija: ['sesija', 'sesije', 'sesija'],
  pregled: ['pregled', 'pregleda', 'pregleda'],
  dohvat: ['dohvat', 'dohvata', 'dohvata'],
  otvaranje: ['otvaranje', 'otvaranja', 'otvaranja'],
  izvoz: ['izvoz', 'izvoza', 'izvoza'],
  skeniranje: ['neuspjelo skeniranje', 'neuspjela skeniranja', 'neuspjelih skeniranja'],
  zaslonDan: ['dan rada zaslona', 'dana rada zaslona', 'dana rada zaslona'],
  procjena: ['procjena', 'procjene', 'procjena'],
  otkucaj: ['otkucaj', 'otkucaja', 'otkucaja'],
  prolaz: ['prolaz', 'prolaza', 'prolaza'],
  uzorak: ['uzorak', 'uzorka', 'uzoraka'],
  provjera: ['provjera', 'provjere', 'provjera'],
  dan: ['dan', 'dana', 'dana'],
} as const satisfies Record<string, Forms>;
