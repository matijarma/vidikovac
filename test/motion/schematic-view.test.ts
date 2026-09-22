// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { createDefaultI18n } from '../../app/src/i18n/create-default-i18n';
import { toPlane } from '../../shared/motion/geo';
import type { Fix } from '../../app/src/motion/integrator';
import type { Network, Shape, Stop } from '../../shared/motion/network';
import { cumulative } from '../../shared/motion/polyline';
import { DEFAULT_CROP, HIT_RADIUS_CSS_PX, ROUTE_TYPE_BUS, ROUTE_TYPE_TRAM } from '../../app/src/motion/schematic';
import { mountSchematicView } from '../../app/src/motion/schematic-view';
import type { ModuleSnapshot } from '../../worker/feed/schema';

function shapeOf(id: string, route: string, lonlat: [number, number][]): Shape {
  const pts = lonlat.map(([lon, lat]) => toPlane(lon, lat));
  const cum = cumulative(pts);
  return { id, route, pts, cum, len: cum[cum.length - 1] };
}

/** A straight tram line and a straight bus line, both crossing near Trg bana
 *  Jelačića (the schematic's own default crop centre), plus one stop on
 *  each right at the crossing -- just enough geometry for both the canvas
 *  path and the lightweight list. */
function testNetwork(): Network {
  const tram = shapeOf('S-tram', 'R-tram', [
    [15.965, 45.813],
    [15.977, 45.813],
    [15.99, 45.813],
  ]);
  const bus = shapeOf('S-bus', 'R-bus', [
    [15.977, 45.805],
    [15.977, 45.813],
    [15.977, 45.821],
  ]);
  const stopTram: Stop = { id: 'ST1', name: 'Jelačić plac', p: toPlane(15.977, 45.813), on: [{ shape: 0, s: tram.cum[1] }], terminal: false };
  const stopBus: Stop = { id: 'ST2', name: 'Jelačić plac (bus)', p: toPlane(15.977, 45.813), on: [{ shape: 1, s: bus.cum[1] }], terminal: false };
  return {
    version: 1,
    feedVersion: 'test',
    routes: new Map([
      ['R-tram', { short: '6', type: ROUTE_TYPE_TRAM, rank: 1, shapes: [0] }],
      ['R-bus', { short: '109', type: ROUTE_TYPE_BUS, rank: 2, shapes: [1] }],
    ]),
    shapes: [tram, bus],
    stops: [stopTram, stopBus],
    diagram: { lines: [], box: [1, 1] },
    nextStop: () => null,
  };
}

const NOW = Date.parse('2026-09-12T10:00:00Z');

function fix(over: Partial<Fix> & { id: string; lon: number; lat: number }): Fix {
  return { at: NOW, routeId: undefined, tripId: undefined, ...over };
}

/** A raf/cancel double the view's own loop can be driven by hand -- the same
 *  shape as test/motion/loop.test.ts's fakeRaf. */
function fakeRaf() {
  let cb: ((t: number) => void) | null = null;
  const raf = vi.fn((fn: (t: number) => void) => { cb = fn; return 1; });
  const cancel = vi.fn();
  const fire = (t = 0): void => { const fn = cb; cb = null; fn?.(t); };
  return { raf, cancel, fire, hasScheduled: () => cb !== null };
}

interface Call { op: string; args: unknown[] }

/** A fake 2D context recorder wired onto a real (happy-dom) canvas element,
 *  the same recording shape test/motion/schematic.test.ts uses for the pure
 *  painters -- happy-dom lays nothing out and has no 2D context of its own,
 *  so both are stubbed here to exercise the view end to end. */
function stubCanvas(el: HTMLCanvasElement, w: number, h: number): Call[] {
  el.getBoundingClientRect = () => ({ width: w, height: h }) as DOMRect;
  const calls: Call[] = [];
  const props: Record<string, unknown> = { strokeStyle: '', fillStyle: '', lineWidth: 1, lineCap: 'butt', lineJoin: 'miter', miterLimit: 10, globalAlpha: 1 };
  const method = (op: string) => (...args: unknown[]): void => { calls.push({ op, args }); };
  const target: Record<string, unknown> = {
    save: method('save'), restore: method('restore'), beginPath: method('beginPath'),
    moveTo: method('moveTo'), lineTo: method('lineTo'), rect: method('rect'), clip: method('clip'),
    stroke: method('stroke'), fillRect: method('fillRect'), clearRect: method('clearRect'),
    translate: method('translate'), rotate: method('rotate'),
  };
  const ctx = new Proxy(target, {
    get: (t, key: string) => (key in t ? t[key] : props[key]),
    set: (_t, key: string, value: unknown) => { props[key] = value; calls.push({ op: `set ${key}`, args: [value] }); return true; },
  });
  el.getContext = (() => ctx) as unknown as HTMLCanvasElement['getContext'];
  return calls;
}

