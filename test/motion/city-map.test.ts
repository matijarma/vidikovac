// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CLOSURE_INK,
  createCityMap,
  OSM_ATTRIBUTION,
  SOURCE_UPDATE_HZ,
  STROKE_INK,
  VEHICLE_INK,
  vehiclesToGeoJson,
  type MapLine,
  type MapPoint,
} from '../../app/src/map/city-map';
import type { Drawn } from '../../app/src/motion/model';
import { toPlane } from '../../app/src/motion/geo';

// --- A MapLibre stand-in: records what the wrapper hands it, fires 'load' on demand.
interface FakeSource { type: string; data: unknown; calls: unknown[]; setData(d: unknown): void }
interface FakeImage { width: number; height: number; data: Uint8ClampedArray }
class FakeMap {
  static instances: FakeMap[] = [];
  readonly sources = new Map<string, FakeSource>();
  readonly layers: Record<string, unknown>[] = [];
  readonly images = new Map<string, { image: FakeImage; options: Record<string, unknown> }>();
  removed = false;
  readonly controls: unknown[] = [];
  readonly canvas: HTMLCanvasElement;
  private readonly handlers: Record<string, (() => void)[]> = {};
  constructor(public readonly options: Record<string, unknown>) {
    FakeMap.instances.push(this);
    // What maplibre-gl 5.24.0's Map._setupContainer builds: the canvas is a
    // focusable region named "Map" in English, then the control container.
    const container = options.container as HTMLElement;
    container.classList.add('maplibregl-map');
    const canvasContainer = document.createElement('div');
    canvasContainer.className = 'maplibregl-canvas-container maplibregl-interactive';
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'maplibregl-canvas';
    this.canvas.setAttribute('tabindex', '0');
    this.canvas.setAttribute('aria-label', 'Map');
    this.canvas.setAttribute('role', 'region');
    canvasContainer.appendChild(this.canvas);
    container.appendChild(canvasContainer);
    const controls = document.createElement('div');
    controls.className = 'maplibregl-control-container';
    container.appendChild(controls);
  }
  on(type: string, cb: () => void): void { (this.handlers[type] ??= []).push(cb); }
  addControl(control: unknown): void { this.controls.push(control); }
  getCanvas(): HTMLCanvasElement { return this.canvas; }
  addImage(id: string, image: FakeImage, options: Record<string, unknown>): void { this.images.set(id, { image, options }); }
  addSource(id: string, spec: { type: string; data: unknown }): void {
    const calls: unknown[] = [];
    this.sources.set(id, { type: spec.type, data: spec.data, calls, setData: (d) => { calls.push(d); } });
  }
  addLayer(layer: Record<string, unknown>): void { this.layers.push(layer); }
  getSource(id: string): FakeSource | undefined { return this.sources.get(id); }
  remove(): void { this.removed = true; }
  load(): void { for (const cb of this.handlers.load ?? []) cb(); }
}
class FakeControl { constructor(public readonly options: Record<string, unknown> = {}) {} }
const lib = { Map: FakeMap, AttributionControl: FakeControl, NavigationControl: FakeControl };

const T0 = Date.parse('2026-09-12T10:00:00Z');
const FRAME_MS = 1000 / 60;
/** Degrees of longitude per metre at 45.8 N. */
const M_TO_LON = 1 / (111_320 * Math.cos((45.8 * Math.PI) / 180));
const A: MapPoint = { id: 'vehicle:1', lon: 15.97, lat: 45.81, title: '6', routeId: '6', at: T0 - 30_000, type: 0 };
/** The same vehicle reported 100 m east, thirty seconds later. */
const B: MapPoint = { ...A, lon: 15.97 + 100 * M_TO_LON, at: T0 + 50 };
const QUAKE: MapPoint = { id: 'q1', lon: 14.36, lat: 45.45, title: 'M 1.6' };
const CLOSURE: MapLine = { id: 'c1', title: 'Grada Vukovara', coordinates: [[15.959, 45.799], [15.957, 45.799]] };

