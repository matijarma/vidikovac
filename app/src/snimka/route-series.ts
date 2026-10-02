// One route's five-minute series and its hourly means (plan sections 3.5 and
// 3.6): the subject's own curve, the heatmap's cells. Pure functions over a
// routes file; the base64 columns are decoded once per file object (the same
// WeakMap live-network.ts fills) and the route index once per file, so a
// heatmap of 135 routes by 112 hours never decodes a column twice.
import { ROUTES_STEP_S } from '../../../shared/snimka';
import { ROUTES_MISSING } from '../../../shared/snimka-codec';
import type { RoutesLike } from './contracts';
import { rowsOf } from './live-network';

const SLOTS_PER_HOUR = 3600 / ROUTES_STEP_S;

const indexCache = new WeakMap<RoutesLike, Map<string, number>>();

/** The row index of a route id, once per file object; -1 for a route the file lacks. */
export function routeIndex(routes: RoutesLike, routeId: string): number {
  let index = indexCache.get(routes);
  if (!index) {
    index = new Map(routes.routes.map((r, i) => [r.id, i]));
    indexCache.set(routes, index);
  }
  return index.get(routeId) ?? -1;
}

/** The decoded seen and expected columns of a routes file (live-network.ts rowsOf), once per file object. */
export function decodeRoutes(routes: RoutesLike): { seen: readonly Uint8Array[]; expected: readonly Uint8Array[] } {
  return rowsOf(routes);
}

function rowOf(routes: RoutesLike, routeId: string): { seen: Uint8Array; expected: Uint8Array } | null {
  const i = routeIndex(routes, routeId);
  if (i < 0) return null;
  const { seen, expected } = rowsOf(routes);
  const s = seen[i];
  const e = expected[i];
  return s && e ? { seen: s, expected: e } : null;
}

const value = (b: number | undefined): number | null => (b === undefined || b === ROUTES_MISSING ? null : b);

/** The route's seen and expected count in the sample holding `atSec`; null where the file has no sample or says 255. */
export function routeSample(routes: RoutesLike, routeId: string, atSec: number): { seen: number | null; expected: number | null } {
  const row = rowOf(routes, routeId);
  const j = Math.floor((atSec - routes.t0) / ROUTES_STEP_S);
  if (!row || j < 0 || j >= routes.n) return { seen: null, expected: null };
  return { seen: value(row.seen[j]), expected: value(row.expected[j]) };
}

/** The route's whole series as arrays of n values, null for 255; empty arrays for a route the file lacks. */
export function routeCurve(routes: RoutesLike, routeId: string): { seen: (number | null)[]; expected: (number | null)[] } {
  const row = rowOf(routes, routeId);
  if (!row) return { seen: [], expected: [] };
  const seen: (number | null)[] = new Array<number | null>(routes.n);
  const expected: (number | null)[] = new Array<number | null>(routes.n);
  for (let j = 0; j < routes.n; j++) {
    seen[j] = value(row.seen[j]);
    expected[j] = value(row.expected[j]);
  }
  return { seen, expected };
}

/** How many whole or partial hours the file covers from its t0. */
export function hourCount(routes: Pick<RoutesLike, 'n'>): number {
  return Math.ceil(routes.n / SLOTS_PER_HOUR);
}

function hourMeansOfRow(row: { seen: Uint8Array; expected: Uint8Array }, n: number): (number | null)[] {
  const hours = Math.ceil(n / SLOTS_PER_HOUR);
  const out: (number | null)[] = new Array<number | null>(hours).fill(null);
  for (let h = 0; h < hours; h++) {
    let sum = 0;
    let count = 0;
    for (let j = h * SLOTS_PER_HOUR; j < Math.min(n, (h + 1) * SLOTS_PER_HOUR); j++) {
      const s = row.seen[j] ?? ROUTES_MISSING;
      const e = row.expected[j] ?? ROUTES_MISSING;
      if (s === ROUTES_MISSING || e === ROUTES_MISSING || e === 0) continue;
      sum += Math.min(1, s / e);
      count += 1;
    }
    out[h] = count ? sum / count : null;
  }
  return out;
}

/** Per hour of the file: the mean of min(1, seen/expected) over its samples; null where nothing is scheduled or every sample is missing. */
export function hourMeans(routes: RoutesLike, routeId: string): (number | null)[] {
  const row = rowOf(routes, routeId);
  if (!row) return new Array<number | null>(hourCount(routes)).fill(null);
  return hourMeansOfRow(row, routes.n);
}

/** hourMeans for every route of the file, in file order (the heatmap's rows). */
export function hourMeansTable(routes: RoutesLike): (number | null)[][] {
  const { seen, expected } = rowsOf(routes);
  return routes.routes.map((_, i) => {
    const s = seen[i];
    const e = expected[i];
    return s && e ? hourMeansOfRow({ seen: s, expected: e }, routes.n) : new Array<number | null>(hourCount(routes)).fill(null);
  });
}
