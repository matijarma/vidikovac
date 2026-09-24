// The twin's state as the feed pipeline's payload: the same items
// worker/feed/modules/zet-rt.ts always published (one `vehicle:` pin per
// vehicle, one `route:` median-delay row per route), with what only an
// engine that outlives a page can say: the pin sits where the plan puts the
// vehicle at the header (R-TE13, so R-P2 holds on the wire: a reported
// position is never shown), the motion carries the plan the client
// integrates (R-TE2), and the scalars carry the twin's own speed,
// confidence and standing state (R-TE1) beside the static join.

import { toLonLat } from '../../shared/motion/geo';
import type { GraphNetwork } from '../../shared/motion/network';
import { evalFreePlan, evalPathPlan } from '../../shared/motion/plan';
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
import type { TwinState } from './state';
import { BUILT_AT } from '../../app/src/motion/network-meta';

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
  /** The plan stands beyond the zone of the last platform its path serves: the terminus loop's run-out. */
  pastLast: boolean;
  /** The first platform of the path when the plan stands still short of STAND_PAST_FIRST_M beyond its zone: a
   *  terminus stand whose projection onto the departure rails lies past the platform the trip starts at. */
  standShortOf: string | null;
}

/** How far past its path's first platform a standing tram is still read as waiting at the terminus stand: the
 *  stands project 97 to 272 m along the departure rails past the platform (Zapruđe on route 8, Dubrava on 7). */
const STAND_PAST_FIRST_M = 300;

/** The pin's position and the wire form of the plan, at the header. */
function place(track: Track, net: GraphNetwork | null): Placed {
  const last = lastFix(track)!;
  const plan = track.plan;
  if (!plan) return { lon: last.lon, lat: last.lat, held: false, pastLast: false, standShortOf: null };
  if (plan.on === 'free') {
    const [lon, lat] = evalFreePlan(plan.knots, 0);
    return { lon, lat, motion: { plan: wireFreeKnots(plan.knots) }, held: false, pastLast: false, standShortOf: null };
  }
  if (!net) return { lon: last.lon, lat: last.lat, held: false, pastLast: false, standShortOf: null };
  const s = evalPathPlan(plan.knots, 0);
  // Standing: the plan is flat over the next second and a stop is within its zone.
  const flat = Math.abs(evalPathPlan(plan.knots, 1) - s) < 0.05;
  if (plan.on === 'path') {
    const [lon, lat] = toLonLat(net.toPathPoint(plan.pathIdx, s));
    const served = net.stopsOnPath(plan.pathIdx);
    const atStop = served.some((entry) => Math.abs(entry.s - s) <= STOP_ZONE_M);
    const first = served[0];
    const last = served[served.length - 1];
    const standShortOf = flat && !atStop && first !== undefined && s > first.s + STOP_ZONE_M && s - first.s <= STAND_PAST_FIRST_M ? first.stop.id : null;
    return { lon, lat, motion: { path: net.paths[plan.pathIdx].id, plan: wirePathKnots(plan.knots) }, held: flat && atStop, pastLast: last !== undefined && s > last.s + STOP_ZONE_M, standShortOf };
  }
  const shape = net.shapes[plan.shapeIdx];
  const [lon, lat] = toLonLat(at(shape.pts, shape.cum, s));
  const before = net.nextStop(plan.shapeIdx, s - STOP_ZONE_M - 0.5);
  const atStop = before !== null && Math.abs(before.s - s) <= STOP_ZONE_M;
  return { lon, lat, motion: { path: shape.id, plan: wirePathKnots(plan.knots) }, held: flat && atStop, pastLast: false, standShortOf: null };
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

  const tracks = Object.values(state.tracks).filter((t) => t.fixes.length > 0).sort((a, b) => a.id.localeCompare(b.id));
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
    // standing at a terminus stand that projects onto the departure rails past
    // the trip's first platform has not served it yet: ZET's TripUpdate still
    // names it, and the wire keeps it (the twin's plan reads the platform as
    // passed and names the stop beyond; the stands project 97 to 272 m past
    // the platform at Zapruđe and Dubrava).
    const nextStopId = placed.pastLast
      ? undefined
      : placed.standShortOf !== null && next?.stopId === placed.standShortOf
        ? next.stopId
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
  // whether the 6 is late, not what the delay is at stop 311_1.
  const byRoute = new Map<string, { delays: number[]; trips: number }>();
  for (const update of Object.values(state.tripUpdates)) {
    if (!update.routeId) continue;
    const bucket = byRoute.get(update.routeId) ?? { delays: [], trips: 0 };
    bucket.delays.push(...update.delays);
    bucket.trips++;
    byRoute.set(update.routeId, bucket);
  }
  for (const [routeId, bucket] of [...byRoute].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (bucket.delays.length === 0) continue;
    const medianDelaySeconds = median(bucket.delays);
    items.push({
      id: `route:${routeId}`,
      kind: 'vehicle',
      title: routeLabel(routeId, routes),
      summary: delayWords(medianDelaySeconds),
      data: { routeId, routeShortName: routeShortName(routeId, routes), medianDelaySeconds, vehicles: bucket.trips },
    });
  }

  const fresh = headerTs !== null && nowMs - headerTs * 1000 <= SOURCE_STALE_AFTER_MS;
  const zet: SourceAvailability = {
    status: fresh ? 'live' : 'stale',
    itemCount: tracks.length,
    ...(state.tickAtMs > 0 ? { fetchedAt: iso(state.tickAtMs) } : {}),
    ...(headerTs !== null ? { sourceUpdatedAt: iso(headerTs * 1000) } : {}),
  };

  return {
    items,
    ...(headerTs !== null ? { sourceUpdatedAt: iso(headerTs * 1000) } : {}),
    validUntil: iso(validUntilMs),
    sources: { [SOURCE_KEY]: zet },
  };
}
