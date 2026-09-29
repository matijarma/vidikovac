import type { Place, StreetStory } from '../../../shared/city/types';
import { distanceM, located, normalName } from '../../../shared/city/geo';
import { fold, searchTransport, type RouteEntry, type StopGroup } from '../transport/search';

export type CitySearchResult =
  | { kind: 'route'; id: string; name: string; detail: string; record: RouteEntry; score: number }
  | { kind: 'stop'; id: string; name: string; detail: string; record: StopGroup; score: number }
  | { kind: 'place'; id: string; name: string; detail: string; record: Place; score: number }
  | { kind: 'street'; id: string; name: string; detail: string; record: StreetStory; score: number };

/** Names always outrank an incidental address or description match: the whole name, then a name that starts
 *  with the query, then a name one of whose words starts with it ("Jela" for "Trg bana J. Jelačića"), then a name
 *  that merely contains it, then every query word somewhere (round 1 finding F2). */
export function nameScore(name: string, query: string): number {
  const value = fold(name), q = fold(query);
  if (!q) return 0;
  if (value === q) return 100;
  if (value.startsWith(q)) return 80;
  if (value.split(' ').some(word => word.startsWith(q))) return 70;
  if (value.includes(q)) return 60;
  return q.split(' ').every(word => value.includes(word)) ? 40 : 0;
}
/**
 * Words a place is found by beside its name and address: its kind ("wc" finds a toilet named "Centar"). One table for the
 * map's discovery (city/discovery.ts) and this list, so what the map draws for a query the list holds too. It lives here
 * because discovery.ts imports this module.
 */
export const CATEGORY_TERMS: Record<string, string> = {
  water: 'voda cesma pitka drinking water', toilet: 'wc zahod javni toalet toilet',
  wifi: 'wifi wi fi internet', sport: 'sport igraliste courts', dogs: 'psi pse dog',
  recycling: 'recikliranje otpad recycling', market: 'trznica market',
  garage: 'garaza parking', charging: 'punionica charging', 'cycle-parking': 'bicikl stalak bicycle',
  culture: 'kultura culture muzej museum', heritage: 'bastina heritage', rail: 'vlak train',
  // An air station is filed under the water category of the catalogue, but it is found by "zrak", not by "voda".
  air: 'zrak kvaliteta zraka air quality',
};
export function categoryTermsOf(place: Pick<Place, 'category' | 'sourceId'>): string {
  return CATEGORY_TERMS[place.sourceId === 'air' ? 'air' : place.category] ?? '';
}
/** The folded text a query's words are looked for in, by discover and by the list alike. */
export function placeSearchText(place: Place): string {
  return normalName(`${place.name} ${place.address ?? ''} ${place.subtype ?? ''} ${categoryTermsOf(place)}`);
}
/** A place found only by its category words (no name or address match) still belongs in the list the map draws for it, under every name match. */
export const CATEGORY_MATCH_SCORE = 25;

/** A stop outranks a street or a place of the same name quality: the person searching a transit map at a stop
 *  wants the stop first (round 1 finding F2); a route number keeps its own +20 above that. */
const STOP_BONUS = 15;

/** How far apart two access points of one name may stand and still be one row: a square's hotspots are spread over it
 *  (five "Trg Bana Josipa Jelacica" rows survived a 30 m rule, round 1, desktop F8). */
const WIFI_GROUP_M = 300;
/** Access points of one name near each other are one row. Identical names elsewhere
 * remain separate places; the canonical record keeps its original ID. */
export function groupWifi(places: readonly Place[]): Place[] {
  const out: Place[] = [];
  const locations = new Map<string, Place[]>();
  for (const place of places) {
    if (place.category !== 'wifi' || !located(place)) { out.push(place); continue; }
    const key = fold(place.name || place.address || '');
    const neighbours = locations.get(key) ?? [];
    if (neighbours.some(other => located(other) && distanceM(place, other) <= WIFI_GROUP_M)) continue;
    neighbours.push(place);
    locations.set(key, neighbours);
    out.push(place);
  }
  return out;
}
/** A place found by its address, a street by its description: under every name match, never a row for a query it does
 *  not contain (47 to 62 rows for "Jela" came from the old flat fallback, round 1, desktop F8). */
function incidentalScore(text: string | undefined, query: string, cap: number): number {
  return text ? Math.min(cap, nameScore(text, query)) : 0;
}

/** CATEGORY_MATCH_SCORE for a place discover matched by its category words (every query word in name, address, subtype and terms). */
function categoryScore(place: Place, query: string): number {
  const text = placeSearchText(place);
  const words = normalName(query).split(' ').filter(Boolean);
  return words.length > 0 && words.every((word) => text.includes(word)) ? CATEGORY_MATCH_SCORE : 0;
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
      score: nameScore(record.name, query) + STOP_BONUS,
    })),
    ...groupWifi(places).map(record => ({
      kind: 'place' as const, id: record.id, name: record.name, detail: record.address ?? '', record,
      score: nameScore(record.name, query) || incidentalScore(record.address, query, 30) || categoryScore(record, query),
    })),
    ...streets.map(record => ({
      kind: 'street' as const, id: record.id, name: record.name, detail: record.settlement, record,
      score: nameScore(record.name, query) || incidentalScore(record.description, query, 20),
    })),
  ];
  // Two stops of one score: the one with more lines first, as searchTransport orders them.
  const lines = (r: CitySearchResult): number => r.kind === 'stop' ? r.record.routes.length : 0;
  return results.filter(r => r.score > 0).sort((a, b) => b.score - a.score || lines(b) - lines(a) || a.name.localeCompare(b.name, 'hr', { numeric: true }) || a.id.localeCompare(b.id));
}
