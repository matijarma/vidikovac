import { describe, expect, it } from 'vitest';
import type { XY } from '../../app/src/motion/geo';
import { at, cumulative, project, tangent } from '../../app/src/motion/polyline';

// A small seeded PRNG so the thousand-query hint-equivalence test is
// deterministic across runs (a real failure must reproduce, not flicker).
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('cumulative', () => {
  it('starts at 0 and accumulates straight-line segment lengths', () => {
    const points: XY[] = [
      { x: 0, y: 0 },
      { x: 3, y: 4 }, // 5 away
      { x: 3, y: 14 }, // +10
    ];
    expect(cumulative(points)).toEqual([0, 5, 15]);
  });
});

describe('project on a straight north-south line', () => {
  // x = east, y = north (toPlane's own convention): a line running due
  // north from the origin.
  const points: XY[] = [
    { x: 0, y: 0 },
    { x: 0, y: 100 },
    { x: 0, y: 200 },
  ];
  const cum = cumulative(points);

  it('projects a point east of the line onto the line at the matching arc length, with the perpendicular distance', () => {
    const q: XY = { x: 30, y: 120 };
    const p = project(points, cum, q);
    expect(p.s).toBeCloseTo(120, 9);
    expect(p.d).toBeCloseTo(30, 9);
    expect(p.p.x).toBeCloseTo(0, 9);
    expect(p.p.y).toBeCloseTo(120, 9);
    expect(p.idx).toBe(1); // second segment: points[1] -> points[2]
    expect(p.t).toBeCloseTo(0.2, 9); // 120 is 20% of the way from 100 to 200
  });

  it('clamps to the nearest end when the query is beyond either end', () => {
    const before = project(points, cum, { x: 5, y: -50 });
    expect(before.s).toBeCloseTo(0, 9);
    expect(before.p).toEqual({ x: 0, y: 0 });

    const after = project(points, cum, { x: 5, y: 250 });
    expect(after.s).toBeCloseTo(200, 9);
    expect(after.p).toEqual({ x: 0, y: 200 });
  });
});

describe('at / cumulative round-trip', () => {
  it('reproduces every original point from its own cumulative arc length, within a millimetre', () => {
    const points: XY[] = [
      { x: 0, y: 0 },
      { x: 40, y: 10 },
      { x: 55, y: 80 },
      { x: 55, y: 80 }, // deliberately repeated: a zero-length segment mid-shape
      { x: 10, y: 120 },
      { x: -30, y: 90 },
    ];
    const cum = cumulative(points);
    for (let i = 0; i < points.length; i++) {
      const p = at(points, cum, cum[i]);
      expect(Math.abs(p.x - points[i].x)).toBeLessThan(0.001);
      expect(Math.abs(p.y - points[i].y)).toBeLessThan(0.001);
    }
  });

  it('interpolates linearly between two points at the midpoint arc length', () => {
    const points: XY[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ];
    const cum = cumulative(points);
    const mid = at(points, cum, 50);
    expect(mid.x).toBeCloseTo(50, 9);
    expect(mid.y).toBeCloseTo(0, 9);
  });

  it('clamps s to both ends', () => {
    const points: XY[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ];
    const cum = cumulative(points);
    expect(at(points, cum, -50)).toEqual({ x: 0, y: 0 });
    expect(at(points, cum, 500)).toEqual({ x: 100, y: 0 });
  });
});

describe('tangent', () => {
  it('is continuous across a vertex where the path does not actually change direction', () => {
    // Three collinear points: the middle one is a redundant vertex, not a
    // real corner. The tangent just before and just after its arc length
    // must be the identical unit vector -- no artificial seam.
    const points: XY[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 }, // redundant collinear vertex
      { x: 200, y: 0 },
    ];
    const cum = cumulative(points);
    const before = tangent(points, cum, 100 - 1e-6);
    const atVertex = tangent(points, cum, 100);
    const after = tangent(points, cum, 100 + 1e-6);
    expect(before).toEqual({ x: 1, y: 0 });
    expect(atVertex).toEqual({ x: 1, y: 0 });
    expect(after).toEqual({ x: 1, y: 0 });
  });

  it('is a unit vector matching each segment\'s own direction at a real corner', () => {
    const points: XY[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ];
    const cum = cumulative(points);
    const onFirst = tangent(points, cum, 50);
    const onSecond = tangent(points, cum, 150);
    expect(onFirst).toEqual({ x: 1, y: 0 });
    expect(onSecond).toEqual({ x: 0, y: 1 });
  });

  it('never divides by zero when the shape ends in a repeated point', () => {
    // segmentIndexAt always resolves an exact tie in cum[] to the later
    // segment, so the one case that can actually land squarely on a
    // zero-length segment is a duplicated final point -- this is that case.
    const points: XY[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 0 }, // duplicated final point: a degenerate trailing segment
    ];
    const cum = cumulative(points);
    const t = tangent(points, cum, cum[cum.length - 1]);
    expect(t.x).toBeCloseTo(1, 9);
    expect(t.y).toBeCloseTo(0, 9);
    expect(Number.isNaN(t.x)).toBe(false);
    expect(Number.isNaN(t.y)).toBe(false);
  });
});

describe('project: the hint changes only the work, never the answer', () => {
  // A deliberately awkward shape: a sine-wave path that loops back to pass
  // close to its own start -- exactly the kind of shape (a looped bus
  // route) where a naive "search near the hint and stop" heuristic would
  // silently return the wrong point. The bound project() uses to stop
  // early must remain correct here, not just on a tame straight line.
  function buildLoopyShape(n: number): XY[] {
    const pts: XY[] = [];
    for (let i = 0; i < n; i++) {
      // Almost a full turn, deliberately not a closed loop: a real GTFS
      // shape's own first and last point are never required to coincide,
      // and closing this one exactly would create a second, physically
      // real ambiguity (the loop's join) between two well-separated arc
      // lengths -- a real thing a route can have, but a different concern
      // from what this test is proving about the search itself.
      const a = (i / (n - 1)) * Math.PI * 1.85;
      const radius = 500 + 80 * Math.sin(a * 5);
      pts.push({ x: radius * Math.cos(a), y: radius * Math.sin(a) });
    }
    return pts;
  }

  const points = buildLoopyShape(400);
  const cum = cumulative(points);
  const rand = mulberry32(20260912);

  it('gives the identical projection with or without a hint, across 1000 random queries and hints', () => {
    for (let i = 0; i < 1000; i++) {
      const q: XY = { x: (rand() - 0.5) * 2000, y: (rand() - 0.5) * 2000 };
      const hint = Math.floor(rand() * (points.length - 1));
      const unhinted = project(points, cum, q);
      const hinted = project(points, cum, q, hint);
      expect(hinted.idx).toBe(unhinted.idx);
      expect(hinted.t).toBeCloseTo(unhinted.t, 9);
      expect(hinted.s).toBeCloseTo(unhinted.s, 9);
      expect(hinted.d).toBeCloseTo(unhinted.d, 9);
      expect(hinted.p.x).toBeCloseTo(unhinted.p.x, 9);
      expect(hinted.p.y).toBeCloseTo(unhinted.p.y, 9);
    }
  });

  it('also agrees when the hint starts at the far end from the true answer', () => {
    const q: XY = { x: points[200].x + 1, y: points[200].y + 1 };
    const full = project(points, cum, q);
    const fromStart = project(points, cum, q, 0);
    const fromEnd = project(points, cum, q, points.length - 2);
    expect(fromStart).toEqual(full);
    expect(fromEnd).toEqual(full);
  });
});
