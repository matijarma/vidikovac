// Seam S2 (docs/companion-2026-09-22.md §15.2): the wall's frame, "N stops
// around the place". Owned by WP2; read by WP1 (the "U blizini" circle and
// pill), WP3 (the camera span), WP4 (Karta) and the Worker. Pure: no DOM, no
// fetch, no clock, no data files; callers hand in the stop table they hold.
//
// The radius is measured per place [O-68], and measured ALONG THE TRAM LINES
// (orchestrator decision 6, run/RUN.md): N stops down the lines that serve the
// place, which is what "6 stajališta odavde" means to a rider and what the
// owner-approved numbers come from (typical 1.5 / 2.2 / 2.8 km, the pill
// "2,2 km · ~16 min" at Trg bana Jelačića). The air distance to the N-th
// nearest stop name, the first reading of the brief's words, measured
// 0.68 / 0.94 / 1.10 km: nearest by air counts the stops of every other line
// around a junction, not the stops down the place's own. The camera, the
// "U blizini" circle and the pill all read the same number, so the map never
// frames one distance while the list promises another.
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
/** With no tram stop this close (the place's own stop included), the frame counts bus stops instead. */
export const FRAME_TRAM_REACH_M = 3000;
/**
 * Platforms sharing a name this close together are one stop, whose lines all serve the
 * place: a junction's platforms lie up to 240 m apart in feed 000395 (Tržnica Kvatrić,
 * Dubrava), and two stops of one name across the city are kilometres apart.
 */
export const FRAME_SAME_STOP_M = 300;

/**
 * The radius per Kadar when no stops are loaded yet (the first paint, a failed stop table)
 * or no tram line order is known, and the calibration target the measured radius is held
 * to (test/city/frame.test.ts, review.local/companion/plan/WP2/frame-calibration.mjs:
 * within 20 %). The measure over feed 000395's tram platforms gives a median of
 * 1524 / 2139 / 2753 m (WP2's notes: p50 1519 / 2191 / 2847 m over every stop and line).
 */
export const FRAME_RADIUS_M: Readonly<Record<FrameStops, number>> = Object.freeze({ 4: 1300, 6: 2000, 8: 2700 });

/** Walking pace the pill prints: 7.5 minutes per kilometre (8 km/h, the owner's figure). */
export const WALK_MIN_PER_KM = 7.5;

/** GTFS route_type of a tram, the only lines the frame walks. */
const ROUTE_TYPE_TRAM = 0;

/** A stop as the frame counts it: its name (platforms sharing a name are one stop) and whether a tram serves it. */
export interface FrameStop {
  /** The platform's id (a ScreenStop's), when the table carries one: the tie-break between two platforms equally near a place. */
  id?: string;
  name: string;
  lon: number;
  lat: number;
  tram: boolean;
  /**
   * Where the tram lines call at this platform, as [line, order]: `line` indexes the line
   * list the table was built from (frameStopsFrom), `order` is the platform's 0-based call
   * along that line. Absent: no tram line calls here, or the caller holds no line order.
   */
  lines?: readonly (readonly [line: number, order: number])[];
}

/** One tram line as the frame walks it: one direction of one pattern, the ids of the stops its trips call at, in order. */
export type FrameLine = readonly string[];

/**
 * The frame's view of a stop table: every platform, flagged tram when any of its routes is a
 * tram route or a tram line calls there, with where each line of `lines` calls at it (joined
 * on the row's `id`). Without `lines` the table knows no line order and frameRadiusM answers
 * FRAME_RADIUS_M for a place among trams.
 */
export function frameStopsFrom(
  stops: readonly { id?: string; name: string; lon: number; lat: number; routes: readonly string[] }[],
  isTram: (routeId: string) => boolean,
  lines: readonly FrameLine[] = [],
): FrameStop[] {
  const calls = new Map<string, [number, number][]>();
  lines.forEach((line, index) => {
    line.forEach((id, order) => {
      const at = calls.get(id);
      if (at) at.push([index, order]);
      else calls.set(id, [[index, order]]);
    });
  });
  return stops.map((s) => {
    const on = s.id === undefined ? undefined : calls.get(s.id);
    return { ...(s.id !== undefined ? { id: s.id } : {}), name: s.name, lon: s.lon, lat: s.lat, tram: on !== undefined || s.routes.some(isTram), ...(on ? { lines: on } : {}) };
  });
}

