// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import type { ModuleSnapshot } from '../../worker/feed/schema';
import { LAYERS } from '../../worker/protocol';
import { createDefaultI18n } from '../../app/src/i18n/create-default-i18n';
import { publicItemKey } from '../../app/src/core/contracts';
import { ALL_LAYER_MODULES, LAYER_MODULES, LAYER_RENDERERS, renderLayer } from '../../app/src/layers';
import { cultureEvents, cultureEventsEmptyText } from '../../app/src/layers/kultura';
import { delayWord, vehicleCount } from '../../app/src/layers/shared';
import { summariseRoutes, type RouteVehicle } from '../../app/src/layers/route-summary';
import { routeDelays } from '../../app/src/layers/u-pokretu';
import { cityWorkEmptyText, cityWorkEvents } from '../../app/src/layers/uprava-i-pravo';
import { createMapSlots } from '../../app/src/map/map-slots';
import type { LayerContext } from '../../app/src/layers/types';

const NOW = Date.parse('2026-09-11T12:32:00Z'); // 14:32 in Zagreb
const attr = (text: string) => ({ text, url: 'https://example.test/', licence: 'Otvorena dozvola (NN 67/17)' });
const base = (module: ModuleSnapshot['module'], items: ModuleSnapshot['items']): ModuleSnapshot => ({
  module, tier: 'open', status: 'live', fetchedAt: new Date(NOW - 60_000).toISOString(),
  attribution: attr(`Izvor: ${module}`), items,
});

const SNAPSHOTS: Partial<Record<ModuleSnapshot['module'], ModuleSnapshot>> = {
  'dhmz-now': base('dhmz-now', [{ id: 'o1', module: 'dhmz-now', kind: 'observation', tier: 'open', title: 'Maksimir', at: '2026-09-11T12:00:00Z', data: { temp: 21, humidity: 54, pressure: 1013, windDir: 'SZ', windSpeed: 2, weather: 'vedro' } }]),
  'dhmz-forecast': base('dhmz-forecast', [{ id: 'f1', module: 'dhmz-forecast', kind: 'forecast', tier: 'open', title: 'Zagreb', summary: 'Sunčano', data: { tmin: 12, tmax: 24 } }]),
  'dhmz-cap': base('dhmz-cap', [{ id: 'w1', module: 'dhmz-cap', kind: 'warning', tier: 'open', title: 'Grmljavinsko nevrijeme', summary: 'Moguć jak vjetar', severity: 'moderate', at: '2026-09-11T12:00:00Z', until: '2026-09-11T18:00:00Z' }]),
  // Three moving pins plus one delay summary per route, exactly the shape
  // zet-rt emits (R-22): both are kind 'vehicle', the id prefix separates them.
  'zet-rt': base('zet-rt', [
    { id: 'vehicle:1', module: 'zet-rt', kind: 'vehicle', tier: 'session', title: '6', geo: { type: 'Point', coordinates: [15.97, 45.81] }, data: { routeId: '6', routeShortName: '6' } },
    { id: 'vehicle:2', module: 'zet-rt', kind: 'vehicle', tier: 'session', title: '6', geo: { type: 'Point', coordinates: [15.98, 45.82] }, data: { routeId: '6', routeShortName: '6' } },
    { id: 'vehicle:3', module: 'zet-rt', kind: 'vehicle', tier: 'session', title: '11', geo: { type: 'Point', coordinates: [15.99, 45.80] }, data: { routeId: '11', routeShortName: '11' } },
    { id: 'route:6', module: 'zet-rt', kind: 'vehicle', tier: 'session', title: '6', summary: 'kasni 2 min', data: { routeId: '6', routeShortName: '6', medianDelaySeconds: 90, vehicles: 2 } },
    { id: 'route:11', module: 'zet-rt', kind: 'vehicle', tier: 'session', title: '11', summary: 'na vrijeme', data: { routeId: '11', routeShortName: '11', medianDelaySeconds: -30, vehicles: 1 } },
  ]),
  prometnice: base('prometnice', [
    { id: 'c1', module: 'prometnice', kind: 'closure', tier: 'open', title: 'Grada Vukovara', at: '2026-04-18T07:00:00Z', until: '2026-09-11T22:00:00Z', geo: { type: 'LineString', coordinates: [[15.959, 45.799], [15.957, 45.799]] }, data: { type: 'ROAD_CLOSED', subtype: 'ROAD_CLOSED_CONSTRUCTION', direction: 'ONE_DIRECTION' } },
  ]),
  emsc: base('emsc', [{ id: 'q1', module: 'emsc', kind: 'quake', tier: 'open', title: 'CROATIA', at: '2026-09-09T17:11:21Z', geo: { type: 'Point', coordinates: [14.36, 45.45] }, data: { mag: 1.6, depth: 10 } }]),
  'hrt-news': base('hrt-news', [{ id: 'n1', module: 'hrt-news', kind: 'news', tier: 'open', title: 'Naslov vijesti', summary: 'Sažetak', link: 'https://vijesti.hrt.hr/clanak', at: '2026-09-11T11:00:00Z' }]),
  glasnik: base('glasnik', [{ id: 'a1', module: 'glasnik', kind: 'act', tier: 'open', title: 'Odluka o nečemu', link: 'https://www1.zagreb.hr/akt', data: { broj: '21', godina: '2026' } }]),
  'ckan-geo': base('ckan-geo', [{ id: 'p1', module: 'ckan-geo', kind: 'poi', tier: 'open', title: 'Zborno mjesto Trešnjevka', data: { layer: 'zborna-mjesta', category: 'Zborno mjesto civilne zaštite' } }]),
  // All six of dogadanja's sources in one merged snapshot (session tier), the
  // same shape fetchDogadanja produces: kultura.ts and uprava-i-pravo.ts each
  // read this one module and filter to their own three/two sources. ZET's two
  // notice feeds ('zet-novosti' here) are deliberately included to prove
  // neither panel ever shows them (E8's kiosk teaser is their only screen).
  dogadanja: {
    ...base('dogadanja', [
      { id: 'kulturpunkt:1', module: 'dogadanja', kind: 'event', tier: 'session', title: 'Koncert u parku', link: 'https://kulturpunkt.hr/clanak/1', at: '2026-09-12T18:00:00Z', data: { source: 'kulturpunkt', category: 'koncert', precision: 'time' } },
      { id: 'etnografski:2', module: 'dogadanja', kind: 'event', tier: 'session', title: 'Izložba tradicijskog nakita', link: 'https://emz.hr/izlozba', at: '2026-09-10T09:00:00Z', until: '2026-10-01T18:00:00Z', data: { source: 'etnografski', category: 'izlozba', venue: 'Studentski centar', precision: 'time' } },
      { id: 'kvartovske:3', module: 'dogadanja', kind: 'event', tier: 'session', title: 'Novo dječje igralište u Trešnjevci', link: 'https://aktivnosti.zagreb.hr/n/3', at: '2026-09-11T00:00:00Z', data: { source: 'kvartovske', precision: 'day' } },
      { id: 'skupstina:4', module: 'dogadanja', kind: 'event', tier: 'session', title: 'Poziv na 13. sjednicu Gradske skupštine Grada Zagreba', link: 'https://skupstina.zagreb.hr/poziv', at: '2026-09-14T09:00:00Z', dateBasis: 'event', data: { source: 'skupstina', organiser: 'Gradske skupštine Grada Zagreba', category: 'sjednica-skupstine', precision: 'time', venue: 'Stara gradska vijećnica', live: 'youtube' } },
      { id: 'komunalne:5', module: 'dogadanja', kind: 'event', tier: 'session', title: 'Horvati, ulica Širanovići', summary: 'izrada projektne dokumentacije za vodoopskrbu', at: '2026-06-01T00:00:00Z', data: { source: 'komunalne', phase: 'Radovi u tijeku', status: 'U tijeku', amount: 1500, precision: 'day' } },
      { id: 'zet-novosti:6', module: 'dogadanja', kind: 'event', tier: 'session', title: 'Izmjena reda vožnje linije 6', link: 'https://zet.hr/vijest/6', at: '2026-09-11T08:00:00Z', data: { source: 'zet-novosti', precision: 'time' } },
    ]),
    sourceCounts: { kulturpunkt: 1, skupstina: 1, kvartovske: 1, komunalne: 1, 'zet-rss': 1, etnografski: 1 },
  } as ModuleSnapshot & { sourceCounts: Record<string, number> },
};

