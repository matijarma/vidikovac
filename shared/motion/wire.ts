// The vehicle motion object on the wire: `FeedItem.motion` in
// worker/feed/schema.ts (R-TE2). It sits beside the scalar `data` vocabulary
// because a fix history or a motion plan is not a scalar and the closed
// DATA_KEYS list (and test/feed/fixtures.test.ts) rightly refuses one.
//
// Written by the twin (worker/do/twin-do.ts), read by the client
// (app/src/motion/fixes.ts) and by the tests, so the shape is defined exactly
// once, here, in code that is DOM-free and imports nothing (R-TE15).
//
// Conventions (R-TE13): times are integer seconds relative to the snapshot's
// `sourceUpdatedAt` (ZET's header time), so a history fix is usually
// negative and a plan knot usually positive; coordinates are degrees rounded
// to 1e-5, the feed's own float32 ceiling (~1.1 m at Zagreb's latitude); `s`
// is metres along the named path.

/** One past fix: [seconds relative to sourceUpdatedAt, lon, lat]. */
export type HistoryFix = readonly [atSec: number, lon: number, lat: number];

/** One plan knot on geometry: [seconds relative to sourceUpdatedAt, metres along the path]. */
export type PathKnot = readonly [tSec: number, s: number];

/** One plan knot off geometry: [seconds relative to sourceUpdatedAt, lon, lat]. */
export type FreeKnot = readonly [tSec: number, lon: number, lat: number];

/** Phase A: the vehicle's recent fixes, oldest first, newest last. */
export interface HistoryMotion {
  history: HistoryFix[];
}

/** Phase B: a plan along a named path, a GTFS shape id or a `path:` id in the network artefact. */
export interface PathMotion {
  path: string;
  plan: PathKnot[];
}

/** Phase B: a plan in the free plane, for a vehicle no geometry fits. */
export interface FreeMotion {
  plan: FreeKnot[];
}

export type VehicleMotion = HistoryMotion | PathMotion | FreeMotion;

/** How many past fixes the twin keeps and publishes per vehicle: at ZET's
 *  10 s tick with about two thirds of vehicles refreshing per tick, twelve
 *  slots span roughly three minutes, which covers the client model's three
 *  moving intervals with room for a dwell at a stop in between, and stays
 *  under 40 bytes per fix on the wire. */
export const HISTORY_FIXES = 12;

export function isHistoryMotion(motion: VehicleMotion): motion is HistoryMotion {
  return 'history' in motion;
}

export function isPathMotion(motion: VehicleMotion): motion is PathMotion {
  return 'path' in motion;
}

export function isFreeMotion(motion: VehicleMotion): motion is FreeMotion {
  return !('history' in motion) && !('path' in motion);
}
