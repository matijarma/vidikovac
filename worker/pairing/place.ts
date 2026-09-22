// The Worker's side of seam S3: validates a place a browser sent, resolves a
// stop place against the server's own stop table, and enriches a stored
// record on read (WP3 step 1 fills the bodies marked "not implemented"). The
// derivation itself is shared (shared/city/place.ts).
import routes from '../../app/src/data/zet-routes.json';
import { FRAME_STOPS, type FrameStops } from '../../shared/city/frame';
import type { ScreenPlace, ScreenPlaceInput } from '../../shared/city/place';
import type { ScreenStop } from '../protocol';

const ROUTE_TYPES = routes as Record<string, { type?: number } | undefined>;

/** A GTFS route id whose route_type is 0 (tram). Unknown ids are not trams. */
export function isTramRoute(routeId: string): boolean {
  return ROUTE_TYPES[routeId]?.type === 0;
}

/** The frame a request or a 'screen-set' carried, or null when it is not 4, 6 or 8. */
export function parseFrame(raw: unknown): FrameStops | null {
  return (FRAME_STOPS as readonly unknown[]).includes(raw) ? (raw as FrameStops) : null;
}

/**
 * A place from a request body or a v2 'screen-set': shape checked, strings trimmed and
 * bounded (name 1..80, address ..120, no control characters), an address point inside
 * Zagreb. Null when anything is off; the caller answers 'bad-place' / 400 field 'place'.
 */
export function parsePlaceInput(raw: unknown): ScreenPlaceInput | null {
  void raw;
  throw new Error('parsePlaceInput: not implemented (WP3 step 1)');
}

/**
 * The stored place for an input: a stop through screenStop() (name, point and kind from the
 * server's table and zet-routes.json), an address as given. Null for an unknown stop.
 */
export function resolvePlace(input: ScreenPlaceInput): ScreenPlace | null {
  void input;
  throw new Error('resolvePlace: not implemented (WP3 step 1)');
}

/** What screenMetadata() and the scan grant carry for a stored record. */
export interface EnrichedPlace {
  place: ScreenPlace;
  placeSet: boolean;
}

/**
 * Read-path enrichment: the stored place, else one derived from a stored stop (records from
 * before place-v2), else Trg bana Jelačića with placeSet false (an empty field or "Cijeli
 * grad"), so the list and the departures always have a place and the map keeps the
 * whole-city window.
 */
export function enrichPlace(stored: ScreenPlace | null, stop: ScreenStop | null): EnrichedPlace {
  void stored;
  void stop;
  throw new Error('enrichPlace: not implemented (WP3 step 1)');
}
