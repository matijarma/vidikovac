// Mounts the schematic onto a page: the two stacked canvases on the modern
// path (routes under vehicles, T7's paintRoutes/paintVehicles), the honest
// list of nearby stops on the lightweight one (R-L2), the legend both
// faces share, and -- on the canvas path -- the tap card for one vehicle
// (T9). This file owns the motion model and the frame loop; the caller only
// ever hands it fixes and per-route delay figures through `update()`. It
// never reads a reported position off a `Fix` itself, and nothing here ever
// paints one (R-P2): the card, like the marks, describes the model's own
// estimate.
//
// The two surfaces that mount this (through motion/schematic-host.ts: the U
// pokretu panel and the kiosk's `.kiosk-live` stage slot) differ only in
// what they pass in: a `crop`/`types` pair (the whole network for a session,
// the screen's own centre and trams only for a locked kiosk, R-P1) and the
// resolved `Network` once network.ts's loadNetwork() has settled.
import { dist, type XY } from './geo';
import { createLoop, type Loop } from './loop';
import { createModel, type Drawn, type Fix, type Model } from './model';
import type { Network, Stop } from './network';
import {
  DEFAULT_CROP,
  hitVehicle,
  layoutSchematic,
  paintRoutes,
  paintVehicles,
  vehicleMarks,
  type Crop,
  type SchematicLayout,
  type VehicleMark,
  type VehicleTones,
} from './schematic';
import { describeVehicle, type VehicleCard } from './vehicle-card';
import type { I18n } from '../i18n/i18n';
import { delayWord } from '../layers/shared';
import { DENSITY, prepareCanvas, tone } from '../ui/canvas';
import { escapeHtml } from '../ui/dom/escape';

/** A network with nothing in it, standing in for `net === null` (not yet
 *  fetched -- network.ts's loadNetwork() resolves after first paint and
 *  never in lightweight mode, R-L4). `layoutSchematic` and the model both
 *  already tolerate this shape (an empty `shapes`/`stops` list, `nextStop`
 *  always null): every vehicle simply free-planes with no route lines and
 *  no stops to list, which is the honest state before the artefact lands,
 *  not a crash. */
const EMPTY_NETWORK: Network = {
  version: 0,
  feedVersion: '',
  routes: new Map(),
  shapes: [],
  stops: [],
  diagram: { lines: [], box: [1, 1] },
  nextStop: () => null,
};

/** The layout's pixel box before the first real measurement (or permanently,
 *  in lightweight mode, which never measures a canvas at all): only its
 *  `crop`/`types`/`net` fields matter before then, since nothing paints yet. */
const NOMINAL_PX = 800;

/** R-P1's own words: "about five to six stops around the screen's configured
 *  centre" -- the same figure schematic.ts's DEFAULT_RADIUS_M was tuned to
 *  show on the canvas. The lightweight list keeps the same scope so the two
 *  faces read as "same data": a stop that would not have fit in the crop
 *  circle at all is dropped first, and this cap only ever trims a crop that
 *  is itself large (the whole-network session view), never the locked
 *  kiosk's own small one. */
const NEAREST_STOPS_LIMIT = 6;

export interface SchematicUpdate {
  fixes: readonly Fix[];
  /** routeId -> median delay in seconds (positive late, negative early),
   *  the same 'route:<id>' summary item the zet-rt module already publishes
   *  (u-pokretu.ts's own routeDelays reads the identical field). Never
   *  derived from position data, which carries no delay information at all;
   *  omitted keeps whatever the view already had. */
  delays?: ReadonlyMap<string, number>;
}

export interface SchematicViewDeps {
  i18n: I18n;
  /** null when the artefact has not resolved yet (or never will, e.g. a
   *  routeless shape-1 vehicle) -- see EMPTY_NETWORK above. */
  net: Network | null;
  /** Defaults to DEFAULT_CROP (Trg bana Jelačića, 900 m). */
  crop?: Crop;
  /** Route types this view draws/lists, or null for every type (R-P1: trams
   *  only on a locked kiosk, null -- the whole network -- in a session). */
  types?: ReadonlySet<number> | null;
  /** R-L1: decided once at the entry and passed down, exactly like
   *  `reducedMotion`. No canvas, no WebGL, no container query on this path. */
  lightweight: boolean;
  reducedMotion?: boolean;
  now?: () => number;
  /** Re-runs the route-layer repaint on theme change (fires once immediately)
   *  and on resize, coalesced onto one frame (ui/canvas.ts's `repaintOn`).
   *  Absent in tests that don't care about theme/resize repainting; the
   *  initial paint still runs once synchronously either way. */
  onRepaint?: (listener: () => void) => () => void;
  /** Closes an open tap card after this long without a touch or a key --
   *  for a public screen (R-P7: the next passer-by should find the city,
   *  not a stranger's card). Absent on a phone, where the person closes it. */
  cardIdleMs?: number;
  /** The same interval-shaped timer pair kiosk.ts and dashboard.ts inject,
   *  used here as a resettable one-shot (cleared when it fires). */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  /** Loop internals, injectable for tests -- see motion/loop.ts's own LoopDeps. */
  raf?: (cb: (t: number) => void) => number;
  cancel?: (h: number) => void;
}

