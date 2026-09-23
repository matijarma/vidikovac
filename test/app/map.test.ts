// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { districtBySlug } from '../../app/src/kiosk/districts';
import { CITY_WINDOW, CITY_WINDOW_PADDING_PX, cityWindowView, DISTRICT_SPAN_M, FIELD_MAX_ZOOM, FIELD_MIN_ZOOM, FIELD_SPAN_M, fieldView, fieldZoom, HANDHELD_SPAN_M, KIOSK_EMPHASIS, metresPerPixel, outlineView, PAIRED_ZOOM, pairedView } from '../../app/src/kiosk/mapview';
import { EARTH_CIRCUMFERENCE_M } from '../../app/src/map/scale';
import { BIKE_COUNT_PX, BIKE_DISC_RADIUS_PX, BIKE_FAR_RADIUS_PX, cityLayers } from '../../app/src/map/city-layers';
import * as basemap from '../../app/src/map/basemap';
import {
  cityLabelsOf,
  createCityMap,
  OSM_ATTRIBUTION,
  OSM_RASTER_URL,
  osmStyle,
  ZAGREB_CENTER,
  type CityMapOptions,
  type MapLine,
} from '../../app/src/map/city-map';
import { linesToGeoJson, pointsToGeoJson } from '../../app/src/map/external-features';
import { createMapSlots } from '../../app/src/map/map-slots';
import * as overlays from '../../app/src/map/overlays';
import * as nameCensus from '../../app/src/map/name-census';
import * as mapPointer from '../../app/src/map/map-pointer';
import { TEASER_BOX_HALF_M } from '../../worker/feed/modules/zet-rt';
// WP2 step 4: the frame's camera (map/frame.ts) and the wall's framing rule (kiosk/mapview.ts).
import { framedPlace, frameRadiusOf } from '../../app/src/kiosk/mapview';
import { FIELD_DESIGN_HEIGHT, FIELD_DESIGN_WIDTH } from '../../app/src/kiosk/layout';
import { boundsView, FRAME_MAX_ZOOM, FRAME_MIN_ZOOM, FRAME_PADDING_PX, frameBounds, frameView } from '../../app/src/map/frame';
import { distanceM } from '../../shared/city/geo';

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
const lib = { ...basemap, ...overlays, ...nameCensus, ...mapPointer, Map: FakeMap, AttributionControl: FakeControl, NavigationControl: FakeControl, ScaleControl: FakeControl, LngLatBounds: class {} };
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

  it('attributionCompact: true builds the compact control with the same custom credit, bottom-right, out of the way of the locate button under the zoom', async () => {
    const { attribution, corner, container } = await stageMap({ attributionCompact: true });
    expect(attribution.options).toEqual({ compact: true, customAttribution: basemap.MAP_ATTRIBUTION_HTML });
    expect(corner).toBe('bottom-right');
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
// The city's own places on a map somebody reads from a step away: a BAJS
// station is a disc with its count in it at every zoom (grey with "0", grey
// and blank when the count is not known), a venue's disc carries its
// programme count, and nothing is ever a merged cluster. The unframed window
// onto the whole city keeps a station a small dot without its number.
describe('the city places’ marks', () => {
  /** Enough of the MapLibre expression language to read these layers back. */
  function evaluate(expr: unknown, props: Record<string, unknown>, zoom: number): unknown {
    if (!Array.isArray(expr)) return expr;
    const [op, ...rest] = expr as [string, ...unknown[]];
    const ev = (x: unknown) => evaluate(x, props, zoom);
    switch (op) {
      case 'literal': return rest[0];
      case 'zoom': return zoom;
      case 'get': return props[rest[0] as string];
      case '*': return (rest as unknown[]).reduce((n, x) => (n as number) * (ev(x) as number), 1);
      case '==': return ev(rest[0]) === ev(rest[1]);
      case '>': return (ev(rest[0]) as number) > (ev(rest[1]) as number);
      case '!': return !ev(rest[0]);
      case 'all': return rest.every((x) => ev(x) === true);
      case 'any': return rest.some((x) => ev(x) === true);
      case 'in': return (ev(rest[1]) as unknown[]).includes(ev(rest[0]));
      case 'min': return Math.min(...rest.map((x) => ev(x) as number));
      case '+': return rest.reduce((n: number, x) => n + (ev(x) as number), 0);
      case 'sqrt': return Math.sqrt(ev(rest[0]) as number);
      case 'case': {
        for (let i = 0; i + 1 < rest.length; i += 2) if (ev(rest[i]) === true) return ev(rest[i + 1]);
        return ev(rest[rest.length - 1]);
      }
      case 'match': {
        const v = ev(rest[0]);
        for (let i = 1; i + 1 < rest.length; i += 2) {
          const k = rest[i];
          if (Array.isArray(k) ? k.includes(v) : k === v) return ev(rest[i + 1]);
        }
        return ev(rest[rest.length - 1]);
      }
      default: throw new Error(`unhandled expression ${op}`);
    }
  }
  const palette = basemap.overlayPalette('light');
  const layers = cityLayers(palette, null, 2);
  const byId = (id: string, from = layers) => from.find((l) => l.id === id)!;
  const bike = (badge: string, spent = false, extra: Record<string, unknown> = {}) => ({ category: 'bikes', badge, spent, eventCount: 0, priority: 2, ...extra });
  const venue = { category: 'culture', badge: '3', eventCount: 3, priority: 0 };
  const plain = { category: 'water', badge: '', eventCount: 0, priority: 3 };

  it('draws a BAJS station as a 20 px disc with its count in it at every zoom on the wall’s scale', () => {
    expect([BIKE_DISC_RADIUS_PX, BIKE_COUNT_PX]).toEqual([10, 12]);
    const dots = byId('city-place-dots'), badges = byId('city-place-badges');
    // Nothing on these layers follows the camera any more.
    expect(JSON.stringify([dots, badges])).not.toContain('"zoom"');
    for (const zoom of [12.7, 13, 13.5, 14, 16]) {
      expect(evaluate(dots.paint!['circle-radius'], bike('7'), zoom), `bike @${zoom}`).toBe(20);
      expect(evaluate(dots.paint!['circle-radius'], bike('0', true), zoom), `spent bike @${zoom}`).toBe(20);
      expect(evaluate(badges.layout!['text-size'], bike('7'), zoom), `count @${zoom}`).toBe(24);
      expect(evaluate(badges.layout!['text-field'], bike('7'), zoom), `count text @${zoom}`).toBe('7');
      // Every other kind of place keeps exactly the mark it had.
      expect(evaluate(dots.paint!['circle-radius'], venue, zoom), `venue @${zoom}`).toBe(2 * Math.min(18, 11 + Math.sqrt(3)));
      expect(evaluate(dots.paint!['circle-radius'], plain, zoom), `plain @${zoom}`).toBe(16);
      expect(evaluate(badges.layout!['text-size'], venue, zoom), `venue text @${zoom}`).toBe(24);
    }
    // Full strength at every zoom: no opacity ramp is left to fade a count away.
    for (const key of ['circle-opacity', 'circle-stroke-opacity']) expect(dots.paint![key], key).toBeUndefined();
    expect(badges.paint!['text-opacity']).toBeUndefined();
    // A count is never dropped by a collision.
    expect(badges.layout!['text-allow-overlap']).toBe(true);
    // A station's ring is a hairline; every other mark keeps its 2 px stroke.
    expect(evaluate(dots.paint!['circle-stroke-width'], bike('7'), 14)).toBe(1);
    expect(evaluate(dots.paint!['circle-stroke-width'], venue, 14)).toBe(2);
  });

  it('greys a station with nothing to give instead of fading it: a "0", a blank disc, and the phone’s older badges', () => {
    const color = byId('city-place-dots').paint!['circle-color'], ink = byId('city-place-badges').paint!['text-color'];
    expect(evaluate(color, bike('7'), 14)).toBe(palette.bike);
    expect(evaluate(ink, bike('7'), 14)).toBe(palette.bikeText);
    for (const spent of [bike('0', true), bike('', true)]) {
      expect(evaluate(color, spent, 14), JSON.stringify(spent)).toBe(palette.other);
      expect(evaluate(ink, spent, 14), JSON.stringify(spent)).toBe(palette.otherText);
    }
    // discover()'s points carry bikeAvailability's words and no `spent`: the same grey.
    for (const badge of ['0', '—', '?']) expect(evaluate(color, { category: 'bikes', badge, eventCount: 0 }, 14), badge).toBe(palette.other);
    // A "0" that is not a station's count is not a spent station: only the bikes read this.
    expect(evaluate(color, { category: 'culture', badge: '0', eventCount: 0 }, 14)).toBe(palette.event);
    expect(evaluate(color, venue, 14)).toBe(palette.event);
    expect(evaluate(ink, venue, 14)).toBe(palette.halo);
    expect(evaluate(color, { category: 'air', badge: '', eventCount: 0 }, 14)).toBe(palette.other);
    expect(evaluate(color, plain, 14)).toBe(palette.place);
  });

  it('keeps a station of the unframed whole-city window a small dot without its number', () => {
    const far = bike('7', false, { far: true });
    expect(BIKE_FAR_RADIUS_PX).toBe(3);
    expect(evaluate(byId('city-place-dots').paint!['circle-radius'], far, 12.7)).toBe(6);
    expect(evaluate(byId('city-place-badges').layout!['text-field'], far, 12.7)).toBe('');
    expect(evaluate(byId('city-place-dots').paint!['circle-color'], bike('0', true, { far: true }), 12.7)).toBe(palette.other);
    // `far` on anything but a station changes nothing.
    expect(evaluate(byId('city-place-dots').paint!['circle-radius'], { ...venue, far: true }, 12.7)).toBe(2 * Math.min(18, 11 + Math.sqrt(3)));
    expect(evaluate(byId('city-place-badges').layout!['text-field'], { ...venue, far: true }, 12.7)).toBe('3');
  });

  it('names what the surface asks for: every place, the venues alone on the framed wall, or none on the whole city', () => {
    const labels = (mode: Parameters<typeof cityLayers>[3]) => byId('city-place-labels', cityLayers(palette, null, 2, mode));
    const all = labels('all');
    expect(all.layout!.visibility).toBe('visible');
    expect(all.filter).toBeUndefined();
    expect(all.layout!['text-field']).toEqual(['get', 'title']);
    expect(all.minzoom).toBe(13);
    const venues = labels('venues');
    expect(venues.layout!.visibility).toBe('visible');
    // The framed wall names its venues at every zoom: Trg at Kadar 8 on 1920 frames at about 12.86,
    // and a cutoff at 13 left Gavella an anonymous programme count (review-w, P2).
    expect(venues.minzoom).toBeUndefined();
    // On the framed wall a venue's name tries its other anchors before it
    // yields to a passing pill (decision 17), starting where the fixed one stood.
    expect(venues.layout!['text-variable-anchor-offset']).toEqual(overlays.nameAnchorOffsets(1.5));
    expect(venues.layout!['text-justify']).toBe('auto');
    expect([venues.layout!['text-anchor'], venues.layout!['text-offset']]).toEqual([undefined, undefined]);
    expect([all.layout!['text-anchor'], all.layout!['text-offset'], all.layout!['text-variable-anchor-offset']]).toEqual(['top', [0, 1.5], undefined]);
    // A count never moves and is never dropped: the badges keep allow-overlap on every surface.
    expect(byId('city-place-badges', cityLayers(palette, null, 2, 'venues')).layout!['text-allow-overlap']).toBe(true);
    expect(evaluate(venues.filter, venue, 14)).toBe(true);
    expect(evaluate(venues.filter, bike('7'), 14)).toBe(false);
    expect(evaluate(venues.filter, { category: 'air', badge: '' }, 14)).toBe(false);
    expect(labels('none').layout!.visibility).toBe('none');
    // The badges and the dots do not depend on the mode: a count is not a name.
    expect(byId('city-place-badges', cityLayers(palette, null, 2, 'none'))).toEqual(byId('city-place-badges'));
    // The older boolean switch still means every name or none.
    expect(cityLayers(palette, null, 2, true)).toEqual(cityLayers(palette, null, 2, 'all'));
    expect(cityLayers(palette, null, 2, false)).toEqual(cityLayers(palette, null, 2, 'none'));
    expect(cityLayers(palette, null, 2)).toEqual(cityLayers(palette, null, 2, 'all'));
    expect([cityLabelsOf(undefined), cityLabelsOf(true), cityLabelsOf(false), cityLabelsOf('venues')]).toEqual(['all', 'all', 'none', 'venues']);
  });

  it('has no cluster mark left on any layer', () => {
    expect(JSON.stringify(cityLayers(palette, 'x', 1, 'venues'))).not.toContain('cluster');
  });
});

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

  it('frames a chosen place on a wall: Kadar 6\u2019s 2 km on the field\u2019s shorter side unless a measured radius is handed in; a phone\u2019s band keeps its glance', () => {
    const view = fieldView({ stop: STOP, placeSet: true, district: null, widthPx: 1400, heightPx: 888, spanM: FIELD_SPAN_M });
    expect(view).toEqual({ ...frameView(STOP, 2000, 1400, 888), emphasis: KIOSK_EMPHASIS, outline: true });
    expect(view.center).toEqual([STOP.lon, STOP.lat]);
    // The measured radius wins over the Kadar's fallback, and the Kadar picks the fallback.
    const wall = { stop: STOP, placeSet: true, district: null, widthPx: 1250, heightPx: 870, spanM: FIELD_SPAN_M };
    expect(fieldView({ ...wall, radiusM: 2182 }).zoom).toBe(frameView(STOP, 2182, 1250, 870).zoom);
    expect(fieldView({ ...wall, frame: 8 }).zoom).toBeCloseTo(13.02, 2);
    expect(fieldView({ ...wall, frame: 4 }).zoom).toBeCloseTo(14.07, 2);
    // A phone's band keeps its glance at the stop: the handheld span across its width.
    expect(fieldView({ ...wall, widthPx: 356, heightPx: 420, spanM: HANDHELD_SPAN_M, handheld: true })).toEqual({ zoom: fieldZoom(356, STOP.lat, HANDHELD_SPAN_M), emphasis: KIOSK_EMPHASIS, outline: true, center: [STOP.lon, STOP.lat] });
  });

  it('frames the chosen place itself, and keeps the whole-city window for the read-path default place', () => {
    const place = { lon: 15.9951, lat: 45.8147 };
    // An address place: the frame is centred on it, not on the stop the list reads.
    expect(fieldView({ stop: STOP, place, placeSet: true, district: null, widthPx: 1250, heightPx: 870, spanM: FIELD_SPAN_M }).center).toEqual([place.lon, place.lat]);
    // placeSet false (an empty field reads back as Trg): the list has its place, the map the whole city, or the configured quarter.
    const fallback = fieldView({ stop: STOP, place: STOP, placeSet: false, district: null, widthPx: 1250, heightPx: 870, spanM: FIELD_SPAN_M });
    expect(fallback).toEqual({ ...cityWindowView(1250, 870), emphasis: KIOSK_EMPHASIS, outline: true });
    const seat = districtBySlug('maksimir')!.seat;
    expect(fieldView({ stop: STOP, placeSet: false, district: 'maksimir', widthPx: 1250, heightPx: 870, spanM: FIELD_SPAN_M }).center).toEqual([seat.lon, seat.lat]);
    // Framed is placeSet, never the presence of a place.
    expect(framedPlace({ stop: STOP, place: STOP, placeSet: false })).toBeNull();
    expect(framedPlace({ stop: STOP })).toBeNull();
    expect(framedPlace({ stop: STOP, placeSet: true })).toBe(STOP);
    expect(framedPlace({ stop: STOP, place, placeSet: true })).toBe(place);
    expect(framedPlace({ stop: null, placeSet: true })).toBeNull();
    expect([frameRadiusOf({}), frameRadiusOf({ frame: 4 }), frameRadiusOf({ frame: 8, radiusM: 1234 })]).toEqual([2000, 1300, 1234]);
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

  it('fits a configured district\u2019s own rings through the window\u2019s arithmetic: its middle, the tighter axis, the same clearance', () => {
    // A box a shade over a kilometre each way, in a field with room for it.
    const ring: [number, number][] = [[15.96, 45.8], [15.98, 45.8], [15.98, 45.81], [15.96, 45.81], [15.96, 45.8]];
    const fit = outlineView({ id: 'x', polygons: [[ring]] }, 1300, 880);
    expect(fit.center).toEqual([15.97, 45.805]);
    const ppm = 1 / metresPerPixel(fit.zoom, 45.805);
    const acrossPx = ((15.98 - 15.96) / 360) * EARTH_CIRCUMFERENCE_M * Math.cos((45.805 * Math.PI) / 180) * ppm;
    const upPx = ((45.81 - 45.8) / 360) * EARTH_CIRCUMFERENCE_M * ppm;
    // The tighter axis touches the clearance, the looser one has room to spare.
    expect(Math.max(acrossPx / (1300 - 2 * CITY_WINDOW_PADDING_PX), upPx / (880 - 2 * CITY_WINDOW_PADDING_PX))).toBeCloseTo(1, 6);
    expect(CITY_WINDOW_PADDING_PX).toBe(24);
    // Never past the overzoom ceiling: a pinhead of a quarter does not take the camera to z19.
    expect(outlineView({ id: 'x', polygons: [[[[15.97, 45.8], [15.9701, 45.8], [15.9701, 45.8001], [15.97, 45.8], [15.97, 45.8]]]] }, 1300, 880).zoom).toBe(FIELD_MAX_ZOOM);
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

  // The frame (WP2 step 4): the square of side 2R around the place on the
  // field's shorter side, R measured per place (shared/city/frame.ts).
  it('frameView fits the square of side 2R on the field\u2019s shorter side: the wall frames Kadar 4 / 6 / 8 at z14.07 / 13.45 / 13.02', () => {
    const wide = [1300, 2000, 2700].map((r) => frameView(STOP, r, 1250, 870).zoom);
    expect(wide[0]).toBeCloseTo(14.07, 2);
    expect(wide[1]).toBeCloseTo(13.45, 2);
    expect(wide[2]).toBeCloseTo(13.02, 2);
    expect(Math.abs(wide[1]! - 13.45)).toBeLessThanOrEqual(0.01);
    // The design boxes: the compact wall clamps Kadar 8 to the floor, the totem is taller than it is wide.
    const at = (c: 'wide' | 'compact' | 'portrait', r: number) => frameView(STOP, r, FIELD_DESIGN_WIDTH[c], FIELD_DESIGN_HEIGHT[c]).zoom;
    expect([at('wide', 1300), at('wide', 2000), at('wide', 2700)]).toEqual(wide);
    expect(at('compact', 1300)).toBeCloseTo(13.53, 2);
    expect(at('compact', 2000)).toBeCloseTo(12.90, 2);
    expect(at('compact', 2700)).toBe(FIELD_MIN_ZOOM);
    expect(frameView(STOP, 2700, 794, 610).zoom).toBe(12.7);
    expect(at('portrait', 1300)).toBeCloseTo(14.24, 2);
    expect(at('portrait', 2000)).toBeCloseTo(13.62, 2);
    expect(at('portrait', 2700)).toBeCloseTo(13.18, 2);
    // The centre is the place itself; a box not yet laid out is the floor, never NaN; defaults are the kiosk's field limits.
    expect(frameView(STOP, 2000, 1250, 870).center).toEqual([STOP.lon, STOP.lat]);
    expect(frameView(STOP, 2000, 0, 0).zoom).toBe(12.7);
    expect([FRAME_PADDING_PX, FRAME_MIN_ZOOM, FRAME_MAX_ZOOM]).toEqual([CITY_WINDOW_PADDING_PX, FIELD_MIN_ZOOM, FIELD_MAX_ZOOM]);
    expect(frameView(STOP, 100, 1250, 870).zoom).toBe(FIELD_MAX_ZOOM);
    // At the derived zoom the square's 2R fills the shorter side less the clearance, and fits the longer one.
    const ppm = 1 / metresPerPixel(wide[1]!, STOP.lat);
    expect(4000 * ppm).toBeCloseTo(870 - 2 * 24, 0);
    expect(4000 * ppm).toBeLessThan(1250 - 2 * 24);
  });

  it('frameBounds lays out 2R of ground across and up at the place\u2019s latitude, and boundsView is the window\u2019s own fit', () => {
    const box = frameBounds(STOP, 2000);
    expect(distanceM({ lon: box.west, lat: STOP.lat }, { lon: box.east, lat: STOP.lat })).toBeCloseTo(4000, -1);
    expect(Math.abs(distanceM({ lon: box.west, lat: STOP.lat }, { lon: box.east, lat: STOP.lat }) - 4000)).toBeLessThan(12);
    expect(Math.abs(distanceM({ lon: STOP.lon, lat: box.south }, { lon: STOP.lon, lat: box.north }) - 4000)).toBeLessThan(12);
    // In the metres the camera counts (EARTH_CIRCUMFERENCE_M, map/scale.ts) the square is 2R to the metre.
    const across = (EARTH_CIRCUMFERENCE_M * Math.cos((STOP.lat * Math.PI) / 180) * (box.east - box.west)) / 360;
    expect(Math.abs(across - 4000)).toBeLessThan(1);
    expect(Math.abs((EARTH_CIRCUMFERENCE_M * (box.north - box.south)) / 360 - 4000)).toBeLessThan(1);
    expect(boundsView(CITY_WINDOW, 1300, 880, CITY_WINDOW_PADDING_PX, FIELD_MIN_ZOOM, FIELD_MAX_ZOOM)).toEqual(cityWindowView(1300, 880));
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
import '../../shared/kiosk/external-text';
