// Where the twin gets the static trip index from (the asset
// scripts/gtfs-trips.mjs builds, served by the ASSETS binding like any file
// under app/public/data), decoded by the one decoder that knows the wire
// (shared/motion/trips.ts, task A1), and turned into the rows persist.ts
// copies into SQLite. A missing or unreadable asset is null, never a throw:
// the twin keeps its stored copy and the join degrades, it does not die.

import { decodeTripIndex, type TripIndex } from '../../shared/motion/trips';
import type { Env } from '../env';
import { logError } from '../log';
import type { IndexPattern, IndexRows, IndexTrip } from './persist';

export const TRIPS_INDEX_PATH = '/data/zet-trips.json';

/** The asset is fetched through the binding, so any host works; the
 *  production hostname keeps the request readable in a log. */
const ASSET_ORIGIN = 'https://zagreb.aningfilm.hr';

/** The decoded index, or null when the asset is missing, unreadable or of a
 *  version this build does not understand (logged, so a broken build is loud
 *  in the operator's log even though the twin carries on). */
export async function fetchTripIndex(env: Env): Promise<TripIndex | null> {
  try {
    const response = await env.ASSETS.fetch(new Request(`${ASSET_ORIGIN}${TRIPS_INDEX_PATH}`));
    if (!response.ok) return null;
    return decodeTripIndex(await response.json());
  } catch (error) {
    logError('twin_index_unreadable', error);
    return null;
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
  for (const [id, record] of index.tripsById) {
    trips.push({ id, pattern: record.pattern, block: record.block, start: record.start });
  }
  const blocks = [...index.blocks].map(([id, tripIds]) => ({ id, trips: tripIds }));
  return { feedVersion: index.feedVersion, patterns, trips, blocks };
}
