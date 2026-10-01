import { describe, expect, it } from 'vitest';
import type { FeedItem, ModuleId, ModuleSnapshot } from '../../worker/feed/schema';
import { FIXTURE_CONTEXTS, U3_FIXTURE_NOW } from './fixture-contexts';
import {
  ATTRIBUTION,

  MODULES,
  MODULE_IDS,
  OPEN_LICENCE,
  OPEN_MODULES,

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
  it('carries all seventeen modules with the refresh windows the plan fixes', () => {
    expect(MODULE_IDS).toHaveLength(17);
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
      // October 2026 (U3): the two large bodies (4 MB, 6.9 MB) are read once an hour; the City's programme keeps three days.
      'kultura-zg': [3600, 259200],
      programi: [3600, 259200],
      'dhmz-hourly': [3600, 21600],
      hak: [600, 21600],
      prekidi: [3600, 172800],
      // The more-city modules (R3): the radar every five minutes, the bio forecast and the waves once an hour.
      'dhmz-radar': [300, 1800],
      'dhmz-bio': [3600, 86400],
      'dhmz-waves': [3600, 86400],
    };
    for (const [id, [ttl, maxStale]] of Object.entries(windows) as [ModuleId, [number, number]][]) {
      expect(MODULES[id].ttl, `ttl of ${id}`).toBe(ttl);
      expect(MODULES[id].maxStale, `maxStale of ${id}`).toBe(maxStale);
      expect(MODULES[id].id).toBe(id);
    }
  });

  it('puts the safety tier in the open tier and everything else behind a session', () => {
    expect([...OPEN_MODULES].sort()).toEqual(['ckan-geo', 'dhmz-bio', 'dhmz-cap', 'dhmz-radar', 'dhmz-waves', 'emsc', 'prometnice']);
    expect(MODULE_IDS.filter((id) => MODULES[id].tier === 'session').sort()).toEqual(
      ['dhmz-forecast', 'dhmz-hourly', 'dhmz-now', 'dogadanja', 'glasnik', 'hak', 'kultura-zg', 'prekidi', 'programi', 'zet-rt'].sort(),
    );
    expect([...WARM_MODULES].sort()).toEqual(
      ['ckan-geo', 'dhmz-bio', 'dhmz-cap', 'dhmz-forecast', 'dhmz-hourly', 'dhmz-now', 'dhmz-radar', 'dhmz-waves', 'dogadanja', 'glasnik', 'hak', 'kultura-zg', 'prekidi', 'programi'].sort(),
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
      "Sadrži informacije Grada Zagreba (data.zagreb.hr) u skladu s Otvorenom dozvolom; skup 'Zatvaranje prometnica na području Grada Zagreba'",
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

  // U3: the strings of the brief's table (§7 and the Data table of docs/history/upgrade-2026-10-plan/U3.md), character for character.
  it('carries the attribution, address and licence of the five October modules verbatim', () => {
    expect(ATTRIBUTION['kultura-zg']).toEqual({
      text: 'Izvor: Guru za kulturu, Grad Zagreb (kultura.zagreb.hr), uz poveznicu na svako događanje',
      url: 'https://kultura.zagreb.hr/',
      licence: 'Ponovna uporaba uz navođenje izvora i poveznicu (kultura.zagreb.hr/pravila-koristenja)',
    });
    expect(ATTRIBUTION.programi).toEqual({
      text: 'Izvor: Knjižnice grada Zagreba; neslužbeni prikaz',
      url: 'https://www.kgz.hr/hr/dogadjanja/10',
      licence: 'Licenca nije navedena',
    });
    expect(ATTRIBUTION['dhmz-hourly']).toEqual({
      text: 'Izvor: DHMZ, Otvorena dozvola, {vrijeme}',
      url: 'https://meteo.hr/proizvodi.php?section=podaci&param=xml_korisnici',
      licence: OPEN_LICENCE,
    });
    expect(ATTRIBUTION.hak).toEqual({
      text: 'Izvor: HAK, stanje na cestama, {vrijeme}; neslužbeni prikaz',
      url: 'https://www.hak.hr/info/stanje-na-cestama/',
      licence: 'Uvjeti korištenja HAK-a, čl. 8: ograničen izbor uz izvor, vrijeme i poveznicu',
    });
    // R3: Gradska plinara Zagreb joins as the third publisher.
    expect(ATTRIBUTION.prekidi).toEqual({
      text: 'Izvor: HEP ODS Elektra Zagreb, Vodoopskrba i odvodnja i Gradska plinara Zagreb; neslužbeni prikaz',
      url: 'https://www.hep.hr/ods/bez-struje/19?dp=zagreb',
      licence: 'Licenca nije navedena',
    });
  });

  // R3: the three DHMZ modules of the more-city package, verbatim (docs/reveal-2026-10-plan/R3.md, registry rows).
  it('carries the attribution, address and licence of the three DHMZ modules of R3 verbatim', () => {
    expect(ATTRIBUTION['dhmz-radar']).toEqual({ text: 'Izvor: DHMZ, radarski kompozit', url: 'https://meteo.hr/podaci.php?section=podaci_mjerenja&param=radari', licence: OPEN_LICENCE });
    expect(ATTRIBUTION['dhmz-bio']).toEqual({ text: 'Izvor: DHMZ, biometeorološka prognoza', url: 'https://meteo.hr/prognoze.php?section=prognoze_specp&param=bio', licence: OPEN_LICENCE });
    expect(ATTRIBUTION['dhmz-waves']).toEqual({ text: 'Izvor: DHMZ, upozorenja na toplinske i hladne valove', url: 'https://meteo.hr/prognoze.php?section=prognoze_specp&param=toplinskival_5', licence: OPEN_LICENCE });
  });

  it('reads each October module through the registry on its saved response, with items of the kind it declares', async () => {
    for (const [id, kind] of [['kultura-zg', 'event'], ['programi', 'event'], ['dhmz-hourly', 'forecast'], ['hak', 'road'], ['prekidi', 'cut']] as const) {
      const snapshot = await MODULES[id].fetcher(FIXTURE_CONTEXTS[id]);
      expect(snapshot.items.length, id).toBeGreaterThan(0);
      expect(new Set(snapshot.items.map((item) => item.kind)), id).toEqual(new Set([kind]));
      // Every one but the hourly forecast (a complete series, no cap) says how much of its list it shows.
      if (id !== 'dhmz-hourly') expect(snapshot.coverage?.shown, id).toBe(snapshot.items.length);
    }
    // The composite one reports each publisher, as dogadanja does.
    const prekidi = await MODULES.prekidi.fetcher(FIXTURE_CONTEXTS.prekidi);
    expect(Object.keys(prekidi.sources ?? {}).sort()).toEqual(['gpz', 'hep-ods', 'vio']);
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
  it('carries every session module to the public screen: nothing the app fetches is held back before the scan', () => {
    expect([...TEASER_MODULES]).toEqual(['dhmz-now', 'zet-rt', 'dogadanja', 'dhmz-forecast', 'glasnik', 'kultura-zg', 'programi', 'dhmz-hourly', 'hak', 'prekidi']);
  });

  // 22 September ruling: every fetched module reaches the public screen with its credit. U3's five are read in full
  // except the two large ones, which the teaser cuts to the hours the wall can name.
  it('sends programi, hak and prekidi whole', async () => {
    for (const id of ['programi', 'hak', 'prekidi'] as const) {
      const snapshot = { ...(await MODULES[id].fetcher(FIXTURE_CONTEXTS[id])), status: 'live' as const };
      expect(teaserSubset(snapshot, undefined, U3_FIXTURE_NOW.getTime())).toBe(snapshot);
    }
  });

  it('cuts kultura-zg to what is not over two hours ago and starts within 36 hours, at most 120 by start', async () => {
    const fetched = await MODULES['kultura-zg'].fetcher(FIXTURE_CONTEXTS['kultura-zg']);
    const snapshot: ModuleSnapshot = { ...fetched, status: 'live' };
    expect(snapshot.items).toHaveLength(150);
    const now = U3_FIXTURE_NOW.getTime();
    const cut = teaserSubset(snapshot, undefined, now);
    // 17:45 on 29 Sep: the window is from 15:45 to 1 Oct 05:45 (Zagreb), so what starts on 1 Oct at 08:00 or later is out.
    for (const item of cut.items) {
      expect(Date.parse(item.until ?? item.at!)).toBeGreaterThanOrEqual(now - 2 * 3_600_000);
      expect(Date.parse(item.at!)).toBeLessThanOrEqual(now + 36 * 3_600_000);
    }
    expect(cut.items.length).toBeGreaterThan(0);
    expect(cut.items.length).toBeLessThan(snapshot.items.length);
    const starts = cut.items.map((item) => Date.parse(item.at!));
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
    // Everything the window admits is there while it fits the cap.
    const admitted = snapshot.items.filter((item) => Date.parse(item.until ?? item.at!) >= now - 2 * 3_600_000 && Date.parse(item.at!) <= now + 36 * 3_600_000);
    expect(admitted.length).toBeLessThanOrEqual(120);
    expect(cut.items.map((item) => item.id).sort()).toEqual(admitted.map((item) => item.id).sort());
    expect(cut.coverage).toMatchObject({ shown: cut.items.length, total: 150, limited: true });
    expect(cut.attribution).toBe(snapshot.attribution);
    // The cap: 300 admitted occurrences leave the 120 that start first.
    const many = { ...snapshot, items: Array.from({ length: 300 }, (_, n) => ({ ...snapshot.items[0]!, id: `kultura-zg:${n}`, at: new Date(now + n * 60_000).toISOString(), until: new Date(now + n * 60_000 + 3_600_000).toISOString() })) };
    const capped = teaserSubset(many, undefined, now);
    expect(capped.items).toHaveLength(120);
    expect(capped.items[0]!.id).toBe('kultura-zg:0');
    expect(capped.items[119]!.id).toBe('kultura-zg:119');
  });

  it('cuts dhmz-hourly to the steps from an hour ago to 36 hours ahead', async () => {
    const fetched = await MODULES['dhmz-hourly'].fetcher(FIXTURE_CONTEXTS['dhmz-hourly']);
    const snapshot: ModuleSnapshot = { ...fetched, status: 'live' };
    expect(snapshot.items).toHaveLength(168);
    const now = U3_FIXTURE_NOW.getTime();
    const cut = teaserSubset(snapshot, undefined, now);
    // Steps at 16:00Z (the hour before 15:45Z is 14:45Z, so 15:00Z is the first) through 1 Oct 03:00Z: 37 per station.
    expect(cut.items).toHaveLength(2 * 37);
    for (const item of cut.items) {
      expect(Date.parse(item.at!)).toBeGreaterThanOrEqual(now - 3_600_000);
      expect(Date.parse(item.at!)).toBeLessThanOrEqual(now + 36 * 3_600_000);
    }
    expect(cut.items.filter((item) => item.data?.station === 'gric')[0]!.at).toBe('2026-09-29T15:00:00.000Z');
    expect(cut.items.filter((item) => item.data?.station === 'gric').at(-1)!.at).toBe('2026-10-01T03:00:00.000Z');
    expect(cut.coverage?.shown).toBe(74);
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

  it('passes dogadanja whole: every source, the module\u2019s own attribution, nothing cut or reordered', () => {
    const merged = snapshot('dogadanja', [
      item({ id: 'kulturpunkt:1', kind: 'event', title: 'Izložba', module: 'dogadanja', data: { source: 'kulturpunkt' } }),
      item({ id: 'skupstina:1', kind: 'event', title: '13. sjednica', module: 'dogadanja', at: '2026-09-11T12:00:00.000Z', data: { source: 'skupstina' } }),
      item({ id: 'etnografski:1', kind: 'event', title: 'Radionica', module: 'dogadanja', data: { source: 'etnografski' } }),
      item({ id: 'zet-promet:1', kind: 'event', title: 'Obilazak', module: 'dogadanja', data: { source: 'zet-promet' } }),
    ]);
    expect(teaserSubset(merged)).toBe(merged);
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
