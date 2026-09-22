// Seam S2 (docs/companion-2026-09-22.md §15.2): the wall's frame, "N stops
// around the place". Owned by WP2; read by WP1 (the "U blizini" circle and
// pill), WP3 (the camera span), WP4 (Karta) and the Worker. Pure: no DOM, no
// fetch, no clock, no data files; callers hand in the stop table they hold.
//
// The radius is measured per place [O-68]: the camera, the "U blizini" circle
// and the pill all read the same number, so the map never frames one distance
// while the list promises another.
import { distanceM, normalName } from './geo';

/** Kadar 4 / 6 / 8: how many tram stops around the place the frame reaches. */
export const FRAME_STOPS = [4, 6, 8] as const;
export type FrameStops = (typeof FRAME_STOPS)[number];
export const DEFAULT_FRAME_STOPS: FrameStops = 6;

export function isFrameStops(x: unknown): x is FrameStops {
  return (FRAME_STOPS as readonly unknown[]).includes(x);
}

/** The measured radius never frames less than half a kilometre or more than three. */
export const FRAME_RADIUS_MIN_M = 500;
export const FRAME_RADIUS_MAX_M = 3000;
/** With no tram stop this close, the frame counts bus stops instead. */
export const FRAME_TRAM_REACH_M = 3000;

/**
 * The radius per Kadar when no stops are loaded yet (the first paint, a failed stop table),
 * and the calibration target the measured radius is compared against. From the along-the-line
 * calibration in WP2's notes (the N-th stop along the same tram path, p50 1.5 / 2.2 / 2.8 km).
 */
export const FRAME_RADIUS_M: Readonly<Record<FrameStops, number>> = Object.freeze({ 4: 1300, 6: 2000, 8: 2700 });

/** Walking pace the pill prints: 7.5 minutes per kilometre (8 km/h, the owner's figure). */
export const WALK_MIN_PER_KM = 7.5;

/** A stop as the frame counts it: its name (platforms sharing a name are one stop) and whether a tram serves it. */
export interface FrameStop {
  name: string;
  lon: number;
  lat: number;
  tram: boolean;
}

/** The frame's view of a stop table: every platform, flagged tram when any of its routes is a tram route. */
export function frameStopsFrom(
  stops: readonly { name: string; lon: number; lat: number; routes: readonly string[] }[],
  isTram: (routeId: string) => boolean,
): FrameStop[] {
  return stops.map((s) => ({ name: s.name, lon: s.lon, lat: s.lat, tram: s.routes.some(isTram) }));
}

/**
 * The frame's radius around a place, in metres: the air distance to its N-th nearest
 * distinct-name tram stop (bus stops when no tram stop lies within FRAME_TRAM_REACH_M),
 * clamped to [FRAME_RADIUS_MIN_M, FRAME_RADIUS_MAX_M].
 *
 * A place that is itself a stop (a ScreenStop, or a ScreenPlace of kind tram or bus) does not
 * count its own name: "Kvaternikov trg i 6 stajališta uokolo" is the place and six stops around
 * it. Fewer than N stops of the kind counted reads as the maximum; an empty table (nothing
 * loaded yet) falls back to FRAME_RADIUS_M.
 */
export function frameRadiusM(
  place: { lon: number; lat: number; name?: string; kind?: string },
  stops: readonly FrameStop[],
  frame: FrameStops,
): number {
  if (stops.length === 0) return FRAME_RADIUS_M[frame];
  const own = place.name !== undefined && place.kind !== 'address' ? normalName(place.name) : null;
  const ranked = (tram: boolean): number[] => {
    const nearest = new Map<string, number>();
    for (const stop of stops) {
      if (stop.tram !== tram) continue;
      const name = normalName(stop.name);
      if (name === own) continue;
      const d = distanceM(place, stop);
      const seen = nearest.get(name);
      if (seen === undefined || d < seen) nearest.set(name, d);
    }
    return [...nearest.values()].sort((a, b) => a - b);
  };
  let distances = ranked(true);
  if (!(distances[0] !== undefined && distances[0] <= FRAME_TRAM_REACH_M)) distances = ranked(false);
  const nth = distances[frame - 1] ?? FRAME_RADIUS_MAX_M;
  return Math.min(FRAME_RADIUS_MAX_M, Math.max(FRAME_RADIUS_MIN_M, nth));
}

/** The camera's span for a radius: the whole circle, edge to edge. */
export function frameSpanM(radiusM: number): number {
  return 2 * radiusM;
}

/**
 * The pill under "U blizini": the radius with a decimal comma and one decimal (a whole
 * kilometre prints without one) and its walking minutes, "2,2 km · ~16 min", "2 km · ~15 min".
 *
 * The minutes follow the printed distance, not the hidden metres, so one printed distance
 * always carries one number of minutes; a half minute rounds to the even minute (2,2 km is
 * 16.5 min, printed ~16, the owner's own example).
 */
export function pillText(radiusM: number): string {
  const tenths = Math.round(radiusM / 100);
  const km = tenths % 10 === 0 ? String(tenths / 10) : `${Math.floor(tenths / 10)},${tenths % 10}`;
  // Quarter minutes, an integer: 7.5 min/km is 0.75 min per tenth, so tenths × 3.
  const quarters = Math.round((tenths * WALK_MIN_PER_KM * 4) / 10);
  const whole = Math.floor(quarters / 4);
  const rest = quarters - whole * 4;
  const minutes = rest < 2 ? whole : rest > 2 ? whole + 1 : whole % 2 === 0 ? whole : whole + 1;
  return `${km} km · ~${minutes} min`;
}
