// The opening hours of app/public/data/osm-hours.json (scripts/osm-hours.mjs, OpenStreetMap,
// ODbL 1.0): which places near a point are open now, and the venue names that
// shared/city/venues.ts places events with. Pure: the phone and the wall load the file
// once a session (app/src/core/open-hours.ts) and ask on every paint.
import { cityId, distanceM } from './geo';

export const OPEN_KINDS = ['ljekarna', 'posta', 'knjiznica', 'trznica', 'trgovina', 'pekara', 'kafic', 'bar', 'restoran', 'kino', 'banka', 'benzinska', 'ordinacija'] as const;
export type OpenKind = (typeof OPEN_KINDS)[number];
/** app/public/data/osm-hours.json, struct-of-arrays. lon/lat: integer deltas in 1e-5 degrees, the first from `origin`,
 *  each next from the previous. week[i]: seven day fields, Monday first, joined by '|'; a field is "HHMM-HHMM" ranges
 *  joined by ',' ("" closed; a close before the open runs past midnight); null for a venue record (name only). */
export interface OsmHoursFile {
  version: 1; builtAt: string; osmDate: string; licence: 'ODbL 1.0'; attribution: string;
  count: number; venues: number; dropped: number; origin: [number, number];
  kinds: readonly (OpenKind | 'venue')[]; name: readonly string[]; kind: readonly number[];
  lon: readonly number[]; lat: readonly number[]; week: readonly (string | null)[];
}
export interface OsmHoursIndex { readonly size: number; readonly builtAt: string; readonly osmDate: string }
export interface OpenPlace { id: string; name: string; kind: OpenKind; lon: number; lat: number; closesAt: number }
export interface VenueEntry { name: string; lon: number; lat: number }

/** A place must stay open this long after now to be offered: nobody should arrive at a closing door. */
const MIN_OPEN_MS = 30 * 60_000;
const DAY_MIN = 1440;
const SCALE = 100_000;
/** The hour kinds whose places are also venues an event can name (the file's venue records hold the rest). */
const VENUE_KINDS: ReadonlySet<string> = new Set(['venue', 'kafic', 'bar', 'kino', 'knjiznica']);
const FIELD = /^(?:\d{4}-\d{4}(?:,\d{4}-\d{4})*)?$/;

interface Decoded extends OsmHoursIndex {
  readonly names: readonly string[];
  readonly kinds: readonly (OpenKind | 'venue')[];
  readonly lon: Float64Array;
  readonly lat: Float64Array;
  /** Per record, per weekday (Monday 0), the ranges in minutes [open, close]; close <= open runs past midnight. null: venue. */
  readonly weeks: readonly (readonly (readonly [number, number][])[] | null)[];
  venuesMemo?: readonly VenueEntry[];
}

const isDecoded = (index: OsmHoursIndex | null): index is Decoded => !!index && Array.isArray((index as Decoded).names);

function parseWeek(week: string): [number, number][][] | null {
  const fields = week.split('|');
  if (fields.length !== 7 || !fields.every((f) => FIELD.test(f))) return null;
  const days: [number, number][][] = [];
  for (const field of fields) {
    const ranges: [number, number][] = [];
    for (const range of field ? field.split(',') : []) {
      const open = Number(range.slice(0, 2)) * 60 + Number(range.slice(2, 4));
      const close = Number(range.slice(5, 7)) * 60 + Number(range.slice(7, 9));
      if (open >= DAY_MIN || close > DAY_MIN || Number(range.slice(2, 4)) > 59 || Number(range.slice(7, 9)) > 59 || open === close) return null;
      ranges.push([open, close]);
    }
    days.push(ranges);
  }
  return days;
}

/** The file → an index, or null for anything that is not a version-1 file (a foreign or truncated body). */
export function decodeOsmHours(file: unknown): OsmHoursIndex | null {
  if (!file || typeof file !== 'object') return null;
  const f = file as Partial<OsmHoursFile>;
  if (f.version !== 1 || typeof f.builtAt !== 'string' || typeof f.osmDate !== 'string') return null;
  const n = Array.isArray(f.name) ? f.name.length : -1;
  const arrays = [f.kind, f.lon, f.lat, f.week];
  if (n < 0 || !arrays.every((a) => Array.isArray(a) && a.length === n) || !Array.isArray(f.kinds)) return null;
  if (!Array.isArray(f.origin) || f.origin.length !== 2 || !f.origin.every(Number.isFinite)) return null;
  const known: readonly string[] = [...OPEN_KINDS, 'venue'];
  if (!f.kinds.every((k) => known.includes(k))) return null;
  const names: string[] = [], kinds: (OpenKind | 'venue')[] = [], weeks: (readonly [number, number][][] | null)[] = [];
  const lon = new Float64Array(n), lat = new Float64Array(n);
  let x = f.origin[0], y = f.origin[1];
  for (let i = 0; i < n; i++) {
    const kind = f.kinds[f.kind![i]], week = f.week![i], name = f.name![i];
    x += f.lon![i]; y += f.lat![i];
    if (typeof name !== 'string' || !kind || !Number.isFinite(x) || !Number.isFinite(y)) return null;
    const days = week === null ? null : typeof week === 'string' ? parseWeek(week) : undefined;
    if (days === undefined || (days === null) !== (kind === 'venue')) return null;
    names.push(name); kinds.push(kind); weeks.push(days);
    lon[i] = x / SCALE; lat[i] = y / SCALE;
  }
  const index: Decoded = { size: n, builtAt: f.builtAt, osmDate: f.osmDate, names, kinds, lon, lat, weeks };
  return index;
}

