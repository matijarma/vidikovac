// @vitest-environment happy-dom
// The seams /snimka/ adds to the city map (app/src/map/city-map.ts,
// overlays.ts, map-pointer.ts): CityMapDeps.createModel replaces the
// integrator import, CityMapHandle.setGhosts adds one muted-disc source and
// layer under the vehicle marks (V3-8), setGlyphMode switches dots and pills
// (V3-10), addStageLayer and setFeatureState carry the BAJS layer (V3-9),
// addControl puts the follow toggle in the control stack and project reads
// the camera, and pickRoutes lets a tap pick a drawn line from 12 px.
// Without any of them the map imports the integrator as it always did, adds
// nothing new to the style, sets no feature state and picks exactly what it
// picked; the living network of v2 is gone from every seam (V3-1).
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as basemap from '../../app/src/map/basemap';
import * as overlays from '../../app/src/map/overlays';
import * as nameCensus from '../../app/src/map/name-census';
import * as mapPointer from '../../app/src/map/map-pointer';
import * as cityLayers from '../../app/src/map/city-layers';
import * as externalFeatures from '../../app/src/map/external-features';
import * as externalLabels from '../../app/src/map/external-labels';
import * as vehicleFeatures from '../../app/src/map/vehicle-features';
import { createCityMap, type CityMapDeps, type CityMapOptions, type MapControl, type StageLayerSpec } from '../../app/src/map/city-map';
import { bindCityMapPointer, LINE_HIT_PX, type PointerHost, type PointerMap } from '../../app/src/map/map-pointer';
import type { Model } from '../../app/src/motion/integrator';
import { contrastRatio } from '../../app/src/ui/contrast';

const fakeModel = (): Model => ({ update() {}, step: () => [], resync() {}, size: () => 0 });
const createIntegrator = vi.fn(() => fakeModel());
vi.mock('../../app/src/motion/integrator', () => ({ createIntegrator: (...args: unknown[]) => createIntegrator(...(args as [])) }));

type Listener = (event: Record<string, unknown>) => void;
class FakeMap {
  static instances: FakeMap[] = [];
  readonly sources = new Map<string, { data: unknown; setData: ReturnType<typeof vi.fn>; promoteId?: string }>();
  readonly layers: { layer: Record<string, unknown>; before?: string }[] = [];
  readonly paint: [string, string, unknown][] = [];
  readonly zoomRanges: [string, number, number][] = [];
  readonly controls: { control: unknown; position?: string }[] = [];
  private readonly once_ = new Map<string, Listener[]>();
  private readonly canvas = document.createElement('canvas');
  constructor(public readonly options: Record<string, unknown>) {
    FakeMap.instances.push(this);
    (options.container as HTMLElement).appendChild(this.canvas);
  }
  on(): void {}
  once(type: string, fn: Listener): void { this.once_.set(type, [...(this.once_.get(type) ?? []), fn]); }
  fire(type: string): void { for (const fn of this.once_.get(type) ?? []) fn({ type }); this.once_.delete(type); }
  addControl(control: unknown, position?: string): void { this.controls.push({ control, position }); }
  removeControl(control: unknown): void { const i = this.controls.findIndex((c) => c.control === control); if (i >= 0) this.controls.splice(i, 1); }
  getCanvas(): HTMLCanvasElement { return this.canvas; }
  addImage(): void {}
  hasImage(): boolean { return false; }
  addSource(id: string, spec: { data: unknown; promoteId?: string }): void { this.sources.set(id, { data: spec.data, setData: vi.fn(), promoteId: spec.promoteId }); }
  getSource(id: string) { return this.sources.get(id); }
  addLayer(layer: Record<string, unknown>, before?: string): void { this.layers.push({ layer, before }); }
  getLayer(id: string): unknown { return this.layers.find((l) => l.layer.id === id)?.layer; }
  setPaintProperty(id: string, key: string, value: unknown): void { this.paint.push([id, key, value]); }
  setLayerZoomRange(id: string, min: number, max: number): void { this.zoomRanges.push([id, min, max]); }
  readonly setFeatureState = vi.fn<(feature: { source: string; id: string }, state: Record<string, unknown>) => void>();
  setLayoutProperty(): void {}
  setFilter(): void {}
  setSprite(): void {}
  queryRenderedFeatures(): [] { return []; }
  project(lonLat: [number, number]): { x: number; y: number } { return { x: lonLat[0] * 10, y: lonLat[1] * 10 }; }
  easeTo(): void {}
  jumpTo(): void {}
  fitBounds(): void {}
  getCenter() { return { lng: 15.98, lat: 45.815 }; }
  getZoom(): number { return 13; }
  isSourceLoaded(): boolean { return true; }
  resize(): void {}
  remove(): void {}
}
class FakeControl { constructor(public readonly options: Record<string, unknown> = {}) {} }
const lib = { ...basemap, ...overlays, ...cityLayers, ...nameCensus, ...externalLabels, ...externalFeatures, ...vehicleFeatures, ...mapPointer, Map: FakeMap, AttributionControl: FakeControl, NavigationControl: FakeControl, ScaleControl: FakeControl, GeolocateControl: FakeControl, LngLatBounds: class {} };

