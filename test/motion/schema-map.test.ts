// @vitest-environment happy-dom
import '../../shared/kiosk/external-text';
import { afterEach, expect, it, vi } from 'vitest';
import { createSchemaMap, type SchemaFrame } from '../../app/src/motion/schema-map';
import { NETWORK_RELOAD_RETRY_MS } from '../../app/src/motion/network-reload';
import { clusterSchemaMarks, LABEL_MIN_PX_PER_UNIT, paintPills, PILL_EDGE_MARGIN_PX, SCHEMA_FOCUS_DIM_ALPHA, type SchemaContext } from '../../app/src/motion/schema-paint';
import { clusterLabel, PILL_HEIGHT_PX, PILL_INKS, PILL_LINE_HEIGHT_PX, PILL_MAX_CHARS_CLUSTER, pillChars, pillHeightPx, pillRows, pillWidthPx } from '../../app/src/motion/pills';
import type { VehicleMark } from '../../app/src/motion/schematic';
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

it('vets the wall schema accessible vehicle text even though the legacy dialog is absent', async () => {
  const attack = 'Submit passcode';
  const poisoned = { ...NET, routes: new Map([...NET.routes].map(([id, route]) => [id, { ...route, short: attack }])) };
  const h = harness({ presentationProfile: 'public-display', interactive: false,
    loadNetwork: async () => poisoned });
  await flush();
  h.frame();
  expect(h.frames.at(-1)?.drawn.some(vehicle => vehicle.short === attack)).toBe(true);
  expect(h.container.querySelector('[data-testid=vehicle-list]')?.textContent).not.toContain(attack);
  expect(h.container.querySelector('[data-testid=vehicle-card]')).toBeNull();
});

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

  const kiosk = harness({ interactive: false, stop: { id: 'T600', name: 'T600', lon: 0, lat: 0, routes: [] } });
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
  // A wall's schema is the whole network without zoom [O-72], and it still names that network (review W, P2):
  // the artwork's own names at the wall's walk-up tier, the ones the collision pass has room for.
  const beforeStop = kiosk.staticCalls().length;
  kiosk.handle.setStop!(null);
  kiosk.frame();
  expect(kiosk.frames.at(-1)!.labels).toBe(true);
  expect(kiosk.container.querySelector<HTMLElement>('[data-testid=schema-map]')!.dataset.labels).toBe('true');
  const names = kiosk.staticCalls().slice(beforeStop).filter((c) => c.op === 'fillText');
  expect(names.map((c) => c.args[0])).toEqual(expect.arrayContaining(['T0', 'C1200']));
  expect(names.every((c) => Number(c.font?.match(/([\d.]+)px/)?.[1]) / DENSITY >= 28)).toBe(true);
  // A handheld still frames its stop and names it; without one it draws the clean network.
  const phone = harness({ interactive: false, presentationProfile: 'handheld', stop: { id: 'T600', name: 'T600', lon: 0, lat: 0, routes: [] } });
  await flush();
  phone.resize(390, 800);
  phone.frame();
  expect(phone.frames.at(-1)!.labels).toBe(true);
  phone.handle.setStop!(null);
  phone.frame();
  expect(phone.frames.at(-1)!.labels).toBe(false);

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
  // Both eastbound on their own lines: a merge, not a passing.
  expect(marks[0]).toMatchObject({ pill: 'cluster', label: '1·2', twoWay: false });
  expect([...(marks[0].ids ?? [])].sort()).toEqual(['a', 'b']);
  // One merged pill on the canvas is still two vehicles for a reader.
  expect(h.buttons().map((b) => b.dataset.vehicle)).toEqual(['a', 'b']);
});

