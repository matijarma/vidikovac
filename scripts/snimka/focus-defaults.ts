// What an item points the instrument at when its curated entry does not say
// (lane V1, plan Appendix C): the beat of a headline, the id of an event and
// the id of a ZET notice each give a focus, the facts the panels show beside
// it, the mentions the feed filters by and, for events, the panel to spot and
// the dwell. Pure: no I/O. A curated entry's own fields always win; the build
// then resolves place foci from places.json and validates every id.

import type { FactKey, Focus, Mentions, SnimkaEvent } from '../../shared/snimka';

export type Spot = NonNullable<SnimkaEvent['spot']>;
export interface Pointers { focus: Focus; facts: FactKey[]; mentions: Mentions; spot?: Spot; dwellS?: number }

const CITY: Focus = { kind: 'city' };
const NONE: Focus = { kind: 'none' };
const place = (id: string): Focus => ({ kind: 'place', id });
const route = (id: string): Focus => ({ kind: 'route', id });
const STATE_FACTS: FactKey[] = ['seen', 'expected', 'state'];

/** Beat of a headline → its pointers (news items carry no spot or dwell). */
export function beatDefaults(beat: string | null): Pointers {
  switch (beat) {
    case 'najava':
    case 'pocetak':
    case 'prvo-jutro':
    case 'drugi-dan':
    case 'treci-dan':
    case 'nakon':
    case 'povratak':
      return { focus: CITY, facts: [...STATE_FACTS], mentions: {} };
    case 'jedan-tramvaj':
      return { focus: route('17'), facts: ['route:17', 'seen'], mentions: { routes: ['17'] } };
    case 'linija-228':
      return { focus: route('228'), facts: ['route:228', 'seen'], mentions: { routes: ['228'], places: ['rebro'] } };
    case 'bajs':
      return { focus: { kind: 'layer', layer: 'bikes' }, facts: ['bikes', 'bikesEmpty'], mentions: {} };
    case 'vlak':
      return { focus: place('glavni-kolodvor'), facts: ['state', 'seen'], mentions: { places: ['glavni-kolodvor'], tags: ['rail'] } };
    case 'sud-privremeno':
    case 'presuda':
    case 'holding':
    case 'pregovori':
      return { focus: NONE, facts: ['state', 'seen', 'expected'], mentions: {} };
    case 'taksi':
    case 'skole':
    case 'guzve':
    case 'volonteri':
      return { focus: place('jelacic'), facts: ['seen', 'bikesEmpty'], mentions: { places: ['jelacic'] } };
    default:
      return { focus: NONE, facts: ['state', 'seen'], mentions: {} };
  }
}

const MORNINGS = new Set(['prvo-jutro', 'trece-jutro', 'prvo-uobicajeno-jutro', 'drugo-uobicajeno-jutro']);

/** Event id → its pointers, by the rules of Appendix C (an id the rules do not name looks at the city). */
export function eventDefaults(id: string): Pointers {
  if (MORNINGS.has(id) || /-jutro$/.test(id)) return { focus: place('jelacic'), facts: [...STATE_FACTS], mentions: { places: ['jelacic'] }, spot: 'zaslon' };
  if (id === 'povlacenje') {
    return { focus: place('spremiste-dubrava'), facts: ['seen', 'expected'], mentions: { places: ['spremiste-dubrava', 'spremiste-ljubljanica'] }, spot: 'vozila', dwellS: 6 };
  }
  if (id === 'linija-228') return { focus: route('228'), facts: ['route:228', 'seen'], mentions: { routes: ['228'], places: ['rebro'] }, spot: 'linije' };
  if (id.startsWith('feed-')) return { focus: NONE, facts: ['feed', 'seen'], mentions: {}, spot: 'stanje' };
  if (id === 'pocetak' || id.startsWith('sud-') || id === 'zet-poziv' || id.startsWith('nadogradnja-') || id === 'stanje-usluge' || id === 'vozni-red-396' || id === 'obavijest-zet') {
    return { focus: NONE, facts: [...STATE_FACTS], mentions: {}, spot: 'stanje' };
  }
  if (id === 'prekid-snimanja') return { focus: NONE, facts: ['feed', 'seen'], mentions: {}, spot: 'stanje' };
  if (id === 'povratak' || id === 'puni-opseg' || id === 'smanjeno' || id === 'uobicajeno') return { focus: CITY, facts: [...STATE_FACTS], mentions: {}, spot: 'mreza' };
  return { focus: CITY, facts: [...STATE_FACTS], mentions: {}, spot: 'vozila' };
}

