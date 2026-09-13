// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as basemap from '../../app/src/map/basemap';
import { createCityMap, documentTheme, stopsToGeoJson, vehiclesToGeoJson, withNetwork, withTimers, SOURCE_UPDATE_HZ, type MapFactory, type MapLine, type MapPoint, type MapSelection, type MapStatus } from '../../app/src/map/city-map';
import * as overlays from '../../app/src/map/overlays';
import { toPlane } from '../../app/src/motion/geo';
import type { Drawn } from '../../app/src/motion/model';
import { decodeNetwork } from '../../app/src/motion/network';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// --- A MapLibre stand-in: records what the wrapper hands it, fires events on demand.
interface FakeSource { type: string; data: unknown; calls: unknown[]; setData(d: unknown): void }
interface FakeImage { width: number; height: number; data: Uint8ClampedArray }
type Listener = (event: Record<string, unknown>) => void;
class FakeMap {
  static instances: FakeMap[] = [];
  static failConstruction = false;
  readonly sources = new Map<string, FakeSource>();
  /** Every layer in the order MapLibre would hold it: the style's, then addLayer's honouring beforeId. */
  readonly layers: { id: string; type: string; [k: string]: unknown }[] = [];
  readonly images = new Map<string, { image: FakeImage; options: Record<string, unknown> }>();
  readonly controls: unknown[] = [];
  readonly paint: Record<string, Record<string, unknown>> = {};
  readonly layout: Record<string, Record<string, unknown>> = {};
  readonly filters: Record<string, unknown> = {};
  readonly cameraCalls: { kind: string; options: Record<string, unknown> }[] = [];
  center = { lng: 15.98, lat: 45.815 };
  zoom = 12.6;
  sprite: string | null = null;
  removed = false;
  rendered: { layer: { id: string }; properties: Record<string, unknown> }[] = [];
  readonly canvas: HTMLCanvasElement;
  private readonly handlers: Record<string, Listener[]> = {};
  constructor(public readonly options: Record<string, unknown>) {
    if (FakeMap.failConstruction) throw new Error('Failed to initialize WebGL.');
    FakeMap.instances.push(this);
    const style = options.style as { layers: { id: string; type: string }[] };
    for (const layer of style.layers) this.layers.push({ ...layer });
    const container = options.container as HTMLElement;
    container.classList.add('maplibregl-map');
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'maplibregl-canvas';
    this.canvas.setAttribute('tabindex', '0');
    this.canvas.setAttribute('aria-label', 'Map');
    this.canvas.setAttribute('role', 'region');
    const canvasContainer = document.createElement('div');
    canvasContainer.className = 'maplibregl-canvas-container';
    canvasContainer.appendChild(this.canvas);
    container.appendChild(canvasContainer);
    this.center = { lng: (options.center as number[])[0]!, lat: (options.center as number[])[1]! };
    this.zoom = options.zoom as number;
  }
  on(type: string, a: unknown, b?: unknown): void { (this.handlers[type] ??= []).push((typeof a === 'function' ? a : b) as Listener); }
  once(type: string, cb: Listener): void { this.on(type, cb); }
  fire(type: string, event: Record<string, unknown> = {}): void { for (const cb of [...(this.handlers[type] ?? [])]) cb(event); }
  addControl(control: unknown): void { this.controls.push(control); }
  getCanvas(): HTMLCanvasElement { return this.canvas; }
  addImage(id: string, image: FakeImage, options: Record<string, unknown>): void { this.images.set(id, { image, options }); }
  hasImage(id: string): boolean { return this.images.has(id); }
  addSource(id: string, spec: { type: string; data: unknown }): void {
    const calls: unknown[] = [];
    this.sources.set(id, { type: spec.type, data: spec.data, calls, setData: (d) => { calls.push(d); } });
  }
  getSource(id: string): FakeSource | undefined { return this.sources.get(id); }
  addLayer(layer: { id: string; type: string }, beforeId?: string): void {
    const at = beforeId ? this.layers.findIndex((l) => l.id === beforeId) : -1;
    if (at === -1) this.layers.push({ ...layer });
    else this.layers.splice(at, 0, { ...layer });
  }
  setPaintProperty(id: string, key: string, value: unknown): void { (this.paint[id] ??= {})[key] = value; }
  setLayoutProperty(id: string, key: string, value: unknown): void { (this.layout[id] ??= {})[key] = value; }
  setFilter(id: string, filter: unknown): void { this.filters[id] = filter; }
  setSprite(url: string): void { this.sprite = url; }
  queryRenderedFeatures(_geometry: unknown, options?: { layers?: string[] }) { return this.rendered.filter((f) => !options?.layers || options.layers.includes(f.layer.id)); }
  easeTo(options: Record<string, unknown>): void { this.cameraCalls.push({ kind: 'easeTo', options }); this.apply(options); }
  jumpTo(options: Record<string, unknown>): void { this.cameraCalls.push({ kind: 'jumpTo', options }); this.apply(options); }
  fitBounds(bounds: unknown, options: Record<string, unknown> = {}): void { this.cameraCalls.push({ kind: 'fitBounds', options: { ...options, bounds } }); }
  private apply(o: Record<string, unknown>): void {
    if (Array.isArray(o.center)) this.center = { lng: o.center[0] as number, lat: o.center[1] as number };
    if (typeof o.zoom === 'number') this.zoom = o.zoom;
  }
  getCenter() { return this.center; }
  getZoom(): number { return this.zoom; }
  remove(): void { this.removed = true; }
}
class FakeControl { constructor(public readonly options: Record<string, unknown> = {}) {} }
const lib = { ...basemap, ...overlays, Map: FakeMap, AttributionControl: FakeControl, NavigationControl: FakeControl, ScaleControl: FakeControl, LngLatBounds: class {} };

