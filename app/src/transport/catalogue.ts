// The catalogues the workspace searches and describes: the static GTFS route
// table (data/routes.ts, in every graph already) and the stops -- grouped by
// name, since GTFS lists one platform per direction -- from whichever source
// the page has: the network artefact the map already decoded (no second
// fetch), or the small /data/stops.json catalogue when there is no map to
// have loaded one. Pure: no DOM, no fetching.
import type { ScreenStop } from '../core/contracts';
import { ZET_ROUTES } from '../data/routes';
import { toLonLat } from '../motion/geo';
import type { Network } from '../motion/network';
import { compareRouteShort, sortRoutes, type RouteEntry, type StopGroup } from './search';

let routes: RouteEntry[] | null = null;

/** Every route GTFS knows, trams first, then by number as read. */
export function routeCatalogue(): RouteEntry[] {
  routes ??= sortRoutes(Object.entries(ZET_ROUTES).map(([id, route]) => ({ id, short: route.shortName || id, long: route.longName, type: route.type })));
  return routes;
}

/**
 * The line's two ends as one readable phrase. GTFS writes them with a hyphen
 * in three spellings ("Črnomerec-Sopot", "Ljubljanica -Savišće", "Savski
 * most - Dubec"); every spelling becomes "Črnomerec – Sopot". No arrow: the
 * data names no direction from a given stop, so none is claimed.
 */
export function routeEnds(longName: string): string {
  return longName.split(/\s*[-\u2013]\s*/).map((part) => part.trim()).filter(Boolean).join(' \u2013 ');
}

/** One route by id; an id GTFS dropped still gets an honest entry (its own
 *  id as the number, no name, type -1 for "unknown"). */
export function routeEntry(routeId: string): RouteEntry {
  const route = ZET_ROUTES[routeId];
  return route ? { id: routeId, short: route.shortName || routeId, long: route.longName, type: route.type } : { id: routeId, short: routeId, long: '', type: -1 };
}

interface PlatformRow {
  id: string;
  name: string;
  lon: number;
  lat: number;
  routes: readonly string[];
}

function groupPlatforms(rows: readonly PlatformRow[]): StopGroup[] {
  const byName = new Map<string, { ids: string[]; lon: number; lat: number; routes: Set<string> }>();
  for (const row of rows) {
    const name = row.name.trim();
    if (!name || !Number.isFinite(row.lon) || !Number.isFinite(row.lat)) continue;
    const group = byName.get(name) ?? { ids: [], lon: 0, lat: 0, routes: new Set<string>() };
    group.ids.push(row.id);
    group.lon += row.lon;
    group.lat += row.lat;
    for (const route of row.routes) group.routes.add(route);
    byName.set(name, group);
  }
  return [...byName.entries()]
    .map(([name, group]) => {
      const ids = [...group.ids].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
      return {
        id: ids[0]!,
        ids,
        name,
        lon: group.lon / group.ids.length,
        lat: group.lat / group.ids.length,
        routes: [...group.routes].sort(compareRouteShort),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'hr'));
}

/** Named stops from the network artefact: each platform's routes are the
 *  routes of the shapes it lies on. */
export function stopGroupsFromNetwork(net: Network): StopGroup[] {
  return groupPlatforms(
    net.stops.map((stop) => {
      const [lon, lat] = toLonLat(stop.p);
      const onRoutes = new Set<string>();
      for (const on of stop.on) {
        const route = net.shapes[on.shape]?.route;
        if (route) onRoutes.add(route);
      }
      return { id: stop.id, name: stop.name, lon, lat, routes: [...onRoutes] };
    }),
  );
}

/** Named stops from /data/stops.json (core/screens.ts's loadStops). */
export function stopGroupsFromCatalogue(stops: readonly ScreenStop[]): StopGroup[] {
  return groupPlatforms(stops);
}

/** The group holding platform `id` (any of its platforms). */
export function stopGroupById(groups: readonly StopGroup[], id: string): StopGroup | undefined {
  return groups.find((group) => group.ids.includes(id));
}

export interface RouteStop {
  id: string;
  name: string;
  lon: number;
  lat: number;
  /** Arc length along the route's fullest shape, metres. */
  s: number;
}

/** The shape index with the greatest length among a route's variants: the
 *  fullest run, which is what a person means by "the stops on the 6". */
export function fullestShape(net: Network, routeId: string): number | null {
  const route = net.routes.get(routeId);
  if (!route || route.shapes.length === 0) return null;
  let best: number | null = null;
  let bestLen = -1;
  for (const idx of route.shapes) {
    const shape = net.shapes[idx];
    const len = shape ? shape.cum[shape.cum.length - 1] ?? 0 : -1;
    if (len > bestLen) {
      bestLen = len;
      best = idx;
    }
  }
  return best;
}

/** Stops along the route's fullest shape in travel order, one per name. */
export function routeStopSequence(net: Network, routeId: string): RouteStop[] {
  const idx = fullestShape(net, routeId);
  if (idx === null) return [];
  const along: RouteStop[] = [];
  for (const stop of net.stops) {
    for (const on of stop.on) {
      if (on.shape !== idx) continue;
      const [lon, lat] = toLonLat(stop.p);
      along.push({ id: stop.id, name: stop.name, lon, lat, s: on.s });
    }
  }
  along.sort((a, b) => a.s - b.s);
  return along.filter((stop, i) => i === 0 || stop.name !== along[i - 1]!.name);
}
