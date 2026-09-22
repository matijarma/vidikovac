// The start screen's and the settings' one field, "Adresa ili stajalište":
// suggestions over the stop table and the offline street index, and the two
// conversions around seam S3. Pure. WP3 step 2 fills suggestPlaces and adds
// the street index (app/public/data/streets-geo.json, loaded lazily).
import type { ScreenStop } from '../../../worker/protocol';
import type { PlaceAnchor, ScreenPlace, ScreenPlaceInput } from '../../../shared/city/place';
import type { RankedStop } from './stops';

/** One street of the offline index (OpenStreetMap via Protomaps zagreb-v1, ODbL). */
export interface StreetGeo {
  /** The register's UL_JID when exactly one register row matches. */
  id?: string;
  name: string;
  settlementId?: string;
  lon: number;
  lat: number;
  bbox: [number, number, number, number];
  lengthM: number;
  /** Ids of the stops within 60 m of the line, one platform per name, ordered along it. */
  stops: string[];
  /** Simplified centreline, only for streets longer than 700 m. */
  line?: [number, number][];
}

export type PlaceSuggestion =
  | { kind: 'stop'; stop: RankedStop }
  | { kind: 'street'; street: StreetGeo; number?: string }
  | { kind: 'segment'; street: StreetGeo; stop: ScreenStop };

/**
 * Up to `limit` suggestions for what was typed (two characters or more): stops first (tram
 * before bus-only at equal rank), then streets by prefix and substring; a street longer
 * than 700 m is offered as its segments at its stops. Stub until WP3 step 2.
 */
export function suggestPlaces(
  query: string,
  stops: readonly ScreenStop[],
  streets: readonly StreetGeo[],
  near?: { lon: number; lat: number },
  limit = 8,
): PlaceSuggestion[] {
  void query; void stops; void streets; void near; void limit;
  return [];
}

/** The point and names a suggestion stands for. */
export function anchorOf(s: PlaceSuggestion): PlaceAnchor {
  switch (s.kind) {
    case 'stop':
      return { lon: s.stop.lon, lat: s.stop.lat, name: s.stop.name };
    case 'street':
      return { lon: s.street.lon, lat: s.street.lat, name: s.street.name, ...(s.number ? { address: `${s.street.name} ${s.number}` } : {}) };
    case 'segment':
      return { lon: s.stop.lon, lat: s.stop.lat, name: s.street.name, address: `${s.street.name} · ${s.stop.name}` };
  }
}

/** What the browser sends for a place: a stop by its id only, an address with its point. */
export function placeInputOf(place: ScreenPlace): ScreenPlaceInput {
  if (place.kind !== 'address' && place.stopId) {
    return { kind: 'stop', stopId: place.stopId, ...(place.address ? { address: place.address } : {}) };
  }
  return { kind: 'address', name: place.name, lon: place.lon, lat: place.lat, ...(place.address ? { address: place.address } : {}) };
}
