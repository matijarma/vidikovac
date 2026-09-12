// Nearest-point projection and arc-length sampling on a simplified route
// shape (an array of XY in the local plane from geo.ts). Every vehicle's
// drawn position comes from here: a raw fix projects onto the shape, the
// motion model works forward in arc length from that point on, and `at`
// samples back out to a drawable XY, with `tangent` giving the heading to
// draw it facing.

import { dist, type XY } from './geo';

export interface Projection {
  /** Segment index: the segment runs points[idx] -> points[idx + 1]. */
  idx: number;
  /** Fraction along that segment, in [0, 1]. */
  t: number;
  /** Arc length of the projected point, in [0, cum[cum.length - 1]]. */
  s: number;
  /** Distance from the query point to the projected point. */
  d: number;
  /** The projected point itself. */
  p: XY;
}

/**
 * Cumulative arc length at each point: cum[0] is 0, cum[i] is the path
 * length from points[0] to points[i]. One entry per point.
 */
export function cumulative(points: readonly XY[]): number[] {
  const cum: number[] = points.length > 0 ? [0] : [];
  for (let i = 1; i < points.length; i++) {
    cum.push(cum[i - 1] + dist(points[i - 1], points[i]));
  }
  return cum;
}

/** Closest point on segment a-b to q, as a fraction t in [0, 1] plus the
 *  point and distance. Handles a zero-length segment (repeated point). */
function closestOnSegment(a: XY, b: XY, q: XY): { t: number; p: XY; d: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((q.x - a.x) * dx + (q.y - a.y) * dy) / len2;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const p: XY = { x: a.x + t * dx, y: a.y + t * dy };
  return { t, p, d: dist(q, p) };
}

function projectSegment(points: readonly XY[], cum: readonly number[], i: number, q: XY): Projection {
  const { t, p, d } = closestOnSegment(points[i], points[i + 1], q);
  const s = cum[i] + t * (cum[i + 1] - cum[i]);
  return { idx: i, t, s, d, p };
}

/**
 * A query point whose true nearest point is exactly a shared vertex is not
 * a rare coincidence: an entire wedge of query directions around a convex
 * bend all project to that same vertex, so both the segment before it
 * (landing at t=1, clamped) and the segment after it (t=0) find the exact
 * same point, distance and arc length -- just labelled differently. Pick
 * one canonical label, always: the later segment at t=0, matching
 * segmentIndexAt's own tie-break for `at`/`tangent` below, so a hinted and
 * an unhinted search -- which can land on either segment first -- always
 * agree, and so does a caller that later feeds this idx back in as a hint.
 */
function canonical(best: Projection, segCount: number): Projection {
  if (best.t === 1 && best.idx < segCount - 1) {
    return { idx: best.idx + 1, t: 0, s: best.s, d: best.d, p: best.p };
  }
  return best;
}

/**
 * Bounding box of points[from..to] inclusive, as a cheap and *sound* lower
 * bound on the distance from q to anything in that range -- including
 * every segment inside it, since a straight segment always lies within
 * the box of its own two endpoints. Used to decide whether it is worth
 * looking any further in a direction, never to skip a point outright.
 */
function boxDistance(
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
  q: XY,
): number {
  const cx = q.x < minX ? minX : q.x > maxX ? maxX : q.x;
  const cy = q.y < minY ? minY : q.y > maxY ? maxY : q.y;
  return dist(q, { x: cx, y: cy });
}

interface BoxArrays {
  preMinX: number[];
  preMaxX: number[];
  preMinY: number[];
  preMaxY: number[];
  sufMinX: number[];
  sufMaxX: number[];
  sufMinY: number[];
  sufMaxY: number[];
}

/** Prefix box (points[0..i]) and suffix box (points[i..n-1]) at every
 *  index, built in two linear passes so the search loop below can look up
 *  "the box of everything not yet visited on this side" in O(1). */
function buildBoxArrays(points: readonly XY[]): BoxArrays {
  const n = points.length;
  const preMinX = new Array<number>(n);
  const preMaxX = new Array<number>(n);
  const preMinY = new Array<number>(n);
  const preMaxY = new Array<number>(n);
  const sufMinX = new Array<number>(n);
  const sufMaxX = new Array<number>(n);
  const sufMinY = new Array<number>(n);
  const sufMaxY = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const p = points[i];
    preMinX[i] = i === 0 ? p.x : Math.min(p.x, preMinX[i - 1]);
    preMaxX[i] = i === 0 ? p.x : Math.max(p.x, preMaxX[i - 1]);
    preMinY[i] = i === 0 ? p.y : Math.min(p.y, preMinY[i - 1]);
    preMaxY[i] = i === 0 ? p.y : Math.max(p.y, preMaxY[i - 1]);
  }
  for (let i = n - 1; i >= 0; i--) {
    const p = points[i];
    sufMinX[i] = i === n - 1 ? p.x : Math.min(p.x, sufMinX[i + 1]);
    sufMaxX[i] = i === n - 1 ? p.x : Math.max(p.x, sufMaxX[i + 1]);
    sufMinY[i] = i === n - 1 ? p.y : Math.min(p.y, sufMinY[i + 1]);
    sufMaxY[i] = i === n - 1 ? p.y : Math.max(p.y, sufMaxY[i + 1]);
  }
  return { preMinX, preMaxX, preMinY, preMaxY, sufMinX, sufMaxX, sufMinY, sufMaxY };
}

