// The /d/ surface: one stable shell (the status line, the presentation
// panel, banners, the tab bar) around one active workspace. Real
// session, real feeds through the core stores, keyed reconciliation of the
// workspace so a poll never disturbs focus, typed text, scroll or a live map.
// Casting is explicit (D5): navigation tells the room nothing, the Zaslon
// panel sends one view frame. Every browser global is injected, so the
// behaviour is unit-tested under happy-dom.
import type { Attribution, FeedItem, ModuleId, ModuleSnapshot } from '../../worker/feed/schema';
import { LAYERS, type CodeSlot, type LayerId } from '../../worker/protocol';
import { CODE_URL_BASE, codeUrl, formatCode, speakableCode } from './code';
import { zagrebTime } from './format';
import { parseSelection, publicItemKey, selectionParams, type CastReason, type CastState, type PublicSelection, type ScreenContext, type ScreenStop } from './core/contracts';
import { createFeedStore } from './core/feed-store';
import { FLAGS } from './core/flags';
import { loadLastRun, type LastRunSnapshot } from './core/lastrun';
import { createLineFocusStore } from './core/line-focus-store';
import { createMapModeStore, type MapModeStore } from './core/map-mode-store';
import { activeCount, createNotifyStore, NOTIFY_KEYS, type NotifyKey } from './core/notify-store';
import { createSavedStore, type SavedKind } from './core/saved-store';
import { loadStops } from './core/screens';
import { createViewStore } from './core/view-store';
import { createBoardCache, type BoardCache } from './city/boards';
import { fetchSentences as fetchSentencesImpl } from './api';
import { askBoards, loadSadaFeed, nearbyInput, sadaFeed, type SadaFeedModule } from './city/feed';
import { defaultLocation, type LocationContext } from './city/location';
import { resolvePlace } from './city/place';
import { bannersMarkup, sessionEndedMarkup, statusLineMarkup, tabbarMarkup, type NoticeKind, type ShellNotice, type ShellState, type Surface } from './experience/chrome';
import { directoryModules, renderDirectory } from './experience/directory';
import { createNotifySheet } from './experience/notify-sheet';
import { createSessionSheet, type SheetAction } from './experience/session-sheet';
import { tickTimebandClock } from './experience/timeband';
import { storeLocale } from './i18n/create-default-i18n';
import type { I18n, LocaleCode } from './i18n/i18n';
import { LAYER_MODULES, renderLayer } from './layers';
import type { ExportKind, LayerContext } from './layers/types';
import { withNetwork, withTimers, type MapFactory } from './map/city-map';
import { createMapSlots } from './map/map-slots';
import { continuePoll, nextPollDelay } from './motion/loop';
import { loadNetwork, type Network } from '../../shared/motion/network';
import { frameLinesOf, type FrameLine } from '../../shared/city/frame';
import type { SentenceRequest, WrittenSentence } from '../../shared/kiosk/sentence';
import { createRotation, slotProgress, type Rotation } from './rotation';
import type { SessionClient } from './session';
import { createDialog, type DialogHandle } from './ui/dialog';
import { createElementFromHTML, escapeAttribute, escapeHtml } from './ui/dom/escape';
import { reconcile, reconcileChildren } from './ui/dom/reconcile';
import { iconMarkup } from './ui/icons';
import { createQr } from './ui/qr';
import type { ThemeController, ThemePreference } from './ui/theme';
import { PRESENTATION_ACK_MS, type PresentationCommand, type PresentationState, type PresentationTarget } from '../../worker/presentation';
import { presentationPanel, presentationTargetLabel } from './experience/presentation';
import { createCityStore, type CityStore } from './core/city-store';
import { dynamicPlaces } from './city/discovery';
import { ct } from './city/strings';

/** The per-second tick for the remaining time; the poll has its own aligned timer. */
const TICK_MS = 1_000;
/** How many times a session asks for the stop catalogue before it leaves it down (one per draw after a failure). */
const STOPS_ATTEMPTS = 3;

/** The layer last opened, mirrored so the next scan reopens it (R-60). */
export const LAYER_STORAGE_KEY = 'vidikovac.layer';

/** Layers whose renderers declare interactions as data-action and are safe to reconcile in place. */
const RECONCILED_LAYERS: ReadonlySet<LayerId> = new Set<LayerId>(['grad-sada', 'zrak-i-nebo', 'sigurnost', 'uprava-i-pravo', 'kultura']);

function safeSessionStorage(): Pick<Storage, 'getItem' | 'setItem'> | undefined {
  try { return globalThis.sessionStorage; } catch { return undefined; }
}

function safeLocalStorage(): Pick<Storage, 'getItem' | 'setItem'> | undefined {
  try { return globalThis.localStorage; } catch { return undefined; }
}

function readStoredLayer(storage: Pick<Storage, 'getItem'> | undefined): LayerId | null {
  try {
    const stored = storage?.getItem(LAYER_STORAGE_KEY);
    return stored && (LAYERS as readonly string[]).includes(stored) ? (stored as LayerId) : null;
  } catch { return null; }
}

/** The stores call a new listener at once with the current value; the shell has painted by then, so only later changes repaint. */
function onChange<T>(subscribe: (listener: (value: T) => void) => () => void, listener: () => void): () => void {
  let primed = false;
  return subscribe(() => {
    if (primed) listener();
    else primed = true;
  });
}

export interface SessionHashParams { roomId: string; ticket: string | null; label: string | null }

export function parseSessionHash(hash: string): SessionHashParams | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const roomId = params.get('room');
  if (!roomId) return null;
  return { roomId, ticket: params.get('ticket'), label: params.get('label') };
}

export interface MediaLike { matches: boolean; addEventListener?(type: 'change', listener: () => void): void; removeEventListener?(type: 'change', listener: () => void): void }

export interface DashboardDeps {
  createBoards?: () => BoardCache;
  cityStore?: CityStore;
  i18n: I18n;
  session: SessionClient;
  now?: () => number;
  fetchData?: (module: ModuleId, token: string) => Promise<ModuleSnapshot>;
  /** Legacy hint for the surface when no matchMedia is available. */
  wide?: boolean;
  label?: string | null;
  reducedMotion?: boolean;
  /** Decided once at the entry and passed down, exactly like `reducedMotion`. */
  lightweight?: boolean;
  /** Read by nothing since the phone's schematic host went with the lightweight face (WP5 A3); entries/dashboard.ts still passes it. */
  onRepaint?: (listener: () => void) => () => void;
  mapFactory?: MapFactory;
  /** Shared with the entry's idle-prefetch guard; omitted creates the device store here. */
  mapMode?: MapModeStore;
  loadNetwork?: () => Promise<Network | null>;
  /** Sada's sentence route (seam S6, WP4 step 12); omitted uses api.ts fetchSentences. */
  fetchSentences?: (request: SentenceRequest) => Promise<WrittenSentence[]>;
  /** The screen stop's last-departure table (T3.1); omitted uses the static file under /data/lastrun. */
  loadLastRun?: (stopId: string) => Promise<LastRunSnapshot | null>;
  onCopy?: (text: string, attribution: Attribution) => void;
  onShare?: (url: string, title: string) => void;
  onExport?: (kind: ExportKind, module: ModuleId) => void;
  onItemExport?: (kind: 'ics' | 'geojson' | 'print', item: FeedItem, snapshot: ModuleSnapshot) => void;
  onItemCopy?: (item: FeedItem, snapshot: ModuleSnapshot) => void;
  onItemShare?: (item: FeedItem, snapshot: ModuleSnapshot) => void;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (handle: unknown) => void;
  theme?: ThemeController;
  /** Layer memory; null disables it, omitted uses sessionStorage. */
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
  /** Device preferences (saved, alerts and map renderer); null disables persistence, omitted uses localStorage. */
  localStorage?: Pick<Storage, 'getItem' | 'setItem'> | null;
  /** Static flags the shell reads (D7): `waste` shows the fourth alert switch. */
  flags?: { waste?: boolean };
  location?: Pick<Location, 'pathname' | 'search' | 'hash'>;
  history?: Pick<History, 'pushState' | 'replaceState'>;
  matchMedia?: (query: string) => MediaLike;
  onLocaleChange?: (locale: LocaleCode) => void;
  scanUrl?: string;
}

