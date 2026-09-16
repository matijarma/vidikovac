// The engine's own report card: when a vehicle's new fix arrives, what did
// the plans the twin published 10, 30 and 60 seconds earlier say its
// position would be now, and how far off were they? Every tick the twin
// grades every fresh fix this way and counts the errors into a small
// histogram (R-TE3: `twin_hindsight`, dim1 the horizon, dim2 the bucket), so
// the quality of the motion on every screen is a number on /stats, not an
// impression. Pure: the twin keeps a short ring of published plans per
// vehicle and hands it in with the fix.

import { dist, toPlane } from './geo';
import type { GraphNetwork } from './network';
import { evalFreePlan, evalPathPlan } from './plan';
import { at } from './polyline';
import type { Plan, PlaneFix } from './track';

/** The horizons a viewer feels: one tick, one poll cycle with cushion, and
 *  the far end of what a client integrates between two polls it missed. */
export const HORIZONS_S = [10, 30, 60] as const;
export type Horizon = (typeof HORIZONS_S)[number];

/** Error bands in metres along the path: a tram length, two, a stop
 *  spacing's third, a stop spacing's two thirds, and beyond. */
export const BUCKETS = ['lt25', 'lt50', 'lt100', 'lt200', 'ge200'] as const;
export type Bucket = (typeof BUCKETS)[number];

/** Plans kept per vehicle: seven ticks of publishing covers a 60 s horizon
 *  even when the alarm ran a little late. */
export const HINDSIGHT_RING = 7;

/** A fix this far off the plan's path is graded by the straight line to the
 *  plan's point, not by an arc that no longer means anything (match.ts's
 *  off-graph band). */
export const OFF_PATH_FALLBACK_M = 150;

export interface PublishedPlan {
  headerSec: number;
  plan: Plan;
}

export type HindsightCounts = Record<Horizon, Record<Bucket, number>>;

export function emptyCounts(): HindsightCounts {
  const counts = {} as HindsightCounts;
  for (const h of HORIZONS_S) {
    counts[h] = { lt25: 0, lt50: 0, lt100: 0, lt200: 0, ge200: 0 };
  }
  return counts;
}

export function bucketOf(errorM: number): Bucket {
  if (errorM < 25) return 'lt25';
  if (errorM < 50) return 'lt50';
  if (errorM < 100) return 'lt100';
  if (errorM < 200) return 'lt200';
  return 'ge200';
}

export function horizonKey(horizon: Horizon): string {
  return `${horizon}s`;
}

/** Appends a published plan, replacing one from the same header, capped at the ring length. */
export function rememberPlan(ring: PublishedPlan[], entry: PublishedPlan): void {
  const same = ring.findIndex((r) => r.headerSec === entry.headerSec);
  if (same >= 0) ring[same] = entry;
  else ring.push(entry);
  ring.sort((a, b) => a.headerSec - b.headerSec);
  if (ring.length > HINDSIGHT_RING) ring.splice(0, ring.length - HINDSIGHT_RING);
}

/** Where a plan put the vehicle at `tRel`, and how far that is from the fix. */
function errorOf(net: GraphNetwork, plan: Plan, tRel: number, fix: PlaneFix): number {
  if (plan.on === 'path') {
    const s = evalPathPlan(plan.knots, tRel);
    if (fix.arc?.key === `p${plan.pathIdx}`) return Math.abs(s - fix.arc.s);
    const proj = net.projectOntoPath(plan.pathIdx, fix);
    if (proj.d <= OFF_PATH_FALLBACK_M) return Math.abs(s - proj.s);
    return dist(net.toPathPoint(plan.pathIdx, s), fix);
  }
  if (plan.on === 'shape') {
    const s = evalPathPlan(plan.knots, tRel);
    if (fix.arc?.key === `b${plan.shapeIdx}`) return Math.abs(s - fix.arc.s);
    const shape = net.shapes[plan.shapeIdx];
    return dist(at(shape.pts, shape.cum, s), fix);
  }
  const [lon, lat] = evalFreePlan(plan.knots, tRel);
  return dist(toPlane(lon, lat), fix);
}

/** For each horizon, the newest plan published at least that long before the
 *  fix, graded against the fix. Horizons with no old enough plan are skipped. */
export function gradeFix(net: GraphNetwork, fix: PlaneFix, ring: readonly PublishedPlan[]): { horizon: Horizon; errorM: number }[] {
  const out: { horizon: Horizon; errorM: number }[] = [];
  for (const horizon of HORIZONS_S) {
    let chosen: PublishedPlan | null = null;
    for (const entry of ring) if (entry.headerSec <= fix.atSec - horizon && (!chosen || entry.headerSec > chosen.headerSec)) chosen = entry;
    if (!chosen) continue;
    out.push({ horizon, errorM: errorOf(net, chosen.plan, fix.atSec - chosen.headerSec, fix) });
  }
  return out;
}

/** Adds one graded fix to the histogram. */
export function countGrades(counts: HindsightCounts, grades: readonly { horizon: Horizon; errorM: number }[]): void {
  for (const grade of grades) counts[grade.horizon][bucketOf(grade.errorM)]++;
}
