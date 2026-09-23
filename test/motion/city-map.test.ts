// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as basemap from '../../app/src/map/basemap';
import { CLUSTER_ZOOM_IN_UNTIL, createCityMap, documentTheme, stopsToGeoJson, vehicleLabel, vehiclesToGeoJson, withNetwork, withTimers, SOURCE_UPDATE_HZ, type MapFactory, type MapLine, type MapPoint, type MapSelection, type MapStatus } from '../../app/src/map/city-map';
import * as overlays from '../../app/src/map/overlays';
import * as cityPlaces from '../../app/src/map/city-layers';
import { NOSE_LENGTH_PX, noseCentrePx, PILL_MAX_CHARS_CLUSTER } from '../../app/src/motion/pills';
import { toPlane } from '../../shared/motion/geo';
import type { Drawn } from '../../app/src/motion/integrator';
import { decodeNetwork } from '../../shared/motion/network';
import { readFileSync } from 'node:fs';
import { CENSUS_COUNT_HALF_PX, CENSUS_LAYERS, markerCensus, pillBox, PROBE_SETTLE_MS, type RenderedFeature } from '../../app/src/map/city-map';
import * as nameCensus from '../../app/src/map/name-census';
import { createNameHysteresis, evaluateExpression, nameCandidates, nameKey, NAME_FADE_MS, NAME_HOLD_MS, NAME_MIN_HIDDEN_MS, NAME_TICK_MS, UNKNOWN_EXPRESSION, type SourcePoint } from '../../app/src/map/name-census';
import { pillWidthPx } from '../../app/src/motion/pills';
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
  /** What isMoving() answers: the census fallback takes nothing while the camera moves. */
  moving = false;
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
  isMoving(): boolean { return this.moving; }
  addImage(id: string, image: FakeImage, options: Record<string, unknown>): void { this.images.set(id, { image, options }); }
  hasImage(id: string): boolean { return this.images.has(id); }
  readonly removedImages: string[] = [];
  removeImage(id: string): void { this.removedImages.push(id); this.images.delete(id); }
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
  readonly queries: unknown[] = [];
  queryRenderedFeatures(geometry: unknown, options?: { layers?: string[] }) { this.queries.push(geometry); return this.rendered.filter((f) => !options?.layers || options.layers.includes(f.layer.id)); }
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
const lib = { ...basemap, ...overlays, ...nameCensus, Map: FakeMap, AttributionControl: FakeControl, NavigationControl: FakeControl, ScaleControl: FakeControl, LngLatBounds: class {} };
/** The real entry (maplibre-entry.ts) also re-exports the city-places layers;
 *  the transport tests leave them out so they see the transport style alone,
 *  and the test that is about those layers asks for this one. */
const cityLib = { ...lib, ...cityPlaces };

/** Every SDF image the overlays put on a map, in order: the one stretchable
 *  pill and plate every label fits, then the nose, the ring and the place marks. */
