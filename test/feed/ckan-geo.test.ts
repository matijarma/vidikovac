import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ARCGIS_CETVRTI_URL,
  CETVRTI_DATASET,
  CKAN_GEO_SOURCE_LIMIT,
  POI_CATEGORIES,
  ZBORNA_MJESTA_LAYER,
  ZBORNA_MJESTA_URL,
  featureCentroid,
  fetchCkanGeo,
  parseCkanRecords,
  parseGradskeCetvrti,
  ringCentroid,
  titleCaseHr,
} from '../../worker/feed/modules/ckan-geo';
import { DATA_KEYS, type FetchContext } from '../../worker/feed/schema';

const cetvrti = JSON.parse(readFileSync(new URL('../fixtures/gradske_cetvrti.geojson', import.meta.url), 'utf8'));
const NOW = '2026-09-11T10:00:00.000Z';
const ASSEMBLY_URL = ZBORNA_MJESTA_URL;
const emptyCollection = { type: 'FeatureCollection', features: [] };
const goodAssembly = [{ naziv: 'Zrinjevac', lat: 45.811, lon: 15.978 }];
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function context(overrides: { districts?: () => Response; assembly?: () => Response } = {}): FetchContext {
  return {
    now: () => new Date(NOW),
    fetch: async (url) => {
      if (url === ARCGIS_CETVRTI_URL) return overrides.districts?.() ?? response(cetvrti);
      if (url === ASSEMBLY_URL) return overrides.assembly?.() ?? response(goodAssembly);
      throw new Error(`unexpected source URL: ${url}`);
    },
  };
}

describe('geometry helpers', () => {
  it('computes the centroid of a closed ring by area, not by vertex count', () => {
    expect(ringCentroid([[0, 0], [4, 0], [4, 2], [0, 2], [0, 0]])).toEqual([2, 1]);
    expect(ringCentroid([[0, 0], [1, 1]])).toBeNull();
  });
  it('accepts Polygon and MultiPolygon and refuses anything else', () => {
    const square = [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]];
    expect(featureCentroid({ type: 'Polygon', coordinates: square })).toEqual([1, 1]);
    expect(featureCentroid({ type: 'MultiPolygon', coordinates: [square] })).toEqual([1, 1]);
    expect(featureCentroid({ type: 'Point', coordinates: [15.9, 45.8] })).toEqual([15.9, 45.8]);
    expect(featureCentroid(null)).toBeNull();
  });

  it.each([
    { type: 'Point', coordinates: null },
    { type: 'Point', coordinates: [null, null] },
    { type: 'Point', coordinates: ['15.9', '45.8'] },
    { type: 'Point', coordinates: [181, 45.8] },
    { type: 'Point', coordinates: [15.9, -91] },
    { type: 'Point', coordinates: [Infinity, 45.8] },
    { type: 'Point', coordinates: {} },
    { type: 'Polygon', coordinates: [null] },
    { type: 'Polygon', coordinates: [[null, [0, 1], [1, 1], null]] },
    { type: 'Polygon', coordinates: [[['', 0], [1, 0], [1, 1], ['', 0]]] },
    { type: 'MultiPolygon', coordinates: [null] },
    { type: 'MultiPolygon', coordinates: {} },
  ])('rejects malformed or non-WGS84 geometry without throwing: %j', (geometry) => {
    expect(featureCentroid(geometry)).toBeNull();
  });

  it('chooses the largest exterior by area, without treating a hole as a district', () => {
    const large = [[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]];
    const denseSmall = [[6, 6], [6.5, 6], [7, 6], [7, 6.5], [7, 7], [6.5, 7], [6, 7], [6, 6]];
    expect(featureCentroid({ type: 'MultiPolygon', coordinates: [[large], [denseSmall]] })).toEqual([2, 2]);
    expect(featureCentroid({ type: 'Polygon', coordinates: [large, denseSmall] })).toEqual([2, 2]);
  });
});