/** The part of a decoded network the frame reads (shared/motion/network.ts GraphNetwork satisfies it). */
export interface FrameNetwork {
  routes: ReadonlyMap<string, { type: number }>;
  stops: readonly { id: string }[];
  /** Every path over the rail graph with the platforms its own trips call at, in order (F8). */
  paths?: readonly { route: string; served?: readonly { stop: number }[] }[];
}

/**
 * The tram lines of a decoded network artefact, for frameStopsFrom: every tram path with a
 * served list (152 in feed 000395), as the ids of the platforms it calls at, in order. Bus
 * shapes carry no served list, so the bus fallback stays an air distance.
 */
export function frameLinesOf(network: FrameNetwork): FrameLine[] {
  const out: FrameLine[] = [];
  for (const path of network.paths ?? []) {
    if (network.routes.get(path.route)?.type !== ROUTE_TYPE_TRAM || !path.served?.length) continue;
    out.push(path.served.map((call) => network.stops[call.stop]?.id).filter((id): id is string => id !== undefined));
  }
  return out;
}

/** The lines rebuilt from a table's calls, platform by order (a platform missing from the table is a hole), every tram platform with a usable position, and every platform's name as compared (normalName, once per table). */
interface LineIndex {
  lines: (FrameStop | undefined)[][];
  tram: FrameStop[];
  names: Map<FrameStop, string>;
}
const lineIndexes = new WeakMap<readonly FrameStop[], LineIndex>();
function lineIndex(stops: readonly FrameStop[]): LineIndex {
  const known = lineIndexes.get(stops);
  if (known) return known;
  const index: LineIndex = { lines: [], tram: [], names: new Map() };
  for (const stop of stops) {
    index.names.set(stop, normalName(stop.name));
    if (!stop.tram || !located(stop)) continue;
    index.tram.push(stop);
    for (const [line, order] of stop.lines ?? []) (index.lines[line] ??= [])[order] = stop;
  }
  lineIndexes.set(stops, index);
  return index;
}

/** A point the frame can measure from or to: finite coordinates (a row with a broken position is never a distance). */
function located(p: { lon: number; lat: number }): boolean {
  return Number.isFinite(p.lon) && Number.isFinite(p.lat);
}

