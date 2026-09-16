// The GTFS-Realtime frame as the twin sees it: every positioned vehicle and
// every trip update, decoded once from ZET's protobuf and reduced to plain
// numbers and strings. Nothing here judges a value; folding fixes into
// history (history.ts) and building the wire (publish.ts) come after.
//
// What ZET's VehiclePosition actually carries (verified 16 Sept 2026):
// trip{tripId, routeId, startDate}, position{latitude, longitude},
// vehicle{id}, timestamp. No bearing, speed, directionId, stopId or
// currentStatus (R-P3). protobufjs still materialises the absent scalars as
// their proto defaults on the prototype, so presence is checked with
// hasOwnProperty, never by truthiness alone.

import GtfsRealtimeBindings from 'gtfs-realtime-bindings';

export interface RawFix {
  vehicleId: string;
  tripId?: string;
  routeId?: string;
  startDate?: string;
  lon: number;
  lat: number;
  /** The vehicle's own report time in seconds, null when ZET omitted it. */
  atSec: number | null;
}

export interface RawStopUpdate {
  seq: number | null;
  stopId: string | null;
  delaySec: number | null;
  timeSec: number | null;
}

export interface RawTripUpdate {
  tripId?: string;
  routeId?: string;
  atSec: number | null;
  stops: RawStopUpdate[];
}

export interface DecodedFeed {
  /** The feed header's own publish time in seconds, null when absent. */
  headerTs: number | null;
  vehicles: RawFix[];
  tripUpdates: RawTripUpdate[];
}

/** GTFS-RT Position.latitude/longitude are float32 on the wire; five
 *  decimals (~1.1 m at Zagreb's latitude) is the source's own precision
 *  ceiling, the same rounding worker/feed/modules/zet-rt.ts applies. */
const COORD_PRECISION = 1e5;

function roundCoord(value: number): number {
  return Math.round(value * COORD_PRECISION) / COORD_PRECISION;
}

/** protobufjs returns 64-bit fields as Long objects that stringify to decimals. */
function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function has(object: unknown, key: string): boolean {
  return object !== null && typeof object === 'object' && Object.prototype.hasOwnProperty.call(object, key);
}

/** A present, positive 64-bit timestamp; the proto default 0 reads as absent. */
function presentTime(object: unknown, key: string): number | null {
  if (!has(object, key)) return null;
  const value = toNumber((object as Record<string, unknown>)[key]);
  return value !== null && value > 0 ? value : null;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

export function decodeFeed(bytes: Uint8Array): DecodedFeed {
  if (bytes.byteLength === 0) return { headerTs: null, vehicles: [], tripUpdates: [] };
  const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(bytes);
  const headerTs = presentTime(feed.header, 'timestamp');
  const vehicles: RawFix[] = [];
  const tripUpdates: RawTripUpdate[] = [];

  for (const entity of feed.entity ?? []) {
    const vehicle = entity.vehicle;
    if (vehicle?.position) {
      const lat = toNumber(vehicle.position.latitude);
      const lon = toNumber(vehicle.position.longitude);
      const vehicleId = text(vehicle.vehicle?.id) ?? text(entity.id);
      if (lat !== null && lon !== null && vehicleId) {
        vehicles.push({
          vehicleId,
          tripId: text(vehicle.trip?.tripId),
          routeId: text(vehicle.trip?.routeId),
          startDate: text(vehicle.trip?.startDate),
          lon: roundCoord(lon),
          lat: roundCoord(lat),
          atSec: presentTime(vehicle, 'timestamp'),
        });
      }
    }

    const update = entity.tripUpdate;
    if (update) {
      tripUpdates.push({
        tripId: text(update.trip?.tripId),
        routeId: text(update.trip?.routeId),
        atSec: presentTime(update, 'timestamp'),
        stops: (update.stopTimeUpdate ?? []).map((stop) => {
          const event = stop.departure ?? stop.arrival ?? null;
          const other = stop.departure ? stop.arrival ?? null : null;
          return {
            seq: has(stop, 'stopSequence') ? toNumber(stop.stopSequence) : null,
            stopId: text(stop.stopId) ?? null,
            delaySec: (event && has(event, 'delay') ? toNumber(event.delay) : null) ?? (other && has(other, 'delay') ? toNumber(other.delay) : null),
            timeSec: (event ? presentTime(event, 'time') : null) ?? (other ? presentTime(other, 'time') : null),
          };
        }),
      });
    }
  }

  return { headerTs, vehicles, tripUpdates };
}
