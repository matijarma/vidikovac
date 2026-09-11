// The 17 gradske četvrti (names as in the City's Gradske_cetvrti FeatureServer,
// field IME_GC, title-cased) and the venue vocabulary. Slugs are what is
// stored and counted; names are what people read.
import type { VenueType } from '../protocol';

export const AREAS = [
  { slug: 'donji-grad', name: 'Donji grad' },
  { slug: 'gornji-grad-medvescak', name: 'Gornji grad – Medveščak' },
  { slug: 'trnje', name: 'Trnje' },
  { slug: 'maksimir', name: 'Maksimir' },
  { slug: 'pescenica-zitnjak', name: 'Peščenica – Žitnjak' },
  { slug: 'novi-zagreb-istok', name: 'Novi Zagreb – istok' },
  { slug: 'novi-zagreb-zapad', name: 'Novi Zagreb – zapad' },
  { slug: 'tresnjevka-sjever', name: 'Trešnjevka – sjever' },
  { slug: 'tresnjevka-jug', name: 'Trešnjevka – jug' },
  { slug: 'crnomerec', name: 'Črnomerec' },
  { slug: 'gornja-dubrava', name: 'Gornja Dubrava' },
  { slug: 'donja-dubrava', name: 'Donja Dubrava' },
  { slug: 'stenjevec', name: 'Stenjevec' },
  { slug: 'podsused-vrapce', name: 'Podsused – Vrapče' },
  { slug: 'podsljeme', name: 'Podsljeme' },
  { slug: 'sesvete', name: 'Sesvete' },
  { slug: 'brezovica', name: 'Brezovica' },
] as const;

export type AreaSlug = (typeof AREAS)[number]['slug'];

const AREA_NAMES: ReadonlyMap<string, string> = new Map(AREAS.map((a) => [a.slug, a.name]));

export function isAreaSlug(value: unknown): value is AreaSlug {
  return typeof value === 'string' && AREA_NAMES.has(value);
}

export function areaName(slug: AreaSlug): string {
  return AREA_NAMES.get(slug)!;
}

export const VENUE_TYPES = ['kafic', 'knjiznica', 'cetvrt', 'udruga', 'zet', 'ostalo'] as const satisfies readonly VenueType[];
type MissingVenue = Exclude<VenueType, (typeof VENUE_TYPES)[number]>;
const _everyVenueListed: MissingVenue extends never ? true : never = true;
void _everyVenueListed;

export function isVenueType(value: unknown): value is VenueType {
  return typeof value === 'string' && (VENUE_TYPES as readonly string[]).includes(value);
}
