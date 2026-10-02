// One route's series (app/src/snimka/route-series.ts): the sample at an
// instant, the whole curve with null for 255, and the hourly means the
// heatmap draws (null where nothing is scheduled or every sample is missing).
import { describe, expect, it } from 'vitest';
import { ROUTES_STEP_S } from '../../shared/snimka';
import { ROUTES_MISSING, encodeRoutes } from '../../shared/snimka-codec';
import { decodeRoutes, hourCount, hourMeans, hourMeansTable, routeCurve, routeIndex, routeSample } from '../../app/src/snimka/route-series';

const T0 = 1_790_532_000; // on the hour
const row = (...values: number[]): Uint8Array => Uint8Array.from(values);
// 15 samples: an hour and a quarter. Route 6 full then half then missing; 228 unscheduled in the first hour.
const file = encodeRoutes(
  T0, ROUTES_STEP_S,
  [{ id: '6', shortName: '6', type: 0 }, { id: '228', shortName: '228', type: 3 }],
  [row(4, 4, 4, 4, 4, 4, 2, 2, 2, 2, 2, 2, ROUTES_MISSING, ROUTES_MISSING, ROUTES_MISSING), row(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3)],
  [row(4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4), row(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 2, 2)],
);

describe('routeSample and routeCurve', () => {
  it('reads the sample holding the instant, null for 255 and outside the file or for an unknown route', () => {
    expect(routeSample(file, '6', T0 + 7 * ROUTES_STEP_S + 100)).toEqual({ seen: 2, expected: 4 });
    expect(routeSample(file, '6', T0 + 13 * ROUTES_STEP_S)).toEqual({ seen: null, expected: 4 });
    expect(routeSample(file, '6', T0 - 1)).toEqual({ seen: null, expected: null });
    expect(routeSample(file, '6', T0 + 15 * ROUTES_STEP_S)).toEqual({ seen: null, expected: null });
    expect(routeSample(file, '99', T0)).toEqual({ seen: null, expected: null });
  });
  it('the curve is n long with null where the file says 255; an unknown route gives empty arrays', () => {
    const curve = routeCurve(file, '6');
    expect(curve.seen).toHaveLength(15);
    expect(curve.seen.slice(10)).toEqual([2, 2, null, null, null]);
    expect(curve.expected[14]).toBe(4);
    expect(routeCurve(file, '99')).toEqual({ seen: [], expected: [] });
  });
  it('decodes the columns once per file object and indexes the routes once', () => {
    expect(decodeRoutes(file)).toBe(decodeRoutes(file));
    expect(routeIndex(file, '228')).toBe(1);
    expect(routeIndex(file, '99')).toBe(-1);
  });
});

describe('hourMeans', () => {
  it('averages min(1, seen/expected) over the hour, null where unscheduled, skipping missing samples', () => {
    expect(hourCount(file)).toBe(2);
    expect(hourMeans(file, '6')).toEqual([0.75, null]); // six at 1, six at 0.5; the last hour is all 255
    expect(hourMeans(file, '228')).toEqual([null, 2.5 / 3]); // nothing scheduled, then 0.5, 1 and min(1, 1.5)
    expect(hourMeans(file, '99')).toEqual([null, null]);
  });
  it('the table has one row per route in file order', () => {
    expect(hourMeansTable(file)).toEqual([[0.75, null], [null, 2.5 / 3]]);
  });
});
