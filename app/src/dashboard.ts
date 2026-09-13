// The /d/ surface: one stable shell (wordmark, session, safety shortcut,
// sidebar or tab bar, banners) around one active workspace. Real session,
// real feeds through the core stores, keyed reconciliation of the workspace
// so a poll never disturbs focus, typed text, scroll or a live map. Every
// browser global is injected, so the behaviour is unit-tested under happy-dom.
import type { Attribution, FeedItem, ModuleId, ModuleSnapshot } from '../../worker/feed/schema';
import { LAYERS, type CodeSlot, type LayerId } from '../../worker/protocol';
import { codeUrl, formatCode, speakableCode } from './code';
import { zagrebTime } from './format';
import { parseSelection, publicItemKey, selectionParams, type PublicSelection, type ScreenContext } from './core/contracts';
import { createFeedStore } from './core/feed-store';
import { createViewStore } from './core/view-store';
import { bannersMarkup, MORE_LAYERS, safetyMarkup, sessionMarkup, sidebarMarkup, tabbarMarkup, wordmarkMarkup, type ShellState } from './experience/chrome';
import { DIRECTORY_MODULES, renderDirectory } from './experience/directory';
import { createSessionSheet, type SheetAction } from './experience/session-sheet';
import { storeLocale } from './i18n/create-default-i18n';
import type { I18n, LocaleCode } from './i18n/i18n';
import { LAYER_MODULES, renderLayer } from './layers';
import type { ExportKind, LayerContext } from './layers/types';
import { withNetwork, withTimers, type MapFactory } from './map/city-map';
import { createMapSlots } from './map/map-slots';
import { continuePoll, nextPollDelay } from './motion/loop';
import { loadNetwork, type Network } from './motion/network';
import { createSchematicHost } from './motion/schematic-host';
import { createRotation, type Rotation } from './rotation';
import type { SessionClient } from './session';
import { createDialog, type DialogHandle } from './ui/dialog';
import { createElementFromHTML, escapeAttribute } from './ui/dom/escape';
import { reconcile, reconcileChildren } from './ui/dom/reconcile';
import { createQr } from './ui/qr';
import type { ThemeController, ThemePreference } from './ui/theme';

/** The per-second tick for the remaining time; the poll has its own aligned timer. */
const TICK_MS = 1_000;

/** The layer last opened, mirrored so the next scan reopens it (R-60). */
export const LAYER_STORAGE_KEY = 'vidikovac.layer';

/** Layers whose renderers declare interactions as data-action and are safe to reconcile in place. */
const RECONCILED_LAYERS: ReadonlySet<LayerId> = new Set<LayerId>(['grad-sada', 'zrak-i-nebo', 'sigurnost', 'uprava-i-pravo', 'kultura', 'vijesti']);

function safeSessionStorage(): Pick<Storage, 'getItem' | 'setItem'> | undefined {
  try { return globalThis.sessionStorage; } catch { return undefined; }
}

