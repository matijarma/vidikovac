// The pure data behind the transport sheet: what runs right now, which way
// a vehicle faces, what a route or a stop is made of, and which ZET notices
// belong beside the closures. No DOM, so every function here is unit-tested
// in node. Every vehicle figure is the motion model's own estimate
// (VehicleInfo, city-map.ts), never a reported position (R-P2).
//
// Arrival times are not made here either -- they are shared/city/arrivals.ts's,
// estimated from ZET's own vehicle data joined to the schedule and labelled on
// every row as live or by the timetable.
import type { FeedItem, ModuleSnapshot } from '../../../worker/feed/schema';
import type { I18n } from '../i18n/i18n';
import { summariseRoutes, type RouteSummaryRow } from '../layers/route-summary';
import { MAX_ROUTE_DELAY_SECONDS, plausibleRouteDelay } from '../layers/shared';
import type { VehicleInfo } from '../map/city-map';
import type { GraphNetwork, Network } from '../../../shared/motion/network';
import { STOP_ZONE_M } from '../../../shared/motion/speed';
import { compassKey } from '../motion/vehicle-card';
import type { StopGroup } from './search';
import { vetExternal } from '../../../shared/kiosk/external-text-boundary';
import { DEPOT_RUNS } from '../../../shared/city/depot-run';
import type { ArrivalRow } from '../../../shared/city/arrivals';
import { mainShapes } from '../../../shared/motion/network-client';

/** The vehicles whose GTFS type `modes` admits; null admits all. */
export function vehiclesOfModes(vehicles: readonly VehicleInfo[], modes: ReadonlySet<number> | null): VehicleInfo[] {
  return modes ? vehicles.filter((v) => modes.has(v.type)) : [...vehicles];
}

/** One row per route with a vehicle moving now, trams first, with the route's delay in words. */
export function runningRoutes(vehicles: readonly VehicleInfo[], delays: ReadonlyMap<string, number>, i18n: I18n): RouteSummaryRow[] {
  const known = vehicles.filter((v): v is VehicleInfo & { routeId: string } => v.routeId !== undefined);
  // The overview already explains missing readings. A route without its own
  // median needs no repeated label; it must never be described as on time.
  // A pull-in is its own row, ST or SD, never one of the line's (lineOf).
  return summariseRoutes(known.map((v) => ({ routeId: lineOf(v)!, label: v.short || v.routeId, type: v.type })), delays, i18n).map((row) =>
    delays.has(row.routeId) ? row : { ...row, word: '' },
  );
}

/** The line a vehicle counts under: its route id, or ST or SD on a pull-in,
 *  which is no longer its line's vehicle (shared/city/depot-run.ts). */
export function lineOf(v: VehicleInfo): string | undefined {
  return v.depot ?? v.routeId;
}

export function vehiclesOnRoute(vehicles: readonly VehicleInfo[], routeId: string): VehicleInfo[] {
  return vehicles.filter((v) => lineOf(v) === routeId);
}

/** Vehicles of the routes that call at `stop`, the stop's own order of routes. */
export function vehiclesAtStop(vehicles: readonly VehicleInfo[], stop: StopGroup): VehicleInfo[] {
  const routes = new Set(stop.routes);
  return vehicles.filter((v) => { const line = lineOf(v); return line !== undefined && routes.has(line); });
}