describe('titleCaseHr', () => {
  it('turns registry shouting into readable Croatian', () => {
    expect(titleCaseHr('GORNJI GRAD - MEDVEŠČAK')).toBe('Gornji Grad - Medveščak');
    expect(titleCaseHr('TREŠNJEVKA - JUG')).toBe('Trešnjevka - Jug');
    expect(titleCaseHr('ČRNOMEREC')).toBe('Črnomerec');
  });
});

describe('parseGradskeCetvrti', () => {
  const items = parseGradskeCetvrti(cetvrti);

  it('makes one point of interest per city district', () => {
    expect(items).toHaveLength(17);
    expect(items.every((item) => item.kind === 'poi')).toBe(true);
    expect(items.every((item) => item.geo?.type === 'Point')).toBe(true);
    expect(items.every((item) => item.data?.layer === CETVRTI_DATASET)).toBe(true);
  });

  it('reads the district name, seat and poi vocabulary', () => {
    const brezovica = items.find((item) => item.id === 'cetvrt:17');
    expect(brezovica?.title).toBe('Brezovica');
    expect(brezovica?.summary).toBe('Brezovica, Brezovička cesta 100');
    expect(brezovica?.data).toEqual({ layer: CETVRTI_DATASET, category: POI_CATEGORIES[CETVRTI_DATASET] });
    const [lon, lat] = brezovica?.geo?.coordinates as number[];
    expect(lon).toBeGreaterThan(15.7);
    expect(lon).toBeLessThan(16.2);
    expect(lat).toBeGreaterThan(45.6);
    expect(lat).toBeLessThan(45.9);
  });

  it('never coerces missing district ids or object-valued seats into valid fields', () => {
    const geometry = { type: 'Point', coordinates: [15.9, 45.8] };
    const parsed = parseGradskeCetvrti({ features: [
      null,
      { properties: { IME_GC: 'DUBRAVA', RBR_GC: null }, geometry },
      { properties: { IME_GC: 'DUBRAVA', RBR_GC: false }, geometry },
      { properties: { IME_GC: { value: 'DUBRAVA' }, RBR_GC: 1 }, geometry },
      { properties: { IME_GC: 'DUBRAVA', RBR_GC: '1', sjediste_G: { address: 'unknown' } }, geometry },
    ] });
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ id: 'cetvrt:1', title: 'Dubrava' });
    expect(parsed[0].summary).toBeUndefined();
  });
});

