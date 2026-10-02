// The map of /snimka/ (snimka v3, decisions V3-8 to V3-13): the city map
// (app/src/map/city-map.ts) with the replay model in place of the
// integrator, fed by the chunk store and the one replay clock. The map keeps
// its own loop on real time and parks when nothing moves; a clock mutation,
// a landed chunk or a layer switch wakes it through handle.update(), the
// map's own "news" entry. Four things of the stage ride the map here:
//
// - the ghost swarm: the weekday-matched normal day's fleet (context.ts
//   comparisonFor) as filled muted discs under the real vehicles, pushed
//   through setGhosts at GHOST_HZ (GHOST_HZ_PHONE on a coarse pointer); none
//   on a Sunday, none at one hour per second, and a comparison chunk the
//   index lacks (the 24 Sep 00:00-02:00 gap) says so (legendCounts().compare
//   = 'gap') instead of drawing nothing as "nothing";
// - the BAJS stations (bajs-layer.ts): a stage layer on its own source whose
//   fill glides between the five-minute samples by feature state at BAJS_HZ;
//   at one hour per second the map shows them alone;
// - the glyph mode (positions.ts glyphModeFor): dots at ten minutes a second
//   over twelve vehicles, pills otherwise, through the map's setGlyphMode;
// - the camera (camera.ts): the passive frame is the whole tram network,
//   computed once per box size, never moved by the fleet; a vehicle outside
//   it gets the edge marker; the follow toggle is a MapLibre control in the
//   map's own stack ("Karta prati događaje", aria-pressed, ctx.layers.follow).
//
// The subject (a line, a station, a stop) comes in from the map's own tap
// and goes out to it from the view store; a tap on a station while paused
// at BAJS_TIP_ZOOM and up shows its numbers as a tooltip. The director
// binds itself here until the shell binds it with its hooks (director.ts).
// Loaded by stage.ts with one dynamic import, so the page's entry graph
// never carries the map library; the sheet ui/snimka-map.css rides this
// chunk. Probes on the host: data-sn-drawn, data-sn-ghosts, data-sn-compare,
// data-sn-bajs="<drawn>/<anomalies>", data-sn-glyphs, data-sn-frame,
// data-sn-edge, data-sn-motion, data-sn-at, data-sn-subject.
import '../ui/snimka-map.css';
import { decodeNetwork, type GraphNetwork, type Network } from '../../../shared/motion/network';
import {
  BAJS_STEP_S, isBajsFile, isMotionIndex, isStationsFile, ZAGREB_OFFSET_S,
  type BajsFile, type Focus, type MotionIndex, type StationsFile,
} from '../../../shared/snimka';
import { BAJS_MISSING, decodeBajs, decodeMotionChunk, SnimkaError } from '../../../shared/snimka-codec';
import { createCityMap, FOCUS_ZOOM, ZAGREB_CENTER, type CityMapHandle, type MapControl, type MapSelection } from '../map/city-map';
import type { Model } from '../motion/integrator';
import { PILL_ZOOM, type GlyphMode } from '../map/overlays';
import {
  BAJS_HZ, BAJS_HZ_PHONE, BAJS_SOURCE, BAJS_TIP_ZOOM, bajsFeatureId, bajsStageLayer, bajsStatesAt, bikesTip, changedStates, hiddenStates, referenceIndex,
  samplePosition, type StationState,
} from './bajs-layer';
import { edgeMarkerFor, networkBounds, networkFrame } from './camera';
import { createChunkStore, type ChunkState, type ChunkStore } from './chunks';
import { comparisonFor, type SnimkaContext } from './context';
import type { LegendCounts, MountMapLayer, StageMap, Subject, ViewReason } from './contracts';
import { bindDirector, DIRECTOR_RESUME_EVENT, DIRECTOR_STATE_EVENT } from './director';
import { formatZagrebLocal, plural } from './format';
import { compareInstantFor, createReplayModel, ghostsAt, glyphModeFor, NO_VEHICLES_SPEED } from './positions';
import { fill, SN } from './strings';
import { sameSubject, selectionOfSubject, subjectFromSelection } from './subject';

