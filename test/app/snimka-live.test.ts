// The living network (app/src/snimka/live-network.ts, decision S-16): alive
// when a vehicle ran in any of the last three samples, dead when scheduled in
// all three and none ran, quiet otherwise; 255 is missing, never zero. The
// stop set, the diff, the counts, and the cost row of plan section 8: 150
// routes and 2,525 stops under 2 ms.
import { describe, expect, it } from 'vitest';
import { ROUTES_STEP_S, SNIMKA_WINDOW } from '../../shared/snimka';
import { ROUTES_MISSING, encodeRoutes } from '../../shared/snimka-codec';
import { aliveSets, aliveStates, diffStates, liveCounts, routeSlotAt, sampleIndex, scheduledCount, stopAliveSet, stopRoutesOf } from '../../app/src/snimka/live-network';

const T0 = SNIMKA_WINDOW.fromSec;
const at = (slot: number): number => T0 + slot * ROUTES_STEP_S + 17;
const row = (...values: number[]): Uint8Array => Uint8Array.from(values);

/** Six samples of four routes: 6 runs then stops; 228 is scheduled and never runs; 31 is unscheduled; 17 has a missing sample. */
const file = encodeRoutes(
  T0, ROUTES_STEP_S,
  [{ id: '6', shortName: '6', type: 0 }, { id: '228', shortName: '228', type: 3 }, { id: '31', shortName: '31', type: 0 }, { id: '17', shortName: '17', type: 0 }],
  [row(3, 2, 1, 0, 0, 0), row(0, 0, 0, 0, 0, 0), row(0, 0, 0, 0, 0, 0), row(1, ROUTES_MISSING, 0, 0, 0, 0)],
  [row(4, 4, 4, 4, 4, 4), row(2, 2, 2, 2, 0, 2), row(0, 0, 0, 0, 0, 0), row(2, ROUTES_MISSING, 2, 2, 2, 2)],
);

describe('aliveStates', () => {
  it('alive while any of the last three samples saw a vehicle, dead once scheduled in all three without one, quiet without a timetable', () => {
    expect(aliveStates(file, at(2)).get('6')).toBe('alive');
    expect(aliveStates(file, at(4)).get('6')).toBe('alive'); // sample 2 still inside the window of three
    expect(aliveStates(file, at(5)).get('6')).toBe('dead');
    expect(aliveStates(file, at(2)).get('228')).toBe('dead');
    expect(aliveStates(file, at(2)).get('31')).toBe('quiet');
  });
  it('a sample of 255 is missing, so a route with one in its window is quiet rather than dead; before three samples exist, the same', () => {
    expect(aliveStates(file, at(3)).get('17')).toBe('quiet'); // samples 1 (255), 2, 3: not scheduled in all three
    expect(aliveStates(file, at(5)).get('17')).toBe('dead');
    expect(aliveStates(file, at(1)).get('228')).toBe('quiet'); // only two samples back
    expect(aliveStates(file, at(0)).get('6')).toBe('alive');
  });
  it('an unscheduled sample inside the window makes a scheduled-but-empty route quiet, not dead', () => {
    expect(aliveStates(file, at(4)).get('228')).toBe('quiet');
    expect(aliveStates(file, at(5)).get('228')).toBe('quiet');
  });
  it('answers nothing outside the file, and the sample index agrees with routeSlotAt', () => {
    expect(aliveStates(file, T0 - 1).size).toBe(0);
    expect(aliveStates(file, T0 + 6 * ROUTES_STEP_S).size).toBe(0);
    expect(sampleIndex(file, at(4))).toBe(4);
    expect(routeSlotAt(file, T0 + 6 * ROUTES_STEP_S)).toBe(-1);
  });
  it('scheduledCount counts the routes with a timetable in the sample, 255 excluded', () => {
    expect(scheduledCount(file, at(0))).toBe(3);
    expect(scheduledCount(file, at(1))).toBe(2);
    expect(scheduledCount(file, at(4))).toBe(2);
    expect(scheduledCount(file, T0 - 1)).toBe(0);
  });
});

