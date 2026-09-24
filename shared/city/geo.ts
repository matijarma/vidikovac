import type { Place, Settlement, StreetStory } from './types';

/** normalName is pure and called for every event against every venue on each paint, so its answers are kept.
 *  Bounded: room for every street name of the city and its descriptions (a street search folds them all), and
 *  a full memory is dropped whole, so a long-running screen's churn of event titles can never outgrow it. */
const NORMAL_NAMES = new Map<string, string>();
const NORMAL_NAMES_MAX = 16_384;
export function normalName(value: string): string {
  const known = NORMAL_NAMES.get(value);
  if (known !== undefined) return known;
  const folded = value.toLocaleLowerCase('hr').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd')
    .replace(/[“”"'„]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  if (NORMAL_NAMES.size >= NORMAL_NAMES_MAX) NORMAL_NAMES.clear();
  NORMAL_NAMES.set(value, folded);
  return folded;
}
export function distanceM(a: { lon: number; lat: number }, b: { lon: number; lat: number }): number {
  const rad = Math.PI / 180;
  const y = (b.lat - a.lat) * rad, x = (b.lon - a.lon) * rad;
  const h = Math.sin(y / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(x / 2) ** 2;
  return 12_742_000 * Math.asin(Math.min(1, Math.sqrt(h)));
}
export function located(p: Place): p is Place & { lon: number; lat: number } {
  return Number.isFinite(p.lon) && Number.isFinite(p.lat);
}
export function pointInRing(lon: number, lat: number, ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
export function inPolygons(lon: number, lat: number, polygons: [number, number][][][]): boolean {
  return polygons.some(([outer, ...holes]) => outer && pointInRing(lon, lat, outer) && !holes.some(hole => pointInRing(lon, lat, hole)));
}
/** A representative interior vertex/point, never claimed as an entrance. */
export function representative(polygons: [number, number][][][]): [number, number] | undefined {
  const ring = polygons[0]?.[0];
  if (!ring?.length) return undefined;
  const center: [number, number] = [
    ring.reduce((n, p) => n + p[0], 0) / ring.length,
    ring.reduce((n, p) => n + p[1], 0) / ring.length,
  ];
  return inPolygons(...center, polygons) ? center : ring[0];
}
/** No fuzzy matching. Same names in different settlements need geography. */
export function matchStreet(name: string, point: { lon: number; lat: number }, streets: readonly StreetStory[], settlements: readonly Settlement[]): StreetStory | null {
  const key = normalName(name);
  const candidates = streets.filter(s => normalName(s.name) === key);
  const area = settlements.filter(s => inPolygons(point.lon, point.lat, s.polygons));
  if (area.length !== 1) return null;
  const hits = candidates.filter(s => Number(s.settlementId) === Number(area[0].id) || normalName(s.settlement) === normalName(area[0].name));
  return hits.length === 1 ? hits[0] : null;
}
/** Stable source-derived identifiers, not a hash of editable names. */
export function cityId(source: string, id: unknown): string {
  const value = `${source}:${String(id)}`;
  let a = 2166136261, b = 2246822507;
  for (let i = 0; i < value.length; i++) {
    a = Math.imul(a ^ value.charCodeAt(i), 16777619);
    b = Math.imul(b ^ value.charCodeAt(i), 3266489909);
  }
  return `${source}-${(a >>> 0).toString(16).padStart(8, '0')}${(b >>> 0).toString(16).padStart(8, '0')}`;
}