function mount(opts: {
  net?: Network | null;
  lightweight?: boolean;
  reducedMotion?: boolean;
  types?: ReadonlySet<number> | null;
  crop?: { centre: { x: number; y: number }; radius: number };
  stubSize?: { w: number; h: number };
  cardIdleMs?: number;
} = {}) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const { raf, cancel, fire: rafFire, hasScheduled } = fakeRaf();
  // The loop's own clock (loop.ts's onFullFrame reads deps.now(), never the
  // raf callback's own timestamp argument), so advancing "now" for a fired
  // frame means moving this shared variable, not just the fire() argument.
  let clock = NOW;
  const fire = (t: number = clock): void => { clock = t; rafFire(t); };
  const i18n = createDefaultI18n('hr');
  // The two canvases don't exist until mountSchematicView builds them, so
  // they cannot be stubbed beforehand; onRepaint is captured here instead,
  // and invoked once the test has stubbed the now-existing elements, to
  // force a second, properly-measured layout pass (exactly the resize path
  // a real theme change or window resize would drive).
  let repaint = null as (() => void) | null; // assigned by onRepaint below, so no narrowing to null
  // One-shot timers the view arms for the card's idle close, fired by hand.
  const timers: { fn: () => void; ms: number; cleared: boolean }[] = [];
  const handle = mountSchematicView(root, {
    i18n,
    net: opts.net === undefined ? testNetwork() : opts.net,
    types: opts.types,
    crop: opts.crop,
    lightweight: opts.lightweight ?? false,
    reducedMotion: opts.reducedMotion ?? false,
    now: () => clock,
    raf,
    cancel,
    onRepaint: opts.stubSize ? (l) => { repaint = l; return () => {}; } : undefined,
    cardIdleMs: opts.cardIdleMs,
    setTimer: (fn, ms) => { const t = { fn, ms, cleared: false }; timers.push(t); return t; },
    clearTimer: (h) => { (h as { cleared: boolean }).cleared = true; },
  });
  const routesCanvas = root.querySelector<HTMLCanvasElement>('[data-testid=schematic-routes]');
  const vehiclesCanvas = root.querySelector<HTMLCanvasElement>('[data-testid=schematic-vehicles]');
  let routeCalls: Call[] = [];
  let vehicleCalls: Call[] = [];
  if (!opts.lightweight && opts.stubSize && routesCanvas && vehiclesCanvas) {
    routeCalls = stubCanvas(routesCanvas, opts.stubSize.w, opts.stubSize.h);
    vehicleCalls = stubCanvas(vehiclesCanvas, opts.stubSize.w, opts.stubSize.h);
    repaint?.();
  }
  /** Fires every armed one-shot timer (the reduced-motion loop's clock tick,
   *  the card's idle close) at clock `t`. */
  const tick = (t: number = clock): void => {
    clock = t;
    for (const timer of [...timers]) if (!timer.cleared) { timer.cleared = true; timer.fn(); }
  };
  return { root, handle, fire, tick, hasScheduled, routesCanvas, vehiclesCanvas, routeCalls, vehicleCalls, i18n, timers };
}

/** A click at CSS-pixel (x, y) inside the stubbed canvas box. */
function clickAt(canvas: HTMLCanvasElement, x: number, y: number): void {
  canvas.dispatchEvent(new MouseEvent('click', { clientX: x, clientY: y, bubbles: true }));
}
function key(el: HTMLElement, k: string): void {
  el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
}
const card = (root: HTMLElement) => root.querySelector<HTMLElement>('[data-testid=vehicle-card]');

