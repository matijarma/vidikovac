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
  format: 'JSON' | 'GeoJSON' | 'CSV';
  mediaType: 'application/json' | 'application/geo+json' | 'text/csv';
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

/**
 * A finished, derived dataset published once (the replay of the ZET strike, docs/snimka-2026-10.md):
 * not a live module, so it has no ttl, no registry entry and no place in OPEN_DATASETS, which
 * test/open/catalog-registry.test.ts checks against the feed registry. Its distributions are the
 * stable aliases of worker/routes/snimka.ts (/api/snimka/v2/exports/latest/<name>.<ext>), which
 * answer 302 to the content-named file the dataset manifest lists.
 */
export interface OpenArchiveDataset {
  id: string;
  title: string;
  description: string;
  keywords: readonly string[];
  /** ISO 8601 instants (UTC) of the first and the last minute the dataset covers. */
  temporal: { start: string; end: string };
  issued: string;
  /** The ZET licence sentence first, then the other attributions, each as its source requires it. */
  provenance: string;
  sources: readonly { name: string; text: string; url: string; licence: string }[];
  distributions: readonly OpenDistribution[];
}

/** The sentence ZET's licence asks for, verbatim (docs/izvori.md, worker/feed/registry.ts). */
export const ZET_LICENCE_SENTENCE =
  'Public dataset by ZET provided under Open license, dataset source http://www.zet.hr/odredbe/datoteke-u-gtfs-formatu/669';

const ARCHIVE = '/api/snimka/v2/exports/latest/';

