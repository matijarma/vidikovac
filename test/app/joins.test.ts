// The three joins of the facts-breadth package (docs/upgrade-2026-10-plan/U3.md S5, app/src/city/joins.ts): J2 the
// last tram after an event, J3 the nearest empty BAJS station beside one with bikes, and both as the header says them
// (city/sentence.ts sentenceFacts). J1 is the rain row's own fact (test/app/kiosk-sentence.test.ts).
import { describe, expect, it } from 'vitest';
import { bikesEmpty, eventLastTram, EVENT_LAST_TRAM_MS, joinFacts } from '../../app/src/city/joins';
import type { NearbyRow } from '../../app/src/city/nearby';
import { sentenceFacts, type SentenceFactsInput } from '../../app/src/city/sentence';
import { createDefaultI18n } from '../../app/src/i18n/create-default-i18n';
import { emptyCity, type CityLive, type Place } from '../../shared/city/types';

const i18n = createDefaultI18n('hr');
const at = (iso: string): number => Date.parse(iso);
const MIN = 60_000;
const PLACE = { kind: 'tram' as const, name: 'Trg bana J. Jelačića', lon: 15.97726, lat: 45.81286, stopId: '106_1' };

const event = (id: string, start: string, end?: string, title = 'Koncert na Zrinjevcu'): NearbyRow => ({
  id: `event:${id}`, kind: 'event', atMs: at(start), ...(end ? { untilMs: at(end) } : {}), always: false, title, sub: 'Zrinjevac',
  live: false, source: 'kultura-zg',
});
const lastTrams = (services: readonly [route: string, time: string][]): NearbyRow => ({
  id: 'last:2026-09-22', kind: 'last', atMs: at(services[0]![1]), always: false, title: 'Zadnji tramvaji', sub: '', live: false, source: 'zet-gtfs',
  services: services.map(([route, time]) => ({ routeId: route, routeName: route, atMs: at(time) })),
});
const LAST = lastTrams([['12', '2026-09-22T23:45:00+02:00'], ['6', '2026-09-22T23:52:00+02:00'], ['11', '2026-09-23T00:09:00+02:00']]);

describe('J2: the last tram after an event', () => {
  const NOW = at('2026-09-22T20:30:00+02:00');
  it('offers the line that leaves soonest at or after the event ends, within 45 minutes', () => {
    const concert = event('a', '2026-09-22T21:00:00+02:00', '2026-09-22T23:30:00+02:00');
    expect(eventLastTram([concert, LAST], NOW)).toEqual({ event: concert, routeId: '12', route: '12', atMs: at('2026-09-22T23:45:00+02:00') });
    expect(EVENT_LAST_TRAM_MS).toBe(45 * MIN);
  });

  it('never offers a tram that leaves before the event ends, and nothing past 45 minutes after it', () => {
    // The 12 (23:45) leaves before the end at 23:50; the 6 at 23:52 is the one.
    expect(eventLastTram([event('b', '2026-09-22T21:00:00+02:00', '2026-09-22T23:50:00+02:00'), LAST], NOW)?.route).toBe('6');
    // Ends at 22:30: the soonest last tram, 23:45, is 75 minutes on.
    expect(eventLastTram([event('c', '2026-09-22T21:00:00+02:00', '2026-09-22T22:30:00+02:00'), LAST], NOW)).toBeNull();
    // Ends after every last tram.
    expect(eventLastTram([event('d', '2026-09-22T22:00:00+02:00', '2026-09-23T00:30:00+02:00'), LAST], NOW)).toBeNull();
  });

  it('reads only the soonest timed event today that has an end', () => {
    const noEnd = event('e', '2026-09-22T20:45:00+02:00');
    const concert = event('f', '2026-09-22T21:00:00+02:00', '2026-09-22T23:30:00+02:00');
    expect(eventLastTram([noEnd, concert, LAST], NOW)?.event.id).toBe('event:f');
    // The soonest with an end decides, even when a later one would fit.
    expect(eventLastTram([event('g', '2026-09-22T20:50:00+02:00', '2026-09-22T21:30:00+02:00'), concert, LAST], NOW)).toBeNull();
    // Tomorrow's event is not tonight's.
    expect(eventLastTram([event('h', '2026-09-23T21:00:00+02:00', '2026-09-23T23:30:00+02:00'), LAST], NOW)).toBeNull();
    expect(eventLastTram([concert], NOW)).toBeNull();
  });
});

