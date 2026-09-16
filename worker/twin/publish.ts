// The twin's state as the feed pipeline's payload: the same items
// worker/feed/modules/zet-rt.ts has always published (one `vehicle:` pin per
// vehicle, one `route:` median-delay row per route), plus what the twin
// knows and a single snapshot never could: the static-GTFS join of the trip
// (direction, headsign, shape), the trip update's next stop and delay, and
// the vehicle's own recent fixes (`motion.history`, R-TE2). Pure: the
// Durable Object hands it state, joins and routes and forwards the result.
//
// Phase A publishes the latest raw fix as the pin's position; from B5 the
// pin sits at the twin's estimate (R-TE13) and `motion` carries the plan.

import type { FeedPayload, ItemInput } from '../feed/payload';
import { compactData } from '../feed/payload';
import type { SourceAvailability } from '../feed/schema';
import { delayWords, routeLabel, routeShortName, routeType } from '../feed/modules/zet-rt';
import type { ZetRoutes } from '../feed/modules/zet-routes';
import type { HistoryFix, VehicleMotion } from '../../shared/motion/wire';
import { FEED_TICK_MS } from './clock';
import type { TwinState } from './history';

/** What the trip index says about a realtime trip id (task A1's index,
 *  copied into the twin's SQLite by persist.ts). */
export interface TripJoin {
  direction: 0 | 1;
  headsign: string;
  /** The GTFS shape id, or null for a pattern whose trips carry none (line 1). */
  shapeId: string | null;
}

/** ZET reads as stale once three republishes have gone by without a new
 *  header: one miss is a late file, two a hiccup, three a source that has
 *  stopped talking. The snapshot's own `status` stays the twin's health
 *  (R-TE5); this only tells the client how fresh the evidence is. */
export const SOURCE_STALE_AFTER_MS = 3 * FEED_TICK_MS;

export const SOURCE_KEY = 'zet';

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

export function buildPayload(
  state: TwinState,
  joins: ReadonlyMap<string, TripJoin>,
  routes: ZetRoutes,
  nowMs: number,
  validUntilMs: number,
): FeedPayload {
  const items: ItemInput[] = [];
  const headerTs = state.headerTs;

  const tracks = Object.values(state.vehicles).filter((t) => t.fixes.length > 0).sort((a, b) => a.vehicleId.localeCompare(b.vehicleId));
  for (const track of tracks) {
    const [atSec, lon, lat] = track.fixes[track.fixes.length - 1];
    const routeId = track.routeId ?? '';
    const join = track.tripId ? joins.get(track.tripId) : undefined;
    const next = track.tripId ? state.tripUpdates[track.tripId] : undefined;
    // History times are relative to the header (R-TE13); before any header
    // the tick time stands in, the same clock the client aligns to.
    const origin = headerTs ?? Math.floor(nowMs / 1000);
    const history: HistoryFix[] = track.fixes.map(([t, x, y]) => [t - origin, x, y]);
    const motion: VehicleMotion = { history };
    items.push({
      id: `vehicle:${track.vehicleId}`,
      kind: 'vehicle',
      title: routeLabel(routeId, routes),
      at: iso(atSec * 1000),
      geo: { type: 'Point', coordinates: [lon, lat] },
      data: compactData({
        routeId: routeId || undefined,
        tripId: track.tripId ?? undefined,
        vehicleId: track.vehicleId,
        routeShortName: routeId ? routeShortName(routeId, routes) : undefined,
        routeType: routeId ? routeType(routeId, routes) : undefined,
        direction: join?.direction,
        headsign: join?.headsign,
        shapeId: join?.shapeId ?? undefined,
        nextStopId: next?.stopId ?? undefined,
        delaySeconds: next?.delaySec ?? undefined,
      }),
      motion,
    });
  }

  // One summary row per route, never per stop (R-22, R-50): a rider asks
  // whether the 6 is late, not what the delay is at stop 311_1.
  const byRoute = new Map<string, { delays: number[]; trips: number }>();
  for (const [, update] of Object.entries(state.tripUpdates)) {
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
