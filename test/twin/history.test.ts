import { describe, expect, it } from 'vitest';
import { decodeFeed } from '../../worker/twin/feed-decode';
import { TRACK_STALE_S, emptyState, foldFeed } from '../../worker/twin/history';
import { HISTORY_FIXES } from '../../shared/motion/wire';
import { frame, v, type FrameTrip, type FrameVehicle } from './frames';

const T0 = 1_789_514_335;

describe('decodeFeed', () => {
  it('reads the header time, every positioned vehicle and every trip update', () => {
    const bytes = frame(
      T0,
      [
        { vehicleId: '460', tripId: '0_23_3302_33_10017', routeId: '33', lat: 45.79139328, lon: 16.03708839, at: T0 - 21 },
        { vehicleId: '12', routeId: '6', lat: 45.8, lon: 15.9 }, // no timestamp, no trip id
      ],
      [{ tripId: '0_23_3302_33_10017', routeId: '33', stops: [{ seq: 34, stopId: '266_4', delay: -637, time: T0 + 44 }] }],
    );
    const decoded = decodeFeed(bytes);
    expect(decoded.headerTs).toBe(T0);
    expect(decoded.vehicles).toHaveLength(2);
    // Coordinates rounded to the feed's float32 ceiling, as the module does today.
    expect(decoded.vehicles[0]).toEqual({
      vehicleId: '460',
      tripId: '0_23_3302_33_10017',
      routeId: '33',
      startDate: '20260916',
      lon: 16.03709,
      lat: 45.79139,
      atSec: T0 - 21,
    });
    expect(decoded.vehicles[1].atSec).toBeNull();
    expect(decoded.vehicles[1].tripId).toBeUndefined();
    expect(decoded.tripUpdates).toEqual([
      { tripId: '0_23_3302_33_10017', routeId: '33', atSec: T0, stops: [{ seq: 34, stopId: '266_4', delaySec: -637, timeSec: T0 + 44 }] },
    ]);
  });

  it('returns an empty frame for an empty body', () => {
    expect(decodeFeed(new Uint8Array())).toEqual({ headerTs: null, vehicles: [], tripUpdates: [] });
  });
});

describe('foldFeed', () => {
  it('starts a track with one fix and grows it oldest first', () => {
    let state = emptyState();
    ({ state } = foldFeed(state, decodeFeed(frame(T0, [v('a', T0 - 5, 15.970, 45.810)])), T0 * 1000 + 2000));
    ({ state } = foldFeed(state, decodeFeed(frame(T0 + 10, [v('a', T0 + 4, 15.971, 45.811)])), (T0 + 10) * 1000 + 2000));
    expect(state.headerTs).toBe(T0 + 10);
    expect(state.vehicles.a.fixes).toEqual([
      [T0 - 5, 15.97, 45.81],
      [T0 + 4, 15.971, 45.811],
    ]);
    expect(state.vehicles.a).toMatchObject({ vehicleId: 'a', tripId: 't1', routeId: '6' });
  });

  it('ignores a fix that is not newer than the last one (the feed repeats unchanged vehicles)', () => {
    let state = emptyState();
    ({ state } = foldFeed(state, decodeFeed(frame(T0, [v('a', T0 - 5)])), T0 * 1000));
    const second = foldFeed(state, decodeFeed(frame(T0 + 10, [v('a', T0 - 5, 15.99, 45.82)])), (T0 + 10) * 1000);
    expect(second.newFixes).toBe(0);
    expect(second.state.vehicles.a.fixes).toEqual([[T0 - 5, 15.97, 45.81]]);
  });

  it('keeps only the newest of two entities that share a vehicle id in one frame', () => {
    const { state, newFixes } = foldFeed(
      emptyState(),
      decodeFeed(frame(T0, [{ ...v('a', T0 - 9, 15.90, 45.80), entityId: 'old' }, { ...v('a', T0 - 3, 15.91, 45.81), entityId: 'new' }])),
      T0 * 1000,
    );
    expect(newFixes).toBe(1);
    expect(state.vehicles.a.fixes).toEqual([[T0 - 3, 15.91, 45.81]]);
  });

  it('dates a fix without a timestamp at the header time', () => {
    const { state } = foldFeed(emptyState(), decodeFeed(frame(T0, [{ vehicleId: 'a', routeId: '6', lon: 15.97, lat: 45.81 }])), T0 * 1000);
    expect(state.vehicles.a.fixes).toEqual([[T0, 15.97, 45.81]]);
  });

  it('caps the ring at HISTORY_FIXES, dropping the oldest', () => {
    let state = emptyState();
    for (let i = 0; i < HISTORY_FIXES + 3; i++) {
      ({ state } = foldFeed(state, decodeFeed(frame(T0 + 10 * i, [v('a', T0 + 10 * i - 2, 15.97 + i * 0.001, 45.81)])), (T0 + 10 * i) * 1000));
    }
    expect(state.vehicles.a.fixes).toHaveLength(HISTORY_FIXES);
    expect(state.vehicles.a.fixes[0][0]).toBe(T0 + 30 - 2);
  });

  it('clears the ring when the vehicle starts a new trip (a terminus turnaround)', () => {
    let state = emptyState();
    ({ state } = foldFeed(state, decodeFeed(frame(T0, [v('a', T0 - 5, 15.97, 45.81, 't1')])), T0 * 1000));
    ({ state } = foldFeed(state, decodeFeed(frame(T0 + 10, [v('a', T0 + 5, 15.972, 45.812, 't2')])), (T0 + 10) * 1000));
    expect(state.vehicles.a.tripId).toBe('t2');
    expect(state.vehicles.a.fixes).toEqual([[T0 + 5, 15.972, 45.812]]);
  });

  it('evicts a track silent for TRACK_STALE_S and reports it', () => {
    let state = emptyState();
    ({ state } = foldFeed(state, decodeFeed(frame(T0, [v('a', T0 - 5), v('b', T0 - 5, 15.98, 45.82)])), T0 * 1000));
    const later = T0 + TRACK_STALE_S + 1;
    const result = foldFeed(state, decodeFeed(frame(later, [v('b', later - 2, 15.981, 45.821)])), later * 1000);
    expect(result.evicted).toBe(1);
    expect(Object.keys(result.state.vehicles)).toEqual(['b']);
  });

  it('keeps the next stop per trip: the earliest update still ahead of the header, else the last', () => {
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
    const { state } = foldFeed(emptyState(), decodeFeed(frame(T0, [v('a', T0 - 1, 15.97, 45.81, 't1', '33')], trips)), T0 * 1000);
    expect(state.tripUpdates.t1).toMatchObject({ routeId: '33', seq: 34, stopId: '266_4', delaySec: -637, timeSec: T0 + 44 });
    expect(state.tripUpdates.t1.delays).toEqual([-160, -469, -637]);
    expect(state.tripUpdates.t2).toMatchObject({ routeId: '6', seq: 4, stopId: '231_2', delaySec: 45, timeSec: null });
  });

  it('drops trip updates absent from the new full frame', () => {
    let state = emptyState();
    ({ state } = foldFeed(state, decodeFeed(frame(T0, [], [{ tripId: 't1', routeId: '6', stops: [{ seq: 1, stopId: 's', delay: 0 }] }])), T0 * 1000));
    ({ state } = foldFeed(state, decodeFeed(frame(T0 + 10, [], [])), (T0 + 10) * 1000));
    expect(state.tripUpdates).toEqual({});
  });
});
