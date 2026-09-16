// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KIOSK_KVART_ZOOM, KIOSK_MAP_WIDTH_PX, KIOSK_MAP_ZOOM, KIOSK_MAX_ZOOM, KIOSK_MIN_ZOOM, KVART_SPAN_M, chapterView, metresPerPixel } from '../../app/src/kiosk/mapview';
import * as basemap from '../../app/src/map/basemap';
import {
  createCityMap,
  linesToGeoJson,
  OSM_ATTRIBUTION,
  OSM_RASTER_URL,
  osmStyle,
  pointsToGeoJson,
  ZAGREB_CENTER,
  type CityMapOptions,
  type MapLine,
} from '../../app/src/map/city-map';
import { createMapSlots } from '../../app/src/map/map-slots';
import * as overlays from '../../app/src/map/overlays';

describe('open raster basemap', () => {
  it('uses the OpenStreetMap tile URL and attributes it in the style', () => {
    expect(OSM_RASTER_URL).toBe('https://tile.openstreetmap.org/{z}/{x}/{y}.png');
    expect(OSM_ATTRIBUTION).toBe('© OpenStreetMap contributors');
    const style = osmStyle();
    expect(style.sources.osm.tiles).toEqual([OSM_RASTER_URL]);
    expect(style.sources.osm.attribution).toBe(OSM_ATTRIBUTION);
    expect(style.sources.osm.tileSize).toBe(256);
    expect(style.layers[0]?.id).toBe('osm');
  });
  it('centres on Zagreb in GeoJSON order', () => {
    expect(ZAGREB_CENTER).toEqual([15.98, 45.815]);
  });
});

describe('feed items to GeoJSON', () => {
  it('turns points into a FeatureCollection keeping the route id', () => {
    const fc = pointsToGeoJson([{ id: 'v1', lon: 15.97, lat: 45.81, title: '6 · Črnomerec', routeId: '6' }]);
    expect(fc.type).toBe('FeatureCollection');
    expect(fc.features[0]?.geometry).toEqual({ type: 'Point', coordinates: [15.97, 45.81] });
    expect(fc.features[0]?.properties).toEqual({ id: 'v1', title: '6 · Črnomerec', routeId: '6' });
  });
  it('turns closures into line features', () => {
    const fc = linesToGeoJson([{ id: 'c1', title: 'Grada Vukovara', coordinates: [[15.95, 45.79], [15.96, 45.79]] }]);
    expect(fc.features[0]?.geometry.type).toBe('LineString');
    expect(fc.features[0]?.geometry.coordinates).toHaveLength(2);
    expect(fc.features[0]?.properties.title).toBe('Grada Vukovara');
  });
  it('drops coordinates that are not finite numbers', () => {
    expect(pointsToGeoJson([{ id: 'x', lon: Number.NaN, lat: 45, title: 'x' }]).features).toHaveLength(0);
    expect(linesToGeoJson([{ id: 'x', title: 'x', coordinates: [[15.9, 45.8]] }]).features).toHaveLength(0);
  });
});

