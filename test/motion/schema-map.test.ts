// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { createSchemaMap, type SchemaFrame } from '../../app/src/motion/schema-map';
import { LABEL_MIN_PX_PER_UNIT, PILL_EDGE_MARGIN_PX, SCHEMA_FOCUS_DIM_ALPHA } from '../../app/src/motion/schema-paint';
import { PILL_INKS } from '../../app/src/motion/pills';
import { DENSITY } from '../../app/src/ui/canvas';
import type { CityMapHandle, CityMapOptions, MapPoint } from '../../app/src/map/city-map';
import { toLonLat } from '../../shared/motion/geo';
import { corridorSpec, syntheticNetwork } from './synthetic-network';
import * as vehicleCard from '../../app/src/motion/vehicle-card';

const NOW = Date.parse('2026-09-16T10:00:00Z');
const NET = syntheticNetwork(corridorSpec());
const ART = {
  version: 1, source: 'synthetic-test.svg', builtAt: '2026-09-16', feedVersion: NET.feedVersion,
  box: [1190, 840],
  lines: [{
    route: '1', night: false, colour: '#cc706f', width: 3.5345,
    pts: [[100, 400], [1100, 400]],
    stops: [{ u: 0, name: 'T0', ownCircle: true }, { u: 500, name: 'T600', ownCircle: true }, { u: 1000, name: 'C1200', ownCircle: true }],
  }],
  stops: [
    { name: 'T0', x: 100, y: 400, r: 2, half: null, terminal: true, label: { text: 'T0', rows: 1, x: 100, y: 388, rot: 0, anchor: 'start' } },
    { name: 'T600', x: 600, y: 400, r: 2, half: null, terminal: false, label: { text: 'Two\nrows', rows: 2, x: 605, y: 388, rot: -Math.PI / 4, anchor: 'start' } },
    { name: 'C1200', x: 1100, y: 400, r: 2, half: 'D', terminal: true, label: { text: 'C1200', rows: 1, x: 1100, y: 388, rot: 0, anchor: 'end' } },
  ],
  water: [{ pts: [[100, 700], [1100, 700]], width: 12, colour: '#738ec8' }],
};
const TRAM: MapPoint = {
  id: 'tram', title: '1', routeId: '1', type: 0,
  // Deliberately nowhere near the plan: the reported coordinate never paints.
  lon: 16, lat: 46, at: NOW, path: '1_0', speed: 10, confidence: 0.9,
  headsign: 'C1200', nextStopId: 'T600',
  plan: { on: 'path', knots: [[NOW, 200], [NOW + 60_000, 800]] },
};
// A second tram line drawn over the first, sharing its T0/T600 stops: two
// vehicles on it land a few artwork units apart, which is where the pills
// merge into one cluster.
const TWO_LINE_ART = {
  ...ART,
  lines: [
    ART.lines[0],
    {
      route: '2', night: false, colour: '#4a8f5a', width: 3.5345,
      pts: [[100, 410], [1100, 410]],
      stops: [{ u: 0, name: 'T0', ownCircle: true }, { u: 500, name: 'T600', ownCircle: true }],
    },
  ],
};
const POINTS: MapPoint[] = [
  TRAM,
  { ...TRAM, id: 'unmapped', routeId: '2', path: '2_0' },
  { ...TRAM, id: 'wrong-line', routeId: '2', path: '1_0' },
  { ...TRAM, id: 'free', plan: undefined, path: undefined },
  { ...TRAM, id: 'bus', routeId: '109', type: 3, path: 'B109' },
];

interface Call { op: string; args: unknown[]; font?: string }
const handles: CityMapHandle[] = [];
const flush = async (): Promise<void> => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

