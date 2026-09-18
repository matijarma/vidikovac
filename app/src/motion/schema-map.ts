// A second projection of the existing integrator, not a second engine.
// The schema renderer is dynamically imported only when its slot is requested.
import { toLonLat, type XY } from '../../../shared/motion/geo';
import { loadNetwork, type GraphNetwork, type Network } from '../../../shared/motion/network';
import { createSchemaPlacer, decodeSchema, pointAt, type Schema, type SchemaPlacement, type SchemaStop } from '../../../shared/motion/schema';
import { createDefaultI18n } from '../i18n/create-default-i18n';
import {
  bearingOf, pointsToFixes, vehicleKind, vehicleLabel,
  type CityMapHandle, type CityMapOptions, type FitPadding, type MapSelection, type MapStatus,
} from '../map/city-map';
import { DENSITY, tone } from '../ui/canvas';
import { escapeHtml } from '../ui/dom/escape';
import { createPanZoom, type PanZoom, type PanZoomViewport } from '../ui/pan-zoom';
import { createIntegrator, type Drawn, type Model } from './integrator';
import { createLoop } from './loop';
import { paintVehicles, type VehicleMark } from './schematic';
import { mountSceneAccessibility, sceneMarkup, type Scene, type SceneAccessibility } from './schematic-view';
import {
  KIOSK_LABEL_SCALE, KIOSK_LABEL_MIN_PX, LABEL_MIN_PX_PER_UNIT, paintSchema, schemaInFrame, schemaMarks,
  type SchemaLayout, type SchemaTones,
} from './schema-paint';
import './schematic.css';
import './schema.css';

export interface SchemaFrame {
  drawn: readonly Drawn[];
  marks: readonly VehicleMark[];
  viewport: PanZoomViewport;
  labels: boolean;
}
export interface SchemaMapDeps {
  now?: () => number;
  raf?: (callback: (t: number) => void) => number;
  cancel?: (handle: number) => void;
  loadSchema?: (signal: AbortSignal) => Promise<unknown>;
  onFrame?: (frame: SchemaFrame) => void;
  documentRef?: Document;
}

// Match the city map's 40px breathing room, in addition to the host's
// measured sheet/rail coverage. The controller clamps excessive padding.
const FIT_MARGIN = 40;
const STOP_HIT_PX = 14;
let cachedArtwork: unknown;
async function loadArtwork(signal: AbortSignal): Promise<unknown> {
  if (cachedArtwork) return cachedArtwork;
  const response = await fetch('/data/zet-schema.json', { signal });
  if (!response.ok) throw new Error(`Schema HTTP ${response.status}`);
  const raw: unknown = await response.json();
  decodeSchema(raw); // never memoise a malformed or obsolete payload
  cachedArtwork = raw;
  return raw;
}

