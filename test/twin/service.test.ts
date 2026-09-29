import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeExpectIndex, type ExpectIndex, type ExpectIndexWire } from '../../shared/motion/expect';
import { deserializeState, serializeState } from '../../worker/twin/persist';
import { emptyState } from '../../worker/twin/state';
import {
  CONTINUITY_S,
  emptyService,
  expectationAt,
  judgeService,
  JUDGE_HEADER_AGE_S,
  LIFT_AFTER_S,
  MIN_EXPECTED,
  NORMAL_AFTER_S,
  REDUCED_AFTER_S,
  serviceOnWire,
  SILENT_AFTER_S,
  type ServiceMemory,
  type ServiceObservation,
} from '../../worker/twin/service';

// worker/twin/service.ts: the twin's judgement of the city's fleet against
// the declared expectation, with the dwells, holds and look-ahead of upgrade
// U2 (decisions 18, 29, 30). A synthetic expectation of 100 runs (50 trams,
// 50 buses) in every slot of a four-day calendar; the fleet is a list of
// published tracks, trams on route T, buses on B unless a test says otherwise.

const SLOTS = 372;
const fill = (value: number) => new Array<number>(SLOTS).fill(value);
/** Epoch seconds of a Zagreb wall-clock time. */
const at = (local: string, offset: '+02:00' | '+01:00' = '+02:00') => Date.parse(`${local}:00${offset}`) / 1000;
const iso = (sec: number) => new Date(sec * 1000).toISOString();

function indexOf(blocksAt: (slot: number) => [number, number, number]): ExpectIndex {
  const wd = { all: fill(0), tram: fill(0), bus: fill(0) };
  for (let k = 0; k < SLOTS; k++) [wd.all[k], wd.tram[k], wd.bus[k]] = blocksAt(k);
  const wire: ExpectIndexWire = {
    version: 1,
    feedVersion: '000777',
    builtAt: '2026-10-01T00:00:00.000Z',
    slotSec: 300,
    slots: SLOTS,
    services: ['wd'],
    calendar: { '2026-10-05': [0], '2026-10-06': [0], '2026-10-07': [0], '2026-10-08': [0] },
    routes: { id: ['T', 'B', 'X', 'Y'], type: [0, 3, 3, 3] },
    blocks: { wd },
    trips: { wd: { T: fill(30), B: fill(20), X: fill(1), Y: fill(2) } },
  };
  return decodeExpectIndex(wire);
}

const INDEX = indexOf(() => [100, 50, 50]);
/** Tuesday 6 October 2026, 10:00 Zagreb: slot 120 of the service day. */
const T0 = at('2026-10-06T10:00');

type Fleet = { tram: number; bus: number; routes?: Record<string, number> };
/** `tram` trams on route T and `bus` buses on route B, or the named routes with their counts (trams on T only). */
function fleet(spec: Fleet): ServiceObservation['published'] {
  const out: { routeId: string; kind: 'tram' | 'bus' }[] = [];
  const routes = spec.routes ?? { T: spec.tram, B: spec.bus };
  for (const [routeId, count] of Object.entries(routes)) for (let i = 0; i < count; i++) out.push({ routeId, kind: routeId === 'T' ? 'tram' : 'bus' });
  return out;
}

function observation(headerTs: number, seen: Fleet, over: Partial<ServiceObservation> = {}): ServiceObservation {
  return { nowSec: headerTs + 2, headerTs, newFrame: true, published: fleet(seen), expect: INDEX, ...over };
}

/** Judges one frame per entry of `frames`, in order: [seconds after T0, fleet]. */
function drive(memory: ServiceMemory, frames: [number, Fleet][], index = INDEX): ServiceMemory {
  for (const [dt, seen] of frames) memory = judgeService(memory, observation(T0 + dt, seen, { expect: index }));
  return memory;
}

const NORMAL: Fleet = { tram: 40, bus: 40 };
const LOW: Fleet = { tram: 20, bus: 20 };
const GONE: Fleet = { tram: 1, bus: 1 };

