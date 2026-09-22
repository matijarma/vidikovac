// The start screen's and the settings' one field, "Adresa ili stajalište":
// suggestions over the stop table and the offline street index, and the two
// conversions around seam S3. Pure: the stop table and the street index are
// handed in (core/screens.ts loadStops and loadStreets fetch them lazily, on
// the field's first use, never on the entry graph).
//
// The street index (app/public/data/streets-geo.json, scripts/streets-geo.mjs)
// is OpenStreetMap data from the served Protomaps archive, ODbL 1.0. It has no
// house numbers: a typed number is kept as text for the Mjesto row, and a long
// street is offered as its parts at its stops, so the operator picks the part
// that holds the number.
import type { ScreenStop } from '../../../worker/protocol';
import type { PlaceAnchor, ScreenPlace, ScreenPlaceInput } from '../../../shared/city/place';
import { CITY_CENTRE, fold, isTramStop, stopDistanceM, type RankedStop } from './stops';

/** One street of the offline index (OpenStreetMap via Protomaps zagreb-v1, ODbL). */
export interface StreetGeo {
  /** The register's UL_JID when exactly one register row matches. */
  id?: string;
  name: string;
  settlementId?: string;
  /** The settlement's name, to tell apart streets of the same name. */
  settlement?: string;
  /** A point on the street, the one nearest its length-weighted centre. */
  lon: number;
  lat: number;
  /** West, south, east, north, rounded outward to 1e-4 of a degree. */
  bbox: [number, number, number, number];
  lengthM: number;
  /** Ids of the stops within 60 m of the line, one platform per name, ordered along it. */
  stops: string[];
  /** Simplified centreline (its longest continuous run), only for streets longer than 700 m. */
  line?: [number, number][];
}

export type PlaceSuggestion =
  | { kind: 'stop'; stop: RankedStop }
  | { kind: 'street'; street: StreetGeo; number?: string }
  | { kind: 'segment'; street: StreetGeo; stop: ScreenStop; number?: string };

/** Fewer typed characters than this suggest nothing. */
export const MIN_QUERY_CHARS = 2;
/** A street longer than this is offered as its parts at its stops instead of one row. */
export const SEGMENT_MIN_M = 700;
/** At most this many parts of one street. */
export const MAX_SEGMENTS = 4;

/** A street, a space and a house number of up to four digits with an optional letter. */
const ADDRESS = /^(.*?)\s+(\d{1,4}[a-z]?)$/i;

/** "Ilica 25" → { street: 'Ilica', number: '25' }; text without a trailing house number is all street. */
export function parseAddressQuery(query: string): { street: string; number?: string } {
  const text = query.replace(/\s+/g, ' ').trim();
  const match = ADDRESS.exec(text);
  if (!match || !match[1]!.trim()) return { street: text };
  return { street: match[1]!.trim(), number: match[2]! };
}

const WORD = /[\p{L}\p{N}]/u;

/**
 * How well a folded name matches folded text: 0 the name starts with it as whole words
 * ("horvatova" in "horvatova ulica"), 1 the name starts with it, 2 a later word starts with
 * it, 3 the name only contains it; null no match.
 */
function matchRank(name: string, text: string): 0 | 1 | 2 | 3 | null {
  const at = name.indexOf(text);
  if (at < 0) return null;
  if (at === 0) return name.length === text.length || !WORD.test(name[text.length]!) ? 0 : 1;
  for (let i = at; i >= 0; i = name.indexOf(text, i + 1)) {
    if (!WORD.test(name[i - 1]!)) return 2;
  }
  return 3;
}

// Folded names are computed once per table, not once per keystroke.
const foldedStops = new WeakMap<readonly ScreenStop[], string[]>();
const foldedStreets = new WeakMap<readonly StreetGeo[], string[]>();
function foldedNames<T extends { name: string }>(cache: WeakMap<readonly T[], string[]>, rows: readonly T[]): string[] {
  let names = cache.get(rows);
  if (!names) {
    names = rows.map((row) => fold(row.name));
    cache.set(rows, names);
  }
  return names;
}

interface Ranked<T> { row: T; rank: number; tram: boolean; distanceM: number }

function byRank<T extends { name: string }>(a: Ranked<T>, b: Ranked<T>): number {
  return a.rank - b.rank
    || Number(b.tram) - Number(a.tram)
    || a.distanceM - b.distanceM
    || (a.row.name < b.row.name ? -1 : a.row.name > b.row.name ? 1 : 0);
}

/** Stop names matching the text, one platform per name (a tram platform when the name has one, else the nearest). */
function stopRows(text: string, stops: readonly ScreenStop[], near: { lon: number; lat: number }): RankedStop[] {
  const folded = foldedNames(foldedStops, stops);
  const byName = new Map<string, Ranked<ScreenStop>>();
  for (let i = 0; i < stops.length; i += 1) {
    const rank = matchRank(folded[i]!, text);
    if (rank === null) continue;
    const stop = stops[i]!;
    const candidate: Ranked<ScreenStop> = { row: stop, rank, tram: isTramStop(stop), distanceM: stopDistanceM(stop, near) };
    const seen = byName.get(stop.name);
    if (!seen) {
      byName.set(stop.name, candidate);
      continue;
    }
    const tram = seen.tram || candidate.tram;
    const better = candidate.tram !== seen.tram ? candidate.tram : candidate.distanceM < seen.distanceM;
    byName.set(stop.name, better ? { ...candidate, tram } : { ...seen, tram });
  }
  return [...byName.values()].sort(byRank).map(({ row, distanceM }) => ({ ...row, distanceM }));
}