it('calls a merge of two trams of one line passing each other two-way, and a merge heading one way not, and counts the two-way pills beside data-pills', async () => {
  // The corridor's return track gets the printed line's own stops, in
  // reverse, so the placer lays path 1_1 on line '1' with sign -1; the second
  // tram's arc puts it on the same artwork point as the first (u about 167:
  // 200 m into 1_0's first bracket, 1300 m into 1_1's).
  const spec = corridorSpec();
  spec.stops.push({ id: 'T600-w', name: 'T600', edge: 5, s: 900 }, { id: 'T0-w', name: 'T0', edge: 5, s: 1500 });
  spec.routes[0].paths![1].served = ['T600-w', 'T0-w'];
  const net = syntheticNetwork(spec);
  const back: MapPoint = { ...TRAM, id: 'b', path: '1_1', plan: { on: 'path', knots: [[NOW, 1300], [NOW + 60_000, 700]] } };
  const opposed = harness({ points: [{ ...TRAM, id: 'a' }, back], loadNetwork: async () => net });
  await flush();
  opposed.frame();
  const marks = opposed.frames.at(-1)!.marks;
  expect(marks).toHaveLength(1);
  expect(marks[0]).toMatchObject({ pill: 'cluster', label: '1', twoWay: true, angle: 0 });
  // Aimed along the printed line, whichever member came first.
  expect(Math.abs(marks[0].dir!.x)).toBeCloseTo(1);
  expect(marks[0].dir!.y).toBeCloseTo(0);
  expect(opposed.container.querySelector<HTMLElement>('[data-testid=schema-map]')!.dataset.twoway).toBe('1');

  const same = harness({ points: [{ ...TRAM, id: 'a' }, { ...TRAM, id: 'b' }] });
  await flush();
  same.frame();
  expect(same.frames.at(-1)!.marks[0]).toMatchObject({ pill: 'cluster', label: '1', twoWay: false });
  expect(same.container.querySelector<HTMLElement>('[data-testid=schema-map]')!.dataset.twoway).toBe('0');
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
  // A step further in and panned to the clamp, the centre is past the phone's
  // margin (half the widest, forty-character capsule plus its ring): no ink
  // left on the canvas, so no mark.
  expect(await edgeMark({}, 2, 4)).toBeUndefined();
  // The same centre on the public screen, where every pill is painted at
  // symbolScale 2: half of a doubled capsule still lies on the glass, and a
  // flat 56 CSS px blinked a wide cluster out with ink showing (M3).
  const kiosk = await edgeMark({ symbolScale: 2 }, 2, 4);
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

it('names a surface\u2019s priority stop first when it has no stop to crop round (the wall\u2019s whole-network place): the collision pass never drops it, and a name it meets yields', async () => {
  const firstName = async (extra: Partial<CityMapOptions>, live?: (h: ReturnType<typeof harness>) => void) => {
    const h = harness(extra);
    await flush();
    h.resize(390, 400);
    h.frame();
    for (let i = 0; i < 8; i++) key(h.canvas(), '+');
    h.frame();
    live?.(h);
    const before = h.staticCalls().length;
    h.handle.setTheme!('light');
    const names = h.staticCalls().slice(before).filter((c) => c.op === 'fillText' && c.args[0] !== '1');
    return { first: names[0]?.args[0] };
  };
  // Ranked by terminal first with no priority; the priority stop's rows first with one.
  expect((await firstName({})).first).not.toBe('Two');
  const ranked = await firstName({ priorityStopId: 'T600' });
  expect(ranked.first).toBe('Two');
  // Live, the same.
  expect((await firstName({}, (h) => h.handle.setPriorityStop!('T600'))).first).toBe('Two');
});

it('keeps the wall’s own place among the whole-network schema’s names at the walk-up tier, and the name it meets yields (W-fix2’s names, WP2-A2’s place)', async () => {
  // T600's name moved up against the terminal T0: the two boxes meet, and the rank decides who stays.
  const CLOSE = { ...ART, stops: ART.stops.map((s) => s.name === 'T600' ? { ...s, x: 130, label: { ...s.label!, text: 'T600', rows: 1, x: 130 } } : s) };
  const wallNames = async (extra: Partial<CityMapOptions>) => {
    const h = harness({ interactive: false, stop: null, ...extra }, Promise.resolve(CLOSE));
    await flush();
    h.resize(1920, 1080);
    h.frame();
    const before = h.staticCalls().length;
    h.handle.setTheme!('light');
    const drawn = h.staticCalls().slice(before).filter((c) => c.op === 'fillText');
    return { names: drawn.map((c) => String(c.args[0])), px: drawn.filter((c) => c.args[0] === 'T600').map((c) => Number(c.font?.match(/([\d.]+)px/)?.[1]) / DENSITY) };
  };
  const plain = await wallNames({});
  expect(plain.names).toContain('T0');
  expect(plain.names).not.toContain('T600');
  const own = await wallNames({ priorityStopId: 'T600' });
  expect(own.names).toContain('T600');
  expect(own.names).not.toContain('T0');
  expect(own.names).toContain('C1200'); // only the name it meets yields
  expect(own.px.every((px) => px >= 28)).toBe(true);
});

// Decision 23 on the canvas: a hub label past one row wraps onto a second
// (and past two onto a third), the pill a line taller for each with the
// capsule's own corner, the rows painted a line apart and vetted row by row
// -- the city map's stretchable pill, drawn by hand.
function paintRecorder(): { ctx: SchemaContext; calls: { op: string; args: unknown[] }[] } {
  const calls: { op: string; args: unknown[] }[] = [];
  const props: Record<string, unknown> = {};
  const ctx = new Proxy({}, {
    get: (_t, k: string) => k in props ? props[k]
      : k === 'measureText' ? (text: string) => ({ width: text.length * 7 })
      : (...args: unknown[]) => { calls.push({ op: k, args }); },
    set: (_t, k: string, value: unknown) => { props[k] = value; calls.push({ op: `set ${k}`, args: [value] }); return true; },
  }) as unknown as SchemaContext;
  return { ctx, calls };
}

it('wraps a hub past one row onto a second on the canvas too: sixteen bus lines, eight a row, the pill a line taller with the capsule\u2019s own corner (decision 23)', () => {
  const lines = Array.from({ length: 16 }, (_, i) => String(109 + i));
  const viewport = { x: 0, y: 0, scale: 1, width: 800, height: 400, density: 2, symbolScale: 2 };
  const size = viewport.density * viewport.symbolScale;
  const marks: VehicleMark[] = lines.map((label, i) => ({
    id: `b${i}`, kind: 'bus', x: (300 + i) * size, y: 200 * size, w: pillWidthPx(pillChars(label)) * size, h: PILL_HEIGHT_PX * size,
    angle: 0, alpha: 1, label, pill: 'single',
  }));
  const merged = clusterSchemaMarks(marks, viewport);
  expect(merged).toHaveLength(1);
  const hub = merged[0]!;
  expect(hub.pill).toBe('cluster');
  expect(hub.label).toBe(clusterLabel(lines));
  const rows = pillRows(hub.label!);
  expect(rows).toHaveLength(2);
  for (const row of rows) expect(row.length).toBeLessThanOrEqual(PILL_MAX_CHARS_CLUSTER);
  // Every line, whole, and never a count.
  expect(hub.label!.split(/[\u00b7\n]/)).toEqual(lines);
  expect(hub.label).not.toMatch(/\+\d/);
  expect(hub.w).toBe(pillWidthPx(31) * size);
  expect(hub.h).toBeCloseTo(pillHeightPx(2) * size, 9);

  const { ctx, calls } = paintRecorder();
  paintPills(ctx, { w: 1600, h: 800, density: 2 }, merged, { fill: PILL_INKS.light.bus, text: PILL_INKS.light.busText, halo: '#fbfcfe', ink: '#16226b' }, hub.id);
  const texts = calls.filter((c) => c.op === 'fillText');
  expect(texts.map((c) => c.args[0])).toEqual(rows);
  // A line height apart about the mark's centre, as MapLibre sets them.
  const ys = texts.map((c) => c.args[2] as number);
  expect(ys[0]).toBeCloseTo(hub.y - (PILL_LINE_HEIGHT_PX * size) / 2, 9);
  expect(ys[1]).toBeCloseTo(hub.y + (PILL_LINE_HEIGHT_PX * size) / 2, 9);
  // The capsule's own corner on straight sides, and the selection ring
  // concentric with it: four arcs of half a one-row pill, then four of that
  // plus the ring's gap -- not two half-circles of the taller pill.
  const radii = calls.filter((c) => c.op === 'arc').map((c) => c.args[2] as number);
  expect(radii).toEqual([...Array<number>(4).fill((PILL_HEIGHT_PX / 2) * size), ...Array<number>(4).fill((PILL_HEIGHT_PX / 2 + 3) * size)]);
  expect(calls.filter((c) => c.op === 'fill')).toHaveLength(1);
});

it('wraps a hub past two rows onto a third on the canvas too: twenty-three bus lines, eight, eight and seven, the pill two lines taller with the same corner (decision 23)', () => {
  const lines = Array.from({ length: 23 }, (_, i) => String(109 + i));
  const viewport = { x: 0, y: 0, scale: 1, width: 800, height: 400, density: 2, symbolScale: 2 };
  const size = viewport.density * viewport.symbolScale;
  const marks: VehicleMark[] = lines.map((label, i) => ({
    id: `b${i}`, kind: 'bus', x: (300 + i) * size, y: 200 * size, w: pillWidthPx(pillChars(label)) * size, h: PILL_HEIGHT_PX * size,
    angle: 0, alpha: 1, label, pill: 'single',
  }));
  const merged = clusterSchemaMarks(marks, viewport);
  expect(merged).toHaveLength(1);
  const hub = merged[0]!;
  expect(hub.label).toBe(clusterLabel(lines));
  const rows = pillRows(hub.label!);
  expect(rows.map((row) => row.split('\u00b7').length)).toEqual([8, 8, 7]);
  expect(hub.label!.split(/[\u00b7\n]/)).toEqual(lines);
  expect(hub.w).toBe(pillWidthPx(31) * size);
  expect(hub.h).toBeCloseTo(pillHeightPx(3) * size, 9);

  const { ctx, calls } = paintRecorder();
  paintPills(ctx, { w: 1600, h: 800, density: 2 }, merged, { fill: PILL_INKS.light.bus, text: PILL_INKS.light.busText, halo: '#fbfcfe', ink: '#16226b' }, hub.id);
  const texts = calls.filter((c) => c.op === 'fillText');
  expect(texts.map((c) => c.args[0])).toEqual(rows);
  const ys = texts.map((c) => c.args[2] as number);
  expect(ys[0]).toBeCloseTo(hub.y - PILL_LINE_HEIGHT_PX * size, 9);
  expect(ys[1]).toBeCloseTo(hub.y, 9);
  expect(ys[2]).toBeCloseTo(hub.y + PILL_LINE_HEIGHT_PX * size, 9);
  const radii = calls.filter((c) => c.op === 'arc').map((c) => c.args[2] as number);
  expect(radii).toEqual([...Array<number>(4).fill((PILL_HEIGHT_PX / 2) * size), ...Array<number>(4).fill((PILL_HEIGHT_PX / 2 + 3) * size)]);
});

it('the position note is the phone’s: a wall’s or handheld stage’s schema prints no caveat (companion brief §12)', async () => {
  const phone = harness();
  await flush();
  expect(phone.container.querySelector('[data-testid=schema-note]')!.textContent).toBe('Položaj je izračunat iz vlastitih očitanja svakog vozila, geometrije pruge i voznog reda; ZET ne objavljuje smjer ni brzinu.');
  for (const extra of [{ interactive: false }, { interactive: false, presentationProfile: 'handheld' as const }, { basemapProfile: 'prozor' as const }]) {
    const wall = harness(extra);
    await flush();
    wall.frame();
    expect(wall.container.querySelector('[data-testid=schema-note], .schema-note'), JSON.stringify(extra)).toBeNull();
    expect(wall.container.textContent, JSON.stringify(extra)).not.toMatch(/Položaj je izračunat|ZET ne objavljuje/);
  }
});

// A rebuilt rail graph under a new graphHash (decision 25's connectors at D3):
// the city map migrates in place (city-map.test.ts, 'graph identity on an
// already-open map'); the schema, which also derives every arc from the graph,
// does the same rather than standing empty until a page reload (review of D3,
// finding 3). The loops: one whose platform the artwork prints (T0) sits on
// the terminus circle; one whose platform it does not (Zapad 750) is not drawn
// on the schema and stays on the geographic map (decision 34). The two graphs
// keep the loop ids and swap their geometry (review of lane/t-schema, finding
// 3): on the old graph loop:1:aaa turns at T0 and loop:1:bbb at Zapad 750, on
// the new one loop:1:aaa at Zapad 750 and loop:1:bbb at C1200, so a placer
// kept from the old graph would put the wrong loop on the wrong circle.
const loopSpec = (aaa: { edges: number[]; served: string[] }, bbb: { edges: number[]; served: string[] }) => {
  const spec = corridorSpec();
  spec.routes.find((r) => r.id === '1')!.paths!.push(
    { id: 'loop:1:aaa', direction: -1, synthetic: true, ...aaa },
    { id: 'loop:1:bbb', direction: -1, synthetic: true, ...bbb },
  );
  return spec;
};
const OLD_GRAPH = { ...syntheticNetwork(loopSpec({ edges: [0], served: ['T0'] }, { edges: [5], served: ['W750'] })), graphHash: 'aaaaaaaaaaaaaaaa' };
const NEW_GRAPH = { ...syntheticNetwork(loopSpec({ edges: [5], served: ['W750'] }, { edges: [1], served: ['C1200'] })), graphHash: 'bbbbbbbbbbbbbbbb' };
const onGraph = (network: string, id: string, path: string, s: number): MapPoint =>
  ({ ...TRAM, id, path, network, plan: { on: 'path', knots: [[NOW, s], [NOW + 60_000, s]] } });

it('adopts a rebuilt graph while the schema is shown, as the city map does: marks and list clear, the artefact reloads once, vehicles reappear on the new graph without a page reload, and an undrawn loop stays undrawn (decision 34)', async () => {
  let finish!: (net: typeof OLD_GRAPH | null) => void;
  const reloadNetwork = vi.fn(() => new Promise<typeof OLD_GRAPH | null>((resolve) => { finish = resolve; }));
  const h = harness({ loadNetwork: async () => OLD_GRAPH, reloadNetwork, points: [onGraph(OLD_GRAPH.graphHash, 'tram', '1_0', 500)] });
  await flush();
  h.frame();
  expect(h.handle.network!()).toBe(OLD_GRAPH);
  expect(h.frames.at(-1)!.marks.map((m) => m.id)).toEqual(['tram']);
  expect(h.buttons().map((b) => b.dataset.vehicle)).toEqual(['tram']);

  const rebuilt = [
    onGraph(NEW_GRAPH.graphHash, 'tram', '1_0', 500),
    onGraph(NEW_GRAPH.graphHash, 'loop-aaa', 'loop:1:aaa', 5),
    onGraph(NEW_GRAPH.graphHash, 'loop-bbb', 'loop:1:bbb', 5),
  ];
  h.handle.update(rebuilt, []);
  // Never a new arc on old rails: nothing is drawn or listed until the replacement graph is in.
  expect(h.handle.vehicles!()).toEqual([]);
  expect(h.handle.network!()).toBeNull();
  expect(h.onNetwork).toHaveBeenLastCalledWith(null);
  expect(h.container.dataset.networkStale).toBe('true');
  expect(reloadNetwork).toHaveBeenCalledTimes(1);
  expect(h.buttons()).toEqual([]);
  h.frame();
  expect(h.handle.vehicles!()).toEqual([]);
  h.handle.update(rebuilt, []);
  expect(reloadNetwork).toHaveBeenCalledTimes(1); // one request in flight, not one per poll

  finish(NEW_GRAPH);
  await flush();
  h.frame();
  expect(h.handle.network!()).toBe(NEW_GRAPH);
  expect(h.onNetwork).toHaveBeenLastCalledWith(NEW_GRAPH);
  expect(h.container.dataset.networkStale).toBeUndefined();
  expect(h.handle.vehicles!().map((v) => v.id).sort()).toEqual(['loop-aaa', 'loop-bbb', 'tram']);
  // The placer was rebuilt on the new graph: the tram is back on its line;
  // loop:1:bbb, which now turns at C1200, sits on that circle, east of the
  // tram; loop:1:aaa, which now turns at Zapad 750, a platform the artwork does
  // not print, is on the schema nowhere. The old placer would have put aaa on
  // T0's circle, west of the tram, and bbb nowhere.
  const marks = h.frames.at(-1)!.marks;
  expect(marks.map((m) => m.id).sort()).toEqual(['loop-bbb', 'tram']);
  expect(marks.find((m) => m.id === 'loop-bbb')!.x).toBeGreaterThan(marks.find((m) => m.id === 'tram')!.x);
  expect(h.buttons().map((b) => b.dataset.vehicle).sort()).toEqual(['loop-bbb', 'tram']);
  expect(h.loadSchema).toHaveBeenCalledTimes(1); // the artwork is the feed's, not the graph's
  expect(h.handle.status!()).toBe('ready');
});

it('retries a failed or wrong-graph reload at the next poll interval, ignores a completion after destroy, and never reloads for a matching graph or for legacy motion without identity', async () => {
  const reloadNetwork = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(OLD_GRAPH).mockResolvedValueOnce(NEW_GRAPH);
  const h = harness({ loadNetwork: async () => OLD_GRAPH, reloadNetwork, points: [onGraph(OLD_GRAPH.graphHash, 'tram', '1_0', 500)] });
  await flush();
  h.frame();
  h.handle.update([onGraph(OLD_GRAPH.graphHash, 'tram', '1_0', 520), { ...TRAM, id: 'legacy', plan: undefined, path: undefined }], []);
  expect(reloadNetwork).not.toHaveBeenCalled();
  expect(h.handle.vehicles!().map((v) => v.id).sort()).toEqual(['legacy', 'tram']);
  // One poll interval apart: the budget (network-reload.ts) allows one attempt per interval.
  for (let i = 0; i < 3; i++) {
    h.frame(NETWORK_RELOAD_RETRY_MS);
    h.handle.update([onGraph(NEW_GRAPH.graphHash, 'tram', '1_0', 500)], []);
    if (i === 2) h.handle.destroy();
    await flush();
    expect(h.handle.vehicles!()).toEqual([]);
  }
  expect(reloadNetwork).toHaveBeenCalledTimes(3);
  expect(h.handle.network!()).not.toBe(NEW_GRAPH);
});

// update() also runs on search input and on slot repaints, not only per poll
// (review of lane/t-schema, finding 1): a failed reload may be asked again at
// most once per poll interval, so twenty repaints on one clock are one fetch
// past the cache, and the next poll interval one more.
it('spends at most one artefact reload attempt per poll interval: twenty identical updates on an unchanged clock are one fetch, the next interval one more, and an installed graph frees the budget', async () => {
  const reloadNetwork = vi.fn<() => Promise<typeof OLD_GRAPH | null>>().mockResolvedValue(null);
  const h = harness({ loadNetwork: async () => OLD_GRAPH, reloadNetwork, points: [onGraph(OLD_GRAPH.graphHash, 'tram', '1_0', 500)] });
  await flush();
  h.frame();
  const named = [onGraph(NEW_GRAPH.graphHash, 'tram', '1_0', 500)];
  for (let i = 0; i < 20; i++) {
    h.handle.update(named, []);
    await flush();
  }
  expect(reloadNetwork).toHaveBeenCalledTimes(1);
  expect(h.container.dataset.networkStale).toBe('true');
  h.frame(NETWORK_RELOAD_RETRY_MS - 1);
  h.handle.update(named, []);
  await flush();
  expect(reloadNetwork).toHaveBeenCalledTimes(1);
  h.frame(1);
  h.handle.update(named, []);
  await flush();
  expect(reloadNetwork).toHaveBeenCalledTimes(2);
  reloadNetwork.mockResolvedValueOnce(NEW_GRAPH);
  h.frame(NETWORK_RELOAD_RETRY_MS);
  h.handle.update(named, []);
  await flush();
  expect(reloadNetwork).toHaveBeenCalledTimes(3);
  expect(h.handle.network!()).toBe(NEW_GRAPH);
  // A further graph right after an installed one is asked for at once: the budget counts attempts that failed.
  h.handle.update([onGraph('cccccccccccccccc', 'tram', '1_0', 500)], []);
  await flush();
  expect(reloadNetwork).toHaveBeenCalledTimes(4);
});