const T0 = Date.parse('2026-09-12T10:00:00Z');
const FRAME_MS = 1000 / 60;
/** Degrees of longitude per metre at 45.8 N. */
const M_TO_LON = 1 / (111_320 * Math.cos((45.8 * Math.PI) / 180));
const A: MapPoint = { id: 'vehicle:1', lon: 15.97, lat: 45.81, title: '6', routeId: '6', at: T0 - 30_000, type: 0 };
/** The same vehicle reported 100 m east, thirty seconds later. */
const B: MapPoint = { ...A, lon: 15.97 + 100 * M_TO_LON, at: T0 + 50 };
const QUAKE: MapPoint = { id: 'q1', lon: 14.36, lat: 45.45, title: 'M 1.6' };
const CLOSURE: MapLine = { id: 'c1', title: 'Grada Vukovara', coordinates: [[15.959, 45.799], [15.957, 45.799]] };
const NET = decodeNetwork(JSON.parse(readFileSync(resolve(import.meta.dirname, '../../app/public/data/zet-network.json'), 'utf8')));

const flush = async (): Promise<void> => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
/** A layer's live filter: what setFilter last set, else what it was added with. */
const filterOf = (map: FakeMap, id: string): unknown => map.filters[id] ?? map.layers.find((l) => l.id === id)?.filter;
type FC = { features: { geometry: { coordinates: [number, number] }; properties: Record<string, unknown> }[] };
const metres = (fc: unknown, id: string, to: MapPoint): number => {
  const f = (fc as FC).features.find((x) => x.properties.id === id);
  if (!f) return Number.NaN;
  const p = toPlane(f.geometry.coordinates[0], f.geometry.coordinates[1]);
  const q = toPlane(to.lon, to.lat);
  return Math.hypot(p.x - q.x, p.y - q.y);
};

interface HarnessOptions {
  points?: MapPoint[];
  lines?: MapLine[];
  reducedMotion?: boolean;
  loadNetwork?: () => Promise<typeof NET | null>;
  extra?: Record<string, unknown>;
  load?: boolean;
}