export interface DashboardHandle {
  element: HTMLElement;
  selectLayer(layer: LayerId): void;
  /** The layer on screen, for metrics such as `<layer>/<kind>` export dimensions. */
  activeLayer(): LayerId;
  /** Re-reads the fragment after a Back or Forward navigation. */
  restore(hash: string): void;
  destroy(): void;
}
export function mountDashboard(root: HTMLElement, deps: DashboardDeps): DashboardHandle {
  const cityStore = deps.cityStore ?? createCityStore();
  const workspaceDisposals=new Set<()=>void>();
  const { i18n, session } = deps;
  const now = deps.now ?? (() => Date.now());
  const setTimer = deps.setInterval ?? ((fn, ms) => globalThis.setInterval(fn, ms));
  const clearTimer = deps.clearInterval ?? ((h) => globalThis.clearInterval(h as never));
  const lightweight = Boolean(deps.lightweight);
  const storage = deps.storage === undefined ? safeSessionStorage() : deps.storage ?? undefined;
  const local = deps.localStorage === undefined ? safeLocalStorage() : deps.localStorage ?? undefined;
  const scanUrl = deps.scanUrl ?? '/s/';
  const doc = root.ownerDocument;

  // --- state ---------------------------------------------------------------
  const view = createViewStore({
    initialLayer: readStoredLayer(storage) ?? LAYERS[0]!,
    location: deps.location,
    history: deps.history,
    storage,
    hash: deps.location?.hash ?? '',
  });
  const store = createFeedStore({
    fetchData: deps.fetchData ?? (() => Promise.reject(new Error('no-fetch'))),
    token: () => session.snapshot().dataToken,
    now,
  });
  // The reader's device stores: saved lines/stops, alerts and the live transit renderer.
  const saved = createSavedStore({ storage: local });
  const notifyStore = createNotifyStore({ storage: local });
  const mapMode = deps.mapMode ?? createMapModeStore({ storage: local });
  const lineFocus = createLineFocusStore({ storage: local });
  const boards = deps.createBoards?.() ?? createBoardCache({now});
  let locationContext: LocationContext | undefined;
  const notifyKeys: readonly NotifyKey[] = deps.flags?.waste ? NOTIFY_KEYS : NOTIFY_KEYS.filter((key) => key !== 'waste');
  /** The stop catalogue, fetched once per session: the place and its departures stop are resolved from it (B.10, WP4). */
  let stops: readonly ScreenStop[] | null = null;
  let stopsRequested = false;
  /** How many times the catalogue has been asked for, and whether the last answer failed (the departures block then says so). */
  let stopsAttempts = 0;
  let stopsDown = false;
  /** The screen stop's last scheduled departures (T3.1, FEED_LASTRUN): fetched once per stop, null until it answers. */
  let lastRun: LastRunSnapshot | null = null;
  let lastRunStop: string | null = null;
  let networkPromise: Promise<Network | null> | null = null;
  /** The network's tram lines in call order (shared/city/frame.ts frameLinesOf), once the artefact has loaded: the
   *  phone's circle is then measured along the lines as the wall's is; until then frameRadiusM falls back among trams. */
  let frameLines: readonly FrameLine[] | undefined;
  // --- Sada's sentence (WP4 step 12; seam S6) -------------------------------
  // The page rotates one sentence over the facts Sada's rows are chosen from: the model's answers (fetchSentences,
  // asked at most once a minute since the route is rate-limited per IP) and WP1's templates, read through the
  // wall's own sequence (20 s hold, no verbatim repeat within ten minutes, the header's strict acceptance on every
  // candidate: a rejected fact yields no sentence, decision 21). The tools live in the lazy feed chunk.
  /** The phone asks the sentence route at most this often. */
  const SENTENCE_FETCH_MS = 60_000;
  const fetchSentences = deps.fetchSentences ?? fetchSentencesImpl;
  let sentenceSequence: ReturnType<SadaFeedModule['createSentenceSequence']> | null = null;
  let modelSentences: WrittenSentence[] = [];
  let sentenceFetchKey = '';
  let sentenceAskedAt = -Infinity;
  let sentenceFetchSeq = 0;
  const loadNetworkOnce = (refresh = false): Promise<Network | null> => {
    // Karta replaces this shared cache after a deploy, so later map mounts
    // cannot reinstall the graph the current map just rejected.
    if (!networkPromise || refresh) networkPromise = (deps.loadNetwork ?? (() => loadNetwork(
      refresh ? (input, init) => fetch(input, { ...init, cache: 'reload' }) : fetch, lightweight,
    )))();
    return networkPromise;
  };
  const maps = createMapSlots(
    lightweight ? undefined : withTimers(withNetwork(deps.mapFactory, loadNetworkOnce, undefined, () => loadNetworkOnce(true)), setTimer as (fn: () => void, ms: number) => unknown, clearTimer),
  );
  const media = deps.matchMedia?.('(min-width: 60rem)') ?? (globalThis.matchMedia ? globalThis.matchMedia('(min-width: 60rem)') : null);
  const surface = (): Surface => (media ? media.matches : Boolean(deps.wide)) ? 'desktop' : 'phone';
  /** The desk is the phone, wider [O-56] (WP4 step 8): Sada and Karta stand side by side in one .ki-desk pair whenever
   *  either is the layer, so navigating between them redraws the same pair and the map is never re-created. */
  const deskPair = (): boolean => {
    const layer = view.snapshot().layer;
    return surface() === 'desktop' && !directory && (layer === 'grad-sada' || layer === 'u-pokretu');
  };

  let frozen = false;
  /** The moment freeze() ran: every workspace and time line is dated with it. */
  let frozenAt: number | undefined;
  let paused = false;
  let countdownHidden = false;
  let directory = false;
  const agendaScroll=new Map<LayerId,{top:number;focus:string}>();
  let presentationOpen = false;
  let presentationState: PresentationState | undefined = session.snapshot().presentation;
  let presentationConfirmRevision: number | null = null;
  let presentationRequest: PresentationCommand | null = null;
  let presentationRequestAt = 0;
  let presentationPendingSince = 0;
  let presentationMessage = '';
  let presentationSequence = 0;
  let mapFull = false;
  let reconnecting = false;
  let error: string | null = null;
  let lastRefresh: number | null = null;
  let totalSeconds: number | null = null;
  let warned60 = false;
  let warned20 = false;
  let timer: unknown = null;
  /** The lane for every module but transit: they keep the cadence they had
   *  before the twin's 10 s beat, so the faster transit poll triples nothing
   *  but the one request that carries new evidence (R-TE4). */
  const SLOW_POLL_MS = 30_000;
  let slowTimer: unknown = null;
  let tickTimer: unknown = null;
  let disposed = false;
  let shareDenied = false;
  let joinedOnce = false;
  /** The one in-flow notice; the hidden live regions announce, this one shows. */
  let notice: ShellNotice | null = null;
  /** The workspace last painted (a layer id or 'directory'): render() fades the
   *  incoming one in only when this changes, never on a poll that repaints the
   *  same place. Seeded from the initial view so the first paint never fades. */
  let lastWorkspaceKey: string = view.snapshot().layer;
  /** The 200 ms fallback that clears data-enter for an engine that never fires animationend. */
  let enterTimer: unknown = null;

  // --- stable shell --------------------------------------------------------
  // The two live regions are visually hidden, never display: none, so readers hear them.
  // Five regions in reading order on both surfaces (B.5); the CSS places them, never hides a control that exists.
  const element = createElementFromHTML(`<div class="ki" data-testid="dash" data-surface="${surface()}" data-view="layers" data-state="connecting">
<h1 class="visually-hidden" data-testid="dash-title" tabindex="-1"></h1>
<p class="visually-hidden" role="status" aria-live="polite" data-testid="announce-polite"></p>
<p class="ki-alert visually-hidden" role="alert" aria-live="assertive" data-testid="announce-assertive"></p>
<header class="ki-head ki-status" data-region="status" data-testid="status-line"></header>
<div class="ki-presentation" data-region="presentation"></div>
<div class="ki-banners" data-region="banners" data-testid="banners"></div>
<main class="ki-main" id="ki-main" data-testid="dash-view" tabindex="-1"></main>
<nav class="ki-tabbar" data-region="tabs" aria-label="${escapeAttribute(i18n.t('nav.label'))}"></nav>
</div>`);
  root.appendChild(element);
  const region = (name: string): HTMLElement => element.querySelector<HTMLElement>(`[data-region=${name}]`)!;
  const titleEl = element.querySelector<HTMLElement>('[data-testid=dash-title]')!;
  const polite = element.querySelector<HTMLElement>('[data-testid=announce-polite]')!;
  const assertive = element.querySelector<HTMLElement>('[data-testid=announce-assertive]')!;
  const main = element.querySelector<HTMLElement>('main')!;
  const regions = { status: region('status'), presentation: region('presentation'), banners: region('banners'), tabs: region('tabs') };

  /** Active modules whose last fetch failed or whose snapshot is down: the shell says it once. */
  function sourcesDown(feed: ReturnType<typeof store.snapshot>): number {
    return activeModules().filter((m) => feed.errors[m] !== undefined || feed.snapshots[m]?.status === 'down').length;
  }

  /**
   * Whether "Na zaslon" can fire and why not when it cannot (D5). The client cannot
   * know it is the room's driver; `role === 'scanner'` is the proxy (B.10).
   */
  function castState(): CastState {
    const s = session.snapshot();
    const reason: CastReason | null = frozen ? 'frozen' : s.phase !== 'live' ? 'connecting' : !s.screen ? 'no-screen' : s.role !== 'scanner' ? 'peer' : !presentationState?.online ? 'screen-offline' : !presentationState?.supported ? 'unsupported' : null;
    return { can: reason === null, reason, screenLabel: deps.label ?? null, stopName: s.screen?.stop?.name ?? null };
  }

  function shellState(): ShellState {
    const s = session.snapshot();
    const feed = store.snapshot();
    const stop = s.screen?.stop ?? undefined;
    const notify = notifyStore.snapshot();
    return {
      layer: view.snapshot().layer, directory, phase: s.phase, frozen, reconnecting,
      secondsLeft: frozen ? 0 : session.secondsLeft(), totalSeconds, expiresAt: s.expiresAt, countdownHidden, paused,
      loading: feed.loading.size > 0, canShare: s.role === 'scanner' && !frozen && s.phase === 'live' && !shareDenied,
      label: deps.label ?? null, role: s.role, participants: s.participants, error, lastRefresh, mapFull,
      notice, sourcesDown: sourcesDown(feed),
      surface: surface(), stopName: stop?.name ?? null,
      hasScreen: Boolean(s.screen),
      presentation: presentationState, presentationOpen,
      notify, notifyActive: activeCount(notify, notifyKeys), notifyKeys,
    };
  }

  function paintRegion(target: HTMLElement, markup: string): void {
    reconcileChildren(target, createElementFromHTML(`<div>${markup}</div>`));
  }

  /** The layer and its selection; Sada has no time filter any more, so no `time` rides along (the wire still accepts one). */
  function currentPresentationTarget(): PresentationTarget {
    const state = view.snapshot();
    return {
      layer: state.layer,
      ...(state.selection ? { selection: state.selection } : {}),
    };
  }

  function paintPresentation(): void {
    const target = currentPresentationTarget();
    const cityUnsupported=(target.selection?.kind==='place'||target.selection?.kind==='street')&&!presentationState?.capabilities?.includes('city-v1');
    const waiting = presentationRequest !== null || presentationState?.status === 'pending';
    const since = presentationRequest ? presentationRequestAt : presentationPendingSince;
    const pending = waiting && now() - since < PRESENTATION_ACK_MS;
    const s = session.snapshot();
    let message = presentationMessage;
    if (s.phase !== 'live' || frozen) message = i18n.t(frozen ? 'cast.frozen' : 'cast.connecting');
    else if (!presentationState?.online) message = i18n.t('presentation.offline');
    else if (!presentationState.supported||cityUnsupported) message = i18n.t('presentation.unsupported');
    else if (waiting && !pending && !message) message = i18n.t('presentation.notConfirmed');
    else if (pending && !message) message = i18n.t('presentation.pending');
    else if (presentationState.status === 'unavailable') message = i18n.t('presentation.unavailable');
    else if (presentationState.status === 'displayed' && presentationState.owner === 'self' && !message) message = i18n.t('presentation.displayed');
    paintRegion(regions.presentation, presentationPanel(i18n, {
      open: presentationOpen, state: presentationState, target,
      targetLabel: presentationTargetLabel(i18n, target, store.snapshot().snapshots, stops ?? (s.screen?.stop ? [s.screen.stop] : []),cityStore.snapshot()),
      currentLabel: presentationState?.status === 'pending' ? i18n.t('presentation.pending')
        : presentationState?.status === 'unavailable' ? i18n.t('presentation.unavailable')
        : presentationTargetLabel(i18n, presentationState?.target ?? null, store.snapshot().snapshots, stops ?? (s.screen?.stop ? [s.screen.stop] : []),cityStore.snapshot()),
      screenLabel: deps.label ?? s.screen?.stop?.name ?? i18n.t('session.labelScreen'),
      can: castState().can&&!cityUnsupported, canStop:castState().can, confirming: presentationConfirmRevision !== null, pending, message,
    }));
  }

  function paintShell(): void {
    // The two expiry marks are decided before the paint so the same paint carries their notice.
    const live = session.snapshot();
    if (!frozen && live.expiresAt !== null && live.phase === 'live') {
      const left = session.secondsLeft();
      if (left <= 60) announce(60);
      if (left <= 20) announce(20);
    }
    const s = shellState();
    element.dataset.surface = surface();
    element.dataset.state = frozen ? 'frozen' : reconnecting ? 'reconnecting' : s.phase;
    element.dataset.countdown = countdownHidden ? 'hidden' : 'shown';
    element.dataset.loading = String(s.loading);
    // One status row on both surfaces: no clock, so no weather here; weather is a row of the feed [O-56].
    paintRegion(regions.status, statusLineMarkup(i18n, s));
    paintRegion(regions.banners, bannersMarkup(i18n, s, scanUrl));
    paintRegion(regions.tabs, tabbarMarkup(i18n, s));
    regions.tabs.setAttribute('aria-label', i18n.t('nav.label'));
    sheet.refresh();
    notifySheet.refresh();
    paintPresentation();
  }

  /** Shows one notice in flow for `ms` (null: until replaced or the freeze) and paints. */
  function setNotice(kind: NoticeKind, text: string, ms: number | null): void {
    notice = { kind, text, until: ms === null ? null : now() + ms };
    paintShell();
  }

  function updateTitle(): void {
    // The desk pair is one page, titled by its feed whichever half the layer names.
    const layerName = directory ? i18n.t('nav.moreTitle') : deskPair() ? i18n.t('layers.grad-sada') : i18n.t(`layers.${view.snapshot().layer}`);
    const title = i18n.t('session.documentTitle', { app: i18n.t('common.appName'), layer: layerName });
    titleEl.textContent = title;
    doc.title = title;
  }
  // --- workspace -----------------------------------------------------------
  const mapView = { get full(): boolean { return mapFull; }, toggle: (): void => setMapView(!mapFull) };
  const navigateAction = (layer: LayerId, selection?: PublicSelection | null): void => navigate(layer, selection ?? null, true);
  const setFilterAction = (key: string, value: string): void => view.setFilter(key, value);
  const retryAction = (module: ModuleId): void => { void store.refresh([module]); };

  function screen(): ScreenContext {
    return {
      surface: surface(), locale: i18n.getLocale(),
      theme: deps.theme?.getResolvedTheme() ?? 'light', themePreference: deps.theme?.getPreference() ?? 'auto',
      lightweight, reducedMotion: Boolean(deps.reducedMotion), stop: session.snapshot().screen?.stop ?? undefined,
    };
  }

  function layerContext(): LayerContext {
    const feed = store.snapshot();
    const ctx: LayerContext = {
      city: cityStore.snapshot(),
      ensureCity: ids => { if (!frozen && !disposed) void cityStore.ensure(ids); },
      onDispose:fn=>workspaceDisposals.add(fn),
      i18n, snapshots: feed.snapshots, now: frozenAt??now(), errors: feed.errors, view: view.snapshot(), screen: screen(),
      location: locationContext ?? defaultLocation(screen()),
      // Sada's title and the stop its departures come from (city/place.ts), resolved on every draw.
      place: resolvePlace({ screen: session.snapshot().screen, saved, stops: stops ?? undefined, location: locationContext }),
      setLocation: value => { locationContext=value; },
      boards, onLocalData: repaintLocalData,
      onCopy: deps.onCopy, onShare: deps.onShare, onExport: deps.onExport,
      onItemCopy: deps.onItemCopy, onItemShare: deps.onItemShare, onItemExport: deps.onItemExport,
      navigate: navigateAction, setFilter: setFilterAction, onRetry: retryAction,
      maps, mapView: lightweight ? undefined : mapView, mapMode: lightweight ? undefined : mapMode,
      lineFocus: lightweight ? undefined : lineFocus, reducedMotion: deps.reducedMotion, lightweight,
      frozenAt, session: { expiresAt: session.snapshot().expiresAt, frozen },
      notify: notifyStore.snapshot(),
      saved: { list: () => saved.list(), has: (kind, id) => saved.has(kind, id) }, stops: stops ?? undefined, stopsDown, lastRun,
      // The screen's Kadar and the network's lines, so the phone's circle is the wall's measured one (seam S2).
      frame: session.snapshot().screen?.frame, frameLines,
    };
    // The place's "U blizini" list for Karta's default sheet (city/feed.ts, the same rows Sada lists), at most `cap`
    // rows, with the head's circle and the radius the frame is fitted to. Null while the lazily loaded selection chunk
    // is not in hand (the page repaints when it lands); never a static import of city/nearby.ts on /d/ (the budget).
    ctx.nearby = (cap) => {
      const feed = sadaFeed(repaintLocalData);
      if (typeof feed !== 'object') return null;
      // The list leads with the departures: the boards are asked for here too, so Karta opened first has them.
      askBoards(ctx);
      const input = nearbyInput(ctx);
      const rows = feed.selectNearby(input);
      return {
        html: feed.nearbySectionMarkup(i18n, rows, input.radiusM, input.now, { cap, id: 'karta' }),
        pill: feed.nearbyPill(i18n, input.radiusM),
        radiusM: input.radiusM,
      };
    };
    // Sada's sentence, the page's pick (step 12), only while Sada is drawn; absent, Sada holds its own place.
    if (sadaShown()) {
      const feed = sadaFeed(repaintLocalData);
      if (typeof feed === 'object') {
        const input = nearbyInput(ctx);
        ctx.sentence = sadaSentence(feed, input, feed.selectNearby(input));
      }
    }
    return ctx;
  }

  /** Whether Sada is on the page: the layer itself, or either half of the desk pair. */
  function sadaShown(): boolean {
    return !directory && (view.snapshot().layer === 'grad-sada' || deskPair());
  }

  /** The rotation's pick for this draw: the model's answers still valid against these facts, then the templates. */
  function sadaSentence(feed: SadaFeedModule, input: ReturnType<typeof nearbyInput>, rows: ReturnType<SadaFeedModule['selectNearby']>): WrittenSentence | null {
    const at = input.now;
    const facts = feed.sadaSentenceFacts(input, rows);
    // Old answers are never trusted against the facts they were requested with (the wall's rule).
    modelSentences = feed.readWrittenSentences(modelSentences, { facts, budget: feed.PHONE_SENTENCE_BUDGET, now: at });
    sentenceSequence ??= feed.createSentenceSequence({ rhythmMs: feed.SENTENCE_HOLD_MS, noRepeatMs: feed.SENTENCE_NO_REPEAT_MS });
    const pool = [...modelSentences, ...feed.templateSentences(facts, i18n, feed.PHONE_SENTENCE_BUDGET, at)];
    return sentenceSequence.read(pool, at);
  }

  /**
   * Asks the sentence route for these facts: at most once a minute, the same facts again only after the
   * wall's refresh period, never before the join, never after the end. The facts are the page's own at this
   * moment (the same selection Sada draws from), so the answer is read against them on the next draw.
   */
  function ensureSentences(): void {
    if (disposed || frozen || paused || session.snapshot().phase !== 'live' || !sadaShown()) return;
    const feed = sadaFeed(repaintLocalData);
    if (typeof feed !== 'object') return;
    const ctx = layerContext();
    const input = nearbyInput(ctx);
    const at = now();
    const stable = feed.modelSentenceFacts(feed.sadaSentenceFacts(input, feed.selectNearby(input)), at);
    if (!stable.length) return;
    const locale: SentenceRequest['locale'] = i18n.getLocale().startsWith('en') ? 'en' : 'hr';
    const key = JSON.stringify([locale, stable.map((fact) => [fact.id, fact.kind, fact.text])]);
    if (at - sentenceAskedAt < (key === sentenceFetchKey ? feed.SENTENCE_REFRESH_MS : SENTENCE_FETCH_MS)) return;
    sentenceFetchKey = key;
    sentenceAskedAt = at;
    const seq = ++sentenceFetchSeq;
    void fetchSentences({ locale, budget: feed.PHONE_SENTENCE_BUDGET, facts: stable }).then((answer) => {
      if (disposed || frozen || seq !== sentenceFetchSeq) return;
      modelSentences = feed.readWrittenSentences(answer, { facts: stable, budget: feed.PHONE_SENTENCE_BUDGET, now: now() });
      if (modelSentences.length) render();
    }, () => { /* Optional inference never replaces the templates with an error. */ });
  }

  /** Draws the active workspace: reconciled in place for delegated renderers, replaced for the rest. */
  function repaintLocalData():void { if(!disposed&&!frozen)render(); }
  /** After the end the workspace is the closing card alone (WP4 step 11): re-said on a locale change, never data. */
  function renderEnded(): void {
    main.replaceChildren(createElementFromHTML(sessionEndedMarkup(i18n, shellState(), scanUrl)));
  }
  function render(): void {
    if (frozen) { renderEnded(); return; }
    ensureStops();
    ensureLastRun();
    // A renderer may move a controller's live node while producing its tree.
    // Capture focus before calling it, not after that move has blurred it.
    const focused = doc.activeElement instanceof HTMLElement ? doc.activeElement : null;
    const focusedId = focused?.id;
    const caret = focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement
      ? { start: focused.selectionStart, end: focused.selectionEnd, direction: focused.selectionDirection }
      : null;
    const ctx = layerContext();
    const layer = view.snapshot().layer;
    const pair = deskPair();
    // Karta on the phone is a fixed stage (map.css, .ki[data-stage='map']): the shell is the viewport and main is
    // the stage. The desk pair is its own stage (data-stage='desk': the feed scrolls, the map column sticks). An
    // empty value removes the styling; the 60rem media query stays the one CSS breakpoint.
    element.dataset.stage = pair ? 'desk' : !lightweight && !directory && layer === 'u-pokretu' ? 'map' : '';
    let next: HTMLElement;
    if (directory) next = renderDirectory(ctx);
    else if (pair) {
      // Sada then Karta, keyed so the reconciler morphs the same pair on every poll; the workspace section inside
      // carries its own data-reconcile and its kaj-persist slot (layers/u-pokretu.ts), so the live map stays put.
      next = doc.createElement('div');
      next.className = 'ki-desk';
      next.dataset.key = 'desk';
      next.append(renderLayer('grad-sada', ctx), renderLayer('u-pokretu', ctx));
    } else next = renderLayer(layer, ctx);
    if (directory || pair || RECONCILED_LAYERS.has(layer) || next.hasAttribute('data-reconcile')) {
      const wrapper = doc.createElement('div');
      wrapper.appendChild(next);
      reconcile(main, wrapper);
    } else {
      main.replaceChildren(next);
    }
    // Motion that reports a fact: a genuine workspace switch (never a poll that
    // redraws the same place) fades `next` in -- it is the live node exactly
    // when the key actually changed, since reconcile.ts only morphs onto (and
    // discards `next` in favour of) a pre-existing node of the same key.
    const workspaceKey = directory ? 'directory' : pair ? 'desk' : layer;
    if (workspaceKey !== lastWorkspaceKey) {
      lastWorkspaceKey = workspaceKey;
      if (!deps.reducedMotion && !lightweight) {
        if (enterTimer !== null) { clearTimer(enterTimer); enterTimer = null; }
        main.dataset.enter = '1';
        const layerEl = next;
        // The 200 ms fallback is the primary path (happy-dom never fires
        // animationend); a real engine's animationend clears it early, and
        // calls `clearTimer` on itself either way (`armPoll`'s own idiom),
        // so a harness that tracks live timers by their own clearInterval
        // sees this one settled once either path has run.
        const clear = (): void => {
          if (enterTimer !== null) { clearTimer(enterTimer); enterTimer = null; }
          delete main.dataset.enter;
        };
        const onAnimationEnd = (event: AnimationEvent): void => { if (event.target === layerEl) clear(); };
        layerEl.addEventListener('animationend', onAnimationEnd, { once: true });
        enterTimer = setTimer(clear, 200);
      }
    }
    const target = focused?.isConnected ? focused : focusedId ? doc.getElementById(focusedId) : null;
    if (target && doc.activeElement !== target) {
      target.focus({ preventScroll: true });
      if (caret && caret.start !== null && caret.end !== null &&
          (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) {
        target.setSelectionRange(caret.start, caret.end, caret.direction ?? undefined);
      }
    }
    maps.sweep();
    if (error === 'no-ticket') maps.pause();
  }

  /** The 245 kB stop catalogue, once per mount. A failed load marks the catalogue down, so the departures
   *  block says so in one row instead of waiting, and the next draw asks again, at most STOPS_ATTEMPTS times. */
  function ensureStops(): void {
    if (stopsRequested) return;
    stopsRequested = true;
    stopsAttempts += 1;
    loadStops().then((list) => {
      if (disposed) return;
      stops = list;
      stopsDown = false;
      render();
    }, () => {
      if (disposed) return;
      stopsDown = true;
      render();
      // Re-armed after this draw, not before it, so a retry waits for the next poll rather than looping here.
      if (stopsAttempts < STOPS_ATTEMPTS && !frozen) stopsRequested = false;
    });
  }

  /** The stop's last-departure file, once per stop and only behind FEED_LASTRUN; a failed answer leaves the tile absent. */
  function ensureLastRun(): void {
    if (!FLAGS.FEED_LASTRUN) return;
    // The stop the departures block boards: the screen's, a saved one, or the one nearest the place.
    const stop = resolvePlace({ screen: session.snapshot().screen, saved, stops: stops ?? undefined, location: locationContext }).departuresStop;
    if (!stop || stop.id === lastRunStop) return;
    lastRunStop = stop.id;
    // A new stop: the previous stop's schedule leaves the band at once rather than posing as this one until the fetch answers.
    lastRun = null;
    (deps.loadLastRun ?? loadLastRun)(stop.id).then((snapshot) => {
      if (disposed || lastRunStop !== stop.id) return;
      lastRun = snapshot;
      render();
    }, () => {
      // The loader answers down itself; a rejection here is the injected dependency's, and the tile stays absent.
    });
  }

  function setMapView(full: boolean): void {
    if (mapFull === full) return;
    mapFull = full;
    element.dataset.view = full ? 'map' : 'layers';
    render();
  }

  function focusWorkspace(id: string): void {
    doc.getElementById(`layer-title-${id}`)?.focus();
  }

  /** A new place on the phone starts at the top, under the sticky header; the desktop keeps its scroll. */
  function scrollToTop(): void {
    if (surface() === 'phone' && typeof globalThis.scrollTo === 'function') globalThis.scrollTo({ top: 0 });
  }

  function activeModules(): readonly ModuleId[] {
    if (directory) return directoryModules(surface());
    if (deskPair()) return [...new Set([...LAYER_MODULES['grad-sada'], ...LAYER_MODULES['u-pokretu']])];
    return LAYER_MODULES[view.snapshot().layer];
  }

  function navigate(layer: LayerId, selection: PublicSelection | null, fromUser: boolean): void {
    if (frozen) return;
    const previous = view.snapshot().layer;
    const wasDirectory = directory;
    if (selection && !view.snapshot().selection && layer===previous) {
      agendaScroll.set(layer,{top:globalThis.scrollY??0,focus:doc.activeElement instanceof HTMLElement?doc.activeElement.id:''});
    }
    directory = false;
    if (layer !== 'u-pokretu' && mapFull) { mapFull = false; element.dataset.view = 'layers'; }
    // One history entry per distinct place: repeating the same selection replaces instead of pushing.
    const same = layer === previous && JSON.stringify(selection) === JSON.stringify(view.snapshot().selection);
    view.navigate(layer, selection, !fromUser || same);
    updateTitle();
    paintShell();
    if (!fromUser) return;
    if (layer !== previous || wasDirectory) {
      session.event('panel_open', layer);
      scrollToTop();
      focusWorkspace(layer);
      continuePoll(refresh(), rearmPoll, 'dashboard layer refresh');
    } else if (selection) {
      doc.getElementById('ws-detail-title')?.focus();
      scrollToTop();
    } else {
      focusWorkspace(layer);
      const position=agendaScroll.get(layer);
      if(position){globalThis.scrollTo?.({top:position.top});if(position.focus)doc.getElementById(position.focus)?.focus({preventScroll:true});}
    }
  }

  function toggleDirectory(open = !directory): void {
    if (frozen) return;
    directory = open;
    updateTitle();
    paintShell();
    render();
    if (open) {
      focusWorkspace('directory');
      continuePoll(refresh(), rearmPoll, 'dashboard directory refresh');
    }
  }

  /** Explicit casting (D5): the one place a view frame leaves this device, for the current layer and selection. */
  function cast(): void {
    presentationOpen = !presentationOpen;
    presentationConfirmRevision = null;
    if (presentationOpen) session.refreshPresentation?.();
    paintShell();
    paintPresentation();
  }

  function present(action: 'present' | 'stop', confirm = false, target = currentPresentationTarget()): void {
    if (!castState().can || !presentationState) return;
    if(action==='present'&&(target.selection?.kind==='place'||target.selection?.kind==='street')&&!presentationState.capabilities?.includes('city-v1'))return;
    if (action === 'present' && presentationState.owner === 'other' && !confirm) {
      presentationConfirmRevision = presentationState.revision;
      paintPresentation();
      return;
    }
    const expectedRevision = confirm ? presentationConfirmRevision : presentationState.revision;
    if (expectedRevision === null) return;
    presentationRequest = {
      version: 1, requestId: `p_${now().toString(36)}_${++presentationSequence}`,
      action, expectedRevision,
      ...(action === 'present' ? { target } : {}),
      ...(confirm ? { takeover: true } : {}),
    };
    presentationConfirmRevision = null;
    presentationRequestAt = now();
    presentationMessage = '';
    session.present?.(presentationRequest);
    paintPresentation();
  }

  function findItem(module: ModuleId, id: string): { item: FeedItem; snapshot: ModuleSnapshot } | null {
    const snapshot = store.snapshot().snapshots[module];
    const item = snapshot?.items.find((candidate) => candidate.id === id);
    return snapshot && item ? { item, snapshot } : null;
  }

  const sheet = createSessionSheet({
    i18n, now,
    state: () => ({
      session: session.snapshot(), frozen, paused, countdownHidden, canShare: session.snapshot().role === 'scanner' && !shareDenied,
      label: deps.label ?? null, themePreference: deps.theme?.getPreference() ?? null,
    }),
    onAction: (action, value) => handleSheetAction(action, value),
  });
  const notifySheet = createNotifySheet({
    i18n,
    state: () => ({ flags: notifyStore.snapshot(), keys: notifyKeys }),
    onToggle: (key) => notifyStore.toggle(key),
  });

  function setPaused(value: boolean): void {
    if (paused === value || frozen) return;
    paused = value;
    store.pause(value);
    paintShell();
    if (!value) continuePoll(refresh(), rearmPoll, 'dashboard resume refresh');
  }

  function setLocale(next: string): void {
    const applied = i18n.setLocale(next);
    // The model's answers were written in the other language; the templates carry the card until the next ask.
    modelSentences = [];
    sentenceFetchKey = '';
    storeLocale(applied);
    doc.documentElement.lang = applied;
    i18n.translatePage(doc);
    deps.onLocaleChange?.(applied);
    updateTitle();
    paintShell();
    render();
  }

  function handleSheetAction(action: SheetAction, value?: string): void {
    switch (action) {
      case 'share-city': session.share(); sheet.close(); return;
      case 'pause': setPaused(true); return;
      case 'resume': setPaused(false); return;
      case 'hide-countdown': countdownHidden = true; paintShell(); return;
      case 'show-countdown': countdownHidden = false; paintShell(); return;
      case 'refresh': continuePoll(refresh(), rearmPoll, 'dashboard manual refresh'); return;
      case 'lang': if (value) setLocale(value); return;
      case 'theme': if (value) deps.theme?.setPreference(value as ThemePreference); render(); return;
      default: return;
    }
  }
  // --- data ----------------------------------------------------------------
  /** The transit snapshot's own timing, when transit is on screen: the poll
   *  lane rides the twin's validUntil, else its source time (motion/loop.ts). */
  function pollAnchor(): { sourceUpdatedAt?: string; validUntil?: string } | undefined {
    if (!activeModules().includes('zet-rt')) return undefined;
    const zet = store.snapshot().snapshots['zet-rt'];
    return zet ? { sourceUpdatedAt: zet.sourceUpdatedAt, validUntil: zet.validUntil } : undefined;
  }

  type Lane = 'all' | 'transit' | 'rest';

  async function refresh(lane: Lane = 'all'): Promise<void> {
    if (frozen || paused || disposed || !session.snapshot().dataToken) return;
    const active = activeModules();
    store.setModules(active);
    const ids = lane === 'all' ? active : active.filter((id) => (id === 'zet-rt') === (lane === 'transit'));
    if (ids.length === 0) return;
    await store.refresh(ids);
    if (frozen || disposed) return;
    lastRefresh = now();
    ensureSentences();
    // A rejected data token means the session is over for this device; a refused
    // Access check needs the protected entrance again. Both get a visible way out.
    const messages = Object.values(store.snapshot().errors).filter((m): m is string => typeof m === 'string');
    if (messages.some((m) => / 401\b/.test(m))) { freeze(); return; }
    error = messages.some((m) => / 403\b/.test(m)) ? 'access' : error === 'access' ? null : error;
    paintShell();
  }

  /** The clock decides, not the socket: a phone whose socket died still freezes on time. */
  function expiredByClock(): boolean {
    return session.snapshot().expiresAt !== null && session.secondsLeft() === 0;
  }

  /** The transit lane: aligned to the twin's own tick (motion/loop.ts) and
   *  re-armed after each refresh; not armed at all on a screen without transit. */
  function armPoll(): void {
    if (frozen || disposed || timer !== null) return;
    const anchor = pollAnchor();
    if (!anchor && !activeModules().includes('zet-rt')) return;
    timer = setTimer(() => {
      clearTimer(timer);
      timer = null;
      if (expiredByClock()) { freeze(); return; }
      continuePoll(refresh('transit'), armPoll, 'dashboard transit refresh');
    }, nextPollDelay(anchor?.sourceUpdatedAt, now(), anchor?.validUntil));
  }

  /** The lane for everything else, on the cadence those modules always had. */
  function armSlowPoll(): void {
    if (frozen || disposed || slowTimer !== null) return;
    slowTimer = setTimer(() => {
      clearTimer(slowTimer);
      slowTimer = null;
      if (expiredByClock()) { freeze(); return; }
      continuePoll(refresh('rest'), armSlowPoll, 'dashboard refresh');
    }, SLOW_POLL_MS);
  }

  function stopPolls(): void {
    if (timer !== null) { clearTimer(timer); timer = null; }
    if (slowTimer !== null) { clearTimer(slowTimer); slowTimer = null; }
  }

  function rearmPoll(): void {
    stopPolls();
    armPoll();
    armSlowPoll();
  }

  /**
   * 60 s politely, 20 s assertively: the room's own two marks, promised by the
   * accessibility statement. Each also becomes the in-flow notice (the 60 s one
   * until the 20 s mark, the 20 s one until the freeze). Runs inside paintShell,
   * so it only sets state; the caller's paint shows it.
   */
  function announce(secondsLeft: number): void {
    if (secondsLeft <= 20) {
      if (warned20) return;
      warned20 = true;
      const text = i18n.t('session.expiring20');
      assertive.textContent = text;
      notice = { kind: 'expiring20', text, until: null };
      return;
    }
    if (warned60) return;
    warned60 = true;
    const text = i18n.t('session.expiring60');
    polite.textContent = text;
    notice = { kind: 'expiring60', text, until: null };
  }

  // --- share the city: one hop, the room mints, this only rotates ----------
  let shareDialog: DialogHandle | null = null;
  let shareRotation: Rotation | null = null;
  /** The 1 s tick that moves the rotation bar while the dialog is open. */
  let shareTick: unknown = null;
  let stopShareCount: (() => void) | null = null;

  function closeShare(): void {
    shareRotation?.stop();
    shareRotation = null;
    if (shareTick !== null) { clearTimer(shareTick); shareTick = null; }
    stopShareCount?.();
    stopShareCount = null;
    shareDialog?.close();
    shareDialog?.destroy();
    shareDialog = null;
  }

  /** The bare code, as it is typed; the export path's attribution block has no place after a pairing code. */
  async function copyCode(code: string): Promise<boolean> {
    const clipboard = globalThis.navigator?.clipboard;
    if (!clipboard) return false;
    try { await clipboard.writeText(code); return true; } catch { return false; }
  }

  function openShare(batch: CodeSlot[], serverNow: number): void {
    closeShare();
    // The sentence names the host this page is served from; the QR carries the canonical one.
    const host = doc.location?.host || new URL(CODE_URL_BASE).host;
    const body = createElementFromHTML(`<div class="share-body">
<div class="share-qr" data-share="qr"></div>
<p class="share-code tabular" data-testid="share-code" data-share="code"></p>
<div class="share-progress" aria-hidden="true"><div class="share-progress-fill" data-share="fill"></div></div>
<p class="share-rotates tabular" data-share="rotates"></p>
<p class="share-text">${escapeHtml(i18n.t('session.shareBody', { host }))}</p>
<p class="share-read" data-share="read"></p>
<button type="button" class="btn-ghost share-copy" data-action="copy-share-code">${iconMarkup('copy')}<span>${escapeHtml(i18n.t('session.shareCopy'))}</span></button>
<div class="share-status" role="status" data-testid="share-status" data-share="status"></div>
</div>`);
    const part = (name: string): HTMLElement => body.querySelector<HTMLElement>(`[data-share=${name}]`)!;
    const qrBox = part('qr');
    const codeLine = part('code');
    const fill = part('fill');
    const rotates = part('rotates');
    const read = part('read');
    const status = part('status');
    // One live region, in the tree and empty from the start (a region that appears together with its
    // text is not announced); each kind of news gets one line, re-said in place rather than repeated.
    const say = (kind: 'copied' | 'joined', text: string): void => {
      let line = status.querySelector<HTMLElement>(`[data-share-line=${kind}]`);
      if (!line) { line = doc.createElement('p'); line.dataset.shareLine = kind; status.appendChild(line); }
      line.textContent = text;
    };
    // The bar fills over the slot and the sentence counts down to the next code, on the server's clock.
    // A new code puts the bar back to zero in one step, never as a one-second drain: the CSS transition
    // is switched off, the zero is committed by a forced style read, and the transition returns for the
    // next tick (two timers landing in one frame cannot undo that, unlike a flag the tick clears).
    const paintProgress = (fresh = false): void => {
      const slot = shareRotation?.current();
      if (!slot || !shareRotation) return;
      const at = shareRotation.serverNow();
      const transform = `scaleX(${Math.round(slotProgress(slot, at) * 1000) / 1000})`;
      if (fresh) { fill.style.transition = 'none'; fill.style.transform = transform; void fill.offsetWidth; fill.style.transition = ''; }
      else fill.style.transform = transform;
      rotates.textContent = i18n.t('session.shareRotates', { seconds: Math.max(0, Math.ceil((slot.slotEnd - at) / 1000)) });
    };
    // The dialog lives in the top layer outside the shell root, so its one action is handled here.
    body.addEventListener('click', (event) => {
      if (!(event.target as Element | null)?.closest('[data-action=copy-share-code]')) return;
      const code = shareRotation?.current()?.code;
      if (!code) return;
      void copyCode(formatCode(code)).then((ok) => say('copied', i18n.t(ok ? 'session.shareCopied' : 'export.copyFailed')));
    });
    shareDialog = createDialog({ titleId: 'share-title', title: i18n.t('session.shareTitle'), closeLabel: i18n.t('common.close'), body, className: 'dialog-share dialog-sheet' });
    shareDialog.element.dataset.testid = 'share-dialog';
    shareDialog.open();
    const participantsAtOpen = session.snapshot().participants;
    stopShareCount = session.onCount((count) => { if (count > participantsAtOpen) say('joined', i18n.t('session.sharePeerJoined')); });
    shareRotation = createRotation({
      now,
      onSlot: (slot) => {
        if (!slot) { closeShare(); return; }
        codeLine.textContent = formatCode(slot.code);
        read.textContent = i18n.t('session.shareReadAloud', { spelled: speakableCode(slot.code) });
        qrBox.replaceChildren(createQr({ payload: codeUrl(slot.code), ariaLabel: i18n.t('kiosk.invite.qrLabel', { code: speakableCode(slot.code) }), unavailableText: formatCode(slot.code) }).element);
        paintProgress(true);
      },
      onMore: () => {},
      setInterval: setTimer as (fn: () => void, ms: number) => unknown,
      clearInterval: clearTimer,
    });
    shareRotation.setBatch(batch, serverNow);
    shareTick = setTimer(() => paintProgress(), 1_000);
  }

  /**
   * The end of the ten minutes [O-59], [O-62] (WP4 step 11): the content clears and the workspace
   * holds the invitation to scan again and the way to /hitno (chrome.ts sessionEndedMarkup). Every
   * refresh stops (no /api/data after this), the maps are released, the sheets close; only the
   * shell's pill, the disabled tabs and the safety control remain of the session.
   */
  function freeze(): void {
    if (frozen) return;
    frozen = true;
    cityStore.pause();
    // The session's clock, not the phone's, and never later than the session's end (a phone that hears
    // of the end late still ends at the minute the pill promised). Revoked keeps the moment itself.
    frozenAt = Math.min(session.serverNow(), session.snapshot().expiresAt ?? Infinity);
    closeShare();
    sheet.close();
    notifySheet.close();
    presentationOpen = false;
    presentationConfirmRevision = null;
    store.pause(true);
    stopPolls();
    if (tickTimer !== null) { clearTimer(tickTimer); tickTimer = null; }
    // The closing card (role=alert) takes over from the notice and the assertive region.
    notice = null;
    assertive.textContent = '';
    // The page's map view and the directory end with the content.
    directory = false;
    mapFull = false;
    element.dataset.view = 'layers';
    element.dataset.stage = '';
    paintShell();
    renderEnded();
    // The workspaces are gone from the document: their controllers and every map slot go with them.
    workspaceDisposals.forEach((fn) => fn());
    workspaceDisposals.clear();
    maps.sweep();
    maps.pause();
    updateTitle();
  }
  // --- session -------------------------------------------------------------
  session.onJoined((snapshot) => {
    void cityStore.start();
    presentationState = snapshot.presentation;
    reconnecting = false;
    error = null;
    totalSeconds ??= snapshot.expiresAt ? Math.max(1, session.secondsLeft()) : null;
    const time = zagrebTime(snapshot.expiresAt ?? now());
    polite.textContent = i18n.t('session.unlockedAnnounce', { time });
    // No in-flow notice for the unlock (kajimafix 01.1): the pill shows the expiry and the polite region has said it;
    // the banners row is for the session's own troubles (frozen, reconnecting, sources down) and the two expiry marks.
    paintShell();
    render();
    if (!joinedOnce) { joinedOnce = true; titleEl.focus(); }
    continuePoll(refresh(), rearmPoll, 'dashboard join refresh');
  });
  session.onExpiring((secondsLeft) => { announce(secondsLeft); paintShell(); });
  session.onCount(() => paintShell());
  session.onExpired(freeze);
  session.onClose(() => {
    if (frozen || disposed) return;
    if (session.snapshot().phase === 'connecting') { reconnecting = true; paintShell(); }
  });
  session.onError((code, reason) => {
    if (code === 'share-not-allowed' || code === 'share-unavailable') {
      if (code === 'share-not-allowed') shareDenied = true;
      const text = i18n.t(code === 'share-not-allowed' ? 'session.shareUnavailable' : 'session.shareTooLate');
      assertive.textContent = text;
      setNotice('refusal', text, 8_000);
      return;
    }
    if (code === 'no-ticket') {
      // A room closed under a live session (the screen switched off) ends this session too: the
      // view freezes behind the revoked card. A spent ticket only needs a fresh scan; a view that
      // never joined has nothing to freeze, whatever the reason says.
      if (reason === 'revoked' && joinedOnce) { error = 'revoked'; freeze(); return; }
      error = 'no-ticket';
      reconnecting = false;
      store.pause(true);
      maps.pause();
      closeShare();
      stopPolls();
      paintShell();
    }
  });
  session.onCodes((batch, serverNow) => openShare(batch, serverNow));
  session.onPresentation?.((state) => {
    if (disposed || (presentationState && state.revision < presentationState.revision)) return;
    const previous = presentationState;
    if (state.status === 'pending' && (previous?.revision !== state.revision || previous?.status !== 'pending')) presentationPendingSince = now();
    if (state.owner !== 'self' || state.status !== 'displayed') presentationMessage = '';
    if (state.owner === 'self' && state.status === 'displayed' && (previous?.status !== 'displayed' || previous?.owner !== 'self')) {
      presentationMessage = i18n.t('presentation.displayed');
      polite.textContent = presentationMessage;
    }
    if (state.status === 'unavailable' && previous?.status !== 'unavailable') {
      polite.textContent = i18n.t('presentation.unavailable');
    }
    presentationState = state;
    if (presentationRequest && state.revision > presentationRequest.expectedRevision) {
      if (state.status === 'displayed' && state.owner === 'self') {
        presentationMessage = i18n.t('presentation.displayed');
        polite.textContent = presentationMessage;
        presentationRequest = null;
      } else if (state.status === 'unavailable') {
        presentationMessage = i18n.t('presentation.unavailable');
        presentationRequest = null;
      } else if (state.owner !== 'self') {
        presentationRequest = null;
        presentationMessage = i18n.t(state.target ? 'presentation.changed' : 'presentation.overview');
      }
    }
    paintPresentation(); paintShell();
  });
  session.onPresentationResult?.((result) => {
    if (disposed || result.requestId !== presentationRequest?.requestId) return;
    if (result.error) {
      const key = { unavailable: 'offline', unsupported: 'unsupported', 'not-allowed': 'notAllowed', changed: 'changed', occupied: 'other', 'invalid-request': 'changed', 'too-many-requests': 'tooMany' }[result.error];
      presentationMessage = i18n.t(`presentation.${key}`);
      presentationRequest = null;
    } else if (result.state.target === null) {
      presentationRequest = null;
      presentationMessage = i18n.t('presentation.overview');
    }
    paintPresentation();
  });

  // --- delegated interactions: stable roots, no closures on discarded nodes --
  element.addEventListener('click', (event) => {
    const target = (event.target as Element | null)?.closest<HTMLElement>('[data-action]');
    if (!target || !element.contains(target)) return;
    const d = target.dataset;
    switch (d.action) {
      case 'section-jump':
        if(d.id){const heading=doc.getElementById(d.id)?.querySelector<HTMLElement>('h2,h3');if(heading){heading.tabIndex=-1;heading.focus();heading.scrollIntoView?.({block:'start'});}}
        return;
      case 'saved-remove':
        if(!frozen&&d.id&&(d.kind==='place'||d.kind==='stop'||d.kind==='route'))saved.remove({kind:d.kind,id:d.id});
        return;
      case 'city-save':
        if(!frozen&&d.id)saved.toggle({kind:'place',id:d.id});return;
      case 'city-copy': {
        const city=cityStore.snapshot(),p=[...city.places,...dynamicPlaces(city,frozenAt??now())].find(p=>p.id===d.id);
        const say=(word:'copied'|'copyFailed')=>{
          if(disposed||!element.contains(target))return;
          let status=target.parentElement?.querySelector<HTMLElement>('[data-copy-status]');
          if(!status){status=document.createElement('p');status.dataset.copyStatus='';status.setAttribute('role','status');status.className='city-meta';target.parentElement?.append(status);}
          status.textContent=ct(i18n,word);
        };
        const source=city.manifest?.sources.find(s=>s.id===p?.sourceId)??city.live?.sources.find(s=>s.id===p?.sourceId);
        if(p&&navigator.clipboard)void navigator.clipboard.writeText([p.name,p.address,p.description,source?.name,source?.url,source?.licence,p.updatedAt].filter(Boolean).join('\n')).then(()=>say('copied'),()=>say('copyFailed'));
        else say('copyFailed');
        return;
      }
      case 'nav': {
        event.preventDefault();
        let selection: PublicSelection | null = null;
        if (d.selection) { try { selection = parseSelection(JSON.parse(d.selection)); } catch { selection = null; } }
        if (d.layer) navigate(d.layer as LayerId, selection, true);
        return;
      }
      case 'directory': toggleDirectory(); return;
      case 'presentation': cast(); return;
      case 'presentation-close': presentationOpen = false; presentationConfirmRevision = null; paintPresentation(); paintShell(); return;
      case 'present-request': present('present'); return;
      case 'present-confirm': present('present', true); return;
      case 'present-cancel': presentationConfirmRevision = null; paintPresentation(); return;
      case 'present-stop': present('stop'); return;
      case 'present-retry':
        if (presentationRequest && castState().can) { presentationRequestAt = now(); presentationMessage = ''; session.present?.(presentationRequest); paintPresentation(); }
        else if (presentationState?.owner === 'self' && presentationState.target) present('present', false, presentationState.target);
        return;
      case 'save': case 'unsave': {
        if (!d.kind || !d.id) return;
        const ref = { kind: d.kind as SavedKind, id: d.id };
        if (d.action === 'save') saved.add(ref); else saved.remove(ref);
        return;
      }
      case 'notify': notifySheet.open(); return;
      case 'select':
        if (d.module) navigate(view.snapshot().layer, { kind: 'item', id: publicItemKey(d.module as ModuleId, d.itemId ?? ''), module: d.module as ModuleId }, true);
        return;
      case 'back': navigate(view.snapshot().layer, null, true); return;
      case 'filter': view.setFilter(d.filterKey ?? '', d.filterValue ?? ''); return;
      case 'retry': if (d.module) void store.refresh([d.module as ModuleId]); return;
      case 'export': if (d.kind && d.module) deps.onExport?.(d.kind as ExportKind, d.module as ModuleId); return;
      case 'copy-item': case 'share-item': case 'ics-item': case 'print-item': {
        const found = d.module ? findItem(d.module as ModuleId, d.itemId ?? '') : null;
        if (!found) return;
        if (d.action === 'copy-item') deps.onItemCopy?.(found.item, found.snapshot);
        else if (d.action === 'share-item') deps.onItemShare?.(found.item, found.snapshot);
        else deps.onItemExport?.(d.action === 'ics-item' ? 'ics' : 'print', found.item, found.snapshot);
        return;
      }
      case 'session': sheet.open(); return;
      case 'share-city': session.share(); return;
      case 'resume': setPaused(false); return;
      case 'dismiss-notice': notice = null; paintShell(); return;
      case 'map-full': setMapView(!mapFull); return;
      default: return;
    }
  });
  element.addEventListener('input', (event) => {
    const input = event.target;
    if (input instanceof HTMLInputElement && input.dataset.filterKey) view.setFilter(input.dataset.filterKey, input.value);
  });
  element.addEventListener('change', (event) => {
    const select = event.target;
    if (select instanceof HTMLSelectElement && select.dataset.filterKey) view.setFilter(select.dataset.filterKey, select.value);
  });
  element.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !mapFull) return;
    event.preventDefault();
    setMapView(false);
  });
  // Input modality: a pointer tap never paints a keyboard focus ring around
  // the heading focus moves to; keyboard users keep every ring, and readers
  // still get the focus relocation.
  element.addEventListener('pointerdown', () => { element.dataset.modality = 'pointer'; }, true);
  element.addEventListener('keydown', (event) => {
    if (!['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) element.dataset.modality = 'keyboard';
  }, true);

  // --- subscriptions and start ---------------------------------------------
  const stopView = view.subscribe(() => { render(); paintShell(); });
  const stopCity = cityStore.subscribe(() => { if(!disposed&&!frozen){render();paintShell();} });
  // A batch can finish several modules in the same turn. Render the latest
  // combined state once, without delaying independent slow-source responses.
  let feedRenderQueued = false;
  const stopStore = store.subscribe(() => {
    if (feedRenderQueued || frozen || disposed) return;
    feedRenderQueued = true;
    queueMicrotask(() => {
      feedRenderQueued = false;
      if (frozen || disposed) return;
      render();
      paintShell();
    });
  });
  const stopTheme = deps.theme?.onChange(() => { if (!disposed) render(); });
  // The reader's stores: a saved change repaints the layer and, at the desk, refreshes its modules; a switch repaints the shell.
  const stopSaved = onChange(saved.subscribe, () => {
    render();
    if (surface() === 'desktop') continuePoll(refresh(), rearmPoll, 'dashboard saved refresh');
  });
  const stopNotify = onChange(notifyStore.subscribe, () => { render(); paintShell(); });
  const stopMapMode = onChange(mapMode.subscribe, () => { if (!disposed) render(); });
  const stopLineFocus = onChange(lineFocus.subscribe, () => { if (!disposed) render(); });
  const onMedia = (): void => {
    paintShell();
    render();
  };
  media?.addEventListener?.('change', onMedia);
  function restoreView(hash: string): void {
    if (frozen || disposed) return;
    const previous = view.snapshot().layer;
    directory = false;
    view.restore(hash);
    const restored = view.snapshot();
    if (restored.layer !== 'u-pokretu' && mapFull) setMapView(false);
    updateTitle();
    paintShell();
    if (restored.layer !== previous) continuePoll(refresh(), rearmPoll, 'dashboard history refresh');
  }
  const onPopState = (): void => { if (deps.location) restoreView(deps.location.hash); };
  const win = globalThis as unknown as { addEventListener?: Window['addEventListener']; removeEventListener?: Window['removeEventListener'] };
  if (deps.history && deps.location) win.addEventListener?.('popstate', onPopState);
  updateTitle();
  paintShell();
  // Sada's selection and sentence chunk is asked for at once, so it is in flight before the first draw (a phone
  // opening on Karta needs it for the sheet too); the page repaints when it lands (city/feed.ts) and, once joined,
  // asks for its first sentences.
  void loadSadaFeed().then((module) => {
    if (!module || disposed || frozen) return;
    render();
    ensureSentences();
  });
  // The network's tram lines measure the circle along the lines; the map loads the same artefact once.
  void loadNetworkOnce().then((network) => {
    if (disposed || !network) return;
    frameLines = frameLinesOf(network);
    if (!frozen) render();
  });
  armPoll();
  armSlowPoll();
  tickTimer = setTimer(() => {
    if (expiredByClock()) { freeze(); return; }
    if (notice && notice.until !== null && now() >= notice.until) notice = null;
    tickTimebandClock(main, now());
    paintShell();
    if (presentationOpen) paintPresentation();
  }, TICK_MS);

  return {
    element,
    selectLayer: (layer) => navigate(layer, null, false),
    activeLayer: () => view.snapshot().layer,
    restore: restoreView,
    destroy() {
      workspaceDisposals.forEach(fn=>fn());workspaceDisposals.clear();
      cityStore.destroy();
      disposed = true;
      stopPolls();
      if (tickTimer !== null) { clearTimer(tickTimer); tickTimer = null; }
        stopView();
      stopCity();
      stopStore();
      stopTheme?.();
      stopSaved();
      stopNotify();
      stopMapMode();
      stopLineFocus();
      media?.removeEventListener?.('change', onMedia);
      win.removeEventListener?.('popstate', onPopState);
      closeShare();
      sheet.destroy();
      notifySheet.destroy();
      maps.destroy();
      boards.destroy();
      store.destroy();
      element.remove();
    },
  };
}
