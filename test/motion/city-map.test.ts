// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as basemap from '../../app/src/map/basemap';
import { CLUSTER_ZOOM_IN_UNTIL, createCityMap, documentTheme, stopsToGeoJson, vehiclesToGeoJson, withNetwork, withTimers, SOURCE_UPDATE_HZ, type MapFactory, type MapLine, type MapPoint, type MapSelection, type MapStatus } from '../../app/src/map/city-map';
import * as overlays from '../../app/src/map/overlays';
import * as cityPlaces from '../../app/src/map/city-layers';
import { PILL_MAX_CHARS_CLUSTER } from '../../app/src/motion/pills';
import { toPlane } from '../../shared/motion/geo';
import type { Drawn } from '../../app/src/motion/integrator';
import { decodeNetwork } from '../../shared/motion/network';
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
  readonly zoomRanges: Record<string, [number, number]> = {};
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
  setLayerZoomRange(id: string, min: number, max: number): void { this.zoomRanges[id] = [min, max]; }
  getLayer(id: string): unknown { return this.layers.find((l) => l.id === id); }
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
  /** A camera stand-in for the pill clustering: ten thousand CSS px per degree
   *  from a fixed origin, so a test can say in pixels how far apart two
   *  vehicles are drawn without a real projection. */
  project([lon, lat]: [number, number]): { x: number; y: number } { return { x: (lon - 15.9) * 1e4, y: (45.9 - lat) * 1e4 }; }
  remove(): void { this.removed = true; }
}
class FakeControl { constructor(public readonly options: Record<string, unknown> = {}) {} }
const lib = { ...basemap, ...overlays, Map: FakeMap, AttributionControl: FakeControl, NavigationControl: FakeControl, ScaleControl: FakeControl, LngLatBounds: class {} };
/** The real entry (maplibre-entry.ts) also re-exports the city-places layers;
 *  the transport tests leave them out so they see the transport style alone,
 *  and the test that is about those layers asks for this one. */
const cityLib = { ...lib, ...cityPlaces };

/** Every SDF image the overlays put on a map, in order: one pill and one plate
 *  for each label length a cluster can take, then the four shared marks. */
