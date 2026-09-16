import { describe, expect, it } from 'vitest';
import { decodeFeed } from '../../worker/twin/feed-decode';
import { TRACK_STALE_S, emptyState, foldFeed } from '../../worker/twin/history';
import { HISTORY_FIXES } from '../../shared/motion/wire';
import { frame, v, type FrameTrip } from './frames';

const T0 = 1_789_514_335;

describe('decodeFeed', () => {
  it('reads the header, every positioned vehicle (rounded, undated when ZET omits the time) and every trip update', () => {
    const decoded = decodeFeed(
      frame(
        T0,
        [
          { vehicleId: '460', tripId: '0_23_3302_33_10017', routeId: '33', lat: 45.79139328, lon: 16.03708839, at: T0 - 21 },
          { vehicleId: '12', routeId: '6', lat: 45.8, lon: 15.9 },
        ],
        [{ tripId: '0_23_3302_33_10017', routeId: '33', stops: [{ seq: 34, stopId: '266_4', delay: -637, time: T0 + 44 }] }],
      ),
    );
    expect(decoded.headerTs).toBe(T0);
    expect(decoded.vehicles[0]).toEqual({ vehicleId: '460', tripId: '0_23_3302_33_10017', routeId: '33', startDate: '20260916', lon: 16.03709, lat: 45.79139, atSec: T0 - 21 });
    expect(decoded.vehicles[1]).toMatchObject({ vehicleId: '12', routeId: '6', atSec: null });
    expect(decoded.tripUpdates).toEqual([
      { tripId: '0_23_3302_33_10017', routeId: '33', atSec: T0, stops: [{ seq: 34, stopId: '266_4', delaySec: -637, timeSec: T0 + 44 }] },
    ]);
    expect(decodeFeed(new Uint8Array())).toEqual({ headerTs: null, vehicles: [], tripUpdates: [] });
  });
});

describe('foldFeed', () => {
  it('grows a track from new evidence only: newer timestamps count, repeats and older duplicates do not, an undated fix takes the header time', () => {
    let state = emptyState();
    ({ state } = foldFeed(state, decodeFeed(frame(T0, [v('a', T0 - 5, 15.97, 45.81)])), T0 * 1000 + 2000));
    ({ state } = foldFeed(state, decodeFeed(frame(T0 + 10, [v('a', T0 + 4, 15.971, 45.811)])), (T0 + 10) * 1000 + 2000));
    expect(state.headerTs).toBe(T0 + 10);
    expect(state.vehicles.a).toMatchObject({ vehicleId: 'a', tripId: 't1', routeId: '6', fixes: [[T0 - 5, 15.97, 45.81], [T0 + 4, 15.971, 45.811]] });

    // The feed repeats a vehicle's last report until it sends a new one.
    const repeat = foldFeed(state, decodeFeed(frame(T0 + 20, [v('a', T0 + 4, 15.99, 45.82)])), (T0 + 20) * 1000);
    expect(repeat.newFixes).toBe(0);
    expect(repeat.state.vehicles.a.fixes).toHaveLength(2);

    // Two entities for one vehicle in a frame: the newer report wins.
    const dup = foldFeed(emptyState(), decodeFeed(frame(T0, [{ ...v('b', T0 - 9, 15.9, 45.8), entityId: 'old' }, { ...v('b', T0 - 3, 15.91, 45.81), entityId: 'new' }])), T0 * 1000);
    expect(dup.newFixes).toBe(1);
    expect(dup.state.vehicles.b.fixes).toEqual([[T0 - 3, 15.91, 45.81]]);

    // A fix ZET left undated is dated at the header, the source's own vouching.
    const undated = foldFeed(emptyState(), decodeFeed(frame(T0, [{ vehicleId: 'c', routeId: '6', lon: 15.97, lat: 45.81 }])), T0 * 1000);
    expect(undated.state.vehicles.c.fixes).toEqual([[T0, 15.97, 45.81]]);
  });

  it('caps the ring at HISTORY_FIXES and restarts it when the vehicle begins a new trip', () => {
    let state = emptyState();
    for (let i = 0; i < HISTORY_FIXES + 3; i++) {
      ({ state } = foldFeed(state, decodeFeed(frame(T0 + 10 * i, [v('a', T0 + 10 * i - 2, 15.97 + i * 0.001, 45.81)])), (T0 + 10 * i) * 1000));
    }
    expect(state.vehicles.a.fixes).toHaveLength(HISTORY_FIXES);
    expect(state.vehicles.a.fixes[0][0]).toBe(T0 + 30 - 2);
    const turned = (T0 + 10 * (HISTORY_FIXES + 3));
    ({ state } = foldFeed(state, decodeFeed(frame(turned, [v('a', turned - 2, 15.972, 45.812, 't2')])), turned * 1000));
    expect(state.vehicles.a.tripId).toBe('t2');
    expect(state.vehicles.a.fixes).toEqual([[turned - 2, 15.972, 45.812]]);
  });

  it('evicts a track silent for TRACK_STALE_S and reports it', () => {
    let state = emptyState();
    ({ state } = foldFeed(state, decodeFeed(frame(T0, [v('a', T0 - 5), v('b', T0 - 5, 15.98, 45.82)])), T0 * 1000));
    const later = T0 + TRACK_STALE_S + 1;
    const result = foldFeed(state, decodeFeed(frame(later, [v('b', later - 2, 15.981, 45.821)])), later * 1000);
    expect(result.evicted).toBe(1);
    expect(Object.keys(result.state.vehicles)).toEqual(['b']);
  });

  it('keeps one next stop per trip (the earliest still ahead of the header, else the last), every delay for the route median, and forgets trips a full frame no longer names', () => {
    const trips: FrameTrip[] = [
      {
        tripId: 't1',
        routeId: '33',
        stops: [
          { seq: 24, stopId: '221_1', delay: -160, time: T0 - 150 },
          { seq: 27, stopId: '213_1', delay: -469, time: T0 - 246 },
          { seq: 34, stopId: '266_4', delay: -637, time: T0 + 44 },
        ],
      },
      { tripId: 't2', routeId: '6', stops: [{ seq: 3, stopId: '197_2', delay: 30 }, { seq: 4, stopId: '231_2', delay: 45 }] },
    ];
    let state = foldFeed(emptyState(), decodeFeed(frame(T0, [v('a', T0 - 1, 15.97, 45.81, 't1', '33')], trips)), T0 * 1000).state;
    expect(state.tripUpdates.t1).toMatchObject({ routeId: '33', seq: 34, stopId: '266_4', delaySec: -637, timeSec: T0 + 44, delays: [-160, -469, -637] });
    expect(state.tripUpdates.t2).toMatchObject({ routeId: '6', seq: 4, stopId: '231_2', delaySec: 45, timeSec: null });
    state = foldFeed(state, decodeFeed(frame(T0 + 10, [], [])), (T0 + 10) * 1000).state;
    expect(state.tripUpdates).toEqual({});
  });
});