export interface SchematicViewHandle {
  element: HTMLElement;
  /** Folds a poll's fixes (and, when given, a fresh delay figure per route)
   *  into the model and wakes a parked loop -- the same "the caller calls
   *  nudge on new data" contract loop.ts documents, satisfied here because
   *  this view is the loop's own, sole caller. */
  update(data: SchematicUpdate, now?: number): void;
  /** Stops requesting frames (a hidden host: the kiosk stage during a
   *  session, a frozen dashboard). The model keeps its history. */
  pause(): void;
  resume(): void;
  destroy(): void;
}

interface StopLine {
  routeId: string;
  label: string;
  type: number;
  word: string;
}

/** Every distinct route calling at `stop`, restricted to `types`, tram rows
 *  first (decision: R-L2's own words) then by route label. A route with more
 *  than one shape through this stop (a short-turn variant, the two
 *  directions) appears once: the zet-rt module publishes one delay figure
 *  per route, not per shape, so a second row would have nothing new to say. */
function stopLines(net: Network, stop: Stop, types: ReadonlySet<number> | null, delays: ReadonlyMap<string, number>, i18n: I18n): StopLine[] {
  const seen = new Set<string>();
  const out: StopLine[] = [];
  for (const { shape: shapeIdx } of stop.on) {
    const shape = net.shapes[shapeIdx];
    if (!shape || seen.has(shape.route)) continue;
    const route = net.routes.get(shape.route);
    if (!route || (types && !types.has(route.type))) continue;
    seen.add(shape.route);
    out.push({ routeId: shape.route, label: route.short, type: route.type, word: delayWord(i18n, delays.get(shape.route) ?? 0) });
  }
  out.sort((a, b) => a.type - b.type || a.label.localeCompare(b.label, 'hr', { numeric: true }));
  return out;
}

interface NearestStop {
  stop: Stop;
  lines: StopLine[];
}

/** The nearest stops to the crop centre that actually have a qualifying line
 *  (a stop with only a filtered-out bus line, on a trams-only kiosk, is not
 *  "nearby" for this view's purposes) -- capped at NEAREST_STOPS_LIMIT so a
 *  whole-network crop (a session's dashboard) still reads as a short list,
 *  not the whole stops table. */
function nearestStops(net: Network, crop: Crop, types: ReadonlySet<number> | null, delays: ReadonlyMap<string, number>, i18n: I18n): NearestStop[] {
  return net.stops
    .map((stop) => ({ stop, d: dist(stop.p, crop.centre), lines: stopLines(net, stop, types, delays, i18n) }))
    .filter((s) => s.d <= crop.radius && s.lines.length > 0)
    .sort((a, b) => a.d - b.d)
    .slice(0, NEAREST_STOPS_LIMIT)
    .map(({ stop, lines }) => ({ stop, lines }));
}

/** Coarse enough that the model's own floating-point convergence noise never
 *  keeps the loop from ever parking, fine enough that real motion (the
 *  convergence the whole area exists to draw) still registers as "changed":
 *  a hundredth of a pixel, a thousandth of a radian. The selection rides
 *  along so a ring appearing or leaving is a change too. */
function marksSignature(marks: readonly VehicleMark[], selectedId: string | null): string {
  return `${selectedId ?? ''}#${marks.map((m) => `${m.id}:${Math.round(m.x * 100)},${Math.round(m.y * 100)},${Math.round(m.angle * 1000)},${Math.round(m.alpha * 100)}`).join('|')}`;
}

/** The order the arrow keys walk the drawn vehicles in: by id, so the same
 *  key from the same vehicle lands on the same neighbour frame after frame
 *  while everything on the canvas is moving. */
function byId(a: VehicleMark, b: VehicleMark): number {
  return a.id.localeCompare(b.id, 'hr', { numeric: true });
}

let uid = 0;

