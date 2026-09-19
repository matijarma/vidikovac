// Real committed geometry, synthetic evidence only at the browser boundary.
// Shared by the browser gate and the local visual-review script.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { decodeNetwork } from '../shared/motion/network';
import { decodeSchema, matchSchemaPath } from '../shared/motion/schema';
import { toLonLat } from '../shared/motion/geo';
import type { ModuleSnapshot } from '../worker/feed/schema';

const root = resolve(import.meta.dirname, '..');
const net = decodeNetwork(JSON.parse(readFileSync(resolve(root, 'app/public/data/zet-network.json'), 'utf8')));
const schema = decodeSchema(JSON.parse(readFileSync(resolve(root, 'app/public/data/zet-schema.json'), 'utf8')));
const index = net.paths.findIndex((p, i) => p.route === '6' && matchSchemaPath(schema, net, i).placeable);
if (index < 0) throw new Error('Schema E2E: no real line 6 path');
const path = net.paths[index];
const matched = matchSchemaPath(schema, net, index).stops;
const reference = matched.find(s => s.name === 'Frankopanska') ?? matched[Math.floor(matched.length / 2)];
const start = Math.max(0, reference.s - 100);
const [lon, lat] = toLonLat(net.toPathPoint(index, start));

export function schemaSnapshot(time: number): ModuleSnapshot {
  const stamp = new Date(time).toISOString();
  return {
    module: 'zet-rt', tier: 'open', status: 'live', fetchedAt: stamp, sourceUpdatedAt: stamp,
    attribution: { text: 'ZET, test evidence over committed geometry', url: 'https://www.zet.hr', licence: 'Otvorena dozvola' },
    items: [{
      id: 'vehicle:schema-e2e', module: 'zet-rt', kind: 'vehicle', tier: 'open', title: 'Tramvaj 6', at: stamp,
      geo: { type: 'Point', coordinates: [lon, lat] },
      data: { routeId: '6', routeType: 0, confidence: .9, speed: 10, headsign: matched.at(-1)?.name ?? '6' },
      motion: { path: path.id, plan: [[0, start], [90, Math.min(path.len, start + 900)]] },
    }],
  };
}

/** Round F's own case, in metres along the same real line 6 path: close
 *  enough that the two pills overlap at the zooms a reader actually uses, so
 *  the map has to keep both numbers -- as one cluster, or as two pills side by
 *  side once the camera is close enough -- rather than drop one. 20 m is
 *  a tram length -- two trams nose to tail at a stop. */
export const TWO_TRAM_GAP_M = 20;
/** The lines the two trams report. The city map draws a vehicle where its
 *  plan puts it whatever line it claims, so two different numbers on one path
 *  is the clustering case; the diagram places a tram only on the line its own
 *  route matches (shared/motion/schema.ts createSchemaPlacer), so the schema
 *  scene passes the path's own route twice. */
export const TWO_TRAM_ROUTES: readonly [string, string] = ['6', '11'];
/** The path's own route, for callers that need both trams on the diagram. */
export const TWO_TRAM_PATH_ROUTE = path.route;
/** The pair stands at the screen's own stop -- the fixture session's stop and
 *  so the city map's opening centre -- because a scene that has to zoom to 17
 *  cannot afford to start half a kilometre off frame. */
const TWO_TRAM_STOP = 'Trg bana J. Jelačića';
/** The metres the pair covers in the plan's 90 s. A walking pace: nothing
 *  here is about how fast a tram goes (motion.spec.ts proves the glide), and
 *  at zoom 17 a real 10 m/s would carry them out of frame before a scene
 *  could be captured. */
const TWO_TRAM_RUN_M = 90;
const twoTramReference = matched.find(s => s.name === TWO_TRAM_STOP) ?? reference;
/** A few metres short of the stop, so both marks sit on it rather than past it. */
const twoTramStart = Math.max(0, twoTramReference.s - 30);

/** Where the pair's own path ends, as the feed would write it. */
const twoTramHeadsign = matched.at(-1)?.name ?? '6';

/** One tram item on a real path, `runM` metres along it in the plan's 90 s
 *  (0 is a tram that stands). The snapshot envelope around it is the same
 *  for every scene here. */
