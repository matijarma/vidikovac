// The open-data catalogue: which modules are republished at /open/*, under
// what licence, with which upstream attribution. Serialised as a DCAT-AP-like
// JSON-LD document at /open/catalog.json and rendered as HTML at /open/ (D5).
//
// ttl and source.{url,text,licence} mirror worker/feed/registry.ts (Area A),
// per controller ruling R-08; test/open/catalog-registry.test.ts checks ttl
// and source.url against the registry once it exists and fails on drift.
// R-08's braced placeholders ({datum}, {naziv}, {vrijeme}) are filled at
// render time from a live snapshot; this static catalogue keeps them literal.
import type { ModuleId } from '../feed/schema';

export const OPEN_LICENCE = {
  title: 'Otvorena dozvola / Open Licence – Republika Hrvatska (NN 67/17)',
  url: 'https://data.gov.hr/otvorena-dozvola',
} as const;

export const PUBLISHER = {
  name: 'Aning Film d.o.o.',
  homepage: 'https://zagreb.aningfilm.hr',
} as const;

/** The catalogue itself is static per deploy; an hour at the edge is generous and harmless. */
export const CATALOG_TTL_SECONDS = 3600;

export interface OpenDistribution {
  path: string;
  format: 'JSON' | 'GeoJSON';
  mediaType: 'application/json' | 'application/geo+json';
  description: string;
}

export interface OpenDataset {
  module: ModuleId;
  title: string;
  description: string;
  keywords: readonly string[];
  /** Seconds between refreshes; equals the registry ttl. */
  ttl: number;
  source: { text: string; url: string; licence: string };
  distributions: readonly OpenDistribution[];
}

const ADAPTED =
  'Prikaz izvora prilagođen (normaliziran) zajedničkom obliku ModuleSnapshot; izmjene u odnosu na izvornik su označene.';

export const OPEN_DATASETS: readonly OpenDataset[] = [
  {
    module: 'dhmz-cap',
    title: 'Meteorološka upozorenja za Zagrebačku regiju (DHMZ, CAP)',
    description:
      'Upozorenja Državnog hidrometeorološkog zavoda u formatu CAP 1.2 za područje EMMA_ID HR002 (Zagrebačka regija), svedena na naslov, opis, stupanj (u riječima) i vrijeme trajanja.',
    keywords: ['vrijeme', 'upozorenja', 'DHMZ', 'CAP', 'sigurnost'],
    ttl: 300,
    source: {
      text: 'Izvor: DHMZ, Otvorena dozvola, {vrijeme}',
      url: 'https://meteo.hr/proizvodi.php?section=podaci&param=xml_korisnici',
      licence: 'Otvorena dozvola (NN 67/17)',
    },
    distributions: [
      { path: '/open/dhmz-cap.json', format: 'JSON', mediaType: 'application/json', description: ADAPTED },
    ],
  },
  {
    module: 'emsc',
    title: 'Potresi u krugu 1,5° oko Zagreba (EMSC)',
    description:
      'Seizmički događaji Europsko-mediteranskog seizmološkog centra (FDSN event servis) u krugu 1,5° oko Zagreba, s magnitudom, dubinom, vremenom i položajem.',
    keywords: ['potresi', 'EMSC', 'seizmologija', 'sigurnost'],
    ttl: 60,
    source: {
      text: 'Izvor: EMSC, seismicportal.eu',
      url: 'https://www.seismicportal.eu/',
      licence: 'EMSC terms',
    },
    distributions: [{ path: '/open/emsc.json', format: 'JSON', mediaType: 'application/json', description: ADAPTED }],
  },
  {
    module: 'prometnice',
    title: 'Zatvorene i ograničene prometnice (Grad Zagreb)',
    description:
      'Aktualna zatvaranja i ograničenja na gradskim prometnicama iz skupa "prometnice" na data.zagreb.hr, s ulicom, vrstom, smjerom, očekivanim početkom i završetkom te geometrijom.',
    keywords: ['promet', 'prometnice', 'zatvaranja', 'radovi', 'Grad Zagreb'],
    ttl: 180,
    source: {
      text: "Sadrži informacije Grada Zagreba (data.zagreb.hr) u skladu s Otvorenom dozvolom; skup 'Zatvaranje prometnica na području Grada Zagreba'",
      url: 'https://data.zagreb.hr/dataset/prometnice',
      licence: 'Otvorena dozvola (NN 67/17)',
    },
    distributions: [
      { path: '/open/prometnice.json', format: 'JSON', mediaType: 'application/json', description: ADAPTED },
      {
        path: '/open/prometnice.geojson',
        format: 'GeoJSON',
        mediaType: 'application/geo+json',
        description:
          'GeoJSON FeatureCollection izvedena iz izvornih polilinija (prilagodba: koordinate pretvorene u GeoJSON redoslijed, atributi normalizirani, svaki objekt nosi "adapted": true).',
      },
    ],
  },
  {
    module: 'ckan-geo',
    title: 'Gradske četvrti i zborna mjesta civilne zaštite',
    description:
      'Zborna mjesta civilne zaštite i centroidi gradskih četvrti. Zaseban status za svaki izvor; centroid nije adresa sjedišta. Osvježava se dnevno.',
    keywords: ['civilna zaštita', 'zborna mjesta', 'gradske četvrti'],
    ttl: 86400,
    source: {
      text: "Sadrži informacije Grada Zagreba (data.zagreb.hr) u skladu s Otvorenom dozvolom; skup '{naziv}', posljednja izmjena {datum}",
      url: 'https://data.zagreb.hr/',
      licence: 'Otvorena dozvola (NN 67/17)',
    },
    distributions: [{ path: '/open/ckan-geo.json', format: 'JSON', mediaType: 'application/json', description: ADAPTED }],
  },
];