function ctx(over: Partial<LayerContext> = {}): LayerContext {
  return { i18n: createDefaultI18n('hr'), snapshots: SNAPSHOTS, now: NOW, ...over };
}
const text = (el: Element | null): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

// Fixtures with more rows than a single default page, for T1.4's paging tests.
// Real shapes (module, kind, data) match the single-item SNAPSHOTS above.
const MANY_ACTS: ModuleSnapshot = base(
  'glasnik',
  Array.from({ length: 25 }, (_, i) => ({
    id: `a${i + 1}`, module: 'glasnik', kind: 'act', tier: 'open', title: `Odluka broj ${i + 1}`,
    link: `https://www1.zagreb.hr/akt/${i + 1}`, data: { broj: String(i + 1), godina: '2026' },
  })) as ModuleSnapshot['items'],
);
const MANY_POINTS: ModuleSnapshot = base(
  'ckan-geo',
  Array.from({ length: 40 }, (_, i) => ({
    id: `p${i + 1}`, module: 'ckan-geo', kind: 'poi', tier: 'open', title: `Zborno mjesto ${i + 1}`,
    data: { layer: 'zborna-mjesta', category: 'Zborno mjesto civilne zaštite' },
  })) as ModuleSnapshot['items'],
);
const MANY_CLOSURES: ModuleSnapshot = base(
  'prometnice',
  Array.from({ length: 20 }, (_, i) => ({
    id: `c${i + 1}`, module: 'prometnice', kind: 'closure', tier: 'open', title: `Ulica ${i + 1}`,
    at: '2026-09-01T00:00:00Z', until: '2026-09-30T00:00:00Z',
    data: { type: 'ROAD_CLOSED', subtype: 'ROAD_CLOSED_CONSTRUCTION', direction: 'ONE_DIRECTION' },
  })) as ModuleSnapshot['items'],
);

describe('layer registry', () => {
  it('has a renderer and a module list for every LayerId', () => {
    for (const layer of LAYERS) {
      expect(typeof LAYER_RENDERERS[layer]).toBe('function');
      expect(Array.isArray(LAYER_MODULES[layer])).toBe(true);
    }
    expect(LAYER_MODULES.kultura).toEqual(['dogadanja']);
    expect(LAYER_MODULES['uprava-i-pravo']).toEqual(['glasnik', 'dogadanja']);
    expect(LAYER_MODULES['u-pokretu']).toEqual(['zet-rt', 'prometnice', 'dogadanja']);
    expect(LAYER_MODULES['zrak-i-nebo']).toContain('dhmz-now');
    expect(ALL_LAYER_MODULES).toContain('glasnik');
    expect(new Set(ALL_LAYER_MODULES).size).toBe(ALL_LAYER_MODULES.length);
  });
  it('every layer renders a focusable heading with the Croatian layer name', () => {
    for (const layer of LAYERS) {
      const section = renderLayer(layer, ctx());
      expect(section.getAttribute('data-layer')).toBe(layer);
      expect(text(section.querySelector('.layer-title'))).toBe(createDefaultI18n('hr').t(`layers.${layer}`));
      expect(section.querySelector('.layer-title')?.getAttribute('tabindex')).toBe('-1');
    }
  });
});