describe('parseCkanRecords', () => {
  it('reads either a FeatureCollection or a flat record list', () => {
    const geo = parseCkanRecords(
      {
        type: 'FeatureCollection',
        features: [
          { properties: { naziv: 'Zrinjevac', adresa: 'Trg Nikole Šubića Zrinskog' }, geometry: { type: 'Point', coordinates: [15.978, 45.811] } },
        ],
      },
      ZBORNA_MJESTA_LAYER,
    );
    expect(geo).toHaveLength(1);
    expect(geo[0]).toMatchObject({
      kind: 'poi',
      title: 'Zrinjevac',
      summary: 'Trg Nikole Šubića Zrinskog',
      geo: { type: 'Point', coordinates: [15.978, 45.811] },
      data: { layer: ZBORNA_MJESTA_LAYER, category: POI_CATEGORIES[ZBORNA_MJESTA_LAYER] },
    });

    const flat = parseCkanRecords(
      [{ naziv: 'Park Stara Trešnjevka', lat: 45.805, lon: 15.94 }, { ime: 'Bez koordinata' }, 'smeće'],
      ZBORNA_MJESTA_LAYER,
    );
    expect(flat.map((item) => item.title)).toEqual(['Park Stara Trešnjevka', 'Bez koordinata']);
    expect(flat[0].geo).toEqual({ type: 'Point', coordinates: [15.94, 45.805] });
    expect(flat[1].geo).toBeUndefined();
    expect(parseCkanRecords(null, 'x')).toEqual([]);
  });

  it('reads the exact official assembly schema and preserves source spelling and ids', () => {
    // Samples from the successful official GeoJSON download, resource
    // d30eb215-3ce2-48f8-88b2-6ffac82d46b5. These are not invented POIs.
    const features = [
      { type: 'Feature', id: 1, geometry: { type: 'Point', coordinates: [15.9807010621406, 45.8157108589494] },
        properties: { OBJECTID: 1, gradska_ce: 'Gornji Grad-Medveščak', zboriste: 'Park Ribnjak' } },
      { type: 'Feature', id: 4, geometry: { type: 'Point', coordinates: [16.0140627292642, 45.8742610441023] },
        properties: { OBJECTID: 4, gradska_ce: 'Podsljeme', zboriste: 'OŠ Markueevec' } },
    ];
    const items = parseCkanRecords({ type: 'FeatureCollection', features }, ZBORNA_MJESTA_LAYER);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      id: 'zborna-mjesta:1', title: 'Park Ribnjak', summary: 'Gornji Grad-Medveščak',
      geo: { type: 'Point', coordinates: [15.9807010621406, 45.8157108589494] },
    });
    expect(items[1].title).toBe('OŠ Markueevec');
    expect(parseCkanRecords({ features: [...features].reverse() }, ZBORNA_MJESTA_LAYER).map((item) => item.id))
      .toEqual(['zborna-mjesta:4', 'zborna-mjesta:1']);
  });

  it('carries the district as data.district when the record names one, and no key at all when it does not (R-K4)', () => {
    const items = parseCkanRecords({ type: 'FeatureCollection', features: [
      { type: 'Feature', id: 1, geometry: { type: 'Point', coordinates: [15.9807010621406, 45.8157108589494] },
        properties: { OBJECTID: 1, gradska_ce: 'Gornji Grad-Medveščak', zboriste: 'Park Ribnjak', adresa: 'Ribnjak 1' } },
      { type: 'Feature', id: 2, geometry: { type: 'Point', coordinates: [15.978, 45.811] },
        properties: { OBJECTID: 2, zboriste: 'Zrinjevac' } },
    ] }, ZBORNA_MJESTA_LAYER);
    expect(items[0].data).toEqual({ layer: ZBORNA_MJESTA_LAYER, category: POI_CATEGORIES[ZBORNA_MJESTA_LAYER], district: 'Gornji Grad-Medveščak' });
    // The address still wins the summary; the district is its own field now, not only the fallback.
    expect(items[0].summary).toBe('Ribnjak 1');
    expect(items[1].data).toEqual({ layer: ZBORNA_MJESTA_LAYER, category: POI_CATEGORIES[ZBORNA_MJESTA_LAYER] });
    expect(DATA_KEYS.poi).toContain('district');
  });

  it.each([null, undefined, '', ' ', false, true, {}, [], [0], 'NaN', Infinity])(
    'does not manufacture coordinates from %j', (value) => {
      const items = parseCkanRecords([{ naziv: 'Bez koordinata', lon: value, lat: value }], ZBORNA_MJESTA_LAYER);
      expect(items).toHaveLength(1);
      expect(items[0].geo).toBeUndefined();
    },
  );

  it('accepts explicit numeric strings and real zeroes, but rejects invalid coordinate ranges', () => {
    const items = parseCkanRecords([
      { naziv: 'Str', lon: '15.98', lat: '45.81' },
      { naziv: 'Zero', lon: 0, lat: 0 },
      { naziv: 'Projected', x: 459000, y: 5073000 },
      { naziv: 'Fallback', lon: null, lng: '15.98', lat: null, latitude: '45.81' },
    ], ZBORNA_MJESTA_LAYER);
    expect(items[0].geo?.coordinates).toEqual([15.98, 45.81]);
    expect(items[1].geo?.coordinates).toEqual([0, 0]);
    expect(items[2].geo).toBeUndefined();
    expect(items[3].geo?.coordinates).toEqual([15.98, 45.81]);
  });

  it('only emits string names and summaries', () => {
    const items = parseCkanRecords([
      { naziv: { name: 'object' }, adresa: 'wrong' },
      { naziv: ' Named ', adresa: { value: 'object' } },
      { naziv: 'District', adresa: [], gradska_ce: ' Podsljeme ' },
      { naziv: 'No summary', adresa: 123 },
      { naziv: 'Blank summary', adresa: '  ' },
    ], ZBORNA_MJESTA_LAYER);
    expect(items.map((item) => item.title)).toEqual(['Named', 'District', 'No summary', 'Blank summary']);
    expect(items.map((item) => item.summary)).toEqual([undefined, 'Podsljeme', undefined, undefined]);
  });

});

