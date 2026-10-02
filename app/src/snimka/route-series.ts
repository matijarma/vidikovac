// One route's five-minute series and its hourly means (plan sections 3.5 and
// 3.6). Pure functions; lane V2 owns this file.
import { ROUTES_STEP_S } from '../../../shared/snimka';
import { ROUTES_MISSING, decodeBase64 } from '../../../shared/snimka-codec';
import type { RoutesLike } from './contracts';

const SLOTS_PER_HOUR = 3600 / ROUTES_STEP_S;

function rowOf(routes: RoutesLike, routeId: string): { seen: Uint8Array; expected: Uint8Array } | null {
  const i = routes.routes.findIndex((r) => r.id === routeId);
  if (i < 0) return null;
  return { seen: decodeBase64(routes.seen[i]!), expected: decodeBase64(routes.expected[i]!) };
}

/** The route's seen and expected count in the sample holding `atSec`; null where the file has no sample or says 255. */
export function routeSample(routes: RoutesLike, routeId: string, atSec: number): { seen: number | null; expected: number | null } {
  const row = rowOf(routes, routeId);
  const j = Math.floor((atSec - routes.t0) / ROUTES_STEP_S);
  if (!row || j < 0 || j >= routes.n) return { seen: null, expected: null };
  const v = (b: number): number | null => (b === ROUTES_MISSING ? null : b);
  return { seen: v(row.seen[j]!), expected: v(row.expected[j]!) };
}

/** Per hour of the file: the mean of min(1, seen/expected) over its samples; null where nothing is scheduled or every sample is missing. */
export function hourMeans(routes: RoutesLike, routeId: string): (number | null)[] {
  const row = rowOf(routes, routeId);
  const hours = Math.ceil(routes.n / SLOTS_PER_HOUR);
  const out: (number | null)[] = new Array<number | null>(hours).fill(null);
  if (!row) return out;
  for (let h = 0; h < hours; h++) {
    let sum = 0;
    let count = 0;
    for (let j = h * SLOTS_PER_HOUR; j < Math.min(routes.n, (h + 1) * SLOTS_PER_HOUR); j++) {
      const s = row.seen[j]!;
      const e = row.expected[j]!;
      if (s === ROUTES_MISSING || e === ROUTES_MISSING || e === 0) continue;
      sum += Math.min(1, s / e);
      count += 1;
    }
    out[h] = count ? sum / count : null;
  }
  return out;
}