const flush = async (): Promise<void> => {
  await vi.dynamicImportSettled();
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
};

async function stage(deps: Partial<CityMapDeps> = {}, extra: Partial<CityMapOptions> = {}) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const handle = createCityMap(
    { container, ariaLabel: 'Karta', points: [], lines: [], reducedMotion: true, loadNetwork: async () => null, ...extra },
    { loadMaplibre: async () => lib as never, raf: () => 0, cancel: () => {}, origin: 'https://zagreb.example', ...deps },
  );
  await flush();
  const map = FakeMap.instances.at(-1)!;
  return { handle, map, container };
}

afterEach(() => {
  FakeMap.instances.length = 0;
  createIntegrator.mockClear();
  document.body.replaceChildren();
});

/** The ids of the v2 living network, which no seam carries any more (V3-1). */
const LIVE_IDS = ['live-network-casing', 'live-network', 'live-stops'];

describe('the default path is untouched', () => {
  it('imports the integrator and builds the model from it when no createModel is given', async () => {
    await stage();
    expect(createIntegrator).toHaveBeenCalledTimes(1);
    expect(createIntegrator).toHaveBeenCalledWith(null);
  });

  it('adds no ghost source or layer, and the overlay layers never include one', async () => {
    const { map } = await stage();
    map.fire('style.load');
    await flush();
    expect(map.sources.size).toBeGreaterThan(5);
    expect(map.sources.has(overlays.SOURCES.ghosts)).toBe(false);
    expect(map.layers.some((l) => l.layer.id === overlays.LAYERS.ghosts)).toBe(false);
    expect(overlays.overlayLayers(basemap.OVERLAY_LIGHT).map((l) => l.id)).not.toContain(overlays.LAYERS.ghosts);
    expect(map.paint.some(([id]) => id === overlays.LAYERS.ghosts)).toBe(false);
  });

  it('carries no live layer, keys the network source by nothing, sets no feature state, adds no stage layer or control, and keeps the pills from 12.5', async () => {
    const { handle, map } = await stage();
    map.fire('style.load');
    await flush();
    expect(map.layers.filter((l) => LIVE_IDS.includes(l.layer.id as string))).toHaveLength(0);
    expect(Object.values(overlays.LAYERS)).not.toContain('live-network');
    expect(map.sources.get(overlays.SOURCES.network)!.promoteId).toBeUndefined();
    expect(map.sources.get(overlays.SOURCES.stops)!.promoteId).toBe('id');
    for (const id of LIVE_IDS) expect(overlays.overlayLayers(basemap.OVERLAY_LIGHT).map((l) => l.id)).not.toContain(id);
    expect(map.layers.filter((l) => (l.layer.id as string).startsWith('snimka-'))).toHaveLength(0);
    // The map's own three controls only (scale, zoom, locate), nothing a page did not ask for.
    expect(map.controls.every((c) => c.control instanceof FakeControl)).toBe(true);
    handle.setTheme!('dark');
    expect(map.setFeatureState).not.toHaveBeenCalled();
    expect(handle.setFeatureState!('snimka-bajs', 'x', { f: 1 })).toBe(false);
    expect(map.setFeatureState).not.toHaveBeenCalled();
    const pills = overlays.overlayLayers(basemap.OVERLAY_LIGHT).find((l) => l.id === overlays.LAYERS.vehicles) as unknown as { minzoom?: number };
    expect(pills.minzoom).toBe(overlays.PILL_ZOOM);
    expect(map.zoomRanges).toEqual([]);
  });
});