describe('grad-sada (Sada, the overview)', () => {
  it('composes weather, safety, transit, agenda, news and the gazette from real values, with no clock and no fleet hero', () => {
    const section = renderLayer('grad-sada', ctx());
    expect(section.querySelector('[data-testid=clock]')).toBeNull();
    expect(text(section.querySelector('[data-testid=temp]'))).toBe('21 °C');
    const weather = text(section.querySelector('#ov-weather'));
    expect(weather).toContain('vlaga 54 %');
    expect(weather).toContain('danas od 12 do 24 °C');
    expect(weather).not.toContain('Sunčano'); // the forecast prose belongs to the weather domain
    const safety = section.querySelector('#ov-safety')!;
    expect(safety.getAttribute('data-level')).toBe('urgent');
    expect(text(safety)).toContain('žuto upozorenje');
    expect(text(safety)).toContain('1 zatvorena prometnica sada');
    expect(text(section.querySelector('[data-testid=vehicle-count]'))).toContain('3 vozila');
    expect(section.querySelectorAll('#ov-transit .route-link').length).toBeGreaterThan(0);
    expect(text(section.querySelector('#ov-transit'))).toContain('kasni 2 min');
    expect(text(section.querySelector('#ov-agenda'))).toContain('Koncert u parku');
    expect(text(section.querySelector('#ov-news'))).toContain('Naslov vijesti');
    expect(text(section.querySelector('#ov-civic'))).toContain('21/2026');
    // Provenance is one expandable line, not a wall of dataset names.
    expect(section.querySelector('details.provenance')).not.toBeNull();
  });
  it('reads unknown, never all-clear, while a safety source is missing or down', () => {
    const section = renderLayer('grad-sada', ctx({ snapshots: {} }));
    expect(text(section.querySelector('#ov-weather'))).toContain('učitavanje podataka');
    expect(section.querySelector('#ov-safety')?.getAttribute('data-level')).toBe('unknown');
    const down = renderLayer('grad-sada', ctx({ snapshots: { ...SNAPSHOTS, 'dhmz-cap': { ...SNAPSHOTS['dhmz-cap']!, status: 'down', items: [] } } }));
    expect(text(down.querySelector('#ov-safety'))).toContain('Stanje upozorenja nije potvrđeno');
    expect(text(down.querySelector('#ov-safety'))).not.toContain('Nema aktivnih upozorenja');
  });
});

describe('u-pokretu', () => {
  it('reads the module’s own delay summary per route, worst first', () => {
    expect(routeDelays(SNAPSHOTS['zet-rt'])).toEqual([
      { routeId: '6', count: 2, meanDelay: 90 },
      { routeId: '11', count: 1, meanDelay: -30 },
    ]);
    expect(routeDelays(undefined)).toEqual([]);
  });
  it('does not fabricate zero or rank an uninterpretable median as a current delay', () => {
    const snapshot = SNAPSHOTS['zet-rt']!;
    expect(routeDelays({ ...snapshot, items: [
      ...snapshot.items,
      { id: 'route:13', module: 'zet-rt', kind: 'vehicle', tier: 'open', title: '13', data: { routeId: '13', medianDelaySeconds: 18_600 } },
      { id: 'route:17', module: 'zet-rt', kind: 'vehicle', tier: 'open', title: '17', data: { routeId: '17' } },
    ] }).map((row) => row.routeId)).toEqual(['6', '11']);
  });
  it('builds the map from vehicle points and closure lines and prints the delay table', () => {
    const update = vi.fn();
    const factory = vi.fn(() => ({ update, destroy: vi.fn() }));
    const maps = createMapSlots(factory as never);
    const section = renderLayer('u-pokretu', ctx({ maps }));
    expect(factory).toHaveBeenCalledTimes(1);
    const options = factory.mock.calls[0]![0];
    expect(options.points).toHaveLength(3);
    expect(options.points[0]).toMatchObject({ lon: 15.97, lat: 45.81, routeId: '6' });
    expect(options.lines[0]!.coordinates).toEqual([[15.959, 45.799], [15.957, 45.799]]);
    expect(options.ariaLabel).toContain('Karta');
    const rows = [...section.querySelectorAll('[data-testid=delay-row]')].map(text);
    expect(rows[0]).toContain('kasni 2 min');
    expect(rows[1]).toContain('rani 1 min');

    // R-54: a second render reuses the same live map, moving the one container
    // into the new section instead of allocating another WebGL context.
    const canvas = section.querySelector('[data-testid=map-canvas]');
    const again = renderLayer('u-pokretu', ctx({ maps }));
    maps.sweep();
    expect(factory).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);
    expect(again.querySelector('[data-testid=map-canvas]')).toBe(canvas);
    expect(section.querySelector('[data-testid=map-canvas]')).toBeNull();
  });
  // Lightweight retains the accessible schematic-host list. The full
  // experience has one vector-map workspace, never two competing maps.
  it('mounts the lightweight host with this snapshot’s fixes, delays and source state', () => {
    const element = document.createElement('div');
    element.dataset.testid = 'schematic-host';
    const schematic = { element, mount: vi.fn(() => element), update: vi.fn(), pause: vi.fn(), resume: vi.fn(), destroy: vi.fn() };
    const section = renderLayer('u-pokretu', ctx({ schematic, lightweight: true }));
    expect(section.querySelector('[data-testid=schematic-host]')).toBe(element);
    expect(section.querySelector('[data-testid=transport-workspace]')).toBeNull();
    expect(schematic.update).toHaveBeenCalledTimes(1);
    const [data, at] = schematic.update.mock.calls[0]!;
    expect(at).toBe(NOW);
    expect(data.fixes.map((f: { id: string }) => f.id)).toEqual(['vehicle:1', 'vehicle:2', 'vehicle:3']);
    expect(data.fixes[0]).toMatchObject({ lon: 15.97, lat: 45.81, routeId: '6' });
    expect([...data.delays!]).toEqual([['6', 90], ['11', -30]]);
    // F8 / F5's leftover: the dashboard's own lightweight list can only say
    // "stale" or "down" during an outage (R-X1's honesty rule) if it is
    // handed the zet-rt snapshot itself, exactly as kiosk.ts's locked stage
    // already does on its own update() call.
    expect(data.snapshot).toBe(SNAPSHOTS['zet-rt']);
    // A second render (the next poll) reuses the very same element.
    const again = renderLayer('u-pokretu', ctx({ schematic, lightweight: true }));
    expect(again.querySelector('[data-testid=schematic-host]')).toBe(element);
    expect(schematic.update).toHaveBeenCalledTimes(2);
    expect(text(again.querySelector('[data-testid=transport-closures]'))).toContain('Grada Vukovara');
    const full = renderLayer('u-pokretu', ctx({ schematic }));
    expect(full.querySelector('[data-testid=schematic-host]')).toBeNull();
    expect(full.querySelector('[data-testid=transport-workspace]')).not.toBeNull();
  });
  it('renders no schematic panel when the page has no host (unit contexts, the kiosk essentials)', () => {
    const section = renderLayer('u-pokretu', ctx());
    expect(section.querySelector('#u-pokretu-schematic')).toBeNull();
  });
  it('falls back to the list when no map factory is available', () => {
    const section = renderLayer('u-pokretu', ctx({ maps: undefined }));
    expect(section.querySelector('[data-testid=map-canvas]')).toBeNull();
    expect(text(section.querySelector('[data-testid=map-status]'))).toBe('Karta nije dostupna u ovom pregledniku. Pretraga, linije i stanice rade i bez nje.');
    expect(section.querySelector('[data-testid=transport-search]')).not.toBeNull();
  });
  // T10: the full map.
  it('hands the map each vehicle report as evidence, dated, with its trip and route type (R-P2)', () => {
    const factory = vi.fn(() => ({ update: vi.fn(), destroy: vi.fn() }));
    renderLayer('u-pokretu', ctx({ maps: createMapSlots(factory as never) }));
    const point = factory.mock.calls[0]![0].points[0];
    // No `at` on the pin: dated at the snapshot's own fetch time, never `now`.
    expect(point).toMatchObject({ id: 'vehicle:1', lon: 15.97, lat: 45.81, routeId: '6', at: NOW - 60_000 });
    expect(point.title).toContain('6');
  });
  it('renders no map panel at all in lightweight mode: no map, no fallback line, no button (R-L2)', () => {
    const factory = vi.fn(() => ({ update: vi.fn(), destroy: vi.fn() }));
    const section = renderLayer('u-pokretu', ctx({ maps: createMapSlots(factory as never), lightweight: true, mapView: { full: false, toggle: vi.fn() } }));
    expect(section.querySelector('#u-pokretu-map')).toBeNull();
    expect(section.querySelector('[data-testid=map-fallback]')).toBeNull();
    expect(section.querySelector('[data-testid=map-full-toggle]')).toBeNull();
    expect(factory).not.toHaveBeenCalled();
  });
  it('offers the full-map button only when the page can switch view modes, labelled for the state it leads to', () => {
    const factory = vi.fn(() => ({ update: vi.fn(), destroy: vi.fn() }));
    const maps = createMapSlots(factory as never);
    const toggle = vi.fn();
    const section = renderLayer('u-pokretu', ctx({ maps, mapView: { full: false, toggle } }));
    const button = section.querySelector<HTMLButtonElement>('#u-pokretu-map [data-testid=map-full-toggle]')!;
    expect(text(button)).toBe('Proširi kartu');
    button.click();
    expect(toggle).toHaveBeenCalledTimes(1);
    const again = renderLayer('u-pokretu', ctx({ maps, mapView: { full: true, toggle } }));
    expect(text(again.querySelector('[data-testid=map-full-toggle]'))).toBe('Skupi kartu');
    // No view-mode owner: the stable control is hidden and not actionable.
    expect(renderLayer('u-pokretu', ctx({ maps })).querySelector<HTMLButtonElement>('[data-testid=map-full-toggle]')!.hidden).toBe(true);
  });
});