const flush = async (): Promise<void> => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
type FC = { features: { geometry: { coordinates: [number, number] }; properties: { id: string } }[] };
const metres = (fc: unknown, id: string, to: MapPoint): number => {
  const f = (fc as FC).features.find((x) => x.properties.id === id);
  if (!f) return Number.NaN;
  const p = toPlane(f.geometry.coordinates[0], f.geometry.coordinates[1]);
  const q = toPlane(to.lon, to.lat);
  return Math.hypot(p.x - q.x, p.y - q.y);
};

async function harness(opts: { points?: MapPoint[]; lines?: MapLine[]; reducedMotion?: boolean; loadNetwork?: () => Promise<null> } = {}) {
  let t = T0;
  // Frame requests by handle, so cancelAnimationFrame really withdraws one.
  const queue = new Map<number, (ts: number) => void>();
  let nextHandle = 0;
  const container = document.createElement('div');
  document.body.appendChild(container);
  const loadNetwork = opts.loadNetwork ?? vi.fn(async () => null);
  const handle = createCityMap(
    { container, ariaLabel: 'Karta', points: opts.points ?? [A], lines: opts.lines ?? [CLOSURE], reducedMotion: opts.reducedMotion, loadNetwork },
    { loadMaplibre: async () => lib as never, raf: (cb) => { queue.set(++nextHandle, cb); return nextHandle; }, cancel: (h) => { queue.delete(h); }, now: () => t },
  );
  await flush();
  const map = FakeMap.instances[FakeMap.instances.length - 1]!;
  map.load();
  /** Advances the clock and runs every frame callback that was waiting. */
  const frame = (dt = FRAME_MS): void => { t += dt; const due = [...queue.values()]; queue.clear(); for (const cb of due) cb(t); };
  const vehicles = (): FakeSource => map.getSource('vehicles')!;
  /** Frame requests outstanding: 0 means nothing will paint until asked. */
  const pending = (): number => queue.size;
  return { handle, map, container, frame, vehicles, loadNetwork, pending };
}

afterEach(() => { FakeMap.instances.length = 0; document.body.replaceChildren(); });

