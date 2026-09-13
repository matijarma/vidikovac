// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
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

async function stageMap(extra: Partial<CityMapOptions> = {}) {
  const container = document.createElement('div');
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
});
