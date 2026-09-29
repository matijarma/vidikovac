// shared/city/venues.ts: Kulturpunkt events placed at their venue through the City's culture register,
// the City's culture calendar and OpenStreetMap (docs/upgrade-2026-10-plan/U3.md O3). The 40 announcements
// of test/fixtures/dogadanja/kulturpunkt.json go through the module's own hint extractor; 22 name a Zagreb
// venue, 12 a venue in another city, 6 none (review.local/upgrade/plan/U3/notes.md). At least 10 of the 22
// must be placed, each within 300 m of its venue; none of the other 18 may be.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { FeedItem, ModuleId } from '../../worker/feed/schema';
import type { Place } from '../../shared/city/types';
import { eventLocation } from '../../worker/city/event-location';
import { decodeEntities, stripTags } from '../../worker/feed/html';
import { decodeOsmHours, osmVenues } from '../../shared/city/osm-hours';
import { buildGazetteer, resolveVenuePoint } from '../../shared/city/venues';
import { resolveVenues } from '../../shared/city/events';
import { distanceM } from '../../shared/city/geo';

const read = (path: string) => JSON.parse(readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8'));

interface KulturpunktRow { id: number; title: { rendered: string }; excerpt: { rendered: string }; class_list?: string[] }
const announcements: FeedItem[] = (read('test/fixtures/dogadanja/kulturpunkt.json') as KulturpunktRow[]).map((row) => ({
  id: `kulturpunkt:${row.id}`, module: 'dogadanja', kind: 'event', tier: 'session',
  title: decodeEntities(stripTags(row.title.rendered)),
  data: { source: 'kulturpunkt', ...eventLocation(decodeEntities(stripTags(row.excerpt.rendered)), row.class_list ?? []) },
}));

/** The City's culture register as the catalogue ships it. */
const manifest = read('app/public/data/city/manifest.json') as { sources: { id: string; chunks: { hash: string }[] }[] };
const places: Place[] = manifest.sources.filter((s) => s.id === 'culture')
  .flatMap((s) => s.chunks.flatMap((c) => (read(`app/public/data/city/chunks/${c.hash}.json`) as { data: { places: Place[] } }).data.places));

/** kultura-zg items as the wire contract carries them (U3.md §0.2(a)): the venue name and the row's point. */
interface KulturaRow { occurrence_id: number; event_name: string; address_name: string; longitude: number; latitude: number }
const kultura: FeedItem[] = (read('test/fixtures/kultura-zagreb-events.json') as { events: KulturaRow[] }).events.map((row) => ({
  id: `kultura-zg:${row.occurrence_id}`, module: 'kultura-zg' as ModuleId, kind: 'event', tier: 'session', title: row.event_name,
  geo: { type: 'Point', coordinates: [row.longitude, row.latitude] }, data: { source: 'kultura-zagreb', venue: row.address_name },
}));

const osm = osmVenues(decodeOsmHours(read('app/public/data/osm-hours.json')));
const gazetteer = buildGazetteer({ places, kultura, osm });

const point = (list: readonly { name: string; lon?: number; lat?: number }[], name: string) => {
  const hit = list.find((p) => p.name === name);
  if (!hit || hit.lon === undefined || hit.lat === undefined) throw new Error(`no point for ${name}`);
  return { lon: hit.lon, lat: hit.lat };
};
const calendar = (name: string) => {
  const row = kultura.find((k) => String(k.data?.venue).trim() === name);
  if (!row) throw new Error(`no calendar venue ${name}`);
  const [lon, lat] = row.geo!.coordinates as number[];
  return { lon, lat };
};

/**
 * The 22 announcements that name a Zagreb venue, with that venue's point where one is on record (the
 * calendar's own point, the register's, or OpenStreetMap's). null: no point on record here, so the
 * resolver must leave the event unplaced (a placement could not be judged).
 */
const ZAGREB: Record<number, { venue: string; at: { lon: number; lat: number } | null }> = {
  85612: { venue: 'MSU (tag)', at: calendar('Muzej Suvremene Umjetnosti') },
  85606: { venue: 'plato ispred MSU', at: calendar('Muzej Suvremene Umjetnosti') },
  85599: { venue: 'Spomen-park Dotrščina', at: null },
  85565: { venue: 'Mala dvorana Pogona Jedinstvo', at: calendar('POGON JEDINSTVO') },
  85562: { venue: '"plesni centar" (vague)', at: null },
  85509: { venue: 'Galerija Bernardo Bernardi (POU)', at: point(places, 'Pučko otvoreno učilište - Galerija Bernardo Bernardi') },
  85502: { venue: 'Staklena soba', at: null },
  85493: { venue: 'Radiona', at: null },
  85491: { venue: 'dvorište Pogona Jedinstvo', at: calendar('POGON JEDINSTVO') },
  85489: { venue: 'galerija Cvajner, ALU', at: null },
  85486: { venue: 'Goethe-Institut, Zadarska 80', at: null },
  85480: { venue: 'Kino u dvorištu (tag)', at: null },
  85478: { venue: 'Velika dvorana Pogona Jedinstvo', at: calendar('POGON JEDINSTVO') },
  85474: { venue: 'Močvara (tag)', at: calendar('Klub Močvara') },
  85472: { venue: 'CeKaTe', at: calendar('Centar za kulturu Trešnjevka (CeKaTe)') },
  85468: { venue: 'MaMi', at: null },
  85465: { venue: 'Garaža Kamba, Ilica 37', at: null },
  85407: { venue: 'Kino Tuškanac (tag)', at: point(places, 'Kino Tuškanac') },
  85401: { venue: 'ZPC', at: point(osm, 'Zagrebački plesni centar') },
  85382: { venue: 'KunstTeatar', at: point(osm, 'KunstTeatar') },
  85379: { venue: 'Kućno kino Ribnjak', at: point(places, 'Centar mladih Ribnjak') },
  85376: { venue: 'LiberSPACE', at: null },
};
/** Split (3), Pula (3), Rijeka (2), Dubrovnik and Lazareti (3), Korčula. */
const ELSEWHERE = [85608, 85603, 85533, 85601, 85470, 85353, 85503, 85405, 85557, 85373, 85301, 85463];
const NO_VENUE = [85560, 85553, 85550, 85500, 85378, 85325];

const byId = (id: number) => {
  const item = announcements.find((a) => a.id === `kulturpunkt:${id}`);
  if (!item) throw new Error(`kulturpunkt:${id} missing`);
  return item;
};

describe('Kulturpunkt venues through the three gazetteers', () => {
  it('covers the whole fixture: 22 Zagreb venues, 12 elsewhere, 6 none', () => {
    expect(announcements).toHaveLength(40);
    expect(Object.keys(ZAGREB).length + ELSEWHERE.length + NO_VENUE.length).toBe(40);
    expect(gazetteer.size).toBeGreaterThan(1_000);
  });

  it('places at least 10 of the 22, each within 300 m of its venue', () => {
    const placed: string[] = [];
    for (const [id, { venue, at }] of Object.entries(ZAGREB)) {
      const got = resolveVenuePoint(byId(Number(id)), gazetteer);
      if (!got) continue;
      expect(at, `${id} ${venue} placed without a venue point on record`).not.toBeNull();
      expect(distanceM(got, at!), `${id} ${venue}`).toBeLessThanOrEqual(300);
      placed.push(venue);
    }
    expect(placed.length).toBeGreaterThanOrEqual(10);
    // The register's exact resolver alone places none of them: the hints are inflected.
    expect(announcements.filter((a) => resolveVenues(a, places).length > 0)).toHaveLength(0);
  });

  it('places none of the 12 in other cities and none of the 6 without a venue', () => {
    for (const id of [...ELSEWHERE, ...NO_VENUE]) expect(resolveVenuePoint(byId(id), gazetteer), String(id)).toBeNull();
  });
});

describe('what counts as evidence', () => {
  const at = (lon: number, lat: number) => ({ lon, lat });
  const hint = (data: Record<string, string>): FeedItem => ({ id: 'x', module: 'dogadanja', kind: 'event', tier: 'session', title: 'x', data: { source: 'kulturpunkt', ...data } });
  const g = buildGazetteer({ places: [], kultura: [], osm: [
    { name: 'Galerija', ...at(15.97, 45.81) },
    { name: 'Knežija', ...at(15.946, 45.793) },
    { name: 'Dvorana Kvart', ...at(15.96, 45.80) },
    { name: 'Dvorana Kvart', ...at(15.99, 45.80) },
    { name: 'Tvornica kulture', ...at(15.97, 45.80) },
  ] });

  it('never a generic name, and a one-word name only as a whole venue, tag or leading name', () => {
    expect(resolveVenuePoint(hint({ venueHint: 'Galeriji' }), g)).toBeNull();
    expect(resolveVenuePoint(hint({ venueHint: 'svom prostoru na zagrebačkoj Knežiji' }), g)).toBeNull();
    expect(resolveVenuePoint(hint({ venueTags: 'knezija' }), g)).toEqual(at(15.946, 45.793));
    expect(resolveVenuePoint(hint({ venueHint: 'Tvornici kulture od 20 sati' }), g)).toEqual(at(15.97, 45.8));
  });

  it('two points 150 m or more apart leave the event unplaced; another city too', () => {
    expect(resolveVenuePoint(hint({ venueHint: 'Dvorani Kvart' }), g)).toBeNull();
    expect(resolveVenuePoint(hint({ venueHint: 'Tvornici kulture u Splitu' }), g)).toBeNull();
    expect(resolveVenuePoint(hint({ venueHint: 'Tvornici kulture', city: 'Rijeci' }), g)).toBeNull();
    expect(resolveVenuePoint(hint({ venueHint: 'Tvornici kulture u Zadarskoj 80' }), g)).toEqual(at(15.97, 45.8));
  });
});
