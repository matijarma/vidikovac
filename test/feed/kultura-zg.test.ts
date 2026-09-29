// worker/feed/modules/kultura-zg.ts against the saved response of kultura.zagreb.hr (U3, M2):
// test/fixtures/kultura-zagreb-events.json, the first 150 of the 1,000 rows served on 29 Sep 2026,
// read under the owner's ruling O-70. The fixture keeps the descriptions on purpose, so this test can
// prove the module never reads them.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { FetchContext } from '../../worker/feed/schema';
import { DATA_KEYS } from '../../worker/feed/schema';
import { KULTURA_ZG_URL, fetchKulturaZg, parseKulturaZg } from '../../worker/feed/modules/kultura-zg';
import { U3_FIXTURE_NOW } from './fixture-contexts';

interface Row extends Record<string, unknown> {
  occurrence_id: string;
  occurrence_start: string;
  occurrence_end: string;
  type: string;
  event_description: string;
  organisation_description: string;
  contact_mail: string;
}
const fixture = JSON.parse(readFileSync(new URL('../fixtures/kultura-zagreb-events.json', import.meta.url), 'utf8')) as { events: Row[] };
const NOW = U3_FIXTURE_NOW;

function contextFor(body: unknown, requested: string[] = []): FetchContext {
  return {
    now: () => NOW,
    fetch: async (url) => {
      requested.push(url);
      return new Response(JSON.stringify(body));
    },
  };
}

const byId = (payload: ReturnType<typeof parseKulturaZg>, occurrence: string) =>
  payload.items.find((item) => item.id === `kultura-zg:${occurrence}`)!;

