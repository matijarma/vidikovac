// Shared between test/app/attribution.test.ts and test/open/attribution.test.ts
// (R-62): one fixture, so the app and worker copies of fillAttribution are
// proven identical, not just individually plausible. Every attribution comes
// straight from the registry (worker/feed/registry.ts's ATTRIBUTION) so a
// future change to R-08's wording cannot make this fixture drift silently.
import { ATTRIBUTION } from '../../worker/feed/registry';
import type { FeedItem, ModuleSnapshot } from '../../worker/feed/schema';

export interface AttributionCase {
  name: string;
  attribution: { text: string; url: string; licence: string };
  snapshot: Pick<ModuleSnapshot, 'sourceUpdatedAt' | 'fetchedAt'>;
  item?: FeedItem;
  expected: string;
}

// 2026-09-11T13:00:00Z / 13:20:00Z are 15:00 / 15:20 in Zagreb (CEST, UTC+2).
const SOURCE_UPDATED_AT = '2026-09-11T13:00:00Z';
const FETCHED_AT = '2026-09-11T13:20:00Z';

const HRT_ITEM: FeedItem = {
  id: 'n1',
  module: 'hrt-news',
  kind: 'news',
  tier: 'session',
  title: 'Predsjednik potpisao zakon',
};

const GLASNIK_ITEM: FeedItem = {
  id: '48210',
  module: 'glasnik',
  kind: 'act',
  tier: 'session',
  title: 'Odluka o komunalnom redu',
  data: { broj: 25, godina: '2026' },
};

const CKAN_ITEM: FeedItem = {
  id: 'zborna-mjesta:1',
  module: 'ckan-geo',
  kind: 'poi',
  tier: 'open',
  title: 'Zborno mjesto Zrinjevac',
  data: { layer: 'zborna-mjesta', category: 'Zborno mjesto civilne zaštite' },
};

export const ATTRIBUTION_CASES: readonly AttributionCase[] = [
  {
    name: 'DHMZ template with a sourceUpdatedAt',
    attribution: ATTRIBUTION['dhmz-cap'],
    snapshot: { sourceUpdatedAt: SOURCE_UPDATED_AT, fetchedAt: FETCHED_AT },
    expected: 'Izvor: DHMZ, Otvorena dozvola, 11. 9. 2026. 15:00',
  },
  {
    name: 'DHMZ template without a sourceUpdatedAt falls back to the fetch time (R-25)',
    attribution: ATTRIBUTION['dhmz-cap'],
    snapshot: { fetchedAt: FETCHED_AT },
    expected: 'Izvor: DHMZ, Otvorena dozvola, dohvaćeno 11. 9. 2026. 15:20',
  },
  {
    name: 'HRT template with an item',
    attribution: ATTRIBUTION['hrt-news'],
    snapshot: { fetchedAt: FETCHED_AT },
    item: HRT_ITEM,
    expected: 'Izvor: HRT, Predsjednik potpisao zakon, poveznica na izvornik',
  },
  {
    name: 'glasnik template with an act item',
    attribution: ATTRIBUTION.glasnik,
    snapshot: { fetchedAt: FETCHED_AT },
    item: GLASNIK_ITEM,
    expected: 'Izvor: Službeni glasnik Grada Zagreba, 25/2026, akt 48210',
  },
  {
    name: 'prometnice template falls back to the fetch time (R-25: no sourceUpdatedAt in data.json)',
    attribution: ATTRIBUTION.prometnice,
    snapshot: { fetchedAt: FETCHED_AT },
    expected:
      "Sadrži informacije Grada Zagreba (data.zagreb.hr) u skladu s Otvorenom dozvolom; skup 'Zatvaranje prometnica na području Grada Zagreba', posljednja izmjena dohvaćeno 11. 9. 2026. 15:20",
  },
  {
    name: 'ckan-geo template names the dataset from the item category',
    attribution: ATTRIBUTION['ckan-geo'],
    snapshot: { sourceUpdatedAt: SOURCE_UPDATED_AT, fetchedAt: FETCHED_AT },
    item: CKAN_ITEM,
    expected:
      "Sadrži informacije Grada Zagreba (data.zagreb.hr) u skladu s Otvorenom dozvolom; skup 'Zborno mjesto civilne zaštite', posljednja izmjena 11. 9. 2026. 15:00",
  },
];

/** A snapshot with no item at all: the worst case for {naslov}/{naziv}/
 *  {broj}/{godina}/{id}, used to prove no module's template can leak a brace
 *  even then. */
export const NO_ITEM_SNAPSHOT: Pick<ModuleSnapshot, 'sourceUpdatedAt' | 'fetchedAt'> = {
  fetchedAt: FETCHED_AT,
};