function markup(lightweight: boolean, i18n: I18n, hintId: string, lineId: string): string {
  if (lightweight) {
    return `<ul class="schematic-list" data-testid="schematic-list"></ul>
       <p class="schematic-legend" data-testid="schematic-legend"></p>`;
  }
  // The vehicle canvas is the one interactive surface (tap or click a
  // vehicle, T9), so it is in the tab order and its keys are explained in a
  // hidden description; the card is a non-modal dialog labelled by its own
  // line name, so a screen reader announces "6 · Črnomerec-Sopot, dialog".
  return `<div class="schematic-canvases">
         <canvas class="schematic-routes" data-testid="schematic-routes" aria-hidden="true"></canvas>
         <canvas class="schematic-vehicles" data-testid="schematic-vehicles" role="img" aria-label="" tabindex="0" aria-describedby="${hintId}"></canvas>
         <p class="visually-hidden" id="${hintId}">${escapeHtml(i18n.t('motion.canvasHint'))}</p>
         <section class="schematic-card" data-testid="vehicle-card" role="dialog" aria-labelledby="${lineId}" hidden>
           <p class="schematic-card-line" id="${lineId}" data-testid="vehicle-line"></p>
           <p class="schematic-card-row" data-testid="vehicle-direction"></p>
           <p class="schematic-card-row" data-testid="vehicle-delay"></p>
           <button type="button" class="btn-ghost schematic-card-close" data-testid="vehicle-card-close">${escapeHtml(i18n.t('common.close'))}</button>
         </section>
       </div>
       <p class="schematic-legend" data-testid="schematic-legend"></p>`;
}