describe('the full map re-inked (R-O1)', () => {
  it('draws closures in #ff9d9d, vehicles in #f2ead8 and strokes in #16226b, and nothing else', async () => {
    expect([CLOSURE_INK, VEHICLE_INK, STROKE_INK]).toEqual(['#ff9d9d', '#f2ead8', '#16226b']);
    const { map } = await harness();
    const paint = JSON.stringify(map.layers.map((l) => l.paint));
    const hexes = [...new Set(paint.match(/#[0-9a-f]{6}/gi)?.map((h) => h.toLowerCase()))].sort();
    expect(hexes).toEqual(['#16226b', '#f2ead8', '#ff9d9d']);
    const closures = map.layers.find((l) => l.id === 'closures') as { paint: Record<string, unknown> };
    expect(closures.paint['line-color']).toBe(CLOSURE_INK);
  });

  it('draws vehicles as a symbol layer over two SDF images, one per shape, coloured by paint so one image serves both faces', async () => {
    const { map } = await harness();
    expect(map.images.get('vehicle-tram')?.options).toMatchObject({ sdf: true });
    expect(map.images.get('vehicle-bus')?.options).toMatchObject({ sdf: true });
    const tram = map.images.get('vehicle-tram')!.image;
    const bus = map.images.get('vehicle-bus')!.image;
    expect(tram.width).toBeGreaterThan(tram.height); // a tram is visibly thinner than a bus
    expect(bus.width).toBe(bus.height);
    const vehicles = map.layers.find((l) => l.id === 'vehicles') as { type: string; layout: Record<string, unknown>; paint: Record<string, unknown> };
    expect(vehicles.type).toBe('symbol');
    expect(vehicles.layout['icon-allow-overlap']).toBe(true); // every vehicle shows; none is culled by collision
    expect(vehicles.layout['icon-rotation-alignment']).toBe('map');
    // The image lies east-west; compass bearing minus 90 stands a north-bound tram upright.
    expect(vehicles.layout['icon-rotate']).toEqual(['-', ['get', 'bearing'], 90]);
    expect(vehicles.paint['icon-color']).toBe(VEHICLE_INK);
    expect(vehicles.paint['icon-halo-color']).toBe(STROKE_INK);
  });
});

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
    expect(first).toBeGreaterThan(1); // not the new report
    expect(first).toBeLessThan(100); // and already off the old one
    expect(last).toBeLessThan(first); // converging, frame after frame
    expect(metres(pushed[pushed.length - 1], 'vehicle:1', A)).toBeGreaterThan(0.5);
  });

  it('never puts a vehicle report into the places source, and draws a place where it was given', async () => {
    const { map } = await harness({ points: [A, QUAKE] });
    const places = map.getSource('places')!.data as FC;
    expect(places.features.map((f) => f.properties.id)).toEqual(['q1']);
    expect(places.features[0]!.geometry.coordinates).toEqual([14.36, 45.45]);
  });

  it('skips stale vehicles and rotates a tram to its heading, clockwise from north', () => {
    const drawn: Drawn[] = [
      { id: 'a', type: 0, p: toPlane(15.97, 45.81), heading: { x: 1, y: 0 }, speed: 5, confidence: 1, onShape: null, stale: false },
      { id: 'b', type: 3, p: toPlane(15.98, 45.82), heading: null, speed: 0, confidence: 0.2, onShape: null, stale: false },
      { id: 'c', type: 0, p: toPlane(15.99, 45.83), heading: null, speed: 0, confidence: 1, onShape: null, stale: true },
    ];
    const fc = vehiclesToGeoJson(drawn, null);
    expect(fc.features.map((f) => f.properties.id)).toEqual(['a', 'b']);
    expect(fc.features[0]!.properties).toMatchObject({ icon: 'vehicle-tram', bearing: 90 });
    expect(fc.features[0]!.geometry.coordinates[0]).toBeCloseTo(15.97, 6);
    expect(fc.features[1]!.properties).toMatchObject({ icon: 'vehicle-bus', bearing: 0 });
    expect(fc.features[1]!.properties.alpha).toBeLessThan(fc.features[0]!.properties.alpha);
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

  it('under reduced motion steps once a second on a timer, with no interpolation and no frame requests at all (R-F6)', async () => {
    vi.useFakeTimers();
    try {
      const { handle, frame, vehicles, pending } = await harness({ reducedMotion: true });
      expect(pending()).toBe(0); // never asked the compositor for a frame
      handle.update([B], [CLOSURE]);
      const before = vehicles().calls.length;
      for (let i = 0; i < 60; i++) frame(); // a second of would-be frames: nothing is listening to them
      expect(vehicles().calls.length - before).toBe(0);
      vi.advanceTimersByTime(1000); // one clock tick
      expect(vehicles().calls.length - before).toBeLessThanOrEqual(2);
      expect(pending()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('parks when nothing moves and wakes on the next update', async () => {
    const { handle, frame, vehicles, container } = await harness();
    for (let i = 0; i < 20; i++) frame();
    const parkedAt = container.dataset.frames;
    frame(); frame();
    expect(container.dataset.frames).toBe(parkedAt); // a standing vehicle costs no frames
    handle.update([B], [CLOSURE]);
    const before = vehicles().calls.length;
    frame(); frame();
    expect(vehicles().calls.length).toBeGreaterThan(before);
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
    frame();
    frame();
    expect(container.dataset.frames).toBe(pausedAt);
    expect(pending()).toBe(0);
    handle.resume();
    expect(pending()).toBe(1); // asking for frames again
    frame();
    frame();
    expect(container.dataset.frames).toBe('1'); // a fresh start(): the counter restarted and frames are drawn again
  });

  it('applies a report that arrived before the library loaded, once, and stops everything on destroy', async () => {
    let t = T0;
    const queue: ((ts: number) => void)[] = [];
    const container = document.createElement('div');
    document.body.appendChild(container);
    const handle = createCityMap(
      { container, ariaLabel: 'Karta', points: [], lines: [], loadNetwork: async () => null },
      { loadMaplibre: async () => lib as never, raf: (cb) => { queue.push(cb); return 1; }, cancel: () => {}, now: () => t },
    );
    handle.update([QUAKE], [CLOSURE]); // before 'load'
    await flush();
    const map = FakeMap.instances[FakeMap.instances.length - 1]!;
    map.load();
    expect((map.getSource('places')!.data as FC).features).toHaveLength(1);
    expect((map.getSource('closures')!.data as FC).features).toHaveLength(1);
    expect(container.getAttribute('role')).toBe('region');
    expect(container.getAttribute('aria-label')).toBe('Karta');
    handle.destroy();
    expect(map.removed).toBe(true);
    const frames = container.dataset.frames;
    t += FRAME_MS;
    for (const cb of queue.splice(0)) cb(t);
    expect(container.dataset.frames).toBe(frames);
  });

  it('asks for the network once and hands it to the model', async () => {
    const loadNetwork = vi.fn(async () => null);
    const { handle } = await harness({ loadNetwork });
    handle.update([A], []);
    expect(loadNetwork).toHaveBeenCalledTimes(1);
  });
});

// --- R-F5: the map container is a region, so MapLibre's controls and the
// attribution link are exposed by name; the image is the canvas alone. -----
describe('the map for people who cannot see it (R-F5)', () => {
  it('names the container as a region from the first moment, and puts role="img" with the same label on the canvas alone, which stays keyboard-operable', async () => {
    let t = T0;
    const container = document.createElement('div');
    document.body.appendChild(container);
    const handle = createCityMap(
      { container, ariaLabel: 'Karta: 3 vozila, 1 zatvaranje', points: [], lines: [], loadNetwork: async () => null },
      { loadMaplibre: async () => lib as never, raf: () => 1, cancel: () => {}, now: () => t },
    );
    // Before the library has even loaded: the landmark already exists.
    expect(container.getAttribute('role')).toBe('region');
    expect(container.getAttribute('aria-label')).toBe('Karta: 3 vozila, 1 zatvaranje');
    await flush();
    const canvas = container.querySelector<HTMLCanvasElement>('canvas.maplibregl-canvas')!;
    expect(canvas.getAttribute('role')).toBe('img');
    // One source of truth for the label: map-slots.ts rewrites the container's
    // aria-label on every poll, so the canvas points at the container.
    expect(container.id).not.toBe('');
    expect(canvas.getAttribute('aria-labelledby')).toBe(container.id);
    expect(canvas.hasAttribute('aria-label')).toBe(false); // MapLibre's English "Map" is gone, not merely overridden
    // The arrow keys still pan and +/- still zoom (WCAG 2.1.1): MapLibre's tab stop stays.
    expect(canvas.getAttribute('tabindex')).toBe('0');
    // No other element between the region and its controls carries a role
    // whose children are presentational: nothing focusable is nested in an image.
    for (const el of container.querySelectorAll('[role=img]')) expect(el.querySelector('[tabindex], button, a[href]')).toBeNull();
    handle.destroy();
  });

  it('keeps an existing container id rather than renaming an element the page already refers to', async () => {
    const container = document.createElement('div');
    container.id = 'u-pokretu-map-slot';
    document.body.appendChild(container);
    createCityMap(
      { container, ariaLabel: 'Karta', points: [], lines: [], loadNetwork: async () => null },
      { loadMaplibre: async () => lib as never, raf: () => 1, cancel: () => {}, now: () => T0 },
    );
    await flush();
    expect(container.id).toBe('u-pokretu-map-slot');
    expect(container.querySelector('canvas')!.getAttribute('aria-labelledby')).toBe('u-pokretu-map-slot');
  });

  it('hands MapLibre the OpenStreetMap credit as a link to the copyright page, the one the licence asks for, and nothing feed-derived', async () => {
    const { map } = await harness();
    const attribution = map.controls.find((c) => (c as FakeControl).options.customAttribution !== undefined) as FakeControl;
    expect(attribution).toBeDefined();
    const html = String(attribution.options.customAttribution);
    expect(html).toContain('href="https://www.openstreetmap.org/copyright"');
    expect(html).toContain('© OpenStreetMap contributors');
    expect(html).toContain('rel="noopener noreferrer"');
    // The style's own source attribution stays the plain text, which MapLibre
    // drops as a substring of the link, so the credit is shown exactly once.
    expect(html).toContain(OSM_ATTRIBUTION);
  });
});
