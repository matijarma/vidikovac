// The Worker's side of seam S3: validates a place a browser sent, resolves a
// stop place against the server's own stop table, and enriches a stored
// record on read. The derivation itself is shared (shared/city/place.ts).
//
// The route table is imported statically from app/src/data (moduleResolution
// Bundler; wrangler bundles the JSON), the same way worker/pairing/stops.ts
// imports worker/data/zet-stops.json.
import routes from '../../app/src/data/zet-routes.json';
import { FRAME_STOPS, type FrameStops } from '../../shared/city/frame';
import {
  DEFAULT_PLACE_STOP_ID,
  PLACE_ADDRESS_MAX,
  PLACE_NAME_MAX,
  inZagreb,
  isValidPlaceInput,
  placeFromStop,
  type ScreenPlace,
  type ScreenPlaceInput,
} from '../../shared/city/place';
import type { ScreenStop } from '../protocol';
import { screenStop } from './stops';

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
 * Only the known keys survive: a stop carries its id (and the typed address), never a
 * name or a point, because the server fills those from its own table.
 */
export function parsePlaceInput(raw: unknown): ScreenPlaceInput | null {
  if (!isValidPlaceInput(raw)) return null;
  const address = typeof raw.address === 'string' ? raw.address.trim() : '';
  const typed = address ? { address } : {};
  if (raw.kind === 'stop') return { kind: 'stop', stopId: raw.stopId, ...typed };
  return { kind: 'address', name: raw.name.trim(), lon: raw.lon, lat: raw.lat, ...typed };
}

/**
 * The stored place for an input: a stop through screenStop() (name, point and kind from the
 * server's table and zet-routes.json), an address as given. Null for an unknown stop.
 */
export function resolvePlace(input: ScreenPlaceInput): ScreenPlace | null {
  if (input.kind === 'stop') {
    const stop = screenStop(input.stopId);
    return stop ? placeFromStop(stop, isTramRoute, input.address) : null;
  }
  return { kind: 'address', name: input.name, lon: input.lon, lat: input.lat, ...(input.address ? { address: input.address } : {}) };
}

const STOP_ID_SHAPE = /^[0-9A-Za-z_-]{1,32}$/;
const CONTROL = /[\u0000-\u001f\u007f]/;
const boundedText = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length >= 1 && value.length <= max && !CONTROL.test(value);

/**
 * A place as the Durable Object stores it (the output of resolvePlace, or of placeFromStop
 * for a legacy stop): what BeaconDO.create() accepts and what screenMetadata() trusts when it
 * reads the 'place' meta back. A stop place keeps its stop id; an address has none.
 */
export function isStoredPlace(x: unknown): x is ScreenPlace {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return false;
  const o = x as Record<string, unknown>;
  if (o.kind !== 'tram' && o.kind !== 'bus' && o.kind !== 'address') return false;
  if (!boundedText(o.name, PLACE_NAME_MAX)) return false;
  if (typeof o.lon !== 'number' || typeof o.lat !== 'number' || !inZagreb(o.lon, o.lat)) return false;
  if (o.address !== undefined && !boundedText(o.address, PLACE_ADDRESS_MAX)) return false;
  if (o.kind === 'address') return o.stopId === undefined;
  return typeof o.stopId === 'string' && STOP_ID_SHAPE.test(o.stopId);
}

/** What screenMetadata() and the scan grant carry for a stored record. */
export interface EnrichedPlace {
  place: ScreenPlace;
  placeSet: boolean;
}

// The table always carries DEFAULT_PLACE_STOP_ID (test/pairing/beacon-do.workers.test.ts
// checks it); the literal only keeps the read path total if a regenerated table ever lost it.
const TRG_FALLBACK: ScreenPlace = { kind: 'tram', name: 'Trg bana J. Jelačića', lon: 15.97726, lat: 45.81286, stopId: DEFAULT_PLACE_STOP_ID };
let defaultPlaceMemo: ScreenPlace | null = null;

/** Trg bana J. Jelačića as a place: the list and the departures of a screen whose field was left empty [O-65]. */
export function defaultScreenPlace(): ScreenPlace {
  if (!defaultPlaceMemo) {
    const stop = screenStop(DEFAULT_PLACE_STOP_ID);
    defaultPlaceMemo = stop ? placeFromStop(stop, isTramRoute) : TRG_FALLBACK;
  }
  return defaultPlaceMemo;
}

/**
 * Read-path enrichment: the stored place, else one derived from a stored stop (records from
 * before place-v2), else Trg bana Jelačića with placeSet false (an empty field or "Cijeli
 * grad"), so the list and the departures always have a place and the map keeps the
 * whole-city window.
 */
export function enrichPlace(stored: ScreenPlace | null, stop: ScreenStop | null): EnrichedPlace {
  if (stored) return { place: stored, placeSet: true };
  if (stop) return { place: placeFromStop(stop, isTramRoute), placeSet: true };
  return { place: { ...defaultScreenPlace() }, placeSet: false };
}