describe('stopRoutesOf and stopAliveSet', () => {
  const net = {
    stops: [
      { id: 'a', name: 'A', p: { x: 0, y: 0 }, on: [{ shape: 0, s: 0 }, { shape: 2, s: 0 }], terminal: false },
      { id: 'b', name: 'B', p: { x: 0, y: 0 }, on: [{ shape: 1, s: 0 }], terminal: false },
      { id: 'c', name: 'C', p: { x: 0, y: 0 }, on: [], terminal: false },
    ],
    shapes: [{ route: '6' }, { route: '228' }, { route: '31' }] as never[],
  } as never;
  it('lists each stop with the routes whose shapes call there, once per network object', () => {
    const table = stopRoutesOf(net);
    expect(table.get('a')).toEqual(['6', '31']);
    expect(table.get('b')).toEqual(['228']);
    expect(table.get('c')).toEqual([]);
    expect(stopRoutesOf(net)).toBe(table);
  });
  it('a stop is alive when any of its routes is alive; no table, no stops', () => {
    const states = aliveStates(file, at(2));
    expect([...stopAliveSet(stopRoutesOf(net), states)]).toEqual(['a']);
    expect(stopAliveSet(null, states).size).toBe(0);
  });
});

describe('diffStates, liveCounts, aliveSets', () => {
  it('diff lists every route against null and only the changed ones against a previous map', () => {
    const before = aliveStates(file, at(2));
    const after = aliveStates(file, at(5));
    expect(diffStates(null, before)).toHaveLength(4);
    expect(diffStates(before, after)).toEqual([{ id: '6', state: 'dead' }, { id: '228', state: 'quiet' }, { id: '17', state: 'dead' }]);
    expect(diffStates(after, after)).toEqual([]);
  });
  it('counts and sets agree with the states', () => {
    // At slot 2 route 17's sample 0 (one vehicle) is still inside the window of three: alive, as S-16 says.
    const states = aliveStates(file, at(2));
    expect(liveCounts(states)).toEqual({ alive: 2, dead: 1, quiet: 1 });
    const sets = aliveSets(states);
    expect([...sets.alive]).toEqual(['6', '17']);
    expect([...sets.dead]).toEqual(['228']);
  });
});

describe('cost', () => {
  it('150 routes and 2,525 stops: states, stop set and diff under 2 ms per sample', () => {
    const n = 1344;
    const routes = Array.from({ length: 150 }, (_, i) => ({ id: `r${i}`, shortName: String(i), type: (i < 19 ? 0 : 3) as 0 | 3 }));
    const seen = routes.map((_, i) => Uint8Array.from({ length: n }, (__, j) => ((i + j) % 7 === 0 ? 0 : (i * 31 + j) % 9)));
    const expected = routes.map(() => Uint8Array.from({ length: n }, (_, j) => (j % 13 === 0 ? 0 : 4)));
    const big = encodeRoutes(T0, ROUTES_STEP_S, routes, seen, expected);
    const stops = Array.from({ length: 2525 }, (_, i) => ({ id: `s${i}`, name: '', p: { x: 0, y: 0 }, on: [{ shape: i % 300, s: 0 }, { shape: (i * 7) % 300, s: 0 }], terminal: false }));
    const shapes = Array.from({ length: 300 }, (_, i) => ({ route: `r${i % 150}` }));
    const net = { stops, shapes } as never;
    // Warm: the columns decode once per file, the stop table once per network.
    const table = stopRoutesOf(net);
    let prev = aliveStates(big, at(10));
    const rounds = 40;
    const start = performance.now();
    for (let k = 0; k < rounds; k++) {
      const next = aliveStates(big, at(11 + k));
      stopAliveSet(table, next);
      diffStates(prev, next);
      prev = next;
    }
    const perSample = (performance.now() - start) / rounds;
    console.log(`[live-network] aliveStates + stopAliveSet + diffStates: ${perSample.toFixed(3)} ms per sample (150 routes, 2,525 stops)`);
    expect(perSample).toBeLessThan(2);
  });
});