/** Vehicles moving now per route id; a pull-in under ST or SD. */
export function countByRoute(vehicles: readonly VehicleInfo[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const v of vehicles) { const line = lineOf(v); if (line !== undefined) counts.set(line, (counts.get(line) ?? 0) + 1); }
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
/** "smjer {headsign}" from the twin's join; failing that a terminus the network names, else the compass. The headsign
 *  and the terminus are GTFS text, vetted on the row surface: one that fails falls through to the next source. */
export function vehicleDirection(i18n: I18n, net: Network | null, v: VehicleInfo): string {
  // A pull-in heads for its depot, named as the tram's own sign names it (shared/city/depot-run.ts).
  if (v.depot) return i18n.t('motion.direction', { towards: DEPOT_RUNS[v.depot].name });
  const headsign = v.headsign ? vetExternal('headsign', v.headsign, 'row') : null;
  if (headsign) return i18n.t('motion.direction', { towards: headsign });
  if (v.bearing === null) return i18n.t('motion.directionUnknown');
  const terminus = net && v.onShape !== null ? vetExternal('name', terminusName(net, v.onShape) ?? '', 'row') : null;
  const towards = terminus ?? i18n.t(`motion.compass.${compassKey(headingFromBearing(v.bearing))}`);
  return i18n.t('motion.direction', { towards });
}

/** "sljedeće stajalište X" when the twin names a next stop the network knows, else null. */
export function vehicleNextStop(i18n: I18n, net: Network | null, v: VehicleInfo): string | null {
  if (!net || v.nextStopId === undefined) return null;
  // The network's stop names are GTFS text: vetted on the row surface before the sentence names one.
  const name = vetExternal('name', net.stops.find((s) => s.id === v.nextStopId)?.name ?? '', 'row');
  return name ? i18n.t('motion.nextStop', { stop: name }) : null;
}

/** How many stops "dalje" names before it skips to the last: a pull-in's own
 *  streets run from three stops (Selska, Ljubljanica) to a dozen. */
export const AHEAD_STOPS_MAX = 8;

/**
 * "dalje: Tehnički muzej, Badalićeva, …, Ljubljanica": the platforms a
 * pull-in still serves after its next one, in its own path's order, to the
 * last. A tram on its way to the depot leaves its line (shared/city/
 * depot-run.ts), so a rider needs to see where it goes. Null for every other
 * vehicle, and off a rail path (a shape's stops are the ones near it, either
 * side of the street, not the ones it serves).
 */
export function vehicleAhead(i18n: I18n, net: Network | GraphNetwork | null, v: VehicleInfo): string | null {
  // The lightweight artefact carries no rail graph (R-L4), and then there is no served order to read.
  if (!v.depot || !net || !('stopsOnPath' in net) || v.path === undefined || v.s === undefined) return null;
  const at = v.s;
  const names: string[] = [];
  for (const { stop, s } of net.stopsOnPath(v.path)) {
    if (s <= at + STOP_ZONE_M || stop.id === v.nextStopId) continue;
    const name = vetExternal('name', stop.name, 'row');
    if (name && !names.includes(name)) names.push(name);
  }
  if (names.length === 0) return null;
  const stops = names.length > AHEAD_STOPS_MAX ? `${names.slice(0, AHEAD_STOPS_MAX - 1).join(', ')} … ${names.at(-1)!}` : names.join(', ');
  return i18n.t('motion.ahead', { stops });
}

/** Where each depot's pull-ins set down their last passengers (feed 000396). */
const DEPOT_ENDS: Readonly<Record<'ST' | 'SD', readonly string[]>> = { ST: ['Ljubljanica'], SD: ['Mandlova', 'Dubrava', 'Ravnice'] };

/**
 * "preko stajališta Tehnički muzej": where a pull-in leaves its line after
 * this stop, the first platform it serves that the line's normal route does
 * not (shared/city/depot-run.ts). The 17 for Trešnjevka runs the line from
 * Borongaj to Vodnikova and turns off at Tehnički muzej; a rider at Vodnikova
 * going to Prečko must not board it. Read on the tram's own path when a
 * tracked vehicle carries the row, else on every pull-in path of the line
 * through this stop, and said only when they agree. Null on a pull-in that
 * stays on its line to the end (4 and 11 Dubec to Dubrava, 7 Savski most to
 * Ravnice) and off the rail graph.
 */
export function depotVia(i18n: I18n, net: Network | GraphNetwork | null, row: ArrivalRow, stopIds: readonly string[], vehicles: readonly VehicleInfo[]): string | null {
  if (!row.depot || !net || !('stopsOnPath' in net)) return null;
  const main = new Set(mainShapes(net, row.routeId));
  const ends = DEPOT_ENDS[row.depot];
  const lineStops = new Set<string>();
  const pullIns: number[] = [];
  net.paths.forEach((path, i) => {
    if (path.route !== row.routeId || path.shape === null) return;
    if (main.has(path.shape)) for (const { stop } of net.stopsOnPath(i)) lineStops.add(stop.id);
    // A path that ends where this depot's pull-ins end; a short turn ends on the line.
    else if (ends.includes(net.stopsOnPath(i).at(-1)?.stop.name ?? '')) pullIns.push(i);
  });
  if (lineStops.size === 0) return null;
  const carried = row.vehicleId === undefined ? undefined : vehicles.find((v) => v.id === row.vehicleId)?.path;
  const here = new Set(stopIds);
  // Each candidate's platforms off the line after this stop, in order. A pull-in that stays on its line from here to
  // the end has none and no turn to name.
  const offLine: string[][] = [];
  for (const pathIdx of carried === undefined ? pullIns : [carried]) {
    const served = net.stopsOnPath(pathIdx);
    const at = served.findIndex((entry) => here.has(entry.stop.id));
    if (at < 0) continue;
    const names = served.slice(at + 1).filter((entry) => !lineStops.has(entry.stop.id)).map((entry) => entry.stop.name);
    if (names.length > 0) offLine.push(names);
  }
  // The first such platform every candidate calls at: the 17 from Vodnikova goes by Tehnički muzej whether it loops
  // round Zrinjevac first or not.
  const first = offLine[0]?.find((name) => offLine.every((names) => names.includes(name)));
  if (first === undefined) return null;
  const name = vetExternal('name', first, 'row');
  return name ? i18n.t('arrivals.depotVia', { stop: name }) : null;
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
