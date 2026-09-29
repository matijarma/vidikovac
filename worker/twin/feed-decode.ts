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
  /** The report's trip descriptor says CANCELED. ZET's own marker, which on
   *  21 and 24 Sep marked 114 of 143 trips its vehicles drove on schedule
   *  (U1): decoded and counted, never a reason to hide anything. */
  canceled?: boolean;
}

export interface RawStopUpdate {
  seq: number | null;
  stopId: string | null;
  delaySec: number | null;
  timeSec: number | null;
  /** The stop time update says SKIPPED (0 of 2.8 million on the recorded days). */
  skipped?: boolean;
}

export interface RawTripUpdate {
  tripId?: string;
  routeId?: string;
  atSec: number | null;
  stops: RawStopUpdate[];
  /** The update's trip descriptor says CANCELED (see RawFix.canceled). */
  canceled?: boolean;
}

/** One informed entity of an Alert, as ZET names it: a route, a trip, a stop
 *  or a combination; each id is present only when the entity carried it. */
export interface RawInformed {
  routeId?: string;
  tripId?: string;
  stopId?: string;
}

/** One Alert entity, reduced to what the twin reads (U1). `text` says a run
 *  of three letters stands in its header or description: ZET's recorded alerts
 *  carry a machine list ("105/10108,105/10103,...") and no words, so the text
 *  itself is never kept, only whether there was any. */
export interface RawAlert {
  id: string;
  /** The alert's effect is NO_SERVICE. */
  noService: boolean;
  /** Active periods in epoch seconds; a missing start or end is null. */
  periods: Array<[number | null, number | null]>;
  informed: RawInformed[];
  text: boolean;
}

export interface DecodedFeed {
  /** The feed header's own publish time in seconds, null when absent. */
  headerTs: number | null;
  vehicles: RawFix[];
  tripUpdates: RawTripUpdate[];
  /** Optional so frame builders written before U1 still compile; decodeFeed always sets it. */
  alerts?: RawAlert[];
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

const { TripDescriptor, TripUpdate, Alert } = GtfsRealtimeBindings.transit_realtime;

/** A present scheduleRelationship equal to the enum value: the field's proto
 *  default (SCHEDULED) sits on the prototype, so absence reads false. */
function relationIs(object: unknown, wanted: number): boolean {
  return has(object, 'scheduleRelationship') && Number((object as Record<string, unknown>).scheduleRelationship) === wanted;
}

/** Three letters in a row anywhere in a TranslatedString's translations: a
 *  machine list of numbers and slashes has none, a sentence always does. */
function hasWords(value: unknown): boolean {
  const translations = (value as { translation?: Array<{ text?: unknown }> } | null | undefined)?.translation;
  return (translations ?? []).some((entry) => typeof entry?.text === 'string' && /\p{L}{3,}/u.test(entry.text));
}

export function decodeFeed(bytes: Uint8Array): DecodedFeed {
  if (bytes.byteLength === 0) return { headerTs: null, vehicles: [], tripUpdates: [], alerts: [] };
  const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(bytes);
  const headerTs = presentTime(feed.header, 'timestamp');
  const vehicles: RawFix[] = [];
  const tripUpdates: RawTripUpdate[] = [];
  const alerts: RawAlert[] = [];

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
          ...(relationIs(vehicle.trip, TripDescriptor.ScheduleRelationship.CANCELED) ? { canceled: true } : {}),
        });
      }
    }

    const update = entity.tripUpdate;
    if (update) {
      tripUpdates.push({
        tripId: text(update.trip?.tripId),
        routeId: text(update.trip?.routeId),
        atSec: presentTime(update, 'timestamp'),
        ...(relationIs(update.trip, TripDescriptor.ScheduleRelationship.CANCELED) ? { canceled: true } : {}),
        stops: (update.stopTimeUpdate ?? []).map((stop) => {
          const event = stop.departure ?? stop.arrival ?? null;
          const other = stop.departure ? stop.arrival ?? null : null;
          return {
            seq: has(stop, 'stopSequence') ? toNumber(stop.stopSequence) : null,
            stopId: text(stop.stopId) ?? null,
            delaySec: (event && has(event, 'delay') ? toNumber(event.delay) : null) ?? (other && has(other, 'delay') ? toNumber(other.delay) : null),
            timeSec: (event ? presentTime(event, 'time') : null) ?? (other ? presentTime(other, 'time') : null),
            ...(relationIs(stop, TripUpdate.StopTimeUpdate.ScheduleRelationship.SKIPPED) ? { skipped: true } : {}),
          };
        }),
      });
    }

    const alert = entity.alert;
    if (alert) {
      alerts.push({
        id: entity.id,
        noService: has(alert, 'effect') && Number(alert.effect) === Alert.Effect.NO_SERVICE,
        periods: (alert.activePeriod ?? []).map((period): [number | null, number | null] => [presentTime(period, 'start'), presentTime(period, 'end')]),
        informed: (alert.informedEntity ?? []).map((informed) => ({
          ...(text(informed.routeId) ? { routeId: text(informed.routeId) } : {}),
          ...(text(informed.trip?.tripId) ? { tripId: text(informed.trip?.tripId) } : {}),
          ...(text(informed.stopId) ? { stopId: text(informed.stopId) } : {}),
        })),
        text: hasWords(alert.headerText) || hasWords(alert.descriptionText),
      });
    }
  }

  return { headerTs, vehicles, tripUpdates, alerts };
}
