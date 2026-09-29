// The twin's state as the feed pipeline's payload: the same items
// worker/feed/modules/zet-rt.ts always published (one `vehicle:` pin per
// vehicle seen now, one `route:` median-delay row per route with a pin; a
// vehicle in a depot or parked stays in the state, off the wire), with
// what only an engine that outlives a page can say: the pin sits where the
// plan puts the vehicle at the header (R-TE13, so R-P2 holds on the wire: a
// reported position is never shown), the motion carries the plan the
// client integrates (R-TE2), and the scalars carry the twin's own speed,
// confidence and standing state (R-TE1) beside the static join.

import { toLonLat } from '../../shared/motion/geo';
import type { GraphNetwork } from '../../shared/motion/network';
import { inDepot, isParked } from '../../shared/motion/depots';
import { evalFreePlan, evalPathPlan, EVICT_S, FUTURE_TOLERANCE_S } from '../../shared/motion/plan';
import { at } from '../../shared/motion/polyline';
import { STOP_ZONE_M } from '../../shared/motion/speed';
import { lastFix, type FreeKnot, type PathKnot, type Track } from '../../shared/motion/track';
import type { VehicleMotion } from '../../shared/motion/wire';
import type { FeedPayload, ItemInput } from '../feed/payload';
import { compactData } from '../feed/payload';
import type { SourceAvailability } from '../feed/schema';
import { delayWords, routeLabel, routeShortName, routeType } from '../feed/modules/zet-rt';
import type { ZetRoutes } from '../feed/modules/zet-routes';
import { FEED_TICK_MS } from './clock';
import { noServiceTripIds, operatorSummary } from './operator';
import { emptyService, serviceOnWire } from './service';
import type { TwinState } from './state';
import { BUILT_AT } from '../../app/src/motion/network-meta';

// U2's judgement carries the operator's summary beside it (`service.operator`, shared/city/service-wire.ts): the
// integrator's one line at the `zet` source below is `{ ...service, operator: operatorSummary(state.operator, carried,
// nowSec) }`, with `carried` and `nowSec` from buildPayload. Exported so that line needs no other import.
export { operatorSummary };

/** What the trip index says about a realtime trip id. */
export interface TripJoin {
  direction: 0 | 1;
  headsign: string;
  /** GTFS service_id; absent when the source has no service information. */
  service?: string;
  /** The GTFS shape id, or null for a pattern whose trips carry none (line 1). */
  shapeId: string | null;
  /** The id of the path the pattern runs, resolved once when the index loaded
   *  (times.ts mapPatternsToPaths). It is what makes a shapeless trip adopt
   *  the synthetic path built from ITS OWN stop sequence rather than the
   *  route and direction's first; absent where the join came from a source
   *  that never resolved it, and then the matcher falls back to that first. */
  pathId?: string;
  /** The trip's first scheduled departure, seconds past service midnight
   *  (R-TE49); absent where the join comes from a source without it. */
  startSec?: number;
}

/** ZET reads as stale once three republishes have gone by without a new
 *  header: one miss is a late file, two a hiccup, three a source that has
 *  stopped talking. The snapshot's own `status` stays the twin's health
 *  (R-TE5); this only tells the client how fresh the evidence is. */
export const SOURCE_STALE_AFTER_MS = 3 * FEED_TICK_MS;

export const SOURCE_KEY = 'zet';

/** Coordinates on the wire keep the feed's own precision (~1.1 m). */
const COORD_PRECISION = 1e5;
/** Arcs on the wire keep a decimetre: finer than the feed's own ~1.1 m, coarse
 *  enough that a plan of a dozen knots costs tens of bytes, not full-width
 *  floats (R-TE13). Knot times are integer seconds already. */
const ARC_PRECISION = 10;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function round(value: number, precision: number): number {
  return Math.round(value * precision) / precision;
}

function wirePathKnots(knots: readonly PathKnot[]): PathKnot[] {
  return knots.map(([t, s]) => [Math.round(t), round(s, ARC_PRECISION)]);
}

function wireFreeKnots(knots: readonly FreeKnot[]): FreeKnot[] {
  return knots.map(([t, lon, lat]) => [Math.round(t), round(lon, COORD_PRECISION), round(lat, COORD_PRECISION)]);
}

interface Placed {
  lon: number;
  lat: number;
  motion?: VehicleMotion;
  held: boolean;
  /** The anchor (the fix's arc, not the plan's arc at the header, which the order law may have pushed ahead) lies
   *  beyond the zone of the last platform its path serves: the terminus loop's run-out. */
  pastLast: boolean;
}

/**
 * The vehicles the twin publishes as pins, sorted by id: a last fix stamped
 * inside (nowSec - EVICT_S, nowSec + FUTURE_TOLERANCE_S], not inside a tram
 * depot, not parked (shared/motion/depots.ts). The one answer to "how many
 * vehicles are out there now": it is the payload's `itemCount` and the count
 * on the `route:` rows. Trip updates count nothing here: a trip ZET estimates
 * without a position is not a vehicle anyone can see.
 */
