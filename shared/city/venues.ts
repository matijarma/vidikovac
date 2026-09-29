// Venue placement for events whose source names the venue only in words (Kulturpunkt's
// "u Maloj dvorani Pogona Jedinstvo", "Kunst Caffeu"): a gazetteer of venue names with
// their points, from three sources in order of trust, and a resolver that places an event
// only on consistent evidence. An unplaced event stays unplaced; a wrong pin is worse than
// none, so every doubt answers null.
//   1. The City's culture register (catalogue source `culture`): first the exact resolver
//      of shared/city/events.ts (resolveVenues), then its names as below.
//   2. The venue names of the City's culture calendar (kultura-zg items: data.venue with
//      the item's own point).
//   3. OpenStreetMap venue names (app/public/data/osm-hours.json through osmVenues).
// A name matches when its stems (shared/city/stems.ts: the hints are inflected) run
// consecutively in the stems of one phrase of data.venue, data.venueHint or
// data.venueTags (phrases are split at '|'). Function words are left out on both sides
// ("Centru kulture Trešnjevka" is "Centar za kulturu Trešnjevka") and a fleeting a is
// folded ("KunstTeatru", "KunstTeatar"). A name of one stem matches only a whole phrase of
// data.venue or data.venueTags, or the whole leading name of a hint phrase (its words up to
// the first function word or number: "KunstTeatru" in "KunstTeatru od 2", but not
// "Akademiji" in "Akademiji likovnih umjetnosti"), never a word inside the prose: cafés are
// called "Zagreb", "Knežija", "Maksimir" or "Akademija". A name of three or more words also matches its
// initials written as an abbreviation ("ZPC-u", the tag "msu"). The first source with a
// match decides; its matches must lie within 150 m of each other, or the event stays unplaced.
import type { FeedItem } from '../../worker/feed/schema';
import type { Place } from './types';
import type { VenueEntry } from './osm-hours';
import { resolveVenues } from './events';
import { distanceM, located, normalName } from './geo';
import { containsStems, stemWords } from './stems';

export interface Gazetteer { readonly size: number }

interface Entry {
  readonly name: string;
  readonly stems: readonly string[];
  /** The first letters of the name's words (function words left out), for three words or more; '' otherwise. */
  readonly initials: string;
  readonly lon: number;
  readonly lat: number;
}
interface Built extends Gazetteer {
  readonly places: readonly Place[];
  readonly placeById: ReadonlyMap<string, Place & { lon: number; lat: number }>;
  /** Entries per source, in the order of trust. */
  readonly sources: readonly (readonly Entry[])[];
}

/** Matches within this distance are one venue; farther apart, the name is ambiguous. */
const AGREE_M = 150;
/** A name needs this many letters in its stems: "KIC", "ZKM" or "MaMi" alone would match any mention. */
const MIN_LETTERS = 6;
/** Left out of names and hints alike: they carry no identity and differ between the forms of one name. */
const FUNCTION_WORDS: ReadonlySet<string> = new Set(['za', 'i', 'u', 'na', 'od', 'do', 's', 'sa']);
/** A fleeting a: "centar", "centra", "centru" (stems centar, centr) and "teatar", "teatru" become one stem. */
const fold = (stem: string): string => (stem.length >= 5 ? stem.replace(/([^aeiou])a([^aeiou])$/, '$1$2') : stem);
/** Words that name a kind of place or an area, not a place: a name made only of these matches everywhere. The
 *  list of docs/upgrade-2026-10-plan/U3.md O3, plus the city's own name, the words of its seventeen districts
 *  (a café called "Maksimir" is not the park) and the calendar's placeholders ("Sjedište Organizacije", "Ulaz za
 *  gledatelje") that name no particular venue. */
const GENERIC: ReadonlySet<string> = new Set([
  'galerij', 'muzej', 'knjiznic', 'kin', 'kino', 'kazalist', 'dvoran', 'centar', 'centr', 'caff', 'cafe', 'bar', 'klub', 'dom', 'park', 'trg',
  'zagreb', 'zagreback', 'grad', 'sjedist', 'organizacij', 'ulaz', 'gledatelj',
  ...stemWords('Donji grad Gornji grad Medveščak Trnje Maksimir Peščenica Žitnjak Novi Zagreb istok zapad Trešnjevka sjever jug '
    + 'Črnomerec Gornja Dubrava Donja Dubrava Stenjevec Podsused Vrapče Podsljeme Sesvete Brezovica'),
].map(fold));
/** Another city named in a hint: the nouns in their cases, and the adjectives unless a house number or a street
 *  word follows ("u Zadarskoj 80" is Zagreb's Zadarska ulica); Avenija Dubrovnik is a Zagreb street. */
const CITY_NOUN = /\b(?:split(?:u|a|om)?|rijek(?:a|e|u|om)|rijeci|pul(?:a|e|i|u|om)|osijek(?:u|a|om)?|zadar|zadr(?:u|a|om)|dubrovnik(?:u|a|om)?|varazdin(?:u|a|om)?|karlov(?:ac|cu|ca|cem)|sibenik(?:u|a|om)?|lazaret\w*)\b/;
const CITY_ADJECTIVE = /\b(?:splitsk|rijeck|pulsk|osjeck|zadarsk|dubrovack|varazdinsk|karlovack|sibensk)\w*\b(?! (?:\d|ulic|cest|trg|avenij))/;
/** An abbreviation in the hint's own capitals ("ZPC-u", "MSU"). */
const ABBREVIATION = /(?<!\p{L})\p{Lu}{3,6}(?!\p{Ll})/gu;