async function harness(opts: HarnessOptions = {}) {
  let t = T0;
  const queue = new Map<number, (ts: number) => void>();
  let nextHandle = 0;
  const timers: { fn: () => void; ms: number; cleared: boolean }[] = [];
  const container = document.createElement('div');
  document.body.appendChild(container);
  const loadNetwork = opts.loadNetwork ?? vi.fn(async () => null);
  const selections: (MapSelection | null)[] = [];
  const statuses: MapStatus[] = [];
  const handle = createCityMap(
    {
      container,
      ariaLabel: 'Karta',
      points: opts.points ?? [A],
      lines: opts.lines ?? [CLOSURE],
      reducedMotion: opts.reducedMotion,
      loadNetwork,
      setTimer: (fn, ms) => { const timer = { fn, ms, cleared: false }; timers.push(timer); return timer; },
      clearTimer: (h) => { (h as { cleared: boolean }).cleared = true; },
      onSelect: (s) => { selections.push(s); },
      onStatus: (s) => { statuses.push(s); },
      ...(opts.extra ?? {}),
    },
    {
      loadMaplibre: async () => lib as never,
      raf: (cb) => { queue.set(++nextHandle, cb); return nextHandle; },
      cancel: (h) => { queue.delete(h); },
      now: () => t,
      origin: 'https://zagreb.example',
    },
  );
  await flush();
  const map = FakeMap.instances[FakeMap.instances.length - 1]!;
  if (opts.load !== false) map.fire('load');
  const frame = (dt = FRAME_MS): void => { t += dt; const due = [...queue.values()]; queue.clear(); for (const cb of due) cb(t); };
  const tickTimers = (): void => { for (const timer of [...timers]) if (!timer.cleared) timer.fn(); };
  const vehicles = (): FakeSource => map.getSource('vehicles')!;
  const pending = (): number => queue.size;
  return { handle, map, container, frame, vehicles, loadNetwork, pending, timers, tickTimers, selections, statuses, clock: () => t };
}

afterEach(() => { FakeMap.instances.length = 0; FakeMap.failConstruction = false; document.body.replaceChildren(); document.documentElement.removeAttribute('data-theme-resolved'); });

