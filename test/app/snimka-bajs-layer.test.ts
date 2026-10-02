// The BAJS stage layer (app/src/snimka/bajs-layer.ts, decision V3-9): the
// interpolation between five-minute samples, the empty, missing and spent
// flags, the anomaly rim against Thursday 1 October's same minute (none on
// Thu/Fri, none on 254/255), the 1/32 quantisation, the change-only
// feature-state diff, the tooltip text, the layer spec's paint and the ramp
// (validated with the dataviz validator; pinned here by hex), and the
// feature-state call counts per sample on the e2e fixture at Monday 09:00.
import { describe, expect, it } from 'vitest';
import { BAJS_STEP_S, SNIMKA_WINDOW, ZAGREB_OFFSET_S, type StationsFile } from '../../shared/snimka';
import { BAJS_MISSING, BAJS_NOT_RENTING, decodeBajs, encodeBajs } from '../../shared/snimka-codec';
import { OVERLAY_DARK, OVERLAY_LIGHT } from '../../app/src/map/basemap';
import { contrastRatio } from '../../app/src/ui/contrast';
import {
  ANOMALY_PP, BAJS_LAYER, BAJS_RAMP, BAJS_SOURCE, F_QUANTUM, REFERENCE_DAY_START_S, bajsLayerSpec, bajsStageLayer, bajsStatesAt, bikesTip, changedStates, hiddenStates,
  quantise, referenceIndex, samplePosition, stationStateAt, windowMax, zagrebWeekday, type StationState,
} from '../../app/src/snimka/bajs-layer';
import { MARKS, buildBajs, buildStations, buildWindowSeries } from '../../e2e/snimka-fixtures';

const zg = (month: number, day: number, hour: number, minute = 0): number => Date.UTC(2026, month - 1, day, hour, minute) / 1000 - ZAGREB_OFFSET_S;
const T0 = SNIMKA_WINDOW.fromSec;
const N = (SNIMKA_WINDOW.minutes * 60) / BAJS_STEP_S;
const at = (i: number, j = i + 1, frac = 0) => ({ i, j, frac });

/** A row of `n` samples filled from a function of the sample index. */
const rowOf = (n: number, fn: (k: number) => number): Uint8Array => Uint8Array.from({ length: n }, (_, k) => fn(k));

describe('samplePosition and referenceIndex', () => {
  const file = { t0: T0, n: N };
  it('finds the two samples around an instant and the way between them, clamped to the file', () => {
    expect(samplePosition(file, T0)).toEqual({ i: 0, j: 1, frac: 0 });
    expect(samplePosition(file, T0 + 150)).toEqual({ i: 0, j: 1, frac: 0.5 });
    expect(samplePosition(file, T0 + 300)).toEqual({ i: 1, j: 2, frac: 0 });
    expect(samplePosition(file, T0 - 1000)).toEqual({ i: 0, j: 1, frac: 0 });
    expect(samplePosition(file, T0 + N * 300 + 1000)).toEqual({ i: N - 1, j: N - 1, frac: 0 });
    expect(samplePosition({ t0: T0, n: 0 }, T0)).toBeNull();
  });
  it('points at Thursday 1 October at the same Zagreb minute of day; -1 outside the file', () => {
    expect(REFERENCE_DAY_START_S).toBe(zg(10, 1, 0, 0));
    const monday0900 = zg(9, 28, 9, 0);
    const ref = referenceIndex(file, monday0900);
    expect(T0 + ref * BAJS_STEP_S).toBe(zg(10, 1, 9, 0));
    expect(referenceIndex(file, zg(9, 29, 23, 59))).toBe(referenceIndex(file, zg(9, 30, 23, 59)));
    expect(referenceIndex({ t0: T0, n: 10 }, monday0900)).toBe(-1);
    expect(zagrebWeekday(monday0900)).toBe(1);
    expect(zagrebWeekday(zg(10, 1, 9, 0))).toBe(4);
    expect(zagrebWeekday(zg(9, 27, 22, 0))).toBe(0);
  });
});