describe('fetchCkanGeo', () => {
  it('reads the assembly points straight from the portal resource, never through CKAN /api/, and keeps the districts', async () => {
    const asked: string[] = [];
    const payload = await fetchCkanGeo({
      now: () => new Date('2026-09-11T10:00:00.000Z'),
      fetch: async (url) => {
        asked.push(url);
        if (url === ARCGIS_CETVRTI_URL) return new Response(JSON.stringify(cetvrti));
        return new Response(JSON.stringify([{ naziv: 'Zrinjevac', lat: 45.811, lon: 15.978 }]), {
          headers: { 'last-modified': 'Tue, 01 Sep 2026 08:00:00 GMT' },
        });
      },
    });

    expect(asked).toEqual([ARCGIS_CETVRTI_URL, ZBORNA_MJESTA_URL]);
    for (const url of asked) expect(url).not.toContain('data.zagreb.hr/api/');
    expect(payload.items.filter((item) => item.data?.layer === CETVRTI_DATASET)).toHaveLength(17);
    expect(payload.items.filter((item) => item.data?.layer === ZBORNA_MJESTA_LAYER)).toHaveLength(1);
    expect(payload.sourceUpdatedAt).toBeUndefined();
    expect(payload.sources).toEqual({
      'gradske-cetvrti': { status: 'live', itemCount: 17, totalItems: 17, fetchedAt: NOW },
      'zborna-mjesta': {
        status: 'live', itemCount: 1, totalItems: 1, fetchedAt: NOW, sourceUpdatedAt: '2026-09-01T08:00:00.000Z',
      },
    });
    expect(payload.coverage).toEqual({ shown: 18, total: 18, limited: false });
  });

  it('keeps the districts when the portal is unreachable, and throws only when both layers fail', async () => {
    const partial = await fetchCkanGeo({
      now: () => new Date('2026-09-11T10:00:00.000Z'),
      fetch: async (url) => {
        if (url === ARCGIS_CETVRTI_URL) return new Response(JSON.stringify(cetvrti));
        throw new Error('upstream 503');
      },
    });
    expect(partial.items).toHaveLength(17);
    expect(partial.sources?.['zborna-mjesta']).toEqual({ status: 'down', itemCount: 0 });
    expect(partial.coverage).toEqual({ shown: 17, limited: true });

    await expect(
      fetchCkanGeo({
        now: () => new Date('2026-09-11T10:00:00.000Z'),
        fetch: async () => {
          throw new Error('upstream 503');
        },
      }),
    ).rejects.toThrow(/ckan-geo/);
  });

  it('keeps assembly availability independent when the district request fails', async () => {
    const payload = await fetchCkanGeo(context({ districts: () => response(emptyCollection, 503) }));
    expect(payload.items).toHaveLength(1);
    expect(payload.sources?.['gradske-cetvrti']).toEqual({ status: 'down', itemCount: 0 });
    expect(payload.sources?.['zborna-mjesta']).toMatchObject({ status: 'live', itemCount: 1, totalItems: 1 });
    expect(payload.coverage).toEqual({ shown: 1, limited: true });
  });

  it('accepts successful empty collections for both sources', async () => {
    const payload = await fetchCkanGeo(context({
      districts: () => response(emptyCollection),
      assembly: () => response(emptyCollection),
    }));
    expect(payload.items).toEqual([]);
    expect(payload.sources?.['gradske-cetvrti']).toEqual({ status: 'live', itemCount: 0, totalItems: 0, fetchedAt: NOW });
    expect(payload.sources?.['zborna-mjesta']).toMatchObject({ status: 'live', itemCount: 0, totalItems: 0, fetchedAt: NOW });
    expect(payload.coverage).toEqual({ shown: 0, total: 0, limited: false });
  });

  it.each(['districts', 'assembly'] as const)('does not throw when only %s succeeds with an empty collection', async (source) => {
    const payload = await fetchCkanGeo(context({
      districts: () => response(source === 'districts' ? emptyCollection : { error: { code: 500 } }),
      assembly: () => response(source === 'assembly' ? [] : { error: { code: 500 } }),
    }));
    expect(payload.items).toEqual([]);
    expect(payload.sources?.[source === 'districts' ? CETVRTI_DATASET : ZBORNA_MJESTA_LAYER])
      .toMatchObject({ status: 'live', itemCount: 0, totalItems: 0 });
    expect(payload.coverage).toEqual({ shown: 0, limited: true });
  });

  it.each([
    ['HTTP 503 with valid-looking JSON', () => response(emptyCollection, 503)],
    ['HTTP 404 with valid-looking JSON', () => response(emptyCollection, 404)],
    ['HTTP 204 with no JSON', () => new Response(null, { status: 204 })],
    ['invalid JSON', () => new Response('<html>upstream failed</html>')],
    ['API error', () => response({ error: { code: 400 }, features: [] })],
    ['API errors array', () => response({ errors: ['failed'], features: [] })],
    ['API failure flag', () => response({ success: false, features: [] })],
    ['missing collection', () => response({})],
    ['null collection', () => response(null)],
    ['wrong features shape', () => response({ features: {} })],
    ['wrong GeoJSON type', () => response({ type: 'Feature', features: [] })],
    ['unreadable nonempty collection', () => response({ type: 'FeatureCollection', features: [{ unexpected: true }] })],
  ] as const)('treats %s as failure, not successful zero', async (_label, failedResponse) => {
    const partial = await fetchCkanGeo(context({ assembly: failedResponse }));
    expect(partial.items).toHaveLength(17);
    expect(partial.sources?.['zborna-mjesta']).toEqual({ status: 'down', itemCount: 0 });
    expect(partial.coverage).toEqual({ shown: 17, limited: true });
    await expect(fetchCkanGeo(context({ districts: failedResponse, assembly: failedResponse }))).rejects.toThrow(/ckan-geo/);
  });

  it.each([
    () => response(emptyCollection, 503),
    () => new Response('<html>portal down</html>'),
    () => response({ success: false }),
  ])('does not equate an unreadable assembly download with an empty assembly layer', async (assembly) => {
    const payload = await fetchCkanGeo(context({ assembly }));
    expect(payload.sources?.['zborna-mjesta']).toEqual({ status: 'down', itemCount: 0 });
    expect(payload.coverage).toEqual({ shown: 17, limited: true });
  });

  it('takes the assembly date from the portal Last-Modified header, never the fetch time or a shared district timestamp', async () => {
    const payload = await fetchCkanGeo(context({ assembly: () => new Response(JSON.stringify(goodAssembly), {
      headers: { 'last-modified': 'Thu, 02 Jan 2025 12:39:07 GMT' },
    }) }));
    expect(payload.sources?.['zborna-mjesta']?.sourceUpdatedAt).toBe('2025-01-02T12:39:07.000Z');
    expect(payload.sources?.['gradske-cetvrti']?.sourceUpdatedAt).toBeUndefined();
    expect(payload.sourceUpdatedAt).toBeUndefined();
  });

  it('omits an unparsable or missing Last-Modified without replacing it with fetchedAt', async () => {
    const payload = await fetchCkanGeo(context({ assembly: () => new Response(JSON.stringify(goodAssembly), {
      headers: { 'last-modified': 'not a date' },
    }) }));
    expect(payload.sources?.['zborna-mjesta']?.sourceUpdatedAt).toBeUndefined();
    expect(payload.sources?.['zborna-mjesta']?.fetchedAt).toBe(NOW);
  });

  it('reports pre-cap row counts rather than pretending the cap is the whole collection', async () => {
    const total = CKAN_GEO_SOURCE_LIMIT + 3;
    const payload = await fetchCkanGeo(context({ assembly: () => response(
      Array.from({ length: total }, (_, index) => ({ id: index, naziv: `Test ${index}`, lon: 15.98, lat: 45.81 })),
    ) }));
    expect(payload.sources?.['zborna-mjesta']).toMatchObject({ status: 'live', itemCount: CKAN_GEO_SOURCE_LIMIT, totalItems: total });
    expect(payload.coverage).toEqual({ shown: 17 + CKAN_GEO_SOURCE_LIMIT, total: 17 + total, limited: true });
  });

  it('reports omitted malformed rows as incomplete coverage', async () => {
    const payload = await fetchCkanGeo(context({ assembly: () => response([...goodAssembly, null, { adresa: 'No name' }]) }));
    expect(payload.sources?.['zborna-mjesta']).toMatchObject({ status: 'live', itemCount: 1, totalItems: 3 });
    expect(payload.coverage).toEqual({ shown: 18, total: 20, limited: true });
  });

  it.each([
    { exceededTransferLimit: true },
    { properties: { exceededTransferLimit: true } },
    { totalFeatures: 'unknown' },
    { numberMatched: -1 },
    { numberMatched: 1.5 },
    { numberMatched: 0 },
    { exceededTransferLimit: true, numberMatched: 17 },
  ])('omits unknown or implausible upstream totals: %j', async (metadata) => {
    const payload = await fetchCkanGeo(context({ districts: () => response({ ...cetvrti, ...metadata }) }));
    expect(payload.sources?.['gradske-cetvrti']?.totalItems).toBeUndefined();
    expect(payload.coverage).toEqual({ shown: 18, limited: true });
  });

  it('can report an explicit upstream total larger than the received page', async () => {
    const payload = await fetchCkanGeo(context({ districts: () => response({
      ...cetvrti, exceededTransferLimit: true, numberMatched: 30,
    }) }));
    expect(payload.sources?.['gradske-cetvrti']?.totalItems).toBe(30);
    expect(payload.coverage).toEqual({ shown: 18, total: 31, limited: true });
  });
});