/** The opening view before the network frame is known: the inner city, just inside the pill zoom. */
export const STAGE_ZOOM = PILL_ZOOM + 0.1;
/** Ghost pushes per second at most on a desk and on a phone (the map pushes its own vehicles at the same rate). */
export const GHOST_HZ = 12;
export const GHOST_HZ_PHONE = 4;
/** The edge marker is re-read this often. */
export const EDGE_HZ = 4;
/** The camera on a BAJS station or a stop the director or the subject asks for. */
export const STATION_ZOOM = FOCUS_ZOOM;
/** Autoplay waits until this much of the map box is in the viewport (V3-18, phones). */
export const IN_VIEW_RATIO = 0.5;
/** A BAJS push that found no style yet asks again after this long (the map's status usually asks first). */
export const BAJS_RETRY_MS = 250;

export interface MapLayerHooks {
  /** The current chunk's state, whenever it changes: 'idle' while nothing is asked for (one hour per second, playing). */
  onMotion(state: ChunkState): void;
}

/** The five-minute sample index for an instant, clamped to the file (the bytes say 255 where nothing was recorded). */
export function bajsSampleAt(file: Pick<BajsFile, 't0' | 'n'>, atSec: number): number {
  if (file.n <= 0) return -1;
  return Math.max(0, Math.min(file.n - 1, Math.floor((atSec - file.t0) / BAJS_STEP_S)));
}

/** The camera a focus asks for when it is a place: the event's own resolved point, else the places file's. */
export function placeCamera(ctx: Pick<SnimkaContext, 'places'>, focus: Extract<Focus, { kind: 'place' }>): { center: [number, number]; zoom: number } | null {
  const place = ctx.places.places.find((p) => p.id === focus.id);
  const center = focus.lonLat ?? place?.lonLat ?? null;
  if (!center) return null;
  return { center: [center[0], center[1]], zoom: focus.zoom ?? place?.zoom ?? 14 };
}

/** Whether a box is at least `ratio` of its height inside a viewport of `viewportHeight` (the synchronous answer before the observer's). */
export function inViewNow(rect: { top: number; bottom: number; height: number }, viewportHeight: number, ratio = IN_VIEW_RATIO): boolean {
  if (rect.height <= 0) return false;
  const visible = Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0);
  return visible / rect.height >= ratio;
}

/** Resolves once the host is at least IN_VIEW_RATIO in the viewport (an IntersectionObserver; at once where there is
 *  none). The stage awaits it before an autoplay (ledger line: mapInView(host): Promise<void>). */
export function mapInView(host: HTMLElement, ratio = IN_VIEW_RATIO): Promise<void> {
  return new Promise((resolve) => {
    const win = host.ownerDocument.defaultView;
    const IO = win?.IntersectionObserver;
    if (typeof IO !== 'function') { resolve(); return; }
    const io = new IO((entries) => {
      if (!entries.some((e) => e.isIntersecting && e.intersectionRatio >= ratio)) return;
      io.disconnect();
      resolve();
    }, { threshold: [ratio] });
    io.observe(host);
  });
}

/** The Zagreb weekday (0 = Sunday) of an instant. */
const zagrebWeekday = (atSec: number): number => new Date((atSec + ZAGREB_OFFSET_S) * 1000).getUTCDay();

const decodeIndex = (raw: unknown): MotionIndex => { if (!isMotionIndex(raw)) throw new SnimkaError('motion index: not a motion index'); return raw; };
const decodeStations = (raw: unknown): StationsFile => { if (!isStationsFile(raw)) throw new SnimkaError('stations: not a stations file'); return raw; };
const decodeBajsFile = (raw: unknown): { file: BajsFile; rows: Uint8Array[] } => { if (!isBajsFile(raw)) throw new SnimkaError('bajs: not a bajs file'); return { file: raw, rows: decodeBajs(raw) }; };