describe('kultura-zg on the saved response', () => {
  it('reads the one URL O-70 opens and turns the 150 rows into 150 events', async () => {
    const requested: string[] = [];
    const payload = await fetchKulturaZg(contextFor(fixture, requested));
    expect(requested).toEqual([KULTURA_ZG_URL]);
    expect(KULTURA_ZG_URL).toBe('https://kultura.zagreb.hr/api/chatbot/events');
    expect(payload.items).toHaveLength(150);
    expect(payload.coverage).toEqual({ shown: 150, total: 150, limited: false });
    for (const item of payload.items) {
      expect(item.kind).toBe('event');
      expect(item.dateBasis).toBe('event');
      expect(item.id).toMatch(/^kultura-zg:[0-9a-f-]{36}$/);
      expect(item.geo?.type).toBe('Point');
      expect(item.data?.source).toBe('kultura-zagreb');
      expect(item.data?.district, item.id).toBeTruthy();
      for (const key of Object.keys(item.data!)) expect(DATA_KEYS.event, key).toContain(key);
    }
    // In order of start.
    const starts = payload.items.map((item) => Date.parse(item.at!));
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
  });

  it('turns the source\'s local times into instants: 20:00 on 29 September is 18:00 UTC in summer time', () => {
    const payload = parseKulturaZg(fixture, NOW);
    const evening = fixture.events.find((row) => row.occurrence_start === '2026-09-29T20:00:00')!;
    const item = byId(payload, evening.occurrence_id);
    expect(item.at).toBe('2026-09-29T18:00:00.000Z');
    expect(Date.parse(item.until!)).toBeGreaterThan(Date.parse(item.at!));
  });

  it('gives a listing day precision when its window is six hours or more, and the clock otherwise, an exhibition too', () => {
    const payload = parseKulturaZg(fixture, NOW);
    const exhibitions = fixture.events.filter((row) => row.type === 'Izložba');
    expect(exhibitions).toHaveLength(104);
    const hours = (row: Row): number => (Date.parse(row.occurrence_end) - Date.parse(row.occurrence_start)) / 3_600_000;
    for (const row of exhibitions) {
      const item = byId(payload, row.occurrence_id);
      expect(item.data?.precision, item.title).toBe(hours(row) >= 6 ? 'day' : 'time');
      expect(item.data?.category).toBe('izlozba');
    }
    // Measured on the saved response: 89 exhibitions open a day or more, 15 shorter (openings, evening hours).
    expect(exhibitions.filter((row) => hours(row) < 6)).toHaveLength(15);
    const precisions = new Map<string, number>();
    for (const item of payload.items) precisions.set(String(item.data?.precision), (precisions.get(String(item.data?.precision)) ?? 0) + 1);
    // 89 exhibitions and the one workshop that runs 08:00 to 20:00; the other 60 are on the clock.
    expect(Object.fromEntries(precisions)).toEqual({ day: 90, time: 60 });
    // Round 1 desktop F4: an opening typed Izložba at 20:00 until 21:00 is at 20:00, not "cijeli dan".
    const opening = byId(payload, '60e7e54a-d5a1-42c3-ace8-36e10710641a');
    expect(opening.title).toBe('Otvorenje izložbe Vladimira Novaka: Možda ništa');
    expect(opening.at).toBe('2026-09-30T18:00:00.000Z');
    expect(opening.data).toMatchObject({ category: 'izlozba', precision: 'time' });
    const workshop = byId(payload, '6b0f0a0f-15df-40d1-8c6c-6039aebe9b4f');
    expect(workshop.data).toMatchObject({ category: 'radionica', precision: 'day' });
    const play = byId(payload, 'cc9c63cf-c971-4682-83fe-5a0b2b52260c');
    expect(play.data).toMatchObject({ category: 'izvedba', precision: 'time' });
    const film = byId(payload, '76637e83-d008-49b6-a641-28fef535ebea');
    expect(film.data).toMatchObject({ category: 'film', precision: 'time' });
    // A window from midnight to 23:59 is a day, whatever the type.
    const doctored = structuredClone(fixture);
    Object.assign(doctored.events[0]!, { type: 'Razno', occurrence_start: '2026-09-30T00:00:00', occurrence_end: '2026-09-30T23:59:00' });
    expect(byId(parseKulturaZg(doctored, NOW), doctored.events[0]!.occurrence_id).data).toMatchObject({ category: 'ostalo', precision: 'day' });
    // An exhibition the source gives no end is a day's listing; any other type without an end is on the clock.
    const open = structuredClone(fixture);
    Object.assign(open.events[0]!, { type: 'Izložba', occurrence_start: '2026-09-30T20:00:00', occurrence_end: null });
    Object.assign(open.events[1]!, { type: 'Koncert', occurrence_start: '2026-09-30T20:00:00', occurrence_end: null });
    const parsed = parseKulturaZg(open, NOW);
    expect(byId(parsed, open.events[0]!.occurrence_id).data?.precision).toBe('day');
    expect(byId(parsed, open.events[1]!.occurrence_id).data?.precision).toBe('time');
  });

  it('names the venue as a reader finds it: the hall the address names, else the organisation, never an entrance or a seat (round 1 desktop F6)', () => {
    const payload = parseKulturaZg(fixture, NOW);
    const venues = new Set(payload.items.map((item) => String(item.data?.venue)));
    for (const label of ['Ulaz za gledatelje', 'Sjedište Organizacije', 'Sjedište Gavelle', 'Muzej', 'Zbirka', 'Trg Narodne zaštite 2', 'Ulica Gjure Čanića 6']) {
      expect(venues.has(label), label).toBe(false);
    }
    // The puppet theatre's entrance label gives way to the theatre's name; a named hall of an organisation stays itself.
    expect(byId(payload, 'a839db8f-a68d-426f-97c7-e6139af2e827').data).toMatchObject({ venue: 'Zagrebačko kazalište lutaka', organiser: 'Zagrebačko kazalište lutaka' });
    const kinoteka = payload.items.find((item) => item.data?.organiser === 'Centar za kulturu i film Augusta Cesarca' && item.data?.venue === 'Kino Kinoteka');
    expect(kinoteka).toBeDefined();
    expect(venues.has('Knjižnica Prečko')).toBe(true);
    expect(venues.has('Tehnički muzej Nikola Tesla')).toBe(true);
    expect(venues.has('Gradsko kazalište Trešnja')).toBe(true);
    // Every item names a venue: the fixture has an address label or an organisation on every row.
    for (const item of payload.items) expect(item.data?.venue, item.id).toBeTruthy();
  });

  it('carries the venue, the organiser, the district and the kids flag, and the flag only when the source states it', () => {
    const payload = parseKulturaZg(fixture, NOW);
    const first = payload.items.find((item) => item.title === 'Dragutin Domjanić - Stoljeće i pol')!;
    expect(first.data).toMatchObject({ venue: 'Muzej Prigorja', organiser: 'Muzej Prigorja', district: 'sesvete', kids: true });
    expect(first.geo?.coordinates).toEqual([16.1099736, 45.8262681]);
    const withKids = payload.items.filter((item) => typeof item.data?.kids === 'boolean').length;
    const unstated = fixture.events.filter((row) => row.kids === null).length;
    expect(unstated).toBe(14);
    expect(withKids).toBe(150 - unstated);
  });

  it('builds the link from the occurrence slug and from nothing else', () => {
    const payload = parseKulturaZg(fixture, NOW);
    const first = payload.items.find((item) => item.title === 'Dragutin Domjanić - Stoljeće i pol')!;
    expect(first.link).toBe('https://kultura.zagreb.hr/dogadanja/dragutin-domjanic-stoljece-i-pol-29-09-2026-02-00');
    for (const item of payload.items) expect(item.link, item.id).toMatch(/^https:\/\/kultura\.zagreb\.hr\/dogadanja\/[a-z0-9-]+$/);
    const doctored = structuredClone(fixture);
    doctored.events[0]!.occurrence_slug = '../../admin?x=1';
    expect(parseKulturaZg(doctored, NOW).items.find((item) => item.id === `kultura-zg:${doctored.events[0]!.occurrence_id}`)!.link).toBeUndefined();
  });

  it('never reads a description or a contact: none of them reaches an item', () => {
    // Real descriptions and (redacted) contacts are in the fixture; add marks that cannot occur by chance.
    const doctored = structuredClone(fixture);
    for (const row of doctored.events) {
      row.event_description = 'OPIS-NE-SMIJE-PROCI';
      row.organisation_description = 'OPIS-ORGANIZACIJE-NE-SMIJE-PROCI';
      row.contact_mail = 'kontakt-ne-smije-proci@example.invalid';
      row.event_image = 'https://slika.example.invalid/x.webp';
    }
    const payload = parseKulturaZg(doctored, NOW);
    const written = JSON.stringify(payload);
    for (const mark of ['NE-SMIJE-PROCI', 'example.invalid', 'kontakt', 'event_description', 'contact_mail', 'organisation_description']) {
      expect(written, mark).not.toContain(mark);
    }
    for (const item of payload.items) {
      expect(item.summary).toBeUndefined();
      expect(Object.keys(item).sort()).toEqual(['at', 'data', 'dateBasis', 'geo', 'id', 'kind', 'link', 'title', 'until'].filter((key) => key in item).sort());
    }
    // The saved response carries real descriptions; the parsed events hold no sentence of them.
    const described = fixture.events.filter((row) => row.event_description.length > 60);
    expect(described.length).toBeGreaterThan(50);
    const plain = JSON.stringify(parseKulturaZg(fixture, NOW));
    for (const row of described) expect(plain).not.toContain(row.event_description.slice(0, 60));
  });

  it('keeps what is not over before today began and starts within eight days, at most 300', () => {
    const doctored = structuredClone(fixture);
    const [past, over, far, near] = doctored.events;
    Object.assign(past!, { occurrence_start: '2026-09-28T10:00:00', occurrence_end: '2026-09-28T12:00:00' });
    Object.assign(over!, { occurrence_start: '2026-09-28T22:00:00', occurrence_end: '2026-09-29T00:00:00' });
    Object.assign(far!, { occurrence_start: '2026-10-07T00:00:00', occurrence_end: '2026-10-07T23:59:00' });
    Object.assign(near!, { occurrence_start: '2026-10-06T23:00:00', occurrence_end: '2026-10-07T01:00:00' });
    const ids = new Set(parseKulturaZg(doctored, NOW).items.map((item) => item.id));
    expect(ids.has(`kultura-zg:${past!.occurrence_id}`)).toBe(false);
    // Ended at midnight sharp: its end is today 00:00, which is not before today began.
    expect(ids.has(`kultura-zg:${over!.occurrence_id}`)).toBe(true);
    // Eight days after 29 September 00:00 is 7 October 00:00: a start at that instant is out, one hour before it is in.
    expect(ids.has(`kultura-zg:${far!.occurrence_id}`)).toBe(false);
    expect(ids.has(`kultura-zg:${near!.occurrence_id}`)).toBe(true);
  });

  it('says the list is cut at the server\'s cap: limited is false at 150 rows and true at 1,000', () => {
    expect(parseKulturaZg(fixture, NOW).coverage).toEqual({ shown: 150, total: 150, limited: false });
    const thousand: Row[] = [];
    for (let i = 0; i < 1000; i += 1) {
      const row = structuredClone(fixture.events[i % 150]!);
      row.occurrence_id = `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
      thousand.push(row);
    }
    const payload = parseKulturaZg({ events: thousand }, NOW);
    expect(payload.coverage).toEqual({ shown: 300, total: 1000, limited: true });
    expect(payload.items).toHaveLength(300);
    const almost = parseKulturaZg({ events: thousand.slice(0, 999) }, NOW).coverage;
    expect(almost).toMatchObject({ total: 999, limited: false });
  });

  it('refuses a foreign shape instead of showing nothing', () => {
    expect(() => parseKulturaZg({}, NOW)).toThrow(/shape/);
    expect(() => parseKulturaZg([], NOW)).toThrow(/shape/);
    expect(() => parseKulturaZg({ events: 'nema' }, NOW)).toThrow(/shape/);
    expect(() => parseKulturaZg(null, NOW)).toThrow(/shape/);
    for (const damage of [
      { occurrence_id: undefined },
      { occurrence_start: undefined },
      { occurrence_start: 'sutra u 18 sati' },
      { latitude: undefined },
      { longitude: null },
      { latitude: '45.8' },
    ]) {
      const doctored = structuredClone(fixture);
      Object.assign(doctored.events[3]!, damage);
      expect(() => parseKulturaZg(doctored, NOW), JSON.stringify(damage)).toThrow(/shape/);
    }
    // An empty list is a list.
    expect(parseKulturaZg({ events: [] }, NOW)).toMatchObject({ items: [], coverage: { shown: 0, total: 0, limited: false } });
  });
});
