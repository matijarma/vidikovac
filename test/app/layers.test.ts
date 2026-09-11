// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import type { ModuleSnapshot } from '../../worker/feed/schema';
import { LAYERS } from '../../worker/protocol';
import { createDefaultI18n } from '../../app/src/i18n/create-default-i18n';
import { ALL_LAYER_MODULES, LAYER_MODULES, LAYER_RENDERERS, renderLayer } from '../../app/src/layers';
import { routeDelays } from '../../app/src/layers/u-pokretu';
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
};

function ctx(over: Partial<LayerContext> = {}): LayerContext {
  return { i18n: createDefaultI18n('hr'), snapshots: SNAPSHOTS, now: NOW, ...over };
}
const text = (el: Element | null): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('layer registry', () => {
  it('has a renderer and a module list for every LayerId', () => {
    for (const layer of LAYERS) {
      expect(typeof LAYER_RENDERERS[layer]).toBe('function');
      expect(Array.isArray(LAYER_MODULES[layer])).toBe(true);
    }
    expect(LAYER_MODULES.kultura).toEqual([]);
    expect(LAYER_MODULES['u-pokretu']).toEqual(['zet-rt', 'prometnice']);
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

describe('grad-sada', () => {
  it('shows clock, observation, forecast, CAP state, vehicle count and closure count', () => {
    const section = renderLayer('grad-sada', ctx());
    expect(text(section.querySelector('[data-testid=clock]'))).toBe('14:32');
    expect(text(section.querySelector('[data-testid=temp]'))).toBe('21 °C');
    expect(text(section.querySelector('#grad-sada-observation'))).toContain('vlaga 54 %');
    expect(text(section.querySelector('#grad-sada-forecast'))).toContain('od 12 do 24 °C');
    expect(text(section.querySelector('#grad-sada-cap'))).toContain('žuto upozorenje');
    expect(text(section.querySelector('[data-testid=vehicle-count]'))).toBe('3 vozila');
    expect(text(section.querySelector('[data-testid=closure-count]'))).toBe('1 zatvaranje');
  });
  it('says so when a module is missing or down instead of showing a blank card', () => {
    const section = renderLayer('grad-sada', ctx({ snapshots: {} }));
    expect(text(section.querySelector('#grad-sada-observation'))).toContain('učitavanje podataka');
    const down = renderLayer('grad-sada', ctx({ snapshots: { 'dhmz-cap': { ...SNAPSHOTS['dhmz-cap']!, status: 'down', items: [] } } }));
    expect(text(down.querySelector('#grad-sada-cap'))).toContain('izvor nedostupan');
    expect(text(down.querySelector('#grad-sada-cap'))).toContain('Nema upozorenja za Zagrebačku regiju.');
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
  it('builds the map from vehicle points and closure lines and prints the delay table', () => {
    const update = vi.fn();
    const factory = vi.fn(() => ({ update, destroy: vi.fn() }));
    const section = renderLayer('u-pokretu', ctx({ mapFactory: factory }));
    expect(factory).toHaveBeenCalledTimes(1);
    const options = factory.mock.calls[0]![0];
    expect(options.points).toHaveLength(3);
    expect(options.points[0]).toMatchObject({ lon: 15.97, lat: 45.81, routeId: '6' });
    expect(options.lines[0]!.coordinates).toEqual([[15.959, 45.799], [15.957, 45.799]]);
    expect(options.ariaLabel).toContain('Karta');
    const rows = [...section.querySelectorAll('[data-testid=delay-row]')].map(text);
    expect(rows[0]).toContain('+90 s');
    expect(rows[1]).toContain('−30 s');
  });
  it('falls back to the list when no map factory is available', () => {
    const section = renderLayer('u-pokretu', ctx({ mapFactory: undefined }));
    expect(text(section.querySelector('[data-testid=map-fallback]'))).toBe('Karta nije dostupna u ovom pregledniku; popis je ispod.');
  });
});

describe('zrak-i-nebo, sigurnost, uprava, kultura, vijesti', () => {
  it('lists quakes with magnitude, depth and a mini map', () => {
    const factory = vi.fn(() => ({ update: vi.fn(), destroy: vi.fn() }));
    const section = renderLayer('zrak-i-nebo', ctx({ mapFactory: factory }));
    expect(text(section.querySelector('[data-testid=quake-row]'))).toContain('M 1.6');
    expect(text(section.querySelector('[data-testid=quake-row]'))).toContain('dubina 10 km');
    expect(factory).toHaveBeenCalledTimes(1);
    expect(text(section.querySelector('#zrak-i-nebo-sun'))).toMatch(/Izlazak \d\d:\d\d/);
    expect(text(section.querySelector('#zrak-i-nebo-sun'))).toContain('Izračunato na uređaju');
  });
  it('sigurnost renders the open modules and points at the untimed page', () => {
    const section = renderLayer('sigurnost', ctx());
    expect(section.querySelector('#sigurnost-cap')).not.toBeNull();
    expect(section.querySelector('#sigurnost-quakes')).not.toBeNull();
    expect(section.querySelector('#sigurnost-closures')).not.toBeNull();
    expect(section.querySelector('#sigurnost-poi')).not.toBeNull();
    const link = section.querySelector<HTMLAnchorElement>('[data-testid=hitno-link]')!;
    expect(link.getAttribute('href')).toBe('/hitno');
    expect(text(section)).toContain('Ovaj je sloj otvoren svima, bez skeniranja i bez ograničenja trajanja.');
  });
  it('uprava lists acts with their gazette number and offers printing', () => {
    const onExport = vi.fn();
    const section = renderLayer('uprava-i-pravo', ctx({ onExport }));
    expect(text(section.querySelector('[data-testid=act-row]'))).toContain('21/2026');
    section.querySelector<HTMLButtonElement>('#uprava-i-pravo-acts-print')!.click();
    expect(onExport).toHaveBeenCalledWith('print', 'glasnik');
  });
  it('kultura is an honest Referenca roadmap with the two links', () => {
    const section = renderLayer('kultura', ctx());
    expect(section.querySelector('[data-freshness=referenca]')).not.toBeNull();
    expect(text(section)).toContain('U prvoj fazi ovaj sloj još nema živih podataka.');
    const hrefs = [...section.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('https://www.europeana.eu/hr');
    expect(hrefs).toContain('https://digitalna.nsk.hr/');
  });
  it('vijesti shows headline, time, source and a link to the original', () => {
    const section = renderLayer('vijesti', ctx());
    const row = section.querySelector('[data-testid=news-row]')!;
    expect(text(row)).toContain('Naslov vijesti');
    expect(text(row)).toContain('13:00');
    expect(row.querySelector('a')?.getAttribute('href')).toBe('https://vijesti.hrt.hr/clanak');
    expect(text(section.querySelector('[data-testid=panel-attr]'))).toContain('Izvor: hrt-news');
  });
});

describe('exports wiring', () => {
  it('a panel copy button hands the layer text and the module attribution to onCopy', () => {
    const onCopy = vi.fn();
    const section = renderLayer('vijesti', ctx({ onCopy }));
    section.querySelector<HTMLButtonElement>('#vijesti-news-copy')!.click();
    expect(onCopy).toHaveBeenCalledTimes(1);
    expect(onCopy.mock.calls[0]![0]).toContain('Naslov vijesti');
    expect(onCopy.mock.calls[0]![1]).toEqual(attr('Izvor: hrt-news'));
  });
});
