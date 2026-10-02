// Stage `routes` (lane V1): the living network's input, one RoutesFile per
// segment (plan section 5, Appendix A). Per route and 5-minute slot: `seen`,
// the distinct published vehicles of the route with a position at any tick of
// the slot (the frames stage's work/routes-seen-<segment>.json, the same pins
// the motion chunks encode; 255 where no tick of the slot was sampled), and
// `expected`, the trips the declared timetable has in service on the route at
// the slot's start (expectedAt over the segment's calendars; 255 where no
// calendar knows the date). The route list is every id of
// app/src/data/zet-routes.json that is expected or seen in the segment, trams
// first by short name, then buses.

import { readFileSync } from 'node:fs';
import { expectedAt, type ExpectIndex } from '../../shared/motion/expect';
import { ROUTES_STEP_S, type HashedRef, type RoutesFile } from '../../shared/snimka';
import { encodeRoutes, ROUTES_MISSING } from '../../shared/snimka-codec';
import type { RoutesSeenWork } from './stage-frames';
import { readWork, writeJsonObject, writeWork, type Paths } from './paths';
import { COMPARISON_OF, DAY_KEYS, loadSegmentExpect, ROUTES_FILE, SEGMENT_KEYS, type SegmentKey } from './segments';

export interface RouteMeta { shortName: string; type: number }
export interface RoutesRefs { window: HashedRef; comparisons: Record<string, HashedRef>; counts: Record<string, number> }

/** A count as a byte: 0..254, never the missing sentinel. */
const byte = (n: number): number => Math.min(Math.max(Math.round(n), 0), ROUTES_MISSING - 1);

/** Trams first, then buses; within a type by short name, numbers in numeric order. */
export function routeOrder(a: { shortName: string; type: number }, b: { shortName: string; type: number }): number {
  if (a.type !== b.type) return a.type === 0 ? -1 : b.type === 0 ? 1 : a.type - b.type;
  return a.shortName.localeCompare(b.shortName, 'hr', { numeric: true });
}

/**
 * The RoutesFile of one segment from its routes-seen work and its expectation.
 * `expect` is null only in a test that has no calendar (every expected slot 255).
 */
export function buildRoutesFile(seen: RoutesSeenWork, catalogue: Record<string, RouteMeta>, expect: ExpectIndex | null, net: RoutesFile['net']): { file: RoutesFile; unknownSeen: string[] } {
  const ids = Object.keys(catalogue).filter((id) => catalogue[id].type === 0 || catalogue[id].type === 3);
  const expectedRows = new Map<string, Uint8Array>(ids.map((id) => [id, new Uint8Array(seen.n).fill(ROUTES_MISSING)] as const));
  for (let j = 0; j < seen.n; j++) {
    if (!expect) continue;
    const e = expectedAt(expect, seen.t0 + j * ROUTES_STEP_S, ids);
    if (!e.known) continue;
    for (const id of ids) expectedRows.get(id)![j] = byte(e.routes[id] ?? 0);
  }
  const unknownSeen = Object.keys(seen.routes).filter((id) => !(id in catalogue)).sort();
  const kept = ids.filter((id) => {
    const counts = seen.routes[id];
    if (counts && counts.some((c) => c > 0)) return true;
    const row = expectedRows.get(id)!;
    return row.some((x) => x !== ROUTES_MISSING && x > 0);
  });
  const routes = kept.map((id) => ({ id, shortName: catalogue[id].shortName, type: catalogue[id].type as 0 | 3 })).sort(routeOrder);
  const seenRows = routes.map((r) => {
    const row = new Uint8Array(seen.n);
    const counts = seen.routes[r.id];
    for (let j = 0; j < seen.n; j++) row[j] = !seen.covered[j] ? ROUTES_MISSING : byte(counts?.[j] ?? 0);
    return row;
  });
  const file = encodeRoutes(seen.t0, ROUTES_STEP_S, routes, seenRows, routes.map((r) => expectedRows.get(r.id)!), net);
  return { file, unknownSeen };
}

export async function stageRoutes(paths: Paths, log: (line: string) => void): Promise<boolean> {
  const catalogue = JSON.parse(readFileSync(ROUTES_FILE(paths), 'utf8')) as Record<string, RouteMeta>;
  const refs: RoutesRefs = { window: null as unknown as HashedRef, comparisons: {}, counts: {} };
  for (const key of SEGMENT_KEYS) {
    const seen = readWork<RoutesSeenWork>(paths, `routes-seen-${key}.json`);
    const expect = await loadSegmentExpect(paths, key);
    const { file, unknownSeen } = buildRoutesFile(seen, catalogue, expect, key === 'window' ? '396+395' : '395');
    const ref = writeJsonObject(paths, `routes/${key}`, file);
    writeWork(paths, `routes-${key}.json`, file);
    if (key === 'window') refs.window = ref;
    else refs.comparisons[COMPARISON_OF[key as Exclude<SegmentKey, 'window'>].id] = ref;
    refs.counts[key] = file.routes.length;
    log(`routes ${key}: ${file.routes.length} routes (${file.routes.filter((r) => r.type === 0).length} tram), ${file.n} slots, ${seen.covered.filter((c) => !c).length} without a tick${unknownSeen.length ? `; seen but not in zet-routes.json: ${unknownSeen.join(', ')}` : ''}`);
  }
  if (DAY_KEYS.some((k) => !refs.comparisons[COMPARISON_OF[k].id])) throw new Error('routes: a comparison day is missing');
  writeWork(paths, 'routes-refs.json', refs);
  return true;
}