describe('cultureEvents / cityWorkEvents (the dogadanja split)', () => {
  it('cultureEvents keeps only Kulturpunkt, Etnografski muzej and kvartovske novosti, in the module’s own order', () => {
    const ids = cultureEvents(SNAPSHOTS.dogadanja).map((i) => i.id);
    expect(ids).toEqual(['kulturpunkt:1', 'etnografski:2', 'kvartovske:3']);
  });
  it('cityWorkEvents keeps only Skupština and komunalne, in the module’s own order', () => {
    const ids = cityWorkEvents(SNAPSHOTS.dogadanja).map((i) => i.id);
    expect(ids).toEqual(['skupstina:4', 'komunalne:5']);
  });
  it('both fall back to the ordinary empty text when the snapshot has no sourceCounts at all', () => {
    const plain = base('dogadanja', []); // no sourceCounts property, unlike SNAPSHOTS.dogadanja
    expect(cultureEventsEmptyText(createDefaultI18n('hr'), plain)).toBe('Trenutačno nema stavki.');
    expect(cityWorkEmptyText(createDefaultI18n('hr'), plain)).toBe('Trenutačno nema stavki.');
  });
  it('both name every one of their own sources as quiet, and none of the other panel’s, when items is empty but every source answered with nothing', () => {
    const empty = { ...SNAPSHOTS.dogadanja!, items: [], sourceCounts: { kulturpunkt: 0, skupstina: 0, kvartovske: 0, komunalne: 0, 'zet-rss': 9, etnografski: 0 } };
    expect(cultureEventsEmptyText(createDefaultI18n('hr'), empty)).toBe(
      'Trenutačno nema najava iz ovih izvora. Bez odgovora: Kulturpunkt, Etnografski muzej, Kvartovske novosti',
    );
    expect(cityWorkEmptyText(createDefaultI18n('hr'), empty)).toBe(
      'Trenutačno nema stavki iz ovih izvora. Bez odgovora: Skupština Grada Zagreba, Plan komunalnih aktivnosti',
    );
  });
});

describe('vehicleCount', () => {
  it('counts the vehicle: pins on the full session snapshot (three moving, two route summaries ignored)', () => {
    expect(vehicleCount(SNAPSHOTS['zet-rt'])).toBe(3);
  });
  it('reads the teaser summary item (id "vozila") via its data.vehicles instead of counting', () => {
    const teaser: ModuleSnapshot = {
      ...SNAPSHOTS['zet-rt']!,
      items: [
        { id: 'vozila', module: 'zet-rt', kind: 'vehicle', tier: 'open', title: '5 vozila u pokretu', data: { vehicles: 5 } },
        { id: 'route:6', module: 'zet-rt', kind: 'vehicle', tier: 'open', title: '6', data: { routeId: '6' } },
      ],
    };
    expect(vehicleCount(teaser)).toBe(5);
  });
  it('is null when there is no snapshot yet', () => {
    expect(vehicleCount(undefined)).toBeNull();
  });
});

