// Stage `places` (lane V1): the committed scripts/snimka/places.json resolved
// into the PlacesFile the director flies to (plan Appendix C). Coordinates
// come from the repository's own artefacts, never from memory: a stop's from
// app/public/data/stops.json by platform id, a depot's from the centre of its
// box in shared/motion/depots.ts. A hand-typed lonLat that differs from the
// artefact by more than PLACE_TOLERANCE_M fails the stage. An entry with
// `find` names the platform by route and name and must lie near a point.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEPOTS } from '../../shared/motion/depots';
import type { HashedRef, PlacesFile } from '../../shared/snimka';
import { metresBetween } from './stage-frames';
import { writeJsonObject, writeWork, type Paths } from './paths';

export const PLACE_TOLERANCE_M = 5;
export const DEFAULT_ZOOM = 14;

export interface StopRow { id: string; name: string; lon: number; lat: number; routes?: string[] }
export interface PlaceEntry {
  id: string; from: 'stop' | 'depot'; ref?: string; name?: string; lonLat?: [number, number]; zoom?: number;
  find?: { route: string; name: string; near: [number, number]; withinM: number };
}
export interface PlacesRefs { places: HashedRef; count: number; rebro: string }

const round5 = (x: number): number => Math.round(x * 1e5) / 1e5;

/** The PlacesFile of the entries, or an error naming the first entry that does not resolve. */
export function resolvePlaces(entries: readonly PlaceEntry[], stops: readonly StopRow[]): PlacesFile {
  const byId = new Map(stops.map((s) => [s.id, s] as const));
  const ids = new Set<string>();
  const places: PlacesFile['places'] = [];
  for (const e of entries) {
    if (ids.has(e.id)) throw new Error(`places: ${e.id} twice`);
    ids.add(e.id);
    let lonLat: [number, number];
    let ref: string;
    let name: string;
    if (e.from === 'depot') {
      const depot = DEPOTS.find((d) => d.name === e.ref);
      if (!depot) throw new Error(`places: ${e.id} names depot ${e.ref}, which shared/motion/depots.ts does not have`);
      lonLat = [round5((depot.minLon + depot.maxLon) / 2), round5((depot.minLat + depot.maxLat) / 2)];
      ref = depot.name;
      name = e.name ?? `Spremište ${depot.name}`;
    } else {
      let stop: StopRow | undefined;
      if (e.find) {
        const pattern = new RegExp(e.find.name, 'iu');
        const near = e.find;
        const candidates = stops.filter((s) => pattern.test(s.name) && (s.routes ?? []).includes(near.route))
          .map((s) => ({ s, d: metresBetween(near.near, [s.lon, s.lat]) }))
          .sort((a, b) => a.d - b.d);
        if (candidates.length === 0 || candidates[0].d > near.withinM) {
          throw new Error(`places: ${e.id} finds no platform of route ${near.route} named /${near.name}/ within ${near.withinM} m of ${near.near.join(', ')}`);
        }
        stop = candidates[0].s;
      } else {
        stop = e.ref ? byId.get(e.ref) : undefined;
      }
      if (!stop) throw new Error(`places: ${e.id} names stop ${e.ref ?? '(none)'}, which stops.json does not have`);
      lonLat = [stop.lon, stop.lat];
      ref = stop.id;
      name = e.name ?? stop.name;
    }
    if (e.lonLat) {
      const off = metresBetween(e.lonLat, lonLat);
      if (off > PLACE_TOLERANCE_M) throw new Error(`places: ${e.id} types ${e.lonLat.join(', ')}, ${off.toFixed(1)} m from its ${e.from} ${ref} at ${lonLat.join(', ')}`);
    }
    places.push({ id: e.id, name, lonLat, zoom: e.zoom ?? DEFAULT_ZOOM, from: e.from, ref });
  }
  return { v: 2, places };
}

export function readPlaceEntries(repo: string): PlaceEntry[] {
  return (JSON.parse(readFileSync(join(repo, 'scripts/snimka/places.json'), 'utf8')) as { places: PlaceEntry[] }).places;
}

export async function stagePlaces(paths: Paths, log: (line: string) => void): Promise<boolean> {
  const stops = JSON.parse(readFileSync(join(paths.repo, 'app/public/data/stops.json'), 'utf8')) as StopRow[];
  const file = resolvePlaces(readPlaceEntries(paths.repo), stops);
  const ref = writeJsonObject(paths, 'places', file);
  writeWork(paths, 'places.json', file);
  const rebro = file.places.find((p) => p.id === 'rebro');
  writeWork(paths, 'places-refs.json', { places: ref, count: file.places.length, rebro: rebro ? `${rebro.ref} ${rebro.name} ${rebro.lonLat.join(', ')}` : 'none' } satisfies PlacesRefs);
  log(`places: ${file.places.length} places; rebro = ${rebro?.ref} ${rebro?.name} (${rebro?.lonLat.join(', ')})`);
  return true;
}