describe('stationStateAt', () => {
  it('interpolates the count linearly between the two samples against the capacity, quantised to 1/32', () => {
    const row = rowOf(4, (k) => [10, 2, 20, 20][k]!);
    expect(stationStateAt(row, 20, at(0, 1, 0), -1, false, false)).toMatchObject({ f: 0.5, e: false, a: false, m: false, s: false });
    expect(stationStateAt(row, 20, at(0, 1, 0.5), -1, false, false).f).toBe(quantise(6 / 20));
    expect(stationStateAt(row, 20, at(0, 1, 0.5), -1, false, true).f).toBe(0.5); // reduced motion: the sample's own value
    expect(stationStateAt(row, 20, at(2, 3, 0.3), -1, false, false).f).toBe(1);
    expect(quantise(0.3)).toBe(Math.round(0.3 * 32) / 32);
    expect(F_QUANTUM).toBe(1 / 32);
  });
  it('is empty under half a bike, with the canvas fill flagged and no rim unless the reference says so', () => {
    const row = rowOf(2, (k) => [0, 3][k]!);
    expect(stationStateAt(row, 20, at(0, 1, 0), -1, false, false)).toMatchObject({ f: 0, e: true, a: false });
    // Gliding from 0 towards 3: empty until half a bike.
    expect(stationStateAt(row, 20, at(0, 1, 0.1), -1, false, false).e).toBe(true);
    expect(stationStateAt(row, 20, at(0, 1, 0.5), -1, false, false).e).toBe(false);
  });
  it('a missing byte draws nothing, a not-renting byte is spent, and neither glides', () => {
    const row = rowOf(3, (k) => [BAJS_MISSING, BAJS_NOT_RENTING, 10][k]!);
    expect(stationStateAt(row, 20, at(0, 1, 0.5), -1, false, false)).toEqual({ f: 0, e: false, a: false, m: true, s: false });
    expect(stationStateAt(row, 20, at(1, 2, 0.5), -1, false, false)).toEqual({ f: 0, e: false, a: false, m: false, s: true });
    // A numeric sample followed by a missing one stands on its own value.
    const edge = rowOf(2, (k) => [10, BAJS_MISSING][k]!);
    expect(stationStateAt(edge, 20, at(0, 1, 0.9), -1, false, false).f).toBe(0.5);
  });
  it('capacity null takes the most bikes the station ever held in the window', () => {
    const row = rowOf(4, (k) => [5, 10, BAJS_MISSING, 2][k]!);
    expect(windowMax(row)).toBe(10);
    expect(windowMax(rowOf(2, () => BAJS_MISSING))).toBeNull();
    expect(stationStateAt(row, null, at(0, 1, 0), -1, false, false).f).toBe(0.5);
    expect(stationStateAt(row, 0, at(1, 2, 0), -1, false, false).f).toBe(1);
    expect(stationStateAt(rowOf(2, () => 0), null, at(0, 1, 0), -1, false, false)).toMatchObject({ f: 0, e: true });
  });
  it('the rim: at least 30 points of the capacity emptier than the reference sample; none on the reference days, none on 254/255', () => {
    // 2 now against 15 on the reference day of a 20-place station: 65 points emptier.
    const row = rowOf(3, (k) => [2, 15, 10][k]!);
    expect(stationStateAt(row, 20, at(0, 0, 0), 1, false, false).a).toBe(true);
    expect(stationStateAt(row, 20, at(0, 0, 0), 1, true, false).a).toBe(false); // Thursday or Friday
    expect(stationStateAt(row, 20, at(0, 0, 0), -1, false, false).a).toBe(false); // no reference sample
    expect(stationStateAt(row, 20, at(2, 2, 0), 1, false, false).a).toBe(false); // 10 against 15: 25 points
    expect(stationStateAt(rowOf(2, (k) => [2, 8][k]!), 20, at(0, 0, 0), 1, false, false).a).toBe(true); // exactly 30 points
    expect(stationStateAt(rowOf(2, (k) => [2, BAJS_MISSING][k]!), 20, at(0, 0, 0), 1, false, false).a).toBe(false);
    expect(stationStateAt(rowOf(2, (k) => [2, BAJS_NOT_RENTING][k]!), 20, at(0, 0, 0), 1, false, false).a).toBe(false);
    expect(ANOMALY_PP).toBe(0.3);
  });
});