describe('the full map draws the model, never the report (R-P2)', () => {
  it('converges onto a new fix over frames instead of jumping: the drawn vehicle is at neither the old nor the new report', async () => {
    const { handle, frame, vehicles } = await harness();
    frame(); frame(); frame();
    handle.update([B], [CLOSURE]);
    const before = vehicles().calls.length;
    for (let i = 0; i < 30; i++) frame();
    const pushed = vehicles().calls.slice(before);
    expect(pushed.length).toBeGreaterThan(1);
    const first = metres(pushed[0], 'vehicle:1', B);
    const last = metres(pushed[pushed.length - 1], 'vehicle:1', B);
    expect(first).toBeGreaterThan(1);
    expect(first).toBeLessThan(100);
    expect(last).toBeLessThan(first);
    expect(metres(pushed[pushed.length - 1], 'vehicle:1', A)).toBeGreaterThan(0.5);
  });

  it('never puts a vehicle report into the places source, and draws a place where it was given', async () => {
    const { map } = await harness({ points: [A, QUAKE] });
    const places = map.getSource('places')!.data as FC;
    expect(places.features.map((f) => f.properties.id)).toEqual(['q1']);
    expect(places.features[0]!.geometry.coordinates).toEqual([14.36, 45.45]);
  });

  it('labels each vehicle with its number, its facing only when the model knows it (decision 5), and its confidence as alpha', () => {
    const drawn: Drawn[] = [
      { id: 'a', type: 0, routeId: '6', short: '6', p: toPlane(15.97, 45.81), heading: { x: 1, y: 0 }, speed: 5, confidence: 1, onShape: null },
      { id: 'b', type: 3, routeId: '109', p: toPlane(15.98, 45.82), heading: null, speed: 0, confidence: 0.2, onShape: null },
      { id: 'c', type: 0, p: toPlane(15.99, 45.83), heading: null, speed: 0, confidence: 0.25, onShape: 0, track: { x: 0, y: -1 }, held: true },
    ];
    const fc = vehiclesToGeoJson(drawn);
    expect(fc.features[0]!.properties).toMatchObject({ kind: 'tram', short: '6', bearing: 90, hasHeading: true, sort: 2 });
    expect(fc.features[1]!.properties).toMatchObject({ kind: 'bus', short: '109', bearing: 0, hasHeading: false, sort: 1 });
    expect(fc.features[1]!.properties.alpha).toBeLessThan(fc.features[0]!.properties.alpha);
    expect(fc.features[2]!.properties).toMatchObject({ short: '', bearing: 180, hasHeading: false, held: true });
  });

  it('vehicles() answers the model\u2019s own estimate for the lists: a position between the reports, and the facing the two fixes east made evident', async () => {
    const { handle, frame } = await harness();
    handle.update([B], [CLOSURE]);
    for (let i = 0; i < 10; i++) frame();
    const [v] = handle.vehicles!();
    expect(v).toMatchObject({ id: 'vehicle:1', routeId: '6', short: '6', kind: 'tram', type: 0, bearing: 90 });
    const toB = Math.hypot(toPlane(v!.lon, v!.lat).x - toPlane(B.lon, B.lat).x, toPlane(v!.lon, v!.lat).y - toPlane(B.lon, B.lat).y);
    expect(toB).toBeGreaterThan(0.5);
    expect(toB).toBeLessThan(100);
  });
});

describe('12 Hz source updates, not one per frame', () => {
  it('pushes the vehicle source about twelve times in a second of sixty moving frames, and counts every frame', async () => {
    const { handle, frame, vehicles, container } = await harness();
    handle.update([B], [CLOSURE]);
    const before = vehicles().calls.length;
    for (let i = 0; i < 60; i++) frame();
    const pushes = vehicles().calls.length - before;
    expect(SOURCE_UPDATE_HZ).toBe(12);
    expect(pushes).toBeGreaterThanOrEqual(11);
    expect(pushes).toBeLessThanOrEqual(13);
    expect(Number(container.dataset.frames)).toBeGreaterThanOrEqual(59);
  });

  it('under reduced motion steps once a second on the injected timer pair, with no frame requests and no global setTimeout (R-F6)', async () => {
    const globalTimer = vi.spyOn(globalThis, 'setTimeout');
    try {
      const { handle, frame, vehicles, pending, timers, tickTimers } = await harness({ reducedMotion: true });
      expect(pending()).toBe(0);
      expect(timers.filter((timer) => !timer.cleared)).toHaveLength(1);
      handle.update([B], [CLOSURE]);
      const before = vehicles().calls.length;
      for (let i = 0; i < 60; i++) frame();
      expect(vehicles().calls.length - before).toBe(0);
      tickTimers();
      expect(vehicles().calls.length - before).toBe(1);
      const armed = timers.filter((timer) => !timer.cleared);
      expect(armed).toHaveLength(1);
      expect(armed[0]!.ms).toBe(1000);
      expect(globalTimer).not.toHaveBeenCalled();
    } finally {
      globalTimer.mockRestore();
    }
  });
});

