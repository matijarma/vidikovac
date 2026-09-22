// Stop choice for the screen's settings panel (kiosk/settings.ts) and stop
// context for the compositions. Pure: the stop list is handed in
// (core/screens.ts's loadStops fetches it lazily, never on the lightweight
// entry graph), ranking and search happen here, and the Worker validates the
// id again when the screen is set.
import type { ScreenStop } from '../core/contracts';
import { ZET_ROUTES } from '../data/routes';
import { dist, toPlane, type XY } from '../../../shared/motion/geo';

export const DEFAULT_STOP_ID = '106_1';
/** Trg bana J. Jelačića, the point suggestions and stop lists rank around when nothing nearer is known. */
export const CITY_CENTRE: { readonly lon: number; readonly lat: number } = Object.freeze({ lon: 15.97726, lat: 45.81286 });

export interface RankedStop extends ScreenStop {
  /** Metres from the reference point, or null when there was none. */
  distanceM: number | null;
}

export function stopDistanceM(stop: { lon: number; lat: number }, to: { lon: number; lat: number }): number {
  return dist(toPlane(stop.lon, stop.lat), toPlane(to.lon, to.lat));
}

/** Lower case without diacritics (đ → d) and with single spaces: how typed text meets names. */
export function fold(text: string): string {
  return text
    .toLowerCase()
    .replace(/đ/g, 'd')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Route ids sorted the way a rider reads them: numeric first, then text. */
export function sortRouteIds(ids: readonly string[]): string[] {
  return [...ids].sort((a, b) => a.localeCompare(b, 'hr', { numeric: true }));
}

/** GTFS route_type from the static table: 0 tram, 3 bus, null when unknown. */
export function routeType(routeId: string): number | null {
  const route = ZET_ROUTES[routeId];
  return route ? route.type : null;
}

/** A stop any tram line serves (GTFS route_type 0). */
export function isTramStop(stop: { readonly routes: readonly string[] }): boolean {
  return stop.routes.some((routeId) => routeType(routeId) === 0);
}

export function routeLongName(routeId: string): string {
  return ZET_ROUTES[routeId]?.longName ?? '';
}

export interface RankOptions {
  /** Accent-insensitive substring match on the stop name; empty means all. */
  query?: string;
  /** Nearest-first ordering around this point (a district seat, a stop). */
  near?: { lon: number; lat: number } | null;
  limit?: number;
  /** Both platforms of a stop share a name; keep only the nearest of each name. */
  dedupeNames?: boolean;
}

/**
 * Stops matching `query`, nearest to `near` first (then by name), at most
 * `limit`. With no reference point the order is alphabetical, which is what
 * a typed search needs.
 */
export function rankStops(stops: readonly ScreenStop[], options: RankOptions = {}): RankedStop[] {
  const query = fold(options.query ?? '');
  const near = options.near ?? null;
  const limit = options.limit ?? 12;
  const nearXY: XY | null = near ? toPlane(near.lon, near.lat) : null;
  const matched: RankedStop[] = [];
  for (const stop of stops) {
    if (query && !fold(stop.name).includes(query)) continue;
    const distanceM = nearXY ? dist(toPlane(stop.lon, stop.lat), nearXY) : null;
    matched.push({ ...stop, distanceM });
  }
  matched.sort((a, b) => {
    if (a.distanceM !== null && b.distanceM !== null && a.distanceM !== b.distanceM) return a.distanceM - b.distanceM;
    return a.name.localeCompare(b.name, 'hr') || a.id.localeCompare(b.id, 'hr', { numeric: true });
  });
  if (!options.dedupeNames) return matched.slice(0, limit);
  const seen = new Set<string>();
  const out: RankedStop[] = [];
  for (const stop of matched) {
    if (seen.has(stop.name)) continue;
    seen.add(stop.name);
    out.push(stop);
    if (out.length >= limit) break;
  }
  return out;
}

export function stopById(stops: readonly ScreenStop[], id: string): ScreenStop | null {
  return stops.find((stop) => stop.id === id) ?? null;
}