/** Streets matching the text, best match first (see matchRank), then nearest first. */
function streetRows(text: string, streets: readonly StreetGeo[], near: { lon: number; lat: number }): StreetGeo[] {
  const folded = foldedNames(foldedStreets, streets);
  const hits: Ranked<StreetGeo>[] = [];
  for (let i = 0; i < streets.length; i += 1) {
    const rank = matchRank(folded[i]!, text);
    if (rank === null) continue;
    hits.push({ row: streets[i]!, rank, tram: false, distanceM: stopDistanceM(streets[i]!, near) });
  }
  return hits.sort(byRank).map((hit) => hit.row);
}

const stopIndex = new WeakMap<readonly ScreenStop[], Map<string, ScreenStop>>();
function stopWithId(stops: readonly ScreenStop[], id: string): ScreenStop | null {
  let index = stopIndex.get(stops);
  if (!index) {
    index = new Map(stops.map((stop) => [stop.id, stop]));
    stopIndex.set(stops, index);
  }
  return index.get(id) ?? null;
}

/**
 * Up to MAX_SEGMENTS of a long street's stops, spread along it, that the stop table knows; none
 * when fewer than two are known (one stop is no choice, and the street's own point stands for it).
 */
function segmentStops(street: StreetGeo, stops: readonly ScreenStop[]): ScreenStop[] {
  const known = street.stops.map((id) => stopWithId(stops, id)).filter((stop): stop is ScreenStop => stop !== null);
  if (known.length < 2) return [];
  if (known.length <= MAX_SEGMENTS) return known;
  const picked: ScreenStop[] = [];
  for (let k = 0; k < MAX_SEGMENTS; k += 1) picked.push(known[Math.round((k * (known.length - 1)) / (MAX_SEGMENTS - 1))]!);
  return picked;
}

/**
 * Up to `limit` suggestions for what was typed (two characters or more): stops first (tram
 * before bus-only at equal rank), then streets; each list by how well the name matches
 * (whole words at its start, its start, a later word, anywhere), then nearest `near` first.
 * A street longer than 700 m with two stops or more is offered as its segments at up to
 * four of its stops instead of one row. A trailing house number ("Ilica 25") is kept on the
 * street rows as text; stops are matched against the whole text. Stops take at most half
 * the rows while streets match too.
 */
export function suggestPlaces(
  query: string,
  stops: readonly ScreenStop[],
  streets: readonly StreetGeo[],
  near: { lon: number; lat: number } = CITY_CENTRE,
  limit = 8,
): PlaceSuggestion[] {
  const whole = fold(query);
  if (whole.length < MIN_QUERY_CHARS || limit <= 0) return [];
  const address = parseAddressQuery(query);
  const streetText = fold(address.street);

  const stopHits: PlaceSuggestion[] = stopRows(whole, stops, near).slice(0, limit).map((stop) => ({ kind: 'stop', stop }));
  const streetHits: PlaceSuggestion[] = [];
  if (streetText.length >= MIN_QUERY_CHARS) {
    const number = address.number ? { number: address.number } : {};
    for (const street of streetRows(streetText, streets, near)) {
      if (streetHits.length >= limit) break;
      const parts = street.lengthM > SEGMENT_MIN_M ? segmentStops(street, stops) : [];
      if (parts.length === 0) streetHits.push({ kind: 'street', street, ...number });
      else for (const stop of parts) streetHits.push({ kind: 'segment', street, stop, ...number });
    }
  }
  const streetCount = Math.min(streetHits.length, Math.max(limit - stopHits.length, Math.floor(limit / 2)));
  const stopCount = Math.min(stopHits.length, limit - streetCount);
  return [...stopHits.slice(0, stopCount), ...streetHits.slice(0, streetCount)];
}

/** The point and names a suggestion stands for. */
export function anchorOf(s: PlaceSuggestion): PlaceAnchor {
  switch (s.kind) {
    case 'stop':
      return { lon: s.stop.lon, lat: s.stop.lat, name: s.stop.name };
    case 'street':
      return { lon: s.street.lon, lat: s.street.lat, name: s.street.name, ...(s.number ? { address: `${s.street.name} ${s.number}` } : {}) };
    case 'segment':
      return {
        lon: s.stop.lon,
        lat: s.stop.lat,
        name: s.street.name,
        address: s.number ? `${s.street.name} ${s.number}` : `${s.street.name} · ${s.stop.name}`,
      };
  }
}

/** What the browser sends for a place: a stop by its id only, an address with its point. */
export function placeInputOf(place: ScreenPlace): ScreenPlaceInput {
  if (place.kind !== 'address' && place.stopId) {
    return { kind: 'stop', stopId: place.stopId, ...(place.address ? { address: place.address } : {}) };
  }
  return { kind: 'address', name: place.name, lon: place.lon, lat: place.lat, ...(place.address ? { address: place.address } : {}) };
}
