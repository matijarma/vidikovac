import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeFeed, type DecodedFeed } from '../../worker/twin/feed-decode';
import { emptyOperator, foldOperator, noServiceTripIds, OPERATOR_STATE_MAX, OPERATOR_TRIPS_MAX, operatorSummary } from '../../worker/twin/operator';
import { deserializeState, serializeState } from '../../worker/twin/persist';
import { emptyState } from '../../worker/twin/state';
import { runTick } from '../../worker/twin/tick';
import { frame, v, type FrameAlert } from './frames';

// ZET's own statements folded into the twin (upgrade U1): the trip-level
// NO_SERVICE alerts remove departures; the CANCELED marker, which on a normal
// day marks trips ZET drives, is counted and removes nothing.

const DIR = new URL('../fixtures/frames/2026-09-21-1715-1717-all/', import.meta.url);
const fixture = readdirSync(DIR)
  .filter((name) => name.endsWith('.pb'))
  .sort()
  .map((name) => decodeFeed(new Uint8Array(readFileSync(new URL(name, DIR)))));

const T = 1_800_000_000;
const none: ReadonlySet<string> = new Set();

const built = (alerts: FrameAlert[], at = T): DecodedFeed => decodeFeed(frame(at, [], [], alerts));
const fold = (alerts: FrameAlert[], at = T) => foldOperator(emptyOperator(), built(alerts, at));

describe('the 11 frames of 21 September 17:15 to 17:17', () => {
  it('gives the same 25 alert trips every time, none of the 7 CANCELED, and the summary of the brief', () => {
    let operator = emptyOperator();
    let first: string[] | null = null;
    for (const feed of fixture) {
      operator = foldOperator(operator, feed);
      const carried = new Set(feed.vehicles.map((f) => f.tripId).filter((id): id is string => id !== undefined));
      const nowSec = feed.headerTs!;
      const ids = noServiceTripIds(operator, carried, nowSec);
      expect(ids).toHaveLength(25);
      first ??= ids;
      expect(ids).toEqual(first);
      const canceled = new Set(feed.tripUpdates.filter((u) => u.canceled).map((u) => u.tripId));
      expect(canceled.size).toBe(7);
      for (const id of ids) expect(canceled.has(id)).toBe(false);
      expect(operatorSummary(operator, carried, nowSec)).toEqual({ cancelledTrips: 25, noServiceAlerts: 25, noticesAt: null });
      expect(operator.counts).toMatchObject({ noServiceAlerts: 25, tripEntities: 25, stopEntities: 0, routeEntities: 0, canceledUpdates: 7, skippedStops: 0, textAlerts: 0 });
    }
  });
});

