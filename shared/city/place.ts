// Seam S3 (docs/companion-2026-09-22.md §15.2): what a screen is about. Owned
// by WP3; read by worker/pairing/place.ts, app/src/city/place.ts (WP4),
// app/src/kiosk.ts and the WP6 fixtures. Pure. The derivation lands with the
// S3 commit; this first cut carries the types the screen protocol (S1) needs.

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
