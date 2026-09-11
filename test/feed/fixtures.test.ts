import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { FetchContext, ItemKind, ModuleId, ModuleSnapshot } from '../../worker/feed/schema';
import { MODULES, MODULE_IDS } from '../../worker/feed/registry';
import { CKAN_PACKAGE_SHOW, ZBORNA_MJESTA_DATASET } from '../../worker/feed/modules/ckan-geo';

const NOW = new Date('2026-09-11T12:00:00.000Z');
const text = (name: string) => readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8');
const bytes = (name: string) => new Uint8Array(readFileSync(new URL(`../fixtures/${name}`, import.meta.url)));

/** Answers each upstream from the first fixture whose key the URL contains. */
function fixtureContext(routes: [string, () => BodyInit][]): FetchContext {
  return {
    now: () => NOW,
    fetch: async (url) => {
      const match = routes.find(([needle]) => url.includes(needle));
      if (!match) throw new Error(`no fixture for ${url}`);
      return new Response(match[1]());
    },
  };
}

const AKTI = JSON.stringify({ data: [{ id: 'a1b2', naziv: 'Odluka o proračunu Grada Zagreba' }] });
const ZBORNA_PACKAGE = JSON.stringify({
  success: true,
  result: {
    name: ZBORNA_MJESTA_DATASET,
    metadata_modified: '2026-09-01T08:00:00.000000',
    resources: [{ format: 'JSON', url: 'https://data.zagreb.hr/zborna-mjesta.json' }],
  },
});
const ZBORNA_RECORDS = JSON.stringify([{ naziv: 'Zrinjevac', adresa: 'Trg N. Š. Zrinskog', lat: 45.811, lon: 15.978 }]);

const CONTEXTS: Record<ModuleId, FetchContext> = {
  'zet-rt': fixtureContext([['gtfs-rt-protobuf', () => bytes('zet-rt.pb')]]),
  prometnice: fixtureContext([['data.json', () => text('prometnice.json')]]),
  'dhmz-now': fixtureContext([['hrvatska1_n.xml', () => text('hrvatska1_n.xml')]]),
  'dhmz-forecast': fixtureContext([['prognoza_danas.xml', () => text('prognoza_danas.xml')]]),
  'dhmz-cap': fixtureContext([['cap_hr_today.xml', () => text('cap_hr_today.xml')]]),
  emsc: fixtureContext([['seismicportal.eu', () => text('emsc.json')]]),
  'hrt-news': fixtureContext([
    ['vijesti/page.xml', () => text('hrt-vijesti.xml')],
    ['sljeme/latest.xml', () => text('hrt-sljeme.xml')],
  ]),
  glasnik: fixtureContext([
    ['sifarnici', () => text('glasnik_sifarnici.json')],
    ['akti', () => AKTI],
  ]),
  'ckan-geo': fixtureContext([
    ['Gradske_cetvrti', () => text('gradske_cetvrti.geojson')],
    [CKAN_PACKAGE_SHOW, () => ZBORNA_PACKAGE],
    ['zborna-mjesta.json', () => ZBORNA_RECORDS],
  ]),
};

const EXPECTED_KINDS: Record<ModuleId, ItemKind[]> = {
  'zet-rt': ['vehicle', 'observation'],
  prometnice: ['closure'],
  'dhmz-now': ['observation'],
  'dhmz-forecast': ['forecast'],
  'dhmz-cap': ['warning'],
  emsc: ['quake'],
  'hrt-news': ['news'],
  glasnik: ['act'],
  'ckan-geo': ['poi'],
};

describe.each(MODULE_IDS)('module %s against its real upstream sample', (id) => {
  let snapshot: Omit<ModuleSnapshot, 'status' | 'staleSince'>;

  it('produces at least one item through the registry fetcher', async () => {
    snapshot = await MODULES[id].fetcher(CONTEXTS[id]);
    expect(snapshot.items.length).toBeGreaterThan(0);
  });

  it('stamps the registry identity on the snapshot and on every item', async () => {
    snapshot ??= await MODULES[id].fetcher(CONTEXTS[id]);
    expect(snapshot.module).toBe(id);
    expect(snapshot.tier).toBe(MODULES[id].tier);
    expect(snapshot.attribution).toEqual(MODULES[id].attribution);
    expect(snapshot.fetchedAt).toBe(NOW.toISOString());
    for (const item of snapshot.items) {
      expect(item.module, `module of ${item.id}`).toBe(id);
      expect(item.tier, `tier of ${item.id}`).toBe(MODULES[id].tier);
      expect(item.id).toBeTruthy();
      expect(item.title).toBeTruthy();
    }
  });

  it('uses only the kinds this module declares', async () => {
    snapshot ??= await MODULES[id].fetcher(CONTEXTS[id]);
    const kinds = new Set(snapshot.items.map((item) => item.kind));
    for (const kind of kinds) expect(EXPECTED_KINDS[id]).toContain(kind);
  });

  it('writes every date as a round-trippable ISO 8601 instant', async () => {
    snapshot ??= await MODULES[id].fetcher(CONTEXTS[id]);
    const dates = [
      snapshot.sourceUpdatedAt,
      ...snapshot.items.flatMap((item) => [item.at, item.until]),
    ].filter((value): value is string => value !== undefined);
    for (const date of dates) {
      expect(date, `not ISO 8601: ${date}`).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(new Date(date).toISOString()).toBe(date);
    }
  });

  it('keeps geometry in GeoJSON order and inside a plausible Zagreb window', async () => {
    snapshot ??= await MODULES[id].fetcher(CONTEXTS[id]);
    for (const item of snapshot.items) {
      if (!item.geo) continue;
      const points = item.geo.type === 'Point' ? [item.geo.coordinates as number[]] : (item.geo.coordinates as number[][]);
      for (const [lon, lat] of points) {
        expect(Number.isFinite(lon) && Number.isFinite(lat), `bad point in ${item.id}`).toBe(true);
        expect(lon).toBeGreaterThan(10);
        expect(lon).toBeLessThan(22);
        expect(lat).toBeGreaterThan(40);
        expect(lat).toBeLessThan(50);
      }
    }
  });

  it('keeps item.data flat and free of undefined', async () => {
    snapshot ??= await MODULES[id].fetcher(CONTEXTS[id]);
    for (const item of snapshot.items) {
      for (const [key, value] of Object.entries(item.data ?? {})) {
        expect(['string', 'number', 'boolean'], `${item.id}.${key}`).toContain(typeof value);
      }
    }
  });
});

describe('the open tier is exactly the safety tier', () => {
  it('never leaks a session module into an open snapshot', async () => {
    for (const id of MODULE_IDS) {
      const snapshot = await MODULES[id].fetcher(CONTEXTS[id]);
      const tiers = new Set(snapshot.items.map((item) => item.tier));
      expect([...tiers]).toEqual(snapshot.items.length ? [MODULES[id].tier] : []);
    }
  });
});