describe('map slots', () => {
  const spyFactory = () => {
    const made: { update: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn>; pause: ReturnType<typeof vi.fn> }[] = [];
    const factory = vi.fn(() => {
      const handle = { update: vi.fn(), destroy: vi.fn(), pause: vi.fn() };
      made.push(handle);
      return handle;
    });
    return { factory, made };
  };
  const ask = (maps: ReturnType<typeof createMapSlots>, id: string) =>
    maps.slot({ id, className: 'map-canvas', ariaLabel: `karta ${id}`, points: [], lines: [] });

  it('answers with nothing when the page has no map factory', () => {
    expect(ask(createMapSlots(undefined), 'a')).toBeNull();
  });

  it('creates one map per id and updates it on every later render', () => {
    const { factory, made } = spyFactory();
    const maps = createMapSlots(factory as never);
    const first = ask(maps, 'a')!;
    maps.sweep();
    const second = ask(maps, 'a')!;
    maps.sweep();
    expect(second).toBe(first);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(made[0]!.update).toHaveBeenCalledTimes(1);
    expect(made[0]!.destroy).not.toHaveBeenCalled();
    expect(first.getAttribute('aria-label')).toBe('karta a');
  });

  it('pauses every live map on pause() (R-F6: the frozen dashboard stops both of its maps)', () => {
    const { factory, made } = spyFactory();
    const maps = createMapSlots(factory as never);
    ask(maps, 'a');
    ask(maps, 'b');
    maps.pause();
    expect(made[0]!.pause).toHaveBeenCalledTimes(1);
    expect(made[1]!.pause).toHaveBeenCalledTimes(1);
    expect(() => createMapSlots(undefined).pause()).not.toThrow();
  });

  it('destroys a map no render asked for, and every map on destroy', () => {
    const { factory, made } = spyFactory();
    const maps = createMapSlots(factory as never);
    ask(maps, 'a');
    ask(maps, 'b');
    maps.sweep();
    ask(maps, 'a');
    maps.sweep(); // 'b' was not drawn this time
    expect(made[1]!.destroy).toHaveBeenCalledTimes(1);
    expect(made[0]!.destroy).not.toHaveBeenCalled();
    maps.destroy();
    expect(made[0]!.destroy).toHaveBeenCalledTimes(1);
    // A map that came back after a destroy is a new one.
    ask(maps, 'a');
    expect(factory).toHaveBeenCalledTimes(3);
  });
});

// --- The stage's additive options (T1.3): what the wrapper hands MapLibre -----
// A MapLibre stand-in that records its constructor options, its controls and
// its camera calls; the map never loads a style, which is enough for the
// constructor, the controls and a fit.
class FakeMap {
  static instances: FakeMap[] = [];
  readonly controls: { control: FakeControl; position?: string }[] = [];
  readonly cameraCalls: { kind: string; options: Record<string, unknown> }[] = [];
  private readonly canvas = document.createElement('canvas');
  constructor(public readonly options: Record<string, unknown>) {
    FakeMap.instances.push(this);
    (options.container as HTMLElement).appendChild(this.canvas);
  }
  on(): void {}
  once(): void {}
  addControl(control: FakeControl, position?: string): void { this.controls.push({ control, position }); }
  getCanvas(): HTMLCanvasElement { return this.canvas; }
  addImage(): void {}
  hasImage(): boolean { return false; }
  addSource(): void {}
  getSource(): undefined { return undefined; }
  addLayer(): void {}
  setPaintProperty(): void {}
  setLayoutProperty(): void {}
  setFilter(): void {}
  queryRenderedFeatures(): [] { return []; }
  easeTo(options: Record<string, unknown>): void { this.cameraCalls.push({ kind: 'easeTo', options }); }
  jumpTo(options: Record<string, unknown>): void { this.cameraCalls.push({ kind: 'jumpTo', options }); }
  fitBounds(bounds: unknown, options: Record<string, unknown> = {}): void { this.cameraCalls.push({ kind: 'fitBounds', options: { ...options, bounds } }); }
  getCenter() { return { lng: 15.98, lat: 45.815 }; }
  getZoom(): number { return 13; }
  resize(): void {}
  remove(): void {}
}
class FakeControl { constructor(public readonly options: Record<string, unknown> = {}) {} }
const lib = { ...basemap, ...overlays, Map: FakeMap, AttributionControl: FakeControl, NavigationControl: FakeControl, ScaleControl: FakeControl, LngLatBounds: class {} };
const CLOSURE: MapLine = { id: 'c1', title: 'Grada Vukovara', coordinates: [[15.959, 45.799], [15.957, 45.799]] };
const STOP = { id: '106_1', name: 'Trg bana J. Jelačića', lon: 15.977, lat: 45.813, routes: ['6', '11'] };
const flush = async (): Promise<void> => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); };