describe('mountSchematicView, canvas path', () => {
  it('mounts a route canvas and a vehicle canvas, and shows the loading legend before any update()', () => {
    const { root } = mount();
    expect(root.querySelector('[data-testid=schematic-routes]')).not.toBeNull();
    expect(root.querySelector('[data-testid=schematic-vehicles]')).not.toBeNull();
    expect(root.querySelector('[data-testid=schematic-list]')).toBeNull();
    const legend = root.querySelector('[data-testid=schematic-legend]')!;
    expect(legend.textContent).toBe('učitavanje podataka');
  });

  it('renders the legend as "{drawn} od {tracked} praćenih vozila u kadru" once data arrives', () => {
    const { handle, fire, root } = mount({ stubSize: { w: 400, h: 400 } });
    handle.update({
      fixes: [
        fix({ id: 'v1', lon: 15.977, lat: 45.813, routeId: 'R-tram' }), // on the tram shape, inside the crop
        fix({ id: 'v2', lon: 16.5, lat: 46.5, routeId: 'R-tram' }), // real evidence, but nowhere near the crop
      ],
    });
    fire(NOW);
    const legend = root.querySelector('[data-testid=schematic-legend]')!;
    // v2's own reported spot is never drawn either way (R-P2); here it also
    // falls outside the crop, so only v1 counts as "drawn".
    expect(legend.textContent).toBe('1 od 2 praćenih vozila u kadru');
  });

  it('counts only the drawn types in the legend denominator: a bus inside the box does not count on a trams-only crop (R-F2)', () => {
    const { handle, fire, root } = mount({ stubSize: { w: 400, h: 400 }, types: new Set([ROUTE_TYPE_TRAM]) });
    handle.update({
      fixes: [
        fix({ id: 't1', lon: 15.977, lat: 45.813, routeId: 'R-tram' }), // a tram in the box
        fix({ id: 'b1', lon: 15.977, lat: 45.8131, routeId: 'R-bus' }), // a bus in the box: not this view's to count
        fix({ id: 't2', lon: 16.5, lat: 46.5, routeId: 'R-tram' }), // a tracked tram far outside the box
      ],
    });
    fire(NOW);
    const legend = root.querySelector('[data-testid=schematic-legend]')!;
    expect(legend.textContent).toBe('1 od 2 praćenih vozila u kadru');
  });

  it('strokes the route layer once at mount and repaints the vehicle layer every fired frame', () => {
    const { fire, routeCalls, vehicleCalls } = mount({ stubSize: { w: 400, h: 400 } });
    expect(routeCalls.filter((c) => c.op === 'stroke').length).toBeGreaterThan(0);
    const routeCallsBefore = routeCalls.length;
    fire(NOW);
    fire(NOW + 500);
    expect(vehicleCalls.filter((c) => c.op === 'clearRect').length).toBeGreaterThanOrEqual(2);
    // Two more frames, no resize and no theme change: the route layer is not
    // re-run (schematic.ts's whole point -- it repaints on crop/theme/resize
    // only, never per frame).
    expect(routeCalls.length).toBe(routeCallsBefore);
  });

  it('converges a vehicle onto a new fix instead of jumping: the drawn position 500 ms later still differs, because the catch-up cap has not let it arrive yet', () => {
    const { handle, fire, vehicleCalls } = mount({ stubSize: { w: 400, h: 400 } });
    // The vehicle starts a few metres from the crop centre; one second later
    // a fix arrives 100 m further along the same shape -- under the snap
    // threshold, so the model converges rather than jumping there, and with
    // the catch-up cap at max(4, speed) m/s it cannot close a 100 m gap in
    // either of the next two frames (proven directly, in metres, in
    // model.test.ts; this asserts the same shape reaches the canvas: the
    // drawn pixel keeps moving, never sitting on the reported spot).
    handle.update({ fixes: [fix({ id: 'v1', lon: 15.976, lat: 45.813, routeId: 'R-tram' })] });
    fire(NOW);
    handle.update({ fixes: [fix({ id: 'v1', lon: 15.9773, lat: 45.813, at: NOW + 1_000, routeId: 'R-tram' })] }, NOW + 1_000);
    fire(NOW + 1_000);
    // The mark's own local rect is always the same four numbers (a tram is
    // always drawn as -w/2,-h/2,w,h around its own origin); the drawn
    // position lives in the translate() call that precedes it.
    const afterOneSecond = vehicleCalls.filter((c) => c.op === 'translate').at(-1);
    fire(NOW + 1_500);
    const halfSecondLater = vehicleCalls.filter((c) => c.op === 'translate').at(-1);
    // Neither frame is the reported fix itself (R-P2), and the two drawn
    // positions differ from each other too: the model is still gliding
    // toward the fix, not holding still and not having already arrived.
    expect(halfSecondLater).not.toEqual(afterOneSecond);
  });

  it('advances an observable frame counter on the mounted element for the end-to-end proof (T11)', () => {
    const { root, fire } = mount({ stubSize: { w: 400, h: 400 } });
    const before = root.querySelector<HTMLElement>('[data-testid=schematic]')!.dataset.frames;
    fire(NOW);
    fire(NOW + 500);
    const after = root.querySelector<HTMLElement>('[data-testid=schematic]')!.dataset.frames;
    expect(Number(after)).toBeGreaterThan(Number(before));
  });
});

// A vehicle inside the default crop, near Trg bana Jelačića -- reused across
// the R-F8 lightweight-list tests below with a distinct route id and type
// per call.
function inCrop(id: string, routeId: string, type: number, jitter = 0): Fix {
  return fix({ id, lon: 15.977 + jitter, lat: 45.813 + jitter, routeId, type });
}

function minimalSnapshot(status: ModuleSnapshot['status']): ModuleSnapshot {
  return {
    module: 'zet-rt', tier: 'open', status,
    fetchedAt: new Date(NOW).toISOString(),
    sourceUpdatedAt: new Date(NOW - 120_000).toISOString(),
    attribution: { text: '', url: '', licence: '' },
    items: [],
  };
}

