// Static GTFS route names, downloaded by scripts/gtfs-routes.mjs (Area E, R-10).
// This is the only module that imports the JSON, so a missing file breaks in one
// obvious place instead of seven.
//
// RULING (C5): the brief's illustrative snippet assumed a flat
// `Record<string, string>`; the file Area E actually landed keys each route id
// to `{ shortName, longName, type }` (GTFS route_short_name/long_name/route_type).
// Adapted to the real shape rather than the assumed one; `routeName`'s exported
// signature is unchanged.
import routes from './zet-routes.json';

export interface GtfsRoute {
  shortName: string;
  longName: string;
  /** GTFS route_type: 0 tram, 3 bus. */
  type: number;
}

export const ZET_ROUTES = routes as Record<string, GtfsRoute>;

/** '6' -> '6 · Črnomerec-Sopot'; unknown ids fall back to the id itself. */
export function routeName(routeId: string): string {
  const route = ZET_ROUTES[routeId];
  return route?.longName ? `${routeId} · ${route.longName}` : routeId;
}