/** The stable order of two platforms equally near a place: id, then name, then position, so the answer never depends on the table's order. */
function sortsBefore(a: FrameStop, b: FrameStop): boolean {
  const ka = a.id ?? '';
  const kb = b.id ?? '';
  if (ka !== kb) return ka < kb;
  if (a.name !== b.name) return a.name < b.name;
  return a.lon !== b.lon ? a.lon < b.lon : a.lat < b.lat;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * N stops down the tram lines that serve the place, or null when the place's stop has no line
 * order. The place's stop is the tram platform nearest the place (equally near platforms in
 * the stable order of sortsBefore), with every platform of its name within FRAME_SAME_STOP_M
 * (a stop's platforms carry its lines in each direction). From each call there, the walk
 * counts the distinct stop names down the line, the place's own name not among them, to the
 * N-th. Each distinct N-th stop counts once, however many lines reach it (five lines down one
 * street are one way out, not five), at its air distance from the place; the radius is the
 * median over those stops. Where no line reaches N stops (a short line) the frame reaches the
 * farthest stop any line does.
 */
function alongTheLines(place: { lon: number; lat: number }, stops: readonly FrameStop[], frame: FrameStops): number | null {
  const { lines, tram, names } = lineIndex(stops);
  let anchor: FrameStop | undefined;
  let nearest = Infinity;
  for (const stop of tram) {
    const d = distanceM(place, stop);
    if (!Number.isFinite(d)) continue;
    if (d < nearest || (d === nearest && anchor !== undefined && sortsBefore(stop, anchor))) {
      nearest = d;
      anchor = stop;
    }
  }
  if (!anchor) return null;
  const own = names.get(anchor)!;
  const platforms = tram.filter((platform) => names.get(platform) === own && distanceM(platform, anchor) <= FRAME_SAME_STOP_M);
  if (!platforms.some((platform) => platform.lines?.length)) return null;
  const ends = new Map<string, number>();
  let farthest = -1;
  for (const platform of platforms) {
    for (const [index, order] of platform.lines ?? []) {
      const line = lines[index] ?? [];
      const seen = new Set([own]);
      let count = 0;
      let last: FrameStop | undefined;
      for (let at = order + 1; at < line.length && count < frame; at++) {
        const next = line[at];
        if (!next) continue;
        const name = names.get(next)!;
        if (seen.has(name)) continue;
        seen.add(name);
        count++;
        last = next;
      }
      if (!last) continue;
      const d = distanceM(place, last);
      if (!Number.isFinite(d)) continue;
      if (count === frame) {
        const name = names.get(last)!;
        ends.set(name, Math.min(ends.get(name) ?? Infinity, d));
      } else farthest = Math.max(farthest, d);
    }
  }
  if (ends.size > 0) return median([...ends.values()]);
  return farthest >= 0 ? farthest : FRAME_RADIUS_MAX_M;
}

/**
 * The frame's radius around a place, in metres, clamped to [FRAME_RADIUS_MIN_M,
 * FRAME_RADIUS_MAX_M] and never less for a wider Kadar: N stops down the tram lines that serve
 * the place (alongTheLines), as the largest of that measure over this Kadar and every narrower
 * one. The N-th stop down a curving line can lie nearer by air than an earlier one, and which
 * lines reach N stops changes with N, so the bare measure shrank from Kadar 6 to 8 at 8 of
 * feed 000395's 270 tram platforms (Horvati 2474 to 2395 m); a wider Kadar that framed less
 * would contradict its own words.
 *
 * Only when no tram stop lies within FRAME_TRAM_REACH_M of the place, its own stop included,
 * does the frame count bus stops, as the air distance to the N-th nearest distinct-name bus
 * stop (the artefact carries no bus call order); a place that is itself a bus stop does not
 * count its own name, and fewer than N bus stops reads as the maximum. An empty table (nothing
 * loaded yet), a place's stop with no tram line order, or a place with no usable position
 * falls back to FRAME_RADIUS_M; a row with a broken position is never counted. The answer is
 * always a finite number of metres.
 */
export function frameRadiusM(
  place: { lon: number; lat: number; name?: string; kind?: string },
  stops: readonly FrameStop[],
  frame: FrameStops,
): number {
  const fallback = FRAME_RADIUS_M[frame];
  if (stops.length === 0 || !located(place)) return fallback;
  const clamp = (m: number): number => Math.min(FRAME_RADIUS_MAX_M, Math.max(FRAME_RADIUS_MIN_M, m));
  if (lineIndex(stops).tram.some((stop) => distanceM(place, stop) <= FRAME_TRAM_REACH_M)) {
    let radius = -Infinity;
    for (const n of FRAME_STOPS) {
      if (n > frame) break;
      const along = alongTheLines(place, stops, n);
      if (along === null) return fallback;
      radius = Math.max(radius, along);
    }
    return Number.isFinite(radius) ? clamp(radius) : fallback;
  }
  const own = place.name !== undefined && place.kind !== 'address' ? normalName(place.name) : null;
  const { names } = lineIndex(stops);
  const nearest = new Map<string, number>();
  for (const stop of stops) {
    if (stop.tram) continue;
    const name = names.get(stop)!;
    if (name === own) continue;
    const d = distanceM(place, stop);
    if (!Number.isFinite(d)) continue;
    const seen = nearest.get(name);
    if (seen === undefined || d < seen) nearest.set(name, d);
  }
  const nth = [...nearest.values()].sort((a, b) => a - b)[frame - 1] ?? FRAME_RADIUS_MAX_M;
  return clamp(nth);
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