describe('bajsStatesAt, hiddenStates and changedStates', () => {
  const stations: StationsFile = { v: 1, stations: [
    { id: 'a', name: 'A', lon: 15.9, lat: 45.8, capacity: 20 },
    { id: 'b', name: 'B', lon: 15.91, lat: 45.8, capacity: null },
    { id: 'c', name: 'C', lon: 15.92, lat: 45.8, capacity: 20 },
  ] };
  const file = encodeBajs(T0, BAJS_STEP_S, ['a', 'b'], [rowOf(N, () => 4), rowOf(N, (k) => (k < 10 ? BAJS_MISSING : 8))]);
  const rows = decodeBajs(file);
  it('answers every station of the stations file; one the bytes lack is missing; counts the drawn and the rims', () => {
    const r = bajsStatesAt(stations, file, rows, T0 + 20 * 300);
    expect([...r.states.keys()]).toEqual(['a', 'b', 'c']);
    expect(r.states.get('a')).toMatchObject({ f: quantise(4 / 20), m: false });
    expect(r.states.get('b')).toMatchObject({ f: 1, m: false });
    expect(r.states.get('c')).toMatchObject({ m: true });
    expect(r.drawn).toBe(2);
    expect(r.anomalies).toBe(0);
    expect(r.missing).toBe(false);
    const early = bajsStatesAt(stations, file, rows, T0 + 2 * 300);
    expect(early.drawn).toBe(1);
    expect(early.missing).toBe(false);
    const none = bajsStatesAt(stations, { ...file, n: 0 }, [], T0);
    expect(none.missing).toBe(true);
    expect(none.drawn).toBe(0);
  });
  it('hiddenStates is every station missing; changedStates lists only what differs', () => {
    const hidden = hiddenStates(stations);
    expect([...hidden.values()].every((s) => s.m)).toBe(true);
    const next = bajsStatesAt(stations, file, rows, T0 + 20 * 300).states;
    expect(changedStates(hidden, next).map(([id]) => id)).toEqual(['a', 'b']);
    expect(changedStates(next, next)).toEqual([]);
    const nudged = new Map(next);
    nudged.set('a', { ...next.get('a')!, f: next.get('a')!.f + F_QUANTUM });
    expect(changedStates(next, nudged).map(([id]) => id)).toEqual(['a']);
    expect(changedStates(new Map(), next)).toHaveLength(3);
  });
});

describe('bikesTip', () => {
  it('says the count of the capacity and the reference day, "?" for an unknown capacity, nothing for a byte without a number', () => {
    expect(bikesTip(12, 20, 15)).toBe('12 od 20 mjesta · u četvrtak 1. 10. u isto doba 15');
    expect(bikesTip(0, null, BAJS_MISSING)).toBe('0 od ? mjesta');
    expect(bikesTip(BAJS_MISSING, 20, 15)).toBeNull();
    expect(bikesTip(BAJS_NOT_RENTING, 20, 15)).toBeNull();
  });
});

