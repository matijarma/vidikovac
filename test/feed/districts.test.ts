import { readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DISTRICT_SNAP_M,
  DISTRICT_TABLE,
  districtOf,
  districtOfGeo,
  pointInPolygon,
  pointInRing,
  type Ring,
} from '../../worker/feed/geo/districts';
import { AREAS } from '../../worker/pairing/areas';
import { DISTRICTS } from '../../app/src/kiosk/districts';
import { KOMUNALNE_URL, fetchKomunalne } from '../../worker/feed/modules/dogadanja/komunalne';
import { parsePrometnice } from '../../worker/feed/modules/prometnice';

const GENERATED_TABLE_PATH = new URL('../../worker/data/gradske-cetvrti.json', import.meta.url);
const MAX_TABLE_BYTES = 61_440;
const MAX_TOLERANCE_M = 40;

describe('pointInRing / pointInPolygon', () => {
  // A 200m x 200m square around a point clearly inside Zagreb, with a 60m square hole in its centre.
  const outer: Ring = [
    [15.97, 45.80],
    [15.973, 45.80],
    [15.973, 45.802],
    [15.97, 45.802],
    [15.97, 45.80],
  ];
  const hole: Ring = [
    [15.9713, 45.8009],
    [15.9717, 45.8009],
    [15.9717, 45.8011],
    [15.9713, 45.8011],
    [15.9713, 45.8009],
  ];

  it('is true inside the ring and false outside it, closed ring included', () => {
    expect(pointInRing(15.9715, 45.801, outer)).toBe(true);
    expect(pointInRing(15.98, 45.81, outer)).toBe(false);
  });

  it('treats a polygon as outer-minus-holes', () => {
    expect(pointInPolygon(15.9715, 45.801, [outer])).toBe(true); // inside the hole, no holes declared
    expect(pointInPolygon(15.9715, 45.801, [outer, hole])).toBe(false); // same point, now inside the hole
    expect(pointInPolygon(15.9705, 45.8005, [outer, hole])).toBe(true); // inside outer, outside the hole
    expect(pointInPolygon(16, 45.9, [outer, hole])).toBe(false); // outside the outer ring entirely
  });
});

describe('the generated district table', () => {
  it('lists exactly the 17 AREAS slugs, in AREAS order', () => {
    expect(DISTRICT_TABLE.districts.map((d) => d.slug)).toEqual(AREAS.map((a) => a.slug));
  });

  it('is at most 61,440 bytes and used a Douglas-Peucker tolerance of at most 40 m', () => {
    const bytes = statSync(GENERATED_TABLE_PATH).size;
    expect(bytes).toBeLessThanOrEqual(MAX_TABLE_BYTES);
    expect(DISTRICT_TABLE.toleranceM).toBeLessThanOrEqual(MAX_TOLERANCE_M);
  });

  it('names the offline fixture the brief pins', () => {
    expect(DISTRICT_TABLE.sourceFixture).toBe('test/fixtures/gradske_cetvrti.geojson');
  });
});

