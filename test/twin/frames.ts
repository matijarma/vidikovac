import GtfsRealtimeBindings from 'gtfs-realtime-bindings';

// A frame builder over the real protobuf schema, so the twin is tested
// against bytes shaped exactly like ZET's, never against hand-made objects
// that could drift from the wire. Shared by the unit tests (decode, fold)
// and the Durable Object tests (whole ticks).

export interface FrameVehicle {
  entityId?: string;
  vehicleId: string;
  tripId?: string;
  routeId?: string;
  lat: number;
  lon: number;
  /** Seconds; omitted to model a report ZET left undated. */
  at?: number;
  /** The report's trip descriptor says CANCELED. */
  canceled?: boolean;
}

export interface FrameTrip {
  tripId: string;
  routeId: string;
  stops: { seq: number; stopId: string; delay?: number; time?: number; skipped?: boolean }[];
  /** The update's trip descriptor says CANCELED. */
  canceled?: boolean;
}

/** An Alert entity, effect NO_SERVICE. One informed entity built from the ids given. */
export interface FrameAlert {
  id: string;
  tripId?: string;
  routeId?: string;
  stopId?: string;
  /** Epoch seconds of the active period; both omitted for no period at all. */
  start?: number;
  end?: number;
  /** The header text (a machine list on ZET's recorded alerts). */
  header?: string;
}

const { TripDescriptor, TripUpdate, Alert } = GtfsRealtimeBindings.transit_realtime;

export function frame(headerTs: number, vehicles: FrameVehicle[], trips: FrameTrip[] = [], alerts: FrameAlert[] = []): Uint8Array {
  return GtfsRealtimeBindings.transit_realtime.FeedMessage.encode({
    header: { gtfsRealtimeVersion: '1.0', incrementality: 0, timestamp: headerTs },
    entity: [
      ...vehicles.map((v, i) => ({
        id: v.entityId ?? `e${i}`,
        vehicle: {
          trip: v.tripId || v.routeId
            ? { tripId: v.tripId, routeId: v.routeId, startDate: '20260916', ...(v.canceled ? { scheduleRelationship: TripDescriptor.ScheduleRelationship.CANCELED } : {}) }
            : undefined,
          position: { latitude: v.lat, longitude: v.lon },
          vehicle: { id: v.vehicleId },
          ...(v.at !== undefined ? { timestamp: v.at } : {}),
        },
      })),
      ...trips.map((t, i) => ({
        id: `u${i}`,
        tripUpdate: {
          trip: { tripId: t.tripId, routeId: t.routeId, startDate: '20260916', ...(t.canceled ? { scheduleRelationship: TripDescriptor.ScheduleRelationship.CANCELED } : {}) },
          stopTimeUpdate: t.stops.map((s) => ({
            stopSequence: s.seq,
            stopId: s.stopId,
            departure: { ...(s.delay !== undefined ? { delay: s.delay } : {}), ...(s.time !== undefined ? { time: s.time } : {}) },
            ...(s.skipped ? { scheduleRelationship: TripUpdate.StopTimeUpdate.ScheduleRelationship.SKIPPED } : {}),
          })),
          timestamp: headerTs,
        },
      })),
      ...alerts.map((a) => ({
        id: a.id,
        alert: {
          ...(a.start !== undefined || a.end !== undefined ? { activePeriod: [{ ...(a.start !== undefined ? { start: a.start } : {}), ...(a.end !== undefined ? { end: a.end } : {}) }] } : {}),
          informedEntity: [{ ...(a.routeId ? { routeId: a.routeId } : {}), ...(a.tripId ? { trip: { tripId: a.tripId } } : {}), ...(a.stopId ? { stopId: a.stopId } : {}) }],
          effect: Alert.Effect.NO_SERVICE,
          ...(a.header !== undefined ? { headerText: { translation: [{ text: a.header, language: 'hr' }] } } : {}),
        },
      })),
    ],
  }).finish();
}

/** A vehicle shorthand: id, report time, position, trip and route. */
export function v(vehicleId: string, at: number, lon = 15.97, lat = 45.81, tripId = 't1', routeId = '6'): FrameVehicle {
  return { vehicleId, tripId, routeId, lon, lat, at };
}
