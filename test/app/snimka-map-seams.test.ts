// @vitest-environment happy-dom
// The seams /snimka/ adds to the city map (app/src/map/city-map.ts,
// overlays.ts, map-pointer.ts): CityMapDeps.createModel replaces the
// integrator import, CityMapHandle.setGhosts adds one hollow-ring source and
// layer under the vehicle marks, CityMapOptions.liveNetwork adds the three
// live layers whose state setLiveNetwork sets per feature, and pickRoutes
// lets a tap pick a drawn line. Without any of them the map imports the
// integrator as it always did, adds nothing new to the style, sets no
// feature state and picks exactly what it picked.
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
import { bindCityMapPointer, type PointerHost, type PointerMap } from '../../app/src/map/map-pointer';
import type { Model } from '../../app/src/motion/integrator';

const fakeModel = (): Model => ({ update() {}, step: () => [], resync() {}, size: () => 0 });
const createIntegrator = vi.fn(() => fakeModel());
vi.mock('../../app/src/motion/integrator', () => ({ createIntegrator: (...args: unknown[]) => createIntegrator(...(args as [])) }));

type Listener = (event: Record<string, unknown>) => void;
class FakeMap {
  static instances: FakeMap[] = [];
  readonly sources = new Map<string, { data: unknown; setData: ReturnType<typeof vi.fn>; promoteId?: string }>();
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
  addSource(id: string, spec: { data: unknown; promoteId?: string }): void { this.sources.set(id, { data: spec.data, setData: vi.fn(), promoteId: spec.promoteId }); }
  getSource(id: string) { return this.sources.get(id); }
  addLayer(layer: Record<string, unknown>, before?: string): void { this.layers.push({ layer, before }); }
  getLayer(id: string): unknown { return this.layers.find((l) => l.layer.id === id)?.layer; }
  setPaintProperty(id: string, key: string, value: unknown): void { this.paint.push([id, key, value]); }
  readonly setFeatureState = vi.fn<(feature: { source: string; id: string }, state: Record<string, unknown>) => void>();
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

  it('adds no live layer, keys the network source by nothing, sets no feature state, and the overlay layers never include a live one', async () => {
    const { handle, map } = await stage();
    map.fire('style.load');
    await flush();
    const live: string[] = [overlays.LAYERS.liveNetworkCasing, overlays.LAYERS.liveNetwork, overlays.LAYERS.liveStops];
    expect(map.layers.filter((l) => live.includes(l.layer.id as string))).toHaveLength(0);
    expect(map.sources.get(overlays.SOURCES.network)!.promoteId).toBeUndefined();
    expect(map.sources.get(overlays.SOURCES.stops)!.promoteId).toBe('id');
    for (const id of live) expect(overlays.overlayLayers(basemap.OVERLAY_LIGHT).map((l) => l.id)).not.toContain(id);
    handle.setLiveNetwork!({ alive: new Set(['6']), dead: new Set(), stopsAlive: new Set(['106_1']) });
    handle.setTheme!('dark');
    expect(map.setFeatureState).not.toHaveBeenCalled();
    expect(map.paint.some(([id]) => live.includes(id))).toBe(false);
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
    expect(map.paint).toContainEqual([overlays.LAYERS.ghosts, 'circle-stroke-color', basemap.OVERLAY_DARK.rail]);
    expect(map.paint).toContainEqual([overlays.LAYERS.ghosts, 'circle-radius', overlays.GHOST_RADIUS_PX]);
  });
});

describe('overlays.ts ghost spec', () => {
  it('is one hollow ring on its own source, in the rail grey of both palettes: r 4.5 at scale 1, no fill, stroke 1.5 (S-17)', () => {
    expect(overlays.GHOST_RADIUS_PX).toBe(4.5);
    for (const palette of [basemap.OVERLAY_LIGHT, basemap.OVERLAY_DARK]) {
      const layer = overlays.ghostLayer(palette, 2);
      expect(layer).toEqual({ id: 'ghosts', type: 'circle', source: 'ghosts', paint: { 'circle-radius': 9, 'circle-color': palette.rail, 'circle-opacity': 0, 'circle-stroke-color': palette.rail, 'circle-stroke-width': 1.5 } });
    }
    expect(basemap.OVERLAY_LIGHT.rail).not.toBe(basemap.OVERLAY_DARK.rail);
  });
  it('ghostsToGeoJson keeps finite points only', () => {
    const fc = overlays.ghostsToGeoJson([[15.9, 45.8], [Infinity, 45.8], [15.9, Number.NaN]]);
    expect(fc.features).toEqual([{ type: 'Feature', geometry: { type: 'Point', coordinates: [15.9, 45.8] }, properties: {} }]);
  });
});

// ---- the living network (plan section 3.3, decision S-16) -------------------------------------------------

