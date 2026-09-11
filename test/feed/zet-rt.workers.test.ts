import { describe, expect, it } from 'vitest';
import GtfsRealtimeBindings from 'gtfs-realtime-bindings';
import { fetchZetRt } from '../../worker/feed/modules/zet-rt';

// Proves that protobufjs decodes inside workerd, which the deployed Worker needs.
describe('fetchZetRt inside the Workers runtime', () => {
  it('decodes a protobuf body into vehicle and delay items', async () => {
    const bytes = GtfsRealtimeBindings.transit_realtime.FeedMessage.encode({
      header: { gtfsRealtimeVersion: '1.0', incrementality: 0, timestamp: 1789124385 },
      entity: [
        {
          id: 'v1',
          vehicle: {
            trip: { routeId: '12', tripId: 't1' },
            position: { latitude: 45.8136, longitude: 15.9839, bearing: 90 },
            vehicle: { id: '102216' },
            timestamp: 1789124378,
          },
        },
        {
          id: 'u1',
          tripUpdate: {
            trip: { routeId: '12', tripId: 't1' },
            stopTimeUpdate: [{ stopSequence: 10, arrival: { delay: -102 } }, { stopSequence: 12, arrival: { delay: -60 } }],
          },
        },
      ],
    }).finish();

    const payload = await fetchZetRt({
      now: () => new Date('2026-09-11T10:00:00.000Z'),
      fetch: async () => new Response(bytes),
    });

    expect(payload.sourceUpdatedAt).toBe('2026-09-11T10:59:45.000Z');
    const vehicle = payload.items.find((item) => item.id.startsWith('vehicle:'));
    expect(vehicle?.geo).toEqual({ type: 'Point', coordinates: [15.9839, 45.8136] });
    expect(vehicle?.data).toMatchObject({ routeId: '12', tripId: 't1', vehicleId: '102216', bearing: 90 });
    const delay = payload.items.find((item) => item.id.startsWith('route:'));
    expect(delay?.data).toEqual({ routeId: '12', routeShortName: '12', medianDelaySeconds: -81, vehicles: 1 });
  });
});