/** ZET notice id → its pointers (Appendix C: 10166 is line 228 to Rebro, 10168 the return). */
export function noticeDefaults(id: number): Pointers {
  if (id === 10166) return { focus: route('228'), facts: ['route:228', 'seen'], mentions: { routes: ['228'], places: ['rebro'] } };
  if (id === 10168) return { focus: CITY, facts: [...STATE_FACTS], mentions: {} };
  return { focus: NONE, facts: ['state', 'seen'], mentions: {} };
}

/** A curated entry's own pointers over the defaults, field by field. */
export function withDefaults(entry: Partial<Pointers>, defaults: Pointers): Pointers {
  const out: Pointers = { focus: entry.focus ?? defaults.focus, facts: entry.facts ?? defaults.facts, mentions: entry.mentions ?? defaults.mentions };
  const spot = entry.spot ?? defaults.spot;
  const dwellS = entry.dwellS ?? defaults.dwellS;
  if (spot !== undefined) out.spot = spot;
  if (dwellS !== undefined) out.dwellS = dwellS;
  return out;
}

const FACT = /^(seen|expected|state|bikes|bikesEmpty|closures|temp|feed|route:[^\s:]+|station:[^\s:]+)$/;
const SPOTS = new Set<Spot>(['stanje', 'vozila', 'linije', 'mreza', 'bicikli', 'vrijeme', 'zaslon']);

export interface Known { routes: ReadonlySet<string>; stations: ReadonlySet<string>; places: ReadonlyMap<string, { name: string; lonLat: [number, number]; zoom: number }>; stops: ReadonlySet<string> }

/**
 * Every id resolved against the known routes, stations, places and stops, a
 * place focus filled with its name, lonLat and zoom; an error names the item
 * and the id that does not resolve.
 */
export function resolvePointers(where: string, p: Pointers, known: Known): Pointers {
  const fail = (what: string): never => { throw new Error(`${where}: ${what}`); };
  let focus = p.focus;
  switch (focus.kind) {
    case 'route': if (!known.routes.has(focus.id)) fail(`focus route ${focus.id} is not in the routes file`); break;
    case 'station': if (!known.stations.has(focus.id)) fail(`focus station ${focus.id} is not in the stations file`); break;
    case 'stop': if (!known.stops.has(focus.id)) fail(`focus stop ${focus.id} is not in stops.json`); break;
    case 'place': {
      const found = known.places.get(focus.id);
      if (!found) fail(`focus place ${focus.id} is not in places.json`);
      focus = { kind: 'place', id: focus.id, name: found!.name, lonLat: found!.lonLat, zoom: found!.zoom };
      break;
    }
    default: break;
  }
  for (const f of p.facts) {
    if (!FACT.test(f)) fail(`fact ${f} is not a FactKey`);
    if (f.startsWith('route:') && !known.routes.has(f.slice(6))) fail(`fact ${f} names a route the routes file lacks`);
    if (f.startsWith('station:') && !known.stations.has(f.slice(8))) fail(`fact ${f} names a station the stations file lacks`);
  }
  for (const r of p.mentions.routes ?? []) if (!known.routes.has(r)) fail(`mention route ${r} is not in the routes file`);
  for (const s of p.mentions.stations ?? []) if (!known.stations.has(s)) fail(`mention station ${s} is not in the stations file`);
  for (const pl of p.mentions.places ?? []) if (!known.places.has(pl)) fail(`mention place ${pl} is not in places.json`);
  if (p.spot !== undefined && !SPOTS.has(p.spot)) fail(`spot ${p.spot} is not a panel`);
  if (p.dwellS !== undefined && !(p.dwellS > 0)) fail(`dwellS ${p.dwellS}`);
  return { ...p, focus };
}