function harness(extra: Partial<CityMapOptions> = {}, pending?: Promise<unknown>) {
  let time = NOW;
  let size = { width: 390, height: 400 };
  let id = 0;
  const queue = new Map<number, (t: number) => void>();
  const calls = new Map<HTMLCanvasElement, Call[]>();
  const container = document.createElement('div');
  container.getBoundingClientRect = () => ({ ...size, left: 0, top: 0 }) as DOMRect;
  container.style.setProperty('--tone-text-primary', '#0c1250');
  container.style.setProperty('--tone-surface-canvas', '#f4f2ec');
  container.style.setProperty('--tone-tint-transit', '#ebe8df');
  document.body.appendChild(container);
  vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
    return ({ ...size, left: 0, top: 0 }) as DOMRect;
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    if (!calls.has(this)) calls.set(this, []);
    const log = calls.get(this)!;
    const props: Record<string, unknown> = {};
    // A name is measured before it is placed (F4), so the double answers
    // with a monospace stand-in: every glyph 0.6 em of the current font.
    const measureText = (text: string) => ({
      width: String(text).length * 0.6 * Number(/([\d.]+)px/.exec(String(props.font ?? ''))?.[1] ?? 10),
    });
    return new Proxy({}, {
      get: (_t, k: string) => k in props ? props[k]
        : k === 'measureText' ? measureText
        : (...args: unknown[]) => log.push({ op: k, args, font: props.font as string }),
      set: (_t, k: string, value: unknown) => { props[k] = value; log.push({ op: k, args: [value] }); return true; },
    }) as CanvasRenderingContext2D;
  } as never);
  const onSelect = vi.fn();
  const onUserMove = vi.fn();
  const onStatus = vi.fn();
  const onNetwork = vi.fn();
  const frames: SchemaFrame[] = [];
  const loadSchema = vi.fn((_signal: AbortSignal) => pending ?? Promise.resolve(ART));
  const handle = createSchemaMap({
    container, ariaLabel: 'Shema', points: POINTS, loadNetwork: async () => NET,
    onSelect, onUserMove, onStatus, onNetwork, ...extra,
  }, {
    now: () => time,
    raf: (cb) => { queue.set(++id, cb); return id; },
    cancel: (h) => { queue.delete(h); },
    loadSchema,
    onFrame: (frame) => frames.push(frame),
  });
  handles.push(handle);
  const frame = (ms = 1000 / 60): void => {
    time += ms;
    const due = [...queue.values()];
    queue.clear();
    for (const cb of due) cb(time);
  };
  const canvas = () => container.querySelector<HTMLCanvasElement>('[data-testid=schema-vehicles]')!;
  const staticCalls = () => calls.get(container.querySelector<HTMLCanvasElement>('[data-testid=schema-routes]')!) ?? [];
  const vehicleCalls = () => calls.get(canvas()) ?? [];
  const buttons = () => [...container.querySelectorAll<HTMLButtonElement>('[data-testid=vehicle-list] button')];
  return {
    handle, container, onSelect, onUserMove, onStatus, onNetwork, loadSchema, frames,
    frame, canvas, staticCalls, vehicleCalls, buttons, pendingFrames: () => queue.size,
    resize: (width: number, height: number) => { size = { width, height }; handle.resize!(); },
  };
}

function key(el: HTMLElement, value: string, shiftKey = false): void {
  el.dispatchEvent(new KeyboardEvent('keydown', { key: value, shiftKey, bubbles: true, cancelable: true }));
}

