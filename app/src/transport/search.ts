// Route and stop search: what a person types on a street corner -- "6",
// "11", "kvatern", "trg bana" -- against the static route table and the
// stop catalogue, with Croatian diacritics folded both ways so "crnomerec"
// finds Črnomerec and "Trešnjevka" finds itself. Pure and synchronous: the
// catalogues are small (154 routes, ~2 700 platforms grouped into ~1 400
// named stops) and the workspace runs this on every keystroke.
import { ROUTE_TYPE_TRAM } from '../motion/schematic';

export interface RouteEntry {
  id: string;
  /** The number on the front of the vehicle. */
  short: string;
  /** GTFS route_long_name: "Črnomerec - Savišće". */
  long: string;
  /** GTFS route_type: 0 tram, 3 bus. */
  type: number;
}

/** One named stop: every platform GTFS lists under that name, the routes
 *  that call at any of them, and a representative position. `id` is the
 *  first platform's id, a real GTFS stop id the public selection may carry. */
export interface StopGroup {
  id: string;
  ids: string[];
  name: string;
  lon: number;
  lat: number;
  routes: string[];
}

export interface SearchResults {
  routes: RouteEntry[];
  stops: StopGroup[];
}

const DIACRITICS: Record<string, string> = { č: 'c', ć: 'c', đ: 'd', š: 's', ž: 'z' };

/** Lower-case, diacritics folded, punctuation collapsed to single spaces. */
export function fold(text: string): string {
  return text
    .toLocaleLowerCase('hr')
    .replace(/[čćđšž]/g, (char) => DIACRITICS[char] ?? char)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** One collator for every route sort: `localeCompare` with an options object builds a collator per call, and the
 *  stop groups sort their routes thousands of times while the network is installed (round 3, phone A). */
const ROUTE_ORDER = new Intl.Collator('hr', { numeric: true });

/** Route numbers the way a person reads them: numeric first, then text. */
export function compareRouteShort(a: string, b: string): number {
  return ROUTE_ORDER.compare(a, b);
}

function scoreName(folded: string, query: string): number {
  if (folded === query) return 4;
  if (folded.startsWith(query)) return 3;
  if (folded.includes(` ${query}`)) return 2;
  if (folded.includes(query)) return 1;
  return 0;
}

/** Every query word must appear somewhere in the name; the score is the
 *  best single-word match, so "trg bana" ranks Trg bana Jelačića first. */
function scoreWords(folded: string, words: readonly string[]): number {
  let best = 0;
  for (const word of words) {
    const score = scoreName(folded, word);
    if (score === 0) return 0;
    best = Math.max(best, score);
  }
  return best;
}

/**
 * Routes and stops matching `query`, best first, each list capped. A bare
 * number is a route number first (exact, then prefix) and a stop name only
 * if some stop is actually called that; words search route names and stop
 * names alike. An empty query answers with nothing.
 */
export function searchTransport(query: string, routes: readonly RouteEntry[], stops: readonly StopGroup[], limits = { routes: 6, stops: 8 }): SearchResults {
  const q = fold(query);
  if (q === '') return { routes: [], stops: [] };
  const words = q.split(' ').filter(Boolean);
  const numeric = /^\d+[a-z]?$/.test(q);

  const routeHits: { route: RouteEntry; score: number }[] = [];
  for (const route of routes) {
    const short = fold(route.short);
    let score = 0;
    if (numeric) {
      if (short === q) score = 5;
      else if (short.startsWith(q)) score = 3;
    } else {
      score = scoreWords(fold(route.long), words);
      if (short === q) score = Math.max(score, 5);
    }
    if (score > 0) routeHits.push({ route, score });
  }
  routeHits.sort((a, b) => b.score - a.score || a.route.type - b.route.type || compareRouteShort(a.route.short, b.route.short));

  const stopHits: { stop: StopGroup; score: number }[] = [];
  for (const stop of stops) {
    const score = scoreWords(fold(stop.name), words);
    if (score > 0) stopHits.push({ stop, score });
  }
  stopHits.sort((a, b) => b.score - a.score || b.stop.routes.length - a.stop.routes.length || a.stop.name.localeCompare(b.stop.name, 'hr'));

  return {
    routes: routeHits.slice(0, limits.routes).map((hit) => hit.route),
    stops: stopHits.slice(0, limits.stops).map((hit) => hit.stop),
  };
}

/** Trams before buses, then by number as read. */
export function sortRoutes(routes: readonly RouteEntry[]): RouteEntry[] {
  return [...routes].sort((a, b) => Number(a.type !== ROUTE_TYPE_TRAM) - Number(b.type !== ROUTE_TYPE_TRAM) || compareRouteShort(a.short, b.short));
}
