import { describe, expect, it } from 'vitest';
import {
  ARCHIVE_DATASETS,
  CATALOG_TTL_SECONDS,
  FREQUENCY_NEVER,
  ZET_LICENCE_SENTENCE,
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

  it('lists exactly the four open-tier modules offered for republishing', () => {
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
    expect(catalog['dcat:dataset']).toHaveLength(5);

    // the live modules come first, the archive after them
    expect(catalog['dcat:dataset'].map((d) => d['dct:identifier'])).toEqual(['dhmz-cap', 'emsc', 'prometnice', 'ckan-geo', 'snimka-2026-09']);

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

  it('lists the strike replay as an archive dataset: published once, eight stable aliases, ZET sentence verbatim', () => {
    expect(ARCHIVE_DATASETS.map((a) => a.id)).toEqual(['snimka-2026-09']);
    expect(ZET_LICENCE_SENTENCE).toBe('Public dataset by ZET provided under Open license, dataset source http://www.zet.hr/odredbe/datoteke-u-gtfs-formatu/669');
    const archive = buildCatalog(ORIGIN, ISSUED)['dcat:dataset'].find((d) => d['dct:identifier'] === 'snimka-2026-09')!;
    expect(archive['@id']).toBe(`${ORIGIN}/open/#snimka-2026-09`);
    expect(archive['dct:title']).toBe('Tri dana bez tramvaja: izvedeni podaci iz snimke');
    expect(archive['dct:accrualPeriodicity']).toBe(FREQUENCY_NEVER);
    expect(FREQUENCY_NEVER).toBe('http://publications.europa.eu/resource/authority/frequency/NEVER');
    expect(archive['dct:license']).toBe(OPEN_LICENCE.url);
    expect(archive['dct:provenance']).toContain(ZET_LICENCE_SENTENCE);
    expect(archive).toMatchObject({
      'dct:issued': '2026-10-02',
      'dct:temporal': { '@type': 'dct:PeriodOfTime', 'dcat:startDate': '2026-09-27T18:00:00Z', 'dcat:endDate': '2026-10-02T10:00:00Z' },
    });
    // Sun 27 Sep 20:00 to Fri 2 Oct 12:00 Zagreb = the contract's window (shared/snimka.ts)
    expect(Date.parse('2026-09-27T18:00:00Z') / 1000).toBe(1790532000);
    expect(Date.parse('2026-10-02T10:00:00Z') / 1000).toBe(1790935200);
    expect(archive['dct:source']).toHaveLength(4);
    const names = ['series.csv', 'hourly.csv', 'routes-5min.csv', 'bikes-5min.csv', 'stations.csv', 'events.json', 'closures.geojson', 'opis.json'];
    expect(archive['dcat:distribution'].map((x) => x['dcat:downloadURL'])).toEqual(names.map((n) => `${ORIGIN}/api/snimka/v2/exports/latest/${n}`));
    expect(archive['dcat:distribution'].map((x) => x['dcat:mediaType'])).toEqual([
      'text/csv', 'text/csv', 'text/csv', 'text/csv', 'text/csv', 'application/json', 'application/geo+json', 'application/json',
    ]);
    for (const x of archive['dcat:distribution']) expect(x['dct:license']).toBe(OPEN_LICENCE.url);
    // never the war-word in the catalogue, and no dash
    expect(JSON.stringify(archive)).not.toMatch(/štrajk|[—–]| -- /i);
  });

  it('carries the republishing offer to Grad Zagreb in the catalog description', () => {
    const catalog = buildCatalog(ORIGIN, ISSUED);
    expect(catalog['dct:description']).toContain('data.zagreb.hr');
    expect(catalog['dct:description']).toContain('Grad Zagreb');
  });

  it('names Kaj ima? in the catalogue title and description, with no dash and no Vidikovac (T6.3)', () => {
    const catalog = buildCatalog(ORIGIN, ISSUED);
    expect(catalog['dct:title']).toBe('Kaj ima?: izvedeni otvoreni podaci o Zagrebu');
    expect(catalog['dct:description']).toContain('Kaj ima?');
    for (const text of [catalog['dct:title'], catalog['dct:description']]) {
      expect(text).not.toContain('Vidikovac');
      expect(text).not.toMatch(/[—–]| -- /);
    }
  });
});