afterEach(() => {
  for (const handle of handles.splice(0)) handle.destroy();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

it('shares the accessible scene contract while drawing only placeable plan motion, with legible viewports and cancellable map lifecycle', async () => {
  const h = harness();
  expect(h.handle.status!()).toBe('loading');
  await flush();
  expect(h.handle.status!()).toBe('ready');
  expect(h.handle.network!()).toBe(NET);
  expect(h.onNetwork).toHaveBeenCalledWith(NET);
  expect(h.loadSchema).toHaveBeenCalledTimes(1);
  expect(h.container.querySelectorAll('canvas')).toHaveLength(2);
  h.frame();
  const first = h.frames.at(-1)!;
  expect(first.marks.map((m) => m.id)).toEqual(['tram']);
  // The vehicle's own number, painted in the city map's tram-blue pill. The
  // ZET line colour stays where it belongs: on the line under the pill.
  expect(first.marks[0]).toMatchObject({ label: '1', pill: 'single' });
  expect(h.vehicleCalls().some((c) => c.op === 'fillStyle' && c.args[0] === PILL_INKS.light.tram)).toBe(true);
  expect(h.vehicleCalls().some((c) => c.op === 'fillText' && c.args[0] === '1')).toBe(true);
  expect(h.buttons().map((b) => b.dataset.vehicle)).toEqual(['tram']);
  expect(h.buttons()[0].textContent).toContain('C1200');
  expect(h.buttons()[0].textContent).toContain('T600');
  expect(h.staticCalls().filter((c) => c.op === 'fillText')).toHaveLength(0);
  const routesBefore = h.staticCalls().length;
  for (let i = 0; i < 60; i++) h.frame();
  const moving = h.frames.at(-1)!;
  expect(moving.marks[0].x).toBeGreaterThan(first.marks[0].x);
  expect(Number(h.canvas().dataset.frames)).toBeGreaterThan(0);
  expect(h.staticCalls()).toHaveLength(routesBefore); // static artwork is not restroked by vehicle frames
  const geo = h.handle.vehicles!().find((v) => v.id === 'tram')!;
  const drawn = moving.drawn.find((v) => v.id === 'tram')!;
  const [lon, lat] = toLonLat(drawn.p);
  expect(geo).toMatchObject({ lon, lat, kind: 'tram', headsign: 'C1200', nextStopId: 'T600' });
  expect(geo.lon).not.toBe(TRAM.lon);

  const mark = moving.marks[0];
  for (const type of ['pointerdown', 'pointerup']) h.canvas().dispatchEvent(new PointerEvent(type, {
    pointerId: 1, pointerType: 'mouse', button: 0, clientX: mark.x / 2, clientY: mark.y / 2, bubbles: true,
  }));
  expect(h.onSelect).toHaveBeenLastCalledWith({ kind: 'vehicle', id: 'tram' });
  expect(h.container.querySelector('[role=dialog]')).toBeNull();
  const button = h.buttons()[0];
  button.focus();
  h.handle.update(POINTS, []);
  expect(h.buttons()[0]).toBe(button);
  expect(document.activeElement).toBe(button);
  h.handle.setLocale!('en');
  expect(h.buttons()[0]).toBe(button);
  expect(h.buttons()[0].textContent).toContain('towards');
  h.canvas().focus();
  key(h.canvas(), 'Escape');
  expect(h.onSelect).toHaveBeenLastCalledWith(null);
  h.handle.select!({ kind: 'stop', id: 'T600' });
  key(h.canvas(), 'Escape');
  expect(h.handle.selection!()).toBeNull();
  key(h.canvas(), 'ArrowRight');
  expect(h.handle.selection!()).toEqual({ kind: 'vehicle', id: 'tram' });
  expect(document.activeElement).toBe(h.canvas());

  h.handle.follow!('tram');
  expect(h.handle.following!()).toBe('tram');
  key(h.canvas(), 'ArrowRight', true);
  expect(h.handle.following!()).toBeNull();
  expect(h.onUserMove).toHaveBeenLastCalledWith(null);
  for (let i = 0; i < 8; i++) key(h.canvas(), '+');
  h.frame();
  expect(h.frames.at(-1)!.viewport.scale).toBeGreaterThanOrEqual(LABEL_MIN_PX_PER_UNIT);
  expect(h.staticCalls().some((c) => c.op === 'fillText')).toBe(true);
  // F4: a name lies flat across the lines -- nothing on the static layer
  // turns any more -- and it is haloed before it is inked.
  expect(h.staticCalls().some((c) => c.op === 'rotate')).toBe(false);
  expect(h.staticCalls().filter((c) => c.op === 'strokeText' || c.op === 'fillText')[0]?.op).toBe('strokeText');
  // One repaint of the static layer on its own, since the log accumulates:
  // each of the two terminals carries a chip in the line's own colour,
  // numbered as the network names the route (net.routes.get('1').short).
  const before = h.staticCalls().length;
  h.handle.setTheme!('light');
  const pass = h.staticCalls().slice(before);
  expect(pass.some((c) => c.op === 'fillStyle' && c.args[0] === '#cc706f')).toBe(true);
  expect(pass.filter((c) => c.op === 'fillText' && c.args[0] === '1')).toHaveLength(2);
  h.handle.follow!('tram');
  h.frame();
  const describe = vi.spyOn(vehicleCard, 'describeVehicle');
  for (let i = 0; i < 5; i++) h.frame();
  expect(describe).not.toHaveBeenCalled(); // a pan/follow frame is not a fresh poll
  describe.mockRestore();
  h.handle.follow!(null);
  h.handle.setFitPadding!({ bottom: 180 });
  h.handle.fit!('city');
  h.frame();
  expect(h.frames.at(-1)!.viewport.scale).toBeLessThan(LABEL_MIN_PX_PER_UNIT);

  h.handle.setFeedState!('stale');
  expect(h.pendingFrames()).toBe(1);
  h.handle.setFeedState!('down');
  const frozen = h.handle.vehicles!();
  const heldFrames = h.canvas().dataset.frames;
  expect(h.pendingFrames()).toBe(0);
  h.handle.update(POINTS, []);
  h.frame(1000);
  expect(h.handle.vehicles!()).toEqual(frozen);
  expect(h.canvas().dataset.frames).toBe(heldFrames);
  h.handle.pause();
  h.handle.setFeedState!('stale');
  expect(h.pendingFrames()).toBe(0);
  h.handle.resume();
  expect(h.pendingFrames()).toBe(1);
  h.handle.setModes!(new Set([3]));
  h.frame();
  expect(h.frames.at(-1)!.marks).toHaveLength(0);
  expect(h.buttons()).toHaveLength(0);
  h.handle.setModes!(null);
  h.frame();
  expect(h.frames.at(-1)!.marks.map((m) => m.id)).toEqual(['tram']);
  h.handle.destroy();
  expect(h.pendingFrames()).toBe(0);
  expect(h.container.querySelector('canvas')).toBeNull();

  const kiosk = harness({ interactive: false, stop: { id: 'T600', name: 'T600', lon: 0, lat: 0 } });
  await flush();
  kiosk.resize(1920, 1080);
  kiosk.frame();
  expect(kiosk.canvas().hasAttribute('tabindex')).toBe(false);
  expect(kiosk.buttons()).toHaveLength(0);
  const text = kiosk.staticCalls().filter((c) => c.op === 'fillText');
  expect(text.length).toBeGreaterThan(0);
  expect(text.every((c) => Number(c.font?.match(/([\d.]+)px/)?.[1]) / 2 >= 24)).toBe(true);
  const crop = kiosk.frames.at(-1)!.viewport;
  kiosk.handle.setView!({ center: [15, 45], zoom: 2, selectedStop: 'T0' });
  kiosk.frame();
  expect(kiosk.frames.at(-1)!.viewport).toEqual(crop);
  kiosk.handle.setStop!(null);
  const afterStop = kiosk.staticCalls().length;
  kiosk.frame();
  expect(kiosk.frames.at(-1)!.labels).toBe(false);
  expect(kiosk.staticCalls().slice(afterStop).some((c) => c.op === 'fillText')).toBe(false);

  let resolve!: (raw: unknown) => void;
  const late = harness({}, new Promise((r) => { resolve = r; }));
  late.handle.pause();
  late.handle.destroy();
  expect(late.loadSchema.mock.calls[0][0].aborted).toBe(true);
  resolve(ART);
  await flush();
  late.handle.resume();
  expect(late.pendingFrames()).toBe(0);
  expect(late.onStatus).not.toHaveBeenCalled();
  expect(late.onNetwork).not.toHaveBeenCalled();
  expect(late.container.querySelector('canvas')).toBeNull();

  const bootFit = harness();
  bootFit.handle.select!({ kind: 'stop', id: 'T600' }, { fit: true });
  await flush();
  bootFit.frame();
  expect(bootFit.frames.at(-1)!.viewport.scale).toBeGreaterThanOrEqual(LABEL_MIN_PX_PER_UNIT);
});

it('merges two trams a pill apart into one cluster mark naming both lines, while the list keeps a button each', async () => {
  const h = harness({
    points: [{ ...TRAM, id: 'a' }, { ...TRAM, id: 'b', routeId: '2', path: '2_0' }],
  }, Promise.resolve(TWO_LINE_ART));
  await flush();
  h.frame();
  const marks = h.frames.at(-1)!.marks;
  expect(marks).toHaveLength(1);
  expect(marks[0]).toMatchObject({ pill: 'cluster', label: '1·2' });
  expect([...(marks[0].ids ?? [])].sort()).toEqual(['a', 'b']);
  // One merged pill on the canvas is still two vehicles for a reader.
  expect(h.buttons().map((b) => b.dataset.vehicle)).toEqual(['a', 'b']);
});

it('line focus dims the other lines on the diagram instead of hiding them, and strokes the focused one last', async () => {
  const h = harness({}, Promise.resolve(TWO_LINE_ART));
  await flush();
  h.handle.select!({ kind: 'route', id: '1' }); // drawn first in the artwork, so "last" is a real reordering
  const before = h.staticCalls().length;
  h.handle.setLineFocus!(true);
  const ops = h.staticCalls().slice(before)
    .filter((c) => c.op === 'globalAlpha' || (c.op === 'strokeStyle' && ['#cc706f', '#4a8f5a'].includes(String(c.args[0]))));
  // The other line is still there, at a fifth of its ink; a hidden line on a
  // diagram of nineteen would leave the focused one floating in white paper.
  const dimAt = ops.findIndex((c) => c.op === 'globalAlpha' && c.args[0] === SCHEMA_FOCUS_DIM_ALPHA);
  const otherAt = ops.findIndex((c) => c.op === 'strokeStyle' && c.args[0] === '#4a8f5a');
  expect(dimAt).toBeGreaterThanOrEqual(0);
  expect(dimAt).toBeLessThan(otherAt);
  expect(ops.filter((c) => c.op === 'strokeStyle').at(-1)!.args[0]).toBe('#cc706f');
  // Off again: the artwork's own order, both lines at full ink.
  const back = h.staticCalls().length;
  h.handle.setLineFocus!(false);
  const plain = h.staticCalls().slice(back).filter((c) => c.op === 'strokeStyle' && ['#cc706f', '#4a8f5a'].includes(String(c.args[0])));
  expect(plain.map((c) => c.args[0])).toEqual(['#cc706f', '#4a8f5a']);
  expect(h.staticCalls().slice(back).some((c) => c.op === 'globalAlpha' && c.args[0] === SCHEMA_FOCUS_DIM_ALPHA)).toBe(false);
});

it('keeps a mark whose centre has just left the canvas, so a pill at the edge is clipped rather than culled, and reaches twice as far where the kiosk paints the pill twice as wide', async () => {
  /** The tram's mark after `zooms` steps in and `pans` steps left, to the clamp. */
  const edgeMark = async (extra: Partial<CityMapOptions>, zooms: number, pans: number) => {
    const h = harness(extra);
    await flush();
    for (let i = 0; i < zooms; i++) key(h.canvas(), '+'); // in: the artwork is now wider than the viewport
    for (let i = 0; i < pans; i++) key(h.canvas(), 'ArrowRight', true); // pan hard left
    h.frame();
    return h.frames.at(-1)!.marks.find((m) => m.id === 'tram');
  };
  const mark = await edgeMark({}, 1, 4);
  expect(mark).toBeDefined();
  const cssX = mark!.x / DENSITY;
  expect(cssX).toBeLessThan(0);
  expect(cssX).toBeGreaterThan(-PILL_EDGE_MARGIN_PX);
  // A step further in the centre is past the phone's margin: no ink left on the canvas, so no mark.
  expect(await edgeMark({}, 2, 1)).toBeUndefined();
  // The same centre on the public screen, where every pill is painted at
  // symbolScale 2: half of a doubled capsule still lies on the glass, and a
  // flat 56 CSS px blinked a wide cluster out with ink showing (M3).
  const kiosk = await edgeMark({ symbolScale: 2 }, 2, 1);
  expect(kiosk).toBeDefined();
  expect(kiosk!.x / DENSITY).toBeLessThan(-PILL_EDGE_MARGIN_PX);
  expect(kiosk!.x / DENSITY).toBeGreaterThan(-2 * PILL_EDGE_MARGIN_PX);
});

it('keeps the selection while the model still draws the vehicle, even after its mark leaves the canvas', async () => {
  const h = harness();
  await flush();
  h.handle.select!({ kind: 'vehicle', id: 'tram' });
  h.onSelect.mockClear();
  for (let i = 0; i < 4; i++) key(h.canvas(), '+');
  for (let i = 0; i < 8; i++) key(h.canvas(), 'ArrowRight', true);
  h.frame();
  expect(h.frames.at(-1)!.marks).toHaveLength(0);
  expect(h.frames.at(-1)!.drawn.some((v) => v.id === 'tram')).toBe(true);
  expect(h.onSelect).not.toHaveBeenCalled();
  expect(h.handle.selection!()).toEqual({ kind: 'vehicle', id: 'tram' });
});