const OVERLAY_IMAGE_IDS = [
  ...Array.from({ length: PILL_MAX_CHARS_CLUSTER }, (_, i) => `vehicle-pill-${i + 1}`),
  ...Array.from({ length: PILL_MAX_CHARS_CLUSTER }, (_, i) => `vehicle-plate-${i + 1}`),
  'vehicle-nose', 'selection-ring', 'place-square', 'place-square-ring', 'place-ring',
];

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
  /** The MapLibre entry stand-in; `cityLib` adds the city-places layers. */
  lib?: typeof lib;
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
      loadMaplibre: async () => (opts.lib ?? lib) as never,
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

  it('merges pills that overlap on screen into one cluster mark, leaves a vehicle standing on its own alone, and never absorbs the selected one', () => {
    const tram = (id: string, short: string, lon: number): Drawn =>
      ({ id, type: 0, routeId: short, short, p: toPlane(lon, 45.81), heading: { x: 1, y: 0 }, speed: 5, confidence: 1, onShape: null });
    const drawn = [tram('a', '6', 15.97), tram('b', '11', 15.971), tram('c', '2', 15.99)];
    // A camera stand-in: ten thousand CSS px per degree, so b is drawn 10 px from a (their pills overlap) and c 200 px away (its own).
    const project = ([lon]: [number, number]): { x: number; y: number } => ({ x: (lon - 15.9) * 1e4, y: 0 });
    const fc = vehiclesToGeoJson(drawn, { project });
    expect(fc.features.map((f) => f.properties.id).sort()).toEqual(['c', 'cluster:a,b']);
    const cluster = fc.features.find((f) => f.properties.cluster)!;
    expect(cluster.properties).toMatchObject({ short: '6\u00b711', n: 2, ids: ['a', 'b'], kind: 'tram', sort: 3, hasHeading: false, held: false });
    expect(cluster.geometry.coordinates[0]).toBeCloseTo(15.9705, 4); // the members' own centroid
    // The selected (or followed) vehicle keeps its own mark, whatever overlaps it.
    expect(vehiclesToGeoJson(drawn, { project, selectedId: 'a' }).features.map((f) => f.properties.id).sort()).toEqual(['a', 'b', 'c']);
    // With no camera to project with, nothing is merged: every vehicle is its own mark, as before.
    expect(vehiclesToGeoJson(drawn).features.map((f) => f.properties.id)).toEqual(['a', 'b', 'c']);
  });

  it('a merged mark faces where its first member with a heading faces, and says twoWay only when two members with headings are more than 120° apart', () => {
    const tram = (id: string, lon: number, heading: { x: number; y: number } | null): Drawn =>
      ({ id, type: 0, routeId: '6', short: '6', p: toPlane(lon, 45.81), heading, speed: 5, confidence: 1, onShape: null, track: { x: 0, y: 1 } });
    const project = ([lon]: [number, number]): { x: number; y: number } => ({ x: (lon - 15.9) * 1e4, y: 0 });
    const merged = (drawn: Drawn[]) => vehiclesToGeoJson(drawn, { project }).features.find((f) => f.properties.cluster)!.properties;
    /** A unit heading at a compass bearing. */
    const facing = (deg: number): { x: number; y: number } => ({ x: Math.sin((deg * Math.PI) / 180), y: Math.cos((deg * Math.PI) / 180) });
    // Two trams of one line passing each other at a stop, north and south:
    // one label "6", the first member's bearing, and an arrow each way.
    expect(merged([tram('a', 15.97, facing(0)), tram('b', 15.971, facing(180))])).toMatchObject({ short: '6', bearing: 0, twoWay: true, hasHeading: false });
    // Following each other round a bend, 30° apart: one direction, nothing new to say.
    expect(merged([tram('a', 15.97, facing(0)), tram('b', 15.971, facing(30))])).toMatchObject({ bearing: 0, twoWay: false });
    // The difference is the shortest one round the compass: 350° and 10° are
    // 20° apart, 0° and 240° are 120° apart -- on the edge, not over it -- and
    // 0° and 130° are over it.
    expect(merged([tram('a', 15.97, facing(350)), tram('b', 15.971, facing(10))]).twoWay).toBe(false);
    expect(merged([tram('a', 15.97, facing(0)), tram('b', 15.971, facing(240))]).twoWay).toBe(false);
    expect(merged([tram('a', 15.97, facing(0)), tram('b', 15.971, facing(130))]).twoWay).toBe(true);
    // Only one member knows its facing: the mark takes that bearing but cannot claim two directions.
    expect(merged([tram('a', 15.97, null), tram('b', 15.971, facing(90))])).toMatchObject({ bearing: 90, twoWay: false, hasHeading: false });
    // A cluster where no member knows its facing: nothing to say, as before.
    expect(merged([tram('a', 15.97, null), tram('b', 15.971, null)])).toMatchObject({ bearing: 0, twoWay: false, hasHeading: false });
    // Every single carries twoWay, false: the layers filter on it, and a missing property is a runtime error in a case.
    expect(vehiclesToGeoJson([tram('a', 15.97, facing(0)), tram('c', 15.99, facing(180))]).features.map((f) => f.properties.twoWay)).toEqual([false, false]);
  });

  it('never merges across modes: a bus swallowed by a tram’s cluster would vanish the moment trams are switched off', () => {
    const at = (id: string, type: number, short: string, lon: number): Drawn =>
      ({ id, type, routeId: short, short, p: toPlane(lon, 45.81), heading: null, speed: 0, confidence: 1, onShape: null });
    // Ten thousand CSS px per degree again: 10 px apart, well inside both pills.
    const project = ([lon]: [number, number]): { x: number; y: number } => ({ x: (lon - 15.9) * 1e4, y: 0 });
    const fc = vehiclesToGeoJson([at('t', 0, '6', 15.97), at('b', 3, '109', 15.971)], { project });
    expect(fc.features.map((f) => f.properties.id).sort()).toEqual(['b', 't']);
    expect(fc.features.map((f) => f.properties.cluster)).toEqual([false, false]);
  });

  it('measures the pill boxes at the size the map paints them: on a screen at symbolScale 2 two trams 30 px apart merge, on a phone they stay apart', async () => {
    const NEAR: MapPoint = { ...A, id: 'vehicle:2', lon: A.lon + 0.003, title: '11', routeId: '11' };
    const pushedIds = async (symbolScale: number): Promise<string[]> => {
      const { frame, vehicles } = await harness({ points: [A, NEAR], extra: { symbolScale } });
      frame();
      return (vehicles().calls.at(-1) as FC).features.map((f) => String(f.properties.id));
    };
    expect(await pushedIds(2)).toEqual(['cluster:vehicle:1,vehicle:2']);
    expect((await pushedIds(1)).sort()).toEqual(['vehicle:1', 'vehicle:2']);
  });

  it('merges only where pills are drawn: below PILL_ZOOM every vehicle keeps its own dot, and the camera moving in merges them', async () => {
    const SECOND: MapPoint = { ...A, id: 'vehicle:2', lon: A.lon + 0.0002, title: '11', routeId: '11' };
    const { map, frame, vehicles } = await harness({ points: [A, SECOND] });
    map.zoom = 11; // dots alone: nothing to pile up, and one dot per cluster would empty the city
    frame();
    expect(((vehicles().calls.at(-1) as FC).features.map((f) => f.properties.id)).sort()).toEqual(['vehicle:1', 'vehicle:2']);
    map.zoom = 15;
    map.fire('move');
    for (let i = 0; i < 8; i++) frame();
    expect((vehicles().calls.at(-1) as FC).features.map((f) => f.properties.id)).toEqual(['cluster:vehicle:1,vehicle:2']);
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

  it('carries the trip, the reported delay and the twin’s next-stop ETA through to the lists (WP5 arrivals)', async () => {
    const eta = T0 + 120_000;
    const joined: MapPoint = { ...B, tripId: 'T-118', delaySeconds: 95, nextStopId: '231_2', nextStopEtaMs: eta };
    const { handle, frame } = await harness({ points: [{ ...joined, lon: A.lon, at: A.at }] });
    handle.update([joined], [CLOSURE]);
    for (let i = 0; i < 10; i++) frame();
    expect(handle.vehicles!()[0]).toMatchObject({ id: 'vehicle:1', tripId: 'T-118', delaySeconds: 95, nextStopId: '231_2', nextStopEtaMs: eta });
    // A vehicle the twin joined to nothing carries none of the three keys at all.
    handle.update([B], [CLOSURE]);
    for (let i = 0; i < 10; i++) frame();
    const bare = handle.vehicles!()[0];
    expect(bare).not.toHaveProperty('tripId');
    expect(bare).not.toHaveProperty('delaySeconds');
    expect(bare).not.toHaveProperty('nextStopEtaMs');
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

  it('takes the clustering pass only on the frames that push: a fleet that has stopped moving pushes nothing at all', async () => {
    const { frame, vehicles } = await harness();
    // The one report is half a minute old; the model converges onto it and
    // then has nothing left to say, so the loop parks.
    for (let i = 0; i < 300; i++) frame();
    const before = vehicles().calls.length;
    for (let i = 0; i < 120; i++) frame();
    expect(vehicles().calls.length - before).toBe(0);
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
    expect(map.controls).toHaveLength(1); // the credit alone: a scale bar belongs to a map one can move (kajimafix 01.8)
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
    expect(map.images.size).toBe(OVERLAY_IMAGE_IDS.length + 1); // the overlay images and the one stand-in
  });
});

describe('the basemap and the overlays on it', () => {
  it('builds the same-origin vector style for the document\u2019s theme at the opening zoom, puts the network and closures under the first label layer and everything else on top, one SDF image set, eight sources', async () => {
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
    expect([...map.images.keys()]).toEqual(OVERLAY_IMAGE_IDS);
    expect(map.images.get('vehicle-pill-2')!.options).toMatchObject({ sdf: true, pixelRatio: 2 });
    expect(map.images.get('vehicle-plate-2')!.options).toMatchObject({ sdf: true, pixelRatio: 2 });
    expect([...map.sources.keys()].sort()).toEqual(['bodies', 'closures', 'network', 'outline', 'places', 'screen-stop', 'stops', 'vehicles']);
    expect(map.getSource('bodies')!.data).toEqual({ type: 'FeatureCollection', features: [] });
  });

  it('the public screen’s option set reaches the overlays and the basemap, follows setProzor live (filters, paint, zoom ranges and the street names’ padding), and placedNames answers the names MapLibre placed for one layer: none before the style is up or for a layer the style lacks', async () => {
    const prozor: overlays.ProzorOptions = { networkKinds: ['tram'], stopRoutes: ['6'], stopLabelMinRank: 4, overlapZoom: 14.6, labelPadding: 30 };
    const { map, handle } = await harness({ load: false, extra: { basemapProfile: 'prozor', prozor, interactive: false, symbolScale: 2 } });
    expect(handle.placedNames!('roads_labels_major')).toEqual([]);
    map.fire('load');
    const layer = (id: string) => map.layers.find((l) => l.id === id) as { layout?: Record<string, unknown>; minzoom?: number; filter?: unknown } | undefined;
    expect(layer('pois')).toBeUndefined(); // the prozor basemap
    expect(layer('network-bus')!.layout!.visibility).toBe('none');
    expect(layer('vehicle-noses')!.minzoom).toBe(14.6);
    expect(layer('stop-labels')!.minzoom).toBe(14.6);
    expect(JSON.stringify(layer('stops')!.filter)).toContain('"6"');
    expect(JSON.stringify(layer('vehicles')!.layout!['icon-image'])).toContain('vehicle-plate-'); // the mark every surface draws; the prozor-specific claims are the lines around it
    expect(layer('roads_labels_major')!.layout!['text-padding']).toBe(30); // the set's padding reaches the basemap's names layer
    // The names MapLibre actually placed, once each: the e2e's proof that few street names survive the field.
    map.rendered = [
      { layer: { id: 'roads_labels_major' }, properties: { name: 'Ilica' } },
      { layer: { id: 'roads_labels_major' }, properties: { name: 'Ilica' } },
      { layer: { id: 'roads_labels_major' }, properties: { name: 'Savska cesta' } },
      { layer: { id: 'places_subplace' }, properties: { name: 'Trešnjevka' } },
    ];
    expect(handle.placedNames!('roads_labels_major')).toEqual(['Ilica', 'Savska cesta']);
    expect(handle.placedNames!('places_subplace')).toEqual(['Trešnjevka']);
    expect(handle.placedNames!('no-such-layer')).toEqual([]);
    // The screen's stop changes, or the field is re-measured: the dots, the labels, the noses and the street names' padding follow without a new map.
    handle.setProzor!({ ...prozor, stopRoutes: ['1', '17'], overlapZoom: 15.1, labelPadding: 48 });
    expect(JSON.stringify(map.filters['stops'])).toContain('"17"');
    expect(JSON.stringify(map.filters['stops'])).not.toContain('"6"');
    expect(map.zoomRanges['vehicle-noses']).toEqual([15.1, overlays.NOSE_MAX_ZOOM]);
    expect(map.zoomRanges['stop-labels']).toEqual([15.1, 24]);
    // A pill is never dropped, at any zoom and under any option set: the layer
    // went on with overlap and ignore-placement already true, and nothing the
    // kiosk changes can turn them off again.
    expect((map.layers.find((l) => l.id === 'vehicles') as { layout: Record<string, unknown> }).layout['icon-allow-overlap']).toBe(true);
    expect(map.layout['vehicles']?.['icon-allow-overlap']).toBeUndefined();
    expect(map.layout['roads_labels_major']?.['text-padding']).toBe(48);
    // Back to no option set: today's drawing, thresholds and the profile's own padding included.
    handle.setProzor!(null);
    expect(map.layout['network-bus']?.visibility).toBe('visible');
    expect(map.zoomRanges['vehicle-noses']).toEqual([overlays.NOSE_MIN_ZOOM, overlays.NOSE_MAX_ZOOM]);
    expect(map.zoomRanges['stop-labels']).toEqual([overlays.STOP_LABEL_ZOOM, 24]);
    expect(map.layout['roads_labels_major']?.['text-padding']).toBe(basemap.PROZOR_LABEL_PADDING_PX);
    handle.destroy();
    expect(handle.placedNames!('roads_labels_major')).toEqual([]);
  });

  it('flips theme through paint properties and the sprite, never a setStyle, and follows <html data-theme-resolved> live', async () => {
    const { map, handle } = await harness();
    const layersBefore = map.layers.length;
    handle.setTheme!('dark');
    // Read the live paint back through basemap.ts's own exports rather than a literal re-pin,
    // so this assertion never again needs an edit when a basemap task changes the palette
    // (fix round 1, T1.2 finding: test/motion/* must pass without edits).
    expect(map.paint['background']?.['background-color']).toBe(basemap.flavorFor('dark').background);
    expect(map.paint['vehicles']?.['icon-halo-color']).toEqual(['case', ['get', 'cluster'], basemap.OVERLAY_DARK.selection, basemap.OVERLAY_DARK.halo]);
    expect(map.sprite).toBe('https://zagreb.example/maps/sprites/dark');
    expect(map.layers).toHaveLength(layersBefore);
    document.documentElement.setAttribute('data-theme-resolved', 'light');
    await new Promise((r) => setTimeout(r, 0));
    expect(map.paint['background']?.['background-color']).toBe(basemap.flavorFor('light').background);
    expect(map.sprite).toBe('https://zagreb.example/maps/sprites/light');
  });
});

describe('the vehicle bodies under the pills', () => {
  type BodyFC = { features: { geometry: { type: string; coordinates: [number, number][] }; properties: Record<string, unknown> }[] };
  const EMPTY = { type: 'FeatureCollection', features: [] };

  it('pushes one LineString per vehicle with every pill push from BODY_ZOOM up, empties the source once below it and leaves it alone until the camera comes back', async () => {
    const { map, handle, frame, vehicles } = await harness();
    const bodies = () => map.getSource('bodies')!;
    map.zoom = 17;
    handle.update([B], [CLOSURE]); // two fixes east: the facing is evident, so the body knows which way to lie
    for (let i = 0; i < 10; i++) frame();
    const fc = bodies().calls.at(-1) as BodyFC;
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0]!.geometry.type).toBe('LineString');
    expect(fc.features[0]!.properties).toEqual({ id: 'vehicle:1', kind: 'tram', routeId: '6', alpha: expect.any(Number) });
    // One tram length, on the plane the model reckons in.
    const [a, b] = fc.features[0]!.geometry.coordinates.map(([lon, lat]) => toPlane(lon, lat));
    expect(Math.hypot(b!.x - a!.x, b!.y - a!.y)).toBeCloseTo(32, 6);
    // Pushed on the pills' 12 Hz grid, never on its own.
    expect(bodies().calls.length).toBe(vehicles().calls.length);
    expect(bodies().calls.length).toBeGreaterThan(0);
    // Out to 15: the layer would not draw them anyway, so the source is emptied
    // once, on the next push of the 12 Hz grid, and then skipped while the
    // pills go on being pushed.
    map.zoom = 15;
    map.fire('move');
    const before = bodies().calls.length;
    for (let i = 0; i < 6; i++) frame();
    expect(bodies().calls.slice(before)).toEqual([EMPTY]);
    const emptied = bodies().calls.length;
    const pills = vehicles().calls.length;
    for (let i = 0; i < 12; i++) frame();
    expect(vehicles().calls.length).toBeGreaterThan(pills);
    expect(bodies().calls.length).toBe(emptied);
    // Back in: the bodies return with the next push.
    map.zoom = 16;
    map.fire('move');
    for (let i = 0; i < 6; i++) frame();
    expect(bodies().calls.length).toBeGreaterThan(emptied);
    expect((bodies().calls.at(-1) as BodyFC).features).toHaveLength(1);
  });

  it('below BODY_ZOOM from the start nothing is ever pushed to the bodies source: it was created empty and stays so', async () => {
    const { map, handle, frame, vehicles } = await harness();
    map.zoom = 15;
    handle.update([B], [CLOSURE]);
    for (let i = 0; i < 10; i++) frame();
    expect(vehicles().calls.length).toBeGreaterThan(0);
    expect(map.getSource('bodies')!.calls).toEqual([]);
  });

  it('data-bodies counts the bodies MapLibre rendered, from the same census as the pills and the noses', async () => {
    const { map, container, frame } = await harness();
    frame();
    map.rendered = [
      { layer: { id: 'vehicle-bodies' }, properties: { id: 'vehicle:1' } },
      { layer: { id: 'vehicle-bodies' }, properties: { id: 'vehicle:2' } },
      { layer: { id: 'vehicles' }, properties: { id: 'vehicle:1', short: '6' } },
    ];
    map.fire('idle');
    expect(container.dataset.bodies).toBe('2');
    expect(container.dataset.pills).toBe('6');
    expect(container.dataset.noses).toBe('0');
  });

  it('a body across a tile seam is one body: the census counts vehicles, not the pieces MapLibre cut a line into', async () => {
    const { map, container, frame } = await harness();
    frame();
    // queryRenderedFeatures answers per tile, so a 32 m line lying over a
    // seam comes back once from each side -- the same feature twice.
    map.rendered = [
      { layer: { id: 'vehicle-bodies' }, properties: { id: 'vehicle:1' } },
      { layer: { id: 'vehicle-bodies' }, properties: { id: 'vehicle:1' } },
      { layer: { id: 'vehicle-bodies' }, properties: { id: 'vehicle:2' } },
      { layer: { id: 'vehicle-twoway-fore' }, properties: { id: 'cluster:1,2' } },
      { layer: { id: 'vehicle-twoway-fore' }, properties: { id: 'cluster:1,2' } },
    ];
    map.fire('idle');
    expect(container.dataset.bodies).toBe('2');
    expect(container.dataset.twoway).toBe('1');
  });
});

