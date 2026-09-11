import { describe, expect, it } from 'vitest';
import {
  CATALOG_TTL_SECONDS,
  OPEN_DATASETS,
  OPEN_LICENCE,
  buildCatalog,
  findOpenDataset,
  isoDuration,
} from '../../worker/open/catalog';

const ORIGIN = 'https://zagreb.aningfilm.hr';
const ISSUED = new Date('2026-09-11T10:00:00Z');

describe('open data catalog', () => {
  it('turns refresh seconds into ISO 8601 durations', () => {
    expect(isoDuration(60)).toBe('PT1M');
    expect(isoDuration(180)).toBe('PT3M');
    expect(isoDuration(300)).toBe('PT5M');
    expect(isoDuration(3600)).toBe('PT1H');
    expect(isoDuration(86400)).toBe('P1D');
    expect(isoDuration(90)).toBe('PT90S');
  });

  it('lists exactly the open-tier modules', () => {
    expect(OPEN_DATASETS.map((d) => d.module)).toEqual(['dhmz-cap', 'emsc', 'prometnice', 'ckan-geo']);
    expect(findOpenDataset('prometnice')?.ttl).toBe(180);
    expect(findOpenDataset('zet-rt')).toBeUndefined();
    expect(CATALOG_TTL_SECONDS).toBe(3600);
  });

  it('builds a DCAT-AP-like JSON-LD catalog with absolute distribution URLs', () => {
    const catalog = buildCatalog(ORIGIN, ISSUED);
    expect(catalog['@type']).toBe('dcat:Catalog');
    expect(catalog['@id']).toBe(`${ORIGIN}/open/catalog.json`);
    expect(catalog['@context']).toMatchObject({
      dcat: 'http://www.w3.org/ns/dcat#',
      dct: 'http://purl.org/dc/terms/',
      foaf: 'http://xmlns.com/foaf/0.1/',
    });
    expect(catalog['dct:license']).toBe(OPEN_LICENCE.url);
    expect(catalog['dct:publisher']['foaf:name']).toBe('Aning Film d.o.o.');
    expect(catalog['dct:issued']).toBe('2026-09-11T10:00:00.000Z');
    expect(catalog['dcat:dataset']).toHaveLength(4);

    const prometnice = catalog['dcat:dataset'].find((d) => d['dct:identifier'] === 'prometnice')!;
    expect(prometnice['@type']).toBe('dcat:Dataset');
    expect(prometnice['dct:accrualPeriodicity']).toBe('PT3M');
    expect(prometnice['dct:license']).toBe(OPEN_LICENCE.url);
    expect(prometnice['dct:source']).toContain('data.zagreb.hr');
    expect(prometnice['dcat:distribution'].map((x) => x['dcat:downloadURL'])).toEqual([
      `${ORIGIN}/open/prometnice.json`,
      `${ORIGIN}/open/prometnice.geojson`,
    ]);
    expect(prometnice['dcat:distribution'][1]['dcat:mediaType']).toBe('application/geo+json');
    for (const dist of prometnice['dcat:distribution']) {
      expect(dist['dct:license']).toBe(OPEN_LICENCE.url);
      expect(dist['dct:description']).toContain('prilag');
    }
  });

  it('carries the republishing offer to Grad Zagreb in the catalog description', () => {
    const catalog = buildCatalog(ORIGIN, ISSUED);
    expect(catalog['dct:description']).toContain('data.zagreb.hr');
    expect(catalog['dct:description']).toContain('Grad Zagreb');
  });
});
