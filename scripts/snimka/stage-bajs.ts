// Stage `bajs` (lane S1): nextbike's station status for the 200 BAJS stations,
// recorded every minute, as the minute totals of the series (bikes on
// stations, empty stations, stations reporting) and as the five-minute station
// matrix the map draws. Station names and coordinates come from the newest
// sampler copy of the product's own city layer that lists all 200 stations.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { BAJS_MISSING, BAJS_NOT_RENTING, encodeBajs } from '../../shared/snimka-codec';
import { BAJS_STEP_S, SNIMKA_WINDOW, type Col, type HashedRef, type StationsFile } from '../../shared/snimka';
import { writeJsonObject, writeWork, type Paths } from './paths';

export interface BikesMinutes { t0: number; n: number; total: Col<number>; empty: Col<number>; reporting: Col<number> }
export interface BajsRefs { stations: HashedRef; bajs: HashedRef; stationCount: number; samples: number }

interface GbfsStation { station_id: string; num_bikes_available?: number; is_installed?: boolean | number; is_renting?: boolean | number }

/** `20260927T200701Z` (a recorder stamp) as epoch seconds. */
export function stampSec(stamp: string): number | null {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/.exec(stamp);
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) / 1000 : null;
}

const truthy = (x: boolean | number | undefined): boolean => x === true || x === 1;

/** The stations of the newest sampler copy of city-live.json that lists exactly 200. */
export function bajsStations(inputs: string): StationsFile['stations'] {
  const root = join(inputs, 'companion', 'data-calendar');
  const stamps = readdirSync(root).filter((s) => /^\d{8}T\d{6}Z$/.test(s)).sort().reverse();
  for (const stamp of stamps) {
    const file = join(root, stamp, 'city-live.json');
    if (!existsSync(file)) continue;
    try {
      const live = JSON.parse(readFileSync(file, 'utf8')) as { bikes?: { id: string; name: string; lon: number; lat: number; capacity?: number | null }[] };
      const bikes = live.bikes;
      if (!Array.isArray(bikes) || bikes.length !== 200) continue;
      return bikes
        .map((b) => ({ id: String(b.id), name: String(b.name), lon: Number(b.lon), lat: Number(b.lat), capacity: Number.isInteger(b.capacity) ? (b.capacity as number) : null }))
        .sort((a, b) => a.id.localeCompare(b.id));
    } catch {
      continue;
    }
  }
  throw new Error(`bajs: no city-live.json under ${root} lists 200 stations`);
}

export async function stageBajs(paths: Paths, log: (line: string) => void): Promise<boolean> {
  const stations = bajsStations(paths.inputs);
  const t0 = SNIMKA_WINDOW.fromSec;
  const n = SNIMKA_WINDOW.minutes;
  const slots = (n * 60) / BAJS_STEP_S;
  const minutes: BikesMinutes = { t0, n, total: new Array(n).fill(null), empty: new Array(n).fill(null), reporting: new Array(n).fill(null) };
  const index = new Map(stations.map((s, i) => [s.id, i] as const));
  const matrix = stations.map(() => new Uint8Array(slots).fill(BAJS_MISSING));
  const slotTaken = new Array<boolean>(slots).fill(false);
  const dir = join(paths.inputs, 'strike', 'bajs');
  const files = readdirSync(dir).filter((f) => f.endsWith('.json.gz')).sort();
  let used = 0;
  for (const name of files) {
    const at = stampSec(name);
    if (at === null || at < t0 || at >= t0 + n * 60) continue;
    let list: GbfsStation[];
    try {
      const body = JSON.parse(gunzipSync(readFileSync(join(dir, name))).toString('utf8')) as { data?: { stations?: GbfsStation[] } };
      list = body.data?.stations ?? [];
    } catch {
      log(`bajs: ${name} unreadable, left missing`);
      continue;
    }
    if (list.length === 0) continue;
    used++;
    const m = Math.floor((at - t0) / 60);
    let total = 0;
    let empty = 0;
    let reporting = 0;
    for (const s of list) {
      if (!truthy(s.is_installed)) continue;
      reporting++;
      const bikes = Number.isInteger(s.num_bikes_available) ? (s.num_bikes_available as number) : 0;
      total += bikes;
      if (bikes === 0) empty++;
    }
    // The last copy of a minute stands for it.
    minutes.total[m] = total;
    minutes.empty[m] = empty;
    minutes.reporting[m] = reporting;
    const j = Math.floor((at - t0) / BAJS_STEP_S);
    if (slotTaken[j]) continue;
    slotTaken[j] = true;
    for (const s of list) {
      const i = index.get(String(s.station_id));
      if (i === undefined) continue;
      const bikes = s.num_bikes_available;
      matrix[i][j] = !truthy(s.is_installed) || !truthy(s.is_renting) ? BAJS_NOT_RENTING : Number.isInteger(bikes) ? Math.min(250, Math.max(0, bikes as number)) : BAJS_MISSING;
    }
  }
  const stationsRef = writeJsonObject(paths, 'bajs/stations', { v: 1, stations } satisfies StationsFile);
  const bajsRef = writeJsonObject(paths, 'bajs/window', encodeBajs(t0, BAJS_STEP_S, stations.map((s) => s.id), matrix));
  writeWork(paths, 'bikes-minutes.json', minutes);
  writeWork(paths, 'bajs-refs.json', { stations: stationsRef, bajs: bajsRef, stationCount: stations.length, samples: used } satisfies BajsRefs);
  const known = minutes.total.filter((x) => x !== null).length;
  log(`bajs: ${stations.length} stations, ${used} status copies, ${known} of ${n} minutes, ${slotTaken.filter(Boolean).length} of ${slots} five-minute slots`);
  return true;
}