describe('lifecycle', () => {
  it('pause() withdraws the pending frame and requests none until resume() (R-F6: a frozen dashboard animates nothing)', async () => {
    const { handle, frame, container, pending } = await harness();
    handle.update([B], [CLOSURE]);
    frame();
    expect(pending()).toBe(1);
    handle.pause();
    expect(pending()).toBe(0);
    const pausedAt = container.dataset.frames;
    frame(); frame();
    expect(container.dataset.frames).toBe(pausedAt);
    handle.resume();
    expect(pending()).toBe(1);
    frame(); frame();
    expect(container.dataset.frames).toBe('1');
  });

  it('applies a report that arrived before the library loaded, draws the artefact\u2019s network and stops once, and stops everything on destroy', async () => {
    const { handle, map, container, frame, loadNetwork } = await harness({ points: [], lines: [], loadNetwork: vi.fn(async () => NET), load: false });
    handle.update([QUAKE, A], [CLOSURE]);
    map.fire('load');
    expect((map.getSource('places')!.data as FC).features).toHaveLength(1);
    expect((map.getSource('closures')!.data as FC).features).toHaveLength(1);
    expect((map.getSource('network')!.data as FC).features.length).toBeGreaterThan(100);
    expect((map.getSource('stops')!.data as FC).features.length).toBeGreaterThan(1000);
    expect(loadNetwork).toHaveBeenCalledTimes(1);
    expect(handle.network!()).toBe(NET);
    handle.destroy();
    expect(map.removed).toBe(true);
    const frames = container.dataset.frames;
    frame();
    expect(container.dataset.frames).toBe(frames);
  });
});

describe('the map for people who cannot see it (R-F5), and its credit', () => {
  it('names the container as a region from the first moment, puts role="img" with the same label on the canvas alone (keeping its tab stop), labels the controls in the page\u2019s language and hands MapLibre the linked credit', async () => {
    const container = document.createElement('div');
    container.id = 'u-pokretu-map-slot';
    document.body.appendChild(container);
    const handle = createCityMap(
      { container, ariaLabel: 'Karta: 3 vozila, 1 zatvaranje', points: [], lines: [], loadNetwork: async () => null },
      { loadMaplibre: async () => lib as never, raf: () => 1, cancel: () => {}, now: () => T0 },
    );
    expect(container.getAttribute('role')).toBe('region');
    expect(container.getAttribute('aria-label')).toBe('Karta: 3 vozila, 1 zatvaranje');
    await flush();
    const canvas = container.querySelector<HTMLCanvasElement>('canvas.maplibregl-canvas')!;
    expect(canvas.getAttribute('role')).toBe('img');
    expect(canvas.getAttribute('aria-labelledby')).toBe('u-pokretu-map-slot');
    expect(canvas.hasAttribute('aria-label')).toBe(false);
    expect(canvas.getAttribute('tabindex')).toBe('0');
    const map = FakeMap.instances[0]!;
    const attribution = map.controls.find((c) => (c as FakeControl).options.customAttribution !== undefined) as FakeControl;
    expect(String(attribution.options.customAttribution)).toContain('href="https://www.openstreetmap.org/copyright"');
    expect(String(attribution.options.customAttribution)).toContain('Protomaps');
    expect((map.options.locale as Record<string, string>)['NavigationControl.ZoomIn']).toBe('Približi');
    handle.destroy();
  });

  it('a public screen gets no pointer handling and no zoom buttons, but keeps the credit', async () => {
    const { map } = await harness({ extra: { interactive: false } });
    expect(map.options.interactive).toBe(false);
    expect(map.controls).toHaveLength(2); // attribution and scale
  });

  it('an image the style names but the sprite lacks is answered with one transparent pixel, once, so nothing is logged every frame and nothing is drawn', async () => {
    const { map } = await harness();
    map.fire('styleimagemissing', { id: 'townhall' });
    const image = map.images.get('townhall')!;
    expect(image.image).toMatchObject({ width: 1, height: 1 });
    expect([...image.image.data]).toEqual([0, 0, 0, 0]);
    map.fire('styleimagemissing', { id: 'townhall' });
    expect(map.images.get('townhall')).toBe(image);
    map.fire('styleimagemissing', {});
    expect(map.images.size).toBe(7); // the six overlay images and the one stand-in
  });
});