/** A three-route network: 6 (tram, main shapes 0 and 1), 228 (bus, main shape 2), 17 (tram, shape 3 main, 4 a depot run). */
const liveNet = {
  version: 3, feedVersion: '000396', graphHash: 'live',
  routes: new Map([
    ['6', { short: '6', type: 0, rank: 1, shapes: [0, 1], main: [0, 1] }],
    ['228', { short: '228', type: 3, rank: 2, shapes: [2], main: [2] }],
    ['17', { short: '17', type: 0, rank: 3, shapes: [3, 4], main: [3] }],
  ]),
  shapes: [0, 1, 2, 3, 4].map((i) => ({ id: `s${i}`, route: i < 2 ? '6' : i === 2 ? '228' : '17', pts: [{ x: 0, y: i }, { x: 100, y: i }], cum: [0, 100], len: 100, direction: 0 })),
  stops: [], paths: [], edges: [], diagram: { lines: [], box: [0, 0] },
} as never;

describe('CityMapOptions.liveNetwork', () => {
  it('keys the network source by sid and adds the three layers once: the lines before the selected casing, the stops before the rings', async () => {
    const { map } = await stage({}, { liveNetwork: true });
    map.fire('style.load');
    await flush();
    expect(map.sources.get(overlays.SOURCES.network)!.promoteId).toBe('sid');
    const ids = map.layers.map((l) => l.layer.id);
    expect(ids.filter((id) => id === overlays.LAYERS.liveNetwork)).toHaveLength(1);
    for (const id of [overlays.LAYERS.liveNetworkCasing, overlays.LAYERS.liveNetwork]) expect(map.layers.find((l) => l.layer.id === id)!.before).toBe(overlays.LAYERS.networkSelectedCasing);
    expect(map.layers.find((l) => l.layer.id === overlays.LAYERS.liveStops)!.before).toBe(overlays.LAYERS.stops);
    expect(map.layers.find((l) => l.layer.id === overlays.LAYERS.liveNetwork)!.layer).toEqual(overlays.liveNetworkLayers(basemap.OVERLAY_LIGHT, 1)[1]);
  });

  it('setLiveNetwork sets feature state per main shape and stop, only for what changed, and null clears it', async () => {
    const { handle, map } = await stage({}, { liveNetwork: true, loadNetwork: async () => liveNet });
    map.fire('style.load');
    await flush();
    handle.setLiveNetwork!({ alive: new Set(['6']), dead: new Set(['228']), stopsAlive: new Set(['106_1', '106_2']) });
    const calls = (): [string, string, Record<string, unknown>][] => map.setFeatureState.mock.calls.map(([f, st]) => [f.source, f.id, st]);
    expect(calls()).toEqual(expect.arrayContaining([
      ['network', '0', { alive: true, dead: false }], ['network', '1', { alive: true, dead: false }], ['network', '2', { alive: false, dead: true }],
      ['stops', '106_1', { alive: true }], ['stops', '106_2', { alive: true }],
    ]));
    // Route 17 is quiet and shape 4 is a depot run: neither gets a call.
    expect(calls().some(([, id]) => id === '3' || id === '4')).toBe(false);
    expect(calls()).toHaveLength(5);
    map.setFeatureState.mockClear();
    // The same state again: nothing to say.
    handle.setLiveNetwork!({ alive: new Set(['6']), dead: new Set(['228']), stopsAlive: new Set(['106_1', '106_2']) });
    expect(map.setFeatureState).not.toHaveBeenCalled();
    // 228 lights, 6 goes quiet, one stop leaves: four calls, one per change.
    handle.setLiveNetwork!({ alive: new Set(['228']), dead: new Set(), stopsAlive: new Set(['106_2']) });
    expect(calls()).toEqual(expect.arrayContaining([['network', '0', { alive: false, dead: false }], ['network', '1', { alive: false, dead: false }], ['network', '2', { alive: true, dead: false }], ['stops', '106_1', { alive: false }]]));
    expect(calls()).toHaveLength(4);
    map.setFeatureState.mockClear();
    handle.setLiveNetwork!(null);
    expect(calls()).toEqual(expect.arrayContaining([['network', '2', { alive: false, dead: false }], ['stops', '106_2', { alive: false }]]));
    expect(calls()).toHaveLength(2);
  });

  it('a state handed in before the style loads is applied once the style and the artefact are up; a theme flip repaints the live layers', async () => {
    const { handle, map } = await stage({}, { liveNetwork: true, loadNetwork: async () => liveNet });
    handle.setLiveNetwork!({ alive: new Set(['17']), dead: new Set(), stopsAlive: new Set() });
    expect(map.setFeatureState).not.toHaveBeenCalled();
    map.fire('style.load');
    await flush();
    expect(map.setFeatureState).toHaveBeenCalledWith({ source: 'network', id: '3' }, { alive: true, dead: false });
    map.paint.length = 0;
    handle.setTheme!('dark');
    const dark = overlays.liveStopsLayer(basemap.OVERLAY_DARK, 1).paint!['circle-color'];
    expect(map.paint).toContainEqual([overlays.LAYERS.liveStops, 'circle-color', dark]);
    expect(map.paint.some(([id]) => id === overlays.LAYERS.liveNetwork)).toBe(true);
  });
});

