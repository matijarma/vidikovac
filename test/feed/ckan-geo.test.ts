import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ARCGIS_CETVRTI_URL,
  CETVRTI_DATASET,
  CKAN_PACKAGE_SHOW,
  ZBORNA_MJESTA_DATASET,
  ckanResourceUrl,
  featureCentroid,
  fetchCkanGeo,
  parseCkanRecords,
  parseGradskeCetvrti,
  ringCentroid,
  titleCaseHr,
} from '../../worker/feed/modules/ckan-geo';

const cetvrti = JSON.parse(readFileSync(new URL('../fixtures/gradske_cetvrti.geojson', import.meta.url), 'utf8'));
const packageShow = JSON.parse(readFileSync(new URL('../fixtures/prometnice_package_show.json', import.meta.url), 'utf8'));

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

  it('reads the district name, number and seat', () => {
    const brezovica = items.find((item) => item.id === 'cetvrt:17');
    expect(brezovica?.title).toBe('Brezovica');
    expect(brezovica?.summary).toBe('Brezovica, Brezovička cesta 100');
    expect(brezovica?.data).toEqual({
      layer: CETVRTI_DATASET,
      dataset: CETVRTI_DATASET,
      number: 17,
      seat: 'Brezovica, Brezovička cesta 100',
    });
    const [lon, lat] = brezovica?.geo?.coordinates as number[];
    expect(lon).toBeGreaterThan(15.7);
    expect(lon).toBeLessThan(16.2);
    expect(lat).toBeGreaterThan(45.6);
    expect(lat).toBeLessThan(45.9);
  });
});

describe('ckanResourceUrl and parseCkanRecords', () => {
  it('picks the JSON distribution out of a package_show answer', () => {
    expect(ckanResourceUrl(packageShow)).toBe(
      'https://data.zagreb.hr/dataset/7ff5514d-0a1f-4f6c-86bd-8ed9a3c55eee/resource/e48b6992-add0-45a1-ae95-c5d97d8db259/download/data.json',
    );
    expect(ckanResourceUrl({ success: true, result: { resources: [] } })).toBeNull();
    expect(ckanResourceUrl(null)).toBeNull();
  });

  it('reads either a FeatureCollection or a flat record list', () => {
    const geo = parseCkanRecords(
      {
        type: 'FeatureCollection',
        features: [
          { properties: { naziv: 'Zrinjevac', adresa: 'Trg Nikole Šubića Zrinskog' }, geometry: { type: 'Point', coordinates: [15.978, 45.811] } },
        ],
      },
      'zborna-mjesta',
      ZBORNA_MJESTA_DATASET,
    );
    expect(geo).toHaveLength(1);
    expect(geo[0]).toMatchObject({
      kind: 'poi',
      title: 'Zrinjevac',
      summary: 'Trg Nikole Šubića Zrinskog',
      geo: { type: 'Point', coordinates: [15.978, 45.811] },
      data: { layer: 'zborna-mjesta', dataset: ZBORNA_MJESTA_DATASET },
    });

    const flat = parseCkanRecords(
      [{ naziv: 'Park Stara Trešnjevka', lat: 45.805, lon: 15.94 }, { ime: 'Bez koordinata' }, 'smeće'],
      'zborna-mjesta',
      ZBORNA_MJESTA_DATASET,
    );
    expect(flat.map((item) => item.title)).toEqual(['Park Stara Trešnjevka', 'Bez koordinata']);
    expect(flat[0].geo).toEqual({ type: 'Point', coordinates: [15.94, 45.805] });
    expect(flat[1].geo).toBeUndefined();
    expect(parseCkanRecords(null, 'x', 'y')).toEqual([]);
  });
});

describe('fetchCkanGeo', () => {
  it('resolves the assembly-point resource through CKAN and keeps the districts', async () => {
    const asked: string[] = [];
    const payload = await fetchCkanGeo({
      now: () => new Date('2026-09-11T10:00:00.000Z'),
      fetch: async (url) => {
        asked.push(url);
        if (url === ARCGIS_CETVRTI_URL) return new Response(JSON.stringify(cetvrti));
        if (url.startsWith(CKAN_PACKAGE_SHOW)) {
          return new Response(
            JSON.stringify({
              success: true,
              result: {
                name: ZBORNA_MJESTA_DATASET,
                metadata_modified: '2026-09-01T08:00:00.000000',
                resources: [{ format: 'JSON', url: 'https://data.zagreb.hr/zborna.json' }],
              },
            }),
          );
        }
        return new Response(JSON.stringify([{ naziv: 'Zrinjevac', lat: 45.811, lon: 15.978 }]));
      },
    });

    expect(asked).toEqual([
      ARCGIS_CETVRTI_URL,
      `${CKAN_PACKAGE_SHOW}${ZBORNA_MJESTA_DATASET}`,
      'https://data.zagreb.hr/zborna.json',
    ]);
    expect(payload.items.filter((item) => item.data?.dataset === CETVRTI_DATASET)).toHaveLength(17);
    expect(payload.items.filter((item) => item.data?.dataset === ZBORNA_MJESTA_DATASET)).toHaveLength(1);
    expect(payload.sourceUpdatedAt).toBe('2026-09-01T08:00:00.000Z');
  });

  it('keeps the districts when CKAN is unreachable, and throws only when both layers fail', async () => {
    const partial = await fetchCkanGeo({
      now: () => new Date('2026-09-11T10:00:00.000Z'),
      fetch: async (url) => {
        if (url === ARCGIS_CETVRTI_URL) return new Response(JSON.stringify(cetvrti));
        throw new Error('upstream 503');
      },
    });
    expect(partial.items).toHaveLength(17);

    await expect(
      fetchCkanGeo({
        now: () => new Date('2026-09-11T10:00:00.000Z'),
        fetch: async () => {
          throw new Error('upstream 503');
        },
      }),
    ).rejects.toThrow(/ckan-geo/);
  });
});
