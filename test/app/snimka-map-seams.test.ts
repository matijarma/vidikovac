// @vitest-environment happy-dom
// The two seams /snimka/ adds to the city map (app/src/map/city-map.ts,
// overlays.ts): CityMapDeps.createModel replaces the integrator import, and
// CityMapHandle.setGhosts adds one grey source and layer under the vehicle
// marks. Without either the map imports the integrator as it always did and
// adds nothing new to the style.
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as basemap from '../../app/src/map/basemap';
import * as overlays from '../../app/src/map/overlays';
import * as nameCensus from '../../app/src/map/name-census';
import * as mapPointer from '../../app/src/map/map-pointer';
import * as cityLayers from '../../app/src/map/city-layers';
import * as externalFeatures from '../../app/src/map/external-features';
import * as externalLabels from '../../app/src/map/external-labels';
import * as vehicleFeatures from '../../app/src/map/vehicle-features';
import { createCityMap, type CityMapDeps, type CityMapOptions } from '../../app/src/map/city-map';
import type { Model } from '../../app/src/motion/integrator';

const fakeModel = (): Model => ({ update() {}, step: () => [], resync() {}, size: () => 0 });
const createIntegrator = vi.fn(() => fakeModel());
vi.mock('../../app/src/motion/integrator', () => ({ createIntegrator: (...args: unknown[]) => createIntegrator(...(args as [])) }));

type Listener = (event: Record<string, unknown>) => void;
class FakeMap {
  static instances: FakeMap[] = [];
  readonly sources = new Map<string, { data: unknown; setData: ReturnType<typeof vi.fn> }>();
  readonly layers: { layer: Record<string, unknown>; before?: string }[] = [];
  readonly paint: [string, string, unknown][] = [];
  private readonly once_ = new Map<string, Listener[]>();
  private readonly canvas = document.createElement('canvas');
  constructor(public readonly options: Record<string, unknown>) {
    FakeMap.instances.push(this);
    (options.container as HTMLElement).appendChild(this.canvas);
  }
  on(): void {}
  once(type: string, fn: Listener): void { this.once_.set(type, [...(this.once_.get(type) ?? []), fn]); }
  fire(type: string): void { for (const fn of this.once_.get(type) ?? []) fn({ type }); this.once_.delete(type); }
  addControl(): void {}
  removeControl(): void {}
  getCanvas(): HTMLCanvasElement { return this.canvas; }
  addImage(): void {}
  hasImage(): boolean { return false; }
  addSource(id: string, spec: { data: unknown }): void { this.sources.set(id, { data: spec.data, setData: vi.fn() }); }
  getSource(id: string) { return this.sources.get(id); }
  addLayer(layer: Record<string, unknown>, before?: string): void { this.layers.push({ layer, before }); }
  getLayer(id: string): unknown { return this.layers.find((l) => l.layer.id === id)?.layer; }
  setPaintProperty(id: string, key: string, value: unknown): void { this.paint.push([id, key, value]); }
  setLayoutProperty(): void {}
  setFilter(): void {}
  setSprite(): void {}
  queryRenderedFeatures(): [] { return []; }
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
  });

  it('asked after the style is up, adds once and then only sets the data; setTheme repaints it in the dark palette’s rail grey', async () => {
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
    expect(map.paint).toContainEqual([overlays.LAYERS.ghosts, 'circle-color', basemap.OVERLAY_DARK.rail]);
    expect(map.paint).toContainEqual([overlays.LAYERS.ghosts, 'circle-radius', overlays.GHOST_RADIUS_PX]);
  });
});

describe('overlays.ts ghost spec', () => {
  it('is one circle layer on its own source, in the rail grey of both palettes, 3.5 px at scale 1, opacity 0.7', () => {
    for (const palette of [basemap.OVERLAY_LIGHT, basemap.OVERLAY_DARK]) {
      const layer = overlays.ghostLayer(palette, 2);
      expect(layer).toEqual({ id: 'ghosts', type: 'circle', source: 'ghosts', paint: { 'circle-radius': 7, 'circle-color': palette.rail, 'circle-opacity': 0.7 } });
    }
    expect(basemap.OVERLAY_LIGHT.rail).not.toBe(basemap.OVERLAY_DARK.rail);
  });
  it('ghostsToGeoJson keeps finite points only', () => {
    const fc = overlays.ghostsToGeoJson([[15.9, 45.8], [Infinity, 45.8], [15.9, Number.NaN]]);
    expect(fc.features).toEqual([{ type: 'Feature', geometry: { type: 'Point', coordinates: [15.9, 45.8] }, properties: {} }]);
  });
});