describe('CityMapDeps.createModel', () => {
  it('replaces the integrator: the import never happens and the page’s factory gets the network', async () => {
    const net = { paths: [], shapes: [], routes: new Map(), stops: [], graphHash: 'x' } as never;
    const createModel = vi.fn(() => fakeModel());
    await stage({ createModel }, { loadNetwork: async () => net });
    expect(createIntegrator).not.toHaveBeenCalled();
    expect(createModel).toHaveBeenCalledTimes(1);
    expect(createModel).toHaveBeenCalledWith(net);
  });

  it('is handed null when the artefact did not load', async () => {
    const createModel = vi.fn(() => fakeModel());
    await stage({ createModel });
    expect(createModel).toHaveBeenCalledWith(null);
  });
});

describe('CityMapHandle.setGhosts', () => {
  it('asked before the style loads, adds the source and the layer under the vehicle bodies once the style is up', async () => {
    const { handle, map } = await stage();
    handle.setGhosts!([[15.97, 45.81], [Number.NaN, 45.8]]);
    expect(map.sources.has(overlays.SOURCES.ghosts)).toBe(false);
    map.fire('style.load');
    await flush();
    const source = map.sources.get(overlays.SOURCES.ghosts)!;
    expect(source).toBeDefined();
    expect((source.data as { features: unknown[] }).features).toHaveLength(1);
    const added = map.layers.find((l) => l.layer.id === overlays.LAYERS.ghosts)!;
    expect(added.before).toBe(overlays.LAYERS.vehicleBodies);
    expect(added.layer).toEqual(overlays.ghostLayer(basemap.OVERLAY_LIGHT, 1));
    expect(map.layers.filter((l) => l.layer.id === overlays.LAYERS.ghosts)).toHaveLength(1);
    // Under the vehicle dots: the bodies come before the dots in the overlay list.
    const ids = overlays.overlayLayers(basemap.OVERLAY_LIGHT).map((l) => l.id);
    expect(ids.indexOf(overlays.LAYERS.vehicleBodies)).toBeLessThan(ids.indexOf(overlays.LAYERS.vehicleDots));
  });

  it('asked after the style is up, adds once and then only sets the data; setTheme repaints it in the dark palette’s muted ink', async () => {
    const { handle, map } = await stage();
    map.fire('style.load');
    await flush();
    handle.setGhosts!([[15.97, 45.81]]);
    const source = map.sources.get(overlays.SOURCES.ghosts)!;
    expect(source).toBeDefined();
    handle.setGhosts!([[15.98, 45.82], [15.99, 45.83]]);
    handle.setGhosts!([]);
    expect(source.setData).toHaveBeenCalledTimes(2);
    expect((source.setData.mock.calls[0]![0] as { features: unknown[] }).features).toHaveLength(2);
    expect((source.setData.mock.calls[1]![0] as { features: unknown[] }).features).toHaveLength(0);
    expect(map.layers.filter((l) => l.layer.id === overlays.LAYERS.ghosts)).toHaveLength(1);
    handle.setTheme!('dark');
    expect(map.paint).toContainEqual([overlays.LAYERS.ghosts, 'circle-color', basemap.OVERLAY_DARK.stopStroke]);
  });
});

