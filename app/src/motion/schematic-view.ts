// Mounts the schematic onto a page: the two stacked canvases on the modern
// path (routes under vehicles, T7's paintRoutes/paintVehicles), the honest
// list of the lines in frame on the lightweight one (R-L2, R-F8 -- not the
// stops, which live in the geometry file this path never fetches, R-L4),
// the legend both faces share, and -- on the canvas path -- the tap card
// for one vehicle
// (T9) with its text path for people who cannot see the canvas (R-F5): a
// visually hidden list of the drawn vehicles as real buttons that open the
// same card, which is a real dialog that takes focus and hands it back.
// This file owns the motion model and the frame loop; the caller only
// ever hands it fixes and per-route delay figures through `update()`. It
// never reads a reported position off a `Fix` itself, and nothing here ever
// paints one (R-P2): the card, like the marks and the list, describes the
// model's own estimate.
//
// The two surfaces that mount this (through motion/schematic-host.ts: the U
// pokretu panel and the kiosk's `.kiosk-live` stage slot) differ only in
// what they pass in: a `crop`/`types` pair (the whole network for a session,
// the screen's own centre and trams only for a locked kiosk, R-P1) and the
// resolved `Network` once network.ts's loadNetwork() has settled.
import { dist, type XY } from './geo';
import { createLoop, type Loop } from './loop';
import { createModel, type Drawn, type Fix, type Model } from './model';
import type { Network } from './network';
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
import { ZET_ROUTES } from '../data/routes';
import type { I18n } from '../i18n/i18n';
import { summariseRoutes, type RouteVehicle } from '../layers/route-summary';
import { statusText } from '../panels/panel';
import { DENSITY, prepareCanvas, tone } from '../ui/canvas';
import { escapeAttribute, escapeHtml } from '../ui/dom/escape';
import type { ModuleSnapshot } from '../../../worker/feed/schema';

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

/** R-F8: ten rows on a locked screen's own small crop (R-P1's own box,
 *  rarely more than a handful of distinct routes anyway), twenty on the
 *  whole-network view every session shares (u-pokretu.ts's own layer, on a
 *  phone or inside an unlocked kiosk). This view has no other signal for
 *  "which screen is this" -- crop/types are the whole of its own contract
 *  -- so the cap is decided from the crop's own radius: a crop this wide
 *  can only be wholeNetworkCrop()'s bounding circle (several km, the whole
 *  city), never a locked screen's own configured one (R-P1's few hundred
 *  metres, DEFAULT_RADIUS_M's own 900 m included). */
const WHOLE_NETWORK_RADIUS_THRESHOLD_M = 2_000;
const LIST_CAP_CROP = 10;
const LIST_CAP_NETWORK = 20;