export function fleetSeen(tracks: readonly Track[], nowSec: number): Track[] {
  return tracks
    .filter((track) => {
      const last = lastFix(track);
      if (last === null || last.atSec <= nowSec - EVICT_S || last.atSec > nowSec + FUTURE_TOLERANCE_S) return false;
      return !inDepot(last.lon, last.lat) && !isParked(track);
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** The pin's position and the wire form of the plan, at the header. */
function place(track: Track, net: GraphNetwork | null): Placed {
  const last = lastFix(track)!;
  const plan = track.plan;
  if (!plan) return { lon: last.lon, lat: last.lat, held: false, pastLast: false };
  if (plan.on === 'free') {
    const [lon, lat] = evalFreePlan(plan.knots, 0);
    return { lon, lat, motion: { plan: wireFreeKnots(plan.knots) }, held: false, pastLast: false };
  }
  if (!net) return { lon: last.lon, lat: last.lat, held: false, pastLast: false };
  const s = evalPathPlan(plan.knots, 0);
  // Standing: the plan is flat over the next second and a stop is within its zone.
  const flat = Math.abs(evalPathPlan(plan.knots, 1) - s) < 0.05;
  if (plan.on === 'path') {
    const [lon, lat] = toLonLat(net.toPathPoint(plan.pathIdx, s));
    const served = net.stopsOnPath(plan.pathIdx);
    const atStop = served.some((entry) => Math.abs(entry.s - s) <= STOP_ZONE_M);
    const last = served[served.length - 1];
    const anchor = plan.knots[0][1];
    return { lon, lat, motion: { path: net.paths[plan.pathIdx].id, plan: wirePathKnots(plan.knots) }, held: flat && atStop, pastLast: last !== undefined && anchor > last.s + STOP_ZONE_M };
  }
  const shape = net.shapes[plan.shapeIdx];
  const [lon, lat] = toLonLat(at(shape.pts, shape.cum, s));
  const before = net.nextStop(plan.shapeIdx, s - STOP_ZONE_M - 0.5);
  const atStop = before !== null && Math.abs(before.s - s) <= STOP_ZONE_M;
  return { lon, lat, motion: { path: shape.id, plan: wirePathKnots(plan.knots) }, held: flat && atStop, pastLast: false };
}

export function buildPayload(
  state: TwinState,
  joins: ReadonlyMap<string, TripJoin>,
  routes: ZetRoutes,
  nowMs: number,
  validUntilMs: number,
  net: GraphNetwork | null,
): FeedPayload {
  const items: ItemInput[] = [];
  const headerTs = state.headerTs;

  const tracks = fleetSeen(Object.values(state.tracks), Math.floor(nowMs / 1000));
  // The trips some tracked vehicle carries (U1): a NO_SERVICE alert names a
  // trip ZET will not run, and one vehicle in 83 ran it anyway. Read from every
  // track with a fix, before fleetSeen's depot and parked filter, so a parked
  // vehicle holding a trip keeps its departure (the safe side).
  const carried = new Set(
    Object.values(state.tracks)
      .filter((t) => t.fixes.length > 0)
      .map((t) => t.tripId)
      .filter((id): id is string => id !== null),
  );
  for (const track of tracks) {
    const last = lastFix(track)!;
    const routeId = track.routeId;
    const join = track.tripId !== null ? joins.get(track.tripId) : undefined;
    const next = track.tripId !== null ? state.tripUpdates[track.tripId] : undefined;
    const placed = place(track, net);
    // On a rail path the twin's own next stop goes on the wire: the platform
    // whose zone its anchor lies in, else the first served platform ahead,
    // one per visit (plan.ts, rail round 3). ZET's TripUpdate names a stop by
    // the first time it still has ahead, and at a platform that time passes
    // and returns with every re-estimate while the tram stands there, so the
    // wall's "sada" row vanished and came back (305 of 334 backward moves in
    // one Monday hour were ZET's). Off every path ZET's stop names it where
    // it has one, the twin's shape plan otherwise. The twin's ETA rides
    // whenever the id that goes on the wire is the id it planned for --
    // whichever source named it -- and is withheld where the two disagree,
    // because an arrival time belongs to the stop it was computed for.
    // Past the last platform of its path (the terminus loop's run-out) the
    // trip has no next stop, and ZET's TripUpdate for a finished trip names
    // a passed stop's re-estimate or the trip's first platform (22134 at the
    // Dubrava loop, 21 Sep 17:16:57 to 17:22: Ravnice, Dubrava again,
    // Ljubljanica), so nothing goes on the wire until the trip changes. A tram
    // at a terminus stand that projects past the trip's first platform is the
    // planner's to name (STAND_PAST_FIRST_M, plan.ts).
    const nextStopId = placed.pastLast
      ? undefined
      : (track.plan?.on === 'path' ? track.next?.stopId : undefined) ?? next?.stopId ?? track.next?.stopId ?? undefined;
    const nextStopEtaSec = nextStopId !== undefined && track.next?.stopId === nextStopId ? track.next.etaSec ?? undefined : undefined;
    items.push({
      id: `vehicle:${track.id}`,
      kind: 'vehicle',
      title: routeLabel(routeId, routes),
      at: iso(last.atSec * 1000),
      geo: { type: 'Point', coordinates: [round(placed.lon, COORD_PRECISION), round(placed.lat, COORD_PRECISION)] },
      data: compactData({
        routeId: routeId || undefined,
        tripId: track.tripId ?? undefined,
        vehicleId: track.id,
        routeShortName: routeId ? routeShortName(routeId, routes) : undefined,
        routeType: routeId ? routeType(routeId, routes) : undefined,
        direction: join?.direction,
        headsign: join?.headsign,
        shapeId: join?.shapeId ?? undefined,
        nextStopId,
        // The twin's planned arrival at THAT stop, epoch seconds (WP5).
        nextStopEtaSec,
        delaySeconds: next?.delaySec ?? undefined,
        speed: round(track.speed, 10),
        confidence: round(track.confidence, 100),
        held: placed.held,
        // The ordering register's leader (E3), read fresh at every publish:
        // a relation that ended is off the wire the same tick it ended.
        behind: track.order.leader ?? undefined,
        // ZET's own CANCELED marker, kept beside the headsign and the next
        // stop: 114 of 143 trips so marked were driven, so it changes nothing.
        tripStatus: next?.canceled ? 'canceled' : undefined,
      }),
      ...(placed.motion ? { motion: {
        ...placed.motion,
        generatedAt: state.tickAtMs || nowMs,
        builtAt: BUILT_AT,
        ...(net ? { network: net.graphHash } : {}),
      } } : {}),
    });
  }

  // One summary row per route, never per stop (R-22, R-50): a rider asks
  // whether the 6 is late, not what the delay is at stop 311_1. Only for a
  // route with a vehicle on the map, and `vehicles` counts those pins: ZET's
  // trip updates outnumber the positioned vehicles, and a count that read
  // them promised vehicles nobody could see. The delay stays ZET's median.
  const pinsByRoute = new Map<string, number>();
  for (const track of tracks) if (track.routeId) pinsByRoute.set(track.routeId, (pinsByRoute.get(track.routeId) ?? 0) + 1);
  const delaysByRoute = new Map<string, number[]>();
  for (const update of Object.values(state.tripUpdates)) {
    if (!update.routeId || !pinsByRoute.has(update.routeId)) continue;
    const delays = delaysByRoute.get(update.routeId) ?? [];
    delays.push(...update.delays);
    delaysByRoute.set(update.routeId, delays);
  }
  for (const [routeId, delays] of [...delaysByRoute].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (delays.length === 0) continue;
    const medianDelaySeconds = median(delays);
    items.push({
      id: `route:${routeId}`,
      kind: 'vehicle',
      title: routeLabel(routeId, routes),
      summary: delayWords(medianDelaySeconds),
      data: { routeId, routeShortName: routeShortName(routeId, routes), medianDelaySeconds, vehicles: pinsByRoute.get(routeId)! },
    });
  }

  // A header ahead of the clock by more than the tolerance is not fresh
  // evidence either: the Durable Object refuses such a frame, and a state
  // that carries one must not read as live.
  const fresh = headerTs !== null && nowMs - headerTs * 1000 <= SOURCE_STALE_AFTER_MS && headerTs * 1000 <= nowMs + FUTURE_TOLERANCE_S * 1000;
  const nowSec = Math.floor(nowMs / 1000);
  const noServiceTrips = noServiceTripIds(state.operator, carried, nowSec);
  // The city's fleet against the timetable (service.ts, upgrade U2): additive,
  // and absent until the twin has taken a state. The module stays live
  // (R-TE5); a silent city is a verdict, not an outage.
  const service = serviceOnWire(state.service ?? emptyService());
  const zet: SourceAvailability = {
    status: fresh ? 'live' : 'stale',
    itemCount: tracks.length,
    ...(state.tickAtMs > 0 ? { fetchedAt: iso(state.tickAtMs) } : {}),
    ...(headerTs !== null ? { sourceUpdatedAt: iso(headerTs * 1000) } : {}),
    ...(noServiceTrips.length > 0 ? { noServiceTrips } : {}),
    // The operator's own statements ride beside the judgement (U1.md §0.1).
    ...(service ? { service: { ...service, operator: operatorSummary(state.operator, carried, nowSec) } } : {}),
  };

  return {
    items,
    ...(headerTs !== null ? { sourceUpdatedAt: iso(headerTs * 1000) } : {}),
    validUntil: iso(validUntilMs),
    sources: { [SOURCE_KEY]: zet },
  };
}
