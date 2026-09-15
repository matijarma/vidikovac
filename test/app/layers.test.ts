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
import { createSchematicHost } from '../../app/src/motion/schematic-host';
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

// The screen this phone is paired to, the same stop the e2e fixture serves, so
// the overview's stop branch (the place line, six lines on the board) is the
// one a person in the café actually sees.
const STOP = { id: '106_1', name: 'Trg bana J. Jelačića', lon: 15.97726, lat: 45.81286, routes: ['6', '11', '12', '13', '14', '17'] };
const atStop = (over: Partial<LayerContext> = {}): LayerContext => ctx({
  screen: { surface: 'phone', locale: 'hr', theme: 'light', themePreference: 'light', lightweight: false, reducedMotion: false, stop: STOP },
  ...over,
});
/** The real ZET feed dates itself from the GTFS-RT header, so its foot reads "podaci od", not "dohvaćeno". */
const DATED_ZET: ModuleSnapshot = { ...SNAPSHOTS['zet-rt']!, sourceUpdatedAt: new Date(NOW - 120_000).toISOString() };

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

describe('grad-sada (Sada, the time band)', () => {
  const DESK = { surface: 'desktop' as const, locale: 'hr' as const, theme: 'light' as const, themePreference: 'light' as const, lightweight: false, reducedMotion: false, stop: STOP };
  const FOLLOWING = 4; // Node.DOCUMENT_POSITION_FOLLOWING

  it('composes the time band: segments, then five heads, then five lanes in time order; no domain columns', () => {
    const section = renderLayer('grad-sada', atStop());
    expect(section.querySelector('.tb[data-cols="5"]')).not.toBeNull();
    // Each h3 reads "time word + head text", so a reader hears the five time words as headings (D5).
    expect([...section.querySelectorAll('.tb-head h3')].map(text)).toEqual(['sada 14:32', 'poslijepodne do 18:00', 'večeras od 18:00', 'sutra sub 12. 9.', 'tjedan do čet 17. 9.']);
    expect([...section.querySelectorAll('.tb-lane')].map((lane) => lane.getAttribute('data-col'))).toEqual(['sada', 'danas', 'veceras', 'sutra', 'tjedan']);
    // Heads precede lanes in the DOM, and lanes are in time order: the visual order is the reading order on every surface (WCAG 2.2 SC 2.4.3).
    const heads = [...section.querySelectorAll('.tb-head')];
    const lanes = [...section.querySelectorAll('.tb-lane')];
    expect(heads.at(-1)!.compareDocumentPosition(lanes[0]!) & FOLLOWING).toBe(FOLLOWING);
    // Time is the only axis: no domain column, no place line, no block of its own.
    expect(section.querySelectorAll('.ov-block, .ov-col, .ov-place, .ov')).toHaveLength(0);
    // The segmented control is the first thing after the title: a group of five pressed-state buttons, sada pressed.
    const seg = section.querySelector('h2.layer-title')!.nextElementSibling!;
    expect(seg.matches('.tb-seg[role="group"]')).toBe(true);
    const buttons = [...seg.querySelectorAll('[aria-pressed]')];
    expect(buttons).toHaveLength(5);
    expect(buttons.filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.getAttribute('data-filter-value'))).toEqual(['sada']);
    expect(buttons[0]!.getAttribute('aria-label')).toBe('sada, 14:32');
    // Provenance is one expandable line, not a wall of dataset names.
    expect(section.querySelector('details.provenance')).not.toBeNull();
    // The band head is the one clock on the page.
    expect(text(section.querySelector('.tb-clock'))).toBe('14:32');
    expect(section.querySelectorAll('.tb-clock')).toHaveLength(1);
  });

  it('no weather tile; on the phone the sada head links glyph, temperature and sunset into Vrijeme', () => {
    const phone = renderLayer('grad-sada', atStop());
    const weather = phone.querySelector('[data-testid=tb-head-sada] .tb-weather[data-layer=zrak-i-nebo]')!;
    expect(weather).not.toBeNull();
    expect(weather.getAttribute('href')).toBe('#layer=zrak-i-nebo');
    expect(text(weather.querySelector('.tb-temp'))).toBe('21 °C');
    // "vedro" earns the sun; the condition word stands in the label either way.
    expect(weather.querySelector('.icon use')?.getAttribute('href')).toBe('#icon-sun');
    expect(weather.getAttribute('aria-label')).toContain('vedro');
    expect(weather.getAttribute('aria-label')).toMatch(/zalazak \d{2}:\d{2}/);
    // The desktop's status line carries the group; the band head does not repeat it.
    const desk = renderLayer('grad-sada', ctx());
    expect(desk.querySelector('.tb-weather')).toBeNull();
    for (const section of [phone, desk]) {
      expect(section.querySelector('[data-testid=temp]')).toBeNull();
      const tiles = [...section.querySelectorAll('.tl')];
      expect(tiles.length).toBeGreaterThan(0);
      expect(tiles.some((tile) => text(tile).includes('°C') || (tile.getAttribute('aria-label') ?? '').includes('°C'))).toBe(false);
    }
  });

  it('states safety as one band whose level, word and time come from safetyState', () => {
    const section = renderLayer('grad-sada', atStop());
    const bands = section.querySelectorAll('.tl[data-domain=safety]');
    expect(bands).toHaveLength(1);
    const band = bands[0]!;
    expect(band.getAttribute('data-variant')).toBe('band');
    expect(band.getAttribute('data-level')).toBe('urgent');
    expect(band.getAttribute('data-tone')).toBe('urgent');
    expect(band.getAttribute('data-layer')).toBe('sigurnost');
    expect(band.getAttribute('href')).toBe('#layer=sigurnost');
    expect(text(band.querySelector('.tl-title'))).toBe('žuto upozorenje: Grmljavinsko nevrijeme');
    expect(band.querySelector('.tl-glyph use')?.getAttribute('href')).toBe('#icon-triangle-alert');
    // The untimed page is Sigurnost's to offer; the band only points at the domain.
    expect(section.querySelector('[data-testid=hitno-link]')).toBeNull();

    const calm = renderLayer('grad-sada', atStop({ snapshots: { ...SNAPSHOTS, 'dhmz-cap': base('dhmz-cap', []) } }));
    const calmBand = calm.querySelector('.tl[data-domain=safety]')!;
    expect(calmBand.getAttribute('data-level')).toBe('calm');
    expect(calmBand.getAttribute('data-tone')).toBe('calm');
    expect(text(calmBand.querySelector('.tl-title'))).toBe('Nema hitnih upozorenja');
    expect(text(calmBand.querySelector('.tl-trail'))).toMatch(/^potvrđeno \d{2}:\d{2}$/);
  });

  it('reads unknown, never all-clear, while a safety source is missing or down', () => {
    const loading = renderLayer('grad-sada', ctx({ snapshots: {} }));
    expect(loading.querySelector('.tl[data-domain=safety]')?.getAttribute('data-level')).toBe('unknown');
    const down = renderLayer('grad-sada', ctx({ snapshots: { ...SNAPSHOTS, 'dhmz-cap': { ...SNAPSHOTS['dhmz-cap']!, status: 'down', items: [] } } }));
    const band = down.querySelector('.tl[data-domain=safety]')!;
    expect(band.getAttribute('data-level')).toBe('unknown');
    expect(text(band.querySelector('.tl-title'))).toBe('Stanje nije potvrđeno');
    expect(text(band)).not.toContain('Nema hitnih upozorenja');
    expect(band.querySelector('.tl-trail')).toBeNull();
  });

  it('names a level only when that level is the reason: a quake with minor warnings reads the urgent word', () => {
    // safetyState raises urgent from a moderate/severe/extreme warning OR a quake
    // of M3 and up. When the quake is the reason, a minor or info warning is not
    // the verdict: "zeleno" is never a level word on any surface (R-K1).
    const minorWarnings = base('dhmz-cap', [
      { id: 'w2', module: 'dhmz-cap', kind: 'warning', tier: 'open', title: 'Vjetar u gorju', severity: 'minor', at: '2026-09-11T06:00:00Z', until: '2026-09-11T20:00:00Z' },
      { id: 'w3', module: 'dhmz-cap', kind: 'warning', tier: 'open', title: 'Promjena vremena', severity: 'info', at: '2026-09-11T06:00:00Z', until: '2026-09-11T20:00:00Z' },
    ]);
    const felt = base('emsc', [{ id: 'q2', module: 'emsc', kind: 'quake', tier: 'open', title: 'ZAGREB', at: '2026-09-11T09:00:00Z', geo: { type: 'Point', coordinates: [15.98, 45.81] }, data: { mag: 3.5, depth: 8 } }]);
    const section = renderLayer('grad-sada', atStop({ snapshots: { ...SNAPSHOTS, 'dhmz-cap': minorWarnings, emsc: felt } }));
    const band = section.querySelector('.tl[data-domain=safety]')!;
    expect(band.getAttribute('data-level')).toBe('urgent');
    expect(text(band.querySelector('.tl-title'))).toBe('Hitno sada');
    expect(text(band)).not.toContain('zeleno');
    expect(text(band)).not.toContain('obavijest');
    expect(text(band)).not.toContain('Vjetar u gorju');

    // A warning that is itself a reason for the urgency still names itself.
    const yellow = base('dhmz-cap', [...minorWarnings.items, ...SNAPSHOTS['dhmz-cap']!.items]);
    const named = renderLayer('grad-sada', atStop({ snapshots: { ...SNAPSHOTS, 'dhmz-cap': yellow, emsc: felt } }));
    expect(text(named.querySelector('.tl[data-domain=safety] .tl-title'))).toBe('žuto upozorenje: Grmljavinsko nevrijeme');
  });

  it('tiles the lines of this screen’s stop: two on the phone, four on a desk, the rest counted into Promet', () => {
    const section = renderLayer('grad-sada', atStop({ snapshots: { ...SNAPSHOTS, 'zet-rt': DATED_ZET } }));
    const tiles = [...section.querySelectorAll('.tl[data-domain=transit]')];
    expect(tiles).toHaveLength(2);
    for (const tile of tiles) {
      expect(tile.getAttribute('data-variant')).toBe('value');
      expect(tile.querySelector('.tl-label .line[data-size=s][data-kind=tram]')).not.toBeNull();
      expect(tile.getAttribute('data-layer')).toBe('u-pokretu');
      expect(JSON.parse(tile.getAttribute('data-selection')!)).toMatchObject({ kind: 'route' });
      expect(tile.getAttribute('href')).toMatch(/^#layer=u-pokretu&kind=route/);
      expect(tile.closest('.tb-lane')?.getAttribute('data-col')).toBe('sada');
    }
    const first = tiles[0]!;
    expect(text(first.querySelector('.tl-value'))).toBe('kasni 2 min');
    expect(first.querySelector('.tl-value')?.getAttribute('data-state')).toBe('late');
    // The count beside the glyph is a figure, never the word "vozila"; the destination is heard, not shown.
    expect(first.querySelector('.tl-context use')?.getAttribute('href')).toBe('#icon-tram-front');
    expect(text(first.querySelector('.tl-context'))).toBe('2');
    expect(first.getAttribute('aria-label')).toContain('Črnomerec-Sopot');
    const more = section.querySelector('[data-testid=tb-more-transit]')!;
    expect(text(more)).toBe('+ 4 linije');
    expect(more.getAttribute('aria-label')).toContain(STOP.name);
    expect(more.getAttribute('data-layer')).toBe('u-pokretu');

    const desk = renderLayer('grad-sada', ctx({ screen: DESK, snapshots: { ...SNAPSHOTS, 'zet-rt': DATED_ZET } }));
    expect(desk.querySelectorAll('.tl[data-domain=transit]')).toHaveLength(4);
    expect(text(desk.querySelector('[data-testid=tb-more-transit]'))).toBe('+ 2 linije');
    for (const surface of [section, desk]) {
      expect(text(surface)).not.toContain('vozila ZET-a u pokretu');
      expect(text(surface)).not.toContain('Kašnjenje je po liniji');
    }
  });

  it('buckets the next starts by time and keeps the sada lane for live values', () => {
    const section = renderLayer('grad-sada', atStop());
    // Saturday 20:00 is sutra; a dated notice today reads "cijeli dan" in the first time lane.
    const concert = section.querySelector('[data-testid=tb-lane-sutra] .tl[data-domain=events]')!;
    expect(text(concert.querySelector('.tl-time'))).toBe('20:00');
    expect(text(concert.querySelector('.tl-title'))).toBe('Koncert u parku');
    expect(concert.getAttribute('data-layer')).toBe('kultura');
    const notice = section.querySelector('[data-testid=tb-lane-danas] .tl[data-key="dogadanja:kvartovske:3"]')!;
    expect(text(notice.querySelector('.tl-time'))).toBe('cijeli dan');
    // An exhibition already running is not a start: agenda parity.
    expect(text(section)).not.toContain('Izložba tradicijskog nakita');
    // The one ink tile on the page is the Assembly, in its own week.
    const inks = section.querySelectorAll('.tl[data-variant=ink]');
    expect(inks).toHaveLength(1);
    expect(inks[0]!.closest('.tb-lane')?.getAttribute('data-col')).toBe('tjedan');
    expect(text(inks[0]!.querySelector('.tl-title'))).toContain('13. sjednicu');
    // The live values stay in sada: the news lead, the gazette, works and the closed road.
    const sada = section.querySelector('[data-testid=tb-lane-sada]')!;
    const news = sada.querySelector('.tl[data-domain=news]')!;
    expect(text(news.querySelector('.tl-title'))).toBe('Naslov vijesti');
    expect(text(news.querySelector('.tl-trail'))).toContain('HRT vijesti');
    const gazette = sada.querySelector('[data-testid=tile-gazette]')!;
    expect(text(gazette.querySelector('.tl-value'))).toBe('21/2026');
    expect(text(gazette.querySelector('.tl-label'))).toBe('Glasnik');
    expect(text(sada.querySelector('[data-testid=tile-works] .tl-trail'))).toBe('1');
    expect(text(sada.querySelector('[data-testid=tile-closures] .tl-title'))).toBe('Grada Vukovara');
    // Sada reads in domain order: what moves first, what the city decided last.
    expect([...sada.querySelectorAll('.tl')].map((tile) => tile.getAttribute('data-domain'))).toEqual(['transit', 'transit', 'mobility', 'komunalno', 'safety', 'news', 'civic']);
  });

  it('paints a loading source as skeleton tiles in its lane and only announces the word; a failed source offers the retry', () => {
    const section = renderLayer('grad-sada', ctx({ snapshots: {} }));
    expect(section.querySelectorAll('.tl[data-skeleton]').length).toBeGreaterThan(0);
    expect(section.querySelector('[data-testid=tb-lane-sada]')?.getAttribute('aria-busy')).toBe('true');
    expect(section.querySelector('[data-testid=tb-lane-danas]')?.getAttribute('aria-busy')).toBe('true');
    // Safety never skeletons: its band already says the state is unconfirmed.
    const safety = section.querySelector('[data-testid=tile-safety]')!;
    expect(safety.getAttribute('data-level')).toBe('unknown');
    expect(safety.hasAttribute('data-skeleton')).toBe(false);
    expect(text(section)).toContain('učitavanje podataka');
    for (const hidden of [...section.querySelectorAll('.visually-hidden')]) hidden.remove();
    expect(text(section)).not.toContain('učitavanje podataka');
    // A source that failed says so and offers the retry at the lane's foot, never a skeleton that never ends.
    const down = renderLayer('grad-sada', ctx({ snapshots: {}, errors: { 'hrt-news': 'fetch failed' } }));
    expect(down.querySelector('[data-testid=tb-lane-sada] [data-action=retry][data-module=hrt-news]')).not.toBeNull();
    expect(down.querySelector('[data-testid=tile-news]')).toBeNull();
    expect(down.querySelectorAll('[data-testid=tb-lane-sada] .tl[data-skeleton][data-variant=row]')).toHaveLength(0);
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
  // T3.6: the lightweight face reads like the map's sheet -- the same board grammar without a stage.
  it('the lightweight face: a search field first, "Linije u pokretu" as a board of rows with small badges (eight, then "još N linija" through the page filter), the host’s list, closures four then more, three notices, no map, no canvas, the honesty note once', () => {
    const i18n = createDefaultI18n('hr');
    const pins = Array.from({ length: 10 }, (_, i) => ({
      id: `vehicle:l${i}`, module: 'zet-rt' as const, kind: 'vehicle' as const, tier: 'session' as const, title: String(i + 1),
      geo: { type: 'Point' as const, coordinates: [15.97 + i / 1000, 45.81] as [number, number] }, data: { routeId: String(i + 1), routeType: 0 },
    }));
    const zet: ModuleSnapshot = { ...SNAPSHOTS['zet-rt']!, items: [...pins, { id: 'route:6', module: 'zet-rt', kind: 'vehicle', tier: 'session', title: '6', data: { routeId: '6', medianDelaySeconds: 90, vehicles: 1 } }] };
    const notices = Array.from({ length: 5 }, (_, i) => ({
      id: `zet-promet:${i}`, module: 'dogadanja' as const, kind: 'event' as const, tier: 'session' as const, title: `Obavijest ${i}`, at: '2026-09-11T08:00:00Z', link: 'https://zet.hr/promet', data: { source: 'zet-promet' },
    }));
    const snapshots = { ...SNAPSHOTS, 'zet-rt': zet, prometnice: MANY_CLOSURES, dogadanja: { ...SNAPSHOTS.dogadanja!, items: notices } };
    const schematic = createSchematicHost({ i18n, scope: { kind: 'network' }, lightweight: true, now: () => NOW });
    const face = (filters: Record<string, string>, host = true): HTMLElement =>
      renderLayer('u-pokretu', ctx({ i18n, snapshots, lightweight: true, view: { layer: 'u-pokretu', selection: null, filters }, ...(host ? { schematic } : {}) })).querySelector<HTMLElement>('[data-testid=transport-light]')!;
    const light = face({});
    // No stage, no map, no canvas, no workspace.
    expect(light.querySelector('#u-pokretu-map')).toBeNull();
    expect(light.querySelector('canvas')).toBeNull();
    expect(light.querySelector('[data-testid=transport-workspace]')).toBeNull();
    // The search field comes first and is the page's own filter (dashboard.ts's input delegation), 44 px by base.css.
    const input = light.firstElementChild!.querySelector<HTMLInputElement>('input[type=search]')!;
    expect(input.dataset.filterKey).toBe('q');
    // The board: static signage rows with small badges, eight of ten shown, the fold as a filter action.
    const rows = [...light.querySelectorAll<HTMLElement>('[data-testid=running-routes] .row')];
    expect(rows).toHaveLength(10);
    expect(rows.filter((r) => !r.hidden)).toHaveLength(8);
    expect(rows.every((r) => r.querySelector('.line[data-size="s"]') !== null)).toBe(true);
    expect(light.querySelector('[data-testid=running-routes] button')).toBeNull(); // nothing here opens a detail: there is no handler on this path
    const more = light.querySelector<HTMLButtonElement>('[data-action=filter][data-filter-key=routes]')!;
    expect(text(more)).toBe('još 2 linije');
    expect(more.dataset.filterValue).toBe('all');
    expect(more.getAttribute('aria-expanded')).toBe('false');
    const six = rows.find((r) => text(r.querySelector('.line')) === '6')!;
    // T2.12: the spelled-out count gives way to the glyph in this compact row (newdesignsystem.md's "vehicles on
    // line" rule, tram-front/bus-front + the bare count); the sentence for a screen reader lives on the glyph's own
    // label, so nothing here leans on the bare digit or the icon's shape alone.
    const vehicleGlyph = six.querySelector<HTMLElement>('.row-sub [role="img"]')!;
    expect(vehicleGlyph.getAttribute('aria-label')).toBe('1 vozilo u pokretu');
    expect(vehicleGlyph.querySelector('use')?.getAttribute('href')).toBe('#icon-tram-front');
    expect(text(vehicleGlyph)).toBe('1');
    expect(text(six.querySelector('.route-delay'))).toBe('kasni 2 min');
    expect(six.querySelector('.route-delay')!.getAttribute('data-state')).toBe('late');
    expect(rows.filter((r) => r !== six).every((r) => r.querySelector('.route-delay') === null)).toBe(true); // no median, no word
    // The host's list face under its own head; the closures four of twenty, then "sve zatvaranja (20)"; three notices.
    expect(light.querySelector('[data-testid=schematic-host] [data-testid=schematic-list]')).not.toBeNull();
    const closures = [...light.querySelectorAll<HTMLElement>('[data-testid=transport-closures] .row')];
    expect(closures).toHaveLength(20);
    expect(closures.filter((r) => !r.hidden)).toHaveLength(4);
    expect(closures.every((r) => r.querySelector('.mark-closure') !== null && r.querySelector('button') === null)).toBe(true);
    expect(text(light.querySelector('[data-action=filter][data-filter-key=closures]'))).toBe('sve zatvaranja (20)');
    expect(light.querySelectorAll('[data-testid=transport-notices] .row')).toHaveLength(3);
    // The honesty sentence exactly once on the face: the host carries it under its list.
    expect(text(light).split('ZET ne objavljuje smjer ni brzinu').length - 1).toBe(1);
    // The folds open and the query narrows through the page's own filters; the field keeps its text.
    const open = face({ routes: 'all', closures: 'all', q: '6' });
    expect(open.querySelector<HTMLInputElement>('input[type=search]')!.value).toBe('6');
    expect([...open.querySelectorAll('[data-testid=running-routes] .row')].map((r) => text(r.querySelector('.line')))).toEqual(['6']);
    expect([...open.querySelectorAll<HTMLElement>('[data-testid=transport-closures] .row')].filter((r) => !r.hidden)).toHaveLength(20);
    expect(text(open.querySelector('[data-action=filter][data-filter-key=closures]'))).toBe('Skupi');
    expect(text(face({ q: 'zzz' }).querySelector('[data-testid=transport-no-results]'))).toContain('zzz');
    // Without a host (a unit context) the face still says the sentence, once.
    const bare = face({}, false);
    expect(bare.querySelector('[data-testid=transport-note]')).not.toBeNull();
    expect(text(bare).split('ZET ne objavljuje smjer ni brzinu').length - 1).toBe(1);
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
    expect(section.querySelector('#wx-sun .g-sun')).not.toBeNull();
    // The measured value sits on today's forecast range; wind reads as a compass point, never "calm" while it blows.
    expect(text(section.querySelector('[data-testid=forecast-range]'))).toBe('od 12 do 24 °C');
    expect(text(section.querySelector('[data-testid=wind-text]'))).toBe('SZ 2 m/s');
    expect(section.querySelector('#wx-range .g-range')).not.toBeNull();
  });
  it('sigurnost renders the open modules and points at the untimed page', () => {
    const section = renderLayer('sigurnost', ctx());
    for (const id of ['sf-numbers', 'sf-warnings', 'sf-closures', 'sf-pharmacies', 'sf-quakes', 'sf-assembly']) expect(section.querySelector(`#${id}`), id).not.toBeNull();
    expect(section.querySelector('[data-testid=safety-level]')?.getAttribute('data-level')).toBe('urgent');
    expect(section.querySelectorAll('a[href^="tel:"]').length).toBeGreaterThanOrEqual(5);
    const link = section.querySelector<HTMLAnchorElement>('[data-testid=hitno-link]')!;
    expect(link.getAttribute('href')).toBe('/hitno');
    expect(text(link)).toBe('Ista stranica bez skeniranja: Sigurnost');
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
  it('Grad lists the Assembly session and the communal work as rows: the session dated, the work with its phase word and amount, the body and the livestream in the open session', () => {
    const section = renderLayer('uprava-i-pravo', ctx());
    const rows = [...section.querySelectorAll('[data-testid=city-work-row]')].map((row) => ({ el: row, text: text(row) }));
    expect(rows).toHaveLength(2);

    const skupstina = rows.find((r) => r.text.includes('Poziv na 13. sjednicu'))!;
    expect(skupstina.text).toContain('Stara gradska vijećnica');
    expect(text(section.querySelector('#cv-sessions .sec-title'))).toBe('Gradska skupština');
    const open = renderLayer('uprava-i-pravo', ctx({ view: { layer: 'uprava-i-pravo', selection: { kind: 'item', id: publicItemKey('dogadanja', 'skupstina:4'), module: 'dogadanja' }, filters: {} } }));
    const detail = open.querySelector('[data-testid=civic-detail]')!;
    expect(detail.querySelector('a[href="https://www.youtube.com/channel/UCRMm4Xt9ruoQ8FG7NpIHCsA"]')).not.toBeNull();
    expect(detail.querySelector('a[href="https://skupstina.zagreb.hr/poziv"]')).not.toBeNull();
    expect(detail.querySelector('[data-action=ics-item]')).not.toBeNull(); // a timed, dated session may go into a calendar
    // The organising body is a labelled fact of the detail, not a line on the row.
    expect(text(detail)).toContain('Gradske skupštine Grada Zagreba');

    const komunalne = rows.find((r) => r.text.includes('Horvati'))!;
    expect(komunalne.text).toContain('Radovi u tijeku');
    expect(komunalne.text).toContain('1.500');
    expect(komunalne.text).toContain('€');
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
    // Began before now, still runs: never listed as a next start; its row sits under "U tijeku" with the end date at the row's end.
    expect(izlozba).toMatch(/do 1. 10.$/);
    expect(text(section.querySelector('#ev-ongoing [data-testid=event-row]'))).toContain('Izložba tradicijskog nakita');
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
    // The head is the short weekday date in sentence case ("pet 18. 9."): this year's agenda needs no year.
    expect(text(section.querySelector('#ev-agenda .agenda-day'))).toBe('pet 18. 9.');
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
    expect(section.querySelector('#nw-hrt')).not.toBeNull();
    expect(section.querySelector('#nw-sljeme')).not.toBeNull();
    const lead = section.querySelector('#nw-hrt .nw-lead')!;
    expect(lead.tagName).toBe('ARTICLE'); // a plain article, never a card
    expect(text(lead)).toContain('Naslov vijesti');
    expect(text(lead)).toContain('prije 1 sat'); // 11:00Z is 13:00 in Zagreb, an hour and a half before NOW
    const open = renderLayer('vijesti', ctx({ view: { layer: 'vijesti', selection: { kind: 'item', id: publicItemKey('hrt-news', 'n1'), module: 'hrt-news' }, filters: {} } }));
    const detail = open.querySelector('[data-testid=news-detail]')!;
    expect(detail.querySelector('a[href="https://vijesti.hrt.hr/clanak"]')).not.toBeNull();
    expect(text(detail)).toContain('Sažetak');
    expect(text(section.querySelector('[data-testid=panel-attr]'))).toContain('Izvor: hrt-news');
  });
  it('the lead is a plain article with no background box, and its class list never grows a card class', () => {
    const section = renderLayer('vijesti', ctx());
    const lead = section.querySelector('#nw-hrt .nw-lead')!;
    expect(lead.classList.contains('nw-lead-box')).toBe(false);
    expect(lead.classList.contains('sec')).toBe(false);
    expect(lead.classList.contains('tile')).toBe(false);
  });
  it('heads each source with its own build time, "objavljeno" when the feed states one and "dohvaćeno" when only the fetch time is known, and shows a status badge only when a source is not live', () => {
    const mixed: ModuleSnapshot = {
      ...base('hrt-news', [
        { id: 'h1', module: 'hrt-news', kind: 'news', tier: 'open', title: 'Naslov vijesti', summary: 'Sažetak', link: 'https://vijesti.hrt.hr/clanak', at: '2026-09-11T11:00:00Z', data: { source: 'HRT vijesti' } },
      ] as ModuleSnapshot['items']),
      sources: {
        'HRT vijesti': { status: 'live', itemCount: 1, fetchedAt: new Date(NOW - 60_000).toISOString(), sourceUpdatedAt: '2026-09-11T11:40:00Z' },
        'Radio Sljeme': { status: 'down', itemCount: 0 },
      },
    };
    const section = renderLayer('vijesti', ctx({ snapshots: { ...SNAPSHOTS, 'hrt-news': mixed } }));
    expect(text(section.querySelector('#nw-hrt header'))).toContain('objavljeno 13:40');
    expect(section.querySelector('#nw-hrt [data-testid=news-source-status]')).toBeNull(); // a live source needs no pill
    expect(text(section.querySelector('#nw-sljeme [data-testid=news-source-status]'))).toContain('nedostupan');
    expect(text(section.querySelector('#nw-sljeme'))).toContain('Radio Sljeme trenutačno ne odgovara');
  });
  it('shows a lead and six rows by default, pages the rest ten at a time under its own filter key, and keeps every source independent', () => {
    const hrtItems = Array.from({ length: 20 }, (_, i) => ({
      id: `hrt${i + 1}`, module: 'hrt-news' as const, kind: 'news' as const, tier: 'open' as const,
      title: `Naslov ${i + 1}`,
      summary: i === 0 ? 'Uvodni odlomak prve vijesti, dovoljno dug da pokaže prozu bez skraćivanja na tri retka.' : `Sažetak ${i + 1}`,
      link: `https://vijesti.hrt.hr/clanak-${i + 1}`, at: new Date(NOW - (i + 1) * 5 * 60_000).toISOString(), data: { source: 'HRT vijesti' },
    }));
    const sljemeItems = Array.from({ length: 3 }, (_, i) => ({
      id: `sljeme${i + 1}`, module: 'hrt-news' as const, kind: 'news' as const, tier: 'open' as const,
      title: `Sljeme naslov ${i + 1}`, summary: `Sljeme sažetak ${i + 1}`,
      link: `https://sljeme.hrt.hr/clanak-${i + 1}`, at: new Date(NOW - (i + 1) * 7 * 60_000).toISOString(), data: { source: 'Radio Sljeme' },
    }));
    const manyNews: ModuleSnapshot = {
      ...base('hrt-news', [...hrtItems, ...sljemeItems] as ModuleSnapshot['items']),
      sources: {
        'HRT vijesti': { status: 'live', itemCount: 20, fetchedAt: new Date(NOW - 60_000).toISOString(), sourceUpdatedAt: '2026-09-11T11:40:00Z' },
        'Radio Sljeme': { status: 'live', itemCount: 3, fetchedAt: '2026-09-11T11:45:00Z' },
      },
    };
    const snapshots = { ...SNAPSHOTS, 'hrt-news': manyNews };
    const section = renderLayer('vijesti', ctx({ snapshots }));
    const hrt = section.querySelector('#nw-hrt')!;
    const sljeme = section.querySelector('#nw-sljeme')!;
    expect(text(hrt.querySelector('header'))).toContain('objavljeno 13:40');
    expect(text(sljeme.querySelector('header'))).toContain('dohvaćeno 13:45');
    expect(text(hrt.querySelector('.nw-lead'))).toContain('Naslov 1');
    expect(hrt.querySelectorAll('[data-testid=news-row]')).toHaveLength(6); // the lead is not one of the six
    expect(text(hrt.querySelector('[data-testid=news-row]'))).toContain('Naslov 2'); // the first row after the lead
    const more = hrt.querySelector('[data-action=filter][data-filter-key=hrt]')!;
    expect(text(more)).toBe('Prikaži još 10');
    expect(more.getAttribute('data-filter-value')).toBe('16');
    const expanded = renderLayer('vijesti', ctx({ snapshots, view: { layer: 'vijesti', selection: null, filters: { hrt: '16' } } }));
    expect(expanded.querySelector('#nw-hrt')!.querySelectorAll('[data-testid=news-row]')).toHaveLength(16);
    // Radio Sljeme has only three items: a lead and two rows, and no filter of its own is exhausted.
    expect(sljeme.querySelectorAll('[data-testid=news-row]')).toHaveLength(2);
    expect(sljeme.querySelector('[data-action=filter]')).toBeNull();
    // Selecting a Radio Sljeme story opens a link labelled for that source.
    const sljemeOpen = renderLayer('vijesti', ctx({ snapshots, view: { layer: 'vijesti', selection: { kind: 'item', id: publicItemKey('hrt-news', 'sljeme1'), module: 'hrt-news' }, filters: {} } }));
    expect(text(sljemeOpen.querySelector('[data-testid=news-detail] a.btn-primary'))).toBe('Otvori na Radio Sljemenu');
  });
  it('opens a story to a labelled 48 px primary link, copy and share, and no kicker line', () => {
    const open = renderLayer('vijesti', ctx({ view: { layer: 'vijesti', selection: { kind: 'item', id: publicItemKey('hrt-news', 'n1'), module: 'hrt-news' }, filters: {} } }));
    const detail = open.querySelector('[data-testid=news-detail]')!;
    expect(detail.querySelector('.kicker')).toBeNull(); // kickers are retired
    const primary = detail.querySelector('a.btn-primary')!;
    expect(primary.getAttribute('href')).toBe('https://vijesti.hrt.hr/clanak');
    expect(text(primary)).toBe('Otvori na HRT-u');
    expect(detail.querySelector('[data-action=copy-item][data-module=hrt-news][data-item-id=n1]')).not.toBeNull();
    expect(detail.querySelector('[data-action=share-item][data-module=hrt-news][data-item-id=n1]')).not.toBeNull();
    expect(detail.querySelector('[data-action=ics-item]')).toBeNull(); // never an unverified date on a calendar
  });
  it('moves the RSS disclaimer into the attribution foot and drops the line that used to sit under the page title', () => {
    const section = renderLayer('vijesti', ctx());
    const disclaimer = 'Sažetak je uvodni odlomak iz HRT-ova RSS-a; cijeli članak je na izvorniku.';
    expect(text(section.querySelector('.ws-head'))).not.toContain(disclaimer);
    expect(text(section.querySelector('[data-testid=panel-attr]'))).toContain(disclaimer);
    // An attribution line like the credit above it: the phone type floor exempts .source-line, not a class of its own.
    expect(section.querySelector('[data-testid=panel-attr] .nw-disclaimer')?.classList.contains('source-line')).toBe(true);
  });
});

// T3.1 (plan "Vrijeme", finding 13): the observation as the largest object,
// three facts on one hairline strip, today's range with the DHMZ prose, the
// sun as the only other figure, warnings as rows, quakes as rows first. No
// dial, no arc gauge, no magnitude bars, no card boxes.
describe('Vrijeme: observation, today, sun, warnings and quakes (T3.1)', () => {
  const weather = (over: Partial<LayerContext> = {}) => renderLayer('zrak-i-nebo', ctx(over));
  const quakeAt = (i: number, geo: [number, number] | null): ModuleSnapshot['items'][number] => ({
    id: `q${i}`, module: 'emsc', kind: 'quake', tier: 'open', title: 'CROATIA',
    at: new Date(NOW - i * 3_600_000 * 7).toISOString(),
    ...(geo ? { geo: { type: 'Point', coordinates: geo } } : {}),
    data: { mag: 1 + i / 10, depth: 10 },
  });
  // Eight quakes inside 150 km and 7 days; the last one has no coordinates, so the radar cannot place it.
  const MANY_QUAKES: ModuleSnapshot = base('emsc', [
    quakeAt(1, [15.5, 45.5]), quakeAt(2, [16.2, 45.9]), quakeAt(3, [15.9, 46.2]), quakeAt(4, [16.5, 45.6]),
    quakeAt(5, [15.2, 45.9]), quakeAt(6, [16.0, 45.3]), quakeAt(7, [15.7, 46.0]), quakeAt(8, null),
  ]);
  const EMPTY_CAP: ModuleSnapshot = base('dhmz-cap', []);
  const CALM: ModuleSnapshot = base('dhmz-now', [{ id: 'o1', module: 'dhmz-now', kind: 'observation', tier: 'open', title: 'Maksimir', at: '2026-09-11T12:00:00Z', data: { temp: 21, humidity: 54, pressure: 1013, windDir: 'C', windSpeed: 0, weather: 'vedro' } }]);

  it('leads with the measured temperature as temp-now, the condition beside it with its icon, and the station line under them', () => {
    const now = weather().querySelector('#wx-now')!;
    expect(text(now.querySelector('[data-testid=temp-now]'))).toBe('21 °C');
    expect(text(now.querySelector('[data-testid=temp-now]'))).toMatch(/ °C$/);
    expect(now.querySelector('.wx-temp')).not.toBeNull();
    expect(text(now.querySelector('.wx-cond'))).toBe('vedro');
    expect(now.querySelector('.wx-cond .icon use')?.getAttribute('href')).toBe('#icon-sun');
    expect(text(now.querySelector('.wx-obs'))).toBe('Maksimir · izmjereno 14:00');
    // The observation carries no kicker and no card head; its heading is for readers of the tree only.
    expect(now.querySelector('.kicker')).toBeNull();
    expect(now.querySelector('#wx-now-title')).not.toBeNull();
  });

  it('draws no dial and no gauge anywhere in the layer, and no magnitude bars', () => {
    const section = weather();
    expect(section.querySelector('.g-compass')).toBeNull();
    expect(section.querySelector('.g-arc')).toBeNull();
    expect(section.querySelector('.g-bars')).toBeNull();
    // The sun path is the only figure besides the range bar and the radar.
    expect([...section.querySelectorAll('svg.g')].map((svg) => svg.getAttribute('class'))).toEqual(['g g-range', 'g g-sun', 'g g-radar']);
  });

  it('reads wind, humidity and pressure as three labelled facts on one strip, the wind with an arrow that flies with it', () => {
    const facts = weather().querySelector('#wx-now .wx-figures')!;
    expect(facts.querySelectorAll('.wx-fact')).toHaveLength(3);
    expect(text(facts)).toContain('hPa');
    expect(text(facts)).toContain('1013 hPa');
    expect(text(facts)).toContain('54 %');
    expect([...facts.querySelectorAll('.wx-fact-label')].map(text)).toEqual(['Vjetar', 'Vlaga', 'Tlak']);
    expect(text(facts.querySelector('[data-testid=wind-text]'))).toBe('SZ 2 m/s');
    // A north-west wind blows towards the south-east: the up arrow turns 135 degrees, and it is named for a reader of the tree.
    const arrow = facts.querySelector('.wx-arrow')!;
    expect(arrow.getAttribute('style')).toBe('rotate: 135deg');
    expect(arrow.getAttribute('aria-label')).toBe('sjeverozapad');
    expect(arrow.querySelector('use')?.getAttribute('href')).toBe('#icon-arrow-up');
  });

  it('says "bez vjetra" with no arrow when the station reads zero', () => {
    const facts = weather({ snapshots: { ...SNAPSHOTS, 'dhmz-now': CALM } }).querySelector('#wx-now .wx-figures')!;
    expect(text(facts.querySelector('[data-testid=wind-text]'))).toBe('bez vjetra');
    expect(facts.querySelector('.wx-arrow')).toBeNull();
  });

  it('heads today with "Danas", keeps the range sentence, sets the DHMZ narrative as prose and dates its validity', () => {
    const range = weather().querySelector('#wx-range')!;
    expect(text(range.querySelector('.sec-title'))).toBe('Danas');
    expect(range.querySelector('.kicker')).toBeNull();
    expect(text(range.querySelector('[data-testid=forecast-range]'))).toBe('od 12 do 24 °C');
    expect(text(range.querySelector('.wx-prose'))).toBe('Sunčano');
    expect(text(range.querySelector('.sec-note'))).toContain('Prognoza DHMZ-a za Zagreb');
    expect(range.querySelector('.g-wrap-range .g-label-min')?.textContent).toBe('12°');
    expect(range.querySelector('.g-wrap-range .g-label-max')?.textContent).toBe('24°');
  });

  it('gives the sun its path, one line of numerals, the time to the next horizon crossing and the honesty foot', () => {
    const sun = weather().querySelector('#wx-sun')!;
    expect(text(sun.querySelector('.sec-title'))).toBe('Sunce');
    expect(sun.querySelector('.g-sun')).not.toBeNull();
    expect(text(sun.querySelector('.wx-sun-times'))).toMatch(/^izlazak \d\d:\d\d · zalazak \d\d:\d\d · dan traje \d+ h \d+ min$/);
    // Each part holds together on a narrow line: the break falls after a separator, never inside a number.
    expect(sun.querySelectorAll('.wx-sun-times .wx-nowrap')).toHaveLength(3);
    // 14:32 in Zagreb on 11 September: the sun is up, so the next crossing is the sunset.
    expect(text(sun.querySelector('.wx-sun-until'))).toMatch(/^do zalaska \d+ h \d+ min$/);
    expect(text(sun.querySelector('.sec-note'))).toBe('Izračunato na uređaju, nije prognoza.');
    // The axis under the arc names its three points in words; the numbers live once, in the line above.
    expect([...sun.querySelectorAll('.g-labels span')].map(text)).toEqual(['izlazak', 'podne', 'zalazak']);
  });

  it('says "do izlaska" at night', () => {
    const night = weather({ now: Date.parse('2026-09-11T21:00:00Z') }).querySelector('#wx-sun')!;
    expect(text(night.querySelector('.wx-sun-until'))).toMatch(/^do izlaska \d+ h \d+ min$/);
  });

  it('lists a warning as the severity word with its shape, the event, its window and its text', () => {
    const row = weather().querySelector('#wx-warnings [data-testid=warning-row]')!;
    expect(row).not.toBeNull();
    const badge = row.querySelector('.badge-sev')!;
    expect(badge.getAttribute('data-tone')).toBe('moderate');
    expect(text(badge)).toBe('žuto upozorenje');
    expect(text(row.querySelector('.wx-warning-event'))).toBe('Grmljavinsko nevrijeme');
    // Both ends fall today, so the window reads as times, and the state word says it is in force.
    expect(text(row.querySelector('.wx-warning-window'))).toBe('na snazi · od 14:00 do 20:00');
    expect(text(row.querySelector('.wx-prose'))).toBe('Moguć jak vjetar');
  });

  it('confirms an empty warnings list with the time it was confirmed', () => {
    const warnings = weather({ snapshots: { ...SNAPSHOTS, 'dhmz-cap': EMPTY_CAP } }).querySelector('#wx-warnings')!;
    expect(text(warnings.querySelector('.state[data-kind=empty]'))).toBe('Nema upozorenja DHMZ-a za Zagreb. Potvrđeno 14:31.');
    expect(warnings.querySelector('[data-testid=warning-row]')).toBeNull();
  });

  it('lists quakes as rows first, five then "Prikaži još", the radar after them with an honest count of what it could place', () => {
    const quakes = weather({ snapshots: { ...SNAPSHOTS, emsc: MANY_QUAKES } }).querySelector('#wx-quakes')!;
    expect(text(quakes.querySelector('.sec-title'))).toBe('Potresi, 7 dana, 150 km');
    const rows = [...quakes.querySelectorAll('[data-testid=quake-row]')];
    expect(rows).toHaveLength(5);
    expect(text(rows[0]!.querySelector('.wx-mag'))).toBe('M 1,1');
    expect(text(rows[0]!.querySelector('.row-title'))).toMatch(/^\d+ km od Zagreba · dubina 10 km$/);
    expect(text(rows[0]!.querySelector('.row-sub'))).toMatch(/^\d+\. \d+\. \d\d:\d\d$/);
    const more = quakes.querySelector('[data-action=filter][data-filter-key=quakes]')!;
    expect(text(more)).toBe('Prikaži još 3');
    expect(more.getAttribute('data-filter-value')).toBe('15');
    // Rows come before the figure in reading order.
    const list = quakes.querySelector('[data-testid=quakes]')!;
    const radar = quakes.querySelector('.g-wrap-radar')!;
    expect(list.compareDocumentPosition(radar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(radar.querySelectorAll('circle[data-key]')).toHaveLength(7);
    expect(text(quakes.querySelector('.wx-on-figure'))).toBe('na slici 7 od 8');

    const expanded = weather({ snapshots: { ...SNAPSHOTS, emsc: MANY_QUAKES }, view: { layer: 'zrak-i-nebo', selection: null, filters: { quakes: '15' } } });
    expect(expanded.querySelectorAll('[data-testid=quake-row]')).toHaveLength(8);
    expect(expanded.querySelector('[data-action=filter][data-filter-key=quakes]')).toBeNull();
  });

  it('needs no honesty sentence and no "more" button for the three-quake week the fixture describes', () => {
    const quakes = weather().querySelector('#wx-quakes')!;
    expect(quakes.querySelector('.wx-on-figure')).toBeNull();
    expect(quakes.querySelector('[data-action=filter][data-filter-key=quakes]')).toBeNull();
    // A quake without a distance still says where it was, from the source's own region name.
    const shallow = { ...quakeAt(1, null), data: { mag: 1.1, depth: 0.7 } };
    const unplaced = weather({ snapshots: { ...SNAPSHOTS, emsc: base('emsc', [shallow]) } }).querySelector('[data-testid=quake-row] .row-title');
    expect(text(unplaced)).toBe('CROATIA · dubina 0,7 km');
  });

  it('keeps the layer heading for the tree and the grid names the container rules pin, and every section is flat', () => {
    const section = weather();
    expect(text(section.querySelector('.layer-title'))).toBe('Vrijeme');
    expect(section.querySelector('.ws-head.wx-head')).not.toBeNull();
    expect(section.querySelector('.wx-grid')).not.toBeNull();
    for (const id of ['wx-now', 'wx-range', 'wx-sun', 'wx-warnings', 'wx-quakes']) {
      const sec = section.querySelector(`#${id}`)!;
      expect(sec, id).not.toBeNull();
      expect(sec.classList.contains('wx-sec'), `${id} is a flat weather section`).toBe(true);
      expect(sec.classList.contains(id), `${id} carries its id as the class its own rules hook on`).toBe(true);
    }
    expect(section.querySelector('#wx-now')!.classList.contains('wx-wide')).toBe(true);
  });
});

// T3.2 (plan "Sigurnost", findings 9 and 12, R-K1, R-K4): the verdict first as
// one band, the numbers as the only tiles, warnings and quakes as the rows
// Vrijeme uses, five closures then the way into Promet, the six on-duty
// pharmacies nearest the screen first, and the assembly points grouped by
// gradska četvrt when the source names one. No card except the tiles.
describe('Sigurnost: verdict, numbers, pharmacies, assembly points (T3.2)', () => {
  const safety = (over: Partial<LayerContext> = {}) => renderLayer('sigurnost', ctx(over));
  const emptyLive = (module: ModuleSnapshot['module']): ModuleSnapshot => base(module, []);
  const CALM_SNAPSHOTS = { ...SNAPSHOTS, 'dhmz-cap': emptyLive('dhmz-cap'), emsc: emptyLive('emsc') };
  const point = (i: number, district: string | undefined, geo?: [number, number]): ModuleSnapshot['items'][number] => ({
    id: `p${i}`, module: 'ckan-geo', kind: 'poi', tier: 'open', title: `Zborno mjesto ${i}`, summary: `Ulica ${i}`,
    ...(geo ? { geo: { type: 'Point', coordinates: geo } } : {}),
    data: { layer: 'zborna-mjesta', category: 'Zborno mjesto civilne zaštite', ...(district ? { district } : {}) },
  });
  // Forty points as the official GeoJSON spells its districts ("Gornji Grad-Medveščak"): twenty in Gornji grad,
  // fifteen in Donji grad, three in Podsljeme, one in a district the table does not know, one with none.
  const DISTRICT_POINTS: ModuleSnapshot = base('ckan-geo', [
    ...Array.from({ length: 20 }, (_, i) => point(i + 1, 'Gornji Grad-Medveščak', [15.98, 45.82])),
    ...Array.from({ length: 15 }, (_, i) => point(i + 21, 'Donji Grad', [15.978, 45.811])),
    ...Array.from({ length: 3 }, (_, i) => point(i + 36, 'Podsljeme')),
    point(39, 'Nova četvrt'),
    point(40, undefined),
  ]);
  const quakesWithin72h = (count: number): ModuleSnapshot => base('emsc', Array.from({ length: count }, (_, i) => ({
    id: `q${i + 1}`, module: 'emsc', kind: 'quake', tier: 'open', title: 'CROATIA',
    at: new Date(NOW - (i + 1) * 3_600_000 * 9).toISOString(), geo: { type: 'Point', coordinates: [15.5 + i / 10, 45.5] }, data: { mag: 1 + i / 10, depth: 10 },
  })) as ModuleSnapshot['items']);

  it('opens with the verdict as one band: shield, the warning that is the reason in the DHMZ colour word, its window under it', () => {
    const band = safety().querySelector('[data-testid=safety-level]')!;
    expect(band.classList.contains('band')).toBe(true);
    expect(band.classList.contains('sf-level'), 'the print rule and the on-tint literal hook on .sf-level').toBe(true);
    expect(band.getAttribute('data-level')).toBe('urgent');
    expect(band.querySelector('svg use')?.getAttribute('href')).toBe('#icon-shield');
    expect(text(band.querySelector('.band-title'))).toBe('Žuto upozorenje: grmljavinsko nevrijeme');
    expect(text(band.querySelector('.sf-verdict-note'))).toBe('na snazi · od 14:00 do 20:00');
    expect(text(band)).not.toContain('zeleno');
  });

  it('confirms calm with the time and the sentence about numbers and pharmacies, and never claims it while a source is silent', () => {
    const calm = safety({ snapshots: CALM_SNAPSHOTS }).querySelector('[data-testid=safety-level]')!;
    expect(calm.getAttribute('data-level')).toBe('calm');
    expect(text(calm.querySelector('.band-title'))).toBe('Nema hitnih upozorenja');
    expect(text(calm.querySelector('.sf-verdict-note'))).toMatch(/^Potvrđeno \d\d:\d\d\. Brojevi i ljekarne vrijede uvijek\.$/);

    const unknown = safety({ snapshots: { ...CALM_SNAPSHOTS, emsc: undefined } }).querySelector('[data-testid=safety-level]')!;
    expect(unknown.getAttribute('data-level')).toBe('unknown');
    expect(text(unknown.querySelector('.band-title'))).toBe('Stanje nije potvrđeno');
    expect(text(unknown.querySelector('.sf-verdict-note'))).toBe('Dio sigurnosnih izvora ne odgovara; stanje nije potvrđeno.');
  });

  it('names the quake as the reason when no warning is one, in the domain word and never a lesser warning\u2019s colour (R-K1)', () => {
    const minor = base('dhmz-cap', [{ id: 'w2', module: 'dhmz-cap', kind: 'warning', tier: 'open', title: 'Vjetar u gorju', severity: 'minor', at: '2026-09-11T06:00:00Z', until: '2026-09-11T20:00:00Z' }]);
    const felt = base('emsc', [{ id: 'q2', module: 'emsc', kind: 'quake', tier: 'open', title: 'ZAGREB', at: '2026-09-11T09:00:00Z', geo: { type: 'Point', coordinates: [15.98, 45.81] }, data: { mag: 3.5, depth: 8 } }]);
    const band = safety({ snapshots: { ...SNAPSHOTS, 'dhmz-cap': minor, emsc: felt } }).querySelector('[data-testid=safety-level]')!;
    expect(band.getAttribute('data-level')).toBe('urgent');
    expect(text(band.querySelector('.band-title'))).toBe('Hitno sada');
    expect(text(band.querySelector('.sf-verdict-note'))).toMatch(/^M 3,5 · \d+ km od Zagreba · prije 3 sata$/);
    expect(text(band)).not.toContain('Vjetar u gorju');
  });

  it('offers the same page without a scan as a 44 px link right under the band', () => {
    const section = safety();
    const link = section.querySelector<HTMLAnchorElement>('[data-testid=hitno-link]')!;
    expect(link.getAttribute('href')).toBe('/hitno');
    expect(text(link)).toBe('Ista stranica bez skeniranja: Sigurnost');
    expect(link.classList.contains('link-arrow')).toBe(true);
    expect(link.parentElement?.classList.contains('sf-verdict')).toBe(true);
    expect(link.previousElementSibling?.getAttribute('data-testid')).toBe('safety-level');
  });

  it('sets the five emergency numbers as tiles, 112 first and inverted across two columns, every one a tel: link', () => {
    const list = safety().querySelector('#sf-numbers .sf-numbers')!;
    const tiles = [...list.querySelectorAll<HTMLAnchorElement>('a.tile')];
    expect(tiles).toHaveLength(5);
    expect(tiles.map((t) => text(t.querySelector('.tile-value')))).toEqual(['112', '192', '193', '194', '1987']);
    expect(tiles.every((t) => t.getAttribute('href')?.startsWith('tel:'))).toBe(true);
    expect(tiles.every((t) => t.classList.contains('sf-number'))).toBe(true);
    expect(tiles[0]!.classList.contains('tile-primary')).toBe(true);
    expect(tiles[0]!.classList.contains('sf-number-primary'), 'print.css draws the inverted tile a border by this class').toBe(true);
    expect(tiles.slice(1).some((t) => t.classList.contains('tile-primary'))).toBe(false);
    expect(text(tiles[0]!.querySelector('.tile-label'))).toBe('jedinstveni europski broj za hitne službe');
    // The accessible name is the tile's own content, so it can never disagree with what is printed on it.
    expect(tiles.some((t) => t.hasAttribute('aria-label'))).toBe(false);
    expect(list.parentElement!.querySelectorAll('.source-line')).toHaveLength(1);
  });

  it('lists a warning the way Vrijeme does, with the onset time of one that is only announced', () => {
    const row = safety().querySelector('#sf-warnings [data-testid=warning-row]')!;
    expect(text(row.querySelector('.badge-sev'))).toBe('žuto upozorenje');
    expect(text(row)).toContain('Grmljavinsko nevrijeme');
    expect(text(row.querySelector('.wx-warning-window'))).toBe('na snazi · od 14:00 do 20:00');

    const announced = base('dhmz-cap', [{ id: 'w4', module: 'dhmz-cap', kind: 'warning', tier: 'open', title: 'Vjetar', severity: 'moderate', at: new Date(NOW + 3_600_000).toISOString(), until: '2026-09-11T20:00:00Z' }]);
    const later = safety({ snapshots: { ...SNAPSHOTS, 'dhmz-cap': announced } }).querySelector('#sf-warnings [data-testid=warning-row]')!;
    expect(text(later.querySelector('.wx-warning-window'))).toBe('najavljeno · od 15:32 do 22:00');
  });

  it('shows five closures as rows with the closure mark and one line of type, direction and end, then the way to all of them in Promet', () => {
    const section = safety({ snapshots: { ...SNAPSHOTS, prometnice: MANY_CLOSURES } }).querySelector('#sf-closures')!;
    const rows = [...section.querySelectorAll('[data-testid=closure-row]')];
    expect(rows).toHaveLength(5);
    for (const row of rows) {
      expect(row.classList.contains('row')).toBe(true);
      expect(row.querySelector('.mark-closure')).not.toBeNull();
    }
    expect(text(rows[0]!.querySelector('.row-title'))).toBe('Ulica 1');
    expect(text(rows[0]!.querySelector('.row-sub'))).toBe('radovi · jedan smjer · do 30. 9. 02:00');
    const all = section.querySelector('[data-action=nav][data-layer=u-pokretu]')!;
    expect(text(all)).toBe('sve zatvaranja (20)');
    expect(section.querySelector('[data-action=filter][data-filter-key=closures]')).toBeNull();
    // A closure without an announced end says so instead of inventing one.
    const open = base('prometnice', [{ ...MANY_CLOSURES.items[0]!, until: undefined }]);
    const openRow = safety({ snapshots: { ...SNAPSHOTS, prometnice: open } }).querySelector('#sf-closures [data-testid=closure-row]')!;
    expect(text(openRow.querySelector('.row-sub'))).toBe('radovi · jedan smjer · kraj nije najavljen');
  });

  it('lists all six on-duty pharmacies nearest the screen first, badges the nearest without printing a distance, and keeps the source order without a stop', () => {
    const near = safety(atStop());
    const rows = [...near.querySelectorAll('#sf-pharmacies [data-testid=pharmacy]')];
    expect(rows).toHaveLength(6);
    expect(text(rows[0]!.querySelector('.row-title'))).toContain('Trg bana J. Jelačića 3');
    expect(text(rows[0]!.querySelector('.badge'))).toBe('najbliža zaslonu');
    expect(near.querySelectorAll('#sf-pharmacies .badge').length, 'one nearest badge and the provjeriti mark').toBe(2);
    expect(text(near.querySelector('#sf-pharmacies'))).not.toMatch(/\d+ (m|km)\b/);
    for (const row of rows) {
      expect(row.classList.contains('row')).toBe(true);
      expect(row.querySelectorAll('.row-sub').length).toBeGreaterThanOrEqual(2);
    }

    const plain = safety();
    const order = [...plain.querySelectorAll('#sf-pharmacies [data-testid=pharmacy] .sf-pharmacy-name')].map(text);
    expect(order).toEqual(['Trg bana J. Jelačića 3', 'Ilica 291', 'Ozaljska 1', 'Grižanska 4', 'Av. V. Holjevca 22', 'Ljekarna ZEUS']);
    expect(text(plain.querySelector('#sf-pharmacies'))).not.toContain('najbliža zaslonu');
  });

  it('gives every pharmacy with a number a "Nazovi" tel: button named with the number, marks the list provjeriti with its checked-on date', () => {
    const section = safety().querySelector('#sf-pharmacies')!;
    const calls = [...section.querySelectorAll<HTMLAnchorElement>('a.sf-call[href^="tel:"]')];
    expect(calls).toHaveLength(5);
    expect(text(calls[0]!)).toBe('Nazovi');
    expect(calls[0]!.getAttribute('aria-label')).toBe('Nazovi 01 4816 198');
    expect(calls[0]!.getAttribute('href')).toBe('tel:+38514816198');
    expect(text(section)).toContain('telefon nije naveden');
    expect(text(section.querySelector('.sec-head .badge'))).toBe('provjeriti');
    expect(text(section)).toContain('provjeren pet 11. 9. 2026. prema stranici Grada Zagreba');
  });

  it('lists quakes of the last 72 hours as Vrijeme\u2019s rows, five at most, and says how many there were', () => {
    const one = safety().querySelector('#sf-quakes')!;
    expect(one.querySelectorAll('[data-testid=quake-row]')).toHaveLength(1);
    expect(text(one.querySelector('[data-testid=quake-row] .wx-mag'))).toBe('M 1,6');
    expect(text(one)).toMatch(/\d+ km od Zagreba/);
    expect(one.querySelector('.g-radar'), 'no figure here; Vrijeme draws the radar').toBeNull();

    const swarm = safety({ snapshots: { ...SNAPSHOTS, emsc: quakesWithin72h(7) } }).querySelector('#sf-quakes')!;
    expect(swarm.querySelectorAll('[data-testid=quake-row]')).toHaveLength(5);
    expect(text(swarm)).toContain('prikazano 5 od 7');
    // Nine hours apart: the ninth is 81 hours old, outside the window, and is not counted.
    const beyond = safety({ snapshots: { ...SNAPSHOTS, emsc: quakesWithin72h(9) } }).querySelector('#sf-quakes')!;
    expect(text(beyond)).toContain('prikazano 5 od 8');
  });

  it('groups assembly points under one <details> per gradska četvrt in the table\u2019s order, counted, paged inside, never all rendered', () => {
    const section = safety({ snapshots: { ...SNAPSHOTS, 'ckan-geo': DISTRICT_POINTS } }).querySelector('#sf-assembly')!;
    expect(text(section)).toContain('Na popisu je 40 mjesta');
    expect(section.querySelector('#assembly-search')).not.toBeNull();
    const groups = [...section.querySelectorAll('details.sf-district')];
    expect(groups.map((g) => text(g.querySelector('summary')))).toEqual([
      'Donji grad · 15 mjesta', 'Gornji grad – Medveščak · 20 mjesta', 'Podsljeme · 3 mjesta', 'Nova četvrt · 1 mjesto', 'Četvrt nije navedena · 1 mjesto',
    ]);
    expect(groups.every((g) => !g.hasAttribute('open'))).toBe(true);
    expect(section.querySelectorAll('[data-testid=assembly-point]').length).toBe(12 + 12 + 3 + 1 + 1);
    const donji = groups[0]!;
    expect(donji.querySelectorAll('[data-testid=assembly-point]')).toHaveLength(12);
    const more = donji.querySelector('[data-action=filter]')!;
    expect(text(more)).toBe('Prikaži još 3');
    expect(more.getAttribute('data-filter-key')).toBe('zm-donji-grad');
    expect(more.getAttribute('data-filter-value')).toBe('36');
    expect(text(groups[1]!.querySelector('[data-action=filter]'))).toBe('Prikaži još 8');
    expect(groups[1]!.querySelector('[data-action=filter]')?.getAttribute('data-filter-key')).toBe('zm-gornji-grad-medvescak');
    expect(groups[2]!.querySelector('[data-action=filter]')).toBeNull();
    // A row: the place as its title, the source's summary as the second line, the map as a 44 px link.
    const row = donji.querySelector('[data-testid=assembly-point]')!;
    expect(text(row.querySelector('.row-title'))).toBe('Zborno mjesto 21');
    expect(text(row.querySelector('.row-sub'))).toBe('Ulica 21');
    expect(text(row.querySelector('a.link-ext'))).toBe('karta');
    expect(row.querySelector('a.link-ext')?.getAttribute('href')).toContain('openstreetmap.org');
    expect(groups[2]!.querySelector('[data-testid=assembly-point] a'), 'no coordinates, no map link').toBeNull();

    const expanded = safety({ snapshots: { ...SNAPSHOTS, 'ckan-geo': DISTRICT_POINTS }, view: { layer: 'sigurnost', selection: null, filters: { 'zm-donji-grad': '36' } } });
    const donjiOpen = expanded.querySelector('#sf-assembly details.sf-district')!;
    expect(donjiOpen.querySelectorAll('[data-testid=assembly-point]')).toHaveLength(15);
    expect(donjiOpen.querySelector('[data-action=filter]')).toBeNull();
  });

  it('answers a search with one flat list of every match, no groups, and reads the true total from the assembly source when it is capped', () => {
    const searched = safety({ snapshots: { ...SNAPSHOTS, 'ckan-geo': DISTRICT_POINTS }, view: { layer: 'sigurnost', selection: null, filters: { zborna: 'mjesto 3' } } }).querySelector('#sf-assembly')!;
    expect(searched.querySelector('details.sf-district')).toBeNull();
    // "mjesto 3", "mjesto 30" to "mjesto 39": eleven matches.
    expect(searched.querySelectorAll('[data-testid=assembly-point]')).toHaveLength(11);

    // ckan-geo serves two layers in one module, so the module's coverage.total counts the 17 districts too; the
    // assembly layer's own totalItems is the register's size, and the sentence names that.
    const capped: ModuleSnapshot = {
      ...DISTRICT_POINTS,
      sources: { 'zborna-mjesta': { status: 'live', itemCount: 40, totalItems: 512 }, 'gradske-cetvrti': { status: 'live', itemCount: 17 } },
      coverage: { shown: 57, total: 529, limited: true },
    };
    expect(text(safety({ snapshots: { ...SNAPSHOTS, 'ckan-geo': capped } }).querySelector('#sf-assembly'))).toContain('Na popisu je 512 mjesta');
    const uncapped: ModuleSnapshot = { ...DISTRICT_POINTS, sources: { 'zborna-mjesta': { status: 'live', itemCount: 40 }, 'gradske-cetvrti': { status: 'live', itemCount: 17 } }, coverage: { shown: 57, limited: false } };
    expect(text(safety({ snapshots: { ...SNAPSHOTS, 'ckan-geo': uncapped } }).querySelector('#sf-assembly'))).toContain('Na popisu je 40 mjesta');
  });

  it('keeps the section ids and grid the gates pin, and lays every section flat: no card but the tiles', () => {
    const section = safety();
    for (const id of ['sf-numbers', 'sf-warnings', 'sf-closures', 'sf-pharmacies', 'sf-quakes', 'sf-assembly']) {
      const sec = section.querySelector(`#${id}`)!;
      expect(sec, id).not.toBeNull();
      expect(sec.classList.contains('sf-sec'), `${id} is a flat safety section`).toBe(true);
    }
    expect(section.querySelector('.sf-grid')).not.toBeNull();
    expect(section.querySelector('#sf-numbers')!.classList.contains('sf-wide')).toBe(true);
    expect(section.querySelector('#sf-assembly')!.classList.contains('sf-wide')).toBe(true);
    expect(section.querySelector('#layer-title-sigurnost')?.getAttribute('tabindex')).toBe('-1');
    expect(section.querySelector('.sf-level-title'), 'the old card head is gone').toBeNull();
    expect(section.querySelector('.sf-number-value'), 'the old tile markup is gone').toBeNull();
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

  it('Sigurnost shows five closures and sends the rest to Promet, where they are on the map (T3.2 replaces the fold)', () => {
    const withClosures = { ...SNAPSHOTS, prometnice: MANY_CLOSURES };
    const section = renderLayer('sigurnost', ctx({ snapshots: withClosures }));
    expect(section.querySelectorAll('[data-testid=closure-row]')).toHaveLength(5);
    expect(section.querySelector('[data-action=filter][data-filter-key=closures]')).toBeNull();
    const all = section.querySelector('#sf-closures [data-action=nav][data-layer=u-pokretu]')!;
    expect(text(all)).toBe('sve zatvaranja (20)');
    // A filter value from an earlier fold cannot widen the list past five any more.
    const stale = renderLayer('sigurnost', ctx({ snapshots: withClosures, view: { layer: 'sigurnost', selection: null, filters: { closures: '15' } } }));
    expect(stale.querySelectorAll('[data-testid=closure-row]')).toHaveLength(5);
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

describe('Grad pages the communal works register (wave 1 merge gate: Grad under 3000 px at 390)', () => {
  const MANY_WORKS: ModuleSnapshot = base(
    'dogadanja',
    Array.from({ length: 20 }, (_, i) => ({
      id: `komunalne:${i + 1}`, module: 'dogadanja', kind: 'event', tier: 'session', title: `Radovi ${i + 1}`, summary: `zahvat ${i + 1}`,
      at: '2026-06-01T00:00:00Z', data: { source: 'komunalne', phase: i % 2 ? 'Radovi u tijeku' : 'Ugovaranje', status: 'U tijeku', amount: 1000 + i, precision: 'day' },
    })) as ModuleSnapshot['items'],
  );
  it('renders eight works, offers eight more, and a filter value renders exactly that many', () => {
    const section = renderLayer('uprava-i-pravo', ctx({ snapshots: { ...SNAPSHOTS, dogadanja: MANY_WORKS } }));
    expect(section.querySelectorAll('[data-testid=works] [data-testid=city-work-row]')).toHaveLength(8);
    const more = section.querySelector<HTMLElement>('#cv-works [data-action=filter][data-filter-key=works]')!;
    expect(more.textContent?.trim()).toBe('Prikaži još 8');
    expect(more.dataset.filterValue).toBe('16');
    const expanded = renderLayer('uprava-i-pravo', ctx({ snapshots: { ...SNAPSHOTS, dogadanja: MANY_WORKS }, view: { layer: 'uprava-i-pravo', selection: null, filters: { works: '16' } } }));
    expect(expanded.querySelectorAll('[data-testid=works] [data-testid=city-work-row]')).toHaveLength(16);
    expect(expanded.querySelector('#cv-works [data-action=filter][data-filter-key=works]')?.textContent?.trim()).toBe('Prikaži još 4');
  });
  it('a phase chip narrows the list first, so a filtered register shows every match up to the page', () => {
    const section = renderLayer('uprava-i-pravo', ctx({ snapshots: { ...SNAPSHOTS, dogadanja: MANY_WORKS }, view: { layer: 'uprava-i-pravo', selection: null, filters: { phase: 'Ugovaranje' } } }));
    expect(section.querySelectorAll('[data-testid=works] [data-testid=city-work-row]')).toHaveLength(8);
    expect(section.querySelector('#cv-works [data-action=filter][data-filter-key=works]')?.textContent?.trim()).toBe('Prikaži još 2');
  });
});

describe('Grad: the next session as a date, the gazette issue as a lockup with labelled facts, works with coverage and no percentages (T3.3)', () => {
  const i18n = createDefaultI18n('hr');
  const dts = (detail: Element): string[] => [...detail.querySelectorAll('.detail-facts dt')].map(text);
  const dds = (detail: Element): string[] => [...detail.querySelectorAll('.detail-facts dd')].map(text);
  const session = (day: number): ModuleSnapshot['items'][number] => ({
    id: `skupstina:${day}`, module: 'dogadanja', kind: 'event', tier: 'session', title: `Sjednica ${day}`, at: `2026-09-${String(day).padStart(2, '0')}T07:00:00Z`, dateBasis: 'event',
    data: { source: 'skupstina', organiser: 'Odbor za financije', category: 'sjednica-odbora', precision: 'time' },
  });
  const MANY_SESSIONS: ModuleSnapshot = { ...SNAPSHOTS.dogadanja!, items: [15, 20, 12, 25, 30].map(session) };
  const WORKS: ModuleSnapshot = {
    ...base('dogadanja', Array.from({ length: 20 }, (_, i) => ({
      id: `komunalne:${i + 1}`, module: 'dogadanja', kind: 'event', tier: 'session', title: `Radovi ${i + 1}`, summary: `zahvat ${i + 1}`,
      at: '2026-06-01T00:00:00Z', data: { source: 'komunalne', phase: i % 2 ? 'Radovi u tijeku' : 'Ugovaranje', status: 'U tijeku', amount: 1000 + i, precision: 'day' },
    })) as ModuleSnapshot['items']),
    coverage: { shown: 20, total: 700, limited: true },
  };

  it('keeps the domain name for assistive technology only: the tab already says Grad', () => {
    const section = renderLayer('uprava-i-pravo', ctx());
    const title = section.querySelector('#layer-title-uprava-i-pravo')!;
    expect(section.getAttribute('aria-labelledby')).toBe('layer-title-uprava-i-pravo');
    expect(title.classList.contains('visually-hidden')).toBe(true);
    // Three blocks on the canvas, each a hairline-separated .cv-sec, no kicker anywhere in the list.
    expect([...section.querySelectorAll('.cv-grid > .sec')].map((sec) => sec.id)).toEqual(['cv-sessions', 'cv-gazette', 'cv-works']);
    expect([...section.querySelectorAll('.cv-grid > .sec')].every((sec) => sec.classList.contains('cv-sec'))).toBe(true);
    expect(section.querySelectorAll('.ws-primary .kicker')).toHaveLength(0);
  });

  it('dates the next session as a day numeral over the month word, says the weekday, time and venue, and links the livestream beside it', () => {
    const section = renderLayer('uprava-i-pravo', ctx());
    const next = section.querySelector('#cv-sessions .cv-next')!;
    expect(next.getAttribute('data-testid')).toBe('city-work-row');
    expect(text(next.querySelector('.cv-day'))).toBe('14'); // 09:00Z on 14 September is 11:00 in Zagreb, the same day
    expect(text(next.querySelector('.cv-month'))).toBe('ruj');
    expect(text(next.querySelector('.row-title'))).toBe('Poziv na 13. sjednicu Gradske skupštine Grada Zagreba');
    expect(text(next.querySelector('.row-sub'))).toBe('pon 11:00 · Stara gradska vijećnica');
    expect(next.querySelector('.row-button[data-action=select][data-module=dogadanja][data-item-id="skupstina:4"]')).not.toBeNull();
    const live = next.querySelector('a.cv-live')!;
    expect(live.getAttribute('href')).toBe('https://www.youtube.com/channel/UCRMm4Xt9ruoQ8FG7NpIHCsA');
    expect(text(live)).toBe('Prijenos');
    expect(live.closest('button')).toBeNull(); // a link never sits inside the row's button
    expect(text(section.querySelector('#cv-sessions'))).not.toMatch(/SKUPŠTINA/);
  });

  it('shows up to three further sessions as rows after the lockup, and past sessions only under their own word when nothing is announced', () => {
    const section = renderLayer('uprava-i-pravo', ctx({ snapshots: { ...SNAPSHOTS, dogadanja: MANY_SESSIONS } }));
    const rows = [...section.querySelectorAll('#cv-sessions [data-testid=city-work-row]')];
    expect(rows).toHaveLength(4);
    expect(rows[0].classList.contains('cv-next')).toBe(true);
    expect(rows.map((r) => text(r.querySelector('.row-title')))).toEqual(['Sjednica 12', 'Sjednica 15', 'Sjednica 20', 'Sjednica 25']);
    expect(rows.slice(1).every((r) => r.querySelector('.cv-date[data-size=s]') !== null && !r.classList.contains('cv-next'))).toBe(true);
    expect(section.querySelectorAll('#cv-sessions a.cv-live')).toHaveLength(0); // committee sessions are not streamed

    const later = renderLayer('uprava-i-pravo', ctx({ snapshots: { ...SNAPSHOTS, dogadanja: MANY_SESSIONS }, now: Date.parse('2026-10-05T12:00:00Z') }));
    const body = text(later.querySelector('#cv-sessions'));
    expect(body).toContain('U rokovniku Skupštine trenutačno nema najavljenih sjednica.');
    expect(body).toContain('Održane sjednice');
    expect([...later.querySelectorAll('#cv-sessions [data-testid=city-work-row] .row-title')].map(text)).toEqual(['Sjednica 30', 'Sjednica 25', 'Sjednica 20']);
    expect(later.querySelector('#cv-sessions .cv-next')).toBeNull();
  });

  it('heads the gazette with the source name, prints Referenca exactly once on the issue line, and lists ten acts', () => {
    const dated = { ...MANY_ACTS, items: MANY_ACTS.items.map((act, i) => (i === 0 ? { ...act, at: '2026-09-07T06:00:00Z' } : act)) };
    const section = renderLayer('uprava-i-pravo', ctx({ snapshots: { ...SNAPSHOTS, glasnik: dated } }));
    const gazette = section.querySelector('#cv-gazette')!;
    expect(text(gazette.querySelector('.sec-title'))).toBe('Službeni glasnik Grada Zagreba');
    expect(text(gazette).match(/Referenca/g)).toHaveLength(1);
    expect(gazette.querySelector('.cv-issue-meta [data-testid=panel-status][data-status=reference]')).not.toBeNull();
    expect(text(gazette.querySelector('[data-testid=gazette-issue] .cv-issue-no'))).toBe('1/2026');
    expect(text(gazette.querySelector('.cv-issue-meta'))).toContain('objavljen pon 7. 9. 2026. · 25 akata');
    expect(gazette.querySelectorAll('[data-testid=act-row]')).toHaveLength(10);
    expect(text(gazette.querySelector('[data-action=filter][data-filter-key=acts]'))).toBe('Prikaži još 10');
    expect(gazette.querySelector('.kicker')).toBeNull();
  });

  it('labels the open act, session and work with nouns from civic.labels, never a trimmed sentence template', () => {
    const glasnik = { ...SNAPSHOTS.glasnik!, items: [{ ...SNAPSHOTS.glasnik!.items[0], at: '2026-09-07T06:00:00Z' }] };
    const openAct = renderLayer('uprava-i-pravo', ctx({ snapshots: { ...SNAPSHOTS, glasnik }, view: { layer: 'uprava-i-pravo', selection: { kind: 'item', id: publicItemKey('glasnik', 'a1'), module: 'glasnik' }, filters: {} } }));
    const act = openAct.querySelector('[data-testid=civic-detail]')!;
    expect(dts(act)).toEqual([i18n.t('civic.labels.number'), i18n.t('civic.labels.published')]);
    expect(dts(act)).toEqual(['Broj', 'Objavljen']);
    expect(dds(act)).toEqual(['21/2026', 'pon 7. 9. 2026.']);
    // The original and the print action are the shared 44 px controls.
    expect(text(act.querySelector('a.link-ext[href="https://www1.zagreb.hr/akt"]'))).toBe('Otvori izvornik');
    expect(act.querySelector('.actions [data-action=print-item][data-module=glasnik][data-item-id=a1]')).not.toBeNull();

    const openSession = renderLayer('uprava-i-pravo', ctx({ view: { layer: 'uprava-i-pravo', selection: { kind: 'item', id: publicItemKey('dogadanja', 'skupstina:4'), module: 'dogadanja' }, filters: {} } }));
    const session = openSession.querySelector('[data-testid=civic-detail]')!;
    expect(dts(session)).toEqual([i18n.t('civic.labels.when'), i18n.t('civic.labels.venue'), i18n.t('civic.labels.body'), i18n.t('events.source')]);
    expect(dts(session)).toEqual(['Kada', 'Mjesto', 'Tijelo', 'Izvor']);
    expect(dds(session)[2]).toBe('Gradske skupštine Grada Zagreba');

    const openWork = renderLayer('uprava-i-pravo', ctx({ view: { layer: 'uprava-i-pravo', selection: { kind: 'item', id: publicItemKey('dogadanja', 'komunalne:5'), module: 'dogadanja' }, filters: {} } }));
    const work = openWork.querySelector('[data-testid=civic-detail]')!;
    expect(dts(work)).toEqual([i18n.t('civic.phase'), i18n.t('civic.status'), i18n.t('civic.amount'), i18n.t('civic.labels.sourceChanged'), i18n.t('events.source')]);
    expect(dts(work)).toContain('Izmjena u izvoru');
    expect(dds(work)[3]).toBe('pon 1. 6. 2026.');
    expect(text(work)).toContain('izrada projektne dokumentacije za vodoopskrbu'); // the description stays with the work, in its detail
  });

  it('lists works as title, phase word and a tabular amount at the row end, eight then more, with the coverage line, the desk-only phase figure and no percentage', () => {
    const section = renderLayer('uprava-i-pravo', ctx({ snapshots: { ...SNAPSHOTS, dogadanja: WORKS } }));
    const works = section.querySelector('#cv-works')!;
    expect(text(works.querySelector('.sec-title'))).toBe('Komunalni radovi');
    const rows = works.querySelectorAll('[data-testid=works] [data-testid=city-work-row]');
    expect(rows).toHaveLength(8);
    const row = rows[0];
    expect(text(row.querySelector('.row-title'))).toBe('Radovi 1');
    expect(text(row.querySelector('.row-sub'))).toBe('Ugovaranje');
    expect(text(row.querySelector('.cv-amount'))).toBe('1.000 €');
    expect(row.querySelector('.badge')).toBeNull();
    expect(text(row)).not.toContain('zahvat 1'); // the description is the detail's
    expect(text(works.querySelector('[data-action=filter][data-filter-key=works]'))).toBe('Prikaži još 8');
    expect(text(works)).toContain('prikazano 20 od 700'); // dataset coverage, the honesty device
    expect(text(works)).not.toMatch(/\d+ ?%/);
    const figure = works.querySelector('.cv-phases')!;
    expect(figure.tagName).toBe('FIGURE');
    expect(text(figure.querySelector('figcaption'))).toBe('Faze u prikazanom skupu');
    expect([...figure.querySelectorAll('.g-bar-label')].map(text)).toEqual(['Ugovaranje', 'Radovi u tijeku']);
    expect([...figure.querySelectorAll('.g-bar-value')].map(text)).toEqual(['10', '10']);
    expect(works.querySelector('.kicker')).toBeNull();
  });
});

describe('Događanja: search and one chip row, a dated agenda without cards, ongoing and undated apart (T3.4)', () => {
  const event = (id: string, over: Record<string, unknown>) => ({ id, module: 'dogadanja', kind: 'event', tier: 'session', dateBasis: 'event', ...over });
  // Thirty starts every three hours from now (four days of heads), six running exhibitions, eight undated notices, one venue outside Zagreb.
  const MANY_EVENTS: ModuleSnapshot = {
    ...SNAPSHOTS.dogadanja!,
    items: [
      ...Array.from({ length: 30 }, (_, i) => event(`kulturpunkt:m${i + 1}`, {
        title: `Događaj ${i + 1}`, link: `https://kulturpunkt.hr/m/${i + 1}`, at: new Date(NOW + (i + 1) * 3 * 3_600_000).toISOString(),
        data: { source: 'kulturpunkt', category: i % 2 ? 'koncert' : 'film', precision: 'time' },
      })),
      ...Array.from({ length: 6 }, (_, i) => event(`etnografski:o${i + 1}`, {
        title: `Izložba ${i + 1}`, link: `https://emz.hr/o/${i + 1}`, at: '2026-09-01T09:00:00Z', until: `2026-10-${10 + i}T18:00:00Z`,
        data: { source: 'etnografski', category: 'izlozba', venue: 'Etnografski muzej, Zagreb', precision: 'time' },
      })),
      ...Array.from({ length: 8 }, (_, i) => event(`kvartovske:u${i + 1}`, {
        title: `Obavijest kvarta ${i + 1}`, link: `https://aktivnosti.zagreb.hr/n/u${i + 1}`, at: '2026-09-10T08:00:00Z', dateBasis: 'published', data: { source: 'kvartovske' },
      })),
      event('kulturpunkt:out', { title: 'Koncert na rivi', at: '2026-09-12T19:00:00Z', data: { source: 'kulturpunkt', category: 'koncert', precision: 'time', venue: 'Dioklecijanova palača, Split' } }),
    ] as ModuleSnapshot['items'],
  };
  const many = (filters: Record<string, string> = {}): LayerContext => ctx({ snapshots: { ...SNAPSHOTS, dogadanja: MANY_EVENTS }, view: { layer: 'kultura', selection: null, filters } });

  it('opens with the title hidden on the phone, the search field, one row of events-toned chips with Sve first, then the count line in the right plural', () => {
    const section = renderLayer('kultura', ctx());
    const title = section.querySelector('h2.layer-title')!;
    expect(title.classList.contains('ev-title')).toBe(true);
    expect(section.querySelector('.ws-head')).toBeNull();
    const toolbar = section.querySelector('.ws-toolbar')!;
    expect(toolbar.children[0]!.querySelector('[data-filter-key=q]')).not.toBeNull();
    expect(toolbar.children[1]!.matches('[role=group]')).toBe(true);
    const chips = [...toolbar.querySelectorAll('ul.chips li button.chip[aria-pressed]')];
    expect(chips.length).toBeGreaterThan(1);
    expect(text(chips[0]!)).toMatch(/^Sve/);
    expect(chips.every((c) => c.getAttribute('data-tone') === 'events')).toBe(true);
    const count = section.querySelector('[data-testid=ev-count]')!;
    expect(text(count)).toBe('2 događanja · 1 u tijeku');
    // No kicker and no "Agenda" heading anywhere in the workspace.
    expect(section.querySelector('.kicker')).toBeNull();
    expect(text(section)).not.toMatch(/\bAgenda\b/);
    // Concerts only: one start and no exhibition, so the singular and no ongoing part.
    const koncerti = renderLayer('kultura', ctx({ view: { layer: 'kultura', selection: null, filters: { category: 'koncert' } } }));
    expect(text(koncerti.querySelector('[data-testid=ev-count]'))).toBe('1 događanje');
    const en = renderLayer('kultura', ctx({ i18n: createDefaultI18n('en') }));
    expect(text(en.querySelector('[data-testid=ev-count]'))).toBe('2 events · 1 ongoing');
  });

  it('lists the agenda flat under sentence-case day heads: twelve rows with a time column, then Prikaži još 12 as a filter button', () => {
    const section = renderLayer('kultura', many());
    const agenda = section.querySelector('#ev-agenda')!;
    expect(agenda.hasAttribute('data-flat')).toBe(true);
    expect(agenda.querySelector('.sec-head')).toBeNull();
    expect(agenda.querySelector('#ev-agenda-title')!.classList.contains('visually-hidden')).toBe(true);
    const rows = [...agenda.querySelectorAll('[data-testid=event-row]')];
    expect(rows).toHaveLength(12);
    const more = agenda.querySelector('[data-action=filter][data-filter-key=events]')!;
    expect(text(more)).toBe('Prikaži još 12');
    expect(more.getAttribute('data-filter-value')).toBe('24');
    const heads = [...agenda.querySelectorAll('.agenda-day')].map(text);
    expect(heads.slice(0, 3)).toEqual(['Danas', 'Sutra', 'ned 13. 9.']);
    expect(heads.some((h) => /2026|[A-ZČŠŽ]{2}/.test(h))).toBe(false);
    expect(rows[0]!.querySelector('.ev-lead .ev-time')).not.toBeNull();
    expect(text(rows[0]!.querySelector('.row-title'))).toBe('Događaj 1');
    expect(text(rows[0]!.querySelector('.row-sub'))).toBe('Kulturpunkt');
    const paged = renderLayer('kultura', many({ events: '24' }));
    expect(paged.querySelectorAll('#ev-agenda [data-testid=event-row]')).toHaveLength(24);
    expect(text(paged.querySelector('#ev-agenda [data-filter-key=events]'))).toBe('Prikaži još 6');
  });

  it('sets what is running apart: four rows with the end date at the row end and no state word, then Još N reveals the rest', () => {
    const section = renderLayer('kultura', many());
    const ongoing = section.querySelector('#ev-ongoing')!;
    expect(ongoing.hasAttribute('data-flat')).toBe(true);
    expect(text(ongoing.querySelector('.sec-title'))).toBe('U tijeku');
    const rows = [...ongoing.querySelectorAll('[data-testid=event-row]')];
    expect(rows).toHaveLength(4);
    expect(text(rows[0]!.querySelector('.ev-until'))).toBe('do 10. 10.');
    expect(rows[0]!.querySelector('.ev-lead')).toBeNull();
    expect(text(rows[0]!)).not.toContain('Traje');
    expect(text(rows[0]!.querySelector('.row-sub'))).toBe('Etnografski muzej, Zagreb · Etnografski muzej');
    const more = ongoing.querySelector('[data-action=filter][data-filter-key=ongoing]')!;
    expect(text(more)).toBe('Još 2');
    const all = renderLayer('kultura', many({ ongoing: '6' }));
    expect(all.querySelectorAll('#ev-ongoing [data-testid=event-row]')).toHaveLength(6);
    expect(all.querySelector('#ev-ongoing [data-filter-key=ongoing]')).toBeNull();
  });

  it('keeps undated notices in a well with title and source, six then more, and folds venues outside Zagreb into a closed details that counts them', () => {
    const section = renderLayer('kultura', many());
    const undated = section.querySelector('#ev-undated')!;
    expect(undated.hasAttribute('data-flat')).toBe(true);
    expect(undated.querySelector('.ev-well')).not.toBeNull();
    expect(text(undated.querySelector('.sec-title'))).toBe('Bez datuma');
    const rows = [...undated.querySelectorAll('[data-testid=undated-row]')];
    expect(rows).toHaveLength(6);
    expect(text(rows[0]!.querySelector('.row-title'))).toBe('Obavijest kvarta 1');
    expect(text(rows[0]!.querySelector('.row-sub'))).toBe('Kvartovske novosti');
    expect(text(rows[0]!)).not.toContain('vrijeme nije navedeno');
    expect(text(undated.querySelector('[data-action=filter][data-filter-key=undated]'))).toBe('Prikaži još 2');
    expect(renderLayer('kultura', many({ undated: '12' })).querySelectorAll('[data-testid=undated-row]')).toHaveLength(8);
    const outside = section.querySelector('#ev-outside')!;
    expect(outside.tagName).toBe('DETAILS');
    expect(outside.hasAttribute('open')).toBe(false);
    expect(text(outside.querySelector('summary'))).toBe('Izvan Zagreba 1');
    expect(text(outside)).toContain('Koncert na rivi');
    expect(text(section.querySelector('#ev-agenda'))).not.toContain('Koncert na rivi');
    // Ten venues outside Zagreb: the summary counts them all, the fold lists eight, then Prikaži još 2.
    const tenOut = renderLayer('kultura', ctx({ snapshots: { ...SNAPSHOTS, dogadanja: { ...SNAPSHOTS.dogadanja!, items: Array.from({ length: 10 }, (_, i) => event(`kulturpunkt:out${i + 1}`, { title: `Na rivi ${i + 1}`, at: '2026-09-12T19:00:00Z', data: { source: 'kulturpunkt', category: 'koncert', precision: 'time', venue: 'Riva, Split' } })) as ModuleSnapshot['items'] } } }));
    expect(text(tenOut.querySelector('#ev-outside summary'))).toBe('Izvan Zagreba 10');
    expect(tenOut.querySelectorAll('#ev-outside [data-testid=event-row]')).toHaveLength(8);
    expect(text(tenOut.querySelector('#ev-outside [data-action=filter][data-filter-key=outside]'))).toBe('Prikaži još 2');
    // Every block in the list column is a hairline-separated flat section, never a card.
    expect([...section.querySelectorAll('.ws-primary > *')].every((el) => el.classList.contains('ev-sec'))).toBe(true);
  });

  it('opens a detail as a flat article: the title, the date sentence, venue and organiser only when present, category, source, and one actions row ending in the original', () => {
    const select = (id: string) => ctx({ view: { layer: 'kultura', selection: { kind: 'item', id: publicItemKey('dogadanja', id), module: 'dogadanja' }, filters: {} } });
    const detail = renderLayer('kultura', select('kulturpunkt:1')).querySelector('[data-testid=event-detail]')!;
    expect(detail.classList.contains('ev-detail')).toBe(true);
    expect(detail.querySelector('.kicker')).toBeNull();
    expect(text(detail.querySelector('.detail-title'))).toBe('Koncert u parku');
    expect(text(detail.querySelector('.ev-when'))).toBe('Sutra 20:00');
    expect([...detail.querySelectorAll('.detail-facts dt')].map(text)).toEqual(['Kategorija', 'Izvor']);
    expect([...detail.querySelectorAll('.detail-facts dd')].map(text)).toEqual(['Koncerti', 'Kulturpunkt (CC BY-SA 3.0 HR)']);
    const controls = [...detail.querySelectorAll('.ev-actions button, .ev-actions a')];
    expect(controls.map((c) => c.getAttribute('data-action') ?? c.tagName)).toEqual(['copy-item', 'share-item', 'A']);
    expect(text(controls.at(-1)!)).toBe('Otvori izvornik');
    const withVenue = renderLayer('kultura', select('etnografski:2')).querySelector('[data-testid=event-detail]')!;
    expect([...withVenue.querySelectorAll('.detail-facts dt')].map(text)).toEqual(['Mjesto', 'Kategorija', 'Izvor']);
  });
});
