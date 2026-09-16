import { describe, expect, it } from 'vitest';
import type { FeedItem, ModuleId, ModuleSnapshot } from '../../worker/feed/schema';
import { FIXTURE_CONTEXTS } from './fixture-contexts';
import {
  ATTRIBUTION,
  DOGADANJA_OPEN_ATTRIBUTION,
  MODULES,
  MODULE_IDS,
  OPEN_LICENCE,
  OPEN_MODULES,
  TEASER_EVENTS_LIMIT,
  TEASER_MODULES,
  WARM_MODULES,
  isModuleId,
  teaserSubset,
} from '../../worker/feed/registry';

describe('module registry', () => {
  it('preserves subsource health and coverage through generic and dogadanja wrappers', async () => {
    for (const id of ['ckan-geo', 'dogadanja'] as const) {
      const snapshot = await MODULES[id].fetcher(FIXTURE_CONTEXTS[id]);
      expect(Object.keys(snapshot.sources ?? {}).length).toBeGreaterThan(1);
      expect(snapshot.coverage?.shown).toBe(snapshot.items.length);
      expect(Object.values(snapshot.sources!).reduce((sum, source) => sum + source.itemCount, 0)).toBe(snapshot.items.length);
    }
  });
  it('carries all nine modules with the refresh windows the plan fixes', () => {
    expect(MODULE_IDS).toHaveLength(9);
    const windows: Record<ModuleId, [number, number]> = {
      'zet-rt': [10, 300], // R-TE4: the twin's tick; the Cache API entry actually lasts until validUntil
      prometnice: [180, 1800],
      emsc: [60, 3600],
      'dhmz-cap': [300, 7200],
      'dhmz-now': [600, 7200],
      'dhmz-forecast': [1800, 86400],
      glasnik: [3600, 604800],
      'ckan-geo': [86400, 2592000],
      dogadanja: [900, 86400],
    };
    for (const [id, [ttl, maxStale]] of Object.entries(windows) as [ModuleId, [number, number]][]) {
      expect(MODULES[id].ttl, `ttl of ${id}`).toBe(ttl);
      expect(MODULES[id].maxStale, `maxStale of ${id}`).toBe(maxStale);
      expect(MODULES[id].id).toBe(id);
    }
  });

  it('puts the safety tier in the open tier and everything else behind a session', () => {
    expect([...OPEN_MODULES].sort()).toEqual(['ckan-geo', 'dhmz-cap', 'emsc', 'prometnice']);
    expect(MODULE_IDS.filter((id) => MODULES[id].tier === 'session').sort()).toEqual(
      ['dhmz-forecast', 'dhmz-now', 'dogadanja', 'glasnik', 'zet-rt'].sort(),
    );
    expect([...WARM_MODULES].sort()).toEqual(
      ['ckan-geo', 'dhmz-cap', 'dhmz-forecast', 'dhmz-now', 'dogadanja', 'glasnik'].sort(),
    );
    expect(isModuleId('zet-rt')).toBe(true);
    expect(isModuleId('nepostojeci')).toBe(false);
  });

  it('uses the attribution strings ruling R-08 fixes, braces and all', () => {
    expect(ATTRIBUTION['zet-rt'].text).toBe(
      'Public dataset by ZET provided under Open license, dataset source http://www.zet.hr/odredbe/datoteke-u-gtfs-formatu/669',
    );
    expect(ATTRIBUTION['zet-rt'].url).toBe('http://www.zet.hr/odredbe/datoteke-u-gtfs-formatu/669');
    expect(ATTRIBUTION.prometnice.text).toBe(
      "Sadrži informacije Grada Zagreba (data.zagreb.hr) u skladu s Otvorenom dozvolom; skup 'Zatvaranje prometnica na području Grada Zagreba', posljednja izmjena {datum}",
    );
    expect(ATTRIBUTION.prometnice.url).toBe('https://data.zagreb.hr/dataset/prometnice');
    expect(ATTRIBUTION['ckan-geo'].text).toBe(
      "Sadrži informacije Grada Zagreba (data.zagreb.hr) u skladu s Otvorenom dozvolom; skup '{naziv}', posljednja izmjena {datum}",
    );
    expect(ATTRIBUTION['ckan-geo'].url).toBe('https://data.zagreb.hr/');
    for (const id of ['dhmz-cap', 'dhmz-now', 'dhmz-forecast'] as ModuleId[]) {
      expect(ATTRIBUTION[id].text).toBe('Izvor: DHMZ, Otvorena dozvola, {vrijeme}');
      expect(ATTRIBUTION[id].url).toBe('https://meteo.hr/proizvodi.php?section=podaci&param=xml_korisnici');
      expect(ATTRIBUTION[id].licence).toBe('Otvorena dozvola (NN 67/17)');
    }
    expect(ATTRIBUTION.emsc).toEqual({
      text: 'Izvor: EMSC, seismicportal.eu',
      url: 'https://www.seismicportal.eu/',
      licence: 'EMSC terms',
    });
    expect(ATTRIBUTION.glasnik.text).toBe('Izvor: Službeni glasnik Grada Zagreba, {broj}/{godina}, akt {id}');
    expect(ATTRIBUTION.glasnik.url).toBe('https://www1.zagreb.hr/sluzbeni-glasnik/');
    for (const id of ['prometnice', 'ckan-geo', 'glasnik', 'zet-rt'] as ModuleId[]) {
      expect(ATTRIBUTION[id].licence).toBe('Otvorena dozvola (NN 67/17)');
    }
    for (const id of MODULE_IDS) expect(MODULES[id].attribution).toEqual(ATTRIBUTION[id]);
  });
});