describe('what enters and what leaves', () => {
  it('U1 review: counts statements separately from trips and honors all periods of an alert', () => {
    const feed = built([{ id: 'finite', tripId: 'finite' }, { id: 'open', tripId: 'open' }, { id: 'text', tripId: 'not-cancelled', header: 'Linija prometuje' }]);
    feed.alerts![0].periods = [[T - 100, T - 1], [T + 60, T + 120]];
    feed.alerts![0].informed.push({ tripId: 'finite', routeId: '6' }, { tripId: 'finite', stopId: '311_1' }, { routeId: '6' });
    feed.alerts![1].periods = [[T - 100, T - 1], [T + 60, null]];
    feed.alerts![2].noService = false;
    const operator = foldOperator(emptyOperator(), feed);
    expect(operator.counts).toEqual({ noServiceAlerts: 2, tripEntities: 3, stopEntities: 1, routeEntities: 1, canceledUpdates: 0, skippedStops: 0, textAlerts: 1 });
    expect(operatorSummary(operator, none, T)).toEqual({ cancelledTrips: 2, noServiceAlerts: 2, noticesAt: new Date(T * 1000).toISOString() });
    expect(noServiceTripIds(operator, none, T + 120)).toEqual(['open']);
  });

  it('never lets a stop-level or a route-level entity in, and counts them', () => {
    const operator = fold([
      { id: 'a', tripId: 't1', stopId: '311_1' },
      { id: 'b', routeId: '6' },
      { id: 'c', tripId: 't2', routeId: '121' },
    ]);
    expect(noServiceTripIds(operator, none, T)).toEqual(['t2']);
    expect(operator.counts).toMatchObject({ noServiceAlerts: 3, tripEntities: 1, stopEntities: 1, routeEntities: 1 });
  });

  it('drops a trip whose announced period ended and keeps an open or absent one', () => {
    const operator = fold([
      { id: 'ended', tripId: 'ended', start: T - 3600, end: T - 1 },
      { id: 'endsNow', tripId: 'endsNow', start: T - 3600, end: T },
      { id: 'ahead', tripId: 'ahead', start: T + 600, end: T + 3000 },
      { id: 'open', tripId: 'open', start: T - 60 },
      { id: 'none', tripId: 'none' },
    ]);
    expect(noServiceTripIds(operator, none, T)).toEqual(['ahead', 'none', 'open']);
    expect(noServiceTripIds(operator, none, T + 3001)).toEqual(['none', 'open']);
  });

  it('lets the open-ended alert win when two alerts name one trip, and the later end otherwise', () => {
    const open = fold([{ id: 'a', tripId: 't', start: T, end: T + 100 }, { id: 'b', tripId: 't', start: T }]);
    expect(open.noServiceTrips).toEqual({ t: null });
    const reversed = fold([{ id: 'b', tripId: 't', start: T }, { id: 'a', tripId: 't', start: T, end: T + 100 }]);
    expect(reversed.noServiceTrips).toEqual({ t: null });
    const ends = fold([{ id: 'a', tripId: 't', start: T, end: T + 100 }, { id: 'b', tripId: 't', start: T, end: T + 900 }]);
    expect(ends.noServiceTrips).toEqual({ t: T + 900 });
  });

  it.each(['__proto__', 'constructor', 'toString', 'hasOwnProperty'])('keeps %s as a literal trip id with its finite expiry through persistence', (tripId) => {
    const operator = fold([
      { id: 'first', tripId, end: T + 100 },
      { id: 'later', tripId, end: T + 200 },
    ]);
    expect(Object.hasOwn(operator.noServiceTrips, tripId)).toBe(true);
    expect(operator.noServiceTrips[tripId]).toBe(T + 200);
    expect(noServiceTripIds(operator, none, T)).toEqual([tripId]);
    expect(noServiceTripIds(operator, new Set([tripId]), T)).toEqual([]);
    const restored = deserializeState(serializeState({ ...emptyState(), operator })).operator;
    expect(restored.noServiceTrips[tripId]).toBe(T + 200);
    expect(noServiceTripIds(restored, none, T + 200)).toEqual([]);
    expect(operatorSummary(restored, none, T + 200).cancelledTrips).toBe(0);
  });

  it('leaves out a trip a positioned vehicle carries', () => {
    const operator = fold([{ id: 'a', tripId: 'ran' }, { id: 'b', tripId: 'gone' }]);
    expect(noServiceTripIds(operator, new Set(['ran']), T)).toEqual(['gone']);
    expect(operatorSummary(operator, new Set(['ran']), T)).toMatchObject({ cancelledTrips: 1, noServiceAlerts: 2 });
  });

  it('replaces the statement with the next frame, and keeps it when there is no frame to fold', () => {
    const first = fold([{ id: 'a', tripId: 't1' }]);
    const second = foldOperator(first, built([{ id: 'b', tripId: 't2' }], T + 10));
    expect(Object.keys(second.noServiceTrips)).toEqual(['t2']);
    const bare = foldOperator(second, built([], T + 20));
    expect(bare.noServiceTrips).toEqual({});
    expect(bare.counts.noServiceAlerts).toBe(0);
  });

  it('gives 400 ids and a count of 401 for 401 trips, sorted', () => {
    const alerts = Array.from({ length: 401 }, (_, i) => ({ id: `a${i}`, tripId: `t${String(400 - i).padStart(3, '0')}` }));
    const operator = fold(alerts);
    const ids = noServiceTripIds(operator, none, T);
    expect(OPERATOR_TRIPS_MAX).toBe(400);
    expect(ids).toHaveLength(400);
    expect(ids).toEqual([...ids].sort());
    expect(ids[0]).toBe('t000');
    expect(operatorSummary(operator, none, T).cancelledTrips).toBe(401);
  });

  it('keeps the state row bounded: past the state limit the first trips by id stay, and the wire list is still the first 400', () => {
    const alerts = Array.from({ length: OPERATOR_STATE_MAX + 1 }, (_, i) => ({ id: `a${i}`, tripId: `t${String(i).padStart(5, '0')}` }));
    const operator = fold(alerts);
    expect(Object.keys(operator.noServiceTrips)).toHaveLength(OPERATOR_STATE_MAX);
    expect(operator.noServiceTrips).not.toHaveProperty(`t${String(OPERATOR_STATE_MAX).padStart(5, '0')}`);
    expect(operator.counts.noServiceAlerts).toBe(OPERATOR_STATE_MAX + 1);
    expect(noServiceTripIds(operator, none, T)).toHaveLength(OPERATOR_TRIPS_MAX);
    expect(operatorSummary(operator, none, T).cancelledTrips).toBe(OPERATOR_STATE_MAX);
  });

  it('sets noticesAt to the header of a frame that carried words, and keeps it through frames that did not', () => {
    const quiet = fold([{ id: 'a', tripId: 't', header: '105/10108' }]);
    expect(operatorSummary(quiet, none, T).noticesAt).toBeNull();
    const loud = foldOperator(quiet, built([{ id: 'b', tripId: 't', header: 'Linija 5 ne prometuje' }], T + 10));
    expect(loud.counts.textAlerts).toBe(1);
    expect(operatorSummary(loud, none, T + 10).noticesAt).toBe(new Date((T + 10) * 1000).toISOString());
    const later = foldOperator(loud, built([{ id: 'c', tripId: 't' }], T + 20));
    expect(operatorSummary(later, none, T + 20).noticesAt).toBe(new Date((T + 10) * 1000).toISOString());
  });

  it('counts CANCELED updates and SKIPPED stops and removes nothing for them', () => {
    const feed = decodeFeed(frame(T, [], [
      { tripId: 't1', routeId: '6', canceled: true, stops: [{ seq: 1, stopId: 'a', time: T + 60, skipped: true }] },
      { tripId: 't2', routeId: '6', stops: [{ seq: 1, stopId: 'a', time: T + 60 }] },
    ]));
    const operator = foldOperator(emptyOperator(), feed);
    expect(operator.counts).toMatchObject({ canceledUpdates: 1, skippedStops: 1, noServiceAlerts: 0 });
    expect(noServiceTripIds(operator, none, T)).toEqual([]);
  });
});

