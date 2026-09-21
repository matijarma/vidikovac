import type { Place, StreetStory } from '../../../shared/city/types';
import { distanceM, located } from '../../../shared/city/geo';
import { fold, searchTransport, type RouteEntry, type StopGroup } from '../transport/search';

export type CitySearchResult =
  | { kind: 'route'; id: string; name: string; detail: string; record: RouteEntry; score: number }
  | { kind: 'stop'; id: string; name: string; detail: string; record: StopGroup; score: number }
  | { kind: 'place'; id: string; name: string; detail: string; record: Place; score: number }
  | { kind: 'street'; id: string; name: string; detail: string; record: StreetStory; score: number };

/** Names always outrank an incidental address or description match. */
export function nameScore(name: string, query: string): number {
  const value = fold(name), q = fold(query);
  if (!q) return 0;
  if (value === q) return 100;
  if (value.startsWith(q)) return 80;
  if (value.includes(q)) return 60;
  return q.split(' ').every(word => value.includes(word)) ? 40 : 0;
}

/** Only co-located access points are grouped. Identical names elsewhere
 * remain separate places; the canonical record keeps its original ID. */
export function groupWifi(places: readonly Place[]): Place[] {
  const out: Place[] = [];
  const locations = new Map<string, Place[]>();
  for (const place of places) {
    if (place.category !== 'wifi' || !located(place)) { out.push(place); continue; }
    const key = fold(place.address || place.name);
    const neighbours = locations.get(key) ?? [];
    if (neighbours.some(other => located(other) && distanceM(place, other) <= 30)) continue;
    neighbours.push(place);
    locations.set(key, neighbours);
    out.push(place);
  }
  return out;
}

export function searchCity(query: string, routes: readonly RouteEntry[], stops: readonly StopGroup[], places: readonly Place[], streets: readonly StreetStory[]): CitySearchResult[] {
  if (!fold(query)) return [];
  const transport = searchTransport(query, routes, stops, { routes: routes.length, stops: stops.length });
  const results: CitySearchResult[] = [
    ...transport.routes.map(record => ({
      kind: 'route' as const, id: record.id, name: record.short, detail: record.long, record,
      score: /^\d+[a-z]?$/i.test(fold(query)) ? nameScore(record.short, query) + 20 : nameScore(record.long, query),
    })),
    ...transport.stops.map(record => ({
      kind: 'stop' as const, id: record.id, name: record.name, detail: record.routes.join(', '), record,
      score: nameScore(record.name, query) + 5,
    })),
    ...groupWifi(places).map(record => ({
      kind: 'place' as const, id: record.id, name: record.name, detail: record.address ?? '', record,
      score: nameScore(record.name, query) || 10,
    })),
    ...streets.map(record => ({
      kind: 'street' as const, id: record.id, name: record.name, detail: record.settlement, record,
      score: nameScore(record.name, query) || 5,
    })),
  ];
  return results.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'hr', { numeric: true }) || a.id.localeCompare(b.id));
}