function snapshot(module: ModuleId, items: FeedItem[]): ModuleSnapshot {
  return {
    module,
    tier: MODULES[module].tier,
    status: 'live',
    fetchedAt: '2026-09-11T10:00:00.000Z',
    attribution: MODULES[module].attribution,
    items,
  };
}

function item(over: Partial<FeedItem> & Pick<FeedItem, 'id' | 'kind' | 'title'>): FeedItem {
  return { module: 'zet-rt', tier: 'session', ...over };
}

describe('teaserSubset', () => {
  it('does not manufacture a zero fleet summary from an unavailable source', () => {
    const missing = { ...snapshot('zet-rt', []), status: 'down' as const };
    expect(teaserSubset(missing).items).toEqual([]);
  });
  it('names the three session modules the kiosk may show without a scan', () => {
    expect([...TEASER_MODULES]).toEqual(['dhmz-now', 'zet-rt', 'dogadanja']);
  });

  // R-P1: the whole-fleet count stays (the panorama and the catalogue read
  // it), the per-route delay rows stay, and the pins inside the default
  // screen's box come along with their geo so the locked kiosk's schematic
  // has evidence to work from; pins elsewhere in the city are dropped.
  it('reduces zet-rt to the fleet count, the pins inside the kiosk box, and the per-route delay summaries', () => {
    const reduced = teaserSubset(
      snapshot('zet-rt', [
        item({ id: 'vehicle:1', kind: 'vehicle', title: 'Linija 12', geo: { type: 'Point', coordinates: [15.977, 45.813] }, data: { routeId: '12', routeType: 0 } }),
        item({ id: 'vehicle:2', kind: 'vehicle', title: 'Linija 12', geo: { type: 'Point', coordinates: [16.06, 45.83] }, data: { routeId: '12', routeType: 0 } }),
        item({ id: 'vehicle:3', kind: 'vehicle', title: 'Linija 12' }),
        item({ id: 'route:12', kind: 'vehicle', title: 'Linija 12', data: { routeId: '12', medianDelaySeconds: -102, vehicles: 2 } }),
      ]),
    );
    expect(reduced.items.map((i) => i.id)).toEqual(['vozila', 'vehicle:1', 'route:12']);
    expect(reduced.items[0]).toMatchObject({ id: 'vozila', kind: 'vehicle', title: '3 vozila u pokretu', data: { vehicles: 3 } });
    expect(reduced.items[1]).toMatchObject({ geo: { type: 'Point', coordinates: [15.977, 45.813] }, data: { routeId: '12', routeType: 0 } });
  });

  it('uses the Croatian singular for exactly one vehicle', () => {
    const one = teaserSubset(snapshot('zet-rt', [item({ id: 'vehicle:1', kind: 'vehicle', title: 'Linija 6' })]));
    expect(one.items[0].title).toBe('1 vozilo u pokretu');
    const twentyOne = teaserSubset(
      snapshot('zet-rt', Array.from({ length: 21 }, (_, n) => item({ id: `vehicle:${n}`, kind: 'vehicle', title: 'Linija 6' }))),
    );
    expect(twentyOne.items[0].title).toBe('21 vozilo u pokretu');
  });

  it('keeps dhmz-now whole: the one station the teaser carries is not cut', () => {
    const weather = snapshot('dhmz-now', [item({ id: 'zagreb-maksimir', kind: 'observation', title: 'Zagreb-Maksimir', module: 'dhmz-now' })]);
    expect(teaserSubset(weather)).toEqual(weather);
  });

  it('cuts dogadanja to its Otvorena dozvola rows and restates the attribution without Kulturpunkt (E8: the kiosk is the open tier)', () => {
    const merged = snapshot('dogadanja', [
      item({ id: 'kulturpunkt:1', kind: 'event', title: 'Izložba', module: 'dogadanja', data: { source: 'kulturpunkt' } }),
      item({ id: 'skupstina:1', kind: 'event', title: '13. sjednica', module: 'dogadanja', data: { source: 'skupstina' } }),
      item({ id: 'etnografski:1', kind: 'event', title: 'Radionica', module: 'dogadanja', data: { source: 'etnografski' } }),
      item({ id: 'zet-promet:1', kind: 'event', title: 'Obilazak', module: 'dogadanja', data: { source: 'zet-promet' } }),
      item({ id: 'kvartovske:1', kind: 'event', title: 'Kvart', module: 'dogadanja', data: { source: 'kvartovske' } }),
      item({ id: 'komunalne:1', kind: 'event', title: 'Ulica', module: 'dogadanja', data: { source: 'komunalne' } }),
    ]);
    const reduced = teaserSubset(merged);
    expect(reduced.items.map((i) => i.id)).toEqual(['skupstina:1', 'zet-promet:1', 'kvartovske:1', 'komunalne:1']);
    expect(reduced.status).toBe('live');
    expect(reduced.attribution).toEqual(DOGADANJA_OPEN_ATTRIBUTION);
    expect(reduced.attribution.licence).toBe(OPEN_LICENCE);
    expect(reduced.attribution.text).not.toContain('Kulturpunkt');
    expect(reduced.attribution.text).not.toContain('CC BY-SA');
    expect(reduced.attribution.text).not.toContain('Etnografski');
    // The merged module attribution names all six sources and two licences; that is right for the session view and wrong for the open one.
    expect(merged.attribution).toBe(MODULES.dogadanja.attribution);
    expect('sourceCounts' in reduced).toBe(false);
  });

  it('filters dogadanja by licence before cutting it to ten rows, so the cap never eats an open row', () => {
    expect(TEASER_EVENTS_LIMIT).toBe(10);
    const rows = Array.from({ length: 30 }, (_, n) =>
      item({ id: `r${n}`, kind: 'event', title: `Red ${n}`, module: 'dogadanja', data: { source: n % 2 ? 'kulturpunkt' : 'skupstina' } }),
    );
    const reduced = teaserSubset(snapshot('dogadanja', rows));
    expect(reduced.items).toHaveLength(10);
    expect(reduced.items.map((i) => i.id)).toEqual(Array.from({ length: 10 }, (_, n) => `r${2 * n}`));
  });

  it('keeps open module data intact and describes the displayed coverage', () => {
    const open = snapshot('emsc', [item({ id: 'q1', kind: 'quake', title: 'Potres', module: 'emsc', tier: 'open' })]);
    expect(teaserSubset(open)).toMatchObject(open);
    expect(teaserSubset(open).coverage?.shown).toBe(1);
  });

  it('cuts emsc to the ten most recent quakes, newest first', () => {
    const quakes = snapshot(
      'emsc',
      Array.from({ length: 25 }, (_, n) =>
        item({
          id: `q${n}`,
          kind: 'quake',
          title: 'Potres',
          module: 'emsc',
          tier: 'open',
          at: new Date(Date.UTC(2026, 8, 11, 10, 0, 0) - n * 60_000).toISOString(),
        }),
      ),
    );
    const reduced = teaserSubset(quakes);
    expect(reduced.items).toHaveLength(10);
    expect(reduced.items[0].id).toBe('q0');
    expect(reduced.items.map((i) => i.id)).toEqual(Array.from({ length: 10 }, (_, n) => `q${n}`));
  });
});
