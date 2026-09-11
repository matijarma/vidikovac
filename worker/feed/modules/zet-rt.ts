import GtfsRealtimeBindings from 'gtfs-realtime-bindings';
import type { FetchContext } from '../schema';
import type { FeedPayload, ItemInput } from '../payload';
import { compactData } from '../payload';
import { loadZetRoutes, type ZetRoutes } from './zet-routes';

// ZET publishes one GTFS-Realtime FeedMessage with both vehicle positions and
// trip updates. Positions become map pins; the stop-time delays become one
// honest summary per route, because a rider asks "is my tram late", not "what is
// the delay at stop 311_1".

export const ZET_RT_URL = 'https://www.zet.hr/gtfs-rt-protobuf';
/** Below this the difference is noise, not information. */
export const ON_TIME_SECONDS = 30;

export function routeLabel(routeId: string, routes: ZetRoutes): string {
  const route = routes[routeId];
  if (!route) return `Linija ${routeId}`;
  const short = route.shortName || routeId;
  return route.longName ? `${short} ${route.longName}` : `Linija ${short}`;
}

export function delayWords(seconds: number): string {
  if (!Number.isFinite(seconds) || Math.abs(seconds) < ON_TIME_SECONDS) return 'na vrijeme';
  const minutes = Math.max(1, Math.round(Math.abs(seconds) / 60));
  return seconds > 0 ? `kasni ${minutes} min` : `rani ${minutes} min`;
}

/** protobufjs returns 64-bit fields as Long objects that stringify to decimals. */
function toNumber(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  const parsed = Number(String(value));
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * GTFS-RT's Position.latitude/longitude are wire-type `float` (32-bit), so a
 * plain decode carries binary noise past ~5 decimal places (e.g. 45.8136
 * becomes 45.8135986328125). Rounding here matches the source's own precision
 * ceiling (~1.1 m at Zagreb's latitude) instead of drawing map pins off a
 * float32 rounding artefact.
 */
const COORD_PRECISION = 1e5;
function roundCoord(value: number): number {
  return Math.round(value * COORD_PRECISION) / COORD_PRECISION;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

export function parseZetRt(bytes: Uint8Array, routes: ZetRoutes): FeedPayload {
  if (bytes.byteLength === 0) return { items: [] };
  const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(bytes);
  const items: ItemInput[] = [];
  const delaysByRoute = new Map<string, { delays: number[]; trips: Set<string> }>();

  for (const entity of feed.entity ?? []) {
    const vehicle = entity.vehicle;
    if (vehicle?.position) {
      const lat = toNumber(vehicle.position.latitude);
      const lon = toNumber(vehicle.position.longitude);
      const vehicleId = vehicle.vehicle?.id ?? entity.id ?? '';
      if (lat !== undefined && lon !== undefined && vehicleId) {
        const routeId = vehicle.trip?.routeId ?? '';
        const at = toNumber(vehicle.timestamp);
        items.push({
          id: `vehicle:${vehicleId}`,
          kind: 'vehicle',
          title: routeLabel(routeId, routes),
          ...(at ? { at: new Date(at * 1000).toISOString() } : {}),
          geo: { type: 'Point', coordinates: [roundCoord(lon), roundCoord(lat)] },
          data: compactData({
            routeId: routeId || undefined,
            tripId: vehicle.trip?.tripId ?? undefined,
            vehicleId,
            bearing: toNumber(vehicle.position.bearing),
            speed: toNumber(vehicle.position.speed),
          }),
        });
      }
    }

    const update = entity.tripUpdate;
    if (update?.trip?.routeId) {
      const routeId = update.trip.routeId;
      const bucket = delaysByRoute.get(routeId) ?? { delays: [], trips: new Set<string>() };
      for (const stop of update.stopTimeUpdate ?? []) {
        const delay = toNumber(stop.arrival?.delay ?? stop.departure?.delay);
        if (delay !== undefined) bucket.delays.push(delay);
      }
      bucket.trips.add(update.trip.tripId ?? entity.id ?? '');
      delaysByRoute.set(routeId, bucket);
    }
  }

  for (const [routeId, bucket] of [...delaysByRoute].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (bucket.delays.length === 0) continue;
    const medianDelaySeconds = median(bucket.delays);
    items.push({
      id: `delay:${routeId}`,
      kind: 'observation',
      title: routeLabel(routeId, routes),
      summary: delayWords(medianDelaySeconds),
      data: { routeId, medianDelaySeconds, vehicles: bucket.trips.size },
    });
  }

  const headerTimestamp = toNumber(feed.header?.timestamp);
  return {
    items,
    ...(headerTimestamp ? { sourceUpdatedAt: new Date(headerTimestamp * 1000).toISOString() } : {}),
  };
}

export async function fetchZetRt(ctx: FetchContext): Promise<FeedPayload> {
  const [response, routes] = await Promise.all([ctx.fetch(ZET_RT_URL), loadZetRoutes()]);
  return parseZetRt(new Uint8Array(await response.arrayBuffer()), routes);
}
