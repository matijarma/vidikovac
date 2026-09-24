// The city's own points on the wall's frame (app/src/city/curated.ts): every
// BAJS station a counted disc (grey "0", grey and blank when the count is not
// known, never "?"), a venue only with a programme tonight and named, the air
// stations only on request, and no geographic cluster anywhere.
import { describe, expect, it } from 'vitest';
import { bikeDisc, CURATED_WALL, curatedCityPoints } from '../../app/src/city/curated';
import { clusterPlaces, dynamicPlaces } from '../../app/src/city/discovery';
import { MAP_PRESENTATIONS } from '../../app/src/map/presentation';
import { emptyCity, type BikeStation, type CityState, type Place } from '../../shared/city/types';
import type { FeedItem } from '../../worker/feed/schema';

const NOW = Date.parse('2026-09-11T12:32:00Z'); // 14:32 in Zagreb
const ISO = new Date(NOW - 60_000).toISOString();
const zagreb = (hhmm: string, days = 0) => new Date(Date.parse(`2026-09-11T${hhmm}:00+02:00`) + days * 86_400_000).toISOString();
const station = (id: string, extra: Partial<BikeStation> = {}): BikeStation => ({
  id, name: `Stanica ${id}`, lon: 15.971, lat: 45.81, bikes: 7, docks: 5, capacity: 12,
  installed: true, renting: true, returning: true, observedAt: ISO, ...extra,
});
const CITY: CityState = {
  ...emptyCity(),
  places: [
    { id: 'culture-1', category: 'culture', name: 'Kino Europa', lon: 15.9738, lat: 45.8105, sourceId: 'culture', sourceRecord: '1' },
    { id: 'culture-2', category: 'culture', name: 'Mocvara', lon: 15.9611, lat: 45.8009, sourceId: 'culture', sourceRecord: '2' },
    { id: 'culture-3', category: 'culture', name: 'Nigdje', sourceId: 'culture', sourceRecord: '3' },
  ],
  live: {
    schema: 1 as never,
    generatedAt: ISO,
    sources: [
      { id: 'bajs', name: 'BAJS', url: 'https://example.test/', licence: 'x', status: 'live', count: 4 },
      { id: 'air', name: 'Zrak', url: 'https://example.test/', licence: 'x', status: 'live', count: 2 },
    ],
    bikes: [
      station('b1'),
      station('b2', { bikes: 0 }),
      station('b3', { renting: false }),
      station('b4', { bikes: null }),
    ],
    air: [
      { id: 'a1', name: 'Zagreb-1', lon: 15.97, lat: 45.8, index: 2, observedAt: ISO },
      { id: 'a2', name: 'Zagreb-2', lon: 15.98, lat: 45.8, index: 3, observedAt: new Date(NOW - 7 * 3_600_000).toISOString() },
    ],
    consultations: [],
  },
};
const show = (id: string, venue: string, at: string, until?: string): FeedItem => ({
  id: `kvartovske:${id}`, module: 'dogadanja', tier: 'open', kind: 'event', title: id, at, ...(until ? { until } : {}), dateBasis: 'event',
  data: { source: 'kvartovske', venue, precision: 'time' },
});
const EVENTS = [
  show('koncert', 'Kino Europa', zagreb('20:00')),
  show('matineja', 'Mocvara', zagreb('15:32')),
  show('sutra', 'Mocvara', zagreb('20:00', 1)),
  show('nigdje', 'Nigdje', zagreb('21:00')),
];

describe('a BAJS station’s disc', () => {
  const place = (facts: Place['facts']): Place => ({ id: 'bajs-x', category: 'cycle-parking', name: 'x', sourceId: 'bajs', sourceRecord: 'x', facts });
  it('says the count, a grey "0", or a grey disc without a number, and never "?" or "—"', () => {
    expect(bikeDisc(place({ bikes: 7, operational: true, fresh: true }))).toEqual({ badge: '7', spent: false });
    expect(bikeDisc(place({ bikes: 0, operational: true, fresh: true }))).toEqual({ badge: '0', spent: true });
    // Not renting, a quiet source, a count the source did not give, nothing at all.
    expect(bikeDisc(place({ bikes: 4, operational: false, fresh: true }))).toEqual({ badge: '', spent: true });
    expect(bikeDisc(place({ bikes: '?', operational: true, fresh: false }))).toEqual({ badge: '', spent: true });
    expect(bikeDisc(place({ bikes: '?', operational: true, fresh: true }))).toEqual({ badge: '', spent: true });
    expect(bikeDisc(place(undefined))).toEqual({ badge: '', spent: true });
    // The same rows dynamicPlaces() reads out of the live file.
    const discs = dynamicPlaces(CITY, NOW).filter((p) => p.sourceId === 'bajs').map(bikeDisc);
    expect(discs).toEqual([{ badge: '7', spent: false }, { badge: '0', spent: true }, { badge: '', spent: true }, { badge: '', spent: true }]);
  });
});