describe('overlays.ts ghost spec (V3-8)', () => {
  it('is one filled disc on its own source at the vehicle dot’s radius, the muted ink at 0.4, no stroke, in both palettes', () => {
    expect(overlays.GHOST_OPACITY).toBe(0.4);
    for (const palette of [basemap.OVERLAY_LIGHT, basemap.OVERLAY_DARK]) {
      const layer = overlays.ghostLayer(palette, 2);
      expect(layer).toEqual({ id: 'ghosts', type: 'circle', source: 'ghosts', paint: { 'circle-radius': overlays.vehicleDotRadius(2), 'circle-color': palette.stopStroke, 'circle-opacity': 0.4, 'circle-stroke-width': 0 } });
      const dots = overlays.overlayLayers(palette, { scale: 2 }).find((l) => l.id === overlays.LAYERS.vehicleDots)!;
      expect(dots.paint!['circle-radius']).toEqual(overlays.vehicleDotRadius(2));
    }
    expect(overlays.vehicleDotRadius(1)).toEqual(['interpolate', ['linear'], ['zoom'], 10, 2, overlays.PILL_ZOOM, 3.2, 16, 4.5]);
    expect(basemap.OVERLAY_LIGHT.stopStroke).not.toBe(basemap.OVERLAY_DARK.stopStroke);
  });
  it('a real vehicle stands off its ghost: the 0.4 blend over each canvas keeps at least 3:1 under the tram and the bus inks', () => {
    const srgb = (hex: string): number[] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const blend = (ink: string, canvas: string, alpha: number): string => {
      const a = srgb(ink);
      const b = srgb(canvas);
      return `#${a.map((c, i) => Math.round(c * alpha + b[i]! * (1 - alpha)).toString(16).padStart(2, '0')).join('')}`;
    };
    for (const p of [basemap.OVERLAY_LIGHT, basemap.OVERLAY_DARK]) {
      const ghost = blend(p.stopStroke, p.stopFill, overlays.GHOST_OPACITY);
      expect(contrastRatio(ghost, p.routeTram)).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(ghost, p.routeBus)).toBeGreaterThanOrEqual(3);
    }
  });
  it('ghostsToGeoJson keeps finite points only', () => {
    const fc = overlays.ghostsToGeoJson([[15.9, 45.8], [Infinity, 45.8], [15.9, Number.NaN]]);
    expect(fc.features).toEqual([{ type: 'Feature', geometry: { type: 'Point', coordinates: [15.9, 45.8] }, properties: {} }]);
  });
});

describe('the glyph mode (V3-10)', () => {
  it('pillZoomFor: never under dots, always under pills, the surface’s own otherwise', () => {
    expect(overlays.PILLS_NEVER_ZOOM).toBe(24);
    expect(overlays.pillZoomFor('dots', { markZoom: 11 })).toBe(24);
    expect(overlays.pillZoomFor('pills', { markZoom: 11 })).toBe(0);
    expect(overlays.pillZoomFor(null, { markZoom: 11 })).toBe(11);
    expect(overlays.pillZoomFor(undefined, null)).toBe(overlays.PILL_ZOOM);
  });
  it('the layer list draws the pills and the two-way noses from the mode’s zoom; the dots stay at every zoom', () => {
    const of = (mode: overlays.GlyphMode | null) => overlays.overlayLayers(basemap.OVERLAY_LIGHT, { glyphMode: mode });
    const minzoom = (layers: ReturnType<typeof of>, id: string): number | undefined => (layers.find((l) => l.id === id) as unknown as { minzoom?: number }).minzoom;
    expect(minzoom(of('dots'), overlays.LAYERS.vehicles)).toBe(24);
    expect(minzoom(of('dots'), overlays.LAYERS.vehicleTwoWayFore)).toBe(24);
    expect(minzoom(of('pills'), overlays.LAYERS.vehicles)).toBeUndefined();
    expect(minzoom(of(null), overlays.LAYERS.vehicles)).toBe(overlays.PILL_ZOOM);
    expect(minzoom(of('dots'), overlays.LAYERS.vehicleDots)).toBeUndefined();
  });
  it('setGlyphMode moves the pill layers’ zoom range on the live map and back', async () => {
    const { handle, map } = await stage();
    map.fire('style.load');
    await flush();
    handle.setGlyphMode!('dots');
    expect(map.zoomRanges).toContainEqual([overlays.LAYERS.vehicles, 24, 24]);
    map.zoomRanges.length = 0;
    handle.setGlyphMode!('dots');
    expect(map.zoomRanges).toEqual([]);
    handle.setGlyphMode!('pills');
    expect(map.zoomRanges).toContainEqual([overlays.LAYERS.vehicles, 0, 24]);
    handle.setGlyphMode!(null);
    expect(map.zoomRanges).toContainEqual([overlays.LAYERS.vehicles, overlays.PILL_ZOOM, 24]);
  });
});

