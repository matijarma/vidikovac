import { describe, expect, it } from 'vitest';
import { newTrack, type Track } from '../../shared/motion/track';
import { DATA_KEYS } from '../../worker/feed/schema';
import { buildPayload, type TripJoin } from '../../worker/twin/publish';
import { emptyState, type TripNext, type TwinState } from '../../worker/twin/state';

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
