// Two CSV shapes over the same counter rows.
//
//   export.csv  raw rows for the operator: (day, hour, event, dim1, dim2, count).
//   grad.csv    the City variant from design section 3: (month, day, hour,
//               event, dim1, dim2, count), counts rounded to 5, cells under 10
//               folded into "ostalo", over_cap excluded (design: overflow is not
//               part of the City dataset), source_fetch excluded (it is an
//               operations signal reported separately in the reliability report).
//
// Folding is done in three passes so that no cell under CITY_MIN_CELL can ever
// appear: (1) sub-threshold cells lose their dimensions and merge into the
// hour's "ostalo" cell; (2) an "ostalo" cell still under threshold merges into
// the day's "ostalo" cell (hour left empty); (3) whatever is still under
// threshold is dropped. Days are never merged with each other.
import type { MetricsDailyRow } from '../metrics-do';

export const RAW_COLUMNS = ['day', 'hour', 'event', 'dim1', 'dim2', 'count'] as const;
export const CITY_COLUMNS = ['month', 'day', 'hour', 'event', 'dim1', 'dim2', 'count'] as const;

export const CITY_EXCLUDED_EVENTS: ReadonlySet<string> = new Set(['over_cap', 'source_fetch', 'evaluation']);
export const CITY_MIN_CELL = 10;
export const CITY_ROUND_TO = 5;
export const OSTALO = 'ostalo';

export interface CityRow {
  month: string;
  day: string;
  /** '0'..'23', or '' for a cell folded to the whole day. */
  hour: string;
  event: string;
  dim1: string;
  dim2: string;
  count: number;
}

export function csvField(value: string | number): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(columns: readonly string[], rows: readonly (readonly (string | number)[])[]): string {
  const lines = [columns.map(csvField).join(',')];
  for (const r of rows) lines.push(r.map(csvField).join(','));
  return `${lines.join('\r\n')}\r\n`;
}

export function rawCsv(rows: readonly MetricsDailyRow[]): string {
  return toCsv(
    RAW_COLUMNS,
    rows.map((r) => [r.day, r.hour, r.event, r.dim1, r.dim2, r.count]),
  );
}

type CellKey = string;

interface Cell {
  day: string;
  hour: string;
  event: string;
  dim1: string;
  dim2: string;
  count: number;
}

function key(c: Omit<Cell, 'count'>): CellKey {
  return `${c.day}|${c.hour}|${c.event}|${c.dim1}|${c.dim2}`;
}

function add(cells: Map<CellKey, Cell>, c: Cell): void {
  const k = key(c);
  const existing = cells.get(k);
  if (existing === undefined) cells.set(k, { ...c });
  else existing.count += c.count;
}

function hourSortKey(hour: string): number {
  return hour === '' ? 24 : Number(hour);
}

export function cityRows(rows: readonly MetricsDailyRow[]): CityRow[] {
  // Pass 0: aggregate the eligible rows into cells.
  const cells = new Map<CellKey, Cell>();
  for (const r of rows) {
    if (CITY_EXCLUDED_EVENTS.has(r.event)) continue;
    add(cells, { day: r.day, hour: String(r.hour), event: r.event, dim1: r.dim1, dim2: r.dim2, count: r.count });
  }

  // Pass 1: sub-threshold cells fold into the hour's ostalo cell.
  const pass1 = new Map<CellKey, Cell>();
  for (const c of cells.values()) {
    if (c.count >= CITY_MIN_CELL) add(pass1, c);
    else add(pass1, { ...c, dim1: OSTALO, dim2: OSTALO });
  }

  // Pass 2: still under threshold -> the day's ostalo cell (hour '').
  const pass2 = new Map<CellKey, Cell>();
  for (const c of pass1.values()) {
    if (c.count >= CITY_MIN_CELL) add(pass2, c);
    else add(pass2, { ...c, hour: '', dim1: OSTALO, dim2: OSTALO });
  }

  // Pass 3: drop what could not be protected, round the rest.
  const out: CityRow[] = [];
  for (const c of pass2.values()) {
    if (c.count < CITY_MIN_CELL) continue;
    out.push({
      month: c.day.slice(0, 7),
      day: c.day,
      hour: c.hour,
      event: c.event,
      dim1: c.dim1,
      dim2: c.dim2,
      count: Math.round(c.count / CITY_ROUND_TO) * CITY_ROUND_TO,
    });
  }
  out.sort(
    (a, b) =>
      a.day.localeCompare(b.day) ||
      hourSortKey(a.hour) - hourSortKey(b.hour) ||
      a.event.localeCompare(b.event) ||
      a.dim1.localeCompare(b.dim1) ||
      a.dim2.localeCompare(b.dim2),
  );
  return out;
}

export function cityCsv(rows: readonly MetricsDailyRow[]): string {
  return toCsv(
    CITY_COLUMNS,
    cityRows(rows).map((r) => [r.month, r.day, r.hour, r.event, r.dim1, r.dim2, r.count]),
  );
}