describe('the layer spec', () => {
  it('is one circle layer on its own source reading feature state: the ramp by f, the canvas when empty, the spent grey, the rim by a and e, nothing when missing', () => {
    for (const p of [OVERLAY_LIGHT, OVERLAY_DARK]) {
      const layer = bajsLayerSpec(p, 1) as unknown as { id: string; type: string; source: string; paint: Record<string, unknown[]> };
      expect(layer.id).toBe(BAJS_LAYER);
      expect(layer.type).toBe('circle');
      expect(layer.source).toBe(BAJS_SOURCE);
      expect(layer.paint['circle-color']).toEqual(['case', ['boolean', ['feature-state', 's'], false], p.bikeSpent, ['boolean', ['feature-state', 'e'], false], p.stopFill,
        ['interpolate', ['linear'], ['feature-state', 'f'], 0, BAJS_RAMP[0], 0.25, BAJS_RAMP[1], 0.5, BAJS_RAMP[2], 0.75, BAJS_RAMP[3], 1, BAJS_RAMP[4]]]);
      expect(layer.paint['circle-stroke-color']).toEqual(['case', ['boolean', ['feature-state', 'sel'], false], p.selection, ['boolean', ['feature-state', 'a'], false], p.closure, ['boolean', ['feature-state', 'e'], false], p.stopStroke, p.stopFill]);
      expect(layer.paint['circle-stroke-width']).toEqual(['case', ['boolean', ['feature-state', 'sel'], false], 3, ['boolean', ['feature-state', 'a'], false], 2, ['boolean', ['feature-state', 'e'], false], 1, 0]);
      expect(layer.paint['circle-radius']).toEqual(['interpolate', ['linear'], ['zoom'], 12, 4, 13, 4.5, 15, 7]);
      expect(layer.paint['circle-opacity']).toEqual(['case', ['boolean', ['feature-state', 'm'], false], 0, 1]);
    }
    expect((bajsLayerSpec(OVERLAY_LIGHT, 2) as unknown as { paint: Record<string, unknown[]> }).paint['circle-radius']).toEqual(['interpolate', ['linear'], ['zoom'], 12, 8, 13, 9, 15, 14]);
  });
  it('the ramp ends on bikeDisc, is one hue of five steps, and both ends clear their canvas (the validator: light end 2.14:1 by day, deep end 2.76:1 by night)', () => {
    expect(BAJS_RAMP).toEqual(['#77b4a8', '#5fa194', '#478f82', '#2e7d70', '#0b6b5e']);
    expect(BAJS_RAMP[4]).toBe(OVERLAY_LIGHT.bikeDisc);
    expect(contrastRatio(BAJS_RAMP[0], OVERLAY_LIGHT.stopFill)).toBeGreaterThanOrEqual(2);
    expect(contrastRatio(BAJS_RAMP[4], OVERLAY_DARK.stopFill)).toBeGreaterThanOrEqual(2.5);
    // The urgency rim stands on both canvases and off the deepest teal.
    expect(contrastRatio(OVERLAY_LIGHT.closure, OVERLAY_LIGHT.stopFill)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(OVERLAY_DARK.closure, OVERLAY_DARK.stopFill)).toBeGreaterThanOrEqual(4.5);
  });
  it('the stage layer carries the stations as points keyed "bajs:<id>", picked as places', () => {
    const spec = bajsStageLayer({ v: 1, stations: [{ id: 'x', name: 'X', lon: 15.9, lat: 45.8, capacity: 20 }] });
    expect(spec.source).toBe(BAJS_SOURCE);
    expect(spec.promoteId).toBe('id');
    expect(spec.pick).toBe('place');
    expect(spec.data).toEqual({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [15.9, 45.8] }, properties: { id: 'bajs:x', name: 'X' } }] });
    expect(spec.layer(OVERLAY_LIGHT, 1)).toEqual(bajsLayerSpec(OVERLAY_LIGHT, 1));
  });
});

describe('on the e2e fixture', () => {
  const series = buildWindowSeries();
  const stations = buildStations();
  const file = buildBajs(series);
  const rows = decodeBajs(file);
  it('Stanica 2 carries the rim on Monday 09:00 and no station does on Thursday 09:00; before the recorders the bikes are missing', () => {
    const monday = bajsStatesAt(stations, file, rows, MARKS.monday0900);
    expect(monday.anomalies).toBeGreaterThan(0);
    expect(monday.states.get('bajs-2')).toMatchObject({ a: true, e: false, f: quantise(2 / 20) });
    expect(monday.states.get('bajs-3')!.a).toBe(false);
    expect(monday.states.get('bajs-7')!.s).toBe(true); // never renting in the fixture
    expect(monday.drawn).toBe(stations.stations.length); // every station has a byte: the not-renting one draws as spent
    const thursday = bajsStatesAt(stations, file, rows, MARKS.thursday0900);
    expect(thursday.anomalies).toBe(0);
    expect(thursday.states.get('bajs-2')).toMatchObject({ a: false, f: quantise(15 / 20) });
    const sunday = bajsStatesAt(stations, file, rows, zg(9, 27, 22, 0));
    expect(sunday.missing).toBe(true);
    expect(sunday.drawn).toBe(0);
  });
  it('feature-state calls per sample at Monday 09:00: every station on the first push, then only the stations that moved (reported for the ledger)', () => {
    let applied: Map<string, StationState> = hiddenStates(stations);
    const perPush: number[] = [];
    // Ten pushes a second over one five-minute sample at ten minutes a second: half a replay second of wall time, five frames.
    for (let k = 0; k <= 5; k++) {
      const next = bajsStatesAt(stations, file, rows, MARKS.monday0900 + k * 60).states;
      perPush.push(changedStates(applied, next).length);
      applied = next;
    }
    expect(perPush[0]).toBe(stations.stations.length);
    const later = perPush.slice(1);
    expect(Math.max(...later)).toBeLessThanOrEqual(stations.stations.length);
    // Every later push is a subset: a station whose quantised level holds writes nothing.
    expect(later.some((n) => n < stations.stations.length)).toBe(true);
    console.log(`[bajs] feature-state calls per push at Mon 09:00 on the fixture (${stations.stations.length} stations): first ${perPush[0]}, then ${later.join(', ')}`);
  });
});
