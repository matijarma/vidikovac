// Seam S3 (docs/companion-2026-09-22.md §15.2): what a screen is about. Owned
// by WP3; read by worker/pairing/place.ts, app/src/city/place.ts (WP4's
// resolvePlace wraps derivePlace), app/src/kiosk.ts and the WP6 fixtures.
// Pure: no DOM, no fetch, no data files; callers hand in the stop table and
// the tram test they hold (the Worker's isTramRoute, the app's routeType).
import type { ScreenStop } from '../../worker/protocol';
import { distanceM, normalName } from './geo';

export type ScreenPlaceKind = 'tram' | 'bus' | 'address';

/**
 * The place a screen names in its header and centres its list on. `name` is what the
 * header shows: the stop's name or the street's name, never a venue's. `address` is the
 * typed street and number, kept for the settings' Mjesto row only.
 */
export interface ScreenPlace {
  kind: ScreenPlaceKind;
  name: string;
  lon: number;
  lat: number;
  /** Set when the place is a stop (kind 'tram' or 'bus'). */
  stopId?: string;
  address?: string;
}

/**
 * What a browser may send for a place. A stop carries only its id: the server fills the
 * name, the point and the kind from its own table, so a browser is never trusted with a
 * stop's coordinates. An address carries its point (inside Zagreb) and its name.
 */
export type ScreenPlaceInput =
  | { kind: 'stop'; stopId: string; address?: string }
  | { kind: 'address'; name: string; lon: number; lat: number; address?: string };

/** Where a typed address or a picked suggestion points, before derivePlace turns it into a place. */
export interface PlaceAnchor {
  lon: number;
  lat: number;
  /** What the header would show: the stop's or the street's name. */
  name: string;
  /** The typed street and number, for the Mjesto row. */
  address?: string;
}

/** A tram platform this close to the anchor makes the place that stop [O-26]. */
export const TRAM_NEAR_M = 400;
/** Else a bus platform this close does. */
export const BUS_NEAR_M = 300;
export const PLACE_NAME_MAX = 80;
export const PLACE_ADDRESS_MAX = 120;
/** The served map's bounds (app/src/core/contracts.ts MAP_CONFIG.bounds: 15.70, 45.50, 16.30, 46.02). */
export const ZAGREB_BOUNDS = Object.freeze({ west: 15.7, south: 45.5, east: 16.3, north: 46.02 });
/**
 * The place of a screen set up with an empty field or "Cijeli grad": Trg bana J. Jelačića
 * [O-65], so the list and the departures always exist; the map keeps the whole-city window.
 */
export const DEFAULT_PLACE_STOP_ID = '106_1';

export function inZagreb(lon: number, lat: number): boolean {
  return Number.isFinite(lon) && Number.isFinite(lat)
    && lon >= ZAGREB_BOUNDS.west && lon <= ZAGREB_BOUNDS.east && lat >= ZAGREB_BOUNDS.south && lat <= ZAGREB_BOUNDS.north;
}

export type NearStop = ScreenStop & { distanceM: number };

/** The stops nearest a point, one platform per name (the nearest), nearest first. */
export function nearestStops(
  point: { lon: number; lat: number },
  stops: readonly ScreenStop[],
  opts: { limit: number; only?: (stop: ScreenStop) => boolean },
): NearStop[] {
  const byName = new Map<string, NearStop>();
  for (const stop of stops) {
    if (opts.only && !opts.only(stop)) continue;
    const d = distanceM(point, stop);
    const name = normalName(stop.name);
    const seen = byName.get(name);
    if (!seen || d < seen.distanceM) byName.set(name, { ...stop, distanceM: d });
  }
  return [...byName.values()].sort((a, b) => a.distanceM - b.distanceM).slice(0, Math.max(0, opts.limit));
}

/** A stop as a place: a tram place when any of its routes is a tram route, else a bus place. */
export function placeFromStop(stop: ScreenStop, isTram: (routeId: string) => boolean, address?: string): ScreenPlace {
  return {
    kind: stop.routes.some(isTram) ? 'tram' : 'bus',
    name: stop.name,
    lon: stop.lon,
    lat: stop.lat,
    stopId: stop.id,
    ...(address ? { address } : {}),
  };
}

/**
 * The place for an anchor [O-26]: the nearest tram platform within TRAM_NEAR_M, else the
 * nearest bus platform within BUS_NEAR_M, else the anchor itself as an address. A stop place
 * keeps the anchor's typed address for the Mjesto row.
 */
export function derivePlace(anchor: PlaceAnchor, stops: readonly ScreenStop[], isTram: (routeId: string) => boolean): ScreenPlace {
  const [tram] = nearestStops(anchor, stops, { limit: 1, only: (s) => s.routes.some(isTram) });
  if (tram && tram.distanceM <= TRAM_NEAR_M) return placeFromStop(tram, isTram, anchor.address);
  const [bus] = nearestStops(anchor, stops, { limit: 1, only: (s) => s.routes.some((r) => !isTram(r)) });
  if (bus && bus.distanceM <= BUS_NEAR_M) return placeFromStop(bus, isTram, anchor.address);
  return { kind: 'address', name: anchor.name, lon: anchor.lon, lat: anchor.lat, ...(anchor.address ? { address: anchor.address } : {}) };
}

const STOP_ID_SHAPE = /^[0-9A-Za-z_-]{1,32}$/;
const CONTROL = /[\u0000-\u001f\u007f]/;
const text = (value: unknown, max: number): boolean =>
  typeof value === 'string' && value.trim().length >= 1 && value.trim().length <= max && !CONTROL.test(value);

/**
 * A place input a browser may send: a stop by a well-formed id, or an address with a name
 * (1..80 characters), a point inside Zagreb and an optional address (..120); no control
 * characters anywhere. Lengths are counted after trimming.
 */
export function isValidPlaceInput(x: unknown): x is ScreenPlaceInput {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return false;
  const o = x as Record<string, unknown>;
  if (o.address !== undefined && !text(o.address, PLACE_ADDRESS_MAX)) return false;
  if (o.kind === 'stop') return typeof o.stopId === 'string' && STOP_ID_SHAPE.test(o.stopId);
  if (o.kind === 'address') {
    return text(o.name, PLACE_NAME_MAX) && typeof o.lon === 'number' && typeof o.lat === 'number' && inZagreb(o.lon, o.lat);
  }
  return false;
}

/** Trg bana J. Jelačića (DEFAULT_PLACE_STOP_ID, a tram platform) from the stop table, or null when the table lacks it. */
export function defaultPlace(stops: readonly ScreenStop[]): ScreenPlace | null {
  const stop = stops.find((s) => s.id === DEFAULT_PLACE_STOP_ID);
  return stop ? placeFromStop(stop, () => true) : null;
}
