// The engine's own report card: when a vehicle's new fix arrives, what did
// the plans the twin published 10, 30 and 60 seconds earlier say its
// position would be now, and how far off were they? Every tick the twin
// grades every fresh fix this way and counts the errors into a small
// histogram (R-TE3: `twin_hindsight`, dim1 the horizon, dim2 the bucket), so
// the quality of the motion on every screen is a number on /stats, not an
// impression. Since round F the same grade also carries a sign
// (`twin_hindsight_sign`): the plan's arc minus the fix's arc along the path,
// positive when the plan ran AHEAD of the tram. The round's rule is "bias
// behind, never ahead": a mark behind the real tram reads as GPS lag, a mark
// ahead that has to come back reads as a broken app, so the ahead share is
// the number the round is judged on. Pure: the twin keeps a short ring of
// published plans per vehicle and hands it in with the fix.

import { dist, toPlane } from './geo';
import type { GraphNetwork } from './network';
import { evalFreePlan, evalPathPlan } from './plan';
import { at, project } from './polyline';
import type { Plan, PlaneFix } from './track';

/** The horizons a viewer feels: one tick, one poll cycle with cushion, and
 *  the far end of what a client integrates between two polls it missed. */
export const HORIZONS_S = [10, 30, 60] as const;
export type Horizon = (typeof HORIZONS_S)[number];

/** Error bands in metres along the path: a tram length, two, a stop
 *  spacing's third, a stop spacing's two thirds, and beyond. */
export const BUCKETS = ['lt25', 'lt50', 'lt100', 'lt200', 'ge200'] as const;
export type Bucket = (typeof BUCKETS)[number];

/** Signed bands: the plan a tram-and-a-half or more ahead of the fix, within
 *  that either way, or that far behind. 50 m is the second unsigned bucket's
 *  bound, so the two histograms read against the same line. */
export const SIGN_BUCKETS = ['ahead_ge50', 'within50', 'behind_ge50'] as const;
export type SignBucket = (typeof SIGN_BUCKETS)[number];
export const SIGN_BAND_M = 50;

/** Plans kept per vehicle: seven ticks of publishing covers a 60 s horizon
 *  even when the alarm ran a little late. */
export const HINDSIGHT_RING = 7;

/** A fix this far off the plan's path is graded by the straight line to the
 *  plan's point, not by an arc that no longer means anything (match.ts's
 *  off-graph band). */
export const OFF_PATH_FALLBACK_M = 150;

/** A free plan's heading is read over one tick ahead of the graded instant;
 *  under a metre of movement in that time is a plan standing still. */
export const FREE_HEADING_S = 10;
export const FREE_HEADING_MIN_M = 1;

export interface PublishedPlan {
  headerSec: number;
  plan: Plan;
}

export type HindsightCounts = Record<Horizon, Record<Bucket, number>>;
export type HindsightSignCounts = Record<Horizon, Record<SignBucket, number>>;

/** One graded fix at one horizon: the unsigned distance the buckets count,
 *  and the along-path difference plan minus fix (positive: plan ahead). */
export interface Grade {
  horizon: Horizon;
  errorM: number;
  signedM: number;
}

export function emptyCounts(): HindsightCounts {
  const counts = {} as HindsightCounts;
  for (const h of HORIZONS_S) {
    counts[h] = { lt25: 0, lt50: 0, lt100: 0, lt200: 0, ge200: 0 };
  }
  return counts;
}

export function emptySignCounts(): HindsightSignCounts {
  const counts = {} as HindsightSignCounts;
  for (const h of HORIZONS_S) {
    counts[h] = { ahead_ge50: 0, within50: 0, behind_ge50: 0 };
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

export function signBucketOf(signedM: number): SignBucket {
  if (signedM >= SIGN_BAND_M) return 'ahead_ge50';
  if (signedM <= -SIGN_BAND_M) return 'behind_ge50';
  return 'within50';
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

/** Where a plan put the vehicle at `tRel`, how far that is from the fix,
 *  and on which side. On geometry the sign is the along-path difference
 *  (plan arc minus the fix's arc, the fix projected onto the geometry when
 *  it was matched elsewhere or nowhere) even when the unsigned error falls
 *  back to the straight line, so "ahead" keeps meaning "further along the
 *  rails". In the free plane the sign is the component of plan-minus-fix
 *  along the plan's own heading; a plan that stands still has no heading
 *  and can only lag a vehicle that moved on, so it grades as behind. */
function errorOf(net: GraphNetwork, plan: Plan, tRel: number, fix: PlaneFix): { errorM: number; signedM: number } {
  if (plan.on === 'path') {
    const s = evalPathPlan(plan.knots, tRel);
    if (fix.arc?.key === `p${plan.pathIdx}`) return { errorM: Math.abs(s - fix.arc.s), signedM: s - fix.arc.s };
    const proj = net.projectOntoPath(plan.pathIdx, fix);
    const signedM = s - proj.s;
    if (proj.d <= OFF_PATH_FALLBACK_M) return { errorM: Math.abs(signedM), signedM };
    return { errorM: dist(net.toPathPoint(plan.pathIdx, s), fix), signedM };
  }
  if (plan.on === 'shape') {
    const s = evalPathPlan(plan.knots, tRel);
    if (fix.arc?.key === `b${plan.shapeIdx}`) return { errorM: Math.abs(s - fix.arc.s), signedM: s - fix.arc.s };
    const shape = net.shapes[plan.shapeIdx];
    const proj = project(shape.pts, shape.cum, fix);
    return { errorM: dist(at(shape.pts, shape.cum, s), fix), signedM: s - proj.s };
  }
  const [lon, lat] = evalFreePlan(plan.knots, tRel);
  const here = toPlane(lon, lat);
  const errorM = dist(here, fix);
  const [lon1, lat1] = evalFreePlan(plan.knots, tRel + FREE_HEADING_S);
  const ahead = toPlane(lon1, lat1);
  const hx = ahead.x - here.x;
  const hy = ahead.y - here.y;
  const len = Math.hypot(hx, hy);
  if (len < FREE_HEADING_MIN_M) return { errorM, signedM: -errorM };
  return { errorM, signedM: ((here.x - fix.x) * hx + (here.y - fix.y) * hy) / len };
}

/** For each horizon, the newest plan published at least that long before the
 *  fix, graded against the fix. Horizons with no old enough plan are skipped. */
export function gradeFix(net: GraphNetwork, fix: PlaneFix, ring: readonly PublishedPlan[]): Grade[] {
  const out: Grade[] = [];
  for (const horizon of HORIZONS_S) {
    let chosen: PublishedPlan | null = null;
    for (const entry of ring) if (entry.headerSec <= fix.atSec - horizon && (!chosen || entry.headerSec > chosen.headerSec)) chosen = entry;
    if (!chosen) continue;
    out.push({ horizon, ...errorOf(net, chosen.plan, fix.atSec - chosen.headerSec, fix) });
  }
  return out;
}

/** Adds one graded fix to the unsigned histogram. */
export function countGrades(counts: HindsightCounts, grades: readonly Grade[]): void {
  for (const grade of grades) counts[grade.horizon][bucketOf(grade.errorM)]++;
}

/** Adds the same graded fix to the signed histogram. */
export function countSignGrades(counts: HindsightSignCounts, grades: readonly Grade[]): void {
  for (const grade of grades) counts[grade.horizon][signBucketOf(grade.signedM)]++;
}