export function findOpenDataset(id: string): OpenDataset | undefined {
  return OPEN_DATASETS.find((d) => d.module === id);
}

export function isoDuration(seconds: number): string {
  if (seconds % 86400 === 0) return `P${seconds / 86400}D`;
  if (seconds % 3600 === 0) return `PT${seconds / 3600}H`;
  if (seconds % 60 === 0) return `PT${seconds / 60}M`;
  return `PT${seconds}S`;
}

export interface CatalogDistribution {
  '@type': 'dcat:Distribution';
  'dcat:accessURL': string;
  'dcat:downloadURL': string;
  'dct:format': string;
  'dcat:mediaType': string;
  'dct:license': string;
  'dct:description': string;
}

export interface CatalogDataset {
  '@type': 'dcat:Dataset';
  '@id': string;
  'dct:identifier': string;
  'dct:title': string;
  'dct:description': string;
  'dcat:keyword': string[];
  'dct:accrualPeriodicity': string;
  'dct:license': string;
  'dct:source': string;
  'dct:provenance': string;
  'dct:language': 'hr';
  'dcat:distribution': CatalogDistribution[];
}

export interface CatalogDocument {
  '@context': Record<string, string>;
  '@type': 'dcat:Catalog';
  '@id': string;
  'dct:title': string;
  'dct:description': string;
  'dct:publisher': { '@type': 'foaf:Agent'; 'foaf:name': string; 'foaf:homepage': string };
  'dct:license': string;
  'dct:language': 'hr';
  'dct:issued': string;
  'dct:modified': string;
  'dcat:dataset': CatalogDataset[];
}

export function buildCatalog(origin: string, issued: Date): CatalogDocument {
  const iso = issued.toISOString();
  return {
    '@context': {
      dcat: 'http://www.w3.org/ns/dcat#',
      dct: 'http://purl.org/dc/terms/',
      foaf: 'http://xmlns.com/foaf/0.1/',
    },
    '@type': 'dcat:Catalog',
    '@id': `${origin}/open/catalog.json`,
    'dct:title': 'Kaj ima?: izvedeni otvoreni podaci o Zagrebu',
    'dct:description':
      'Normalizirani, strojno čitljivi prikazi otvorenih izvora koje Kaj ima? koristi u stvarnom vremenu. ' +
      'Svaki skup nosi izvornu atribuciju i oznaku prilagodbe. Objavljeno pod Otvorenom dozvolom. ' +
      'Grad Zagreb može svaki skup preuzeti i ponovno objaviti na data.zagreb.hr bez daljnjeg odobrenja; ovaj katalog je dovoljna poveznica.',
    'dct:publisher': { '@type': 'foaf:Agent', 'foaf:name': PUBLISHER.name, 'foaf:homepage': origin },
    'dct:license': OPEN_LICENCE.url,
    'dct:language': 'hr',
    'dct:issued': iso,
    'dct:modified': iso,
    'dcat:dataset': OPEN_DATASETS.map((d) => ({
      '@type': 'dcat:Dataset',
      '@id': `${origin}/open/${d.module}`,
      'dct:identifier': d.module,
      'dct:title': d.title,
      'dct:description': d.description,
      'dcat:keyword': [...d.keywords],
      'dct:accrualPeriodicity': isoDuration(d.ttl),
      'dct:license': OPEN_LICENCE.url,
      'dct:source': d.source.url,
      'dct:provenance': `${d.source.text} (${d.source.licence})`,
      'dct:language': 'hr',
      'dcat:distribution': d.distributions.map((x) => ({
        '@type': 'dcat:Distribution',
        'dcat:accessURL': `${origin}${x.path}`,
        'dcat:downloadURL': `${origin}${x.path}`,
        'dct:format': x.format,
        'dcat:mediaType': x.mediaType,
        'dct:license': OPEN_LICENCE.url,
        'dct:description': x.description,
      })),
    })),
  };
}