function tramItem(id: string, routeId: string, pathIndex: number, s: number, runM: number, headsign: string, stamp: string): ModuleSnapshot['items'][number] {
  const p = net.paths[pathIndex];
  const [itemLon, itemLat] = toLonLat(net.toPathPoint(pathIndex, s));
  return {
    id, module: 'zet-rt', kind: 'vehicle', tier: 'open',
    title: `Tramvaj ${routeId}`, at: stamp,
    geo: { type: 'Point', coordinates: [itemLon, itemLat] },
    data: { routeId, routeType: 0, confidence: .9, speed: runM / 90, headsign },
    motion: { path: p.id, plan: [[0, s], [90, Math.min(p.len, s + runM)]] },
  };
}

function snapshotOf(stamp: string, items: ModuleSnapshot['items']): ModuleSnapshot {
  return {
    module: 'zet-rt', tier: 'open', status: 'live', fetchedAt: stamp, sourceUpdatedAt: stamp,
    attribution: { text: 'ZET, test evidence over committed geometry', url: 'https://www.zet.hr', licence: 'Otvorena dozvola' },
    items,
  };
}

/**
 * Two trams on one real path, TWO_TRAM_GAP_M apart, creeping forwards
 * together so the gap between them never changes. Same rule as
 * `schemaSnapshot`: committed geometry, synthetic evidence only at the
 * browser boundary.
 */
export function twoTramSnapshot(time: number, routes: readonly [string, string] = TWO_TRAM_ROUTES): ModuleSnapshot {
  const stamp = new Date(time).toISOString();
  return snapshotOf(stamp, routes.map((routeId, nth) =>
    tramItem(`vehicle:round-f-${nth + 1}`, routeId, index, twoTramStart + nth * TWO_TRAM_GAP_M, TWO_TRAM_RUN_M, twoTramHeadsign, stamp)));
}

/** The same line's path the other way through the pair's stop, and where on
 *  it the first tram's own spot falls. The two directions' rails run a few
 *  metres across the street from each other (shared/motion/network.ts: the
 *  other platform is 3 m away), so a tram put here shares the first one's
 *  pill box at every zoom the round reads. */
const opposedIndex = net.paths.findIndex((p, i) => p.route === path.route && p.direction !== path.direction && matchSchemaPath(schema, net, i).placeable);
if (opposedIndex < 0) throw new Error('Schema E2E: no real line 6 path the other way');
const opposedProjection = net.projectOntoPath(opposedIndex, net.toPathPoint(index, twoTramStart));
const opposedHeadsign = matchSchemaPath(schema, net, opposedIndex).stops.at(-1)?.name ?? path.route;
/** How far the other direction's rail may lie from the first tram for the
 *  pair to still be "at the same place": a street's width of tram tracks,
 *  well inside the 24 px pill box at zoom 17 (0.42 m/px) and a loud failure
 *  if a rebuilt network ever routes the return through another street. */
const OPPOSED_MAX_ACROSS_M = 10;
if (opposedProjection.d > OPPOSED_MAX_ACROSS_M) {
  throw new Error(`Schema E2E: the line 6 return path is ${opposedProjection.d.toFixed(1)} m from the pair's spot`);
}

/**
 * Two trams of ONE number at one spot, each on its own direction of the same
 * real line: the owner's passing-at-a-stop case, which the city map and the
 * diagram both merge into a single "6" whose members face opposite ways. Both
 * stand still -- moving, they would part at two walking paces and the merge
 * would last five seconds at zoom 17, and the fixture's own refresh (the
 * snapshot is rebuilt at fulfil time) would then pull each mark back against
 * the integrator's no-reverse rule. A standing tram keeps its heading: the
 * integrator reads it off the rails, not off the speed.
 */
export function opposedTramSnapshot(time: number): ModuleSnapshot {
  const stamp = new Date(time).toISOString();
  return snapshotOf(stamp, [
    tramItem('vehicle:opposed-1', path.route, index, twoTramStart, 0, twoTramHeadsign, stamp),
    tramItem('vehicle:opposed-2', path.route, opposedIndex, opposedProjection.s, 0, opposedHeadsign, stamp),
  ]);
}
