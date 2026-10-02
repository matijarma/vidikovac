// The living network (decision S-16): a route is alive when it had a vehicle
// in any of the last `lookback` five-minute samples, dead when scheduled in
// all of them and none ran, quiet otherwise (255 counts as missing). Pure
// functions over the routes file, on the entry graph: the map lane applies
// them through feature state (city-map.ts setLiveNetwork), the minimaps
// through SVG classes, the readouts and the heatmap read the counts. The
// rows are decoded once per file object and kept in a WeakMap; the stop to
// routes table of a network the same, so a frame's cost is the lookback
// alone (test/app/snimka-live.test.ts pins it under 2 ms for 150 routes and
// 2,525 stops). Only type imports from the network module, so this file never
// carries it onto the entry graph.
import type { Network } from '../../../shared/motion/network';
import { ROUTES_STEP_S } from '../../../shared/snimka';
import { ROUTES_MISSING, decodeBase64 } from '../../../shared/snimka-codec';
import type { RoutesLike } from './contracts';

export type AliveState = 'alive' | 'dead' | 'quiet';
/** Route id to its state at one instant. */
export type RouteStates = Map<string, AliveState>;
/** Stop id to the routes whose shapes call there (stopRoutesOf). */
export type StopRoutes = Map<string, readonly string[]>;

/** Three samples: the twin's SILENT_AFTER_S (600 s) plus one sample (S-16). */
export const LOOKBACK_SAMPLES = 3;

interface Rows { seen: Uint8Array[]; expected: Uint8Array[] }
const rows = new WeakMap<RoutesLike, Rows>();

/** The decoded columns of a routes file, once per file object. */
export function rowsOf(routes: RoutesLike): Rows {
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

/** The lane's name for routeSlotAt: the five-minute sample holding `atSec`, -1 outside the file. */
export const sampleIndex = routeSlotAt;

/** Every route's state at `atSec` over the last `lookback` samples (15 minutes at three). Outside the file: empty. */
export function aliveStates(routes: RoutesLike, atSec: number, lookback = LOOKBACK_SAMPLES): RouteStates {
  const out: RouteStates = new Map();
  const slot = routeSlotAt(routes, atSec);
  if (slot < 0) return out;
  const { seen, expected } = rowsOf(routes);
  for (let i = 0; i < routes.routes.length; i++) {
    const route = routes.routes[i]!;
    const seenRow = seen[i];
    const expectedRow = expected[i];
    if (!seenRow || !expectedRow) { out.set(route.id, 'quiet'); continue; }
    let sawOne = false;
    let scheduledAll = true;
    for (let k = 0; k < lookback; k++) {
      const j = slot - k;
      if (j < 0) { scheduledAll = false; break; }
      const s = seenRow[j] ?? ROUTES_MISSING;
      const e = expectedRow[j] ?? ROUTES_MISSING;
      if (s !== ROUTES_MISSING && s > 0) sawOne = true;
      if (e === ROUTES_MISSING || e === 0) scheduledAll = false;
    }
    out.set(route.id, sawOne ? 'alive' : scheduledAll ? 'dead' : 'quiet');
  }
  return out;
}

/** How many routes the timetable runs in the sample holding `atSec` (expected > 0, 255 excluded); 0 outside the file. */
export function scheduledCount(routes: RoutesLike, atSec: number): number {
  const slot = routeSlotAt(routes, atSec);
  if (slot < 0) return 0;
  const { expected } = rowsOf(routes);
  let n = 0;
  for (const row of expected) {
    const e = row[slot] ?? ROUTES_MISSING;
    if (e !== ROUTES_MISSING && e > 0) n += 1;
  }
  return n;
}

const stopRoutesCache = new WeakMap<Pick<Network, 'stops' | 'shapes'>, StopRoutes>();

/** Every stop of a network with the routes whose shapes call there, built once per network object. */
export function stopRoutesOf(net: Pick<Network, 'stops' | 'shapes'>): StopRoutes {
  let table = stopRoutesCache.get(net);
  if (table) return table;
  table = new Map();
  for (const stop of net.stops) {
    const ids = new Set<string>();
    for (const on of stop.on) {
      const route = net.shapes[on.shape]?.route;
      if (route) ids.add(route);
    }
    table.set(stop.id, [...ids]);
  }
  stopRoutesCache.set(net, table);
  return table;
}

/** The stops any alive route serves. */
export function stopAliveSet(stopsRoutes: StopRoutes | null, states: RouteStates): Set<string> {
  const out = new Set<string>();
  if (!stopsRoutes) return out;
  for (const [stopId, routeIds] of stopsRoutes) {
    for (const r of routeIds) {
      if (states.get(r) === 'alive') { out.add(stopId); break; }
    }
  }
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

/** The alive and dead route ids of a state map, for city-map.ts setLiveNetwork. */
export function aliveSets(states: RouteStates): { alive: Set<string>; dead: Set<string> } {
  const alive = new Set<string>();
  const dead = new Set<string>();
  for (const [id, state] of states) {
    if (state === 'alive') alive.add(id);
    else if (state === 'dead') dead.add(id);
  }
  return { alive, dead };
}
