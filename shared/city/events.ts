import type { FeedItem } from '../../worker/feed/schema';
import type { Place } from './types';
import { located, normalName, distanceM } from './geo';
export type ActivityWindow = 'week' | 'today' | 'tomorrow';
export interface LocatedEvent {
  key: string;
  item: FeedItem;
  venueIds: string[];
  location: 'verified' | 'multiple' | 'unlocated';
  ongoing: boolean;
  sources: FeedItem[];
}
export interface ActiveVenue { place: Place; events: LocatedEvent[]; count: number; ongoing: number }
/** Reviewed names/tags, resolved against the source's own URL or name.
 * These are aliases, not coordinates. Exact matches only, never edit-distance.
 */
const ALIASES = [
  { aliases: ['dokukino kic', 'dokukinu kic', 'dokukina kic'], names: ['dokukino', 'kic'], host: 'kic.hr' },
  { aliases: ['gavella', 'gavelli', 'gdk gavella'], names: ['gavella'], host: 'gavella.hr' },
  { aliases: ['kino tuskanac', 'kinu tuskanac'], names: ['tuskanac'], host: 'kinotuskanac.hr' },
  { aliases: ['kino kinoteka', 'kinu kinoteka'], names: ['kinoteka'], host: 'kinokinoteka.hr' },
  { aliases: ['etnografski muzej', 'etnografskom muzeju'], names: ['etnografski'], host: 'emz.hr' },
  { aliases: ['muzej suvremene umjetnosti', 'muzeju suvremene umjetnosti', 'msu'], names: ['suvremene umjetnosti'], host: 'msu.hr' },
  { aliases: ['galerija klovicevi dvori', 'klovicevim dvorima'], names: ['klovicevi'], host: 'gkd.hr' },
  { aliases: ['mama', 'multimedijalni institut'], names: ['multimedijalni institut'], host: 'mi2.hr' },
  { aliases: ['mocvara', 'mocvari'], names: ['mocvara'], host: 'mochvara.hr' },
];
const wordsContain = (hay: string, needle: string) => (` ${hay} `).includes(` ${needle} `);
export function resolveVenues(item: FeedItem, places: readonly Place[]): string[] {
  const direct = normalName(String(item.data?.venue ?? ''));
  const hints = normalName(String(item.data?.venueHint ?? ''));
  if (item.data?.city && normalName(String(item.data.city)) !== 'zagreb') return [];
  const venues = places.filter(p => p.category === 'culture' && located(p));
  const found = new Set<string>();
  if (direct) {
    const exact = venues.filter(p => normalName(p.name) === direct);
    if (exact.length === 1) found.add(exact[0].id);
  }
  for (const spec of ALIASES) {
    // Topic tags can name the organiser or a former venue. Only location
    // evidence in the source may put this event on a particular map pin.
    if (!spec.aliases.some(a => wordsContain(direct, a) || wordsContain(hints, a))) continue;
    let candidates = venues.filter(p => spec.names.some(name => wordsContain(normalName(p.name), name)));
    // A website alone can identify a whole institution with several branches.
    // Prefer its exact matching named record and never select the first branch.
    if (!candidates.length) candidates = venues.filter(p => p.website?.includes(spec.host));
    if (candidates.length === 1) found.add(candidates[0].id);
  }
  for (const p of venues) {
    const name = normalName(p.name);
    if (name.length >= 12 && wordsContain(hints, name)) {
      const same = venues.filter(v => normalName(v.name) === name);
      if (same.length === 1) found.add(p.id);
    }
  }
  return [...found];
}
export function dayKey(value: number | string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Zagreb', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
}
export function eventInWindow(item: FeedItem, now: number, window: ActivityWindow): boolean {
  if (!item.at || item.dateBasis !== 'event' || !Number.isFinite(Date.parse(item.at))) return false;
  const start = Date.parse(item.at), end = item.until ? Date.parse(item.until) : start;
  const allDay = item.data?.precision === 'day' || item.data?.precision === 'range';
  if (Number.isFinite(end) && end < now && !(allDay && dayKey(end) === dayKey(now))) return false;
  const currentDay = dayKey(now);
  const offsetDay = (days: number) => new Date(Date.parse(currentDay + 'T12:00:00Z') + days * 86400000).toISOString().slice(0, 10);
  const first = window === 'tomorrow' ? offsetDay(1) : currentDay;
  const last = window === 'week' ? offsetDay(6) : first;
  return dayKey(start) <= last && dayKey(Number.isFinite(end) ? end : start) >= first;
}
export function locatedEvents(items: readonly FeedItem[], places: readonly Place[], now: number, window: ActivityWindow = 'week'): LocatedEvent[] {
  const result: LocatedEvent[] = [];
  const byIdentity = new Map<string, LocatedEvent>();
  for (const item of items) {
    if (!['kulturpunkt', 'etnografski', 'kvartovske'].includes(String(item.data?.source)) || !eventInWindow(item, now, window)) continue;
    const venueIds = resolveVenues(item, places);
    // Only collapse independent announcements when title, start and verified
    // venue all agree. Similar names alone are not duplicate evidence.
    const key = venueIds.length ? `${normalName(item.title)}|${item.at}|${venueIds.slice().sort()}` : `${item.module}:${item.id}`;
    const previous = byIdentity.get(key);
    if (previous) { previous.sources.push(item); continue; }
    const event: LocatedEvent = { key, item, venueIds, location: venueIds.length === 1 ? 'verified' : venueIds.length > 1 ? 'multiple' : 'unlocated',
      ongoing: Date.parse(item.at!) < now && Boolean(item.until && Date.parse(item.until) >= now), sources: [item] };
    result.push(event); byIdentity.set(key, event);
  }
  return result.sort((a, b) => Number(a.ongoing) - Number(b.ongoing) || Date.parse(a.item.at!) - Date.parse(b.item.at!));
}
/** The agenda retains unlocated and later events, sharing only the map's
 * strict title/start/verified-venue duplicate rule. */
export function deduplicateEvents(items: readonly FeedItem[], places: readonly Place[]): FeedItem[] {
  const seen=new Set<string>();
  return items.filter(item=>{
    const ids=resolveVenues(item,places);
    if(!item.at||!ids.length)return true;
    const key=`${normalName(item.title)}|${item.at}|${ids.sort()}`;
    if(seen.has(key))return false;
    seen.add(key);return true;
  });
}
export function activeVenues(events: readonly LocatedEvent[], places: readonly Place[]): ActiveVenue[] {
  return places.filter(located).flatMap(place => {
    const at = events.filter(e => e.venueIds.includes(place.id));
    return at.length ? [{ place, events: at, count: at.length, ongoing: at.filter(e => e.ongoing).length }] : [];
  });
}
/** Exact source duplicates only. Co-located institutions retain their identity. */
export function canonicalPlaces(places: readonly Place[]): Place[] {
  const result: Place[] = [];
  const ids = new Set<string>();
  for (const place of places) {
    if (ids.has(place.id)) continue;
    ids.add(place.id);
    if (place.sourceId === 'drinking-water' && located(place)) {
      const same = places.some(p => p.sourceId === 'water' && located(p) && distanceM(p, place) < 8);
      if (same) continue;
    }
    result.push(place);
  }
  return result;
}