describe('through the tick', () => {
  const tick = (state: ReturnType<typeof emptyState>, feed: DecodedFeed | null, at: number) =>
    runTick({ state, feed, nowMs: at * 1000, joins: new Map(), routes: {}, engine: null, validUntilMs: 0 });
  const ids = (payload: ReturnType<typeof tick>['payload']) => payload.sources?.zet?.noServiceTrips;

  it('U1 review: recomputes carrier fallback through held ticks, restoration and a new fix', () => {
    const feed = decodeFeed(frame(T, [v('bus', T, 15.98, 45.8, 'ran', '109')], [], [{ id: 'a', tripId: 'ran', end: T + 600 }]));
    const first = tick(emptyState(), feed, T);
    expect(ids(first.payload)).toBeUndefined();
    const held = tick(deserializeState(serializeState(first.state)), null, T + 179);
    expect(ids(held.payload)).toBeUndefined();
    expect(held.state.tracks.bus).toBeDefined();
    const evicted = tick(held.state, null, T + 181);
    expect(evicted.state.tracks.bus).toBeUndefined();
    expect(ids(evicted.payload)).toEqual(['ran']);
    const returnedFeed = decodeFeed(frame(T + 190, [v('bus', T + 190, 15.98, 45.8, 'ran', '109')], [], [{ id: 'a', tripId: 'ran', end: T + 600 }]));
    const returned = tick(evicted.state, returnedFeed, T + 190);
    expect(ids(returned.payload)).toBeUndefined();
    expect(returned.payload.items.some((item) => item.data?.tripId === 'ran')).toBe(true);
  });

  it('keeps the last statement over a frame that did not come, until its period ends, and lets the next frame replace it', () => {
    const first = tick(emptyState(), built([{ id: 'a', tripId: 't1', start: T, end: T + 100 }, { id: 'b', tripId: 't2' }]), T);
    expect(ids(first.payload)).toEqual(['t1', 't2']);
    expect(first.operator).toMatchObject({ noServiceAlerts: 2 });
    const held = tick(first.state, null, T + 50);
    expect(ids(held.payload)).toEqual(['t1', 't2']);
    const expired = tick(held.state, null, T + 101);
    expect(ids(expired.payload)).toEqual(['t2']);
    const replaced = tick(expired.state, built([{ id: 'c', tripId: 't3' }], T + 110), T + 110);
    expect(ids(replaced.payload)).toEqual(['t3']);
    const quiet = tick(replaced.state, built([], T + 120), T + 120);
    expect(ids(quiet.payload)).toBeUndefined();
  });

  it('survives the state row, and a row written before U1 loads an empty statement', () => {
    const result = tick(emptyState(), built([{ id: 'a', tripId: 't1' }]), T);
    expect(deserializeState(serializeState(result.state)).operator).toEqual(result.state.operator);
    const old = JSON.parse(serializeState(result.state)) as Record<string, unknown>;
    delete old.operator;
    expect(deserializeState(JSON.stringify(old)).operator).toEqual(emptyOperator());
  });
});
