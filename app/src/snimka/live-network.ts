// The living network (decision S-16): a route is alive when it had a vehicle
// in any of the last `lookback` five-minute samples, dead when scheduled in
// all of them and none ran, quiet otherwise. Pure functions over the routes
// file; lane V2 owns this file and its cost (the stub decodes rows once per
// file object and keeps them in a WeakMap).
import { ROUTES_STEP_S } from '../../../shared/snimka';
import { ROUTES_MISSING, decodeBase64 } from '../../../shared/snimka-codec';
import type { RoutesLike } from './contracts';

export type AliveState = 'alive' | 'dead' | 'quiet';
/** Route id to its state at one instant. */
export type RouteStates = Map<string, AliveState>;

interface Rows { seen: Uint8Array[]; expected: Uint8Array[] }
const rows = new WeakMap<RoutesLike, Rows>();

function rowsOf(routes: RoutesLike): Rows {
  let r = rows.get(routes);
  if (!r) {
    r = { seen: routes.seen.map(decodeBase64), expected: routes.expected.map(decodeBase64) };
    rows.set(routes, r);
  }
  return r;
}

/** The sample index of an instant, or -1 outside the file. */
export function routeSlotAt(routes: Pick<RoutesLike, 't0' | 'n'>, atSec: number): number {
  const i = Math.floor((atSec - routes.t0) / ROUTES_STEP_S);
  return i >= 0 && i < routes.n ? i : -1;
}

/** Every route's state at `atSec` over the last `lookback` samples (15 minutes at three). */
export function aliveStates(routes: RoutesLike, atSec: number, lookback = 3): RouteStates {
  const out: RouteStates = new Map();
  const slot = routeSlotAt(routes, atSec);
  if (slot < 0) return out;
  const { seen, expected } = rowsOf(routes);
  routes.routes.forEach((route, i) => {
    let sawOne = false;
    let scheduledAll = true;
    for (let k = 0; k < lookback; k++) {
      const j = slot - k;
      if (j < 0) { scheduledAll = false; break; }
      const s = seen[i]![j]!;
      const e = expected[i]![j]!;
      if (s !== ROUTES_MISSING && s > 0) sawOne = true;
      if (e === ROUTES_MISSING || e === 0) scheduledAll = false;
    }
    out.set(route.id, sawOne ? 'alive' : scheduledAll ? 'dead' : 'quiet');
  });
  return out;
}

/** The stops any alive route serves, from the stop features' route lists. */
export function stopAliveSet(net: { stops: readonly { id: string; routes?: readonly string[] }[] } | null, states: RouteStates): Set<string> {
  const out = new Set<string>();
  if (!net) return out;
  for (const stop of net.stops) if (stop.routes?.some((r) => states.get(r) === 'alive')) out.add(stop.id);
  return out;
}

/** The routes whose state changed between two instants (every route when `prev` is null). */
export function diffStates(prev: RouteStates | null, next: RouteStates): { id: string; state: AliveState }[] {
  const out: { id: string; state: AliveState }[] = [];
  for (const [id, state] of next) if (!prev || prev.get(id) !== state) out.push({ id, state });
  return out;
}

/** How many routes are alive, dead and quiet. */
export function liveCounts(states: RouteStates): { alive: number; dead: number; quiet: number } {
  const out = { alive: 0, dead: 0, quiet: 0 };
  for (const state of states.values()) out[state] += 1;
  return out;
}
