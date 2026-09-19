// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { districtBySlug } from '../../app/src/kiosk/districts';
import { CITY_WINDOW, cityWindowView, DISTRICT_SPAN_M, FIELD_MAX_ZOOM, FIELD_MIN_ZOOM, FIELD_SPAN_M, fieldView, fieldZoom, HANDHELD_SPAN_M, KIOSK_EMPHASIS, metresPerPixel, PAIRED_ZOOM, pairedView } from '../../app/src/kiosk/mapview';
import { EARTH_CIRCUMFERENCE_M } from '../../app/src/map/scale';
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
import { TEASER_BOX_HALF_M } from '../../worker/feed/modules/zet-rt';

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

  it('replaces a same-id slot when its renderer changes, treating omitted renderer as map, and disposes each instance once', () => {
    const { factory, made } = spyFactory();
    const maps = createMapSlots(factory as never);
    const options = { id: 'a', className: 'map-canvas', ariaLabel: 'karta a', points: [], lines: [] };
    const geographic = maps.slot(options)!;
    document.body.appendChild(geographic);
    maps.sweep();
    expect(maps.slot({ ...options, renderer: 'map' })).toBe(geographic);
    const schema = maps.slot({ ...options, renderer: 'schema' })!;
    expect(schema).not.toBe(geographic);
    expect(geographic.isConnected).toBe(false);
    expect(made[0]!.destroy).toHaveBeenCalledTimes(1);
    expect(maps.handle('a')).toBe(made[1]);
    expect(maps.slot({ ...options, renderer: 'schema' })).toBe(schema);
    maps.sweep();
    expect(maps.slot(options)).not.toBe(schema);
    expect(made[1]!.destroy).toHaveBeenCalledTimes(1);
    maps.destroy();
    expect(factory).toHaveBeenCalledTimes(3);
    expect(made.every((handle) => handle.destroy.mock.calls.length === 1)).toBe(true);
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
  addControl(control: FakeControl, position?: string): void {
    this.controls.push({ control, position });
    if ('customAttribution' in control.options) {
      const credit = document.createElement('details');
      credit.className = `maplibregl-ctrl-attrib${control.options.compact ? ' maplibregl-compact maplibregl-compact-show' : ''}`;
      credit.open = true; // the library's actual default, including compact mode
      credit.innerHTML = `<summary></summary><div>${control.options.customAttribution}</div>`;
      (this.options.container as HTMLElement).appendChild(credit);
    }
  }
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
  return { handle, map, container, attribution: credit.control, corner: credit.position };
}

afterEach(() => {
  FakeMap.instances.length = 0;
  document.body.replaceChildren();
});

describe('the stage options: cooperative gestures, compact attribution, padding-aware fits', () => {
  it('leaves cooperative gestures off and the attribution expanded by default, as every surface before the stage', async () => {
    const { map, attribution, corner, container } = await stageMap();
    expect(map.options.cooperativeGestures).toBeFalsy();
    expect(attribution.options).toEqual({ compact: false, customAttribution: basemap.MAP_ATTRIBUTION_HTML });
    expect(corner).toBe('bottom-right');
    expect(container.querySelector('details')?.open).toBe(true);
  });

  it('cooperative: true asks MapLibre for cooperative gestures and gives its help texts in the page’s language', async () => {
    const hr = await stageMap({ cooperative: true });
    expect(hr.map.options.cooperativeGestures).toBe(true);
    const locale = hr.map.options.locale as Record<string, string>;
    expect(locale['CooperativeGesturesHandler.MobileHelpText']).toBe('Kartu pomiči dvama prstima');
    expect(locale['CooperativeGesturesHandler.WindowsHelpText']).toContain('Ctrl');
    expect(locale['CooperativeGesturesHandler.MacHelpText']).toContain('⌘');
    expect(locale['AttributionControl.ToggleAttribution']).toBe('Izvori karte');
    const en = await stageMap({ cooperative: true, locale: 'en' });
    expect((en.map.options.locale as Record<string, string>)['CooperativeGesturesHandler.MobileHelpText']).toBe('Use two fingers to move the map');
    expect((en.map.options.locale as Record<string, string>)['AttributionControl.ToggleAttribution']).toBe('Map attribution');
  });

  it('attributionCompact: true builds the compact control with the same custom credit, bottom-left where the stage keeps its zoom and tools clear', async () => {
    const { attribution, corner, container } = await stageMap({ attributionCompact: true });
    expect(attribution.options).toEqual({ compact: true, customAttribution: basemap.MAP_ATTRIBUTION_HTML });
    expect(corner).toBe('bottom-left');
    expect(container.querySelector('details')?.open).toBe(false);
    expect(container.querySelector('details')?.classList.contains('maplibregl-compact-show')).toBe(false);
    expect(container.querySelector('details')?.textContent).toContain('OpenStreetMap');
    expect(container.querySelector('details a')?.getAttribute('href')).toBe('https://www.openstreetmap.org/copyright');
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
// One camera for the invitation (R-KP2, R-KP11): the zoom is derived from
// the field's measured width and a fixed ground span, never written, and the
// view carries no selection and no padding -- the enlarged screen-stop ring is
// the anchor. The paired phase keeps today's Promet contract (R-KP8). Pure: no
// map, no DOM, no clock.
describe('the field camera and the paired camera', () => {
  const STOP = { id: '106_1', name: 'Trg bana J. Jelačića', lon: 15.97726, lat: 45.81286, routes: ['6'], district: 'donji-grad' };
  const LAT = 45.815;

  it('derives the zoom from the width: 1500 m across the map panel, 1400 m across a handheld band, clamped to what the archive carries', () => {
    // The four design widths (kiosk/layout.ts FIELD_DESIGN_WIDTH) at Zagreb's latitude.
    expect(fieldZoom(555, LAT, FIELD_SPAN_M)).toBeCloseTo(14.30, 2);
    expect(fieldZoom(367, LAT, FIELD_SPAN_M)).toBeCloseTo(13.70, 2);
    expect(fieldZoom(360, LAT, FIELD_SPAN_M)).toBeCloseTo(13.68, 2);
    expect(fieldZoom(358, LAT, HANDHELD_SPAN_M)).toBeCloseTo(13.77, 2);
    // The inverse of metresPerPixel: at the derived zoom the span fills the width exactly.
    expect(metresPerPixel(fieldZoom(555, LAT, FIELD_SPAN_M), LAT) * 555).toBeCloseTo(FIELD_SPAN_M, 6);
    expect(FIELD_SPAN_M).toBe(1500);
    expect(HANDHELD_SPAN_M).toBe(1400);
    // The clamp: a tiny box never leaves the archive's readable floor, a huge one never overzooms past its ceiling; no width yet is the floor, never NaN.
    expect(fieldZoom(100, LAT, FIELD_SPAN_M)).toBe(FIELD_MIN_ZOOM);
    expect(fieldZoom(6000, LAT, FIELD_SPAN_M)).toBe(FIELD_MAX_ZOOM);
    expect(fieldZoom(0, LAT, FIELD_SPAN_M)).toBe(FIELD_MIN_ZOOM);
    expect([FIELD_MIN_ZOOM, FIELD_MAX_ZOOM]).toEqual([12.7, 15.5]);
  });

  it('the field view is the stop at its derived zoom with the kiosk emphasis and the outline, and no selection, no follow, no padding', () => {
    const view = fieldView({ stop: STOP, district: null, widthPx: 1400, heightPx: 888, spanM: FIELD_SPAN_M });
    expect(view).toEqual({ zoom: fieldZoom(1400, STOP.lat, FIELD_SPAN_M), emphasis: KIOSK_EMPHASIS, outline: true, center: [STOP.lon, STOP.lat] });
    expect(KIOSK_EMPHASIS).toEqual(['event', 'quake', 'assembly', 'pharmacy']);
  });

  // The screen a person sets up with one button has no stop and no district:
  // it opens on the whole city (CITY_WINDOW, Crnomerec to Maksimir, the Sava
  // to Mirogoj), fitted to whatever box the composition gives it.
  it('frames the whole city when neither a stop nor a district is configured: the window fitted with 24 px of clearance, the tighter axis governing, never below the zoom that still carries plates and stop rings', () => {
    expect(CITY_WINDOW).toEqual({ west: 15.925, south: 45.775, east: 16.035, north: 45.838 });
    // The floor is map/overlays.ts's PILL_ZOOM (and STOP_ZOOM) plus a fifth: under it the
    // plates and the stop rings stop drawing and the window would be a basemap with nothing on it.
    expect(FIELD_MIN_ZOOM).toBe(overlays.PILL_ZOOM + 0.2);
    expect(FIELD_MIN_ZOOM).toBe(12.7);
    // Every field the kiosk lays out is smaller than the window's 8.5 x 7.0 km asks for, so each sits on the floor.
    for (const [w, h] of [[1300, 880], [880, 620], [1032, 900], [358, 420]] as const) {
      expect(cityWindowView(w, h).zoom, `${w}x${h}`).toBe(FIELD_MIN_ZOOM);
    }
    expect(cityWindowView(0, 0).zoom).toBe(FIELD_MIN_ZOOM); // a box not yet laid out is the floor, never NaN
    expect(cityWindowView(1300, 880).center).toEqual([(15.925 + 16.035) / 2, (45.775 + 45.838) / 2]);
    // A field with room for the window takes the tighter of the two axes: 2600 x 1760 could
    // carry the window's width at z13.99 and only its height at z13.70.
    const big = cityWindowView(2600, 1760);
    expect(big.zoom).toBeCloseTo(13.70, 2);
    const mid = (45.775 + 45.838) / 2;
    const ppm = 1 / metresPerPixel(big.zoom, mid);
    expect(((45.838 - 45.775) / 360) * EARTH_CIRCUMFERENCE_M * ppm).toBeCloseTo(1760 - 48, 0);
    expect(((16.035 - 15.925) / 360) * EARTH_CIRCUMFERENCE_M * Math.cos((mid * Math.PI) / 180) * ppm).toBeLessThan(2600 - 48);
    // The same window is what the field view hands back for a screen with neither.
    const none = fieldView({ stop: null, district: null, widthPx: 1300, heightPx: 880, spanM: FIELD_SPAN_M });
    expect(none).toEqual({ ...cityWindowView(1300, 880), emphasis: KIOSK_EMPHASIS, outline: true });
  });

  it('frames a configured district on its seat until its outline lands, and a configured stop keeps its own centred camera', () => {
    const kvart = fieldView({ stop: null, district: 'maksimir', widthPx: 1300, heightPx: 880, spanM: FIELD_SPAN_M });
    const seat = districtBySlug('maksimir')!.seat;
    expect(kvart.center).toEqual([seat.lon, seat.lat]);
    expect(kvart.zoom).toBeCloseTo(fieldZoom(1300, seat.lat, DISTRICT_SPAN_M), 6);
    // An area that is not one of the seventeen gradske cetvrti ('zagreb' is the whole city) is the window.
    expect(fieldView({ stop: null, district: 'zagreb', widthPx: 1300, heightPx: 880, spanM: FIELD_SPAN_M }).center).toEqual(cityWindowView(1300, 880).center);
    // A stop outranks both.
    expect(fieldView({ stop: STOP, district: 'maksimir', widthPx: 1300, heightPx: 880, spanM: FIELD_SPAN_M }).center).toEqual([STOP.lon, STOP.lat]);
  });

  it('the worker\u2019s teaser box reaches past the field by one stop spacing (TEASER_BOX_HALF_M >= FIELD_SPAN_M / 2 + 400, D2): a vehicle has given the motion model one fix of its own before it enters the picture', () => {
    expect(TEASER_BOX_HALF_M).toBeGreaterThanOrEqual(FIELD_SPAN_M / 2 + 400);
  });

  it('the paired view keeps the Promet contract: street zoom, the stop selected, a relayed route followed, a relayed stop selected', () => {
    expect(PAIRED_ZOOM).toBe(15);
    const plain = pairedView({ stop: STOP, selection: null });
    expect(plain).toEqual({ zoom: PAIRED_ZOOM, emphasis: KIOSK_EMPHASIS, outline: true, center: [STOP.lon, STOP.lat], selectedStop: STOP.id });
    const route = pairedView({ stop: STOP, selection: { kind: 'route', id: '6' } });
    expect(route).toMatchObject({ selectedRoute: '6' });
    expect(route.follow).toBeUndefined();
    expect(route.selectedStop).toBeUndefined();
    expect(route.center).toBeUndefined(); // The renderer fits the public route.
    const other = pairedView({ stop: STOP, selection: { kind: 'stop', id: '200_1' } });
    expect(other.selectedStop).toBe('200_1');
    expect(other.follow).toBeUndefined();
    expect(other.selectedRoute).toBeUndefined();
    expect(pairedView({ stop: null, selection: null }).center).toBeUndefined();
  });
});
