import { describe, expect, it } from 'vitest';
import { newTrack, type Track } from '../../shared/motion/track';
import { DATA_KEYS } from '../../worker/feed/schema';
import { buildPayload, type TripJoin } from '../../worker/twin/publish';
import { emptyState, type TripNext, type TwinState } from '../../worker/twin/state';
import { decodeNetwork } from '../../shared/motion/network';
import graphBefore from '../fixtures/graph-migration/before.json';
import graphAfter from '../fixtures/graph-migration/after.json';

const HEADER_S = 1_800_000_000;
const NOW_MS = (HEADER_S + 2) * 1000;

const routes = { '6': { shortName: '6', longName: 'Crnomerec - Sopot', type: 0 } };

function track(over: Partial<Track> & { id: string }): Track {
  const base = newTrack(over.id, '6', 'T1', 'tram');
  return { ...base, ...over, fixes: [{ x: 0, y: 0, lon: 15.98, lat: 45.81, atSec: HEADER_S }] };
}

function state(tracks: Track[], tripUpdates: Record<string, TripNext> = {}): TwinState {
  return { ...emptyState(), headerTs: HEADER_S, tickAtMs: NOW_MS, tracks: Object.fromEntries(tracks.map((t) => [t.id, t])), tripUpdates };
}

const update = (over: Partial<TripNext> = {}): TripNext => ({
  routeId: '6', seq: 4, stopId: null, delaySec: null, timeSec: null, delays: [], atSec: HEADER_S, ...over,
});

const joins = new Map<string, TripJoin>([['T1', { direction: 0, headsign: 'Sopot', shapeId: '6_25' }]]);
const pin = (tracks: Track[], tripUpdates?: Record<string, TripNext>) =>
  buildPayload(state(tracks, tripUpdates), joins, routes, NOW_MS, NOW_MS + 10_000, null).items.find((i) => i.id.startsWith('vehicle:'))!;

it('names the actual graph and generation time on motion without changing legacy path/plan fields', () => {
  for (const raw of [graphBefore, graphAfter]) {
    const net = decodeNetwork(raw);
    const t = track({ id: '1', plan: { on: 'path', pathIdx: 0, knots: [[0, 100], [60, 600]] } });
    const motion = buildPayload(state([t]), joins, routes, NOW_MS, NOW_MS + 10_000, net).items[0].motion;
    expect(motion).toMatchObject({
      network: net.graphHash, generatedAt: NOW_MS,
      path: 'path:6:1:e641be7c', plan: [[0, 100], [60, 600]],
    });
  }
});