describe('mountSchematicView, lightweight path (R-F8: the lines in frame, not the stops)', () => {
  it('renders no canvas at all', () => {
    const { root } = mount({ lightweight: true, net: null });
    expect(root.querySelector('canvas')).toBeNull();
    expect(root.querySelector('[data-testid=schematic-list]')).not.toBeNull();
  });

  it('shows "učitavanje podataka" before the first update(), never an empty or a route row (never a false zero)', () => {
    const { root } = mount({ lightweight: true, net: null });
    expect(root.querySelector('[data-testid=schematic-loading]')!.textContent).toBe('učitavanje podataka');
    expect(root.querySelector('[data-testid=schematic-route]')).toBeNull();
    expect(root.querySelector('[data-testid=schematic-empty]')).toBeNull();
  });

  it('lists one row per route among the fresh, type-matching vehicles in the crop -- trams first, numeric route order, counts and delay words -- and drops a bus under a trams-only crop, never touching the network artefact (net: null, R-L4)', () => {
    const { handle, root } = mount({ lightweight: true, net: null, types: new Set([ROUTE_TYPE_TRAM]) });
    handle.update({
      fixes: [
        inCrop('t1', '6', ROUTE_TYPE_TRAM),
        inCrop('t2', '6', ROUTE_TYPE_TRAM, 0.0001),
        inCrop('t3', '11', ROUTE_TYPE_TRAM, 0.0002),
        inCrop('b1', '109', ROUTE_TYPE_BUS), // filtered out by the trams-only crop
      ],
      delays: new Map([['6', 130], ['11', 0]]),
    });
    const rows = [...root.querySelectorAll('[data-testid=schematic-route]')];
    expect(rows.length).toBe(2); // the bus never counts here
    expect(rows[0].textContent).toContain('6');
    expect(rows[0].textContent).toContain('2 vozila');
    expect(rows[0].textContent).toContain('kasni 2 min');
    expect(rows[1].textContent).toContain('11');
    expect(rows[1].textContent).toContain('1 vozilo');
    expect(rows[1].textContent).toContain('na vrijeme');
    expect(rows.some((r) => r.textContent?.includes('109'))).toBe(false);
  });

  it('includes the bus row after the trams under a whole-network crop (no type filter)', () => {
    const { handle, root } = mount({ lightweight: true, net: null });
    handle.update({
      fixes: [inCrop('t1', '6', ROUTE_TYPE_TRAM), inCrop('b1', '109', ROUTE_TYPE_BUS, 0.0001)],
      delays: new Map([['6', 0], ['109', 0]]),
    });
    const rows = [...root.querySelectorAll('[data-testid=schematic-route]')];
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain('6'); // tram first
    expect(rows[1].textContent).toContain('109'); // bus after it
  });

  it('renders the stale sentence -- the same words statusText renders elsewhere -- rather than the empty one, when the snapshot the caller passed is not live (R-F8, the honesty rule of R-X1)', () => {
    const { handle, root } = mount({ lightweight: true, net: null });
    handle.update({ fixes: [inCrop('t1', '6', ROUTE_TYPE_TRAM)], snapshot: minimalSnapshot('stale') });
    expect(root.querySelector('[data-testid=schematic-route]')).toBeNull();
    expect(root.querySelector('[data-testid=schematic-empty]')).toBeNull();
    const status = root.querySelector('[data-testid=schematic-status]');
    expect(status).not.toBeNull();
    expect(status!.textContent).toContain('izvor trenutačno ne odgovara');

    handle.update({ fixes: [], snapshot: minimalSnapshot('down') });
    expect(root.querySelector('[data-testid=schematic-status]')!.textContent).toBe('izvor nedostupan');
  });

  it('falls back to the honest empty state, never an apology, when there is genuinely no vehicle in frame', () => {
    const { handle, root } = mount({ lightweight: true, net: null, types: new Set([99]) });
    handle.update({ fixes: [inCrop('t1', '6', ROUTE_TYPE_TRAM)] });
    const empty = root.querySelector('[data-testid=schematic-empty]');
    expect(empty).not.toBeNull();
    expect(empty!.textContent).toBe('Trenutačno nema stavki.');
    expect(root.querySelector('[data-testid=schematic-list]')!.textContent).not.toMatch(/nažalost|ažao|sorry/i);
  });

  it('caps the list at ten rows on a locked screen\'s own small crop, adding "još {n} linija" so the count and the list agree', () => {
    const { handle, root } = mount({ lightweight: true, net: null });
    const routeIds = Array.from({ length: 11 }, (_, i) => String(i + 1));
    handle.update({ fixes: routeIds.map((id, i) => inCrop(`v${i}`, id, ROUTE_TYPE_TRAM, i * 0.00001)) });
    const rows = [...root.querySelectorAll('[data-testid=schematic-route]')];
    expect(rows).toHaveLength(10);
    expect(rows[9].textContent).toContain('10'); // '11' is the one that overflows, not '2' (numeric order)
    const more = root.querySelector('[data-testid=schematic-more]');
    expect(more!.textContent).toBe('još 1 linija');
  });

  it('caps the list at twenty rows on the whole-network crop the dashboard and the kiosk\'s own unlocked layer share', () => {
    const wideCrop = { centre: DEFAULT_CROP.centre, radius: 5_000 };
    const { handle, root } = mount({ lightweight: true, net: null, crop: wideCrop });
    const routeIds = Array.from({ length: 21 }, (_, i) => String(i + 1));
    handle.update({ fixes: routeIds.map((id, i) => inCrop(`v${i}`, id, ROUTE_TYPE_TRAM, i * 0.00001)) });
    const rows = root.querySelectorAll('[data-testid=schematic-route]');
    expect(rows).toHaveLength(20);
    expect(root.querySelector('[data-testid=schematic-more]')!.textContent).toBe('još 1 linija');
  });
});