describe('CityMapHandle.addStageLayer and setFeatureState (V3-9)', () => {
  const spec = (): StageLayerSpec => ({
    source: 'snimka-bajs',
    promoteId: 'id',
    data: { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [15.9, 45.8] }, properties: { id: 'bajs:1' } }] },
    layer: (p, scale) => ({ id: 'snimka-bajs', type: 'circle', source: 'snimka-bajs', paint: { 'circle-color': p.bikeDisc, 'circle-radius': 4 * scale } }),
    pick: 'place',
  });
  it('asked before the style loads, adds the keyed source and the layer under the vehicle dots once; feature state waits for it', async () => {
    const { handle, map } = await stage();
    handle.addStageLayer!(spec());
    expect(handle.setFeatureState!('snimka-bajs', 'bajs:1', { f: 0.5 })).toBe(false);
    map.fire('style.load');
    await flush();
    expect(map.sources.get('snimka-bajs')!.promoteId).toBe('id');
    const added = map.layers.filter((l) => l.layer.id === 'snimka-bajs');
    expect(added).toHaveLength(1);
    expect(added[0]!.before).toBe(overlays.LAYERS.vehicleDots);
    expect(added[0]!.layer).toEqual(spec().layer(basemap.OVERLAY_LIGHT, 1));
    handle.addStageLayer!(spec());
    expect(map.layers.filter((l) => l.layer.id === 'snimka-bajs')).toHaveLength(1);
    expect(handle.setFeatureState!('snimka-bajs', 'bajs:1', { f: 0.5 })).toBe(true);
    expect(map.setFeatureState).toHaveBeenCalledWith({ source: 'snimka-bajs', id: 'bajs:1' }, { f: 0.5 });
    expect(handle.setFeatureState!('other', 'x', { f: 0.5 })).toBe(false);
    expect(map.setFeatureState).toHaveBeenCalledTimes(1);
  });
  it('a theme flip rebuilds the layer from its builder and applies the paint that changed', async () => {
    const { handle, map } = await stage();
    map.fire('style.load');
    await flush();
    handle.addStageLayer!({ ...spec(), layer: (p) => ({ id: 'snimka-bajs', type: 'circle', source: 'snimka-bajs', paint: { 'circle-color': p.stopStroke } }) });
    map.paint.length = 0;
    handle.setTheme!('dark');
    expect(map.paint).toContainEqual(['snimka-bajs', 'circle-color', basemap.OVERLAY_DARK.stopStroke]);
  });
});

describe('CityMapHandle.addControl and project', () => {
  it('a control asked for before the map exists goes on once it is built; the remover takes it off; project reads the camera', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const control: MapControl = { onAdd: () => document.createElement('div'), onRemove: () => {} };
    const handle = createCityMap({ container, ariaLabel: 'Karta', points: [], lines: [], reducedMotion: true, loadNetwork: async () => null }, { loadMaplibre: async () => lib as never, raf: () => 0, cancel: () => {}, origin: 'https://zagreb.example' });
    expect(handle.project!([15.98, 45.815])).toBeNull();
    const remove = handle.addControl!(control, 'top-right');
    await flush();
    const map = FakeMap.instances.at(-1)!;
    expect(map.controls).toContainEqual({ control, position: 'top-right' });
    expect(handle.project!([15.98, 45.815])).toEqual({ x: 159.8, y: 458.15 });
    remove();
    expect(map.controls.some((c) => c.control === control)).toBe(false);
  });
});