/**
 * Nearest point on the polyline to q.
 *
 * Without a hint this scans every segment once -- for a 500-point shape,
 * a full scan every frame. With a hint it expands outward segment by
 * segment from that index, using the bounding box of whatever is still
 * unvisited on each side as a lower bound on how close anything out there
 * could possibly be: a segment always lies inside the box of its own
 * endpoints, so once that box is already farther from q than the best
 * distance found so far, nothing beyond it can improve on it, and that
 * side of the search stops. This is a real bound, not a locality
 * heuristic that merely tends to work -- it holds for any polyline,
 * including one that loops back close to itself (a looped route), so the
 * result is identical to the full scan for any hint, good or bad.
 */
export function project(points: readonly XY[], cum: readonly number[], q: XY, hint?: number): Projection {
  const n = points.length;
  if (n === 0) throw new Error('project: at least one point is required');
  if (n === 1) return { idx: 0, t: 0, s: 0, d: dist(q, points[0]), p: points[0] };

  const segCount = n - 1;

  if (hint === undefined) {
    let best = projectSegment(points, cum, 0, q);
    for (let i = 1; i < segCount; i++) {
      const cand = projectSegment(points, cum, i, q);
      if (cand.d < best.d) best = cand;
    }
    return canonical(best, segCount);
  }

  const start = Math.min(Math.max(Math.trunc(hint), 0), segCount - 1);
  const boxes = buildBoxArrays(points);
  let best = projectSegment(points, cum, start, q);
  let lo = start;
  let hi = start;
  let leftActive = lo > 0;
  let rightActive = hi < segCount - 1;

  while (leftActive || rightActive) {
    if (rightActive) {
      const j = hi + 1; // first not-yet-visited point index on the right
      const bound = boxDistance(boxes.sufMinX[j], boxes.sufMaxX[j], boxes.sufMinY[j], boxes.sufMaxY[j], q);
      if (bound >= best.d) {
        rightActive = false;
      } else {
        hi += 1;
        const cand = projectSegment(points, cum, hi, q);
        if (cand.d < best.d) best = cand;
        rightActive = hi < segCount - 1;
      }
    }
    if (leftActive) {
      // Box up to and including the CURRENT lo (the shared vertex with the
      // next candidate segment, lo-1 -> lo), mirroring the right-side box
      // starting at hi+1 (the shared vertex with hi -> hi+1). Stopping at
      // lo-1 here would leave that shared vertex out of the box, making the
      // bound unsound -- it would ignore exactly the point the next
      // segment is anchored to.
      const bound = boxDistance(boxes.preMinX[lo], boxes.preMaxX[lo], boxes.preMinY[lo], boxes.preMaxY[lo], q);
      if (bound >= best.d) {
        leftActive = false;
      } else {
        lo -= 1;
        const cand = projectSegment(points, cum, lo, q);
        if (cand.d < best.d) best = cand;
        leftActive = lo > 0;
      }
    }
  }
  return canonical(best, segCount);
}

/** Largest segment index i (0 <= i <= cum.length - 2) with cum[i] <= s.
 *  Ties (a zero-length segment) resolve to the later segment. */
function segmentIndexAt(cum: readonly number[], s: number): number {
  const segCount = cum.length - 1;
  let lo = 0;
  let hi = segCount - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (cum[mid] <= s) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** The point at arc length s, clamped to both ends. */
export function at(points: readonly XY[], cum: readonly number[], s: number): XY {
  const n = points.length;
  if (n === 0) throw new Error('at: at least one point is required');
  if (n === 1) return points[0];

  const total = cum[cum.length - 1];
  const clamped = s < 0 ? 0 : s > total ? total : s;
  const i = segmentIndexAt(cum, clamped);
  const segLen = cum[i + 1] - cum[i];
  const t = segLen === 0 ? 0 : (clamped - cum[i]) / segLen;
  const a = points[i];
  const b = points[i + 1];
  return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
}

function samePoint(a: XY, b: XY): boolean {
  return a.x === b.x && a.y === b.y;
}

/**
 * Unit tangent at arc length s, for drawing a tram along its track. A
 * zero-length (repeated-point) segment at the chosen arc length is
 * skipped forward, then backward, to the nearest real segment, so a
 * stationary vehicle's byte-identical fixes or a duplicated shape point
 * never produce a NaN or an arbitrary direction.
 */
export function tangent(points: readonly XY[], cum: readonly number[], s: number): XY {
  const n = points.length;
  if (n < 2) return { x: 1, y: 0 }; // no direction to give; a defined, harmless default

  const segCount = n - 1;
  const total = cum[cum.length - 1];
  const clamped = s < 0 ? 0 : s > total ? total : s;
  const i = segmentIndexAt(cum, clamped);

  let j = i;
  while (j < segCount - 1 && samePoint(points[j], points[j + 1])) j += 1;
  if (samePoint(points[j], points[j + 1])) {
    j = i;
    while (j > 0 && samePoint(points[j], points[j + 1])) j -= 1;
  }

  const a = points[j];
  const b = points[j + 1];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return { x: 1, y: 0 }; // every point in the shape is identical
  return { x: dx / len, y: dy / len };
}
