// Mounts the schematic onto a page: the two stacked canvases on the modern
// path (routes under vehicles, T7's paintRoutes/paintVehicles), the honest
// list of nearby stops on the lightweight one (R-L2), and the legend both
// faces share. This file owns the motion model and the frame loop -- the
// caller only ever hands it fixes and per-route delay figures through
// `update()`; it never reads a reported position off a `Fix` itself, and
// nothing here ever paints one (R-P2).
//
// The two surfaces that will mount this (T9: the U pokretu panel, the
// kiosk's `.kiosk-live` stage slot) differ only in what they pass in: a
// `crop`/`types` pair (the whole network for a session, the screen's own
// centre and trams only for a locked kiosk, R-P1) and, in time, a resolved
// `Network` once `network.ts`'s loadNetwork() settles.
import { dist } from './geo';
import { createLoop, type Loop } from './loop';
import { createModel, type Fix, type Model } from './model';
import type { Network, Stop } from './network';
import {
  DEFAULT_CROP,
  layoutSchematic,
  paintRoutes,
  paintVehicles,
  vehicleMarks,
  type Crop,
  type SchematicLayout,
  type VehicleMark,
} from './schematic';
import type { I18n } from '../i18n/i18n';
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
  destroy(): void;
}

/** The `panels.delayLate`/`delayEarly`/`delayOnTime` band, in seconds: the
 *  same ±15 s on-time threshold u-pokretu.ts's routeDelays rendering and
 *  kiosk.ts's own delayWord already use for this identical field. Matched by
 *  value here (not a shared import) for the same reason kiosk.ts gives: the
 *  three copies must never disagree about whether the same live route is
 *  running on time, which a shared constant proves as well as a shared
 *  function would. */
function delayWord(i18n: I18n, seconds: number): string {
  if (seconds > 15) return i18n.t('panels.delayLate', { seconds });
  if (seconds < -15) return i18n.t('panels.delayEarly', { seconds: Math.abs(seconds) });
  return i18n.t('panels.delayOnTime');
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
 *  a hundredth of a pixel, a thousandth of a radian. */
function marksSignature(marks: readonly VehicleMark[]): string {
  return marks.map((m) => `${m.id}:${Math.round(m.x * 100)},${Math.round(m.y * 100)},${Math.round(m.angle * 1000)},${Math.round(m.alpha * 100)}`).join('|');
}

function markup(lightweight: boolean): string {
  return lightweight
    ? `<ul class="schematic-list" data-testid="schematic-list"></ul>
       <p class="schematic-legend" data-testid="schematic-legend"></p>`
    : `<div class="schematic-canvases">
         <canvas class="schematic-routes" data-testid="schematic-routes" aria-hidden="true"></canvas>
         <canvas class="schematic-vehicles" data-testid="schematic-vehicles" role="img" aria-label=""></canvas>
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

  const model: Model = createModel(deps.net);
  let delays: ReadonlyMap<string, number> = new Map();
  let hasData = false; // before the first update(): "loading", never a false zero (R-P2's own honesty discipline elsewhere in this area)

  const element = document.createElement('div');
  element.className = 'schematic';
  element.dataset.testid = 'schematic';
  element.innerHTML = markup(lightweight);
  container.appendChild(element);

  const routesCanvas = element.querySelector<HTMLCanvasElement>('[data-testid=schematic-routes]');
  const vehiclesCanvas = element.querySelector<HTMLCanvasElement>('[data-testid=schematic-vehicles]');
  const listEl = element.querySelector<HTMLElement>('[data-testid=schematic-list]');
  const legend = element.querySelector<HTMLElement>('[data-testid=schematic-legend]')!;

  let layout: SchematicLayout = layoutSchematic(netOrEmpty, crop, NOMINAL_PX, NOMINAL_PX, 1, types);
  let vehiclesCtx: CanvasRenderingContext2D | null = null;
  let ink = '#f2ead8';

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
    ink = tone(vehiclesCanvas, '--tone-text-primary', '#f2ead8');
    if (sizedRoutes) paintRoutes(sizedRoutes.ctx, layout, ink);
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

  let lastMarksSignature = '';

  function draw(t: number): boolean {
    const drawnList = model.step(t);
    const marks = vehicleMarks(layout, drawnList);
    const legendChanged = paintLegend(marks.length, model.size());
    element.dataset.frames = String(loop.frames());
    if (lightweight) return legendChanged;
    if (vehiclesCtx) paintVehicles(vehiclesCtx, layout, marks, ink);
    const sig = marksSignature(marks);
    const moved = sig !== lastMarksSignature;
    lastMarksSignature = sig;
    return legendChanged || moved;
  }

  const loop: Loop = createLoop(draw, {
    raf: deps.raf,
    cancel: deps.cancel,
    now: deps.now,
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
    destroy() {
      loop.stop();
      stopRepaint?.();
      element.remove();
    },
  };
}
