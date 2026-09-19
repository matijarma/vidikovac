import { describe, expect, it } from 'vitest';
import { toLonLat } from '../../shared/motion/geo';
import { countGrades, countSignGrades, emptyCounts, emptySignCounts, gradeFix, signBucketOf, type PublishedPlan } from '../../shared/motion/hindsight';
import type { PlaneFix } from '../../shared/motion/track';
import { corridorSpec, syntheticNetwork } from './synthetic-network';

// F7: the report card gains a sign. `errorM` stays the unsigned distance the
// existing buckets count; `signedM` is the plan's arc minus the fix's arc
// along the path, positive when the plan ran ahead of the tram (the failure
// the round's rule forbids), negative when it lagged behind (what a viewer
// reads as GPS lag).
describe('gradeFix with a sign', () => {
  const net = syntheticNetwork(corridorSpec());
  const pathIdx = net.paths.findIndex((p) => p.id === '1_0');
  const T = 1_800_000_000;

  function fixAt(s: number, atSec: number): PlaneFix {
    const p = net.toPathPoint(pathIdx, s);
    const [lon, lat] = toLonLat(p);
    return { x: p.x, y: p.y, lon, lat, atSec, arc: { key: `p${pathIdx}`, s, atStop: false } };
  }

  /** A plan published at `headerSec` that puts the tram at `s0` then and cruises 10 m/s. */
  function published(headerSec: number, s0: number): PublishedPlan {
    return { headerSec, plan: { on: 'path', pathIdx, knots: [[0, s0], [90, s0 + 900]] } };
  }

  it('signs the error positive when the plan is ahead of the fix and negative when behind, keeping errorM absolute', () => {
    // Published 30 s before the fix: at the fix it says s0 + 300.
    const ahead = gradeFix(net, fixAt(500, T + 30), [published(T, 280)]);
    expect(ahead).toEqual([{ horizon: 10, errorM: 80, signedM: 80 }, { horizon: 30, errorM: 80, signedM: 80 }]);

    const behind = gradeFix(net, fixAt(500, T + 30), [published(T, 150)]);
    expect(behind[0]).toEqual({ horizon: 10, errorM: 50, signedM: -50 });
  });

  it('buckets the sign at a tram-and-a-half: ahead_ge50 | within50 | behind_ge50, and counts beside the unsigned histogram', () => {
    expect(signBucketOf(50)).toBe('ahead_ge50');
    expect(signBucketOf(49.9)).toBe('within50');
    expect(signBucketOf(-49.9)).toBe('within50');
    expect(signBucketOf(-50)).toBe('behind_ge50');

    const counts = emptyCounts();
    const signs = emptySignCounts();
    const grades = gradeFix(net, fixAt(500, T + 30), [published(T, 280)]);
    countGrades(counts, grades);
    countSignGrades(signs, grades);
    expect(counts[30].lt100).toBe(1);
    expect(signs[30].ahead_ge50).toBe(1);
    expect(signs[30].within50 + signs[30].behind_ge50).toBe(0);
  });

  it('signs a fix off the plan\'s own geometry by its projection onto the path', () => {
    // The fix carries no arc key: it is projected onto the path (30 m north of arc 500).
    const p = net.toPathPoint(pathIdx, 500);
    const [lon, lat] = toLonLat({ x: p.x, y: p.y + 30 });
    const fix: PlaneFix = { x: p.x, y: p.y + 30, lon, lat, atSec: T + 10 };
    const [grade] = gradeFix(net, fix, [published(T, 460)]);
    expect(grade.errorM).toBeCloseTo(60, 6);
    expect(grade.signedM).toBeCloseTo(60, 6);
  });
});