describe('the basemap and the overlays on it', () => {
  it('builds the same-origin vector style for the document\u2019s theme at the opening zoom, puts the network and closures under the first label layer and everything else on top, one SDF image set, six sources', async () => {
    document.documentElement.setAttribute('data-theme-resolved', 'dark');
    const { map } = await harness();
    const style = map.options.style as { sources: Record<string, { tiles: string[] }>; name: string };
    expect(style.name).toBe('Kaj ima? dark');
    expect(style.sources.basemap!.tiles[0]).toBe('https://zagreb.example/maps/zagreb-v1/{z}/{x}/{y}.mvt');
    expect(map.options).toMatchObject({ minZoom: 10, maxZoom: 18, dragRotate: false, interactive: true, zoom: 13 });
    expect(map.options.zoom as number).toBeGreaterThanOrEqual(overlays.PILL_ZOOM); // numbered pills from the first glance
    const ids = map.layers.map((l) => l.id);
    expect(ids.indexOf('network-tram')).toBeLessThan(ids.indexOf('address_label'));
    expect(ids.indexOf('closures')).toBeLessThan(ids.indexOf('address_label'));
    expect(ids.indexOf('vehicles')).toBeGreaterThan(ids.indexOf('places_locality'));
    expect(ids[ids.length - 1]).toBe('selection-ring');
    expect([...map.images.keys()]).toEqual(['vehicle-pill-1', 'vehicle-pill-2', 'vehicle-pill-3', 'vehicle-pill-4', 'vehicle-nose', 'selection-ring']);
    expect(map.images.get('vehicle-pill-2')!.options).toMatchObject({ sdf: true, pixelRatio: 2 });
    expect([...map.sources.keys()].sort()).toEqual(['closures', 'network', 'places', 'screen-stop', 'stops', 'vehicles']);
  });

  it('flips theme through paint properties and the sprite, never a setStyle, and follows <html data-theme-resolved> live', async () => {
    const { map, handle } = await harness();
    const layersBefore = map.layers.length;
    handle.setTheme!('dark');
    expect(map.paint['background']?.['background-color']).toBe('#151d1c');
    expect(map.paint['vehicles']?.['icon-halo-color']).toBe('#17201f');
    expect(map.sprite).toBe('https://zagreb.example/maps/sprites/dark');
    expect(map.layers).toHaveLength(layersBefore);
    document.documentElement.setAttribute('data-theme-resolved', 'light');
    await new Promise((r) => setTimeout(r, 0));
    expect(map.paint['background']?.['background-color']).toBe('#e9eeec');
    expect(map.sprite).toBe('https://zagreb.example/maps/sprites/light');
  });
});