// The next stop on the wire, and the one thing that may be said about when
// the vehicle gets there. The twin plans an arrival at the platform in front
// of the vehicle (Track.next); ZET's TripUpdate names a stop of its own with
// a delay, and the pin carries ZET's when it has one. The ETA rides whenever
// the id that went on the wire is the id the twin planned for -- whichever
// source named it -- and is withheld only where the two disagree: an arrival
// time belongs to the stop it was computed for, and publishing it beside a
// different stop id would be a lie about which platform the number is for.
describe('buildPayload and the next-stop ETA', () => {
  it('publishes the twin ETA beside the twin stop it belongs to', () => {
    const item = pin([track({ id: '1', next: { stopId: '231_2', s: 1400, etaSec: HEADER_S + 95 } })]);
    expect(item.data?.nextStopId).toBe('231_2');
    expect(item.data?.nextStopEtaSec).toBe(HEADER_S + 95);
  });

  it('publishes the ETA where ZET names the same stop the twin planned for: agreement, not silence', () => {
    const item = pin(
      [track({ id: '1', next: { stopId: '231_2', s: 1400, etaSec: HEADER_S + 95 } })],
      { T1: update({ stopId: '231_2', delaySec: 120 }) },
    );
    expect(item.data?.nextStopId).toBe('231_2');
    expect(item.data?.delaySeconds).toBe(120);
    expect(item.data?.nextStopEtaSec).toBe(HEADER_S + 95);
  });

  it('withholds the ETA only where the two disagree about which stop is next', () => {
    const item = pin(
      [track({ id: '1', next: { stopId: '231_2', s: 1400, etaSec: HEADER_S + 95 } })],
      { T1: update({ stopId: '244_1', delaySec: 120 }) },
    );
    expect(item.data?.nextStopId).toBe('244_1');
    expect(item.data?.delaySeconds).toBe(120);
    expect(item.data?.nextStopEtaSec).toBeUndefined();
  });

  it('withholds the ETA where only ZET knows the next stop: the twin planned for no stop at all', () => {
    const item = pin([track({ id: '1', next: null })], { T1: update({ stopId: '244_1', delaySec: 30 }) });
    expect(item.data?.nextStopId).toBe('244_1');
    expect(item.data).not.toHaveProperty('nextStopEtaSec');
  });

  it('publishes ZET\'s delay beside the twin\'s own stop and ETA when the update names no stop', () => {
    const item = pin(
      [track({ id: '1', next: { stopId: '231_2', s: 1400, etaSec: HEADER_S + 95 } })],
      { T1: update({ stopId: null, delaySec: 45 }) },
    );
    expect(item.data?.nextStopId).toBe('231_2');
    expect(item.data?.delaySeconds).toBe(45);
    expect(item.data?.nextStopEtaSec).toBe(HEADER_S + 95);
  });

  it('carries no ETA key at all where the plan reaches no stop, and none where there is no next stop', () => {
    expect(pin([track({ id: '1', next: { stopId: '231_2', s: 1400, etaSec: null } })]).data).not.toHaveProperty('nextStopEtaSec');
    const none = pin([track({ id: '1', next: null })]).data!;
    expect(none).not.toHaveProperty('nextStopId');
    expect(none).not.toHaveProperty('nextStopEtaSec');
  });

  it('keeps every key it emits inside the vehicle vocabulary', () => {
    const item = pin([track({ id: '1', next: { stopId: '231_2', s: 1400, etaSec: HEADER_S + 95 } })]);
    expect(DATA_KEYS.vehicle).toContain('nextStopEtaSec');
    for (const key of Object.keys(item.data ?? {})) expect(DATA_KEYS.vehicle).toContain(key);
  });
});

// Rail round 3: on a rail path the twin's own next stop goes on the wire; ZET's
// TripUpdate names a stop by the first time it still has ahead, and at a
// platform that time passes and returns with every re-estimate while the tram
// stands there, so the wall's "sada" row vanished and came back (305 of 334
// backward moves in one Monday hour were ZET's). ZET's stop still names the
// next stop where the twin has no path plan.
describe('buildPayload prefers the twin\'s next stop on a rail path', () => {
  const onPath = (over: Partial<Track> & { id: string }): Track => track({ ...over, plan: { on: 'path', pathIdx: 0, knots: [[0, 100], [60, 600]] } });
  const net = decodeNetwork(graphAfter);
  const pinOn = (tracks: Track[], tripUpdates?: Record<string, TripNext>) =>
    buildPayload(state(tracks, tripUpdates), joins, routes, NOW_MS, NOW_MS + 10_000, net).items.find((i) => i.id.startsWith('vehicle:'))!;

  it('names the twin\'s stop and its ETA where ZET names another stop', () => {
    const item = pinOn(
      [onPath({ id: '1', next: { stopId: '231_2', s: 1400, etaSec: HEADER_S + 95 } })],
      { T1: update({ stopId: '244_1', delaySec: 120 }) },
    );
    expect(item.data?.nextStopId).toBe('231_2');
    expect(item.data?.nextStopEtaSec).toBe(HEADER_S + 95);
    expect(item.data?.delaySeconds).toBe(120);
  });

  it('falls back to ZET\'s stop where the twin\'s plan on a path reaches no stop, and off every path', () => {
    const noNext = pinOn([onPath({ id: '1', next: null })], { T1: update({ stopId: '244_1', delaySec: 30 }) });
    expect(noNext.data?.nextStopId).toBe('244_1');
    const free = pin([track({ id: '1', next: { stopId: '231_2', s: 1400, etaSec: HEADER_S + 95 } })], { T1: update({ stopId: '244_1', delaySec: 120 }) });
    expect(free.data?.nextStopId).toBe('244_1');
  });
});