function namesAnotherCity(text: string): boolean {
  const folded = normalName(text).replace(/\bavenij\w* dubrovnik\w*/g, ' ');
  return CITY_NOUN.test(folded) || CITY_ADJECTIVE.test(folded);
}

const words = (text: string): string[] => normalName(text).split(' ').filter((w) => w && !FUNCTION_WORDS.has(w));
const stemsOf = (text: string): string[] => stemWords(text).filter((s) => !FUNCTION_WORDS.has(s)).map(fold);

function entry(name: string, lon: number, lat: number): Entry | null {
  const stems = stemsOf(name);
  const letters = stemWords(name).filter((s) => !FUNCTION_WORDS.has(s)).reduce((n, s) => n + s.length, 0);
  if (letters < MIN_LETTERS || stems.every((s) => GENERIC.has(s))) return null;
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  const w = words(name);
  return { name, stems, initials: w.length >= 3 ? w.map((x) => x[0]).join('') : '', lon, lat };
}

export function buildGazetteer(input: { places: readonly Place[]; kultura: readonly FeedItem[]; osm: readonly VenueEntry[] }): Gazetteer {
  // The exact register resolver is a matching strategy, not an exemption from
  // the same minimum-name/generic-name checks used by the other strategies.
  const culture = input.places.filter((p): p is Place & { lon: number; lat: number } =>
    p.category === 'culture' && located(p) && entry(p.name, p.lon, p.lat) !== null);
  const register = culture.map((p) => entry(p.name, p.lon, p.lat));
  const calendar = input.kultura.map((item) => {
    const venue = item.data?.venue;
    const c = item.geo?.type === 'Point' ? (item.geo.coordinates as number[]) : null;
    return typeof venue === 'string' && c ? entry(venue, c[0], c[1]) : null;
  });
  const osm = input.osm.map((v) => entry(v.name, v.lon, v.lat));
  const sources = [register, calendar, osm].map((list) => list.filter((e): e is Entry => e !== null));
  const built: Built = {
    size: sources.reduce((n, s) => n + s.length, 0),
    places: culture,
    placeById: new Map(culture.map((p) => [p.id, p])),
    sources,
  };
  return built;
}

/** One named entry for matches that agree, the longest name's; null when two lie AGREE_M or more apart. */
function agreed(hits: readonly (VenueEntry & { stems?: readonly string[] })[]): VenueEntry | null {
  if (!hits.length) return null;
  for (let i = 0; i < hits.length; i++) for (let j = i + 1; j < hits.length; j++) if (distanceM(hits[i], hits[j]) >= AGREE_M) return null;
  const best = hits.reduce((a, b) => ((b.stems?.length ?? 0) > (a.stems?.length ?? 0) ? b : a));
  return best;
}

const phrasesOf = (text: unknown): string[][] =>
  typeof text === 'string' ? text.split('|').map(stemsOf).filter((p) => p.length > 0) : [];
const sameStems = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((s, i) => s === b[i]);
/** The leading name of each hint phrase: its stems up to the first function word or number. */
function leadsOf(text: unknown): string[][] {
  if (typeof text !== 'string') return [];
  return text.split('|').map((phrase) => {
    const stems = stemWords(phrase);
    const end = stems.findIndex((s) => FUNCTION_WORDS.has(s) || /^\d/.test(s));
    return (end < 0 ? stems : stems.slice(0, end)).map(fold);
  }).filter((p) => p.length > 0);
}

/** Shared evidence path: a display name must identify the same entry as its point. */
function resolveVenue(item: FeedItem, gazetteer: Gazetteer): VenueEntry | null {
  const g = gazetteer as Partial<Built>;
  if (!g.sources || !g.places || !g.placeById) return null;
  const data = item.data ?? {};
  if (data.city !== undefined && normalName(String(data.city)) !== 'zagreb') return null;
  const texts = [data.venue, data.venueHint, data.venueTags].filter((v): v is string => typeof v === 'string' && v.trim() !== '');
  if (!texts.length || texts.some(namesAnotherCity)) return null;
  const ids = resolveVenues(item, g.places);
  const exact = ids.map((id) => g.placeById!.get(id)).filter((p): p is Place & { lon: number; lat: number } => !!p);
  const named = [...phrasesOf(data.venue), ...phrasesOf(data.venueTags)];
  const all = [...named, ...phrasesOf(data.venueHint)];
  const leads = leadsOf(data.venueHint);
  const abbreviations = new Set<string>([
    ...[...String(data.venueHint ?? '').matchAll(ABBREVIATION)].map((m) => normalName(m[0])),
    ...(typeof data.venueTags === 'string' ? normalName(data.venueTags).split(' ').filter((w) => w.length === 3) : []),
  ]);
  const matches = (e: Entry): boolean =>
    (e.stems.length === 1
      ? named.some((p) => sameStems(p, e.stems)) || leads.some((p) => sameStems(p, e.stems))
      : all.some((p) => containsStems(p, e.stems)))
    || (e.initials !== '' && abbreviations.has(e.initials));
  for (const [source, entries] of g.sources.entries()) {
    // An exact alias and a stem match in the register are evidence from the
    // same source. Neither may hide a conflicting point from the other.
    const hits = [...entries.filter(matches), ...(source === 0 ? exact : [])];
    if (hits.length) return agreed(hits);
  }
  return null;
}

export function resolveVenuePoint(item: FeedItem, gazetteer: Gazetteer): { lon: number; lat: number } | null {
  const venue = resolveVenue(item, gazetteer);
  return venue ? { lon: venue.lon, lat: venue.lat } : null;
}

/** Canonical name from the matched source entry, never an unmatched venue hint. */
export function resolveVenueName(item: FeedItem, gazetteer: Gazetteer): string | null {
  return resolveVenue(item, gazetteer)?.name ?? null;
}