describe('delayWord', () => {
  // The single ±15 s on-time band u-pokretu.ts, kiosk.ts and
  // schematic-view.ts all call this for, so the three surfaces can never
  // disagree about whether the same live route is running on time. R-F8:
  // raw seconds never appear anywhere on a screen -- the word is always in
  // minutes, rounded to the nearest and never fewer than one once a route
  // is off the band at all.
  const i18n = createDefaultI18n('hr');
  it('reads on time inside the ±15 s band, both boundaries inclusive', () => {
    expect(delayWord(i18n, 0)).toBe('na vrijeme');
    expect(delayWord(i18n, 15)).toBe('na vrijeme');
    expect(delayWord(i18n, -15)).toBe('na vrijeme');
  });
  it('reads late past +15 s, in whole minutes rounded to the nearest, never fewer than one', () => {
    expect(delayWord(i18n, 16)).toBe('kasni 1 min');
    expect(delayWord(i18n, 90)).toBe('kasni 2 min');
    expect(delayWord(i18n, 60)).toBe('kasni 1 min');
  });
  it('reads early past -15 s, the same way with the sign in the word instead of the number', () => {
    expect(delayWord(i18n, -16)).toBe('rani 1 min');
    expect(delayWord(i18n, -90)).toBe('rani 2 min');
  });
  it('speaks English too', () => {
    const en = createDefaultI18n('en');
    expect(delayWord(en, 0)).toBe('on time');
    expect(delayWord(en, 90)).toBe('2 min late');
    expect(delayWord(en, -90)).toBe('2 min early');
  });
  it.each([undefined, null, NaN, Infinity, -Infinity, 5401, -5401, 18_600])('keeps an absent or uninterpretable median (%s) unknown', (value) => {
    expect(delayWord(i18n, value)).toBe(i18n.t('transit.noDelayData'));
    const en = createDefaultI18n('en');
    expect(delayWord(en, value)).toBe(en.t('transit.noDelayData'));
  });
  it('does not clamp a valid boundary value or change the source reading', () => {
    expect(delayWord(i18n, 5400)).toBe('kasni 90 min');
    expect(delayWord(i18n, -5400)).toBe('rani 90 min');
  });
});

// --- route-summary.ts: the one helper both R-F8's lightweight list and the
// essentials board's "Linije u blizini" row read (kiosk.ts, motion/
// schematic-view.ts), so a route's count and delay word can never disagree
// between the two surfaces. ------------------------------------------------
describe('summariseRoutes', () => {
  const i18n = createDefaultI18n('hr');
  const veh = (routeId: string, label: string, type: number): RouteVehicle => ({ routeId, label, type });

  it('groups by route id, counting the vehicles of each, trams before buses and then by route number as a person reads it (numeric, not lexicographic)', () => {
    const rows = summariseRoutes(
      [veh('11', '11', 0), veh('6', '6', 0), veh('6', '6', 0), veh('109', '109', 3)],
      new Map([['6', 130], ['11', 0], ['109', -20]]),
      i18n,
    );
    // Lexicographically '11' < '6'; numerically 6 < 11 -- proving the sort
    // reads route numbers the way a person does, not as plain strings.
    expect(rows.map((r) => r.routeId)).toEqual(['6', '11', '109']);
    expect(rows[0]).toMatchObject({ routeId: '6', label: '6', type: 0, count: 2, word: 'kasni 2 min' });
    expect(rows[1]).toMatchObject({ routeId: '11', count: 1, word: 'na vrijeme' });
    expect(rows[2]).toMatchObject({ routeId: '109', type: 3, count: 1, word: 'rani 1 min' });
  });

  it('does not claim punctuality when the route has no median', () => {
    const rows = summariseRoutes([veh('6', '6', 0)], new Map(), i18n);
    expect(rows[0].word).toBe(i18n.t('transit.noDelayData'));
  });

  it('is empty when there are no vehicles', () => {
    expect(summariseRoutes([], new Map(), i18n)).toEqual([]);
  });
});

