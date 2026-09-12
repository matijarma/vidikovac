import { describe, expect, it } from 'vitest';
import type { FeedItem, ModuleId, ModuleSnapshot } from '../../worker/feed/schema';
import {
  ATTRIBUTION,
  MODULES,
  MODULE_IDS,
  OPEN_MODULES,
  TEASER_MODULES,
  TEASER_NEWS_LIMIT,
  WARM_MODULES,
  isModuleId,
  teaserSubset,
} from '../../worker/feed/registry';

describe('module registry', () => {
  it('carries all ten modules with the refresh windows the plan fixes', () => {
    expect(MODULE_IDS).toHaveLength(10);
    const windows: Record<ModuleId, [number, number]> = {
      'zet-rt': [30, 300],
      prometnice: [180, 1800],
      emsc: [60, 3600],
      'dhmz-cap': [300, 7200],
      'dhmz-now': [600, 7200],
      'dhmz-forecast': [1800, 86400],
      'hrt-news': [300, 7200],
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
      ['dhmz-forecast', 'dhmz-now', 'dogadanja', 'glasnik', 'hrt-news', 'zet-rt'].sort(),
    );
    expect([...WARM_MODULES].sort()).toEqual(
      ['ckan-geo', 'dhmz-cap', 'dhmz-forecast', 'dhmz-now', 'dogadanja', 'glasnik', 'hrt-news'].sort(),
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
    expect(ATTRIBUTION['hrt-news']).toEqual({
      text: 'Izvor: HRT, {naslov}, poveznica na izvornik',
      url: 'https://feed.hrt.hr/vijesti/page.xml',
      licence: 'HRT uvjeti korištenja, tekst uz navođenje izvora i poveznicu',
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
  it('names the three session modules the kiosk may show without a scan', () => {
    expect([...TEASER_MODULES]).toEqual(['dhmz-now', 'zet-rt', 'hrt-news']);
    expect(TEASER_NEWS_LIMIT).toBe(3);
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

  it('keeps dhmz-now whole and cuts the news to three headlines', () => {
    const weather = snapshot('dhmz-now', [item({ id: 'zagreb-maksimir', kind: 'observation', title: 'Zagreb-Maksimir', module: 'dhmz-now' })]);
    expect(teaserSubset(weather)).toEqual(weather);

    const news = snapshot(
      'hrt-news',
      Array.from({ length: 8 }, (_, n) => item({ id: `n${n}`, kind: 'news', title: `Naslov ${n}`, module: 'hrt-news' })),
    );
    const cut = teaserSubset(news);
    expect(cut.items).toHaveLength(3);
    expect(cut.items.map((i) => i.id)).toEqual(['n0', 'n1', 'n2']);
    expect(cut.status).toBe('live');
    expect(cut.attribution).toEqual(news.attribution);
  });

  it('leaves an open module untouched', () => {
    const open = snapshot('emsc', [item({ id: 'q1', kind: 'quake', title: 'Potres', module: 'emsc', tier: 'open' })]);
    expect(teaserSubset(open)).toEqual(open);
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
