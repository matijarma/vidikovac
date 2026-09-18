// The standing time the speed estimator charges for a stop an interval
// swallowed. It used to charge a flat 20 s for every platform the rails
// passed between the two fixes; it now charges what the stop itself is known
// to hold a vehicle for, over the stops the LINE CALLS AT (F8) -- the same
// number the learner prices its dwell samples with.
import { describe, expect, it } from 'vitest';
import { DWELL_CHARGE_S, estimateSpeed } from '../../shared/motion/speed';
import type { PlaneFix } from '../../shared/motion/track';

/** Two fixes 300 m and 60 s apart on one path, both clear of any platform. */
const fixes: PlaneFix[] = [
  { x: 0, y: 0, lon: 16, lat: 45.8, atSec: 1000, arc: { key: 'p3', s: 0, atStop: false } },
  { x: 300, y: 0, lon: 16, lat: 45.8, atSec: 1060, arc: { key: 'p3', s: 300, atStop: false } },
];

describe('estimateSpeed', () => {
  it('charges each swallowed stop its own dwell, and the flat one only where nothing knows better', () => {
    const asked: [string, number, number][] = [];
    const stopsBetween = (key: string, fromS: number, toS: number): string[] => {
      asked.push([key, fromS, toS]);
      return ['A', 'B'];
    };

    // Nothing charged at all: the raw pace over the interval.
    expect(estimateSpeed(fixes)).toBeCloseTo(5, 6);

    // The flat charge: 2 x 20 s of the 60 s were standing, so 300 m in 20 s.
    expect(estimateSpeed(fixes, { stopsBetween })).toBeCloseTo(300 / (60 - 2 * DWELL_CHARGE_S), 6);
    // The dead zone at either end keeps a stop the vehicle was AT out of the charge.
    expect(asked).toEqual([['p3', 15, 285]]);

    // Per stop: A holds 30 s, B holds 5, so 35 s of the 60 were standing.
    const dwellOf = (stopId: string): number => (stopId === 'A' ? 30 : 5);
    expect(estimateSpeed(fixes, { stopsBetween, dwellOf })).toBeCloseTo(300 / 25, 6);
    // A stop the table says nothing about falls back to the context's own
    // flat dwell, and failing that to DWELL_CHARGE_S.
    expect(estimateSpeed(fixes, { stopsBetween, dwellOf: () => Number.NaN, dwellSec: 10 })).toBeCloseTo(300 / 40, 6);
    expect(estimateSpeed(fixes, { stopsBetween, dwellOf: () => undefined as unknown as number })).toBeCloseTo(300 / 20, 6);
  });
});