describe('zrak-i-nebo, sigurnost, uprava, kultura, vijesti', () => {
  it('weather places quakes by distance and bearing, draws the computed sun path and never asks for a basemap', () => {
    const factory = vi.fn(() => ({ update: vi.fn(), destroy: vi.fn() }));
    const section = renderLayer('zrak-i-nebo', ctx({ maps: createMapSlots(factory as never) }));
    const quake = text(section.querySelector('[data-testid=quake-row]'));
    expect(quake).toContain('M 1,6');
    expect(quake).toContain('dubina 10 km');
    expect(quake).toMatch(/\d+ km od Zagreba/);
    expect(section.querySelector('#wx-quakes .g-radar')).not.toBeNull();
    expect(factory).not.toHaveBeenCalled();
    expect(text(section.querySelector('#wx-sun'))).toMatch(/izlazak \d\d:\d\d/);
    expect(text(section.querySelector('#wx-sun'))).toContain('Izračunato na uređaju');
    // The measured value sits on today's forecast range; wind reads as a direction word, never "calm" while it blows.
    expect(text(section.querySelector('[data-testid=forecast-range]'))).toBe('od 12 do 24 °C');
    expect(text(section.querySelector('[data-testid=wind-text]'))).toBe('sjeverozapad 2 m/s');
    expect(section.querySelector('#wx-range .g-range')).not.toBeNull();
  });
  it('sigurnost renders the open modules and points at the untimed page', () => {
    const section = renderLayer('sigurnost', ctx());
    for (const id of ['sf-numbers', 'sf-warnings', 'sf-closures', 'sf-pharmacies', 'sf-quakes', 'sf-assembly']) expect(section.querySelector(`#${id}`), id).not.toBeNull();
    expect(section.querySelector('[data-testid=safety-level]')?.getAttribute('data-level')).toBe('urgent');
    expect(section.querySelectorAll('a[href^="tel:"]').length).toBeGreaterThanOrEqual(5);
    const link = section.querySelector<HTMLAnchorElement>('[data-testid=hitno-link]')!;
    expect(link.getAttribute('href')).toBe('/hitno');
    expect(text(section)).toContain('Otvoreno svima, bez skeniranja.');
    // The fixture quake is 43 hours old: inside the 72 hour window, placed by its own distance.
    expect(text(section.querySelector('#sf-quakes'))).toContain('M 1,6');
    expect(text(section.querySelector('#sf-quakes'))).toMatch(/\d+ km od Zagreba/);
  });
  it('uprava lists acts with their gazette number, and the open act offers printing and the original', () => {
    const section = renderLayer('uprava-i-pravo', ctx());
    expect(text(section.querySelector('[data-testid=act-row]'))).toContain('21/2026');
    expect(text(section.querySelector('[data-testid=gazette-issue]'))).toContain('21/2026');
    expect(section.querySelector('[data-testid=civic-detail]')).toBeNull();
    const open = renderLayer('uprava-i-pravo', ctx({ view: { layer: 'uprava-i-pravo', selection: { kind: 'item', id: publicItemKey('glasnik', 'a1'), module: 'glasnik' }, filters: {} } }));
    const detail = open.querySelector('[data-testid=civic-detail]')!;
    expect(text(detail)).toContain('Odluka o nečemu');
    expect(detail.querySelector('[data-action=print-item][data-module=glasnik][data-item-id=a1]')).not.toBeNull();
    expect(detail.querySelector('a[href="https://www1.zagreb.hr/akt"]')).not.toBeNull();
    expect(text(detail)).toContain('sadržaj i pravni učinak akta su na izvorniku');
  });
  it('Grad radi lists Assembly sessions/consultations and communal works, with phase, amount and a livestream link on a plenary session', () => {
    const section = renderLayer('uprava-i-pravo', ctx());
    const rows = [...section.querySelectorAll('[data-testid=city-work-row]')].map((row) => ({ el: row, text: text(row) }));
    expect(rows).toHaveLength(2);

    const skupstina = rows.find((r) => r.text.includes('Poziv na 13. sjednicu'))!;
    expect(skupstina.text).toContain('Gradske skupštine Grada Zagreba');
    expect(skupstina.text).toContain('Stara gradska vijećnica');
    expect(text(section.querySelector('#cv-assembly'))).toContain('Skupština Grada Zagreba');
    const open = renderLayer('uprava-i-pravo', ctx({ view: { layer: 'uprava-i-pravo', selection: { kind: 'item', id: publicItemKey('dogadanja', 'skupstina:4'), module: 'dogadanja' }, filters: {} } }));
    const detail = open.querySelector('[data-testid=civic-detail]')!;
    expect(detail.querySelector('a[href="https://www.youtube.com/channel/UCRMm4Xt9ruoQ8FG7NpIHCsA"]')).not.toBeNull();
    expect(detail.querySelector('a[href="https://skupstina.zagreb.hr/poziv"]')).not.toBeNull();
    expect(detail.querySelector('[data-action=ics-item]')).not.toBeNull(); // a timed, dated session may go into a calendar

    const komunalne = rows.find((r) => r.text.includes('Horvati'))!;
    expect(komunalne.text).toContain('Radovi u tijeku');
    expect(komunalne.text).toContain('1.500');
    expect(komunalne.text).toContain('€');
    expect(komunalne.text).toContain('izrada projektne dokumentacije za vodoopskrbu');
    expect(text(section.querySelector('#cv-works'))).toContain('Plan komunalnih aktivnosti');
    expect(text(section.querySelector('#cv-works'))).not.toMatch(/\d+ ?%/); // no invented progress

    // Never the ZET notice that also lives in the merged snapshot (E8's kiosk teaser owns that one).
    expect(text(section)).not.toContain('Izmjena reda vožnje');
  });
  it('Grad radi says so plainly, naming which of its two sources answered, when neither has anything', () => {
    const empty = { ...SNAPSHOTS.dogadanja!, items: [], sourceCounts: { kulturpunkt: 5, skupstina: 0, kvartovske: 5, komunalne: 0, 'zet-rss': 5, etnografski: 5 } };
    const section = renderLayer('uprava-i-pravo', ctx({ snapshots: { ...SNAPSHOTS, dogadanja: empty } }));
    const body = text(section.querySelector('#cv-works'));
    expect(body).toContain('Trenutačno nema stavki');
    expect(body).toContain('Bez odgovora: Skupština Grada Zagreba, Plan komunalnih aktivnosti');
    expect(body).not.toContain('Odgovorili');
  });
  it('kultura shows Događanja for culture and community sources only: next starts by day, an ongoing exhibition apart, each with its venue and source', () => {
    const section = renderLayer('kultura', ctx());
    const rows = [...section.querySelectorAll('[data-testid=event-row]')].map(text);
    expect(rows).toHaveLength(3);

    const koncert = rows.find((r) => r.includes('Koncert u parku'))!;
    expect(koncert).toContain('Kulturpunkt');
    expect(koncert).toContain('20:00'); // 18:00Z on 12 September is 20:00 in Zagreb
    const izlozba = rows.find((r) => r.includes('Izložba tradicijskog nakita'))!;
    expect(izlozba).toContain('Studentski centar'); // venue
    expect(izlozba).toContain('Etnografski muzej'); // per-source attribution
    expect(izlozba).toContain('u tijeku · do'); // began before now, still runs: never listed as a next start
    expect(section.querySelector('#ev-ongoing [data-testid=event-row]')).not.toBeNull();
    const igraliste = rows.find((r) => r.includes('Novo dječje igralište'))!;
    expect(igraliste).toContain('Kvartovske novosti');
    expect(igraliste).toContain('cijeli dan'); // a day-precision entry is all day, not midnight

    // The agenda groups by day, today first.
    expect(text(section.querySelector('#ev-agenda .agenda-day'))).toBe('Danas');
    // Never Skupština, komunalne or the ZET notice: those belong to uprava-i-pravo (or, for ZET, only the kiosk teaser).
    const whole = text(section);
    expect(whole).not.toContain('Skupština');
    expect(whole).not.toContain('Horvati');
    expect(whole).not.toContain('Izmjena reda vožnje');
    // Licence and original stay one tap away, in the item detail.
    const open = renderLayer('kultura', ctx({ view: { layer: 'kultura', selection: { kind: 'item', id: publicItemKey('dogadanja', 'kulturpunkt:1'), module: 'dogadanja' }, filters: {} } }));
    expect(text(open.querySelector('[data-testid=event-detail]'))).toContain('Kulturpunkt (CC BY-SA 3.0 HR)');
    expect(open.querySelector('[data-testid=event-detail] a[href="https://kulturpunkt.hr/clanak/1"]')).not.toBeNull();
    expect(section.querySelector('[data-filter-key=q]')).not.toBeNull();
    expect(section.querySelectorAll('.chip').length).toBeGreaterThan(1);
  });
  it('filter chips are a labelled group holding a native list, and no <li> in a workspace is orphaned from a list (axe: listitem)', () => {
    const i18n = createDefaultI18n('hr');
    for (const [layer, label] of [['kultura', i18n.t('events.categoryLabel')], ['uprava-i-pravo', i18n.t('civic.phase')]] as const) {
      const section = renderLayer(layer, ctx());
      const group = section.querySelector('.ws-toolbar [role=group]');
      expect(group, layer).not.toBeNull();
      expect(group!.tagName, `${layer}: the group must not be the list itself`).not.toBe('UL');
      expect(group!.getAttribute('aria-label'), layer).toBe(label);
      const list = group!.querySelector('ul.chips');
      expect(list?.getAttribute('role'), `${layer}: the chips stay a native list`).toBe('list');
      expect([...list!.children].every((li) => li.tagName === 'LI' && li.querySelector('button.chip[aria-pressed]') !== null), layer).toBe(true);
      expect(list!.children.length).toBeGreaterThan(1);
      for (const li of section.querySelectorAll('li')) {
        const parent = li.parentElement!;
        expect(['UL', 'OL'], `${layer}: <li> under <${parent.tagName.toLowerCase()}>`).toContain(parent.tagName);
        expect(parent.getAttribute('role') ?? 'list', `${layer}: <li> under a ${parent.tagName} whose role is not list`).toBe('list');
      }
    }
  });
  it('a future-only list groups under its own day and shows no today head', () => {
    const futureOnly = {
      ...SNAPSHOTS.dogadanja!,
      items: [
        { id: 'kulturpunkt:9', module: 'dogadanja', kind: 'event', tier: 'session', title: 'Jesenski festival', link: 'https://kulturpunkt.hr/f', at: '2026-09-18T18:00:00Z', data: { source: 'kulturpunkt', category: 'festival', precision: 'time' } },
      ] as ModuleSnapshot['items'],
    };
    const section = renderLayer('kultura', ctx({ snapshots: { ...SNAPSHOTS, dogadanja: futureOnly } }));
    expect(text(section.querySelector('#ev-agenda .agenda-day'))).toMatch(/18\. 9\. 2026\./);
    expect([...section.querySelectorAll('[data-testid=event-row]')]).toHaveLength(1);
    expect(text(section.querySelector('#ev-agenda'))).toContain('Jesenski festival');
  });
  it('kultura Događanja says so plainly, naming which of its three sources answered, when none of them has anything', () => {
    const empty = { ...SNAPSHOTS.dogadanja!, items: [], sourceCounts: { kulturpunkt: 0, skupstina: 5, kvartovske: 2, komunalne: 5, 'zet-rss': 5, etnografski: 0 } };
    const section = renderLayer('kultura', ctx({ snapshots: { ...SNAPSHOTS, dogadanja: empty } }));
    const body = text(section.querySelector('#ev-agenda'));
    expect(body).toContain('Trenutačno nema najava');
    expect(body).toContain('Odgovorili: Kvartovske novosti');
    expect(body).toContain('Bez odgovora: Kulturpunkt, Etnografski muzej');
  });
  it.each(['Avenija Dubrovnik 17', 'Ulica grada Vukovara 68', 'Zadarska 80'])('does not mistake a Zagreb street (%s) or an organiser for the event city', (venue) => {
    const original = SNAPSHOTS.dogadanja!;
    const local = { ...original.items[0]!, at: '2026-09-12T18:00:00Z', data: { ...original.items[0]!.data, venue, organiser: 'Udruga Split' } };
    const section = renderLayer('kultura', ctx({ snapshots: { ...SNAPSHOTS, dogadanja: { ...original, items: [local] } } }));
    expect(section.querySelector('#ev-outside')).toBeNull();
    expect(text(section.querySelector('[data-testid=agenda]'))).toContain(local.title);
  });
  it('kultura keeps a venue outside Zagreb apart and never lists it as a Zagreb event', () => {
    const split = { ...SNAPSHOTS.dogadanja!, items: [
      ...SNAPSHOTS.dogadanja!.items,
      { id: 'kulturpunkt:7', module: 'dogadanja', kind: 'event', tier: 'session', title: 'Koncert na rivi', at: '2026-09-12T19:00:00Z', dateBasis: 'event', data: { source: 'kulturpunkt', category: 'koncert', precision: 'time', venue: 'Dioklecijanova palača, Split' } },
    ] as ModuleSnapshot['items'] };
    const section = renderLayer('kultura', ctx({ snapshots: { ...SNAPSHOTS, dogadanja: split } }));
    expect(text(section.querySelector('#ev-agenda'))).not.toContain('Koncert na rivi');
    expect(text(section.querySelector('#ev-outside'))).toContain('Koncert na rivi');
    expect(text(section.querySelector('#ev-outside'))).toContain('izvan Zagreba');
  });
  it('vijesti separates the two HRT sources, shows real publication times, and the open story links to the original', () => {
    const section = renderLayer('vijesti', ctx());
    const row = section.querySelector('[data-testid=news-row]')!;
    expect(text(row)).toContain('Naslov vijesti');
    expect(text(row)).toContain('prije 1 sat'); // 11:00Z is 13:00 in Zagreb, an hour and a half before NOW
    expect(section.querySelector('#nw-hrt')).not.toBeNull();
    expect(section.querySelector('#nw-sljeme')).not.toBeNull();
    const open = renderLayer('vijesti', ctx({ view: { layer: 'vijesti', selection: { kind: 'item', id: publicItemKey('hrt-news', 'n1'), module: 'hrt-news' }, filters: {} } }));
    const detail = open.querySelector('[data-testid=news-detail]')!;
    expect(detail.querySelector('a[href="https://vijesti.hrt.hr/clanak"]')).not.toBeNull();
    expect(text(detail)).toContain('Sažetak');
    expect(text(section.querySelector('[data-testid=panel-attr]'))).toContain('Izvor: hrt-news');
  });
});