const OVERLAY_IMAGE_IDS = ['vehicle-pill', 'vehicle-plate', 'vehicle-nose', 'selection-ring', 'place-square', 'place-square-ring', 'place-ring'];

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

  it('holds a standalone or selected pill to the 40-character cap a cluster obeys, and never empties it', () => {
    const long = '9'.repeat(45);
    const capped = '9'.repeat(PILL_MAX_CHARS_CLUSTER);
    const bus = (id: string, extra: Partial<Drawn>, lon: number): Drawn =>
      ({ id, type: 3, p: toPlane(lon, 45.81), heading: null, speed: 0, confidence: 1, onShape: null, ...extra });
    // One vehicle carries an oversized short name, the other only an oversized route id.
    const drawn = [bus('a', { routeId: 'r', short: long }, 15.97), bus('b', { routeId: long }, 15.99)];
    // No camera: nothing merges, both are standalone pills.
    expect(vehiclesToGeoJson(drawn).features.map((f) => f.properties.short)).toEqual([capped, capped]);
    // With a camera their widest capsules overlap, but the selected one keeps its own mark, and the rest stays alone.
    const project = ([lon]: [number, number]): { x: number; y: number } => ({ x: (lon - 15.9) * 1e4, y: 0 });
    const selected = vehiclesToGeoJson(drawn, { project, selectedId: 'a' }).features;
    expect(selected.map((f) => [f.properties.id, f.properties.short, f.properties.cluster])).toEqual([['b', capped, false], ['a', capped, false]]);
    // The shared formatter the schema's marks use too.
    expect(vehicleLabel({ short: long })).toBe(capped);
    expect(vehicleLabel({ routeId: long })).toBe(capped);
    expect(vehicleLabel({ short: '6' })).toBe('6');
    expect(vehicleLabel({})).toBe('');
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

  it('writes each mark\u2019s nose distance from its own capsule and heading: a single\u2019s from its number, a merged mark\u2019s from its joined label, a tram\u2019s from its plate', () => {
    const at = (id: string, type: number, short: string, lon: number, deg: number): Drawn =>
      ({ id, type, routeId: short, short, p: toPlane(lon, 45.81), heading: { x: Math.sin((deg * Math.PI) / 180), y: Math.cos((deg * Math.PI) / 180) }, speed: 5, confidence: 1, onShape: null });
    const project = ([lon]: [number, number]): { x: number; y: number } => ({ x: (lon - 15.9) * 1e4, y: 0 });
    const fc = vehiclesToGeoJson([at('a', 0, '6', 15.97, 0), at('b', 0, '7', 15.971, 180), at('c', 3, '268', 15.99, 90), at('d', 3, '109', 16.01, 45)], { project });
    const by = (id: string) => fc.features.find((f) => f.properties.id === id)!.properties;
    expect(by('cluster:a,b').nose).toBe(noseCentrePx('6\u00b77', 'tram', 0));
    expect(by('c').nose).toBe(noseCentrePx('268', 'bus', 90));
    expect(by('d').nose).toBe(noseCentrePx('109', 'bus', 45));
    // A north-bound "6·7" sits on its plate's top edge, nowhere near its half-width.
    expect(by('cluster:a,b').nose).toBe(9 + NOSE_LENGTH_PX / 2 - 0.5);
    // Without a camera too: the source always carries it, so the layer never meets a missing property.
    expect(vehiclesToGeoJson([at('a', 0, '6', 15.97, 90)]).features[0]!.properties.nose).toBe(noseCentrePx('6', 'tram', 90));
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
    expect(ids[ids.length - 1]).toBe('ambient-highlight-point');
    expect(ids.indexOf('selection-ring')).toBeGreaterThan(ids.indexOf('vehicles'));
    expect([...map.images.keys()]).toEqual(OVERLAY_IMAGE_IDS);
    // The pill and the plate carry their stretch metadata over the SDF defaults; the fixed marks only the defaults.
    const [pill, plate] = overlays.overlayImages(1);
    expect(map.images.get('vehicle-pill')!.options).toEqual({ sdf: true, pixelRatio: 2, ...pill!.options });
    expect(map.images.get('vehicle-plate')!.options).toEqual({ sdf: true, pixelRatio: 2, ...plate!.options });
    expect(map.images.get('vehicle-pill')!.options).toHaveProperty('stretchX');
    expect(map.images.get('vehicle-nose')!.options).toEqual({ sdf: true, pixelRatio: 2 });
    expect([...map.sources.keys()].sort()).toEqual(['ambient-highlight', 'bodies', 'closures', 'network', 'outline', 'places', 'screen-stop', 'stops', 'vehicles']);
    expect(map.getSource('bodies')!.data).toEqual({ type: 'FeatureCollection', features: [] });
  });

  it('draws the stretchable pill and plate at the map\u2019s own symbol scale and, when the scale changes, replaces exactly those two, with the fit padding following', async () => {
    const { map, handle } = await harness({ extra: { symbolScale: 2, presentationProfile: 'public-display', interactive: false } });
    const at = (scale: number) => overlays.overlayImages(scale);
    // Drawn at the wall's scale: MapLibre never multiplies a stretchable image's fixed ends by icon-size.
    expect(map.images.get('vehicle-pill')!.image.width).toBe(at(2)[0]!.image.width);
    expect(map.images.get('vehicle-plate')!.options).toEqual({ sdf: true, pixelRatio: 2, ...at(2)[1]!.options });
    const nose = map.images.get('vehicle-nose');
    // The same scale again replaces nothing.
    handle.setPresentationProfile!('public-display', 2);
    expect(map.removedImages).toEqual([]);
    // A new scale (the wall's display scale moved) replaces the two that stretch, and nothing else.
    handle.setPresentationProfile!('public-display', 3);
    expect(map.removedImages).toEqual(['vehicle-pill', 'vehicle-plate']);
    expect(map.images.get('vehicle-pill')!.image.width).toBe(at(3)[0]!.image.width);
    expect(map.images.get('vehicle-pill')!.options).toEqual({ sdf: true, pixelRatio: 2, ...at(3)[0]!.options });
    expect(map.images.get('vehicle-nose')).toBe(nose);
    expect([...map.images.keys()].sort()).toEqual([...OVERLAY_IMAGE_IDS].sort());
    // The layer's fit padding and number grow with the same scale, at icon-size 1.
    expect(map.layout['vehicles']).toMatchObject({ 'text-size': 36, 'icon-text-fit-padding': [3 * overlays.PILL_FIT_PAD_Y, 3 * overlays.PILL_FIT_PAD_X, 3 * overlays.PILL_FIT_PAD_Y, 3 * overlays.PILL_FIT_PAD_X] });
  });

  it('the public screen’s option set reaches the overlays and the basemap, follows setProzor live (filters, paint, zoom ranges and the street names’ padding), and placedNames answers the names MapLibre placed for one layer: none before the style is up or for a layer the style lacks', async () => {
    const prozor: overlays.ProzorOptions = { networkKinds: ['tram'], stopRoutes: ['6'], stopLabelMinRank: 4, overlapZoom: 14.6, stopRadius: false, labelPadding: 30 };
    const { map, handle } = await harness({ load: false, extra: { basemapProfile: 'prozor', prozor, interactive: false, symbolScale: 2 } });
    expect(handle.placedNames!('roads_labels_major')).toEqual([]);
    map.fire('load');
    const layer = (id: string) => map.layers.find((l) => l.id === id) as { layout?: Record<string, unknown>; minzoom?: number; filter?: unknown } | undefined;
    expect(layer('pois')).toBeUndefined(); // the prozor basemap
    expect(layer('network-bus')!.layout!.visibility).toBe('none');
    expect(layer('vehicle-noses')!.minzoom).toBe(14.6);
    expect(layer('stop-labels')!.minzoom).toBe(14.6);
    expect(JSON.stringify(layer('stops')!.filter)).toContain('"6"');
    expect(JSON.stringify(layer('vehicles')!.layout!['icon-image'])).toContain('"vehicle-plate"'); // the mark every surface draws; the prozor-specific claims are the lines around it
    expect(layer('roads_labels_major')!.layout!['text-padding']).toBe(30); // the set's padding reaches the basemap's names layer
    // The names MapLibre actually placed, once each: the e2e's proof that few street names survive the field.
    map.rendered = [
      { layer: { id: 'roads_labels_major' }, properties: { name: 'Ilica' } },
      { layer: { id: 'roads_labels_major' }, properties: { name: 'Ilica' } },
      { layer: { id: 'roads_labels_major' }, properties: { name: 'Savska cesta' } },
      { layer: { id: 'places_subplace' }, properties: { name: 'Trešnjevka' } },
    ];
    expect(handle.placedNames!('roads_labels_major')).toEqual(['Ilica', 'Savska cesta']);
    // The neighbourhood names are not on this profile at all (basemap.ts PROZOR_DROPPED_LAYERS), so nothing of theirs is ever placed.
    expect(handle.placedNames!('places_subplace')).toEqual([]);
    expect(handle.placedNames!('no-such-layer')).toEqual([]);
    // The screen's stop changes, or the field is re-measured: the dots, the labels, the noses and the street names' padding follow without a new map.
    handle.setProzor!({ ...prozor, stopRoutes: ['1', '17'], overlapZoom: 15.1, labelPadding: 48 });
    expect(JSON.stringify(map.filters['stops'])).toContain('"17"');
    expect(JSON.stringify(map.filters['stops'])).not.toContain('"6"');
    expect(map.zoomRanges['vehicle-noses']).toEqual([15.1, overlays.NOSE_MAX_ZOOM]);
    expect(map.zoomRanges['stop-labels']).toEqual([15.1, 24]);
    // A pill is never dropped, at any zoom and under any option set: the layer
    // went on with overlap already true, and nothing the kiosk changes can
    // turn it off again. Under the option set it also keeps its box for the
    // names (decision 17), which a name then yields to.
    expect(layer('vehicles')!.layout!['icon-allow-overlap']).toBe(true);
    expect(map.layout['vehicles']?.['icon-allow-overlap']).toBeUndefined();
    expect(layer('vehicles')!.layout!['icon-ignore-placement']).toBe(false);
    expect(map.layout['roads_labels_major']?.['text-padding']).toBe(48);
    // Back to no option set: today's drawing, thresholds and the profile's own padding included.
    handle.setProzor!(null);
    expect(map.layout['network-bus']?.visibility).toBe('visible');
    expect(map.layout['vehicles']?.['icon-ignore-placement']).toBe(true);
    expect(map.layout['stop-labels']?.['text-anchor']).toBe('top');
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

// WP2's marker census (the probe contract, §15.6): data-markers,
// data-unlabelled, data-bajs and data-overlaps, read back off what the city
// layers rendered, beside the vehicle census and on the same idle.
describe('the marker census of the city layers', () => {
  const at = (lon: number, lat: number) => ({ type: 'Point', coordinates: [lon, lat] });
  const dot = (id: string, props: Record<string, unknown>, lon = 15.97, lat = 45.81): RenderedFeature =>
    ({ layer: { id: CENSUS_LAYERS.dots }, properties: { id, ...props }, geometry: at(lon, lat) });
  const badge = (id: string, text: string): RenderedFeature => ({ layer: { id: CENSUS_LAYERS.badges }, properties: { id, badge: text } });
  const label = (id: string, title: string): RenderedFeature => ({ layer: { id: CENSUS_LAYERS.labels }, properties: { id, title } });
  const bike = (badgeText: string, spent: boolean, extra: Record<string, unknown> = {}) => ({ category: 'bikes', badge: badgeText, spent, eventCount: 0, priority: 2, ...extra });
  /** The FakeMap's projection: 10 000 px per degree from 15.9 E, 45.9 N. */
  const anchor = (f: RenderedFeature) => {
    const [lon, lat] = (f.geometry?.coordinates ?? []) as number[];
    return lon === undefined || lat === undefined ? null : { x: (lon - 15.9) * 1e4, y: (45.9 - lat) * 1e4 };
  };
  const OPEN = { width: 0, height: 0 };

  it('names the three city layers city-layers.ts draws, and half the size of the count inside a disc', () => {
    expect(cityPlaces.CITY_LAYERS).toEqual(expect.arrayContaining(Object.values(CENSUS_LAYERS)));
    expect(CENSUS_COUNT_HALF_PX * 2).toBe(cityPlaces.BIKE_COUNT_PX);
  });

  it('sorts the BAJS discs by what they say: a number, the grey "0", the grey blank and the far dot; none of them is unlabelled', () => {
    const census = markerCensus([
      dot('bajs-a', bike('4', false)), badge('bajs-a', '4'),
      dot('bajs-b', bike('0', true)), badge('bajs-b', '0'),
      dot('bajs-c', bike('', true)),
      dot('bajs-d', bike('', false, { far: true })),
      dot('culture-1', { category: 'culture', badge: '2', eventCount: 2 }), badge('culture-1', '2'), label('culture-1', 'Gavella'),
    ], anchor, OPEN, [], 1);
    expect(census).toEqual({ markers: 5, unlabelled: 0, bajs: { counted: 1, zero: 1, blank: 1, far: 1 }, covered: 0, discPills: 0 });
  });

  it('counts a mark without a whole-number count or a name as unlabelled: a "?", a "+3", a lost number, a nameless air station', () => {
    const census = markerCensus([
      dot('q', bike('?', true)), badge('q', '?'),
      dot('plus', { category: 'culture', badge: '+3' }), badge('plus', '+3'),
      // A disc whose number MapLibre did not draw is not the deliberate blank: it has a count to show.
      dot('lost', bike('7', false)),
      dot('air-1', { category: 'air', badge: '' }),
      // A name is enough: the paired map names its stations, with the older "?" still in the disc.
      dot('named', bike('?', true)), badge('named', '?'), label('named', 'BAJS Trg'),
    ], anchor, OPEN, [], 1);
    expect(census.markers).toBe(5);
    expect(census.unlabelled).toBe(4);
    expect(census.bajs).toEqual({ counted: 0, zero: 0, blank: 0, far: 0 });
  });

  it('counts a mark once across a tile seam, and not at all when only its edge reaches in from off the screen', () => {
    const view = { width: 1000, height: 1000 };
    const census = markerCensus([
      dot('seam', bike('3', false)), dot('seam', bike('3', false)), badge('seam', '3'), badge('seam', '3'),
      // 15.899 E is x = -10: the disc's edge is on the screen, its number is not.
      dot('edge', bike('', true), 15.899, 45.81),
    ], anchor, view, [], 2);
    expect(census).toEqual({ markers: 1, unlabelled: 0, bajs: { counted: 1, zero: 0, blank: 0, far: 0 }, covered: 0, discPills: 0 });
  });

  it('counts a mark whose number a pill covers, by the capsule MapLibre draws at the map scale, and the pills over each such number', () => {
    // bajs-a at (700, 900); a one-digit pill 18 x 18 px at scale 2 is 36 x 36.
    const over = pillBox({ x: 710, y: 905 }, '6', 2);
    const beside = pillBox({ x: 760, y: 900 }, '6', 2);
    expect(over).toEqual({ left: 692, top: 887, right: 728, bottom: 923 });
    // A merged label is its glyphs' width: five digits at 6.5 px and two
    // separators at 3, plus 5.5 px each side -- narrower than the
    // clustering's table width for seven characters.
    expect(pillBox({ x: 0, y: 0 }, '6·11·12', 1).right).toBe(24.75);
    expect(pillBox({ x: 0, y: 0 }, '6·11·12', 1).right).toBeLessThan(pillWidthPx(7) / 2);
    const marks = [dot('bajs-a', bike('4', false)), badge('bajs-a', '4')];
    expect(markerCensus(marks, anchor, OPEN, [over], 2).covered).toBe(1);
    expect(markerCensus(marks, anchor, OPEN, [beside], 2).covered).toBe(0);
    // Covered is not unlabelled: MapLibre drew the number, a passing tram hides it.
    expect(markerCensus(marks, anchor, OPEN, [over], 2).unlabelled).toBe(0);
    // Two pills over one number count twice, so a covered disc is never more than the pills over it.
    const both = markerCensus(marks, anchor, OPEN, [over, pillBox({ x: 700, y: 912 }, '14', 2)], 2);
    expect([both.covered, both.discPills]).toEqual([1, 2]);
    expect(markerCensus(marks, anchor, OPEN, [beside], 2).discPills).toBe(0);
  });

  it('asks a venue for its name: a programme count alone leaves it unlabelled, unless the surface names no city place or the collision pass held the name back', () => {
    const venue = (id: string, lon = 15.97) => dot(id, { category: 'culture', badge: '2', eventCount: 2, priority: 0 }, lon);
    // Named: a mark that says what it is.
    expect(markerCensus([venue('v'), badge('v', '2'), label('v', 'Gavella')], anchor, OPEN, [], 1).unlabelled).toBe(0);
    // A disc saying "2" with no name says how many, not what: the review's framed Gavella below zoom 13.
    expect(markerCensus([venue('v'), badge('v', '2')], anchor, OPEN, [], 1).unlabelled).toBe(1);
    // The whole-city window names no city place at all, and there the count is the mark's word.
    expect(markerCensus([venue('v'), badge('v', '2')], anchor, OPEN, [], 1, { shown: false, suppressed: new Set() }).unlabelled).toBe(0);
    // A name yielding to a passing pill is a hidden name, not a missing one.
    expect(markerCensus([venue('v'), badge('v', '2'), venue('w', 15.98), badge('w', '1')], anchor, OPEN, [], 1, { shown: true, suppressed: new Set(['v']) }).unlabelled).toBe(1);
    // A station's count is still its label, names on or off.
    expect(markerCensus([dot('b', bike('4', false)), badge('b', '4')], anchor, OPEN, [], 1).unlabelled).toBe(0);
  });

  it('writes the census on the container at idle, beside the pills, and the names a pill crosses', async () => {
    const { map, container, frame } = await harness({ lib: cityLib, extra: { symbolScale: 2 } });
    frame();
    // A box-aware stand-in: a query box answers the features whose anchor lies inside it.
    const everything = (): RenderedFeature[] => map.rendered as RenderedFeature[];
    map.queryRenderedFeatures = (geometry, options) => {
      map.queries.push(geometry);
      const inLayers = everything().filter((f) => !options?.layers || options.layers.includes(f.layer.id));
      if (!Array.isArray(geometry)) return inLayers;
      const [[x1, y1], [x2, y2]] = geometry as [[number, number], [number, number]];
      return inLayers.filter((f) => { const p = anchor(f); return p !== null && p.x >= x1 && p.x <= x2 && p.y >= y1 && p.y <= y2; });
    };
    map.rendered = [
      { layer: { id: 'vehicles' }, properties: { id: 'vehicle:1', short: '6' }, geometry: at(15.971, 45.81) },
      dot('bajs-a', bike('4', false)), badge('bajs-a', '4'),
      dot('bajs-b', bike('0', true), 15.95, 45.85), badge('bajs-b', '0'),
      dot('bajs-c', bike('', true), 15.96, 45.86),
      { layer: { id: 'stop-labels' }, properties: { id: '106_1', name: 'Trg bana J. Jelačića' }, geometry: at(15.9705, 45.8101) },
      { layer: { id: 'stop-labels' }, properties: { id: '107_1', name: 'Zrinjevac' }, geometry: at(15.99, 45.80) },
    ] as typeof map.rendered;
    map.fire('idle');
    expect(container.dataset.pills).toBe('6');
    expect(container.dataset.markers).toBe('3');
    expect(container.dataset.unlabelled).toBe('0');
    expect(container.dataset.bajs).toBe('counted:1;zero:1;blank:1;far:0');
    expect(container.dataset.overlaps).toBe('discs:1;names:1');
  });

  it('writes the names the collision pass held back beside the overlaps: a candidate of a visible name layer that MapLibre did not place, and a venue whose name yields is not unlabelled', async () => {
    const venue: MapPoint = { id: 'culture-1', lon: 15.972, lat: 45.814, title: 'Gavella', place: 'city', props: { category: 'culture', badge: '1', eventCount: 1, priority: 0 } };
    const stop = { id: '106_1', name: 'Trg bana J. Jelačića', lon: 15.9705, lat: 45.8101, routes: ['6'] } as never;
    const { map, container, frame, handle } = await harness({ lib: cityLib, points: [A, venue], extra: { symbolScale: 2, cityLabels: 'venues', stop } });
    map.zoom = 13.2;
    frame();
    // The venue's disc and count drew, its name did not; the screen's stop name drew.
    map.rendered = [
      dot('culture-1', { category: 'culture', badge: '1', eventCount: 1, priority: 0 }, 15.972, 45.814), badge('culture-1', '1'),
      { layer: { id: 'screen-stop-label' }, properties: { id: '106_1', name: 'Trg bana J. Jelačića' }, geometry: at(15.9705, 45.8101) },
    ] as typeof map.rendered;
    handle.update([A, venue], [CLOSURE]);
    map.fire('idle');
    expect(container.dataset.hiddenNames).toBe('1');
    expect(container.dataset.unlabelled).toBe('0');
    expect(container.dataset.discPills).toBe('0');
    // Placed now: nothing hidden.
    map.rendered = [...map.rendered, label('culture-1', 'Gavella')] as typeof map.rendered;
    handle.update([A, venue], [CLOSURE]);
    map.fire('idle');
    expect(container.dataset.hiddenNames).toBe('0');
    // The whole-city window draws no city names: nothing of theirs can be held back, and the count labels the venue.
    handle.setCityLabels!('none');
    map.rendered = map.rendered.filter((f) => f.layer.id !== CENSUS_LAYERS.labels) as typeof map.rendered;
    handle.update([A, venue], [CLOSURE]);
    map.fire('idle');
    expect(container.dataset.hiddenNames).toBe('0');
    expect(container.dataset.unlabelled).toBe('0');
  });

  it('counts the framed wall\u2019s venue as named at Kadar 8\u2019s zoom below 13: its name is drawn, or held back by a pill, never cut off by the zoom', async () => {
    const venue: MapPoint = { id: 'culture-1', lon: 15.972, lat: 45.814, title: 'Gavella', place: 'city', props: { category: 'culture', badge: '1', eventCount: 1, priority: 0 } };
    const { map, container, frame, handle } = await harness({ lib: cityLib, points: [A, venue], extra: { symbolScale: 2, cityLabels: 'venues' } });
    map.zoom = 12.86;
    frame();
    // The name did not draw (a pill over it): a hidden name, never a mark without one.
    map.rendered = [dot('culture-1', { category: 'culture', badge: '1', eventCount: 1, priority: 0 }, 15.972, 45.814), badge('culture-1', '1')] as typeof map.rendered;
    handle.update([A, venue], [CLOSURE]);
    map.fire('idle');
    expect(container.dataset.markers).toBe('1');
    expect(container.dataset.hiddenNames).toBe('1');
    expect(container.dataset.unlabelled).toBe('0');
    // The paired or exploring map ('all') keeps its own floor at 13: there a bare count below it is unlabelled.
    handle.setCityLabels!('all');
    handle.update([A, venue], [CLOSURE]);
    map.fire('idle');
    expect(container.dataset.unlabelled).toBe('1');
  });

  it('re-takes the census at the next idle after update(), never on an idle with nothing new', async () => {
    const { map, container, handle, frame } = await harness({ lib: cityLib });
    frame();
    map.rendered = [dot('bajs-a', bike('4', false)), badge('bajs-a', '4')] as typeof map.rendered;
    map.fire('idle');
    expect(container.dataset.markers).toBe('1');
    const queried = map.queries.length;
    map.rendered = [dot('bajs-a', bike('4', false)), badge('bajs-a', '4'), dot('bajs-b', bike('', false))] as typeof map.rendered;
    map.fire('idle');
    expect(map.queries.length).toBe(queried);
    expect(container.dataset.markers).toBe('1');
    handle.update([A], [CLOSURE]);
    map.fire('idle');
    expect(container.dataset.markers).toBe('2');
    expect(container.dataset.unlabelled).toBe('1');
  });

  // A live wall never idles (the 12 Hz pushes keep MapLibre painting), so a
  // render on a still camera takes the census once its key has settled.
  it('takes the census on a still frame that has settled when no idle comes, and never while the camera moves', async () => {
    const { map, container, handle, frame } = await harness({ lib: cityLib });
    frame();
    map.rendered = [dot('bajs-a', bike('4', false)), badge('bajs-a', '4')] as typeof map.rendered;
    // The first frame with an untaken key only starts the clock.
    map.fire('render');
    expect(container.dataset.markers).toBeUndefined();
    frame(PROBE_SETTLE_MS / 2);
    map.fire('render');
    expect(container.dataset.markers).toBeUndefined();
    frame(PROBE_SETTLE_MS / 2);
    map.fire('render');
    expect(container.dataset.markers).toBe('1');
    // Taken: frames after it ask MapLibre nothing, however long they run.
    const queried = map.queries.length;
    frame(PROBE_SETTLE_MS * 3);
    map.fire('render');
    expect(map.queries.length).toBe(queried);
    // New evidence while the camera moves waits for the camera.
    handle.update([A], [CLOSURE]);
    map.rendered = [dot('bajs-a', bike('4', false)), badge('bajs-a', '4'), dot('bajs-b', bike('', false))] as typeof map.rendered;
    map.moving = true;
    map.fire('render');
    frame(PROBE_SETTLE_MS * 2);
    map.fire('render');
    expect(container.dataset.markers).toBe('1');
    expect(map.queries.length).toBe(queried);
    // Still again: the key settles and the census follows the evidence.
    map.moving = false;
    map.fire('render');
    expect(container.dataset.markers).toBe('1');
    frame(PROBE_SETTLE_MS);
    map.fire('render');
    expect(container.dataset.markers).toBe('2');
    expect(container.dataset.unlabelled).toBe('1');
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

  it('a stale copy keeps the motion going (R-TE5); only a down feed stops it, and live again the motion resumes', async () => {
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

  it('an outage empties the drawn vehicles, not only the inputs: live to down clears the vehicle marks and their census and keeps the stops, the places and the city; live again, a vehicle comes back only from a fresh report (review-w, P1)', async () => {
    const bikes: MapPoint = { id: 'bajs-1', lon: 15.975, lat: 45.811, title: 'BAJS Trg', place: 'city', props: { category: 'bikes', badge: '4', spent: false, eventCount: 0, priority: 2 } };
    const { map, handle, frame, vehicles, container, clock } = await harness({ lib: cityLib, loadNetwork: async () => NET, points: [A, QUAKE, bikes] });
    const lastPush = () => vehicles().calls.at(-1) as FC | undefined;
    handle.setFeedState!('live');
    for (let i = 0; i < 12; i++) frame();
    expect(lastPush()!.features.map((f) => f.properties.id)).toEqual(['vehicle:1']);
    map.rendered = [{ layer: { id: 'vehicles' }, properties: { id: 'vehicle:1', short: '6' } }] as typeof map.rendered;
    map.fire('idle');
    expect(container.dataset.pills).toBe('6');
    // The kiosk's outage: the vehicle inputs emptied, then the feed state.
    const places = map.getSource('places')!.calls.length;
    const stops = map.getSource('stops')!.calls.length;
    handle.update([QUAKE, bikes], [CLOSURE]);
    handle.setFeedState!('down');
    expect(lastPush()!.features).toEqual([]);
    expect((map.getSource('bodies')!.calls.at(-1) as FC).features).toEqual([]);
    // What MapLibre draws now carries no pill, and the census says so.
    map.rendered = [];
    map.fire('idle');
    expect(container.dataset.pills).toBe('');
    // The stops were never touched and the places were set again, whole.
    expect(map.getSource('stops')!.calls.length).toBe(stops);
    expect(map.getSource('places')!.calls.length).toBeGreaterThan(places);
    expect((map.getSource('places')!.calls.at(-1) as FC).features.map((f) => f.properties.id)).toEqual(['q1']);
    expect((map.getSource('city-places')!.calls.at(-1) as FC).features.map((f) => f.properties.id)).toEqual(['bajs-1']);
    // Two hundred seconds into the outage: still nothing drawn.
    for (let i = 0; i < 20; i++) frame(10_000);
    expect(lastPush()!.features).toEqual([]);
    expect(handle.vehicles!()).toEqual([]);
    // Live again with no new report: the old tram does not come back from its history.
    handle.setFeedState!('live');
    for (let i = 0; i < 12; i++) frame();
    expect(lastPush()!.features).toEqual([]);
    // A fresh report draws it.
    handle.update([{ ...A, at: clock() - 1000 }, QUAKE, bikes], [CLOSURE]);
    for (let i = 0; i < 12; i++) frame();
    expect(lastPush()!.features.map((f) => f.properties.id)).toEqual(['vehicle:1']);
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

  // The public screen is read and touched from across a room: its stop rings
  // are small at city zoom and a finger is not a mouse, so the box a tap
  // queries is its own (kiosk/mapview.ts passes 28).
  it('queries a tap in the box the surface asked for: the desk’s eight pixels, the public screen’s own twenty-eight', async () => {
    const desk = await harness({ lib: cityLib });
    desk.map.fire('click', { point: { x: 100, y: 100 } });
    expect(desk.map.queries[0]).toEqual([[92, 92], [108, 108]]);
    const wall = await harness({ lib: cityLib, extra: { hitTolerancePx: 28 } });
    wall.map.fire('click', { point: { x: 100, y: 100 } });
    expect(wall.map.queries[0]).toEqual([[72, 72], [128, 128]]);
  });

  it('puts the city’s places UNDER the vehicles and its selection ring over them: a standing dot never hides a passing pill', async () => {
    const { map } = await harness({ lib: cityLib });
    const at = (id: string) => map.layers.findIndex((l) => l.id === id);
    const dots = at('vehicle-dots');
    expect(dots).toBeGreaterThan(0);
    // Everything the city publishes goes in below the first vehicle layer, in its own order.
    for (const id of ['city-path-lines', 'city-place-dots', 'city-place-badges', 'city-place-labels']) {
      expect(at(id), id).toBeGreaterThan(-1);
      expect(at(id), id).toBeLessThan(dots);
    }
    expect(at('city-path-lines')).toBeLessThan(at('city-place-dots'));
    expect(at('city-place-dots')).toBeLessThan(at('city-place-badges'));
    expect(at('city-place-badges')).toBeLessThan(at('city-place-labels'));
    // The ring marking what a person just tapped stays over every vehicle.
    expect(at('city-place-selection')).toBeGreaterThan(at('vehicles'));
    expect(at('city-place-selection')).toBeGreaterThan(dots);
  });

  it('draws the city places’ names or not as the surface asked, and turns them on and off on the one live map', async () => {
    const { map, handle } = await harness({ lib: cityLib, extra: { cityLabels: false } });
    const labels = map.layers.find((l) => l.id === 'city-place-labels')!;
    expect((labels.layout as Record<string, unknown>).visibility).toBe('none');
    // The dots and the badges are untouched: a BAJS count is not a name.
    expect((map.layers.find((l) => l.id === 'city-place-badges')!.layout as Record<string, unknown>).visibility).toBeUndefined();
    handle.setCityLabels!(true);
    expect(map.layout['city-place-labels']!.visibility).toBe('visible');
    delete map.layout['city-place-labels'];
    handle.setCityLabels!(true); // the same answer again moves nothing
    expect(map.layout['city-place-labels']).toBeUndefined();
    handle.setCityLabels!(false);
    expect(map.layout['city-place-labels']!.visibility).toBe('none');
    // A surface that asks for nothing keeps them, as every surface but the screen does.
    const phone = await harness({ lib: cityLib });
    expect((phone.map.layers.find((l) => l.id === 'city-place-labels')!.layout as Record<string, unknown>).visibility).toBe('visible');
  });

  it('reports every settled zoom to the surface that asked for it, whoever moved the camera', async () => {
    const cameras: { center: [number, number]; zoom: number }[] = [];
    const { map } = await harness({ extra: { onCamera: (camera: { center: [number, number]; zoom: number }) => cameras.push(camera) } });
    map.zoom = 14.2;
    map.fire('zoomend');
    expect(cameras).toEqual([{ center: [map.center.lng, map.center.lat], zoom: 14.2 }]);
    // A pan is not a zoom: the rule the screen reads from it is a zoom band.
    map.fire('moveend', {});
    expect(cameras).toHaveLength(1);
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

// Ruling 30. The whole-city window names interchanges, not the busiest
// corners: route count put Elka (3 trams among 11 routes) and Savski
// gaj-rotor (3 among 19) on the picture and left Trg bana Jelačića, Glavni
// kolodvor and Savski most off it. A count of TRAM routes is no better --
// the city's 19 tram routes overlap so heavily that 111 of the 114
// tram-served names see two or more, so "two trams" would name nearly every
// tram stop there is. What the flag reads is the artefact's own terminal bit.
describe('tram interchanges on the stop features (Ruling 30)', () => {
  const features = stopsToGeoJson(NET).features;
  const named = (name: string) => features.filter((f) => f.properties.name === name);
  const flagOf = (name: string) => {
    const rows = named(name);
    expect(rows.length, name).toBeGreaterThan(0);
    // The answer belongs to the name: every platform of it agrees.
    expect(new Set(rows.map((f) => f.properties.tramInterchange)).size, name).toBe(1);
    return rows[0]!.properties.tramInterchange;
  };

  it('names a tram terminus and passes over a corner that is only busy', () => {
    // Trams call and trips end here: the interchanges a rider means.
    for (const hub of ['Trg bana J. Jelačića', 'Glavni kolodvor', 'Savski most', 'Črnomerec', 'Kvaternikov trg', 'Ljubljanica', 'Dubrava']) {
      expect(flagOf(hub), hub).toBe(true);
    }
    // Many routes, a tram among them, nothing starts or ends here: a corner.
    for (const busy of ['Savski gaj-rotor', 'Elka', 'Heinzelova']) {
      expect(flagOf(busy), busy).toBe(false);
      // Tram-served all the same -- GTFS splits the name across platforms and
      // only some of them see the tram, which is why the flag is the name's.
      expect(named(busy).some((f) => f.properties.tram), busy).toBe(true);
    }
    // Rank would have said the opposite for both of those.
    expect(named('Savski gaj-rotor')[0]!.properties.rank).toBeGreaterThan(named('Trg bana J. Jelačića')[0]!.properties.rank);
  });

  it('picks a set the size of a city window, not of a timetable', () => {
    const hubs = new Set(features.filter((f) => f.properties.tramInterchange).map((f) => f.properties.name));
    const tramNames = new Set(features.filter((f) => f.properties.tram).map((f) => f.properties.name));
    expect(hubs.size).toBe(29);
    // The reduction is the point: the ranked reading named 41 and every
    // tram-served name is over a hundred.
    expect(tramNames.size).toBeGreaterThan(100);
    expect(hubs.size).toBeLessThan(tramNames.size / 3);
    // A stop with no tram is never an interchange however many buses end there.
    expect([...hubs].every((n) => tramNames.has(n))).toBe(true);
  });
});

// The names the style would draw with nothing in the way, read off the name
// layers' own expressions (city-map.ts nameCandidates): what data-hidden-names
// subtracts the placed names from.
describe('the names a layer would draw, from its own filter and text', () => {
  const PROZOR: overlays.ProzorOptions = { networkKinds: ['tram', 'bus'], stopRoutes: null, stopLabelMinRank: 4, overlapZoom: 13, stopRadius: false, labelPadding: 30 };
  const framed = overlays.overlayLayers(basemap.OVERLAY_LIGHT, { prozor: PROZOR, screenStopId: '106_1', scale: 2 });
  const byId = (id: string, from = framed) => from.find((l) => l.id === id)!;
  const stop = (id: string, extra: Record<string, unknown> = {}) => ({ id, name: `Stop ${id}`, routes: ['6'], rank: 4, tram: true, bus: false, label: true, tramInterchange: false, ...extra });

  it('evaluates the name layers’ filters the way MapLibre does', () => {
    const filter = byId(overlays.LAYERS.stopLabels).filter;
    expect(evaluateExpression(filter, stop('1'), 13)).toBe(true);
    expect(evaluateExpression(filter, stop('1', { label: false }), 13)).toBe(false);
    expect(evaluateExpression(filter, stop('106_1'), 13)).toBe(false); // the screen's own stop has its own label
    expect(evaluateExpression(filter, stop('1', { rank: 1 }), 13)).toBe(false);
    expect(evaluateExpression(filter, stop('1', { rank: 1, tramInterchange: true }), 13)).toBe(true);
    expect(evaluateExpression(filter, stop('1', { tram: false, bus: false }), 13)).toBe(false);
    // The phone's ranked steps are a zoom step inside the filter.
    const phone = overlays.overlayLayers(basemap.OVERLAY_LIGHT).find((l) => l.id === overlays.LAYERS.stopLabels)!.filter;
    expect(evaluateExpression(phone, stop('1', { rank: 2 }), 14)).toBe(false);
    expect(evaluateExpression(phone, stop('1', { rank: 2 }), 15)).toBe(true);
    // A route list reads as the array it is, never as a substring.
    expect(evaluateExpression(['in', '6', ['get', 'routes']], { routes: ['16'] }, 13)).toBe(false);
    expect(evaluateExpression(['in', '6', ['get', 'routes']], { routes: ['16', '6'] }, 13)).toBe(true);
    const venues = cityPlaces.cityLayers(basemap.OVERLAY_LIGHT, null, 2, 'venues').find((l) => l.id === CENSUS_LAYERS.labels)!;
    expect(evaluateExpression(venues.filter, { category: 'culture' }, 13)).toBe(true);
    expect(evaluateExpression(venues.filter, { category: 'bikes' }, 13)).toBe(false);
    expect(evaluateExpression(overlays.PLACE_FILTERS[overlays.LAYERS.placePharmacy], { place: 'pharmacy', address: 'Ilica 1' }, 13)).toBe(true);
    expect(evaluateExpression(overlays.PLACE_FILTERS[overlays.LAYERS.placePharmacy], { place: 'pharmacy' }, 13)).toBe(false);
    expect(evaluateExpression(['get', 'name'], { name: 'Trg' }, 13)).toBe('Trg');
    expect(evaluateExpression(['within', {}], {}, 13)).toBe(UNKNOWN_EXPRESSION);
  });

  it('lists the names of visible layers in range whose text is set and whose anchor is on the screen, and leaves out a layer it cannot read', () => {
    const point = (lon: number, lat: number, properties: Record<string, unknown>): SourcePoint => ({ geometry: { type: 'Point', coordinates: [lon, lat] }, properties });
    const sources: Record<string, SourcePoint[]> = {
      [overlays.SOURCES.stops]: [
        point(15.97, 45.81, stop('1')),
        point(15.97, 45.81, stop('2', { name: '' })), // nothing to write
        point(15.5, 45.81, stop('3')), // off the screen
        point(15.97, 45.81, stop('4', { label: false })), // filtered out
      ],
      [overlays.SOURCES.screenStop]: [point(15.9705, 45.8101, { id: '106_1', name: 'Trg bana J. Jelačića' })],
    };
    const project = ([lon, lat]: [number, number]) => ({ x: (lon - 15.9) * 1e4, y: (45.9 - lat) * 1e4 });
    const view = { width: 2000, height: 2000 };
    const layers = [byId(overlays.LAYERS.stopLabels), byId(overlays.LAYERS.screenStopLabel)];
    const names = nameCandidates(layers, (id) => sources[id] ?? [], 13.2, project, view);
    expect([...names.keys()].sort()).toEqual([nameKey(overlays.LAYERS.screenStopLabel, { id: '106_1' }), nameKey(overlays.LAYERS.stopLabels, { id: '1' })].sort());
    // Below the layer's own zoom: none of its names.
    expect([...nameCandidates(layers, (id) => sources[id] ?? [], 12.9, project, view).keys()]).toEqual([nameKey(overlays.LAYERS.screenStopLabel, { id: '106_1' })]);
    // Hidden, or unreadable: the layer is left out whole.
    const hidden = { ...layers[0]!, layout: { ...layers[0]!.layout, visibility: 'none' } };
    const strange = { ...layers[0]!, filter: ['within', {}] };
    expect(nameCandidates([hidden, strange], (id) => sources[id] ?? [], 13.2, project, view).size).toBe(0);
  });
});

// Decision 19: the public screen's stop names come back held and stay out of
// sight for at least a second, so no name blinks for less than one.
describe('the stop names\u2019 hysteresis (decision 19)', () => {
  const S = (...ids: string[]) => new Set(ids);
  const NONE = S();
  /** Runs `h` over [t, placed, covered] looks and answers each look's result. */
  const run = (h: ReturnType<typeof createNameHysteresis>, looks: [number, Set<string>, Set<string>?][]) => looks.map(([t, placed, covered]) => h.tick(t, placed, covered ?? NONE));

  it('draws the picture as it opens as it is: full ink, nothing held', () => {
    const h = createNameHysteresis();
    // Every name gets its full ink at the first look, and nothing else happens.
    expect(h.tick(0, S('a', 'b'), NONE)).toEqual({ held: null, opacity: new Map([['a', 1], ['b', 1]]) });
    expect(h.tick(500, S('a', 'b', 'c'), NONE)).toEqual({ held: null, opacity: new Map([['c', 1]]) });
    expect(h.held()).toEqual([]);
  });

  it('fades a hidden name out, keeps it out of sight for its full second even when MapLibre places it again at once, then fades it in and holds it', () => {
    const h = createNameHysteresis();
    h.tick(0, S('a'), NONE);
    const [out, half, gone, back, waiting, up, inHalf, full] = run(h, [
      [1000, NONE], [1000 + NAME_FADE_MS / 2, NONE], [1000 + NAME_FADE_MS, NONE],
      [1100 + NAME_FADE_MS, S('a')], // MapLibre places it again a moment later
      [1900, S('a')], [2000, S('a')], [2000 + NAME_FADE_MS / 2, S('a')], [2000 + NAME_FADE_MS, S('a')],
    ]);
    expect(out!.opacity.get('a')).toBe(1);
    expect(half!.opacity.get('a')).toBeCloseTo(0.5, 5);
    expect(gone!.opacity.get('a')).toBe(0);
    expect(back!.opacity.has('a')).toBe(false); // still out of sight: no blink
    expect(waiting!.held).toBeNull();
    expect(up!.held).toEqual(['a']); // its second is up: back, held from now
    expect(up!.opacity.get('a')).toBe(0);
    expect(inHalf!.opacity.get('a')).toBeCloseTo(0.5, 5);
    expect(full!.opacity.get('a')).toBe(1);
    expect(h.tick(2000 + NAME_HOLD_MS - 1, S('a'), NONE).held).toBeNull();
    expect(h.tick(2000 + NAME_HOLD_MS, S('a'), NONE).held).toEqual([]);
  });

  it('lets a pill that covers a held name end the hold at once and send the name out of sight for its full second', () => {
    const h = createNameHysteresis();
    run(h, [[0, S('a')], [100, NONE], [400, NONE], [1100, S('a')]]);
    expect(h.held()).toEqual(['a']);
    const covered = h.tick(1300, S('a'), S('a'));
    expect(covered.held).toEqual([]);
    expect(covered.opacity.get('a')).toBeCloseTo(2 / 3, 5); // caught two thirds into its fade in: fades out from there
    // MapLibre still places it: out of sight all the same, back only at 2300.
    const [, , early, back] = run(h, [[1300 + NAME_FADE_MS, S('a')], [2000, S('a')], [2299, S('a')], [2300, S('a')]]);
    expect(early!.held).toBeNull();
    expect(back!.held).toEqual(['a']);
  });

  it('brings a name first seen a second after the picture opened in like one coming back: it was out of sight all along', () => {
    const h = createNameHysteresis();
    h.tick(0, S('a'), NONE);
    const late = h.tick(NAME_MIN_HIDDEN_MS, S('a', 'c'), NONE);
    expect(late.held).toEqual(['c']);
    expect(late.opacity.get('c')).toBe(0);
    expect(h.tick(NAME_MIN_HIDDEN_MS + NAME_FADE_MS, S('a', 'c'), NONE).opacity.get('c')).toBe(1);
    expect([NAME_TICK_MS, NAME_HOLD_MS, NAME_MIN_HIDDEN_MS, NAME_FADE_MS]).toEqual([100, 2000, 1000, 300]);
  });

  it('never blinks for less than a second over a jittering pass: a pill hovering at a name\u2019s edge for six seconds', () => {
    const h = createNameHysteresis();
    // The plain layer's collision pass flips the name every 200 ms; while it
    // is held, the cooperative layer keeps it placed, as MapLibre does.
    let o = 1;
    const seen: boolean[] = [];
    for (let t = 0; t <= 6000; t += 100) {
      const placed = h.held().includes('a') || Math.floor(t / 200) % 2 === 0 ? S('a') : NONE;
      const r = h.tick(t, placed, NONE);
      if (r.opacity.has('a')) o = r.opacity.get('a')!;
      seen.push(placed.has('a') && o > 0);
    }
    const runs: { v: boolean; n: number }[] = [];
    for (const v of seen) { if (runs.at(-1)?.v === v) runs.at(-1)!.n++; else runs.push({ v, n: 1 }); }
    // Every run between the first and the last lasts a second or more.
    expect(runs.length).toBeGreaterThan(2);
    for (const r of runs.slice(1, -1)) expect(r.n * 100, JSON.stringify(runs)).toBeGreaterThanOrEqual(1000);
  });
});

describe('the public screen runs the stop names\u2019 hysteresis and times the own name\u2019s crossings (decision 19)', () => {
  it('moves a stop name that came back into the held layer, writes its fade by feature state, and counts the seconds a pill crosses the screen\u2019s own name', async () => {
    const prozor: overlays.ProzorOptions = { networkKinds: ['tram', 'bus'], stopRoutes: null, stopLabelMinRank: 4, overlapZoom: 12, stopRadius: false, labelPadding: 30 };
    const stop = { id: '106_1', name: 'Trg bana J. Jelačića', lon: 15.9705, lat: 45.8101, routes: ['6'] } as never;
    const { map, container, frame } = await harness({ lib: cityLib, extra: { prozor, basemapProfile: 'prozor', interactive: false, symbolScale: 2, stop } });
    const states: [string, unknown][] = [];
    (map as unknown as { setFeatureState: unknown }).setFeatureState = (f: { id: string }, st: unknown) => { states.push([f.id, st]); };
    const at = (lon: number, lat: number) => ({ type: 'Point', coordinates: [lon, lat] });
    const name = { layer: { id: 'stop-labels' }, properties: { id: '1_1', name: 'Zrinjevac' }, geometry: at(15.95, 45.85) };
    const own = { layer: { id: 'screen-stop-label' }, properties: { id: '106_1', name: 'Trg bana J. Jelačića' }, geometry: at(15.9705, 45.8101) };
    const pill = { layer: { id: 'vehicles' }, properties: { id: 'v', short: '6' }, geometry: at(15.9705, 45.8101) };
    const look = (rendered: unknown[], dt: number) => { frame(dt); map.rendered = rendered as typeof map.rendered; map.fire('render'); };
    look([name, own], NAME_TICK_MS);
    look([own], 200); // the pass hid it
    expect(map.filters['stop-labels-held']).toBeUndefined();
    look([name, own], 1500); // back after a second and a half: held, no wait
    expect(JSON.stringify(map.filters['stop-labels-held'])).toContain('"1_1"');
    expect(JSON.stringify(map.filters['stop-labels'])).toContain('"1_1"'); // and left out of the plain layer
    // Hidden again and back within the second: out of sight until its second is up, by feature state.
    look([own], NAME_HOLD_MS + 100); // hidden: it fades out by feature state
    expect(states.at(-1)).toEqual(['1_1', { o: 1 }]);
    look([own], NAME_FADE_MS);
    expect(states.at(-1)).toEqual(['1_1', { o: 0 }]);
    look([name, own], 200); // placed again within its second: stays out of sight
    expect(states.at(-1)).toEqual(['1_1', { o: 0 }]);
    // A pill over the own name: the seconds add up while it stays.
    const before = Number(container.dataset.ownNameCrossed ?? '0');
    look([own, pill], 500);
    look([own, pill], 500);
    expect(Number(container.dataset.ownNameCrossed) - before).toBeCloseTo(1, 1);
    // The census counts every other name a pill crosses, never the own one, and says the own name is drawn.
    map.rendered = [own, pill] as typeof map.rendered;
    map.fire('idle');
    expect(container.dataset.overlaps).toBe('discs:0;names:0');
    expect(container.dataset.ownName).toBe('Trg bana J. Jelačića');
  });
});
