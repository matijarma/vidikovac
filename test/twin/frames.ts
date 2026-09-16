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
}

export interface FrameTrip {
  tripId: string;
  routeId: string;
  stops: { seq: number; stopId: string; delay?: number; time?: number }[];
}

export function frame(headerTs: number, vehicles: FrameVehicle[], trips: FrameTrip[] = []): Uint8Array {
  return GtfsRealtimeBindings.transit_realtime.FeedMessage.encode({
    header: { gtfsRealtimeVersion: '1.0', incrementality: 0, timestamp: headerTs },
    entity: [
      ...vehicles.map((v, i) => ({
        id: v.entityId ?? `e${i}`,
        vehicle: {
          trip: v.tripId || v.routeId ? { tripId: v.tripId, routeId: v.routeId, startDate: '20260916' } : undefined,
          position: { latitude: v.lat, longitude: v.lon },
          vehicle: { id: v.vehicleId },
          ...(v.at !== undefined ? { timestamp: v.at } : {}),
        },
      })),
      ...trips.map((t, i) => ({
        id: `u${i}`,
        tripUpdate: {
          trip: { tripId: t.tripId, routeId: t.routeId, startDate: '20260916' },
          stopTimeUpdate: t.stops.map((s) => ({
            stopSequence: s.seq,
            stopId: s.stopId,
            departure: { ...(s.delay !== undefined ? { delay: s.delay } : {}), ...(s.time !== undefined ? { time: s.time } : {}) },
          })),
          timestamp: headerTs,
        },
      })),
    ],
  }).finish();
}

/** A vehicle shorthand: id, report time, position, trip and route. */
export function v(vehicleId: string, at: number, lon = 15.97, lat = 45.81, tripId = 't1', routeId = '6'): FrameVehicle {
  return { vehicleId, tripId, routeId, lon, lat, at };
}