describe('selection and status', () => {
  it('select() lights exactly the selected thing through filters and fits the camera; a tap picks a vehicle over a stop, a stop over nothing, and reports each', async () => {
    const { map, handle, selections } = await harness({ loadNetwork: async () => NET });
    handle.select!({ kind: 'route', id: '6' }, { fit: true });
    expect(map.filters['network-selected']).toEqual(['==', ['get', 'route'], '6']);
    expect(map.paint['network-tram']?.['line-opacity']).toBe(0.14);
    expect(map.cameraCalls.at(-1)?.kind).toBe('fitBounds');
    map.rendered = [{ layer: { id: 'stops' }, properties: { id: 'S1', name: 'Črnomerec' } }, { layer: { id: 'vehicles' }, properties: { id: 'vehicle:1' } }];
    map.fire('click', { point: { x: 10, y: 10 } });
    expect(selections.at(-1)).toEqual({ kind: 'vehicle', id: 'vehicle:1' });
    expect(map.filters['vehicle-selected']).toEqual(['==', ['get', 'id'], 'vehicle:1']);
    expect(JSON.stringify(map.filters['vehicles'])).toContain('"vehicle:1"');
    map.rendered = [{ layer: { id: 'stops' }, properties: { id: 'S1', name: 'Črnomerec' } }];
    map.fire('click', { point: { x: 10, y: 10 } });
    expect(selections.at(-1)).toMatchObject({ kind: 'stop', id: 'S1' });
    map.rendered = [];
    map.fire('click', { point: { x: 10, y: 10 } });
    expect(selections.at(-1)).toBeNull();
    expect(map.filters['stops-selected']).toEqual(overlays.NEVER);
    expect(map.paint['network-tram']?.['line-opacity']).toEqual(overlays.NETWORK_OPACITY);
  });

  it('a basemap failure before or after load reads tiles-failed while the overlays keep drawing; a tile that loads again reads ready', async () => {
    const { map, statuses, handle } = await harness({ load: false });
    map.fire('error', { sourceId: 'basemap', tile: {}, error: { url: 'https://zagreb.example/maps/zagreb-v1/13/1/1.mvt' } });
    map.fire('load');
    expect(handle.status!()).toBe('tiles-failed');
    expect(map.getSource('vehicles')).toBeDefined();
    expect(map.layers.some((l) => l.id === 'vehicles')).toBe(true);
    map.fire('sourcedata', { sourceId: 'basemap', tile: {} });
    expect(handle.status!()).toBe('ready');
    map.fire('error', { sourceId: 'basemap', tile: {}, error: {} });
    expect(statuses).toEqual(['tiles-failed', 'ready', 'tiles-failed']);
    expect((await harness()).container.dataset.mapStatus).toBe('ready');
  });
});

describe('without WebGL, following, the kiosk view and an outage', () => {
  it('without WebGL the map is unavailable, but the network and the model still serve the lists', async () => {
    FakeMap.failConstruction = true;
    const nets: unknown[] = [];
    const { handle, statuses } = await harness({ loadNetwork: async () => NET, load: false, extra: { onNetwork: (n: unknown) => nets.push(n) } });
    expect(statuses).toEqual(['unavailable']);
    expect(nets).toEqual([NET]);
    expect(handle.vehicles!().map((v) => v.id)).toEqual(['vehicle:1']);
    expect(handle.camera!()).toBeNull();
  });

  it('follow(id) selects and centres the vehicle and glides the camera with every push; a move the person makes ends it, the wrapper\u2019s own moves do not', async () => {
    const moves: unknown[] = [];
    const { map, handle, frame } = await harness({ extra: { onUserMove: (c: unknown) => moves.push(c) } });
    handle.update([B], [CLOSURE]);
    frame();
    handle.follow!('vehicle:1');
    expect(handle.following!()).toBe('vehicle:1');
    expect(handle.selection!()).toEqual({ kind: 'vehicle', id: 'vehicle:1' });
    const eases = map.cameraCalls.length;
    for (let i = 0; i < 12; i++) frame();
    expect(map.cameraCalls.length).toBeGreaterThan(eases);
    map.fire('moveend', {}); // the wrapper's own easeTo
    expect(handle.following!()).toBe('vehicle:1');
    map.fire('moveend', { originalEvent: {} }); // a drag
    expect(handle.following!()).toBeNull();
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({ zoom: expect.any(Number) });
  });

  it('setView takes the kiosk adapter\u2019s shape: centre and zoom, a stop by id with its sibling platforms, a route with follow=true keeping its vehicles in frame; a route id is never a vehicle id', async () => {
    const { map, handle, frame } = await harness({ loadNetwork: async () => NET });
    const platform = NET.stops.find((s) => s.name === 'Črnomerec')!;
    handle.setView!({ center: [15.94, 45.81], zoom: 15, selectedStop: platform.id });
    expect(map.cameraCalls.at(-1)).toMatchObject({ kind: 'easeTo', options: { center: [15.94, 45.81], zoom: 15 } });
    expect(handle.selection!()).toMatchObject({ kind: 'stop', id: platform.id });
    expect(map.filters['stops-selected']).toEqual(['in', ['get', 'id'], ['literal', expect.arrayContaining([platform.id])]]);
    handle.setView!({ selectedRoute: '6', follow: true });
    expect(handle.selection!()).toEqual({ kind: 'route', id: '6' });
    expect(handle.following!()).toBe(true);
    expect(filterOf(map, 'vehicle-selected')).toEqual(overlays.NEVER); // the route, not a vehicle called "6"
    expect(filterOf(map, 'network-selected')).toEqual(['==', ['get', 'route'], '6']);
    handle.update([B], [CLOSURE]);
    const before = map.cameraCalls.length;
    for (let i = 0; i < 6; i++) frame();
    expect(map.cameraCalls.slice(before).some((c) => c.kind === 'fitBounds' || c.kind === 'easeTo')).toBe(true);
  });

  it('a stale or down feed holds every vehicle where it is; live again, the motion resumes', async () => {
    const { handle, frame, pending, container } = await harness();
    handle.update([B], [CLOSURE]);
    frame();
    handle.setFeedState!('stale');
    expect(pending()).toBe(0);
    expect(container.dataset.feed).toBe('stale');
    const heldAt = container.dataset.frames;
    frame(); frame();
    expect(container.dataset.frames).toBe(heldAt);
    handle.setFeedState!('live');
    expect(pending()).toBe(1);
  });
});