export const ARCHIVE_DATASETS: readonly OpenArchiveDataset[] = [
  {
    id: 'snimka-2026-09',
    title: 'Tri dana bez tramvaja: izvedeni podaci iz snimke',
    description:
      'Stanje usluge po minuti, vozila u pokretu i po voznom redu po liniji, pouzdanost ZET-ovih podataka, bicikli po stanici, zatvorene ulice i poglavlja snimke od nedjelje 27. rujna u 20:00 do petka 2. listopada 2026. u 12:00. ' +
      'Skup je izveden iz snimljenih otvorenih izvora, objavljen jednom i ne osvježava se; ne sadrži sirove ZET-ove okvire, naslove medija ni ijednu brojku o ljudima.',
    keywords: ['promet', 'ZET', 'tramvaj', 'bicikli', 'BAJS', 'zatvorene ulice', 'arhiva', 'Zagreb'],
    temporal: { start: '2026-09-27T18:00:00Z', end: '2026-10-02T10:00:00Z' },
    issued: '2026-10-02',
    provenance:
      `${ZET_LICENCE_SENTENCE}. Bicikli: nextbike (BAJS), GBFS, CC0 1.0. ` +
      'Zatvorene ulice: sadrži informacije Grada Zagreba (data.zagreb.hr) u skladu s Otvorenom dozvolom. Vrijeme: izvor DHMZ, Otvorena dozvola.',
    sources: [
      { name: 'ZET', text: ZET_LICENCE_SENTENCE, url: 'http://www.zet.hr/odredbe/datoteke-u-gtfs-formatu/669', licence: 'Otvorena dozvola' },
      { name: 'nextbike (BAJS)', text: 'Bicikli: nextbike (BAJS), GBFS, CC0 1.0.', url: 'https://www.nextbike.hr/', licence: 'CC0 1.0' },
      {
        name: 'Grad Zagreb',
        text: 'Sadrži informacije Grada Zagreba (data.zagreb.hr) u skladu s Otvorenom dozvolom',
        url: 'https://data.zagreb.hr/dataset/prometnice',
        licence: 'Otvorena dozvola',
      },
      { name: 'DHMZ', text: 'Izvor: DHMZ, Otvorena dozvola', url: 'https://meteo.hr/proizvodi.php?section=podaci&param=xml_korisnici', licence: 'Otvorena dozvola' },
    ],
    distributions: [
      { path: `${ARCHIVE}series.csv`, format: 'CSV', mediaType: 'text/csv', description: 'Jedan redak po minuti: vozila u pokretu i po voznom redu, stanje usluge, pouzdanost ZET-ovih podataka, bicikli i zatvorene ulice.' },
      { path: `${ARCHIVE}hourly.csv`, format: 'CSV', mediaType: 'text/csv', description: 'Jedan redak po satu: temperatura i vrijeme (DHMZ, Zagreb-Maksimir) i broj relevantnih medijskih naslova (samo broj, bez naslova).' },
      { path: `${ARCHIVE}routes-5min.csv`, format: 'CSV', mediaType: 'text/csv', description: 'Po liniji i svakih pet minuta: vozila u pokretu i po voznom redu; prazno znači da podatka nema.' },
      { path: `${ARCHIVE}bikes-5min.csv`, format: 'CSV', mediaType: 'text/csv', description: 'Bicikli po stanici svakih pet minuta, jedan stupac po stanici; prazno znači da podatka nema.' },
      { path: `${ARCHIVE}stations.csv`, format: 'CSV', mediaType: 'text/csv', description: 'Popis stanica BAJS-a s nazivom i položajem; stupci datoteke s biciklima nose njihove oznake.' },
      { path: `${ARCHIVE}sentences.csv`, format: 'CSV', mediaType: 'text/csv', description: 'Po minuti: kako bi zaslon na Trgu bana Jelačića čitao ZET i koju bi rečenicu rekao po današnjim pravilima aplikacije; izračunano naknadno, bez zapisa stvarnog zaslona.' },
      { path: `${ARCHIVE}events.json`, format: 'JSON', mediaType: 'application/json', description: 'Poglavlja i događaji snimke s vremenom, izvorom i poveznicama.' },
      { path: `${ARCHIVE}closures.geojson`, format: 'GeoJSON', mediaType: 'application/geo+json', description: 'Zatvorene ulice kao GeoJSON, jedan objekt po zatvaranju, s datumom završetka kako ga je objavila svaka inačica skupa.' },
      { path: `${ARCHIVE}opis.json`, format: 'JSON', mediaType: 'application/json', description: 'Opis skupa: licenca, atribucija i svaki stupac svake datoteke.' },
    ],
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

export interface CatalogArchiveDataset {
  '@type': 'dcat:Dataset';
  '@id': string;
  'dct:identifier': string;
  'dct:title': string;
  'dct:description': string;
  'dcat:keyword': string[];
  'dct:accrualPeriodicity': string;
  'dct:temporal': { '@type': 'dct:PeriodOfTime'; 'dcat:startDate': string; 'dcat:endDate': string };
  'dct:issued': string;
  'dct:license': string;
  'dct:source': string[];
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
  'dcat:dataset': (CatalogDataset | CatalogArchiveDataset)[];
}

/** EU Publications Office frequency vocabulary: a dataset that is published once and never refreshed. */
export const FREQUENCY_NEVER = 'http://publications.europa.eu/resource/authority/frequency/NEVER';

function distribution(origin: string, x: OpenDistribution): CatalogDistribution {
  return {
    '@type': 'dcat:Distribution',
    'dcat:accessURL': `${origin}${x.path}`,
    'dcat:downloadURL': `${origin}${x.path}`,
    'dct:format': x.format,
    'dcat:mediaType': x.mediaType,
    'dct:license': OPEN_LICENCE.url,
    'dct:description': x.description,
  };
}

export function buildCatalog(origin: string, issued: Date): CatalogDocument {
  const iso = issued.toISOString();
  const document: CatalogDocument = {
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
      'dcat:distribution': d.distributions.map((x) => distribution(origin, x)),
    })),
  };
  document['dcat:dataset'].push(
    ...ARCHIVE_DATASETS.map((a): CatalogArchiveDataset => ({
      '@type': 'dcat:Dataset',
      '@id': `${origin}/open/#${a.id}`,
      'dct:identifier': a.id,
      'dct:title': a.title,
      'dct:description': a.description,
      'dcat:keyword': [...a.keywords],
      'dct:accrualPeriodicity': FREQUENCY_NEVER,
      'dct:temporal': { '@type': 'dct:PeriodOfTime', 'dcat:startDate': a.temporal.start, 'dcat:endDate': a.temporal.end },
      'dct:issued': a.issued,
      'dct:license': OPEN_LICENCE.url,
      'dct:source': a.sources.map((x) => x.url),
      'dct:provenance': a.provenance,
      'dct:language': 'hr',
      'dcat:distribution': a.distributions.map((x) => distribution(origin, x)),
    })),
  );
  return document;
}