describe('bounded lists, one-row chips and venue only when known (T1.4)', () => {
  it('Grad pages the gazette by ten acts, offers the rest ten at a time, and a filter value renders exactly that many', () => {
    const withActs = { ...SNAPSHOTS, glasnik: MANY_ACTS };
    const section = renderLayer('uprava-i-pravo', ctx({ snapshots: withActs }));
    expect(section.querySelectorAll('[data-testid=act-row]')).toHaveLength(10);
    const more = section.querySelector('[data-action=filter][data-filter-key=acts]')!;
    expect(text(more)).toBe('Prikaži još 10');
    expect(more.getAttribute('data-filter-value')).toBe('20');
    expect(text(section.querySelector('#cv-gazette'))).toContain('prikazano 10 od 25');
    // A bare-button grid child stretches to the section's full width unless it
    // opts out (layers.css `.sf-more { justify-self: start }`); the button must
    // render as a compact pill, not a full-width bar.
    expect(more.classList.contains('sf-more')).toBe(true);

    const expanded = renderLayer('uprava-i-pravo', ctx({ snapshots: withActs, view: { layer: 'uprava-i-pravo', selection: null, filters: { acts: '20' } } }));
    expect(expanded.querySelectorAll('[data-testid=act-row]')).toHaveLength(20);
  });

  it('Sigurnost pages assembly points by twelve, offers 24 more, and a search still surfaces every match regardless of the page', () => {
    const withPoints = { ...SNAPSHOTS, 'ckan-geo': MANY_POINTS };
    const section = renderLayer('sigurnost', ctx({ snapshots: withPoints }));
    expect(section.querySelectorAll('[data-testid=assembly-point]')).toHaveLength(12);
    const more = section.querySelector('[data-action=filter][data-filter-key=assembly]')!;
    expect(text(more)).toBe('Prikaži još 24');
    expect(more.getAttribute('data-filter-value')).toBe('36');
    expect(more.classList.contains('sf-more')).toBe(true);
    // The count sentence always names the true total, unaffected by paging (R-K4).
    expect(text(section.querySelector('#sf-assembly'))).toContain('Na popisu je 40 mjesta');

    const searched = renderLayer('sigurnost', ctx({ snapshots: withPoints, view: { layer: 'sigurnost', selection: null, filters: { zborna: 'mjesto' } } }));
    expect(searched.querySelectorAll('[data-testid=assembly-point]')).toHaveLength(40);
  });

  it('Sigurnost pages road closures by five and offers ten more at a time', () => {
    const withClosures = { ...SNAPSHOTS, prometnice: MANY_CLOSURES };
    const section = renderLayer('sigurnost', ctx({ snapshots: withClosures }));
    expect(section.querySelectorAll('[data-testid=closure-row]')).toHaveLength(5);
    const more = section.querySelector('[data-action=filter][data-filter-key=closures]')!;
    expect(text(more)).toBe('Prikaži još 10');
    expect(more.getAttribute('data-filter-value')).toBe('15');
    // Same grid-stretch escape as the gazette and assembly "more" buttons.
    expect(more.classList.contains('sf-more')).toBe(true);

    const expanded = renderLayer('sigurnost', ctx({ snapshots: withClosures, view: { layer: 'sigurnost', selection: null, filters: { closures: '15' } } }));
    expect(expanded.querySelectorAll('[data-testid=closure-row]')).toHaveLength(15);
  });

  it('shows a venue only when the source has one: no row in kultura or on Grad now claims an unknown location', () => {
    const kultura = renderLayer('kultura', ctx());
    expect(text(kultura)).not.toContain('Lokacija nije navedena');
    const rows = [...kultura.querySelectorAll('[data-testid=event-row]')].map(text);
    expect(rows.find((r) => r.includes('Koncert u parku'))).toContain('Kulturpunkt');
    // The Etnografski fixture carries a real venue, and it still shows, venue then source.
    expect(rows.find((r) => r.includes('Izložba tradicijskog nakita'))).toContain('Studentski centar · Etnografski muzej');

    const detailOpen = renderLayer('kultura', ctx({ view: { layer: 'kultura', selection: { kind: 'item', id: publicItemKey('dogadanja', 'kulturpunkt:1'), module: 'dogadanja' }, filters: {} } }));
    expect(text(detailOpen.querySelector('[data-testid=event-detail]'))).not.toContain('Mjesto');

    const gradSada = renderLayer('grad-sada', ctx());
    expect(text(gradSada)).not.toContain('Lokacija nije navedena');
  });
});

describe('exports wiring', () => {
  it('item actions are declared for delegation with the module and item id, and the calendar action follows the real eligibility helper', () => {
    const open = renderLayer('kultura', ctx({ view: { layer: 'kultura', selection: { kind: 'item', id: publicItemKey('dogadanja', 'kulturpunkt:1'), module: 'dogadanja' }, filters: {} } }));
    const detail = open.querySelector('[data-testid=event-detail]')!;
    expect(detail.querySelector('[data-action=copy-item][data-module=dogadanja][data-item-id="kulturpunkt:1"]')).not.toBeNull();
    expect(detail.querySelector('[data-action=share-item]')).not.toBeNull();
    expect(detail.querySelector('[data-action=ics-item]')).toBeNull(); // the fixture carries no dateBasis, so no calendar file
  });
});