describe('mountSchematicView, owns the loop', () => {
  it('parks after nothing changes for a while, and update() wakes it again (loop.ts\'s own nudge contract)', () => {
    const { handle, fire, hasScheduled } = mount({ stubSize: { w: 200, h: 200 } });
    // No fixes at all: every frame draws the same "loading" legend and the
    // same empty mark list, so the loop should park after its own streak.
    for (let i = 0; i < 8; i++) fire();
    expect(hasScheduled()).toBe(false); // parked
    handle.update({ fixes: [fix({ id: 'v1', lon: 15.977, lat: 45.813, routeId: 'R-tram' })] });
    expect(hasScheduled()).toBe(true); // update() nudged it awake
  });
});

describe('mountSchematicView, destroy', () => {
  it('stops the loop so no further frame is ever requested', () => {
    const { handle, fire, hasScheduled } = mount({ stubSize: { w: 200, h: 200 } });
    expect(hasScheduled()).toBe(true);
    handle.destroy();
    fire(); // whatever was scheduled before destroy(), if anything, is inert now
    expect(hasScheduled()).toBe(false);
  });
});

// --- T9: tap or click a vehicle -------------------------------------------
// The default crop is centred on Trg bana Jelačića; a 400 CSS px box at
// density 2 is 800 device px across 1800 m, so a vehicle drawn at the crop
// centre sits at CSS (200, 200).
const CENTRE_CSS = 200;

describe('mountSchematicView, the tap card (T9)', () => {
  it('opens a card with the line, the direction and the route median delay on a click over a vehicle', () => {
    const { root, handle, fire, vehiclesCanvas, vehicleCalls } = mount({ stubSize: { w: 400, h: 400 } });
    // Two fixes along the tram shape, 30 s and ~100 m apart (under the 150 m
    // snap): real movement, so the model's confidence clears the heading
    // threshold and the direction is the shape's terminus, not "nepoznat".
    // A few frames run once a second right before the second fix (fewer
    // than the loop's park streak, so the frame clock is fresh when it
    // lands), and the fix is then something the mark glides toward, not a
    // jump.
    handle.update({ fixes: [fix({ id: 'v1', lon: 15.9756, lat: 45.813, routeId: 'R-tram', at: NOW - 30_000 })] }, NOW - 30_000);
    for (let t = NOW - 3_000; t < NOW; t += 1_000) fire(t);
    handle.update({ fixes: [fix({ id: 'v1', lon: 15.9769, lat: 45.813, routeId: 'R-tram', at: NOW })], delays: new Map([['R-tram', 40]]) }, NOW);
    fire(NOW);
    fire(NOW + 500);
    expect(card(root)!.hidden).toBe(true);
    // Tap where the last frame actually drew it (the translate that
    // positions the mark, in device px, halved back to CSS px) -- never at
    // the reported fix, which is not where the model has it (R-P2).
    const [dx, dy] = vehicleCalls.filter((c) => c.op === 'translate').at(-1)!.args as [number, number];
    expect(Math.abs(dx / 2 - CENTRE_CSS)).toBeGreaterThan(HIT_RADIUS_CSS_PX); // the fix itself is not under the mark
    clickAt(vehiclesCanvas!, dx / 2, dy / 2);
    const c = card(root)!;
    expect(c.hidden).toBe(false);
    expect(c.getAttribute('role')).toBe('dialog');
    expect(c.querySelector('[data-testid=vehicle-line]')!.textContent).toBe('R-tram');
    // Without the twin's headsign a bare fix names its direction by its own movement (east here), never a guessed terminus.
    expect(c.querySelector('[data-testid=vehicle-direction]')!.textContent).toBe('smjer istok');
    expect(c.querySelector('[data-testid=vehicle-delay]')!.textContent).toBe('kašnjenje linije: kasni 1 min');
  });

  it('reads "smjer nepoznat" for a vehicle at a standstill', () => {
    const { root, handle, fire, vehiclesCanvas } = mount({ stubSize: { w: 400, h: 400 } });
    handle.update({ fixes: [fix({ id: 'v1', lon: 15.9769, lat: 45.813, routeId: 'R-tram' })] });
    fire(NOW);
    clickAt(vehiclesCanvas!, CENTRE_CSS, CENTRE_CSS);
    expect(card(root)!.hidden).toBe(false);
    expect(card(root)!.querySelector('[data-testid=vehicle-direction]')!.textContent).toBe('smjer nepoznat');
    expect(card(root)!.querySelector('[data-testid=vehicle-delay]')!.textContent).toBe('kašnjenje linije nepoznato');
  });

  it('rings the selected vehicle on the canvas, and a click on empty canvas closes the card', () => {
    const { root, handle, fire, vehiclesCanvas, vehicleCalls } = mount({ stubSize: { w: 400, h: 400 } });
    handle.update({ fixes: [fix({ id: 'v1', lon: 15.9769, lat: 45.813, routeId: 'R-tram' })] });
    fire(NOW);
    clickAt(vehiclesCanvas!, CENTRE_CSS, CENTRE_CSS);
    fire(NOW + 16);
    expect(vehicleCalls.some((c) => c.op === 'rect')).toBe(true);
    clickAt(vehiclesCanvas!, 20, 20); // 180 CSS px away from the only vehicle
    expect(card(root)!.hidden).toBe(true);
    const before = vehicleCalls.length;
    fire(NOW + 32);
    expect(vehicleCalls.slice(before).some((c) => c.op === 'rect')).toBe(false);
  });

  it('is reachable by keyboard: the canvas is focusable, arrows pick a vehicle, Escape closes', () => {
    const { root, handle, fire, vehiclesCanvas } = mount({ stubSize: { w: 400, h: 400 } });
    expect(vehiclesCanvas!.getAttribute('tabindex')).toBe('0');
    const hintId = vehiclesCanvas!.getAttribute('aria-describedby')!;
    expect(root.querySelector('#' + hintId)!.textContent).toBe('Strelicama biraj vozilo; Escape zatvara karticu.');
    handle.update({ fixes: [
      fix({ id: 'v2', lon: 15.9769, lat: 45.813, routeId: 'R-tram' }),
      fix({ id: 'v1', lon: 15.977, lat: 45.812, routeId: 'R-bus' }),
    ] });
    fire(NOW);
    key(vehiclesCanvas!, 'ArrowRight');
    expect(card(root)!.hidden).toBe(false);
    expect(card(root)!.dataset.vehicle).toBe('v1'); // ordered by id, so the arrows walk the same list every frame
    key(vehiclesCanvas!, 'ArrowRight');
    expect(card(root)!.dataset.vehicle).toBe('v2');
    key(vehiclesCanvas!, 'ArrowRight');
    expect(card(root)!.dataset.vehicle).toBe('v1'); // wraps
    key(vehiclesCanvas!, 'Escape');
    expect(card(root)!.hidden).toBe(true);
    card(root)!.querySelector('button'); // the close button exists for pointer users too
    key(vehiclesCanvas!, 'Enter');
    expect(card(root)!.hidden).toBe(false);
    card(root)!.querySelector<HTMLButtonElement>('[data-testid=vehicle-card-close]')!.click();
    expect(card(root)!.hidden).toBe(true);
  });

  it('closes the card when the selected vehicle is no longer drawn (stale after 300 s of silence)', () => {
    const { root, handle, fire, vehiclesCanvas } = mount({ stubSize: { w: 400, h: 400 } });
    handle.update({ fixes: [fix({ id: 'v1', lon: 15.9769, lat: 45.813, routeId: 'R-tram' })] });
    fire(NOW);
    clickAt(vehiclesCanvas!, CENTRE_CSS, CENTRE_CSS);
    expect(card(root)!.hidden).toBe(false);
    fire(NOW + 301_000);
    expect(card(root)!.hidden).toBe(true);
  });

  it('closes the card by itself after cardIdleMs on a screen nobody is touching (R-P7: the next passer-by finds the invitation)', () => {
    const { root, handle, fire, vehiclesCanvas, timers } = mount({ stubSize: { w: 400, h: 400 }, cardIdleMs: 90_000 });
    handle.update({ fixes: [fix({ id: 'v1', lon: 15.9769, lat: 45.813, routeId: 'R-tram' })] });
    fire(NOW);
    clickAt(vehiclesCanvas!, CENTRE_CSS, CENTRE_CSS);
    const armed = timers.find((t) => t.ms === 90_000 && !t.cleared)!;
    expect(armed).toBeDefined();
    armed.fn();
    expect(card(root)!.hidden).toBe(true);
    expect(armed.cleared).toBe(true); // a one-shot: cleared when it fires
  });

  it('never renders a card or a focusable canvas on the lightweight path', () => {
    const { root } = mount({ lightweight: true });
    expect(card(root)).toBeNull();
    expect(root.querySelector('[tabindex]')).toBeNull();
    expect(root.querySelector('[data-testid=vehicle-list]')).toBeNull();
  });
});