export function mountSchematicView(container: HTMLElement, deps: SchematicViewDeps): SchematicViewHandle {
  const { i18n } = deps;
  const now = deps.now ?? (() => Date.now());
  const crop = deps.crop ?? DEFAULT_CROP;
  const types = deps.types ?? null;
  const lightweight = Boolean(deps.lightweight);
  const netOrEmpty = deps.net ?? EMPTY_NETWORK;
  const setTimer = deps.setTimer ?? ((fn, ms) => globalThis.setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((h) => globalThis.clearTimeout(h as never));

  const model: Model = createModel(deps.net);
  let delays: ReadonlyMap<string, number> = new Map();
  let hasData = false; // before the first update(): "loading", never a false zero (R-P2's own honesty discipline elsewhere in this area)

  const id = ++uid;
  const element = document.createElement('div');
  element.className = 'schematic';
  element.dataset.testid = 'schematic';
  element.innerHTML = markup(lightweight, i18n, `schematic-hint-${id}`, `schematic-line-${id}`);
  container.appendChild(element);

  const routesCanvas = element.querySelector<HTMLCanvasElement>('[data-testid=schematic-routes]');
  const vehiclesCanvas = element.querySelector<HTMLCanvasElement>('[data-testid=schematic-vehicles]');
  const listEl = element.querySelector<HTMLElement>('[data-testid=schematic-list]');
  const legend = element.querySelector<HTMLElement>('[data-testid=schematic-legend]')!;
  const cardEl = element.querySelector<HTMLElement>('[data-testid=vehicle-card]');
  const cardLine = element.querySelector<HTMLElement>('[data-testid=vehicle-line]');
  const cardDirection = element.querySelector<HTMLElement>('[data-testid=vehicle-direction]');
  const cardDelay = element.querySelector<HTMLElement>('[data-testid=vehicle-delay]');

  let layout: SchematicLayout = layoutSchematic(netOrEmpty, crop, NOMINAL_PX, NOMINAL_PX, 1, types);
  let vehiclesCtx: CanvasRenderingContext2D | null = null;
  // R-V2: three tones, read off computed style at every resize()/theme
  // change (never literals in schematic.ts). The fallbacks are the dark
  // face's own values, used only where getComputedStyle has no box to read.
  let tones: VehicleTones = { ink: '#f2ead8', halo: '#16226b' };
  let lineTone = '#9db4ff';

  /** Route-layer repaint: theme, resize or (never, in this view's own
   *  lifetime) crop change only -- schematic.ts's whole reason for two
   *  canvases. No-op in lightweight mode and while there is no layout box
   *  yet (happy-dom in a test with no stubbed size, an element not yet in
   *  the live DOM). */
  function resize(): void {
    if (lightweight || !routesCanvas || !vehiclesCanvas) return;
    const sizedVehicles = prepareCanvas(vehiclesCanvas, DENSITY);
    const sizedRoutes = prepareCanvas(routesCanvas, DENSITY);
    vehiclesCtx = sizedVehicles?.ctx ?? null;
    if (!sizedVehicles) return;
    layout = layoutSchematic(netOrEmpty, crop, sizedVehicles.w, sizedVehicles.h, DENSITY, types);
    tones = {
      ink: tone(vehiclesCanvas, '--tone-text-primary', tones.ink),
      halo: tone(vehiclesCanvas, '--tone-surface-canvas', tones.halo),
    };
    lineTone = tone(vehiclesCanvas, '--tone-label', lineTone);
    if (sizedRoutes) paintRoutes(sizedRoutes.ctx, layout, lineTone);
  }

  function renderList(): void {
    if (!listEl) return;
    const rows = nearestStops(netOrEmpty, crop, types, delays, i18n);
    if (rows.length === 0) {
      listEl.innerHTML = `<li class="schematic-empty" data-testid="schematic-empty">${escapeHtml(i18n.t('status.empty'))}</li>`;
      return;
    }
    listEl.innerHTML = rows
      .map(
        ({ stop, lines }) => `<li class="schematic-stop" data-testid="schematic-stop">
          <p class="schematic-stop-name">${escapeHtml(stop.name)}</p>
          <ul class="schematic-lines">
            ${lines.map((l) => `<li data-testid="schematic-line"><strong>${escapeHtml(l.label)}</strong> <span class="panel-sub">${escapeHtml(l.word)}</span></li>`).join('')}
          </ul>
        </li>`,
      )
      .join('');
  }

  let lastLegendText: string | null = null;

  /** R-F2: the legend's denominator is the vehicles this view is *for* --
   *  fresh (the model evicts the rest) and of a type it draws -- so
   *  "{drawn} od {tracked} praćenih vozila u kadru" is exactly true on a
   *  trams-only kiosk: tracked trams, of which this many are in frame. */
  function trackedCount(drawnList: readonly Drawn[]): number {
    let n = 0;
    for (const v of drawnList) if (!v.stale && (!types || types.has(v.type))) n++;
    return n;
  }

  /** Writes the legend only when it actually changed (a DOM write every
   *  frame, most of them identical, is the kind of "redundant traffic" this
   *  whole project already treats as a defect elsewhere). Returns whether it
   *  changed, which also decides whether that alone keeps the loop awake. */
  function paintLegend(drawnCount: number, tracked: number): boolean {
    const text = hasData ? i18n.t('panels.schematicLegend', { drawn: drawnCount, tracked }) : i18n.t('status.loading');
    if (text === lastLegendText) return false;
    lastLegendText = text;
    legend.textContent = text;
    vehiclesCanvas?.setAttribute('aria-label', text);
    return true;
  }

  // --- The tap card (T9) ---------------------------------------------------
  // `selectedId` is the one vehicle the person picked; `lastMarks` is the
  // frame they picked it from (hit-testing runs against what was actually
  // on screen, not a frame computed after the tap). The card's three lines
  // are rewritten only when their text changes, same discipline as the
  // legend, so a card left open over a moving tram costs nothing per frame.
  let selectedId: string | null = null;
  let lastMarks: readonly VehicleMark[] = [];
  let lastCardText = '';
  let idleHandle: unknown = null;

  function disarmIdle(): void {
    if (idleHandle === null) return;
    clearTimer(idleHandle);
    idleHandle = null;
  }

  function armIdle(): void {
    disarmIdle();
    if (deps.cardIdleMs === undefined) return;
    idleHandle = setTimer(() => {
      disarmIdle();
      closeCard(false);
    }, deps.cardIdleMs);
  }

  function paintCard(drawnList: readonly Drawn[]): void {
    if (!cardEl || selectedId === null) return;
    const v = drawnList.find((d) => d.id === selectedId);
    if (!v) return;
    const card: VehicleCard = describeVehicle(i18n, netOrEmpty, v, delays);
    const text = `${card.line}\n${card.direction}\n${card.delay}`;
    if (text === lastCardText) return;
    lastCardText = text;
    cardLine!.textContent = card.line;
    cardDirection!.textContent = card.direction;
    cardDelay!.textContent = card.delay;
  }

  function openCard(vehicleId: string): void {
    if (!cardEl) return;
    selectedId = vehicleId;
    lastCardText = '';
    cardEl.dataset.vehicle = vehicleId;
    cardEl.hidden = false;
    paintCard(model.step(now()));
    armIdle();
    loop.nudge();
  }

  /** `restoreFocus` only when the person closed it themselves from inside
   *  the card (its close button); an idle close or a vehicle that left the
   *  crop has nothing to hand focus back for. */
  function closeCard(restoreFocus: boolean): void {
    disarmIdle();
    if (selectedId === null || !cardEl) return;
    const focusWasInside = cardEl.contains(document.activeElement);
    selectedId = null;
    cardEl.hidden = true;
    delete cardEl.dataset.vehicle;
    if (restoreFocus && focusWasInside) vehiclesCanvas?.focus();
    loop.nudge();
  }

  /** Device-pixel coordinates of a pointer event inside the vehicle canvas:
   *  the canvas backing store is DENSITY times its CSS box (prepareCanvas). */
  function devicePoint(event: MouseEvent): XY {
    const rect = vehiclesCanvas!.getBoundingClientRect();
    const sx = rect.width ? vehiclesCanvas!.width / rect.width : 1;
    const sy = rect.height ? vehiclesCanvas!.height / rect.height : 1;
    return { x: (event.clientX - (rect.left || 0)) * sx, y: (event.clientY - (rect.top || 0)) * sy };
  }

  function onCanvasClick(event: MouseEvent): void {
    const p = devicePoint(event);
    const hit = hitVehicle(lastMarks, p.x, p.y, layout.density);
    if (hit) openCard(hit.id);
    else closeCard(false);
  }

  function stepSelection(direction: 1 | -1): void {
    const ordered = [...lastMarks].sort(byId);
    if (ordered.length === 0) return;
    const at = selectedId === null ? -1 : ordered.findIndex((m) => m.id === selectedId);
    const next = at === -1 ? (direction === 1 ? 0 : ordered.length - 1) : (at + direction + ordered.length) % ordered.length;
    openCard(ordered[next].id);
  }

  function onCanvasKey(event: KeyboardEvent): void {
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        stepSelection(1);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        stepSelection(-1);
        break;
      case 'Enter':
      case ' ':
        if (selectedId === null) stepSelection(1);
        else armIdle();
        break;
      case 'Escape':
        if (selectedId === null) return;
        closeCard(true);
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  function onCardKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeCard(true);
      return;
    }
    armIdle(); // a key inside the card means someone is still reading it
  }

  let lastMarksSignature = '';

  function draw(t: number): boolean {
    // A view whose element left the document (the dashboard swapped to
    // another layer and took the panel with it) paints nothing and reports
    // no change, so the loop parks after its usual streak instead of
    // spinning on an invisible canvas; the next render's update() nudges
    // it awake again.
    if (!element.isConnected) return false;
    const drawnList = model.step(t);
    const marks = vehicleMarks(layout, drawnList);
    const legendChanged = paintLegend(marks.length, trackedCount(drawnList));
    element.dataset.frames = String(loop.frames());
    if (lightweight) return legendChanged;
    lastMarks = marks;
    if (selectedId !== null && !marks.some((m) => m.id === selectedId)) closeCard(false); // left the crop, went stale: nothing left to describe
    paintCard(drawnList);
    if (vehiclesCtx) paintVehicles(vehiclesCtx, layout, marks, tones, selectedId);
    const sig = marksSignature(marks, selectedId);
    const moved = sig !== lastMarksSignature;
    lastMarksSignature = sig;
    return legendChanged || moved;
  }

  const loop: Loop = createLoop(draw, {
    raf: deps.raf,
    cancel: deps.cancel,
    now: deps.now,
    // The reduced-motion and lightweight paths tick on a timer, never a
    // frame request (R-F6): the same injected pair the card's idle close uses.
    setTimer,
    clearTimer,
    reducedMotion: deps.reducedMotion,
    lightweight,
  });

  resize();
  if (lightweight) renderList();
  // The same "paint once synchronously before subscribing to anything" shape
  // every other view in this codebase follows (kiosk.ts's own
  // paintPanoramaFigure(), called directly and then again from onRepaint):
  // without this, the legend and the frame counter would sit blank until
  // the loop's first scheduled frame actually fires.
  draw(now());
  const stopRepaint = deps.onRepaint?.(() => resize());
  loop.start();

  const closeButton = element.querySelector<HTMLButtonElement>('[data-testid=vehicle-card-close]');
  if (vehiclesCanvas) {
    vehiclesCanvas.addEventListener('click', onCanvasClick);
    vehiclesCanvas.addEventListener('keydown', onCanvasKey);
  }
  if (cardEl) {
    cardEl.addEventListener('keydown', onCardKey);
    cardEl.addEventListener('pointerdown', armIdle); // a touch inside the card means someone is still reading it
  }
  closeButton?.addEventListener('click', () => closeCard(true));

  return {
    element,
    update(data, nowArg) {
      const t = nowArg ?? now();
      model.update(data.fixes, t);
      if (data.delays) delays = data.delays;
      hasData = true;
      if (lightweight) renderList();
      loop.nudge();
    },
    pause() {
      loop.stop();
    },
    resume() {
      loop.start();
    },
    destroy() {
      disarmIdle();
      loop.stop();
      stopRepaint?.();
      element.remove();
    },
  };
}