describe('the wall’s curated city points', () => {
  it('CURATED_WALL is tonight’s venues without the air stations', () => {
    expect(CURATED_WALL).toEqual({ venues: 'tonight', air: false });
    expect(Object.isFrozen(CURATED_WALL)).toBe(true);
  });

  it('draws every BAJS station counted and named, and a venue only with a programme tonight', () => {
    const points = curatedCityPoints(CITY, EVENTS, NOW);
    expect(points.map((p) => p.id)).toEqual(['bajs-b1', 'bajs-b2', 'bajs-b3', 'bajs-b4', 'culture-1']);
    expect(points.every((p) => p.place === 'city' && p.title !== '')).toBe(true);
    expect(points[0]).toEqual({ id: 'bajs-b1', title: 'Stanica b1', lon: 15.971, lat: 45.81, place: 'city', props: { category: 'bikes', badge: '7', spent: false, eventCount: 0, priority: 2 } });
    expect(points.find((p) => p.id === 'bajs-b2')!.props).toMatchObject({ badge: '0', spent: true });
    expect(points.find((p) => p.id === 'bajs-b3')!.props).toMatchObject({ badge: '', spent: true });
    // The 20:00 concert is tonight; the 15:32 matinee, tomorrow's show and a venue with no coordinates are not on the map.
    expect(points.find((p) => p.id === 'culture-1')).toEqual({ id: 'culture-1', title: 'Kino Europa', lon: 15.9738, lat: 45.8105, place: 'city', props: { category: 'culture', badge: '1', eventCount: 1, priority: 0 } });
    // No mark says "?", "—" or "+N", and none is a cluster.
    for (const p of points) {
      expect(String(p.props!.badge)).not.toMatch(/^[?—+]/);
      expect(p.props!.category).not.toBe('cluster');
    }
  });

  it('greys and blanks every station when the BAJS source is not live, and draws no venue without a programme', () => {
    const stale: CityState = { ...CITY, live: { ...CITY.live!, sources: CITY.live!.sources.map((s) => s.id === 'bajs' ? { ...s, status: 'stale' as const } : s) } };
    const bikes = curatedCityPoints(stale, EVENTS, NOW).filter((p) => p.props!.category === 'bikes');
    expect(bikes).toHaveLength(4);
    expect(bikes.every((p) => p.props!.badge === '' && p.props!.spent === true)).toBe(true);
    expect(curatedCityPoints(CITY, [], NOW).map((p) => p.id)).toEqual(['bajs-b1', 'bajs-b2', 'bajs-b3', 'bajs-b4']);
  });

  it('takes a wider venue window and the fresh air stations when asked', () => {
    const week = curatedCityPoints(CITY, EVENTS, NOW, { venues: 'week', air: false });
    expect(week.filter((p) => p.props!.category === 'culture').map((p) => [p.id, p.props!.badge])).toEqual([['culture-1', '1'], ['culture-2', '2']]);
    expect(week.some((p) => p.props!.category === 'air')).toBe(false);
    const air = curatedCityPoints(CITY, EVENTS, NOW, { ...CURATED_WALL, air: true }).filter((p) => p.props!.category === 'air');
    // The station observed seven hours ago is not fresh and is not drawn.
    expect(air).toEqual([{ id: 'air-a1', title: 'Zagreb-1', lon: 15.97, lat: 45.8, place: 'city', props: { category: 'air', badge: '', eventCount: 0, priority: 3 } }]);
  });

  it('marks the stations of the unframed whole-city window `far`, and nothing else', () => {
    const far = curatedCityPoints(CITY, EVENTS, NOW, { ...CURATED_WALL, far: true });
    expect(far.filter((p) => p.props!.category === 'bikes').every((p) => p.props!.far === true)).toBe(true);
    // Owner, 24 Sep: a far dot has no number to say "0" or "not known" with, so on the whole city
    // only a station with a bike is drawn; the empty (b2), the closed (b3) and the unknown (b4) are
    // left to the frame, where the disc can say so.
    expect(far.filter((p) => p.props!.category === 'bikes').map((p) => p.id)).toEqual(['bajs-b1']);
    expect(far.find((p) => p.id === 'culture-1')!.props!.far).toBeUndefined();
    // The count stays in the data; only the layer leaves it off the small dot.
    expect(far.find((p) => p.id === 'bajs-b1')!.props!.badge).toBe('7');
    expect(curatedCityPoints(CITY, EVENTS, NOW).some((p) => 'far' in p.props!)).toBe(false);
  });

  it('merges no place into a geographic cluster on any surface', () => {
    expect(Object.values(MAP_PRESENTATIONS).map((p) => p.placeClusters)).toEqual([false, false, false]);
    const points = curatedCityPoints(CITY, EVENTS, NOW, { venues: 'week', air: true });
    const crowded = [...points, ...points.map((p) => ({ ...p, id: `${p.id}-twin` }))];
    expect(clusterPlaces(crowded, 12)).toEqual(crowded);
  });
});