describe('mountSchematicView, pause and resume', () => {
  it('pause() requests no further frame; resume() starts drawing again', () => {
    const { handle, fire, hasScheduled } = mount({ stubSize: { w: 200, h: 200 } });
    expect(hasScheduled()).toBe(true);
    handle.pause();
    fire();
    expect(hasScheduled()).toBe(false);
    handle.resume();
    expect(hasScheduled()).toBe(true);
  });
  it('draws nothing while its element is detached from the document, and parks', () => {
    const { root, handle, fire, hasScheduled, vehicleCalls } = mount({ stubSize: { w: 200, h: 200 } });
    handle.update({ fixes: [fix({ id: 'v1', lon: 15.9769, lat: 45.813, routeId: 'R-tram' })] });
    fire(NOW);
    root.remove(); // the dashboard swapped to another layer: the panel, and this view in it, left the DOM
    const before = vehicleCalls.length;
    for (let i = 0; i < 9; i++) fire(NOW + 16 * (i + 1));
    expect(vehicleCalls.length).toBe(before);
    expect(hasScheduled()).toBe(false); // parked, not spinning on an invisible canvas
    document.body.appendChild(root);
    handle.update({ fixes: [fix({ id: 'v1', lon: 15.9769, lat: 45.813, routeId: 'R-tram', at: NOW + 30_000 })] }, NOW + 30_000);
    expect(hasScheduled()).toBe(true); // the next render's update() wakes it
    fire(NOW + 30_016);
    expect(vehicleCalls.length).toBeGreaterThan(before);
  });
});