describe('districtOf', () => {
  it('resolves every district seat (app/src/kiosk/districts.ts) back to its own slug', () => {
    for (const district of DISTRICTS) {
      expect(districtOf(district.seat.lon, district.seat.lat), district.slug).toBe(district.slug);
    }
  });

  it('returns null for a point nowhere near Zagreb (Sisak, about 40 km south)', () => {
    expect(districtOf(16.3729, 45.4818)).toBeNull();
  });

  // Trg bana Josipa Jelačića (45°48'56"N 15°58'40"E, Wikipedia) verified against
  // both the raw fixture and the simplified table: it falls inside Gornji
  // grad - Medveščak's own polygon, not Donji grad. The plan's B.9 text names
  // this landmark expecting 'donji-grad'; that assumption does not hold
  // against the City's own boundary data (see this task's report, "Rulings"),
  // so this asserts the verified fact rather than the plan's mistaken one.
  it('resolves Trg bana Jelačića to gornji-grad-medvescak, the district the real boundary actually draws it into', () => {
    expect(districtOf(15.977778, 45.815556)).toBe('gornji-grad-medvescak');
  });

  // A genuine simplification sliver: 20 m outside pescenica-zitnjak's own
  // simplified boundary, in the gap the independent Douglas-Peucker run left
  // between it and its neighbour sesvete (40.6 m away, also inside
  // DISTRICT_SNAP_M) -- found by walking every ring edge of the generated
  // table for a point no polygon's exact test claims. districtOf must fall
  // through to the snap pass and pick the nearer of the two, not the farther
  // or neither.
  it('snaps a point in a simplification sliver to the nearer district within DISTRICT_SNAP_M', () => {
    const lon = 16.1259678;
    const lat = 45.8012404;
    expect(districtOf(lon, lat, 0)).toBeNull(); // no exact containment anywhere without the snap pass
    expect(districtOf(lon, lat)).toBe('pescenica-zitnjak');
    expect(DISTRICT_SNAP_M).toBe(50);
  });

  it('respects a caller-supplied snap radius smaller than the gap, returning null rather than reaching further', () => {
    const lon = 16.1259678;
    const lat = 45.8012404;
    // The same sliver point, offered a snap radius under its real ~20 m gap: still nothing.
    expect(districtOf(lon, lat, 5)).toBeNull();
  });
});

describe('districtOfGeo', () => {
  it('reads a Point directly', () => {
    const seat = DISTRICTS.find((d) => d.slug === 'trnje')!.seat;
    expect(districtOfGeo({ type: 'Point', coordinates: [seat.lon, seat.lat] })).toBe('trnje');
  });

  it('reads a LineString by its first vertex, wherever the closure starts', () => {
    const trnjeSeat = DISTRICTS.find((d) => d.slug === 'trnje')!.seat;
    const maksimirSeat = DISTRICTS.find((d) => d.slug === 'maksimir')!.seat;
    expect(
      districtOfGeo({
        type: 'LineString',
        coordinates: [
          [trnjeSeat.lon, trnjeSeat.lat],
          [maksimirSeat.lon, maksimirSeat.lat],
        ],
      }),
    ).toBe('trnje');
  });

  it('is null for no geo at all', () => {
    expect(districtOfGeo(undefined)).toBeNull();
  });
});

describe('district coverage against the real fixtures', () => {
  it('stamps a district on at least 90% of the komunalne fixture items that carry coordinates', async () => {
    const fixture = readFileSync(new URL('../fixtures/dogadanja/komunalne-aktivnosti.json', import.meta.url), 'utf8');
    const result = await fetchKomunalne({
      now: () => new Date('2026-09-12T00:46:26Z'),
      fetch: async (url) => {
        if (url !== KOMUNALNE_URL) throw new Error(`unexpected url: ${url}`);
        return new Response(fixture);
      },
    });
    const withGeo = result.items.filter((item) => item.geo);
    expect(withGeo.length).toBeGreaterThan(0);
    const withDistrict = withGeo.filter((item) => item.data.district !== undefined);
    expect(withDistrict.length / withGeo.length).toBeGreaterThanOrEqual(0.9);
  });

  it('gives every prometnice fixture item a district, or confirms its start truly falls outside the city', () => {
    const raw = JSON.parse(readFileSync(new URL('../fixtures/prometnice.json', import.meta.url), 'utf8'));
    const payload = parsePrometnice(raw);
    expect(payload.items.length).toBeGreaterThan(0);
    for (const item of payload.items) {
      const first = (item.geo!.coordinates as number[][])[0]!;
      const confirmedOutside = districtOf(first[0]!, first[1]!) === null;
      expect(item.data?.district !== undefined || confirmedOutside, `item ${item.id}`).toBe(true);
    }
    // The real fixture's 32 closures are all inside the city; this is the
    // meaningful half of the assertion above, not a vacuous "or" branch.
    expect(payload.items.every((item) => item.data?.district !== undefined)).toBe(true);
  });
});