describe('J3: the nearest BAJS station is empty', () => {
  const NOW = at('2026-09-22T12:30:00+02:00');
  const station = (id: string, name: string, lon: number, lat: number, bikes: number, extra: Partial<Place['facts']> = {}): Place => ({
    id, category: 'cycle-parking', name, lon, lat, sourceId: 'bajs', sourceRecord: id, updatedAt: new Date(NOW - MIN).toISOString(),
    facts: { fresh: true, operational: true, bikes, ...extra },
  });
  const TRG = station('bajs-trg', 'BAJS Trg bana Jelačića', 15.9775, 45.8127, 0);
  const CVJETNI = station('bajs-cvjetni', 'BAJS Cvjetni trg', 15.9745, 45.8115, 7);
  const DOLAC = station('bajs-dolac', 'BAJS Dolac', 15.9768, 45.8145, 3);

  it('names the nearest station with bikes beside the empty nearest one', () => {
    expect(bikesEmpty([CVJETNI, TRG, DOLAC], PLACE, 2000)).toMatchObject({ empty: { place: { id: 'bajs-trg' }, bikes: 0 }, other: { place: { id: 'bajs-dolac' }, bikes: 3 } });
  });

  it('says nothing when the nearest has bikes, when none has, or when the nearest is not fresh or not operational', () => {
    expect(bikesEmpty([{ ...TRG, facts: { ...TRG.facts, bikes: 2 } }, CVJETNI], PLACE, 2000)).toBeNull();
    expect(bikesEmpty([TRG, { ...CVJETNI, facts: { ...CVJETNI.facts, bikes: 0 } }], PLACE, 2000)).toBeNull();
    expect(bikesEmpty([station('bajs-trg', 'BAJS Trg bana Jelačića', 15.9775, 45.8127, 0, { fresh: false }), CVJETNI], PLACE, 2000)).toBeNull();
    // Outside the circle a station with bikes is no answer.
    expect(bikesEmpty([TRG, station('bajs-far', 'BAJS Sesvete', 16.11, 45.83, 9)], PLACE, 2000)).toBeNull();
    expect(joinFacts({ rows: [], places: [TRG, CVJETNI], place: PLACE, now: NOW }).bikesEmpty).toBeNull();
  });

  it('the header says both stations and leaves the plain bikes fact out that tick', () => {
    const live: CityLive = { schema: 1, generatedAt: new Date(NOW - MIN).toISOString(), air: [], consultations: [],
      sources: [{ id: 'bajs', name: 'BAJS', url: 'https://example.test/', licence: 'Fixture', status: 'live', count: 2 }],
      bikes: [TRG, CVJETNI].map((p) => ({ id: p.sourceRecord, name: p.name, lon: p.lon!, lat: p.lat!, bikes: p.facts!.bikes as number, docks: 10, capacity: 20,
        installed: true, renting: true, returning: true, observedAt: p.updatedAt })) };
    const base: SentenceFactsInput = { place: PLACE, rows: [], snapshots: {}, city: { ...emptyCity(), live }, now: NOW, outage: false, locale: 'hr', i18n, radiusM: 2000 };
    const facts = sentenceFacts(base);
    const bikes = facts.filter((fact) => fact.kind === 'bicikli');
    expect(bikes.map((fact) => fact.text)).toEqual(['BAJS Trg bana Jelačića: 0 bicikala; BAJS Cvjetni trg: 7 bicikala.']);
  });
});

describe('J2 in the header', () => {
  it('is said in the family’s words: kultura before 20:00, noćas from 20:00', () => {
    const concert = event('a', '2026-09-22T21:00:00+02:00', '2026-09-22T23:30:00+02:00');
    const say = (now: number) => sentenceFacts({ place: PLACE, rows: [concert, LAST], snapshots: {}, city: emptyCity(), now, outage: false, locale: 'hr', i18n })
      .find((fact) => fact.id === 'event:a:lastTram:12');
    expect(say(at('2026-09-22T20:30:00+02:00'))).toMatchObject({ kind: 'nocas', text: 'Nakon „Koncert na Zrinjevcu” zadnji tramvaj 12 polazi u 23:45.' });
    expect(say(at('2026-09-22T19:30:00+02:00'))?.kind).toBe('kultura');
  });
});
