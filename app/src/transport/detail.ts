// The pure data behind the transport sheet: what runs right now, which way
// a vehicle faces, what a route or a stop is made of, and which ZET notices
// belong beside the closures. No DOM, so every function here is unit-tested
// in node. Every vehicle figure is the motion model's own estimate
// (VehicleInfo, city-map.ts), never a reported position (R-P2), and nothing
// here computes an arrival time: ZET publishes none, and the sheet says so
// instead of inventing one.
import type { FeedItem, ModuleSnapshot } from '../../../worker/feed/schema';
import type { I18n } from '../i18n/i18n';
import { summariseRoutes, type RouteSummaryRow } from '../layers/route-summary';
import { MAX_ROUTE_DELAY_SECONDS, plausibleRouteDelay } from '../layers/shared';
import type { VehicleInfo } from '../map/city-map';
import type { Network } from '../motion/network';
import { compassKey } from '../motion/vehicle-card';
import type { StopGroup } from './search';

/** The vehicles whose GTFS type `modes` admits; null admits all. */
export function vehiclesOfModes(vehicles: readonly VehicleInfo[], modes: ReadonlySet<number> | null): VehicleInfo[] {
  return modes ? vehicles.filter((v) => modes.has(v.type)) : [...vehicles];
}

/** One row per route with a vehicle moving now, trams first, with the route's delay in words. */
export function runningRoutes(vehicles: readonly VehicleInfo[], delays: ReadonlyMap<string, number>, i18n: I18n): RouteSummaryRow[] {
  const known = vehicles.filter((v): v is VehicleInfo & { routeId: string } => v.routeId !== undefined);
  // The overview already explains missing readings. A route without its own
  // median needs no repeated label; it must never be described as on time.
  return summariseRoutes(known.map((v) => ({ routeId: v.routeId, label: v.short || v.routeId, type: v.type })), delays, i18n).map((row) =>
    delays.has(row.routeId) ? row : { ...row, word: '' },
  );
}

export function vehiclesOnRoute(vehicles: readonly VehicleInfo[], routeId: string): VehicleInfo[] {
  return vehicles.filter((v) => v.routeId === routeId);
}

/** Vehicles of the routes that call at `stop`, the stop's own order of routes. */
export function vehiclesAtStop(vehicles: readonly VehicleInfo[], stop: StopGroup): VehicleInfo[] {
  const routes = new Set(stop.routes);
  return vehicles.filter((v) => v.routeId !== undefined && routes.has(v.routeId));
}

/** Vehicles moving now per route id. */
export function countByRoute(vehicles: readonly VehicleInfo[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const v of vehicles) if (v.routeId !== undefined) counts.set(v.routeId, (counts.get(v.routeId) ?? 0) + 1);
  return counts;
}

/** Compatibility name; all surfaces use the same presentation bound. */
export const MAX_ROUTE_DELAY_S = MAX_ROUTE_DELAY_SECONDS;

/** The medians a screen may rank and print; an implausible one is left out, never shown as minutes. */
export function plausibleDelays(delays: ReadonlyMap<string, number>): Map<string, number> {
  return new Map([...delays].filter(([, seconds]) => plausibleRouteDelay(seconds)));
}

/** The last stop along shape `shapeIdx`, its terminus, or null when the artefact names none. */
export function terminusName(net: Network, shapeIdx: number): string | null {
  let best: { name: string; s: number } | null = null;
  for (const stop of net.stops) {
    for (const on of stop.on) {
      if (on.shape === shapeIdx && (best === null || on.s > best.s)) best = { name: stop.name, s: on.s };
    }
  }
  return best?.name ?? null;
}

/** Compass degrees clockwise from north to a plane heading (x east, y north). */
export function headingFromBearing(bearing: number): { x: number; y: number } {
  const rad = (bearing * Math.PI) / 180;
  return { x: Math.sin(rad), y: Math.cos(rad) };
}

/**
 * "smjer Sopot" for a vehicle whose facing the model knows: the terminus of
 * the shape it is on, else the compass point; "smjer nepoznat" whenever the
 * model has no heading (decision 5), never a guess.
 */
export function vehicleDirection(i18n: I18n, net: Network | null, v: VehicleInfo): string {
  if (v.headsign) return i18n.t('motion.direction', { towards: v.headsign });
  if (v.bearing === null) return i18n.t('motion.directionUnknown');
  const terminus = net && v.onShape !== null ? terminusName(net, v.onShape) : null;
  const towards = terminus ?? i18n.t(`motion.compass.${compassKey(headingFromBearing(v.bearing))}`);
  return i18n.t('motion.direction', { towards });
}

/** The two ZET feeds inside the events module (worker/feed/modules/dogadanja/zet-rss.ts). */
export const ZET_NOTICE_SOURCES: readonly string[] = ['zet-promet', 'zet-novosti'];

function itemTime(item: FeedItem): number {
  const t = item.at === undefined ? Number.NaN : Date.parse(item.at);
  return Number.isFinite(t) ? t : 0;
}

/** ZET's own traffic and service notices, newest first, when the page has the events snapshot at all. */
export function zetNotices(snapshot: ModuleSnapshot | undefined, limit = 6): FeedItem[] {
  return (snapshot?.items ?? [])
    .filter((item) => ZET_NOTICE_SOURCES.includes(String(item.data?.source ?? '')))
    .sort((a, b) => itemTime(b) - itemTime(a))
    .slice(0, limit);
}

/** Street closures with a drawable line, in the module's own order. */
export function closureItems(snapshot: ModuleSnapshot | undefined): FeedItem[] {
  return (snapshot?.items ?? []).filter((item) => item.kind === 'closure');
}