async function stageMap(extra: Partial<CityMapOptions> = {}, box?: { width: number; height: number }) {
  const container = document.createElement('div');
  if (box) {
    // happy-dom lays nothing out: the box MapLibre would measure (clientWidth/clientHeight) is given by the test.
    Object.defineProperty(container, 'clientWidth', { get: () => box.width });
    Object.defineProperty(container, 'clientHeight', { get: () => box.height });
  }
  document.body.appendChild(container);
  const handle = createCityMap(
    { container, ariaLabel: 'Karta', points: [], lines: [CLOSURE], reducedMotion: true, loadNetwork: async () => null, ...extra },
    { loadMaplibre: async () => lib as never, raf: () => 0, cancel: () => {}, origin: 'https://zagreb.example' },
  );
  await flush();
  const map = FakeMap.instances.at(-1)!;
  const credit = map.controls.find((c) => 'customAttribution' in c.control.options)!;
  return { handle, map, attribution: credit.control, corner: credit.position };
}

afterEach(() => {
  FakeMap.instances.length = 0;
  document.body.replaceChildren();
});

describe('the stage options: cooperative gestures, compact attribution, padding-aware fits', () => {
  it('leaves cooperative gestures off and the attribution expanded by default, as every surface before the stage', async () => {
    const { map, attribution, corner } = await stageMap();
    expect(map.options.cooperativeGestures).toBeFalsy();
    expect(attribution.options).toEqual({ compact: false, customAttribution: basemap.MAP_ATTRIBUTION_HTML });
    expect(corner).toBe('bottom-right');
  });

  it('cooperative: true asks MapLibre for cooperative gestures and gives its help texts in the page’s language', async () => {
    const hr = await stageMap({ cooperative: true });
    expect(hr.map.options.cooperativeGestures).toBe(true);
    const locale = hr.map.options.locale as Record<string, string>;
    expect(locale['CooperativeGesturesHandler.MobileHelpText']).toBe('Kartu pomiči dvama prstima');
    expect(locale['CooperativeGesturesHandler.WindowsHelpText']).toContain('Ctrl');
    expect(locale['CooperativeGesturesHandler.MacHelpText']).toContain('⌘');
    const en = await stageMap({ cooperative: true, locale: 'en' });
    expect((en.map.options.locale as Record<string, string>)['CooperativeGesturesHandler.MobileHelpText']).toBe('Use two fingers to move the map');
  });

  it('attributionCompact: true builds the compact control with the same custom credit, bottom-left where the stage keeps its zoom and tools clear', async () => {
    const { attribution, corner } = await stageMap({ attributionCompact: true });
    expect(attribution.options).toEqual({ compact: true, customAttribution: basemap.MAP_ATTRIBUTION_HTML });
    expect(corner).toBe('bottom-left');
  });

  it('fitPadding is added to the 40 px breathing space on every fit, follows setFitPadding, and offsets a centred point by half of it', async () => {
    const { handle, map } = await stageMap({ fitPadding: { bottom: 300 }, stop: STOP });
    handle.select!({ kind: 'closure', id: 'c1' }, { fit: true });
    expect(map.cameraCalls.at(-1)).toMatchObject({ kind: 'fitBounds', options: { padding: { top: 40, right: 40, bottom: 340, left: 40 }, maxZoom: 16 } });
    handle.setFitPadding!({ bottom: 120, right: 20 });
    handle.fit!('selection');
    expect(map.cameraCalls.at(-1)?.options.padding).toEqual({ top: 40, right: 60, bottom: 160, left: 40 });
    // A single point (the screen's stop) is eased to, not fitted: the padding becomes an offset so it lands in the uncovered middle.
    handle.select!({ kind: 'stop', id: STOP.id }, { fit: true });
    expect(map.cameraCalls.at(-1)).toMatchObject({ kind: 'easeTo', options: { center: [STOP.lon, STOP.lat], offset: [-10, -60] } });
    handle.fit!('city');
    expect(map.cameraCalls.at(-1)).toMatchObject({ kind: 'easeTo', options: { center: ZAGREB_CENTER, offset: [-10, -60] } });
  });

  it('a padding that would leave MapLibre no room (an open sheet under the breathing space) is clamped to the container’s box on each axis, so a fit is never refused', async () => {
    const { handle, map } = await stageMap({ fitPadding: { bottom: 700 } }, { width: 390, height: 740 });
    handle.select!({ kind: 'closure', id: 'c1' }, { fit: true });
    // 740 px tall: at least 80 px stay free; the excess comes off the covered side and the 40 px breathing space stays.
    expect(map.cameraCalls.at(-1)?.options.padding).toEqual({ top: 40, right: 40, bottom: 620, left: 40 });
    handle.setFitPadding!({ right: 380 }); // a landscape column wider than the box leaves
    handle.fit!('selection');
    expect(map.cameraCalls.at(-1)?.options.padding).toEqual({ top: 40, right: 270, bottom: 40, left: 40 });
    handle.setFitPadding!({ bottom: 370 }); // half: within the room, untouched
    handle.fit!('selection');
    expect(map.cameraCalls.at(-1)?.options.padding).toEqual({ top: 40, right: 40, bottom: 410, left: 40 });
  });
});
// The whole chapter contract, with no map and no DOM: what the camera does,
// what each chapter lights, and the one thing a chapter may not ask for.
describe('two framings, three chapters', () => {
  const STOP = { id: '106_1', name: 'Trg bana J. Jelačića', lon: 15.97726, lat: 45.81286, routes: ['6'], district: 'donji-grad' };
  const route = { kind: 'route', id: '6' } as const;

  it('holds the stop at street zoom in Promet and the quarter in the other two, lights a different subset in each, and refuses to follow outside Promet', () => {
    const promet = chapterView('promet', { stop: STOP, selection: route });
    expect(promet.zoom).toBe(KIOSK_MAP_ZOOM);
    expect(promet.center).toEqual([STOP.lon, STOP.lat]);
    expect(promet.follow).toBe(true);
    expect(promet.outline).toBe(false);

    // One framing for both kvart chapters: the quarter is the same quarter
    // whichever of them is showing, so only the lit layers differ.
    const veceras = chapterView('veceras', { stop: STOP, selection: route });
    const grad = chapterView('grad', { stop: STOP, selection: route });
    expect(veceras.zoom).toBe(KIOSK_KVART_ZOOM);
    expect(grad.zoom).toBe(veceras.zoom);
    expect(grad.center).toEqual(veceras.center);
    expect(grad.outline && veceras.outline).toBe(true);
    // Following a route's vehicles while framing a quarter is incoherent, and
    // the two eases would fight; the phone's route never steers these two.
    for (const view of [veceras, grad]) {
      expect(view.follow).toBeUndefined();
      expect(view.selectedRoute).toBeUndefined();
      expect(view.selectedStop).toBe(STOP.id);
    }
    expect(new Set([promet.emphasis, veceras.emphasis, grad.emphasis].map((e) => JSON.stringify(e))).size).toBe(3);
    // Safety marks are not a chapter's to switch off; the assembly points'
    // own rule (only while urgent) is what keeps them off a calm screen.
    for (const view of [promet, veceras, grad]) expect(view.emphasis).toContain('assembly');
    expect(promet.emphasis).not.toContain('event'); // Promet is the network

    // The kvart framing is about six kilometres of ground across the box, and
    // stays inside the zooms the archive actually carries: fitting a raw
    // district bounding box would put Sesvete and Brezovica below the floor.
    expect(metresPerPixel(KIOSK_KVART_ZOOM, STOP.lat) * KIOSK_MAP_WIDTH_PX).toBeCloseTo(KVART_SPAN_M, -2);
    for (const chapter of ['promet', 'veceras', 'grad'] as const) {
      const { zoom } = chapterView(chapter, { stop: STOP, selection: null });
      expect(zoom).toBeGreaterThanOrEqual(KIOSK_MIN_ZOOM);
      expect(zoom).toBeLessThanOrEqual(KIOSK_MAX_ZOOM);
    }
    // Pure: same input, same answer, and a screen with no stop still frames.
    expect(chapterView('grad', { stop: STOP, selection: null })).toEqual(chapterView('grad', { stop: STOP, selection: null }));
    expect(chapterView('promet', { stop: null, selection: null }).center).toBeUndefined();
  });
});
