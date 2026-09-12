// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { createDefaultI18n } from '../../app/src/i18n/create-default-i18n';
import { toPlane } from '../../app/src/motion/geo';
import type { Fix } from '../../app/src/motion/model';
import type { Network, Shape, Stop } from '../../app/src/motion/network';
import { cumulative } from '../../app/src/motion/polyline';
import { HIT_RADIUS_CSS_PX, ROUTE_TYPE_BUS, ROUTE_TYPE_TRAM } from '../../app/src/motion/schematic';
import { mountSchematicView } from '../../app/src/motion/schematic-view';

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
  const stopTram: Stop = { id: 'ST1', name: 'Jelačić plac', p: toPlane(15.977, 45.813), on: [{ shape: 0, s: tram.cum[1] }] };
  const stopBus: Stop = { id: 'ST2', name: 'Jelačić plac (bus)', p: toPlane(15.977, 45.813), on: [{ shape: 1, s: bus.cum[1] }] };
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
  let repaint: (() => void) | null = null;
  // One-shot timers the view arms for the card's idle close, fired by hand.
  const timers: { fn: () => void; ms: number; cleared: boolean }[] = [];
  const handle = mountSchematicView(root, {
    i18n,
    net: opts.net === undefined ? testNetwork() : opts.net,
    types: opts.types,
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

describe('mountSchematicView, lightweight path (R-L2)', () => {
  it('renders no canvas at all', () => {
    const { root } = mount({ lightweight: true });
    expect(root.querySelector('canvas')).toBeNull();
    expect(root.querySelector('[data-testid=schematic-list]')).not.toBeNull();
  });

  it('lists the nearest stops with the lines calling at them, tram rows first, each with its route label and delay word', () => {
    const { handle, root } = mount({ lightweight: true });
    handle.update({ fixes: [], delays: new Map([['R-tram', 40], ['R-bus', -20]]) });
    const stops = root.querySelectorAll('[data-testid=schematic-stop]');
    expect(stops.length).toBe(2);
    const tramStop = [...stops].find((s) => s.textContent?.includes('6'))!;
    const line = tramStop.querySelector('[data-testid=schematic-line]')!;
    expect(line.textContent).toContain('6');
    // panels.delayLate's own template ("+{seconds} s"), the identical word
    // u-pokretu.ts's routeDelays rendering and kiosk.ts's delayWord produce
    // for this same field.
    expect(line.textContent).toContain('+40 s');
  });

  it('shows the same legend text as the canvas path -- same data, same legend, no apology -- on the once-a-second timer tick, never a frame request (R-F6)', () => {
    const { handle, tick, root, hasScheduled } = mount({ lightweight: true });
    handle.update({ fixes: [fix({ id: 'v1', lon: 15.977, lat: 45.813, routeId: 'R-tram' })] });
    expect(hasScheduled()).toBe(false); // no requestAnimationFrame on this path, ever
    tick(NOW);
    const legend = root.querySelector('[data-testid=schematic-legend]')!;
    expect(legend.textContent).toBe('1 od 1 praćenih vozila u kadru');
  });

  it('drops a route type the caller filtered out of the list, exactly as the canvas would drop it from the route layer', () => {
    const { handle, root } = mount({ lightweight: true, types: new Set([ROUTE_TYPE_TRAM]) });
    handle.update({ fixes: [], delays: new Map([['R-tram', 0], ['R-bus', 0]]) });
    const stops = root.querySelectorAll('[data-testid=schematic-stop]');
    expect(stops.length).toBe(1);
    expect(stops[0].textContent).toContain('6');
    expect(stops[0].textContent).not.toContain('109');
  });

  it('falls back to the honest empty state, never an apology, when no stop qualifies', () => {
    const { handle, root } = mount({ lightweight: true, types: new Set([99]) });
    handle.update({ fixes: [] });
    const empty = root.querySelector('[data-testid=schematic-empty]');
    expect(empty).not.toBeNull();
    expect(empty!.textContent).toBe('Trenutačno nema stavki.');
    expect(root.querySelector('[data-testid=schematic-list]')!.textContent).not.toMatch(/nažalost|ažao|sorry/i);
  });

  it('tolerates a null network (not yet loaded) with the honest empty state rather than throwing', () => {
    const { handle, root } = mount({ lightweight: true, net: null });
    expect(() => handle.update({ fixes: [] })).not.toThrow();
    expect(root.querySelector('[data-testid=schematic-empty]')).not.toBeNull();
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
    expect(c.querySelector('[data-testid=vehicle-direction]')!.textContent).toBe('smjer Jelačić plac');
    expect(c.querySelector('[data-testid=vehicle-delay]')!.textContent).toBe('kašnjenje linije: +40 s');
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