export function createSchemaMap(options: CityMapOptions, deps: SchemaMapDeps = {}): CityMapHandle {
  const container = options.container, doc = deps.documentRef ?? container.ownerDocument;
  const now = deps.now ?? Date.now, interactive = options.interactive !== false;
  const publicDisplay=!interactive||options.basemapProfile==='prozor';
  const i18n = createDefaultI18n(options.locale ?? 'hr');
  const abort = new AbortController();
  const element = doc.createElement('div');
  element.className = 'schema-map';
  element.dataset.interactive = String(interactive);
  element.dataset.testid = 'schema-map';
  element.style.setProperty('--schema-bottom-pad', `${Math.max(0, options.fitPadding?.bottom ?? 0)}px`);
  element.innerHTML = `${sceneMarkup(i18n, { prefix: 'schema', interactive, externalSelection: true })}
    <p class="schema-note" data-testid="schema-note">${escapeHtml(i18n.t('motion.note'))}</p>`;
  container.appendChild(element);
  container.setAttribute('aria-label', options.ariaLabel);
  container.dataset.renderer = 'schema';
  container.dataset.mapStatus = 'loading';
  const routesCanvas = element.querySelector<HTMLCanvasElement>('[data-testid=schema-routes]')!;
  const vehicleCanvas = element.querySelector<HTMLCanvasElement>('[data-testid=schema-vehicles]')!;
  const legend = element.querySelector<HTMLElement>('[data-testid=schema-legend]')!;
  const note = element.querySelector<HTMLElement>('[data-testid=schema-note]')!;
  const density = DENSITY;
  let destroyed = false, paused = false, down = false;
  let status: MapStatus = 'loading';
  let net: GraphNetwork | null = null, schema: Schema | null = null, model: Model | null = null;
  const stopNames = new Map<string, string>();
  const namedStops = new Map<string, SchemaStop>();
  let placer: ReturnType<typeof createSchemaPlacer> | null = null, pan: PanZoom | null = null;
  let a11y: SceneAccessibility | null = null;
  let points = options.points ?? [];
  let lastDrawn: Drawn[] = [], lastMarks: VehicleMark[] = [], signature = '', frames = 0;
  let selection: MapSelection | null = options.selection ??
    (options.selectedRoute ? { kind: 'route', id: options.selectedRoute } : options.selectedStop ? { kind: 'stop', id: options.selectedStop } : null);
  let following = options.follow ?? null, stop = options.stop ?? null, padding = options.fitPadding ?? {};
  let modes = options.modes ?? null;
  let staticContext: CanvasRenderingContext2D | null = null, vehicleContext: CanvasRenderingContext2D | null = null;
  let origin: XY = { x: 0, y: 0 };
  const sceneListeners = new Set<() => void>();
  let listMembership = '';
  let pendingFit: 'city' | 'selection' | 'stop' | null = null;
  const onSelectionKey = (event: KeyboardEvent): void => {
    if (!interactive || event.key !== 'Escape' || !selection || selection.kind === 'vehicle') return;
    event.preventDefault();
    event.stopPropagation();
    select(null);
    options.onSelect?.(null);
  };
  vehicleCanvas.addEventListener('keydown', onSelectionKey);
  const trams = (): boolean => !modes || modes.has(0);
  const active = (): boolean => !destroyed && !paused && !down && status === 'ready';
  const viewport = (): PanZoomViewport => {
    const v = pan!.snapshot();
    return { ...v, x: v.x - origin.x * v.scale, y: v.y - origin.y * v.scale };
  };
  const centreOn = (p: XY, scale?: number): void => pan?.centreOn({ x: p.x - origin.x, y: p.y - origin.y }, scale);
  const toScreen = (p: XY): XY => pan!.toScreen({ x: p.x - origin.x, y: p.y - origin.y });
  const paddingWithMargin = (): FitPadding => ({
    top: (padding.top ?? 0) + FIT_MARGIN, right: (padding.right ?? 0) + FIT_MARGIN,
    bottom: (padding.bottom ?? 0) + FIT_MARGIN, left: (padding.left ?? 0) + FIT_MARGIN,
  });
  const stopForId = (id: string | null | undefined): SchemaStop | null => {
    if (!id || !net || !schema) return null;
    const name = stopNames.get(id) ?? (stop?.id === id ? stop.name : id);
    return namedStops.get(name) ?? null;
  };
  const screenStop = (): SchemaStop | null => stopForId(stop?.id);
  const labels = (): boolean => publicDisplay ? screenStop() !== null : (pan?.snapshot().scale ?? 0) >= LABEL_MIN_PX_PER_UNIT;
  const tones = (): SchemaTones => ({
    ink: tone(container, '--tone-text-primary', 'CanvasText'),
    halo: tone(container, '--tone-surface-canvas', 'Canvas'),
    water: tone(container, '--tone-tint-transit', 'Canvas'),
  });
  function setStatus(next: MapStatus): void {
    if (destroyed || status === next) return;
    status = next; container.dataset.mapStatus = next;
    refreshWords();
    options.onStatus?.(next);
  }
  function refreshWords(): void {
    const title = i18n.t('transport.mapModeSchema');
    const text = status === 'loading' ? i18n.t('status.loading') : status === 'unavailable'
      ? i18n.t('transport.mapUnavailable') : i18n.t('transport.schemaTramsOnly');
    legend.textContent = text;
    vehicleCanvas.setAttribute('aria-label', `${title}. ${text}`);
    note.textContent = i18n.t('motion.note');
    const hint = element.querySelector('.scene-canvas-hint');
    if (hint) hint.textContent = canvasHint();
  }
  function canvasHint(): string {
    return `${i18n.t('motion.canvasHint')} ${i18n.t('transport.schemaKeys')}`;
  }
  function layout(): SchemaLayout | null {
    if (!schema || !pan) return null;
    return { schema, viewport: viewport(), density, w: routesCanvas.width, h: routesCanvas.height, labels: labels(),
      trams: trams(), selectedRoute: selection?.kind === 'route' ? selection.id : null,
      selectedStop: selection?.kind === 'stop' ? stopForId(selection.id)?.name : null,
      screenStop: screenStop()?.name, labelMinPx: publicDisplay ? KIOSK_LABEL_MIN_PX : undefined };
  }
  function marks(drawn: readonly Drawn[]): VehicleMark[] {
    return placer && pan && trams() ? schemaMarks(placer, drawn, { ...viewport(), density, symbolScale: options.symbolScale }) : [];
  }
  function placeVehicle(v: Drawn): SchemaPlacement | null {
    if (v.type !== 0 || v.onShape === null) return null;
    const p = placer?.place(v.path, v.s);
    return p && (v.routeId === undefined || p.line === v.routeId) ? p : null;
  }
  function paintStatic(): void {
    const l = layout();
    if (staticContext && l) {
      element.dataset.labels = String(l.labels);
      element.dataset.scale = String(l.viewport.scale);
      paintSchema(staticContext, l, tones());
    }
  }
  function viewportChanged(): void {
    if (destroyed) return;
    paintStatic();
    for (const listener of sceneListeners) listener();
    if (active()) loop.nudge();
    else paintMarks();
  }
  const scene: Scene = {
    resize: () => resize(),
    marks,
    inFrame(v) {
      const p = placeVehicle(v);
      return Boolean(p && pan && trams() && schemaInFrame(p, viewport()));
    },
    paintStatic(ctx) { const l = layout(); if (l) paintSchema(ctx, l, tones()); },
    onChange(listener) { sceneListeners.add(listener); return () => { sceneListeners.delete(listener); }; },
    listCap: interactive ? 20 : 10,
  };
  function paintMarks(): boolean {
    if (!pan) return false;
    lastMarks = marks(lastDrawn);
    a11y?.frame(lastDrawn, lastMarks);
    const membership = lastMarks.map(m => m.id).sort().join('\0');
    if (membership !== listMembership) { listMembership = membership; a11y?.reconcile(lastDrawn); }
    if (vehicleContext) paintVehicles(vehicleContext, { w: vehicleCanvas.width, h: vehicleCanvas.height, density }, lastMarks, tones(), selection?.kind === 'vehicle' ? selection.id : null);
    const next = lastMarks.map(m => `${m.id}:${m.x.toFixed(2)},${m.y.toFixed(2)},${m.angle.toFixed(3)},${m.alpha.toFixed(2)}`).join('|');
    const changed = signature !== next;
    signature = next;
    return changed;
  }
  function followNow(): void {
    if (!interactive || !following || !placer || !pan) return;
    const ids = typeof following === 'string' ? new Set([following]) : null;
    const targets = lastDrawn.filter(v => v.type === 0 && v.onShape !== null
      && (ids ? ids.has(v.id) : selection?.kind === 'route' && v.routeId === selection.id))
      .map(placeVehicle).filter((p): p is SchemaPlacement => p !== null);
    if (!targets.length) return;
    centreOn({ x: targets.reduce((sum, p) => sum + p.x, 0) / targets.length, y: targets.reduce((sum, p) => sum + p.y, 0) / targets.length });
  }
  const loop = createLoop((time) => {
    if (!active() || !model || !element.isConnected) return false;
    lastDrawn = model.step(time);
    followNow();
    const changed = paintMarks();
    frames++;
    vehicleCanvas.dataset.frames = container.dataset.frames = String(frames);
    if (pan) deps.onFrame?.({ drawn: lastDrawn, marks: lastMarks, viewport: viewport(), labels: labels() });
    return changed;
  }, { now, raf: deps.raf, cancel: deps.cancel, setTimer: options.setTimer, clearTimer: options.clearTimer, reducedMotion: options.reducedMotion });

  function kioskFit(): void {
    if (!pan || !publicDisplay) return;
    const at = screenStop();
    if (at) centreOn(at, KIOSK_LABEL_SCALE);
    else pan.fit();
  }
  function fit(target: 'city' | 'selection' | 'stop'): void {
    if (!pan) { pendingFit = target; return; }
    if (!interactive) { kioskFit(); return; }
    const selected = target === 'stop' ? screenStop()
      : selection?.kind === 'stop' ? stopForId(selection.id)
      : selection?.kind === 'vehicle' ? (() => { const v = lastDrawn.find(v => v.id === selection!.id); return v ? placeVehicle(v) : null; })()
      : null;
    if (target !== 'city' && selected) centreOn(selected, Math.max(pan.snapshot().scale, LABEL_MIN_PX_PER_UNIT));
    else if (target === 'selection' && selection?.kind === 'route') {
      const line = schema?.lines.find(l => l.route === selection!.id);
      if (line) {
        const xs = line.pts.map(p => p.x), ys = line.pts.map(p => p.y);
        pan.fit();
        centreOn({ x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 }, LABEL_MIN_PX_PER_UNIT);
      }
    } else pan.fit();
  }
  function select(next: MapSelection | null, move = false): void {
    selection = next;
    a11y?.select(next?.kind === 'vehicle' ? next.id : null);
    if (move) fit('selection');
    paintStatic();
    paintMarks();
    if (active()) loop.nudge();
  }
  function tapEmpty(p: XY): void {
    if (!pan || !schema) return;
    const cssPoint = { x: p.x / density, y: p.y / density };
    const candidates = schema.lines.flatMap(line => line.stops.map(entry => ({ name: entry.name, at: pointAt(line, entry.u) })));
    const target = candidates.map(s => ({ stop: s, p: toScreen(s.at) }))
      .map(s => ({ ...s, d: Math.hypot(s.p.x - cssPoint.x, s.p.y - cssPoint.y) })).filter(s => s.d <= STOP_HIT_PX).sort((a, b) => a.d - b.d)[0];
    const gtfs = target && net?.stops.find(s => s.name === target.stop.name);
    const next: MapSelection | null = gtfs ? { kind: 'stop', id: gtfs.id, ids: net!.stops.filter(s => s.name === gtfs.name).map(s => s.id) } : null;
    select(next); options.onSelect?.(next);
  }
  function resize(): void {
    if (destroyed) return;
    const rect = container.getBoundingClientRect();
    const canvasRect = vehicleCanvas.getBoundingClientRect();
    const w = canvasRect.width || rect.width || container.clientWidth || 1;
    const h = canvasRect.height || rect.height || container.clientHeight || 1;
    for (const c of [routesCanvas, vehicleCanvas]) { c.width = Math.round(w * density); c.height = Math.round(h * density); }
    try { staticContext = routesCanvas.getContext('2d'); vehicleContext = vehicleCanvas.getContext('2d'); } catch { staticContext = vehicleContext = null; }
    pan?.resize(w, h);
    kioskFit();
    paintStatic();
    paintMarks();
  }
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
  observer?.observe(container);
  const themeObserver = typeof MutationObserver === 'function' ? new MutationObserver(() => { paintStatic(); paintMarks(); }) : null;
  themeObserver?.observe(doc.documentElement, { attributes: true, attributeFilter: ['data-theme-resolved'] });
  doc.defaultView?.addEventListener('resize', resize);
  void doc.fonts?.ready.then(() => { if (!destroyed) paintStatic(); });
  refreshWords();

  // No callbacks after teardown, including when a network fetch or chunk import
  // loses a race with a rapid Karta/Shema swap.
  void Promise.all([
    (deps.loadSchema ?? loadArtwork)(abort.signal),
    (options.loadNetwork ?? (() => loadNetwork(fetch, false)))(),
  ]).then(([raw, loaded]) => {
    if (destroyed) return;
    if (!loaded || !('paths' in loaded)) throw new Error('Schema requires the graph network');
    const decoded = decodeSchema(raw);
    if (decoded.feedVersion !== loaded.feedVersion) { cachedArtwork = undefined; throw new Error('Schema/network feed versions differ'); }
    schema = decoded; net = loaded as GraphNetwork; model = createIntegrator(net); placer = createSchemaPlacer(schema, net);
    for (const s of net.stops) stopNames.set(s.id, s.name);
    for (const s of schema.stops) namedStops.set(s.name, s);
    model.update(pointsToFixes(points), now());
    lastDrawn = model.step(now());
    // Fit retained artwork, not the empty space left by the removed header,
    // legend and footer. Page coordinates remain unchanged in the artifact.
    const retained = [...schema.lines.flatMap(l => l.pts), ...schema.water.flatMap(w => w.pts),
      ...schema.stops.flatMap(s => s.label ? [s, s.label] : [s])];
    const xs = retained.map(p => p.x), ys = retained.map(p => p.y);
    origin = { x: Math.min(...xs), y: Math.min(...ys) };
    const box: [number, number] = [Math.max(1, Math.max(...xs) - origin.x), Math.max(1, Math.max(...ys) - origin.y)];
    pan = createPanZoom(vehicleCanvas, {
      box, interactive, reducedMotion: options.reducedMotion, padding: paddingWithMargin(), document: doc, now,
      onChange: viewportChanged,
      onUserMove() { following = null; options.onUserMove?.(null); },
      onTap: p => a11y?.tap({ x: p.x * density, y: p.y * density }),
    });
    a11y = mountSceneAccessibility({
      element, scene, i18n, net, drawn: () => lastDrawn, delays: () => new Map(), density: () => density,
      nudge: () => { if (active()) loop.nudge(); }, interactive, bindPointer: false,
      onSelect(id) { const next: MapSelection | null = id ? { kind: 'vehicle', id } : null; select(next); options.onSelect?.(next); },
      onEmptyTap: tapEmpty,
    });
    a11y.locale({ canvas: canvasHint() });
    resize();
    if (pendingFit) { const target = pendingFit; pendingFit = null; fit(target); }
    followNow();
    a11y.reconcile(lastDrawn);
    a11y.select(selection?.kind === 'vehicle' ? selection.id : null);
    options.onNetwork?.(net);
    setStatus('ready');
    if (active()) loop.start();
  }).catch(() => {
    if (destroyed) return;
    options.onNetwork?.(null);
    setStatus('unavailable');
  });

  return {
    update(next) {
      if (destroyed) return;
      points = next;
      if (!down) model?.update(pointsToFixes(points), now());
      // The workspace reads vehicles() in this same poll render. Expose
      // newly folded evidence now, not one poll after the next frame paints.
      if (model && !paused && !down) lastDrawn = model.step(now());
      a11y?.reconcile(lastDrawn);
      if (active()) loop.nudge();
    },
    pause() { if (destroyed) return; paused = true; loop.stop(); },
    resume() { if (destroyed) return; paused = false; if (active()) loop.start(); },
    destroy() {
      if (destroyed) return;
      destroyed = true; abort.abort(); loop.stop(); pan?.destroy(); a11y?.destroy(); observer?.disconnect(); themeObserver?.disconnect();
      vehicleCanvas.removeEventListener('keydown', onSelectionKey);
      doc.defaultView?.removeEventListener('resize', resize); sceneListeners.clear(); element.remove();
    },
    setTheme() { if (destroyed) return; paintStatic(); paintMarks(); },
    setLocale(locale) { if (destroyed) return; i18n.setLocale(locale); refreshWords(); a11y?.locale({ canvas: canvasHint() }); },
    select: (next, opts) => { if (!destroyed) select(next, opts?.fit === true); },
    selection: () => selection,
    follow(target) { if (destroyed) return; following = target; followNow(); if (active()) loop.nudge(); },
    following: () => following,
    resize,
    setModes(next) { if (destroyed) return; modes = next; paintStatic(); paintMarks(); a11y?.reconcile(lastDrawn); refreshWords(); if (active()) loop.nudge(); },
    setFeedState(state) {
      if (destroyed) return;
      const wasDown = down; down = state === 'down';
      if (down) loop.stop();
      else if (wasDown) { model?.update(pointsToFixes(points), now()); if (active()) loop.start(); }
      else if (active()) loop.nudge();
    },
    setStop(next) {
      if (destroyed || JSON.stringify(stop) === JSON.stringify(next)) return;
      stop = next; kioskFit(); paintStatic(); paintMarks();
    },
    fit,
    setFitPadding(next) {
      if (destroyed) return;
      padding = next;
      element.style.setProperty('--schema-bottom-pad', `${Math.max(0, padding.bottom ?? 0)}px`);
      pan?.setPadding(paddingWithMargin()); kioskFit();
    },
    camera: () => null,
    status: () => status,
    network: (): Network | null => net,
    vehicles: () => lastDrawn.map(v => {
      const [lon, lat] = toLonLat(v.p);
      return { id: v.id, routeId: v.routeId, short: vehicleLabel(v), kind: vehicleKind(v.type), type: v.type,
        lon, lat, bearing: v.heading ? bearingOf(v.heading) : null, confidence: v.confidence, held: v.held === true,
        onShape: v.onShape, ...(v.headsign === undefined ? {} : { headsign: v.headsign }), ...(v.nextStopId === undefined ? {} : { nextStopId: v.nextStopId }) };
    }),
    setView() {}, setOutline() {}, setEmphasis() {}, setClosuresVisible() {},
  };
}