describe('overlays.ts live layer specs', () => {
  it('draw main shapes only, read feature state for alive and dead, colour trams from the ZET table and buses at 0.7 width', () => {
    const [casing, line] = overlays.liveNetworkLayers(basemap.OVERLAY_LIGHT, 1) as unknown as [Record<string, never>, Record<string, never>];
    expect(casing.filter).toEqual(['==', ['get', 'main'], true]);
    expect(line.filter).toEqual(['==', ['get', 'main'], true]);
    expect(casing.paint['line-color']).toBe(basemap.OVERLAY_LIGHT.selectionHalo);
    expect(casing.paint['line-opacity']).toEqual(['case', ['boolean', ['feature-state', 'alive'], false], 1, 0]);
    expect(casing.paint['line-opacity-transition']).toEqual(overlays.LIT_FADE);
    expect(JSON.stringify(line.paint['line-color'])).toContain('"17","#ef7c00"');
    expect(JSON.stringify(line.paint['line-color'])).toContain(basemap.OVERLAY_LIGHT.routeBus);
    expect(JSON.stringify(line.paint['line-width'])).toContain(`"bus",${overlays.LIVE_BUS_WIDTH}`);
    expect(line.paint['line-opacity']).toEqual(['case', ['boolean', ['feature-state', 'alive'], false], 1, ['boolean', ['feature-state', 'dead'], false], overlays.LIVE_DEAD_OPACITY, 0]);
    const stops = overlays.liveStopsLayer(basemap.OVERLAY_DARK, 2) as unknown as Record<string, never>;
    expect(stops.source).toBe(overlays.SOURCES.stops);
    expect(stops.minzoom).toBe(overlays.LIVE_STOPS_MIN_ZOOM);
    expect(stops.paint['circle-radius']).toEqual(['interpolate', ['linear'], ['zoom'], 12, 4.4, 16, 10]);
    expect(stops.paint['circle-opacity']).toEqual(['case', ['boolean', ['feature-state', 'alive'], false], 1, 0]);
  });
});

// ---- the pointer's route step (map-pointer.ts pickRoutes) ----------------------------------------------------

function pointer(pickRoutes: boolean, hits: Record<string, Record<string, unknown>>) {
  const queried: string[][] = [];
  let click: ((event: { point?: { x: number; y: number } }) => void) | null = null;
  const m: PointerMap = {
    on: (type, listener) => { if (type === 'click') click = listener; },
    getCanvas: () => document.createElement('canvas'),
    getZoom: () => 13,
    queryRenderedFeatures: (_box, options) => {
      const layers = options?.layers ?? [];
      queried.push(layers);
      const hit = layers.find((id) => hits[id]);
      return hit ? [{ properties: hits[hit]! }] : [];
    },
  };
  const chosen: unknown[] = [];
  const host: PointerHost = {
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
    ...(pickRoutes ? { pickRoutes: () => true } : {}),
  };
  bindCityMapPointer(m, { LAYERS: overlays.LAYERS }, host);
  click!({ point: { x: 10, y: 10 } });
  return { queried, chosen };
}

describe('map-pointer.ts pickRoutes', () => {
  const routeLayers: string[] = [overlays.LAYERS.networkSelected, overlays.LAYERS.liveNetwork, overlays.LAYERS.networkTram, overlays.LAYERS.networkBus];
  it('without the option a tap never asks the line layers and the pick order is what it was', () => {
    const { queried, chosen } = pointer(false, { [overlays.LAYERS.liveNetwork]: { route: '228' } });
    expect(queried.some((layers) => layers.some((id) => routeLayers.includes(id)))).toBe(false);
    expect(queried.map((l) => l[0])).toEqual([overlays.LAYERS.screenStop, overlays.LAYERS.vehicleSelected, overlays.LAYERS.stopsSelected, overlays.LAYERS.closures]);
    expect(chosen).toEqual([null]);
  });
  it('with the option the lines are read after the platforms and before the closures, and the tap selects the route', () => {
    const { queried, chosen } = pointer(true, { [overlays.LAYERS.liveNetwork]: { route: '228', main: true } });
    expect(queried.map((l) => l[0])).toEqual([overlays.LAYERS.screenStop, overlays.LAYERS.vehicleSelected, overlays.LAYERS.stopsSelected, overlays.LAYERS.networkSelected]);
    expect(queried[3]).toEqual(routeLayers);
    expect(chosen).toEqual([{ kind: 'route', id: '228' }]);
  });
  it('a platform under the tap still wins over the line beneath it', () => {
    const { chosen } = pointer(true, { [overlays.LAYERS.stops]: { id: '106_1', name: 'Trg' }, [overlays.LAYERS.networkTram]: { route: '6' } });
    expect(chosen).toEqual([{ kind: 'stop', id: '106_1', ids: undefined }]);
  });
});