// --- R-F5: the moving map for people who cannot see it -----------------------
// The canvas keeps role="img" (its legend is the label) and gains a visually
// hidden list of the drawn vehicles as real buttons, rebuilt on update() and
// never per frame; the card is a real dialog that takes focus when opened
// from a button or a tap and hands it back on close. The arrow-key walk on
// the canvas stays for sighted keyboard users and never moves focus.
const list = (root: HTMLElement) => root.querySelector<HTMLElement>('[data-testid=vehicle-list]')!;
const listButtons = (root: HTMLElement) => [...list(root).querySelectorAll<HTMLButtonElement>('button')];
/** Two vehicles inside the default crop (ids deliberately out of order, so
 *  the list's id ordering is visible) and one tracked far outside it. */
const TWO_IN_CROP: Fix[] = [
  fix({ id: 'v2', lon: 15.9769, lat: 45.813, routeId: 'R-tram' }),
  fix({ id: 'v1', lon: 15.977, lat: 45.812, routeId: 'R-bus' }),
  fix({ id: 'v3', lon: 16.5, lat: 46.5, routeId: 'R-tram' }),
];

describe('mountSchematicView, the text path (R-F5)', () => {
  it("lists every drawn vehicle as a button in the arrow keys' own id order, saying what the card would say, rebuilt on update() and never per frame", () => {
    const { root, handle, fire } = mount({ stubSize: { w: 400, h: 400 } });
    const ul = list(root);
    expect(ul.tagName).toBe('UL');
    expect(ul.getAttribute('aria-label')).toBe('Vozila u kadru');
    expect(root.querySelector('#' + ul.getAttribute('aria-describedby'))!.textContent).toBe('Strelicama biraj vozilo; Enter otvara karticu.');
    expect(listButtons(root)).toHaveLength(0); // nothing drawn yet, nothing listed
    handle.update({ fixes: TWO_IN_CROP, delays: new Map([['R-tram', 40]]) });
    expect(listButtons(root).map((b) => b.dataset.vehicle)).toEqual(['v1', 'v2']); // v3 is tracked but not in frame
    expect(listButtons(root)[1].textContent).toBe('R-tram, smjer nepoznat, kašnjenje linije: kasni 1 min');
    expect(listButtons(root)[0].textContent).toBe('R-bus, smjer nepoznat, kašnjenje linije nepoznato');
    const before = listButtons(root);
    fire(NOW);
    fire(NOW + 500);
    fire(NOW + 1_000);
    expect(listButtons(root)).toEqual(before); // the very same elements: frames never touch the list
    // v1 falls silent for longer than STALE_S and is evicted (R-F2): its
    // button goes, v2's survives as the same element (a reader parked on it
    // is not thrown off by a poll).
    handle.update({ fixes: [fix({ id: 'v2', lon: 15.9769, lat: 45.813, routeId: 'R-tram', at: NOW + 301_000 })] }, NOW + 301_000);
    expect(listButtons(root).map((b) => b.dataset.vehicle)).toEqual(['v2']);
    expect(listButtons(root)[0]).toBe(before[1]);
  });

  it('a button opens the same card as a real non-modal dialog labelled by its line heading, moves focus to it, and Escape returns focus to that button', () => {
    const { root, handle } = mount({ stubSize: { w: 400, h: 400 } });
    handle.update({ fixes: TWO_IN_CROP, delays: new Map([['R-tram', 40]]) });
    const b = listButtons(root)[1];
    b.focus();
    b.click();
    const c = card(root)!;
    expect(c.hidden).toBe(false);
    expect(c.dataset.vehicle).toBe('v2');
    expect(c.getAttribute('role')).toBe('dialog');
    expect(c.getAttribute('aria-modal')).toBe('false');
    const heading = root.querySelector('#' + c.getAttribute('aria-labelledby'))!;
    expect(heading.tagName).toBe('H3');
    expect(heading.textContent).toBe('R-tram');
    expect(c.querySelector('[data-testid=vehicle-delay]')!.textContent).toBe('kašnjenje linije: kasni 1 min');
    expect(document.activeElement).toBe(c);
    key(c, 'Escape');
    expect(c.hidden).toBe(true);
    expect(document.activeElement).toBe(b);
  });

  it('the close button returns focus to the button that opened the card', () => {
    const { root, handle } = mount({ stubSize: { w: 400, h: 400 } });
    handle.update({ fixes: TWO_IN_CROP });
    const b = listButtons(root)[0];
    b.focus();
    b.click();
    const c = card(root)!;
    expect(document.activeElement).toBe(c);
    c.querySelector<HTMLButtonElement>('[data-testid=vehicle-card-close]')!.click();
    expect(c.hidden).toBe(true);
    expect(document.activeElement).toBe(b);
  });

  it('the idle close on a public screen returns focus to the list, never dropping it to body (R-P7 meets R-F5)', () => {
    const { root, handle, timers } = mount({ stubSize: { w: 400, h: 400 }, cardIdleMs: 90_000 });
    handle.update({ fixes: TWO_IN_CROP });
    const b = listButtons(root)[0];
    b.focus();
    b.click();
    const c = card(root)!;
    expect(document.activeElement).toBe(c);
    const armed = timers.find((t) => t.ms === 90_000 && !t.cleared)!;
    armed.fn();
    expect(c.hidden).toBe(true);
    expect(document.activeElement).toBe(list(root));
    expect(document.activeElement).not.toBe(document.body);
  });

  it('a tap on the canvas moves focus to the dialog too, and closing it hands focus back to the canvas', () => {
    const { root, handle, fire, vehiclesCanvas } = mount({ stubSize: { w: 400, h: 400 } });
    handle.update({ fixes: [fix({ id: 'v1', lon: 15.9769, lat: 45.813, routeId: 'R-tram' })] });
    fire(NOW);
    vehiclesCanvas!.focus(); // what a real click does before the click event fires
    clickAt(vehiclesCanvas!, CENTRE_CSS, CENTRE_CSS);
    const c = card(root)!;
    expect(c.hidden).toBe(false);
    expect(document.activeElement).toBe(c);
    c.querySelector<HTMLButtonElement>('[data-testid=vehicle-card-close]')!.click();
    expect(c.hidden).toBe(true);
    expect(document.activeElement).toBe(vehiclesCanvas);
  });

  it('the arrow keys on the canvas still walk the vehicles for sighted keyboard users, and never move focus off the canvas', () => {
    const { root, handle, fire, vehiclesCanvas } = mount({ stubSize: { w: 400, h: 400 } });
    handle.update({ fixes: TWO_IN_CROP });
    fire(NOW);
    vehiclesCanvas!.focus();
    key(vehiclesCanvas!, 'ArrowRight');
    expect(card(root)!.hidden).toBe(false);
    expect(card(root)!.dataset.vehicle).toBe('v1');
    expect(document.activeElement).toBe(vehiclesCanvas);
    key(vehiclesCanvas!, 'ArrowRight');
    expect(card(root)!.dataset.vehicle).toBe('v2');
    expect(document.activeElement).toBe(vehiclesCanvas);
    key(vehiclesCanvas!, 'Escape');
    expect(card(root)!.hidden).toBe(true);
    expect(document.activeElement).toBe(vehiclesCanvas);
  });

  it('is one tab stop: the arrow keys move between the vehicle buttons and the reached button becomes the stop, so a whole network is not three hundred Tabs', () => {
    const { root, handle } = mount({ stubSize: { w: 400, h: 400 } });
    handle.update({ fixes: TWO_IN_CROP });
    const tabindexes = () => listButtons(root).map((b) => b.getAttribute('tabindex'));
    expect(tabindexes()).toEqual(['0', '-1']);
    listButtons(root)[0].focus();
    key(listButtons(root)[0], 'ArrowDown');
    expect(document.activeElement).toBe(listButtons(root)[1]);
    expect(tabindexes()).toEqual(['-1', '0']);
    key(listButtons(root)[1], 'ArrowDown');
    expect(document.activeElement).toBe(listButtons(root)[0]); // wraps
    key(listButtons(root)[0], 'End');
    expect(document.activeElement).toBe(listButtons(root)[1]);
    key(listButtons(root)[1], 'Home');
    expect(document.activeElement).toBe(listButtons(root)[0]);
    key(listButtons(root)[0], 'ArrowUp');
    expect(document.activeElement).toBe(listButtons(root)[1]); // wraps the other way
    // The stop survives a poll: the same vehicle stays the one Tab reaches.
    handle.update({ fixes: TWO_IN_CROP });
    expect(tabindexes()).toEqual(['-1', '0']);
  });

  it("hands focus to the list when the focused button's vehicle leaves on a poll, instead of dropping it to body", () => {
    const { root, handle } = mount({ stubSize: { w: 400, h: 400 } });
    handle.update({ fixes: TWO_IN_CROP });
    listButtons(root)[0].focus(); // v1
    expect(document.activeElement).toBe(listButtons(root)[0]);
    handle.update({ fixes: [fix({ id: 'v2', lon: 15.9769, lat: 45.813, routeId: 'R-tram', at: NOW + 301_000 })] }, NOW + 301_000);
    expect(listButtons(root).map((b) => b.dataset.vehicle)).toEqual(['v2']);
    expect(document.activeElement).toBe(list(root));
  });

  it('a button whose vehicle the frame loop has since evicted opens nothing and simply leaves the list', () => {
    const { root, handle, fire } = mount({ stubSize: { w: 400, h: 400 } });
    handle.update({ fixes: [fix({ id: 'v1', lon: 15.9769, lat: 45.813, routeId: 'R-tram' })] });
    fire(NOW);
    fire(NOW + 301_000); // evicted by step(), between two polls
    expect(listButtons(root)).toHaveLength(1); // the list is rebuilt on update(), not per frame
    listButtons(root)[0].click();
    expect(card(root)!.hidden).toBe(true);
    expect(listButtons(root)).toHaveLength(0);
  });

  it('renders no vehicle list on the lightweight path, whose whole face is already a list', () => {
    const { root } = mount({ lightweight: true });
    expect(root.querySelector('[data-testid=vehicle-list]')).toBeNull();
  });
});