describe('the two-way arrows on an opposed merge', () => {
  it('data-twoway counts the fore arrows MapLibre rendered; data-noses goes on counting vehicle-noses alone', async () => {
    const { map, container, frame } = await harness();
    frame();
    map.rendered = [
      { layer: { id: 'vehicle-twoway-fore' }, properties: { id: 'cluster:a,b' } },
      { layer: { id: 'vehicle-twoway-aft' }, properties: { id: 'cluster:a,b' } },
      { layer: { id: 'vehicle-noses' }, properties: { id: 'vehicle:3' } },
      { layer: { id: 'vehicles' }, properties: { id: 'cluster:a,b', short: '6' } },
    ];
    map.fire('idle');
    expect(container.dataset.twoway).toBe('1');
    expect(container.dataset.noses).toBe('1');
    expect(container.dataset.pills).toBe('6');
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

  it('a basemap failure before load ends the loading state; after load overlays draw with tiles-failed and recover', async () => {
    const { map, statuses, handle } = await harness({ load: false });
    map.fire('error', { sourceId: 'basemap', tile: {}, error: { url: 'https://zagreb.example/maps/zagreb-v1/13/1/1.mvt' } });
    expect(handle.status!()).toBe('unavailable');
    map.fire('load');
    expect(handle.status!()).toBe('tiles-failed');
    expect(map.getSource('vehicles')).toBeDefined();
    expect(map.layers.some((l) => l.id === 'vehicles')).toBe(true);
    map.fire('sourcedata', { sourceId: 'basemap', tile: {} });
    expect(handle.status!()).toBe('ready');
    map.fire('error', { sourceId: 'basemap', tile: {}, error: {} });
    expect(statuses).toEqual(['unavailable', 'tiles-failed', 'ready', 'tiles-failed']);
    expect((await harness()).container.dataset.mapStatus).toBe('ready');
  });
  it('keeps the latest requested camera while the map library is still loading', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    let release!: (value: never) => void;
    const handle = createCityMap(
      { container, ariaLabel: 'Karta', points: [], center: [15.977, 45.813], zoom: 15 },
      { loadMaplibre: () => new Promise(resolve => { release = resolve; }), raf: () => 0, cancel: () => {} },
    );
    handle.setView!({ center: [15.96, 45.79], zoom: 13 });
    handle.setView!({ center: [16.02, 45.82], zoom: 14 });
    release(lib as never);
    await flush();
    const map = FakeMap.instances.at(-1)!;
    expect(map.options).toMatchObject({ center: [16.02, 45.82], zoom: 14 });
    map.fire('load');
    expect(map.cameraCalls.at(-1)).toMatchObject({ kind: 'jumpTo', options: { center: [16.02, 45.82], zoom: 14 } });
    expect(handle.status!()).toBe('ready');
    handle.destroy();
  });
  it('a selection requested before initialization is fitted once its geometry exists', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    let release!: (value: never) => void;
    const handle = createCityMap(
      { container, ariaLabel: 'Karta', points: [], lines: [CLOSURE] },
      { loadMaplibre: () => new Promise(resolve => { release = resolve; }), raf: () => 0, cancel: () => {} },
    );
    handle.setView!({ center: [15.977, 45.813], zoom: 15 });
    handle.select!({ kind: 'closure', id: CLOSURE.id }, { fit: true });
    release(lib as never);
    await flush();
    const map = FakeMap.instances.at(-1)!;
    map.fire('load');
    expect(map.cameraCalls.at(-1)).toMatchObject({ kind: 'fitBounds', options: { bounds: [[15.957, 45.799], [15.959, 45.799]], maxZoom: 16 } });
    handle.destroy();
  });
  it('a person moving the map during startup cancels an older programmatic camera', async () => {
    const { map, handle } = await harness({ load: false });
    handle.setView!({ center: [16.02, 45.82], zoom: 14, selection: { kind: 'closure', id: CLOSURE.id } });
    map.fire('moveend', { originalEvent: {} });
    map.cameraCalls.length = 0;
    map.fire('load');
    expect(map.cameraCalls).toEqual([]);
  });
  it('relabels the attribution disclosure when the language changes in place', async () => {
    const { container, handle } = await harness();
    const toggle = document.createElement('summary');
    toggle.className = 'maplibregl-ctrl-attrib-button';
    container.appendChild(toggle);
    handle.setLocale!('en');
    expect(toggle.getAttribute('aria-label')).toBe('Map attribution');
    handle.setLocale!('hr');
    expect(toggle.getAttribute('aria-label')).toBe('Izvori karte');
  });
  it('a tile arriving before the style cannot certify the renderer as ready', async () => {
    const { map, handle } = await harness({ load: false });
    map.fire('error', { error: { url: 'https://zagreb.example/maps/sprites/light.json' } });
    expect(handle.status!()).toBe('unavailable');
    map.fire('sourcedata', { sourceId: 'basemap', tile: {} });
    expect(handle.status!()).toBe('unavailable');
    map.fire('load');
    expect(handle.status!()).toBe('ready');
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

  it('a stale copy keeps the motion going (R-TE5); only a down feed holds every vehicle where it is, and live again the motion resumes', async () => {
    const { handle, frame, pending, container } = await harness();
    handle.update([B], [CLOSURE]);
    frame();
    handle.setFeedState!('stale');
    expect(container.dataset.feed).toBe('stale');
    expect(pending()).toBe(1); // the loop is still armed: a last-good copy is evidence with its own confidence
    handle.setFeedState!('down');
    expect(pending()).toBe(0);
    expect(container.dataset.feed).toBe('down');
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

  it('line focus follows the selected vehicle to its line: the network hides, the route draws in its ZET colour, and a cluster with a member on it is that line’s mark', async () => {
    const LINE_COLOURS: Record<string, string> = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../app/src/data/zet-line-colours.json'), 'utf8')).colours;
    const { map, handle, frame } = await harness({ loadNetwork: async () => NET, extra: { lineFocus: true } });
    frame(); // the vehicle has to be drawn before its route can be focused
    handle.select!({ kind: 'vehicle', id: 'vehicle:1' });
    expect(map.layout['network-tram']?.visibility).toBe('none');
    expect(map.layout['network-bus']?.visibility).toBe('none');
    expect(map.filters['network-selected']).toEqual(['==', ['get', 'route'], '6']);
    expect(map.paint['network-selected']?.['line-color']).toBe(LINE_COLOURS['6']);
    // Off again: the whole network is back, and nothing but a route selection lights a line.
    handle.setLineFocus!(false);
    expect(map.layout['network-tram']?.visibility).toBe('visible');
    expect(map.filters['network-selected']).toEqual(overlays.NEVER);

    // F2 left a mixed cluster with routeId '' -- it took the inverted ink under
    // the very route it carries. A member on the focused line now names it.
    const tram = (id: string, short: string, lon: number): Drawn =>
      ({ id, type: 0, routeId: short, short, p: toPlane(lon, 45.81), heading: null, speed: 0, confidence: 1, onShape: null });
    const drawn = [tram('a', '6', 15.97), tram('b', '11', 15.971)];
    const project = ([lon]: [number, number]): { x: number; y: number } => ({ x: (lon - 15.9) * 1e4, y: 0 });
    expect(vehiclesToGeoJson(drawn, { project }).features[0]!.properties.routeId).toBe('');
    expect(vehiclesToGeoJson(drawn, { project, focusedRoute: '11' }).features[0]!.properties.routeId).toBe('11');
    expect(vehiclesToGeoJson(drawn, { project, focusedRoute: '2' }).features[0]!.properties.routeId).toBe('');
  });

  it('a surface that never asked for line focus draws what it always drew: the pinned mode ink on the lit route and a mixed cluster still nameless', async () => {
    // The kiosk passes no `lineFocus` at all (transport/workspace.ts), and
    // round F's constraint is that its picture does not move. Two trams on
    // different routes, close enough to merge, with route 6 selected.
    const NEAR: MapPoint = { ...A, id: 'vehicle:2', lon: A.lon + 0.0002, title: '11', routeId: '11' };
    const clusterRoute = async (extra: Record<string, unknown>): Promise<unknown> => {
      const { map, handle, frame, vehicles } = await harness({ points: [A, NEAR], loadNetwork: async () => NET, extra });
      map.zoom = 15;
      handle.select!({ kind: 'route', id: '6' });
      frame();
      const pushed = vehicles().calls.at(-1) as FC;
      const cluster = pushed.features.find((f) => f.properties.cluster)!;
      // The live colour: what a styleDiff last set, else what the layer was added with.
      const added = map.layers.find((l) => l.id === 'network-selected')?.paint as Record<string, unknown> | undefined;
      return { colour: map.paint['network-selected']?.['line-color'] ?? added?.['line-color'], routeId: cluster.properties.routeId };
    };
    const untouched = ['match', ['get', 'kind'], 'tram', basemap.OVERLAY_LIGHT.routeTram, 'bus', basemap.OVERLAY_LIGHT.routeBus, basemap.OVERLAY_LIGHT.other];
    expect(await clusterRoute({})).toEqual({ colour: untouched, routeId: '' });
    // A reader with the switch, turned off, is a different surface: the ZET
    // colour on the line they picked, and the cluster no longer inverted.
    const asked = await clusterRoute({ lineFocus: false }) as { colour: unknown; routeId: string };
    expect(asked.colour).not.toEqual(untouched);
    expect(asked.routeId).toBe('6');
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

  it('gives one tap over both a vehicle pill and a city place to the pill: the number is what the round drew there, and the dot is still a zoom or a pixel away', async () => {
    const { map, selections } = await harness({ lib: cityLib });
    // The upstream merge queried the place layers first, so a pill standing on
    // a place dot could not be tapped at all (F6b ruling).
    map.rendered = [
      { layer: { id: 'city-place-dots' }, properties: { id: 'place:1' } },
      { layer: { id: 'vehicles' }, properties: { id: 'vehicle:1' } },
    ];
    map.fire('click', { point: { x: 10, y: 10 } });
    expect(selections).toEqual([{ kind: 'vehicle', id: 'vehicle:1' }]);
    // With no pill under it the place is still what the tap means.
    map.rendered = [{ layer: { id: 'city-place-dots' }, properties: { id: 'place:1' } }];
    map.fire('click', { point: { x: 10, y: 10 } });
    expect(selections[1]).toEqual({ kind: 'place', id: 'place:1' });
  });

  it('a tap on a cluster eases the camera onto its members while no tap could tell them apart, and picks the nearest member once one could', async () => {
    const SECOND: MapPoint = { ...A, id: 'vehicle:2', lon: A.lon + 0.001, lat: 45.811, title: '11', routeId: '11' };
    const { map, handle, frame, selections } = await harness({ points: [A, SECOND] });
    frame();
    const members = handle.vehicles!();
    expect(members).toHaveLength(2);
    map.rendered = [{ layer: { id: 'vehicles' }, properties: { id: 'cluster:vehicle:1,vehicle:2', cluster: true, n: 2, ids: ['vehicle:1', 'vehicle:2'], short: '6·11' } }];
    map.zoom = 15;
    map.fire('click', { point: { x: 10, y: 10 } });
    expect(selections).toEqual([]); // nothing is chosen for the reader; the camera goes in on the members
    expect(map.cameraCalls.at(-1)).toMatchObject({ kind: 'fitBounds', options: { maxZoom: CLUSTER_ZOOM_IN_UNTIL } });
    // Close in there is no camera left to spend, and the tap means the pill under it.
    map.zoom = 18;
    const second = members.find((v) => v.id === 'vehicle:2')!;
    map.fire('click', { point: map.project([second.lon, second.lat]) });
    expect(selections).toEqual([{ kind: 'vehicle', id: 'vehicle:2' }]);
    expect(map.filters['vehicle-selected']).toEqual(['==', ['get', 'id'], 'vehicle:2']);
  });
});