describe('selection and status', () => {
  it('a selection reaches the map as filters through one styleDiff: the route lit, its stops marked, the rest dimmed, the camera on it; clearing puts NEVER back', async () => {
    const { map, handle } = await harness({ loadNetwork: async () => NET });
    handle.select!({ kind: 'route', id: '6' }, { fit: true });
    expect(map.filters['network-selected']).toEqual(['==', ['get', 'route'], '6']);
    expect(map.filters['stops-route']).toEqual(['in', '6', ['get', 'routes']]);
    expect(map.paint['network-tram']?.['line-opacity']).toBe(0.14);
    expect(map.cameraCalls.at(-1)?.kind).toBe('fitBounds'); // the route's whole geometry
    expect(handle.selection!()).toEqual({ kind: 'route', id: '6' });
    handle.select!(null);
    expect(map.filters['network-selected']).toEqual(overlays.NEVER);
    expect(map.paint['network-tram']?.['line-opacity']).toEqual(['interpolate', ['linear'], ['zoom'], 10, 0.4, 14, 0.55, 17, 0.7]);
    handle.setModes!(new Set([0]));
    expect(map.layout['network-bus']?.visibility).toBe('none');
    handle.setClosuresVisible!(false);
    expect(map.layout['closures']?.visibility).toBe('none');
  });

  it('a tap picks a vehicle over a stop over a closure, reports it through onSelect, and Escape on the map clears it', async () => {
    const { map, handle, container, selections } = await harness();
    map.rendered = [{ layer: { id: 'stops' }, properties: { id: '1_21', name: 'Kvaternikov trg' } }, { layer: { id: 'vehicles' }, properties: { id: 'vehicle:1' } }];
    map.fire('click', { point: { x: 10, y: 10 } });
    expect(selections).toEqual([{ kind: 'vehicle', id: 'vehicle:1' }]);
    expect(map.filters['vehicle-selected']).toEqual(['==', ['get', 'id'], 'vehicle:1']);
    expect(JSON.stringify(map.filters['vehicles'])).toContain('"vehicle:1"'); // out of the ordinary pill layer, into its own
    map.rendered = [{ layer: { id: 'stops' }, properties: { id: '1_21', name: 'Kvaternikov trg' } }];
    map.fire('click', { point: { x: 10, y: 10 } });
    expect(selections[1]).toMatchObject({ kind: 'stop', id: '1_21' });
    container.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(selections[2]).toBeNull();
    expect(handle.selection!()).toBeNull();
  });
});
