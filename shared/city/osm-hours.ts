// Placeholder of a frozen seam of the U3 package (docs/upgrade-2026-10-plan/U3.md §0.2(c)): the names and the
// signatures U3-osm implements, committed by U3-surfaces so the surfaces compile alone from the base. Every function
// answers "nothing known" (null or []). U3-osm merges first; on the add/add conflict the integrator keeps its version.
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

/** The index of a decoded file, or null for anything that is not one (the placeholder decodes nothing). */
export function decodeOsmHours(file: unknown): OsmHoursIndex | null {
  void file;
  return null;
}

/** Open at `now` (Zagreb time) within radiusM, closing 30 min or more after now; [] when holiday. */
export function openPlacesNear(index: OsmHoursIndex | null, point: { lon: number; lat: number }, radiusM: number, now: number, holiday: boolean): OpenPlace[] {
  void index; void point; void radiusM; void now; void holiday;
  return [];
}

/** The venue records (a name and a point) the gazetteer reads. */
export function osmVenues(index: OsmHoursIndex | null): readonly VenueEntry[] {
  void index;
  return [];
}