export interface SchematicUpdate {
  fixes: readonly Fix[];
  /** routeId -> median delay in seconds (positive late, negative early),
   *  the same 'route:<id>' summary item the zet-rt module already publishes
   *  (u-pokretu.ts's own routeDelays reads the identical field). Never
   *  derived from position data, which carries no delay information at all;
   *  omitted keeps whatever the view already had. */
  delays?: ReadonlyMap<string, number>;
  /** The zet-rt module's own snapshot (R-F8), read only by the lightweight
   *  list: when it isn't 'live' the list prints the exact sentence
   *  panels/panel.ts's statusText already renders elsewhere for the same
   *  status, instead of the empty-list sentence a real outage must never
   *  wear (the same honesty rule as R-X1). Absent or 'live' falls through
   *  to the ordinary rows/empty rendering; the canvas path never reads
   *  this field at all. */
  snapshot?: ModuleSnapshot;
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

/** The bare route label a rider reads on the front of the vehicle, resolved
 *  from the static GTFS routes table (data/routes.ts's own ZET_ROUTES) --
 *  never the network artefact, which the lightweight path never fetches
 *  (R-L4) and which this view may not even hold yet on the canvas path
 *  either. Unknown to the table (a fixture id in a test, a route GTFS
 *  dropped) falls back to the bare id itself, same as routeName() does for
 *  its own fuller form. */
function routeChip(routeId: string): string {
  return ZET_ROUTES[routeId]?.shortName || routeId;
}

/** Every fresh, type-matching vehicle in the crop, as the plain shape
 *  route-summary.ts's summariseRoutes() wants -- the same three filters
 *  vehicleMarks() applies for the canvas path (type, then the crop
 *  circle), so the lightweight list and the legend's own "drawn" figure
 *  can never disagree about which vehicles are "in frame" (R-F8). A fix
 *  with no routeId at all names no route and is dropped: R-F8 lists
 *  routes, not shapeless vehicles. */
function routeVehiclesInFrame(drawnList: readonly Drawn[], crop: Crop, types: ReadonlySet<number> | null): RouteVehicle[] {
  const out: RouteVehicle[] = [];
  for (const v of drawnList) {
    if (v.routeId === undefined) continue;
    if (types && !types.has(v.type)) continue;
    if (dist(v.p, crop.centre) > crop.radius) continue;
    out.push({ routeId: v.routeId, label: routeChip(v.routeId), type: v.type });
  }
  return out;
}

/** Coarse enough that the model's own floating-point convergence noise never
 *  keeps the loop from ever parking, fine enough that real motion (the
 *  convergence the whole area exists to draw) still registers as "changed":
 *  a hundredth of a pixel, a thousandth of a radian. The selection rides
 *  along so a ring appearing or leaving is a change too. */
function marksSignature(marks: readonly VehicleMark[], selectedId: string | null): string {
  return `${selectedId ?? ''}#${marks.map((m) => `${m.id}:${Math.round(m.x * 100)},${Math.round(m.y * 100)},${Math.round(m.angle * 1000)},${Math.round(m.alpha * 100)}`).join('|')}`;
}

/** The order the arrow keys walk the drawn vehicles in, and the order the
 *  vehicle list holds them in: by id, so the same key from the same vehicle
 *  lands on the same neighbour frame after frame while everything on the
 *  canvas is moving, and a reader's list does not reshuffle under them on
 *  a poll. */
function byId(a: VehicleMark, b: VehicleMark): number {
  return a.id.localeCompare(b.id, 'hr', { numeric: true });
}

/** Why the card closed decides where focus goes if it was inside (R-F5):
 *  by the person's own hand (Escape, the close button, a tap elsewhere)
 *  back to what opened it; by the idle clock (R-P7) to the vehicle list;
 *  because the vehicle left the frame, back to the opener while it lasts. */
type CloseReason = 'user' | 'idle' | 'gone';

let uid = 0;

interface MarkupIds {
  hint: string;
  listHint: string;
  line: string;
}

function markup(lightweight: boolean, i18n: I18n, ids: MarkupIds): string {
  if (lightweight) {
    return `<ul class="schematic-list" data-testid="schematic-list"></ul>
       <p class="schematic-legend" data-testid="schematic-legend"></p>`;
  }
  // Three ways in, one card out (T9, R-F5). The vehicle canvas is the
  // pointer surface and the sighted keyboard route: a tab stop whose arrow
  // keys walk the vehicles, role="img" with the legend as its label and its
  // keys explained in a hidden description. The list under it is the
  // reader's route: one real button per drawn vehicle, saying what the card
  // says, one tab stop with the arrows moving inside it; a reader in browse
  // mode meets it as an ordinary list of buttons. The card is a non-modal
  // dialog labelled by its own line heading, so a reader hears
  // "6 · Črnomerec-Sopot, dialog" the moment focus lands on it.
  return `<div class="schematic-canvases">
         <canvas class="schematic-routes" data-testid="schematic-routes" aria-hidden="true"></canvas>
         <canvas class="schematic-vehicles" data-testid="schematic-vehicles" role="img" aria-label="" tabindex="0" aria-describedby="${ids.hint}"></canvas>
         <p class="visually-hidden" id="${ids.hint}">${escapeHtml(i18n.t('motion.canvasHint'))}</p>
         <p class="visually-hidden" id="${ids.listHint}">${escapeHtml(i18n.t('motion.listHint'))}</p>
         <ul class="schematic-vehicle-list" data-testid="vehicle-list" aria-label="${escapeAttribute(i18n.t('motion.vehicleList'))}" aria-describedby="${ids.listHint}" tabindex="-1"></ul>
         <section class="schematic-card" data-testid="vehicle-card" role="dialog" aria-modal="false" aria-labelledby="${ids.line}" tabindex="-1" hidden>
           <h3 class="schematic-card-line" id="${ids.line}" data-testid="vehicle-line"></h3>
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
  // R-F8: the lightweight list's own status line, read only from the caller's
  // most recent update() (kiosk.ts is the only caller that passes one today).
  let latestSnapshot: ModuleSnapshot | undefined;
  const listCap = crop.radius > WHOLE_NETWORK_RADIUS_THRESHOLD_M ? LIST_CAP_NETWORK : LIST_CAP_CROP;

  const id = ++uid;
  const element = document.createElement('div');
  element.className = 'schematic';
  element.dataset.testid = 'schematic';
  element.innerHTML = markup(lightweight, i18n, { hint: `schematic-hint-${id}`, listHint: `schematic-list-hint-${id}`, line: `schematic-line-${id}` });
  container.appendChild(element);

  const routesCanvas = element.querySelector<HTMLCanvasElement>('[data-testid=schematic-routes]');
  const vehiclesCanvas = element.querySelector<HTMLCanvasElement>('[data-testid=schematic-vehicles]');
  const listEl = element.querySelector<HTMLElement>('[data-testid=schematic-list]');
  const vehicleList = element.querySelector<HTMLElement>('[data-testid=vehicle-list]');
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

  /** R-F8: the honest lightweight face of seeing the trams around you --
   *  one row per route among the fresh vehicles in frame, never the stops
   *  R-L2 first asked for (the geometry file that would name them is
   *  exactly what R-L4 forbids this path to fetch). Before the first
   *  update() this says "loading", the same honesty gate the legend
   *  already keeps (hasData); once data has arrived a snapshot that isn't
   *  live prints the panels' own stale/down sentence, never the empty
   *  one -- an outage must never read as "nothing running" (R-X1). */
  function renderList(): void {
    if (!listEl) return;
    if (!hasData) {
      listEl.innerHTML = `<li class="schematic-empty" data-testid="schematic-loading">${escapeHtml(i18n.t('status.loading'))}</li>`;
      return;
    }
    if (latestSnapshot && latestSnapshot.status !== 'live') {
      listEl.innerHTML = `<li class="schematic-empty" data-testid="schematic-status">${escapeHtml(statusText(latestSnapshot, i18n, now()))}</li>`;
      return;
    }
    const routes = summariseRoutes(routeVehiclesInFrame(model.step(now()), crop, types), delays, i18n);
    if (routes.length === 0) {
      listEl.innerHTML = `<li class="schematic-empty" data-testid="schematic-empty">${escapeHtml(i18n.t('status.empty'))}</li>`;
      return;
    }
    const shown = routes.slice(0, listCap);
    const overflow = routes.length - shown.length;
    listEl.innerHTML =
      shown
        .map(
          (r) => `<li class="schematic-route" data-testid="schematic-route">
          <span class="schematic-route-label">${escapeHtml(r.label)}</span> <span class="schematic-route-value">${escapeHtml(i18n.t('panels.vehiclesCount', { count: r.count }))} · ${escapeHtml(r.word)}</span>
        </li>`,
        )
        .join('') +
      (overflow > 0 ? `<li class="schematic-more" data-testid="schematic-more">${escapeHtml(i18n.t('panels.moreRoutes', { count: overflow }))}</li>` : '');
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
  // `openerEl` is what opened it -- a list button, or the canvas -- and is
  // where focus returns when the person closes it (R-F5).
  let selectedId: string | null = null;
  let openerEl: HTMLElement | null = null;
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
      closeCard('idle');
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

  /** `opener` is what gets focus back when the person closes the card;
   *  `focusCard` moves focus onto the dialog now -- true from a list button
   *  or a tap, false from the arrow keys, whose whole point is that focus
   *  stays on the canvas while the card follows the selection. */
  function openCard(vehicleId: string, opener: HTMLElement | null, focusCard: boolean): void {
    if (!cardEl) return;
    const drawnList = model.step(now());
    if (!drawnList.some((v) => v.id === vehicleId)) {
      // Evicted between two polls (R-F2): the list still holds its button
      // until the next update(). Nothing to describe; drop the button now.
      renderVehicleList(drawnList);
      return;
    }
    selectedId = vehicleId;
    openerEl = opener;
    lastCardText = '';
    cardEl.dataset.vehicle = vehicleId;
    cardEl.hidden = false;
    paintCard(drawnList);
    if (focusCard) cardEl.focus();
    armIdle();
    loop.nudge();
  }

  /** Focus never falls to body when the card goes (R-F5): back to the
   *  opener while it is still in the document, else -- and always on the
   *  idle close, R-P7's own case -- to the vehicle list, the one landing
   *  that stays put while everything else on the canvas moves. */
  function closeCard(reason: CloseReason): void {
    disarmIdle();
    if (selectedId === null || !cardEl) return;
    const focusWasInside = cardEl.contains(document.activeElement);
    const opener = openerEl;
    selectedId = null;
    openerEl = null;
    cardEl.hidden = true;
    delete cardEl.dataset.vehicle;
    if (focusWasInside) {
      const target = reason !== 'idle' && opener?.isConnected ? opener : (vehicleList ?? vehiclesCanvas);
      target?.focus();
    }
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
    if (hit) openCard(hit.id, vehiclesCanvas, true);
    else closeCard('user');
  }

  function stepSelection(direction: 1 | -1): void {
    const ordered = [...lastMarks].sort(byId);
    if (ordered.length === 0) return;
    const at = selectedId === null ? -1 : ordered.findIndex((m) => m.id === selectedId);
    const next = at === -1 ? (direction === 1 ? 0 : ordered.length - 1) : (at + direction + ordered.length) % ordered.length;
    openCard(ordered[next].id, vehiclesCanvas, false);
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
        closeCard('user');
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  function onCardKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeCard('user');
      return;
    }
    armIdle(); // a key inside the card means someone is still reading it
  }

  // --- The reader's route (R-F5) -------------------------------------------
  // One real <button> per drawn vehicle, in the id order the arrow keys
  // walk, rebuilt on update() -- a poll, twenty to thirty seconds apart --
  // and never per frame. Reconciled by vehicle id rather than rewritten: a
  // reader parked on a button keeps that very element across polls, and
  // because surviving items never change their relative order (both sides
  // sort by id) no existing node is ever moved, so focus cannot fall off
  // one. The list is a single tab stop (a whole network is hundreds of
  // vehicles, and a sighted keyboard user already has the canvas): the
  // arrows move between the buttons and the one reached becomes the stop.
  let activeVehicleId: string | null = null;

  function vehicleButtons(): HTMLButtonElement[] {
    return vehicleList ? [...vehicleList.querySelectorAll<HTMLButtonElement>('button')] : [];
  }

  function setActiveButton(active: HTMLButtonElement): void {
    for (const b of vehicleButtons()) {
      const want = b === active ? '0' : '-1';
      if (b.getAttribute('tabindex') !== want) b.setAttribute('tabindex', want);
    }
    activeVehicleId = active.dataset.vehicle ?? null;
  }

  function vehicleItem(vehicleId: string): HTMLLIElement {
    const li = document.createElement('li');
    li.className = 'schematic-vehicle';
    li.dataset.vehicle = vehicleId;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'schematic-vehicle-button';
    button.dataset.vehicle = vehicleId;
    button.setAttribute('tabindex', '-1');
    li.appendChild(button);
    return li;
  }

  /** The button says what the card would say for this vehicle, in the same
   *  three parts and the same words (vehicle-card.ts), so pressing it never
   *  surprises: "6 · Črnomerec-Sopot, smjer Sopot, kašnjenje linije: +40 s". */
  function paintVehicleButton(button: HTMLButtonElement, v: Drawn): void {
    const card = describeVehicle(i18n, netOrEmpty, v, delays);
    const text = `${card.line}, ${card.direction}, ${card.delay}`;
    if (button.textContent !== text) button.textContent = text;
  }

  function renderVehicleList(drawnList: readonly Drawn[]): void {
    if (!vehicleList) return;
    const byVehicle = new Map<string, Drawn>();
    for (const v of drawnList) byVehicle.set(v.id, v);
    const inFrame = vehicleMarks(layout, drawnList).sort(byId);
    const keep = new Set(inFrame.map((m) => m.id));
    const focused = document.activeElement;
    let focusLost = focused !== null && focused !== vehicleList && vehicleList.contains(focused);

    // A merge walk over two id-sorted sequences: the items already in the
    // list and the vehicles now in frame. Gone items are removed as the walk
    // passes them, new ones inserted before the item they precede, and a
    // survivor is left exactly where it is.
    let cursor: Element | null = vehicleList.firstElementChild;
    const gone = (el: Element): Element | null => {
      const next = el.nextElementSibling;
      el.remove();
      return next;
    };
    for (const mark of inFrame) {
      while (cursor && !keep.has((cursor as HTMLElement).dataset.vehicle ?? '')) cursor = gone(cursor);
      let li: HTMLLIElement;
      if (cursor && (cursor as HTMLElement).dataset.vehicle === mark.id) {
        li = cursor as HTMLLIElement;
        cursor = cursor.nextElementSibling;
      } else {
        li = vehicleItem(mark.id);
        vehicleList.insertBefore(li, cursor);
      }
      paintVehicleButton(li.firstElementChild as HTMLButtonElement, byVehicle.get(mark.id)!);
      if (focusLost && li.contains(focused)) focusLost = false;
    }
    while (cursor) cursor = gone(cursor);

    const buttons = vehicleButtons();
    const active = buttons.find((b) => b.dataset.vehicle === activeVehicleId) ?? buttons[0];
    if (active) setActiveButton(active);
    else activeVehicleId = null;
    // The button a reader was on went with its vehicle: land them on the
    // list, not on body.
    if (focusLost) vehicleList.focus();
  }

  function vehicleButtonOf(event: Event): HTMLButtonElement | null {
    const target = event.target instanceof Element ? event.target : null;
    return target?.closest<HTMLButtonElement>('button[data-vehicle]') ?? null;
  }

  function onListClick(event: MouseEvent): void {
    const button = vehicleButtonOf(event);
    if (!button?.dataset.vehicle) return;
    setActiveButton(button);
    openCard(button.dataset.vehicle, button, true);
  }

  /** A reader's virtual cursor can land on any button, tab stop or not;
   *  wherever it lands becomes the stop, so Tab and the arrows continue
   *  from there. */
  function onListFocusIn(event: FocusEvent): void {
    const button = vehicleButtonOf(event);
    if (button) setActiveButton(button);
  }

  function onListKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      if (selectedId === null) return;
      event.preventDefault();
      closeCard('user');
      return;
    }
    const buttons = vehicleButtons();
    if (buttons.length === 0) return;
    const at = buttons.findIndex((b) => b === document.activeElement);
    let next: number;
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowRight':
        next = at === -1 ? 0 : (at + 1) % buttons.length;
        break;
      case 'ArrowUp':
      case 'ArrowLeft':
        next = at === -1 ? buttons.length - 1 : (at - 1 + buttons.length) % buttons.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = buttons.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    setActiveButton(buttons[next]);
    buttons[next].focus();
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
    if (selectedId !== null && !marks.some((m) => m.id === selectedId)) closeCard('gone'); // left the crop, went quiet: nothing left to describe
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
  if (vehicleList) {
    vehicleList.addEventListener('click', onListClick);
    vehicleList.addEventListener('keydown', onListKey);
    vehicleList.addEventListener('focusin', onListFocusIn);
  }
  if (cardEl) {
    cardEl.addEventListener('keydown', onCardKey);
    cardEl.addEventListener('pointerdown', armIdle); // a touch inside the card means someone is still reading it
  }
  closeButton?.addEventListener('click', () => closeCard('user'));

  return {
    element,
    update(data, nowArg) {
      const t = nowArg ?? now();
      model.update(data.fixes, t);
      if (data.delays) delays = data.delays;
      latestSnapshot = data.snapshot;
      hasData = true;
      if (lightweight) renderList();
      else renderVehicleList(model.step(t));
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