const FOLLOW_ICON = '<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><circle cx="10" cy="10" r="6.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M10 1v3M10 16v3M1 10h3M16 10h3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="10" cy="10" r="2" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>';

/** The follow toggle in the map's control stack (V3-11): one icon button, named, aria-pressed, 44 px on a coarse pointer (snimka-map.css). */
export class FollowControl implements MapControl {
  private root: HTMLElement | null = null;
  private button: HTMLButtonElement | null = null;
  constructor(private readonly doc: Document, private readonly onToggle: () => void, private pressed = true) {}
  onAdd(): HTMLElement {
    const group = this.doc.createElement('div');
    group.className = 'maplibregl-ctrl maplibregl-ctrl-group sn-cam-ctrl';
    const button = this.doc.createElement('button');
    button.type = 'button';
    button.className = 'sn-cam-toggle';
    button.dataset.sn = 'follow';
    button.setAttribute('aria-label', SN.director.toggle);
    button.title = SN.director.toggle;
    button.setAttribute('aria-pressed', this.pressed ? 'true' : 'false');
    button.innerHTML = FOLLOW_ICON;
    button.addEventListener('click', this.onToggle);
    group.append(button);
    this.root = group;
    this.button = button;
    return group;
  }
  onRemove(): void {
    this.button?.removeEventListener('click', this.onToggle);
    this.root?.remove();
    this.root = null;
    this.button = null;
  }
  setPressed(on: boolean): void {
    this.pressed = on;
    this.button?.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
}

/** The contract mount (contracts.ts MountMapLayer). Everything async inside degrades to "no vehicles", never to a throw. */
export const mountMapLayer: MountMapLayer = async (ctx, host) => {
  const { clock, frames, layers, data, manifest, view, doc } = ctx;
  const container = host;
  const win = doc.defaultView;
  const coarse = win?.matchMedia?.('(pointer: coarse)').matches === true;
  const ghostIntervalMs = 1000 / (coarse ? GHOST_HZ_PHONE : GHOST_HZ);
  const bajsIntervalMs = 1000 / (coarse ? BAJS_HZ_PHONE : BAJS_HZ);
  const edgeIntervalMs = 1000 / EDGE_HZ;
  const hooks: MapLayerHooks = { onMotion: (state) => { host.dataset.snMotion = state; } };
  const moveListeners = new Set<() => void>();
  let disposed = false;
  let store: ChunkStore | null = null;
  let net395: GraphNetwork | null = null;
  /** The drawn network (396) once the map has it: the passive frame is computed from its tram shapes. */
  let net396: GraphNetwork | null = null;
  let stations: StationsFile | null = null;
  let bajs: { file: BajsFile; rows: Uint8Array[] } | null = null;
  let nudgeDue = true;
  let lastMotion: ChunkState | null = null;
  /** The motion index could not be read: no chunk is ever asked for, the badge keeps the series' word, no vehicle is drawn. */
  let indexFailed = false;
  let lastAt = '';
  /** How many vehicles the last model step placed (the glyph mode and the legend read it). */
  let drawnCount = 0;
  /** The ghosts: the last push's wall time, whether any are on the map, the last count, and why none is drawn. */
  let lastGhostAt = -Infinity;
  let ghostsShown = false;
  let ghostCount: number | null = null;
  let compareState: LegendCounts['compare'] = 'loading';
  /** The BAJS layer: on the map once the stations are known; the states last applied per station; the last push's wall time. */
  let bajsOnMap = false;
  let bajsApplied = new Map<string, StationState>();
  let lastBajsAt = -Infinity;
  let lastBajsSample = -2;
  let bajsRetry: ReturnType<typeof setTimeout> | null = null;
  let bajsDrawn = 0;
  let bajsAnomalies = 0;
  let bajsMissing = true;
  let selectedStation: string | null = null;
  /** The glyph mode as last set on the map. */
  let glyphShown: GlyphMode | null = null;
  /** The passive frame: the box size it was computed for and the camera; a reader who moved the map keeps their own. */
  let frameKey = '';
  let frame: { center: [number, number]; zoom: number } | null = null;
  let userMoved = false;
  /** An address or a cue framed the view before the network arrived: the frame is computed but not applied. */
  let viewTaken = view.get().subject !== null;
  let lastEdgeAt = -Infinity;
  /** The subject the view holds, as the map last applied it. */
  let appliedSubject: Subject | null = null;
  let directorHeld = false;
  /** Autoplay held until the map box is in view (V3-18); cleared by any play or seek from elsewhere. */
  let gated = false;

  const network396 = data.get(manifest.networks['396'], decodeNetwork);
  const network395 = data.get(manifest.networks['395'], decodeNetwork);
  network395.then((n) => { net395 = n; }, () => { net395 = null; });

  // ---- the map's own chrome: the edge marker and the station tooltip --------------------------------------
  const edge = doc.createElement('div');
  edge.className = 'sn-cam-edge';
  edge.dataset.sn = 'edge';
  edge.hidden = true;
  const tip = doc.createElement('div');
  tip.className = 'sn-bajs-tip';
  tip.dataset.sn = 'bajs-tip';
  tip.setAttribute('role', 'status');
  tip.hidden = true;

  const handle: CityMapHandle = createCityMap(
    {
      container,
      ariaLabel: SN.stage.mapLabel,
      points: [],
      lines: [],
      reducedMotion: ctx.reducedMotion,
      loadNetwork: () => network396.catch(() => null) as Promise<Network | null>,
      theme: ctx.theme.resolved(),
      cooperative: true,
      attributionCompact: true,
      closures: false,
      cityLabels: 'venues',
      center: ZAGREB_CENTER,
      zoom: STAGE_ZOOM,
      pickRoutes: true,
      lineFocus: false,
      // The style is up by the time the basemap reports: a BAJS push that found no style yet is retried from here.
      onStatus: () => { nudgeDue = true; frames.kick(); },
      onUserMove: () => { userMoved = true; hideTip(); for (const fn of [...moveListeners]) fn(); },
      onNetwork: (net) => {
        net396 = net && 'paths' in net ? (net as GraphNetwork) : null;
        frameKey = '';
        applyFrame();
        // A selection that arrived before the artefact (the address's &linija=, a director's cue) is fitted now that its geometry is here.
        const standing = handle.selection?.() ?? (appliedSubject ? selectionOfSubject(appliedSubject) : null);
        if (standing) handle.select?.(standing, { fit: true });
        frames.kick();
      },
      onSelect: (sel) => {
        let next = subjectFromSelection(sel);
        if (!next && sel?.kind === 'vehicle') {
          // A tap on a tram is a tap on its line.
          const routeId = handle.vehicles?.().find((v) => v.id === sel.id)?.routeId ?? null;
          if (routeId) {
            next = { kind: 'route', id: routeId };
            handle.select?.({ kind: 'route', id: routeId });
          }
        }
        view.set({ subject: next }, 'map');
        if (next?.kind === 'station') showTip(next.id);
        else hideTip();
      },
    },
    {
      createModel: (net) => {
        const graph = net && 'paths' in net ? (net as GraphNetwork) : null;
        const m = createReplayModel({
          now: () => clock.now(),
          speed: () => clock.speed(),
          vehiclesOn: () => layers.get().vehicles,
          chunksAt: (ms) => store?.at('396', ms / 1000) ?? null,
          net: graph,
        });
        // data-sn-drawn: how many vehicles the last step placed, written where the map steps the model (a browser proof).
        const probed: Model = {
          ...m,
          step(now) {
            const drawn = m.step(now);
            const count = String(drawn.length);
            if (container.dataset.snDrawn !== count) container.dataset.snDrawn = count;
            if (drawn.length !== drawnCount) { drawnCount = drawn.length; frames.kick(); }
            return drawn;
          },
        };
        return probed;
      },
    },
  );
  container.append(edge, tip);

  // ---- the follow toggle in the control stack (V3-11, V3-13) ----------------------------------------------------
  const control = new FollowControl(doc, () => {
    // A held director (the reader moved the map) resumes at once; otherwise the button switches the following.
    if (layers.get().follow && directorHeld) doc.dispatchEvent(new CustomEvent(DIRECTOR_RESUME_EVENT));
    else {
      const next = !layers.get().follow;
      layers.set({ follow: next });
      view.set({ following: next }, 'user');
    }
  }, layers.get().follow);
  const removeControl = handle.addControl?.(control, 'top-right') ?? ((): void => {});
  const renderControl = (): void => { control.setPressed(layers.get().follow && !directorHeld); };
  const onDirectorState = (event: Event): void => {
    directorHeld = Boolean((event as CustomEvent<{ held?: boolean }>).detail?.held);
    renderControl();
  };
  doc.addEventListener(DIRECTOR_STATE_EVENT, onDirectorState);

  // ---- the data ------------------------------------------------------------------------------------------------
  void data.get(manifest.files.motionIndex, decodeIndex).then((index) => {
    if (disposed) return;
    store = createChunkStore({ index, load: (ref) => data.get(ref.path, decodeMotionChunk), onChange: () => { nudgeDue = true; frames.kick(); } });
    frames.kick();
  }, () => { indexFailed = true; frames.kick(); });
  void Promise.all([data.get(manifest.files.stations, decodeStations), data.get(manifest.files.bajs, decodeBajsFile)]).then(([s, b]) => {
    if (disposed) return;
    stations = s;
    bajs = b;
    handle.addStageLayer?.(bajsStageLayer(s));
    bajsOnMap = true;
    lastBajsSample = -2;
    frames.kick();
  }, () => { /* no stations: the map keeps the network and the vehicles */ });

  // ---- the passive frame (V3-13) ------------------------------------------------------------------------------
  /** The whole tram network for the box's size, computed once per size; applied unless the reader moved the map or something else framed it. */
  function applyFrame(): void {
    if (disposed || !net396) return;
    const width = container.clientWidth;
    const height = container.clientHeight;
    if (width < 1 || height < 1) return;
    const key = `${width}x${height}`;
    if (key === frameKey) return;
    frameKey = key;
    const bounds = networkBounds(net396);
    if (!bounds) return;
    frame = networkFrame(bounds, width, height, STAGE_ZOOM);
    container.dataset.snFrame = frame.zoom.toFixed(2);
    if (userMoved || viewTaken) return;
    handle.setView?.({ center: frame.center, zoom: frame.zoom });
  }
  const cityView = (): { center: [number, number]; zoom: number } => frame ?? { center: [ZAGREB_CENTER[0], ZAGREB_CENTER[1]], zoom: STAGE_ZOOM };
  const observer = typeof win?.ResizeObserver === 'function' ? new win.ResizeObserver(() => { applyFrame(); }) : null;
  observer?.observe(container);

  // ---- the edge marker (V3-13) -----------------------------------------------------------------------------------
  function renderEdge(): void {
    const vehicles = handle.vehicles?.() ?? [];
    const width = container.clientWidth;
    const height = container.clientHeight;
    const points: { x: number; y: number }[] = [];
    if (handle.project && width > 0 && height > 0) {
      for (const v of vehicles) { const at = handle.project([v.lon, v.lat]); if (at) points.push(at); }
    }
    const marker = edgeMarkerFor(points, width, height);
    if (!marker) {
      if (!edge.hidden) { edge.hidden = true; delete container.dataset.snEdge; }
      return;
    }
    const text = fill(plural(marker.count, SN.camera.offFrame), { n: marker.count });
    if (edge.textContent !== text) edge.textContent = text;
    edge.style.left = `${marker.x.toFixed(0)}px`;
    edge.style.top = `${marker.y.toFixed(0)}px`;
    edge.hidden = false;
    const probe = String(marker.count);
    if (container.dataset.snEdge !== probe) container.dataset.snEdge = probe;
  }

  // ---- the station tooltip (V3-9: numbers only paused and from BAJS_TIP_ZOOM) ------------------------------------
  function showTip(stationId: string): void {
    hideTip();
    if (!bajs || !stations || clock.playing()) return;
    const camera = handle.camera?.();
    if (!camera || camera.zoom < BAJS_TIP_ZOOM) return;
    const station = stations.stations.find((s) => s.id === stationId);
    const rowIndex = bajs.file.stations.indexOf(stationId);
    const row = rowIndex >= 0 ? bajs.rows[rowIndex] : undefined;
    if (!station || !row) return;
    const atSec = clock.now() / 1000;
    const at = samplePosition(bajs.file, atSec);
    const ref = referenceIndex(bajs.file, atSec);
    const text = at ? bikesTip(row[at.i] ?? BAJS_MISSING, station.capacity, ref >= 0 ? row[ref] ?? BAJS_MISSING : BAJS_MISSING) : null;
    const px = text ? handle.project?.([station.lon, station.lat]) : null;
    if (!text || !px) return;
    tip.textContent = text;
    tip.style.left = `${px.x.toFixed(0)}px`;
    tip.style.top = `${px.y.toFixed(0)}px`;
    tip.hidden = false;
  }
  function hideTip(): void {
    if (!tip.hidden) { tip.hidden = true; tip.textContent = ''; }
  }

  // ---- the BAJS push (V3-9) -----------------------------------------------------------------------------------------
  function pushBajs(atSec: number, real: number): void {
    if (!bajsOnMap || !bajs || !stations || !handle.setFeatureState) return;
    const on = layers.get().bikes;
    const sample = on ? bajsSampleAt(bajs.file, atSec) : -1;
    // Reduced motion steps once per sample; otherwise the glide is re-read at the cadence.
    if (ctx.reducedMotion || !on) { if (sample === lastBajsSample && bajsApplied.size > 0) return; }
    else if (real - lastBajsAt < bajsIntervalMs - 1) return;
    lastBajsAt = real;
    lastBajsSample = sample;
    let next: Map<string, StationState>;
    if (on) {
      const result = bajsStatesAt(stations, bajs.file, bajs.rows, atSec, { reduced: ctx.reducedMotion });
      next = result.states;
      bajsDrawn = result.drawn;
      bajsAnomalies = result.anomalies;
      bajsMissing = result.missing;
    } else {
      next = hiddenStates(stations);
      bajsDrawn = 0;
      bajsAnomalies = 0;
    }
    let applied = 0;
    for (const [id, state] of changedStates(bajsApplied, next)) {
      if (!handle.setFeatureState(BAJS_SOURCE, bajsFeatureId(id), { f: state.f, e: state.e, a: state.a, m: state.m, s: state.s })) {
        // The style is not up: nothing was set. Asked again on the map's status and, failing that, in a moment.
        lastBajsSample = -2;
        if (!bajsRetry) bajsRetry = globalThis.setTimeout(() => { bajsRetry = null; nudgeDue = true; frames.kick(); }, BAJS_RETRY_MS);
        return;
      }
      applied += 1;
    }
    bajsApplied = next;
    container.dataset.snBajsCalls = String(applied);
    const probe = `${bajsDrawn}/${bajsAnomalies}`;
    if (container.dataset.snBajs !== probe) container.dataset.snBajs = probe;
  }
  function selectStation(id: string | null): void {
    if (id === selectedStation) return;
    if (selectedStation !== null) handle.setFeatureState?.(BAJS_SOURCE, bajsFeatureId(selectedStation), { sel: false });
    selectedStation = id;
    if (id !== null) handle.setFeatureState?.(BAJS_SOURCE, bajsFeatureId(id), { sel: true });
  }

  // ---- the frame ---------------------------------------------------------------------------------------------------
  const offFrames = frames.subscribe((t) => {
    if (disposed) return;
    const atSec = t / 1000;
    const speed = clock.speed();
    const playing = clock.playing();
    const real = Date.now();
    const compareOn = layers.get().compare;
    const sunday = zagrebWeekday(atSec) === 0;
    const compareMs = compareInstantFor(comparisonFor(ctx, atSec), t);
    const wantGhosts = compareOn && !sunday && speed !== NO_VEHICLES_SPEED;
    store?.want('396', atSec, speed, playing);
    if (wantGhosts) store?.want('395', compareMs / 1000, speed, playing);

    const motion: ChunkState = indexFailed ? 'idle' : !store ? 'loading' : speed === NO_VEHICLES_SPEED && playing ? 'idle' : store.state('396', atSec);
    if (motion !== lastMotion) { lastMotion = motion; hooks.onMotion(motion); }

    const at = formatZagrebLocal(t);
    if (at !== lastAt) { lastAt = at; container.dataset.snAt = at; }

    if (nudgeDue) {
      nudgeDue = false;
      handle.update([], []);
    }

    // The ghost swarm, and why there is none.
    let compare: LegendCounts['compare'];
    if (!compareOn) compare = 'off';
    else if (sunday) compare = 'sunday';
    else if (speed === NO_VEHICLES_SPEED) compare = 'speed';
    else if (!store || !net395) compare = 'loading';
    else {
      const state = store.state('395', compareMs / 1000);
      compare = state === 'missing' ? 'gap' : state === 'ready' ? 'ok' : 'loading';
    }
    if (compare === 'ok' && store && net395 && handle.setGhosts) {
      if (real - lastGhostAt >= ghostIntervalMs - 1) {
        lastGhostAt = real;
        const pair = store.at('395', compareMs / 1000);
        const points = pair ? ghostsAt(pair.current, pair.next, t, net395, compareMs) : [];
        handle.setGhosts(points);
        ghostsShown = true;
        ghostCount = points.length;
        const count = String(ghostCount);
        if (container.dataset.snGhosts !== count) container.dataset.snGhosts = count;
      }
    } else {
      ghostCount = null;
      if (ghostsShown && handle.setGhosts) { handle.setGhosts([]); ghostsShown = false; }
      if (container.dataset.snGhosts !== '0') container.dataset.snGhosts = '0';
    }
    if (compare !== compareState) { compareState = compare; container.dataset.snCompare = compare; }

    pushBajs(atSec, real);

    const mode = glyphModeFor(speed, playing, drawnCount);
    if (mode !== glyphShown) {
      glyphShown = mode;
      handle.setGlyphMode?.(mode);
      container.dataset.snGlyphs = mode;
    }

    if (real - lastEdgeAt >= edgeIntervalMs - 1) { lastEdgeAt = real; renderEdge(); }
  });

  const offTick = clock.onTick((_, reason) => {
    nudgeDue = true;
    if (reason === 'play' || reason === 'seek') { gated = false; hideTip(); }
  });
  const offLayers = layers.onChange(() => {
    nudgeDue = true;
    renderControl();
    frames.kick();
  });
  const offTheme = ctx.theme.onChange((theme) => handle.setTheme?.(theme));

  // ---- autoplay only once the map box is in view (V3-18) --------------------------------------------------------
  if (clock.playing() && !ctx.reducedMotion && win && !inViewNow(container.getBoundingClientRect(), win.innerHeight)) {
    gated = true;
    clock.pause();
    void mapInView(container).then(() => {
      if (disposed || !gated) return;
      gated = false;
      clock.play();
    });
  }

  // ---- the subject: from the view store to the map ------------------------------------------------
  function applySubject(subject: Subject | null, reason: ViewReason | undefined): void {
    appliedSubject = subject;
    if (subject) container.dataset.snSubject = `${subject.kind}:${subject.id}`;
    else delete container.dataset.snSubject;
    selectStation(subject?.kind === 'station' ? subject.id : null);
    if (subject) viewTaken = true;
    // A tap on the map is already where it is; anything else is selected and framed.
    if (reason === 'map') return;
    hideTip();
    if (subject?.kind === 'station') {
      handle.select?.(selectionOfSubject(subject));
      const station = stations?.stations.find((s) => s.id === subject.id);
      if (station) handle.setView?.({ center: [station.lon, station.lat], zoom: Math.max(handle.camera?.()?.zoom ?? 0, STATION_ZOOM) });
      else handle.select?.(selectionOfSubject(subject), { fit: true });
      return;
    }
    handle.select?.(selectionOfSubject(subject), { fit: subject !== null });
  }
  const offView = view.onChange((next, prev, reason) => {
    if (!sameSubject(next.subject, prev.subject)) applySubject(next.subject, reason);
    renderControl();
  });
  if (view.get().subject) applySubject(view.get().subject, 'address');

  // ---- the contract ----------------------------------------------------------------------------------
  const map: StageMap = {
    flyTo(focus) {
      if (disposed) return;
      const subject = view.get().subject;
      switch (focus.kind) {
        case 'city':
          if (!subject) handle.select?.(null);
          handle.setView?.(cityView());
          return;
        case 'place': {
          if (!subject) handle.select?.(null);
          viewTaken = true;
          const camera = placeCamera(ctx, focus);
          if (camera) handle.setView?.(camera);
          return;
        }
        case 'route':
          viewTaken = true;
          handle.select?.({ kind: 'route', id: focus.id }, { fit: true });
          return;
        case 'station': {
          viewTaken = true;
          handle.select?.({ kind: 'place', id: bajsFeatureId(focus.id) });
          const station = stations?.stations.find((s) => s.id === focus.id);
          if (station) handle.setView?.({ center: [station.lon, station.lat], zoom: Math.max(handle.camera?.()?.zoom ?? 0, STATION_ZOOM) });
          return;
        }
        case 'stop':
          viewTaken = true;
          handle.select?.({ kind: 'stop', id: focus.id }, { fit: true });
          return;
        case 'layer':
          if (focus.layer === 'bikes') layers.set({ bikes: true });
          return;
        default:
          return;
      }
    },
    select(subject, opts = {}) {
      if (disposed) return;
      const sel: MapSelection | null = selectionOfSubject(subject);
      handle.select?.(sel, { fit: opts.fit === true });
    },
    camera: () => handle.camera?.() ?? cityView(),
    onUserMove: (fn) => { moveListeners.add(fn); return () => { moveListeners.delete(fn); }; },
    vehicles: () => (handle.vehicles?.() ?? []).map((v) => ({ id: v.id, route: v.routeId ?? null, lonLat: [v.lon, v.lat] as [number, number] })),
    // v3: the living network left the stage (V3-1); the minimaps compute their own counts from ctx.routes.
    liveCounts: () => null,
    legendCounts: () => ({
      vehicles: layers.get().vehicles && clock.speed() !== NO_VEHICLES_SPEED && lastMotion === 'ready' ? drawnCount : null,
      ghosts: compareState === 'ok' ? ghostCount : null,
      bikes: bajsMissing ? 'missing' : 'ok',
      compare: compareState,
    }),
    resize: () => { handle.resize?.(); applyFrame(); },
    destroy: () => {
      if (disposed) return;
      disposed = true;
      unbindDirector();
      if (bajsRetry) { globalThis.clearTimeout(bajsRetry); bajsRetry = null; }
      observer?.disconnect();
      doc.removeEventListener(DIRECTOR_STATE_EVENT, onDirectorState);
      removeControl();
      offView();
      offTheme();
      offLayers();
      offTick();
      offFrames();
      store?.destroy();
      handle.destroy();
      edge.remove();
      tip.remove();
    },
  };
  // Until the shell binds the director with its hooks (a second bind replaces this one), the map follows the recording on its own.
  const unbindDirector = bindDirector(ctx, map, { spot: () => {} });
  renderControl();
  frames.kick();
  return map;
};
