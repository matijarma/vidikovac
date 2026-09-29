import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeFeed } from '../../worker/twin/feed-decode';
import { frame, v, type FrameAlert } from './frames';

// The Alert entities and cancellation markers of ZET's frames (upgrade U1).
// The 11 frames of 21 September 17:15 to 17:17 are the real thing: a normal
// Monday on which ZET publishes 25 NO_SERVICE alerts (each naming one bus trip
// and no stop, none of them carried) and marks 7 tram trips CANCELED.

const DIR = new URL('../fixtures/frames/2026-09-21-1715-1717-all/', import.meta.url);
const frames = readdirSync(DIR)
  .filter((name) => name.endsWith('.pb'))
  .sort()
  .map((name) => decodeFeed(new Uint8Array(readFileSync(new URL(name, DIR)))));

const T = 1_800_000_000;

describe('the U1-1 frames of 21 September', () => {
  it('has the eleven frames', () => {
    expect(frames).toHaveLength(11);
  });

  it('decodes 25 NO_SERVICE alerts per frame, each naming one trip and no stop, none with words', () => {
    for (const feed of frames) {
      const alerts = feed.alerts ?? [];
      expect(alerts).toHaveLength(25);
      for (const alert of alerts) {
        expect(alert.noService).toBe(true);
        expect(alert.text).toBe(false);
        expect(alert.informed).toHaveLength(1);
        expect(alert.informed[0].tripId).toMatch(/\S/);
        expect(alert.informed[0].stopId).toBeUndefined();
      }
      expect(new Set(alerts.map((a) => a.informed[0].tripId)).size).toBe(25);
    }
  });

  it('decodes the 7 CANCELED trip updates and the 4 CANCELED vehicle reports, and no skipped stop', () => {
    for (const feed of frames) {
      const canceled = feed.tripUpdates.filter((u) => u.canceled);
      expect(canceled).toHaveLength(7);
      expect(new Set(canceled.map((u) => u.tripId)).size).toBe(7);
      expect(feed.vehicles.filter((f) => f.canceled)).toHaveLength(4);
      expect(feed.tripUpdates.flatMap((u) => u.stops).filter((s) => s.skipped)).toHaveLength(0);
    }
  });
});

describe('built frames', () => {
  const decode = (alerts: FrameAlert[], extra: Parameters<typeof frame>[1] = []) => decodeFeed(frame(T, extra, [], alerts));

  it('reads Croatian words in the header as text, a machine list as none', () => {
    const [words, list] = decode([
      { id: 'a', tripId: 't1', header: 'Linija 5 ne prometuje' },
      { id: 'b', tripId: 't2', header: '105/10108,105/10103' },
    ]).alerts!;
    expect(words.text).toBe(true);
    expect(list.text).toBe(false);
    expect(decode([{ id: 'c', tripId: 't3' }]).alerts![0].text).toBe(false);
  });

  it('keeps periods with and without an end', () => {
    const alerts = decode([
      { id: 'both', tripId: 't1', start: T - 60, end: T + 600 },
      { id: 'open', tripId: 't2', start: T - 60 },
      { id: 'none', tripId: 't3' },
    ]).alerts!;
    expect(alerts.map((a) => a.periods)).toEqual([[[T - 60, T + 600]], [[T - 60, null]], []]);
  });

  it('keeps a stop-level and a route-level entity as they are named', () => {
    const [stop, route, trip] = decode([
      { id: 's', tripId: 't1', stopId: '311_1' },
      { id: 'r', routeId: '6' },
      { id: 't', tripId: 't2', routeId: '121' },
    ]).alerts!;
    expect(stop.informed).toEqual([{ tripId: 't1', stopId: '311_1' }]);
    expect(route.informed).toEqual([{ routeId: '6' }]);
    expect(trip.informed).toEqual([{ routeId: '121', tripId: 't2' }]);
    expect(trip.noService).toBe(true);
  });

  it('marks CANCELED and SKIPPED where ZET does, and nothing on an ordinary report', () => {
    const feed = decodeFeed(frame(
      T,
      [{ ...v('1', T), canceled: true }, v('2', T, 15.98, 45.8, 't2')],
      [{ tripId: 't1', routeId: '6', canceled: true, stops: [{ seq: 1, stopId: 'a', time: T + 60 }] }, { tripId: 't2', routeId: '6', stops: [{ seq: 1, stopId: 'a', time: T + 60, skipped: true }, { seq: 2, stopId: 'b', time: T + 120 }] }],
    ));
    expect(feed.vehicles.map((f) => f.canceled)).toEqual([true, undefined]);
    expect(feed.tripUpdates.map((u) => u.canceled)).toEqual([true, undefined]);
    expect(feed.tripUpdates[1].stops.map((s) => s.skipped)).toEqual([true, undefined]);
    expect(feed.alerts).toEqual([]);
  });

  it('decodes an empty body to an empty feed with an empty alert list', () => {
    expect(decodeFeed(new Uint8Array())).toEqual({ headerTs: null, vehicles: [], tripUpdates: [], alerts: [] });
  });
});