const ZAGREB = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Europe/Zagreb', weekday: 'short', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23',
});
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
interface ZagrebWall { year: number; month: number; day: number; weekday: number; minute: number; second: number }
function zagrebWall(ms: number): ZagrebWall {
  const p: Record<string, string> = {};
  for (const part of ZAGREB.formatToParts(new Date(ms))) p[part.type] = part.value;
  return { year: +p.year, month: +p.month, day: +p.day, weekday: WEEKDAYS.indexOf(p.weekday), minute: (+p.hour % 24) * 60 + +p.minute, second: +p.second };
}
/** The instant of a Zagreb wall time: day `day` of the month (may overflow) at `minute` past midnight. */
function zagrebInstant(year: number, month: number, day: number, minute: number): number {
  const wall = Date.UTC(year, month - 1, day, 0, minute);
  let guess = wall;
  for (let i = 0; i < 2; i++) {
    const z = zagrebWall(guess);
    const seen = Date.UTC(z.year, z.month - 1, z.day, 0, z.minute, z.second);
    guess += wall - seen;
  }
  return guess;
}

/**
 * When the place that is open at `minuteNow` of today (weekday `weekday`) closes, in minutes from today's
 * midnight: ranges that touch or overlap are one stretch, across midnight too. null when closed now, and
 * null for a place open the whole week ahead (24/7): there is no closing time to say.
 */
function closingMinute(days: readonly (readonly [number, number][])[], weekday: number, minuteNow: number): number | null {
  const stretches: [number, number][] = [];
  for (let offset = -1; offset <= 7; offset++) {
    for (const [open, close] of days[(weekday + offset + 7) % 7]) {
      const start = offset * DAY_MIN + open;
      stretches.push([start, offset * DAY_MIN + (close > open ? close : DAY_MIN + close)]);
    }
  }
  let end: number | null = null;
  for (const [s, e] of stretches) if (s <= minuteNow && minuteNow < e) end = Math.max(end ?? e, e);
  if (end === null) return null;
  for (let grown = true; grown;) {
    grown = false;
    for (const [s, e] of stretches) if (s <= end && end < e) { end = e; grown = true; }
    if (end >= 7 * DAY_MIN) return null;
  }
  return end;
}

/** Open at `now` (Zagreb time) within radiusM, closing 30 min or more after now; [] when holiday. */
export function openPlacesNear(index: OsmHoursIndex | null, point: { lon: number; lat: number }, radiusM: number, now: number, holiday: boolean): OpenPlace[] {
  if (holiday || !isDecoded(index) || !(radiusM > 0) || !Number.isFinite(now)) return [];
  const wall = zagrebWall(now);
  const minuteNow = wall.minute + wall.second / 60;
  // A cheap box before the great-circle distance: 1e-5 degree of latitude is 1.11 m.
  const dLat = radiusM / 111_000, dLon = radiusM / (111_000 * Math.cos((point.lat * Math.PI) / 180));
  const found: (OpenPlace & { distance: number })[] = [];
  for (let i = 0; i < index.size; i++) {
    const days = index.weeks[i];
    if (!days || Math.abs(index.lat[i] - point.lat) > dLat || Math.abs(index.lon[i] - point.lon) > dLon) continue;
    const at = { lon: index.lon[i], lat: index.lat[i] };
    const distance = distanceM(point, at);
    if (distance > radiusM) continue;
    const close = closingMinute(days, wall.weekday, minuteNow);
    if (close === null) continue;
    const closesAt = zagrebInstant(wall.year, wall.month, wall.day, close);
    if (closesAt - now < MIN_OPEN_MS) continue;
    const name = index.names[i];
    found.push({ id: cityId('osm', `${name}|${Math.round(at.lon * SCALE)}|${Math.round(at.lat * SCALE)}`), name, kind: index.kinds[i] as OpenKind, ...at, closesAt, distance });
  }
  return found.sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id)).map(({ distance: _, ...place }) => place);
}

/** The venue names of the file with their points: venue records and the cafés, bars, cinemas and libraries. */
export function osmVenues(index: OsmHoursIndex | null): readonly VenueEntry[] {
  if (!isDecoded(index)) return [];
  if (!index.venuesMemo) {
    const venues: VenueEntry[] = [];
    for (let i = 0; i < index.size; i++) if (VENUE_KINDS.has(index.kinds[i])) venues.push({ name: index.names[i], lon: index.lon[i], lat: index.lat[i] });
    index.venuesMemo = venues;
  }
  return index.venuesMemo;
}
