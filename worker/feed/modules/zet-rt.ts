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

/** The number a rider reads on the front of the tram; the route id when GTFS has no short name. */
export function routeShortName(routeId: string, routes: ZetRoutes): string {
  return routes[routeId]?.shortName || routeId;
}

/** GTFS route_type (0 tram, 3 bus) from the static GTFS, or undefined when
 *  the route is unknown there -- never a guessed type. It rides on every pin
 *  (R-P1) so a locked kiosk can keep to trams before the network artefact
 *  has loaded, and in lightweight mode, where that artefact never loads. */
export function routeType(routeId: string, routes: ZetRoutes): number | undefined {
  const raw = routes[routeId]?.type;
  const parsed = raw === undefined ? NaN : Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

// --- The teaser box (R-P1: "keeps the vehicles inside that box") ---

/** Trg bana Jelačića, between the square's two tram platforms -- the same
 *  point app/src/motion/schematic.ts's DEFAULT_CROP is centred on. The
 *  Worker cannot import that file across the worker/app boundary, so the
 *  value is repeated here and the two test suites each pin it. */
export const TEASER_BOX_CENTRE = { lon: 15.9769, lat: 45.813 } as const;
/** Half the box side, in metres: the kiosk's default crop radius (900 m,
 *  schematic.ts DEFAULT_RADIUS_M) plus one inner-city stop spacing
 *  (~400-500 m), so a tram approaching the drawn circle has already given
 *  the motion model one interval of its own speed evidence by the time it
 *  enters -- otherwise every vehicle would appear at the rim standing
 *  still until its second fix. */
export const TEASER_BOX_HALF_M = 1400;
const METRES_PER_DEG_LAT = 111_320;
const HALF_LAT_DEG = TEASER_BOX_HALF_M / METRES_PER_DEG_LAT;
const HALF_LON_DEG = TEASER_BOX_HALF_M / (METRES_PER_DEG_LAT * Math.cos((TEASER_BOX_CENTRE.lat * Math.PI) / 180));

/** Whether a coordinate lies in the default screen's teaser box. A square in
 *  degrees, not the client's circle: the circle is the client's to clip
 *  against real geometry; this only bounds what leaves the Worker. */
export function inTeaserBox(lon: number, lat: number, centre: { lon: number; lat: number } = TEASER_BOX_CENTRE): boolean {
  const halfLon = TEASER_BOX_HALF_M / (METRES_PER_DEG_LAT * Math.cos((centre.lat * Math.PI) / 180));
  return Math.abs(lon - centre.lon) <= halfLon && Math.abs(lat - centre.lat) <= HALF_LAT_DEG;
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
          // R-P3: ZET's GTFS-RT feed carries no bearing and no speed on
          // VehiclePosition. protobufjs still decodes both fields — the
          // proto default of 0 for an absent scalar — which read as "facing
          // due north, standing still" for every vehicle on the map. Do not
          // restore `bearing: toNumber(vehicle.position.bearing)` or
          // `speed: toNumber(vehicle.position.speed)` from the protobuf
          // definition by reflex: the fields exist in the schema because
          // GTFS-RT allows them, not because this feed ever populates them.
          // The motion model (T5) derives its own speed from fix history
          // instead; a reported position is evidence, never output.
          data: compactData({
            routeId: routeId || undefined,
            tripId: vehicle.trip?.tripId ?? undefined,
            vehicleId,
            routeShortName: routeId ? routeShortName(routeId, routes) : undefined,
            routeType: routeId ? routeType(routeId, routes) : undefined,
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
    // One summary row per route, not per stop: a rider asks whether the 6 is
    // late, never what the delay is at stop 311_1. It is a 'vehicle' item
    // with the id prefix 'route:' (R-22, R-50), so a consumer that wants the
    // moving pins filters on 'vehicle:' and never counts a summary as a tram.
    items.push({
      id: `route:${routeId}`,
      kind: 'vehicle',
      title: routeLabel(routeId, routes),
      summary: delayWords(medianDelaySeconds),
      data: { routeId, routeShortName: routeShortName(routeId, routes), medianDelaySeconds, vehicles: bucket.trips.size },
    });
  }

  const headerTimestamp = toNumber(feed.header?.timestamp);
  return {
    items,
    ...(headerTimestamp ? { sourceUpdatedAt: new Date(headerTimestamp * 1000).toISOString() } : {}),
  };
}

/** The twin's payload when the cache layer offers one (production, R-TE8);
 *  a direct fetch and parse otherwise (fixtures, a context without a twin). */
export async function fetchZetRt(ctx: FetchContext): Promise<FeedPayload> {
  if (ctx.twin) return ctx.twin();
  const [response, routes] = await Promise.all([ctx.fetch(ZET_RT_URL), loadZetRoutes()]);
  return parseZetRt(new Uint8Array(await response.arrayBuffer()), routes);
}