function readStoredLayer(storage: Pick<Storage, 'getItem'> | undefined): LayerId | null {
  try {
    const stored = storage?.getItem(LAYER_STORAGE_KEY);
    return stored && (LAYERS as readonly string[]).includes(stored) ? (stored as LayerId) : null;
  } catch { return null; }
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
  onRepaint?: (listener: () => void) => () => void;
  mapFactory?: MapFactory;
  loadNetwork?: () => Promise<Network | null>;
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
  const { i18n, session } = deps;
  const now = deps.now ?? (() => Date.now());
  const setTimer = deps.setInterval ?? ((fn, ms) => globalThis.setInterval(fn, ms));
  const clearTimer = deps.clearInterval ?? ((h) => globalThis.clearInterval(h as never));
  const lightweight = Boolean(deps.lightweight);
  const storage = deps.storage === undefined ? safeSessionStorage() : deps.storage ?? undefined;
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
  let networkPromise: Promise<Network | null> | null = null;
  const loadNetworkOnce = (): Promise<Network | null> => {
    networkPromise ??= (deps.loadNetwork ?? (() => loadNetwork(fetch, lightweight)))();
    return networkPromise;
  };
  const maps = createMapSlots(
    lightweight ? undefined : withTimers(withNetwork(deps.mapFactory, loadNetworkOnce), setTimer as (fn: () => void, ms: number) => unknown, clearTimer),
  );
  const schematic = createSchematicHost({
    i18n, scope: { kind: 'network' }, lightweight, reducedMotion: deps.reducedMotion, now, onRepaint: deps.onRepaint, loadNetwork: loadNetworkOnce,
  });
  const media = deps.matchMedia?.('(min-width: 60rem)') ?? (globalThis.matchMedia ? globalThis.matchMedia('(min-width: 60rem)') : null);
  const surface = (): ScreenContext['surface'] => (media ? media.matches : Boolean(deps.wide)) ? 'desktop' : 'phone';

  let frozen = false;
  let paused = false;
  let countdownHidden = false;
  let directory = false;
  let mapFull = false;
  let reconnecting = false;
  let error: string | null = null;
  let lastRefresh: number | null = null;
  let totalSeconds: number | null = null;
  let warned60 = false;
  let warned20 = false;
  let timer: unknown = null;
  let tickTimer: unknown = null;
  let disposed = false;
  let shareDenied = false;
  let joinedOnce = false;

  // --- stable shell --------------------------------------------------------
  const element = createElementFromHTML(`<div class="ki" data-testid="dash" data-surface="${surface()}" data-view="layers" data-state="connecting">
<h1 class="visually-hidden" data-testid="dash-title" tabindex="-1"></h1>
<p class="visually-hidden" role="status" aria-live="polite" data-testid="announce-polite"></p>
<p class="ki-alert" role="alert" aria-live="assertive" data-testid="announce-assertive"></p>
<div class="ki-top" data-region="top"></div>
<div class="ki-session-slot" data-region="session"></div>
<div class="ki-safety-slot" data-region="safety"></div>
<nav class="ki-side" data-region="side" aria-label="${escapeAttribute(i18n.t('nav.label'))}"></nav>
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
  const regions = { top: region('top'), session: region('session'), safety: region('safety'), side: region('side'), banners: region('banners'), tabs: region('tabs') };

  function shellState(): ShellState {
    const s = session.snapshot();
    return {
      layer: view.snapshot().layer, directory, phase: s.phase, frozen, reconnecting,
      secondsLeft: frozen ? 0 : session.secondsLeft(), totalSeconds, expiresAt: s.expiresAt, countdownHidden, paused,
      loading: store.snapshot().loading.size > 0, canShare: s.role === 'scanner' && !frozen && s.phase === 'live' && !shareDenied,
      label: deps.label ?? null, role: s.role, participants: s.participants, error, lastRefresh, mapFull,
    };
  }

  function paintRegion(target: HTMLElement, markup: string): void {
    reconcileChildren(target, createElementFromHTML(`<div>${markup}</div>`));
  }

  function paintShell(): void {
    const s = shellState();
    element.dataset.surface = surface();
    element.dataset.state = frozen ? 'frozen' : reconnecting ? 'reconnecting' : s.phase;
    element.dataset.countdown = countdownHidden ? 'hidden' : 'shown';
    paintRegion(regions.top, wordmarkMarkup(i18n));
    paintRegion(regions.session, sessionMarkup(i18n, s));
    paintRegion(regions.safety, safetyMarkup(i18n, s));
    paintRegion(regions.side, sidebarMarkup(i18n, s));
    paintRegion(regions.banners, bannersMarkup(i18n, s, scanUrl));
    paintRegion(regions.tabs, tabbarMarkup(i18n, s));
    regions.side.setAttribute('aria-label', i18n.t('nav.label'));
    regions.tabs.setAttribute('aria-label', i18n.t('nav.label'));
    if (!frozen && s.expiresAt !== null && s.phase === 'live') {
      if (s.secondsLeft <= 60) announce(60);
      if (s.secondsLeft <= 20) announce(20);
    }
    sheet.refresh();
  }

  function updateTitle(): void {
    const layerName = directory ? i18n.t('nav.moreTitle') : i18n.t(`layers.${view.snapshot().layer}`);
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
    return {
      i18n, snapshots: feed.snapshots, now: now(), errors: feed.errors, view: view.snapshot(), screen: screen(),
      onCopy: deps.onCopy, onShare: deps.onShare, onExport: deps.onExport,
      onItemCopy: deps.onItemCopy, onItemShare: deps.onItemShare, onItemExport: deps.onItemExport,
      navigate: navigateAction, setFilter: setFilterAction, onRetry: retryAction,
      maps, schematic, mapView: lightweight ? undefined : mapView, reducedMotion: deps.reducedMotion, lightweight,
    };
  }

  /** Draws the active workspace: reconciled in place for delegated renderers, replaced for the rest. */
  function render(): void {
    // A renderer may move a controller's live node while producing its tree.
    // Capture focus before calling it, not after that move has blurred it.
    const focused = doc.activeElement instanceof HTMLElement ? doc.activeElement : null;
    const focusedId = focused?.id;
    const caret = focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement
      ? { start: focused.selectionStart, end: focused.selectionEnd, direction: focused.selectionDirection }
      : null;
    const ctx = layerContext();
    const layer = view.snapshot().layer;
    const next = directory ? renderDirectory(ctx) : renderLayer(layer, ctx);
    if (directory || RECONCILED_LAYERS.has(layer) || next.hasAttribute('data-reconcile')) {
      const wrapper = doc.createElement('div');
      wrapper.appendChild(next);
      reconcile(main, wrapper);
    } else {
      main.replaceChildren(next);
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
    if (frozen) maps.pause();
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

  function activeModules(): readonly ModuleId[] {
    return directory ? DIRECTORY_MODULES : LAYER_MODULES[view.snapshot().layer];
  }

  function navigate(layer: LayerId, selection: PublicSelection | null, fromUser: boolean): void {
    if (frozen) return;
    const previous = view.snapshot().layer;
    const wasDirectory = directory;
    directory = false;
    if (layer !== 'u-pokretu' && mapFull) { mapFull = false; element.dataset.view = 'layers'; }
    // One history entry per distinct place: repeating the same selection replaces instead of pushing.
    const same = layer === previous && JSON.stringify(selection) === JSON.stringify(view.snapshot().selection);
    view.navigate(layer, selection, !fromUser || same);
    updateTitle();
    paintShell();
    if (!fromUser) return;
    session.sendView(layer, selectionParams(selection));
    if (layer !== previous || wasDirectory) {
      session.event('panel_open', layer);
      focusWorkspace(layer);
      continuePoll(refresh(), rearmPoll, 'dashboard layer refresh');
    } else if (selection) {
      doc.getElementById('ws-detail-title')?.focus();
      if (surface() === 'phone' && typeof globalThis.scrollTo === 'function') globalThis.scrollTo({ top: 0 });
    } else {
      focusWorkspace(layer);
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

  function findItem(module: ModuleId, id: string): { item: FeedItem; snapshot: ModuleSnapshot } | null {
    const snapshot = store.snapshot().snapshots[module];
    const item = snapshot?.items.find((candidate) => candidate.id === id);
    return snapshot && item ? { item, snapshot } : null;
  }

  const sheet = createSessionSheet({
    i18n, scanUrl,
    state: () => ({
      session: session.snapshot(), frozen, paused, countdownHidden, canShare: session.snapshot().role === 'scanner' && !shareDenied,
      label: deps.label ?? null, themePreference: deps.theme?.getPreference() ?? null, lastRefresh,
    }),
    onAction: (action, value) => handleSheetAction(action, value),
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
  function pollAnchor(): string | undefined {
    return activeModules().includes('zet-rt') ? store.snapshot().snapshots['zet-rt']?.sourceUpdatedAt : undefined;
  }

  async function refresh(): Promise<void> {
    if (frozen || paused || disposed || !session.snapshot().dataToken) return;
    store.setModules(activeModules());
    await store.refresh();
    if (frozen || disposed) return;
    lastRefresh = now();
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

  /** The poll, aligned to the feed's own tick (motion/loop.ts) and re-armed after each refresh. */
  function armPoll(): void {
    if (frozen || disposed || timer !== null) return;
    timer = setTimer(() => {
      clearTimer(timer);
      timer = null;
      if (expiredByClock()) { freeze(); return; }
      continuePoll(refresh(), armPoll, 'dashboard refresh');
    }, nextPollDelay(pollAnchor(), now()));
  }

  function rearmPoll(): void {
    if (timer !== null) { clearTimer(timer); timer = null; }
    armPoll();
  }

  /** 60 s politely, 20 s assertively: the room's own two marks, promised by the accessibility statement. */
  function announce(secondsLeft: number): void {
    if (secondsLeft <= 20) {
      if (warned20) return;
      warned20 = true;
      assertive.textContent = i18n.t('session.expiring20');
      return;
    }
    if (warned60) return;
    warned60 = true;
    polite.textContent = i18n.t('session.expiring60');
  }

  // --- share the city: one hop, the room mints, this only rotates ----------
  let shareDialog: DialogHandle | null = null;
  let shareRotation: Rotation | null = null;

  function closeShare(): void {
    shareRotation?.stop();
    shareRotation = null;
    shareDialog?.close();
    shareDialog?.destroy();
    shareDialog = null;
  }

  function openShare(batch: CodeSlot[], serverNow: number): void {
    closeShare();
    const body = doc.createElement('div');
    body.className = 'share-body';
    const qrBox = doc.createElement('div');
    qrBox.className = 'share-qr';
    const codeLine = doc.createElement('p');
    codeLine.className = 'share-code';
    codeLine.dataset.testid = 'share-code';
    const copy = doc.createElement('p');
    copy.className = 'meta';
    copy.textContent = i18n.t('session.shareBody');
    body.appendChild(qrBox);
    body.appendChild(codeLine);
    body.appendChild(copy);
    shareDialog = createDialog({ titleId: 'share-title', title: i18n.t('session.shareTitle'), closeLabel: i18n.t('common.close'), body, className: 'dialog-share' });
    shareDialog.element.dataset.testid = 'share-dialog';
    shareDialog.open();
    shareRotation = createRotation({
      now,
      onSlot: (slot) => {
        if (!slot) { closeShare(); return; }
        codeLine.textContent = formatCode(slot.code);
        qrBox.replaceChildren(createQr({ payload: codeUrl(slot.code), ariaLabel: i18n.t('kiosk.qrLabel', { code: speakableCode(slot.code) }), unavailableText: formatCode(slot.code) }).element);
      },
      onMore: () => {},
      setInterval: setTimer as (fn: () => void, ms: number) => unknown,
      clearInterval: clearTimer,
    });
    shareRotation.setBatch(batch, serverNow);
  }

  /** The end of the session: the view stays, refreshing stops, exports keep working. */
  function freeze(): void {
    if (frozen) return;
    frozen = true;
    closeShare();
    sheet.close();
    schematic.pause();
    maps.pause();
    store.pause(true);
    if (timer !== null) { clearTimer(timer); timer = null; }
    if (tickTimer !== null) { clearTimer(tickTimer); tickTimer = null; }
    paintShell();
  }
  // --- session -------------------------------------------------------------
  session.onJoined((snapshot) => {
    reconnecting = false;
    error = null;
    totalSeconds ??= snapshot.expiresAt ? Math.max(1, session.secondsLeft()) : null;
    polite.textContent = i18n.t('session.unlockedAnnounce', { time: zagrebTime(snapshot.expiresAt ?? now()) });
    paintShell();
    render();
    if (!joinedOnce) { joinedOnce = true; titleEl.focus(); }
    continuePoll(refresh(), rearmPoll, 'dashboard join refresh');
  });
  session.onExpiring((secondsLeft) => announce(secondsLeft));
  session.onCount(() => paintShell());
  session.onExpired(freeze);
  session.onClose(() => {
    if (frozen || disposed) return;
    if (session.snapshot().phase === 'connecting') { reconnecting = true; paintShell(); }
  });
  session.onError((code) => {
    if (code === 'share-not-allowed' || code === 'share-unavailable') {
      if (code === 'share-not-allowed') shareDenied = true;
      assertive.textContent = i18n.t(code === 'share-not-allowed' ? 'session.shareUnavailable' : 'session.shareTooLate');
      paintShell();
      return;
    }
    if (code === 'no-ticket') { error = 'no-ticket'; paintShell(); }
  });
  session.onCodes((batch, serverNow) => openShare(batch, serverNow));

  // --- delegated interactions: stable roots, no closures on discarded nodes --
  element.addEventListener('click', (event) => {
    const target = (event.target as Element | null)?.closest<HTMLElement>('[data-action]');
    if (!target || !element.contains(target)) return;
    const d = target.dataset;
    switch (d.action) {
      case 'nav': {
        event.preventDefault();
        let selection: PublicSelection | null = null;
        if (d.selection) { try { selection = parseSelection(JSON.parse(d.selection)); } catch { selection = null; } }
        if (d.layer) navigate(d.layer as LayerId, selection, true);
        return;
      }
      case 'directory': toggleDirectory(); return;
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
      case 'map-full': setMapView(!mapFull); return;
      default: return;
    }
  });
  element.addEventListener('input', (event) => {
    const input = event.target;
    if (input instanceof HTMLInputElement && input.dataset.filterKey) view.setFilter(input.dataset.filterKey, input.value);
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
  const onMedia = (): void => { paintShell(); render(); };
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
    session.sendView(restored.layer, selectionParams(restored.selection));
    if (restored.layer !== previous) continuePoll(refresh(), rearmPoll, 'dashboard history refresh');
  }
  const onPopState = (): void => { if (deps.location) restoreView(deps.location.hash); };
  const win = globalThis as unknown as { addEventListener?: Window['addEventListener']; removeEventListener?: Window['removeEventListener'] };
  if (deps.history && deps.location) win.addEventListener?.('popstate', onPopState);
  updateTitle();
  paintShell();
  armPoll();
  tickTimer = setTimer(() => {
    if (expiredByClock()) { freeze(); return; }
    paintShell();
  }, TICK_MS);

  return {
    element,
    selectLayer: (layer) => navigate(layer, null, false),
    activeLayer: () => view.snapshot().layer,
    restore: restoreView,
    destroy() {
      disposed = true;
      if (timer !== null) { clearTimer(timer); timer = null; }
      if (tickTimer !== null) { clearTimer(tickTimer); tickTimer = null; }
      stopView();
      stopStore();
      stopTheme?.();
      media?.removeEventListener?.('change', onMedia);
      win.removeEventListener?.('popstate', onPopState);
      closeShare();
      sheet.destroy();
      maps.destroy();
      schematic.destroy();
      store.destroy();
      element.remove();
    },
  };
}