describe('spatial and gazette catalogue descriptions', () => {
  const catalogue = JSON.parse(readFileSync(new URL('../../app/src/data/izvori.json', import.meta.url), 'utf8'));
  const docs = readFileSync(new URL('../../docs/izvori.md', import.meta.url), 'utf8');

  it('describes exactly the implemented spatial layers, not unimplemented POI categories', () => {
    const name = catalogue.sources.find((source: { module: string }) => source.module === 'ckan-geo').naziv;
    const row = docs.split('\n').find((line) => line.startsWith('| `ckan-geo` |'))!;
    for (const description of [name, row]) {
      expect(description).toContain('gradske četvrti');
      expect(description).toContain('zborna mjesta');
      expect(description).not.toMatch(/ljekarne|vatrogasci|policija|zdenci|knjižnice|muzeji|javni WC/);
    }
    expect(row).toContain(ZBORNA_MJESTA_URL);
    expect(row).not.toContain('data.zagreb.hr/api/');
    expect(row).toContain(ARCGIS_CETVRTI_URL);
    expect(docs).toContain(`najviše ${CKAN_GEO_SOURCE_LIMIT} čitljivih stavki po sloju`);
  });

  it('makes clear the gazette supplies names/links, not full text', () => {
    const name = catalogue.sources.find((source: { module: string }) => source.module === 'glasnik').naziv;
    const row = docs.split('\n').find((line) => line.startsWith('| `glasnik` |'))!;
    expect(name).toContain('nazivi akata najnovijeg broja');
    expect(name).toContain('bez punog teksta');
    expect(row).toContain('bez dohvata punog teksta');
    expect(row).not.toContain('šifarnici, pretraga akata, puni tekst akta');
  });
});
