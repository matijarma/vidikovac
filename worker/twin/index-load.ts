// Where the twin gets the static trip index from (the asset
// scripts/gtfs-trips.mjs builds, served by the ASSETS binding like any file
// under app/public/data), and how the columnar wire becomes rows for
// persist.ts. The wire shape is the one task A1's brief fixes; a mismatch
// throws a named error so a broken build is loud, never a silent "no join".

import type { Env } from '../env';
import type { IndexPattern, IndexRows, IndexTrip } from './persist';

export const TRIPS_INDEX_PATH = '/data/zet-trips.json';

/** The asset is fetched through the binding, so any host works; the
 *  production hostname keeps the request readable in a log. */
const ASSET_ORIGIN = 'https://zagreb.aningfilm.hr';

export const TRIPS_INDEX_VERSION = 1;

export class TripIndexError extends Error {
  constructor(message: string) {
    super(`zet-trips.json: ${message}`);
    this.name = 'TripIndexError';
  }
}

interface TripIndexWire {
  version: number;
  feedVersion: string;
  headsigns: string[];
  patterns: {
    route: string[];
    direction: number[];
    shape: string[];
    headsign: number[];
    stops: string[][];
    sched: number[][][];
    dwell: number[][];
  };
  trips: { id: string[]; pattern: number[]; block: number[]; start: number[] };
  blocks: { id: string[]; trips: number[][] };
}

/** null when the asset is missing or unreadable; the caller keeps its stored copy. */
export async function fetchTripIndexRaw(env: Env): Promise<unknown | null> {
  try {
    const response = await env.ASSETS.fetch(new Request(`${ASSET_ORIGIN}${TRIPS_INDEX_PATH}`));
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

function expectArray(value: unknown, name: string): unknown[] {
  if (!Array.isArray(value)) throw new TripIndexError(`${name} is not an array`);
  return value;
}

export function indexRowsFromWire(raw: unknown): IndexRows {
  if (typeof raw !== 'object' || raw === null) throw new TripIndexError('not an object');
  const wire = raw as Partial<TripIndexWire>;
  if (wire.version !== TRIPS_INDEX_VERSION) throw new TripIndexError(`unsupported version ${JSON.stringify(wire.version)}`);
  if (typeof wire.feedVersion !== 'string' || wire.feedVersion === '') throw new TripIndexError('feedVersion missing');
  const headsigns = expectArray(wire.headsigns, 'headsigns') as string[];
  const p = wire.patterns;
  if (!p) throw new TripIndexError('patterns missing');
  const routes = expectArray(p.route, 'patterns.route') as string[];
  const patterns: IndexPattern[] = routes.map((route, i) => {
    const headsign = headsigns[p.headsign?.[i] ?? -1];
    if (typeof headsign !== 'string') throw new TripIndexError(`pattern ${i} has no headsign`);
    const shape = p.shape?.[i];
    return {
      route,
      direction: p.direction?.[i] === 1 ? 1 : 0,
      shape: typeof shape === 'string' && shape !== '' ? shape : null,
      headsign,
      stops: expectArray(p.stops?.[i], `patterns.stops[${i}]`) as string[],
      sched: expectArray(p.sched?.[i], `patterns.sched[${i}]`) as number[][],
      dwell: expectArray(p.dwell?.[i], `patterns.dwell[${i}]`) as number[],
    };
  });
  const t = wire.trips;
  const b = wire.blocks;
  if (!t || !b) throw new TripIndexError('trips or blocks missing');
  const tripIds = expectArray(t.id, 'trips.id') as string[];
  const blockIds = expectArray(b.id, 'blocks.id') as string[];
  const trips: IndexTrip[] = tripIds.map((id, j) => {
    const pattern = t.pattern?.[j];
    const block = blockIds[t.block?.[j] ?? -1];
    if (typeof pattern !== 'number' || pattern < 0 || pattern >= patterns.length) throw new TripIndexError(`trip ${id} has no pattern`);
    if (typeof block !== 'string') throw new TripIndexError(`trip ${id} has no block`);
    return { id, pattern, block, start: typeof t.start?.[j] === 'number' ? t.start[j] : 0 };
  });
  const blocks = blockIds.map((id, k) => ({
    id,
    trips: (expectArray(b.trips?.[k], `blocks.trips[${k}]`) as number[]).map((tripIdx) => {
      const tripId = tripIds[tripIdx];
      if (typeof tripId !== 'string') throw new TripIndexError(`block ${id} names an unknown trip`);
      return tripId;
    }),
  }));
  return { feedVersion: wire.feedVersion, patterns, trips, blocks };
}
