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
// a delay. The pin carries ZET's stop when it has one, and only then is the
// twin's ETA withheld -- an arrival time belongs to the stop it was computed
// for, and publishing it beside somebody else's stop id would be a lie.
describe('buildPayload and the next-stop ETA', () => {
  it('publishes the twin ETA beside the twin stop it belongs to', () => {
    const item = pin([track({ id: '1', next: { stopId: '231_2', s: 1400, etaSec: HEADER_S + 95 } })]);
    expect(item.data?.nextStopId).toBe('231_2');
    expect(item.data?.nextStopEtaSec).toBe(HEADER_S + 95);
  });

  it('withholds the ETA when ZET names the next stop: the wire id is not the one the twin planned for', () => {
    const item = pin(
      [track({ id: '1', next: { stopId: '231_2', s: 1400, etaSec: HEADER_S + 95 } })],
      { T1: update({ stopId: '244_1', delaySec: 120 }) },
    );
    expect(item.data?.nextStopId).toBe('244_1');
    expect(item.data?.delaySeconds).toBe(120);
    expect(item.data?.nextStopEtaSec).toBeUndefined();
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
