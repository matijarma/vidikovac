// Where the twin gets its two static assets from: the trip index
// (scripts/gtfs-trips.mjs) and the network artefact (scripts/gtfs-shapes.mjs),
// both served by the ASSETS binding like any file under app/public/data and
// decoded by the one decoder each that knows its wire (shared/motion/trips.ts,
// shared/motion/network.ts). A missing or unreadable asset is null, never a
// throw: the twin keeps what it has and degrades (no join, or free-plane
// plans), it does not die. The index also becomes rows for persist.ts.

import { parseDwellOverrides, type DwellOverride } from '../../shared/motion/dwell';
import { decodeNetwork, type GraphNetwork } from '../../shared/motion/network';
import { decodeTripIndex, type TripIndex } from '../../shared/motion/trips';
import type { Env } from '../env';
import { logError } from '../log';
import type { IndexPattern, IndexRows, IndexTrip } from './persist';

export const TRIPS_INDEX_PATH = '/data/zet-trips.json';
export const NETWORK_PATH = '/data/zet-network.json';
/** The owner's hand-edited dwell table (F11). It sits beside the two built
 *  artefacts and reaches the twin through the same ASSETS binding, because
 *  nothing transforms it: what the owner commits is what the twin reads, with
 *  no build step in between to forget. */
export const DWELL_OVERRIDES_PATH = '/data/stop-dwell-overrides.json';

/** The asset is fetched through the binding, so any host works; the
 *  production hostname keeps the request readable in a log. */
const ASSET_ORIGIN = 'https://zagreb.aningfilm.hr';

async function fetchAsset(env: Env, path: string): Promise<unknown | null> {
  const response = await env.ASSETS.fetch(new Request(`${ASSET_ORIGIN}${path}`));
  if (!response.ok) return null;
  return await response.json();
}

/** The decoded index, or null when the asset is missing, unreadable or of a
 *  version this build does not understand (logged: a broken build is loud). */
export async function fetchTripIndex(env: Env): Promise<TripIndex | null> {
  try {
    const raw = await fetchAsset(env, TRIPS_INDEX_PATH);
    return raw === null ? null : decodeTripIndex(raw);
  } catch (error) {
    logError('twin_index_unreadable', error);
    return null;
  }
}

/** The decoded network with its graph, or null on the same terms. */
export async function fetchNetwork(env: Env): Promise<GraphNetwork | null> {
  try {
    const raw = await fetchAsset(env, NETWORK_PATH);
    return raw === null ? null : decodeNetwork(raw);
  } catch (error) {
    logError('twin_network_unreadable', error);
    return null;
  }
}

/**
 * The owner's dwell overrides (F11). A MALFORMED entry throws out of
 * parseDwellOverrides and is logged with the entry printed, and the twin runs
 * with NO overrides rather than with half of them: a table that silently
 * dropped the line an operator just wrote would be worse than one that says
 * so. A missing file is simply an empty table -- the layer is optional.
 */
export async function fetchDwellOverrides(env: Env): Promise<DwellOverride[]> {
  try {
    const raw = await fetchAsset(env, DWELL_OVERRIDES_PATH);
    return raw === null ? [] : parseDwellOverrides(raw);
  } catch (error) {
    logError('twin_dwell_overrides_unreadable', error);
    return [];
  }
}

/** The decoded index as rows for the twin's tables. */
export function indexRowsFromIndex(index: TripIndex): IndexRows {
  const patterns: IndexPattern[] = index.patterns.map((p) => ({
    route: p.route,
    direction: p.direction === 1 ? 1 : 0,
    shape: p.shape === '' ? null : p.shape,
    headsign: p.headsign,
    stops: p.stops,
    sched: p.sched,
    dwell: p.dwell,
  }));
  const trips: IndexTrip[] = [];
  for (const [id, record] of index.tripsById) trips.push({ id, pattern: record.pattern, block: record.block, start: record.start });
  const blocks = [...index.blocks].map(([id, tripIds]) => ({ id, trips: tripIds }));
  return { feedVersion: index.feedVersion, patterns, trips, blocks };
}