describe('judgeService', () => {
  it('reads normal at once from a fresh memory when the frame is not low, and publishes the numbers', () => {
    const m = drive(emptyService(), [[0, NORMAL]]);
    // Every timer holds the second its condition began, whatever the state: at 0.8 the lift and normal conditions hold.
    expect(m).toMatchObject({ state: 'normal', sinceSec: T0, judgedAtSec: T0, lowSince: null, silentSince: null, liftSince: T0, normalSince: T0 });
    expect(m.reason).toBeUndefined();
    expect(serviceOnWire(m)).toEqual({
      state: 'normal',
      since: iso(T0),
      observedAt: iso(T0),
      expected: 100,
      seen: 80,
      ratio: 0.8,
      confidence: 1,
      baseline: 'declared',
      byMode: { tram: [40, 50], bus: [40, 50] },
    });
    // Nothing on the wire before the first verdict.
    expect(serviceOnWire(emptyService())).toBeUndefined();
  });

  it('enters reduced when the city ratio has been below 0.5 for 300 s: 299 s stays', () => {
    let m = drive(emptyService(), [[0, NORMAL], [10, LOW], [150, LOW], [10 + REDUCED_AFTER_S - 1, LOW]]);
    expect(m).toMatchObject({ state: 'normal', sinceSec: T0, lowSince: T0 + 10 });
    m = drive(m, [[10 + REDUCED_AFTER_S, LOW]]);
    expect(m).toMatchObject({ state: 'reduced', sinceSec: T0 + 10 + REDUCED_AFTER_S });
    expect(serviceOnWire(m)).toMatchObject({ state: 'reduced', since: iso(T0 + 310), expected: 100, seen: 40, ratio: 0.4 });
  });

  it('a vanished fleet reads reduced after 300 s and silent after 600 s from the same instant', () => {
    let m = drive(emptyService(), [[0, NORMAL], [10, GONE], [150, GONE], [300, GONE], [10 + REDUCED_AFTER_S, GONE]]);
    expect(m).toMatchObject({ state: 'reduced', sinceSec: T0 + 310, silentSince: T0 + 10 });
    m = drive(m, [[450, GONE], [10 + SILENT_AFTER_S - 1, GONE]]);
    expect(m.state).toBe('reduced');
    m = drive(m, [[10 + SILENT_AFTER_S, GONE]]);
    expect(m).toMatchObject({ state: 'silent', sinceSec: T0 + 10 + SILENT_AFTER_S });
  });

  it('from reduced, silent needs 600 s of at most max(2, 10 %) vehicles: 599 s stays', () => {
    const reduced = drive(emptyService(), [[0, NORMAL], [10, LOW], [150, LOW], [310, LOW]]);
    expect(reduced.state).toBe('reduced');
    // Ten of a hundred is the silent line; eleven is not.
    let m = drive(reduced, [[400, { tram: 5, bus: 6 }], [550, { tram: 5, bus: 6 }], [700, { tram: 5, bus: 6 }], [850, { tram: 5, bus: 6 }], [1000, { tram: 5, bus: 6 }], [1100, { tram: 5, bus: 6 }]]);
    expect(m).toMatchObject({ state: 'reduced', silentSince: null });
    m = drive(reduced, [[400, { tram: 5, bus: 5 }], [550, { tram: 5, bus: 5 }], [700, { tram: 5, bus: 5 }], [850, { tram: 5, bus: 5 }], [400 + SILENT_AFTER_S - 1, { tram: 5, bus: 5 }]]);
    expect(m).toMatchObject({ state: 'reduced', silentSince: T0 + 400 });
    m = drive(m, [[400 + SILENT_AFTER_S, { tram: 5, bus: 5 }]]);
    expect(m).toMatchObject({ state: 'silent', sinceSec: T0 + 400 + SILENT_AFTER_S });
  });

  it('enters reduced on one judged mode below 0.4 while the city reads 0.6, and returns only when every judged mode is at 0.6', () => {
    // Trams 15 of 50 (0.3), buses 45 of 50: the city ratio is 0.6.
    let m = drive(emptyService(), [[0, NORMAL], [10, { tram: 15, bus: 45 }], [150, { tram: 15, bus: 45 }], [309, { tram: 15, bus: 45 }]]);
    expect(m).toMatchObject({ state: 'normal', lowSince: T0 + 10 });
    m = drive(m, [[310, { tram: 15, bus: 45 }]]);
    expect(m).toMatchObject({ state: 'reduced', sinceSec: T0 + 310 });
    expect(serviceOnWire(m)).toMatchObject({ ratio: 0.6, byMode: { tram: [15, 50], bus: [45, 50] } });
    // City 0.75 with trams at 0.54: stays reduced past the normal dwell.
    const partial: Fleet = { tram: 27, bus: 48 };
    m = drive(m, [[400, partial], [550, partial], [700, partial], [850, partial], [1000, partial]]);
    expect(m).toMatchObject({ state: 'reduced', normalSince: null });
    // Trams at 0.6, city 0.75: normal 300 s later.
    const whole: Fleet = { tram: 30, bus: 45 };
    m = drive(m, [[1100, whole], [1250, whole], [1100 + NORMAL_AFTER_S - 1, whole]]);
    expect(m).toMatchObject({ state: 'reduced', normalSince: T0 + 1100 });
    m = drive(m, [[1100 + NORMAL_AFTER_S, whole]]);
    expect(m).toMatchObject({ state: 'normal', sinceSec: T0 + 1100 + NORMAL_AFTER_S });
    expect(m.last?.routes).toBeUndefined();
  });

  it('a mode is judged only when its own expected is at least 20', () => {
    // Buses expected 10: a bus ratio of 0 does not enter reduced; the city ratio is 45 of 60.
    const fewBuses = indexOf(() => [60, 50, 10]);
    const m = drive(emptyService(), [[0, { tram: 45, bus: 0 }], [150, { tram: 45, bus: 0 }], [310, { tram: 45, bus: 0 }], [460, { tram: 45, bus: 0 }]], fewBuses);
    expect(m).toMatchObject({ state: 'normal', lowSince: null });
    expect(m.last?.byMode).toEqual({ tram: [45, 50], bus: [0, 10] });
  });

  it('returns from silent in two steps: reduced 180 s after the ratio reached 0.25, normal 300 s after it reached 0.7', () => {
    let m = drive(emptyService(), [[0, NORMAL], [10, GONE], [150, GONE], [310, GONE], [450, GONE], [610, GONE]]);
    expect(m.state).toBe('silent');
    m = drive(m, [[1000, NORMAL], [1000 + LIFT_AFTER_S - 1, NORMAL]]);
    expect(m).toMatchObject({ state: 'silent', liftSince: T0 + 1000, normalSince: T0 + 1000 });
    m = drive(m, [[1000 + LIFT_AFTER_S, NORMAL]]);
    expect(m).toMatchObject({ state: 'reduced', sinceSec: T0 + 1000 + LIFT_AFTER_S, normalSince: T0 + 1000 });
    m = drive(m, [[1000 + NORMAL_AFTER_S - 1, NORMAL]]);
    expect(m.state).toBe('reduced');
    m = drive(m, [[1000 + NORMAL_AFTER_S, NORMAL]]);
    expect(m).toMatchObject({ state: 'normal', sinceSec: T0 + 1000 + NORMAL_AFTER_S });
  });

  it('judges against the smallest expected of the slot and the next ten minutes', () => {
    // 100 runs until 10:10, 60 from then: from 09:59 the look-ahead reaches 10:09, from 10:00 it reaches 10:10.
    const stepped = indexOf((slot) => (slot < 122 ? [100, 50, 50] : [60, 30, 30]));
    expect(expectationAt(stepped, at('2026-10-06T09:45')).blocks).toEqual({ all: 100, tram: 50, bus: 50 });
    expect(expectationAt(stepped, at('2026-10-06T09:59')).blocks).toEqual({ all: 100, tram: 50, bus: 50 });
    expect(expectationAt(stepped, at('2026-10-06T10:00')).blocks).toEqual({ all: 60, tram: 30, bus: 30 });
    expect(expectationAt(stepped, at('2026-10-06T10:10')).blocks).toEqual({ all: 60, tram: 30, bus: 30 });
    // 42 of 60 is normal; of 100 it would be low.
    const m = drive(emptyService(), [[0, { tram: 21, bus: 21 }]], stepped);
    expect(m.state).toBe('normal');
    expect(m.last).toMatchObject({ expected: 60, seen: 42, ratio: 0.7, byMode: { tram: [21, 30], bus: [21, 30] } });
    // A later slot the calendar does not know is skipped, and the first slot's `known` stands.
    expect(expectationAt(INDEX, at('2026-10-08T23:55'))).toMatchObject({ known: true, blocks: { all: 100 } });
  });

  it('holds on a header older than 180 s: state, since and numbers kept, every dwell broken', () => {
    let m = drive(emptyService(), [[0, NORMAL], [10, LOW], [150, LOW], [300, LOW]]);
    expect(m).toMatchObject({ state: 'normal', lowSince: T0 + 10 });
    const held = judgeService(m, observation(T0 + 300, LOW, { nowSec: T0 + 300 + JUDGE_HEADER_AGE_S + 1, newFrame: false }));
    expect(held).toMatchObject({ state: 'normal', sinceSec: T0, judgedAtSec: T0 + 300, lowSince: null, silentSince: null, liftSince: null, normalSince: null });
    expect(held.last).toBe(m.last);
    expect(serviceOnWire(held)).toMatchObject({ state: 'normal', since: iso(T0), observedAt: iso(T0 + 300), seen: 40 });
    // The low run restarts at the next judged frame: 300 s after T0 + 10 is not enough any more.
    m = drive(held, [[310, LOW], [450, LOW]]);
    expect(m).toMatchObject({ state: 'normal', lowSince: T0 + 310 });
    // A header exactly 180 s old is still judged.
    const fresh = judgeService(held, observation(T0 + 310, LOW, { nowSec: T0 + 310 + JUDGE_HEADER_AGE_S }));
    expect(fresh).toMatchObject({ judgedAtSec: T0 + 310, lowSince: T0 + 310 });
    expect(fresh.last?.confidence).toBe(0.5);
  });

  it('changes nothing on a tick without a new frame', () => {
    const m = drive(emptyService(), [[0, NORMAL], [10, LOW]]);
    expect(judgeService(m, observation(T0 + 10, GONE, { nowSec: T0 + 70, newFrame: false }))).toBe(m);
  });

  it('holds below 20 expected runs with the reason and the numbers refreshed, and a cold start at night says so on the wire', () => {
    // Fifteen runs from 00:00 to 00:55 and none past 24:00 (the day before adds nothing at night).
    const night = indexOf((slot) => (slot >= 288 ? [0, 0, 0] : slot < 12 ? [15, 10, 5] : [100, 50, 50]));
    const t = at('2026-10-06T00:30');
    const cold = judgeService(emptyService(), observation(t, { tram: 3, bus: 1 }, { expect: night }));
    expect(cold).toMatchObject({ state: 'unknown', reason: 'below-min', sinceSec: t, judgedAtSec: null, lowSince: null });
    expect(serviceOnWire(cold)).toMatchObject({ state: 'unknown', since: iso(t), observedAt: iso(t), expected: 15, seen: 4, ratio: 0.27, confidence: 0, reason: 'below-min' });
    // A silent city keeps its state and since through the trough, the numbers moving on.
    let m = drive(emptyService(), [[0, NORMAL], [10, GONE], [150, GONE], [310, GONE], [450, GONE], [610, GONE]]);
    expect(m.state).toBe('silent');
    const heldSilent = judgeService(m, observation(t + 86_400, GONE, { expect: night }));
    expect(heldSilent).toMatchObject({ state: 'silent', sinceSec: T0 + 610, reason: 'below-min', silentSince: null });
    expect(heldSilent.last).toMatchObject({ expected: 15, seen: 2, observedAt: iso(t + 86_400) });
    // Judged again once the expectation is back: the reason goes.
    m = judgeService(heldSilent, observation(at('2026-10-07T01:05'), GONE, { expect: night }));
    expect(m.reason).toBeUndefined();
    expect(m).toMatchObject({ state: 'silent', judgedAtSec: at('2026-10-07T01:05') });
  });

  it('breaks every dwell between two judged frames more than 180 s apart', () => {
    let m = drive(emptyService(), [[0, NORMAL], [10, LOW], [10 + CONTINUITY_S + 1, LOW]]);
    expect(m).toMatchObject({ state: 'normal', lowSince: T0 + 10 + CONTINUITY_S + 1 });
    m = drive(m, [[310, LOW], [490, LOW]]);
    expect(m.state).toBe('normal');
    m = drive(m, [[10 + CONTINUITY_S + 1 + REDUCED_AFTER_S, LOW]]);
    expect(m).toMatchObject({ state: 'reduced', sinceSec: T0 + 10 + CONTINUITY_S + 1 + REDUCED_AFTER_S });
  });

  it('reads unknown without an artefact, with the reason and no numbers', () => {
    const fresh = judgeService(emptyService(), observation(T0, NORMAL, { expect: null }));
    expect(fresh).toMatchObject({ state: 'unknown', reason: 'no-artefact', sinceSec: T0 + 2, last: null });
    expect(serviceOnWire(fresh)).toEqual({ state: 'unknown', since: iso(T0 + 2), expected: 0, seen: 0, ratio: null, confidence: 0, baseline: 'declared', byMode: { tram: [0, 0], bus: [0, 0] }, reason: 'no-artefact' });
    const wasNormal = judgeService(drive(emptyService(), [[0, NORMAL]]), observation(T0 + 60, NORMAL, { expect: null }));
    expect(wasNormal).toMatchObject({ state: 'unknown', reason: 'no-artefact', sinceSec: T0 + 62, normalSince: null });
  });

  it('reads unknown on a calendar day the committed artefact does not know (27 September 2026, 22:00 Zagreb)', () => {
    const committed = decodeExpectIndex(JSON.parse(readFileSync(new URL('../../app/public/data/zet-expect.json', import.meta.url), 'utf8')));
    const t = Date.parse('2026-09-27T20:00:00Z') / 1000;
    const m = judgeService(emptyService(), observation(t, NORMAL, { expect: committed }));
    expect(m).toMatchObject({ state: 'unknown', reason: 'no-calendar', sinceSec: t, judgedAtSec: null });
    expect(serviceOnWire(m)).toMatchObject({ state: 'unknown', expected: 0, seen: 80, ratio: null, confidence: 0, byMode: { tram: [40, 0], bus: [40, 0] }, reason: 'no-calendar' });
    // Two days on, the same artefact judges.
    const monday = judgeService(emptyService(), observation(Date.parse('2026-09-29T08:00:00+02:00') / 1000, NORMAL, { expect: committed }));
    expect(monday.reason).toBeUndefined();
    expect(monday.last!.expected).toBeGreaterThan(MIN_EXPECTED);
  });

  it('lists the routes below half their trips in reduced and silent only, a 0-of-1 route included', () => {
    const normal = drive(emptyService(), [[0, NORMAL]]);
    expect(normal.last?.routes).toBeUndefined();
    expect(serviceOnWire(normal)).not.toHaveProperty('routes');
    // Route Y keeps both of its trips; X has none of its one; T and B a third and a quarter.
    const thin: Fleet = { tram: 0, bus: 0, routes: { T: 10, B: 5, Y: 2 } };
    const reduced = drive(normal, [[10, thin], [150, thin], [310, thin]]);
    expect(reduced.state).toBe('reduced');
    expect(reduced.last?.routes).toEqual({ T: [10, 30], B: [5, 20], X: [0, 1] });
    expect(serviceOnWire(reduced)?.routes).toEqual({ T: [10, 30], B: [5, 20], X: [0, 1] });
    const back = drive(reduced, [[400, NORMAL], [550, NORMAL], [700, NORMAL]]);
    expect(back.state).toBe('normal');
    expect(back.last?.routes).toBeUndefined();
  });

  it('rides the state row: the memory round-trips through serializeState, and a row written before it loads emptyService', () => {
    const thin: Fleet = { tram: 0, bus: 0, routes: { T: 10, B: 5, Y: 2 } };
    const memory = drive(emptyService(), [[0, NORMAL], [10, thin], [150, thin], [310, thin]]);
    expect(memory.state).toBe('reduced');
    const state = { ...emptyState(), headerTs: T0 + 310, tickAtMs: (T0 + 312) * 1000, service: memory };
    expect(deserializeState(serializeState(state)).service).toEqual(memory);
    const old = JSON.parse(serializeState(state)) as Record<string, unknown>;
    delete old.service;
    expect(deserializeState(JSON.stringify(old)).service).toEqual(emptyService());
  });
});