// ---- the pointer's route and place steps (map-pointer.ts) ----------------------------------------------------

function pointer(hits: Record<string, Record<string, unknown>>, host: Partial<PointerHost> = {}) {
  const queried: { layers: string[]; reach: number }[] = [];
  let click: ((event: { point?: { x: number; y: number } }) => void) | null = null;
  const m: PointerMap = {
    on: (type, listener) => { if (type === 'click') click = listener; },
    getCanvas: () => document.createElement('canvas'),
    getZoom: () => 13,
    queryRenderedFeatures: (box, options) => {
      const layers = options?.layers ?? [];
      const b = box as number[][];
      queried.push({ layers, reach: (b[1]![0]! - b[0]![0]!) / 2 });
      const hit = layers.find((id) => hits[id]);
      return hit ? [{ properties: hits[hit]! }] : [];
    },
  };
  const chosen: unknown[] = [];
  bindCityMapPointer(m, { LAYERS: overlays.LAYERS }, {
    container: document.createElement('div'),
    styled: () => true,
    hitTolerance: () => 8,
    closuresVisible: () => true,
    basemap: () => [],
    siblingPlatforms: () => undefined,
    drawn: () => [],
    fitCoordinates: () => {},
    selection: () => null,
    choose: (next) => { chosen.push(next); },
    ...host,
  });
  click!({ point: { x: 10, y: 10 } });
  return { queried, chosen };
}

describe('map-pointer.ts pickRoutes and pickPlaceLayers', () => {
  const routeLayers: string[] = [overlays.LAYERS.networkSelected, overlays.LAYERS.networkTram, overlays.LAYERS.networkBus];
  it('without the option a tap never asks the line layers and the pick order is what it was, at the surface’s tolerance', () => {
    const { queried, chosen } = pointer({ [overlays.LAYERS.networkTram]: { route: '6' } });
    expect(queried.some((q) => q.layers.some((id) => routeLayers.includes(id)))).toBe(false);
    expect(queried.map((q) => q.layers[0])).toEqual([overlays.LAYERS.screenStop, overlays.LAYERS.vehicleSelected, overlays.LAYERS.stopsSelected, overlays.LAYERS.closures]);
    expect(queried.every((q) => q.reach === 8)).toBe(true);
    expect(chosen).toEqual([null]);
  });
  it('with the option the lines are read after the platforms and before the closures, from 12 px, without any live layer, and the tap selects the route', () => {
    const { queried, chosen } = pointer({ [overlays.LAYERS.networkBus]: { route: '228', main: true } }, { pickRoutes: () => true });
    expect(queried.map((q) => q.layers[0])).toEqual([overlays.LAYERS.screenStop, overlays.LAYERS.vehicleSelected, overlays.LAYERS.stopsSelected, overlays.LAYERS.networkSelected]);
    expect(queried[3]!.layers).toEqual(routeLayers);
    expect(queried[3]!.reach).toBe(LINE_HIT_PX);
    expect(LINE_HIT_PX).toBe(12);
    expect(chosen).toEqual([{ kind: 'route', id: '228' }]);
  });
  it('a platform under the tap still wins over the line beneath it', () => {
    const { chosen } = pointer({ [overlays.LAYERS.stops]: { id: '106_1', name: 'Trg' }, [overlays.LAYERS.networkTram]: { route: '6' } }, { pickRoutes: () => true });
    expect(chosen).toEqual([{ kind: 'stop', id: '106_1', ids: undefined }]);
  });
  it('a stage layer picked as places: its feature’s id is the place, read with the city places and before the platforms', () => {
    const { queried, chosen } = pointer({ 'snimka-bajs': { id: 'bajs:bajs-7' }, [overlays.LAYERS.stops]: { id: '106_1', name: 'Trg' } }, { pickPlaceLayers: () => ['snimka-bajs'] });
    expect(queried.some((q) => q.layers.includes('snimka-bajs'))).toBe(true);
    expect(chosen).toEqual([{ kind: 'place', id: 'bajs:bajs-7' }]);
  });
});
