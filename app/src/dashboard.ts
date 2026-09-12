// The /d/ surface. Owns the layer switcher (a real tablist with roving
// tabindex), the session ring and countdown, the two WCAG toggles, the polling
// loop and the expiry freeze. Every browser global is injected so the whole
// behaviour is unit-tested under happy-dom.
import type { Attribution, ModuleId, ModuleSnapshot } from '../../worker/feed/schema';
import { LAYERS, type CodeSlot, type LayerId } from '../../worker/protocol';
import { codeUrl, formatCode, speakableCode } from './code';
import { countdown, zagrebTime } from './format';
import type { I18n } from './i18n/i18n';
import { ALL_LAYER_MODULES, LAYER_MODULES, renderLayer } from './layers';
import { vehicleCount } from './layers/shared';
import type { ExportKind } from './layers/types';
import { withNetwork, type MapFactory } from './map/city-map';
import { createMapSlots } from './map/map-slots';
import { loadNetwork, type Network } from './motion/network';
import { createSchematicHost } from './motion/schematic-host';
import { createRotation, type Rotation } from './rotation';
import type { SessionClient } from './session';
import { tone } from './ui/canvas';
import { createDialog, type DialogHandle } from './ui/dialog';
import { escapeHtml } from './ui/dom/escape';
import { MEANDER_STEPS, paintMeander, paintMeanderBar, quantise } from './ui/meander';
import { paintPanorama } from './ui/panorama';
import { createQr } from './ui/qr';

/** How often a visible layer refetches its modules. */
export const POLL_MS = 20_000;
/** The meander's one-second step and the fine countdown line's own tick,
 *  independent of `pollMs` (which only governs re-fetching city data) — the
 *  same constant kiosk.ts keeps for its own code meander. */
const MEANDER_TICK_MS = 1_000;

/**
 * The layer last opened by the user, mirrored into sessionStorage so the next
 * unlock (the next scan) reopens it instead of always defaulting to the first
 * tab — the accessibility statement already promises this (R-60).
 */
export const LAYER_STORAGE_KEY = 'vidikovac.layer';

function readStoredLayer(): LayerId | null {
  try {
    const stored = globalThis.sessionStorage?.getItem(LAYER_STORAGE_KEY);
    return stored && (LAYERS as readonly string[]).includes(stored) ? (stored as LayerId) : null;
  } catch {
    return null;
  }
}

function storeLayer(layer: LayerId): void {
  try {
    globalThis.sessionStorage?.setItem(LAYER_STORAGE_KEY, layer);
  } catch {
    /* ignore */
  }
}

export interface SessionHashParams {
  roomId: string;
  ticket: string | null;
  label: string | null;
}

export function parseSessionHash(hash: string): SessionHashParams | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const roomId = params.get('room');
  if (!roomId) return null;
  return { roomId, ticket: params.get('ticket'), label: params.get('label') };
}

export interface DashboardDeps {
  i18n: I18n;
  session: SessionClient;
  now?: () => number;
  fetchData?: (module: ModuleId, token: string) => Promise<ModuleSnapshot>;
  /** true = desktop grid of all seven layers; false = one layer at a time. */
  wide?: boolean;
  label?: string | null;
  reducedMotion?: boolean;
  /** R-L1: decided once at the entry and passed down, exactly like `reducedMotion`. */
  lightweight?: boolean;
  /** Re-runs the canvas repaints on theme change (fires once immediately) and
   *  on resize, coalesced onto one frame (ui/canvas.ts's `repaintOn`). Absent
   *  in tests that don't care about theme/resize repainting. */
  onRepaint?: (listener: () => void) => () => void;
  mapFactory?: MapFactory;
  /** The network artefact for the schematic (T9); defaults to
   *  motion/network.ts's loadNetwork over the page's own fetch, and is
   *  never called in lightweight mode (R-L4). Injected so tests never fetch. */
  loadNetwork?: () => Promise<Network | null>;
  onCopy?: (text: string, attribution: Attribution) => void;
  onShare?: (url: string, title: string) => void;
  onExport?: (kind: ExportKind, module: ModuleId) => void;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (handle: unknown) => void;
  pollMs?: number;
}

export interface DashboardHandle {
  element: HTMLElement;
  selectLayer(layer: LayerId): void;
  destroy(): void;
}

export function mountDashboard(root: HTMLElement, deps: DashboardDeps): DashboardHandle {
  const { i18n, session } = deps;
  const now = deps.now ?? (() => Date.now());
  const setTimer = deps.setInterval ?? ((fn, ms) => globalThis.setInterval(fn, ms));
  const clearTimer = deps.clearInterval ?? ((h) => globalThis.clearInterval(h as never));
  const pollMs = deps.pollMs ?? POLL_MS;
  const wide = deps.wide ?? false;
  const lightweight = Boolean(deps.lightweight);

  const snapshots: Partial<Record<ModuleId, ModuleSnapshot>> = {};
  // One network artefact for the page: the schematic and the full map both
  // snap to it, so it is fetched once (R-L4) -- memoised here, since
  // network.ts's loadNetwork deliberately is not. Never called in
  // lightweight mode: the schematic host does not ask, and there is no map.
  let networkPromise: Promise<Network | null> | null = null;
  const loadNetworkOnce = (): Promise<Network | null> => {
    networkPromise ??= (deps.loadNetwork ?? (() => loadNetwork(fetch, lightweight)))();
    return networkPromise;
  };
  // T10 / R-L2: the full MapLibre map is not rendered at all on the
  // lightweight path -- no factory, so no slot ever yields a container.
  const maps = createMapSlots(lightweight ? undefined : withNetwork(deps.mapFactory, loadNetworkOnce));
  // T9: one schematic for the page, handed to the U pokretu layer through
  // the context exactly like `maps`, so a poll never throws away the motion
  // model's fix history (R-P2). A session sees the whole network; the host
  // fetches the artefact lazily, on that layer's first render (R-L4).
  const schematic = createSchematicHost({
    i18n,
    scope: { kind: 'network' },
    lightweight,
    reducedMotion: deps.reducedMotion,
    now,
    onRepaint: deps.onRepaint,
    loadNetwork: loadNetworkOnce,
  });
  let active: LayerId = readStoredLayer() ?? LAYERS[0]!;
  let frozen = false;
  // T10: the full-map view mode, a CSS state on this element (data-view),
  // never the Fullscreen API -- so the header with the session meander is
  // still in the flow above the map, pinned there by construction.
  let mapFull = false;
  let paused = false;
  let countdownHidden = false;
  let warned60 = false;
  let warned20 = false;
  let timer: unknown = null;
  let meanderTimer: unknown = null;
  // Captured once, the moment a live expiry first appears (join or resume):
  // the denominator for the meander's fill fraction. The wire contract carries
  // no session-start timestamp, so a reload mid-session sees the meander start
  // full at whatever time is left then — the best any client can infer.
  let totalSeconds: number | null = null;

  // The panorama and the meander each have exactly one path, chosen here from
  // the lightweight flag, never toggled with CSS after the fact (R-L1/R-L2) —
  // the same shape as kiosk.ts's own kioskMarkup().
  const panoramaInner = lightweight
    ? `<div class="dash-panorama-rule" data-testid="panorama" role="img" aria-label=""></div>`
    : `<canvas class="dash-panorama-canvas" data-testid="panorama" role="img" aria-label=""></canvas>`;
  const meanderInner = lightweight
    ? `<div class="dash-meander-track" aria-hidden="true"><div class="dash-meander-bar" data-testid="session-ring"></div></div>`
    : `<canvas class="dash-meander-canvas" data-testid="session-ring" aria-hidden="true"></canvas>`;

  const element = document.createElement('div');
  element.className = 'dash';
  element.dataset.view = 'layers';
  element.innerHTML = `
    <figure class="dash-panorama">${panoramaInner}</figure>
    <header class="dash-head">
      <h1 class="visually-hidden" data-testid="dash-title" tabindex="-1"></h1>
      <div class="dash-head-top">
        <p class="dash-label" data-testid="session-label"></p>
        <button type="button" class="btn-ghost dash-share" data-testid="share-city" hidden>${escapeHtml(i18n.t('session.share'))}</button>
      </div>
      <div class="dash-clock">
        <time class="dash-countdown" data-testid="countdown"></time>
        <span class="dash-countdown-fine" data-testid="countdown-fine"></span>
      </div>
      <figure class="dash-meander">
        ${meanderInner}
        <figcaption class="dash-legend" data-testid="meander-legend"></figcaption>
      </figure>
      <div class="dash-toggles">
        <button type="button" class="btn-ghost" data-testid="toggle-countdown" aria-pressed="false">${escapeHtml(i18n.t('session.hideCountdown'))}</button>
        <button type="button" class="btn-ghost" data-testid="toggle-refresh" aria-pressed="false">${escapeHtml(i18n.t('session.pauseRefresh'))}</button>
        <span class="dash-refresh-state panel-sub" data-testid="refresh-state"></span>
      </div>
    </header>
    <p class="visually-hidden" role="status" aria-live="polite" data-testid="announce-polite"></p>
    <p class="dash-alert" role="alert" aria-live="assertive" data-testid="announce-assertive"></p>
    <p class="dash-frozen" role="alert" data-testid="frozen-line" hidden></p>
    <nav class="dash-tabs" role="tablist" aria-label="${escapeHtml(i18n.t('session.tabsLabel'))}"></nav>
    <div class="dash-view" data-testid="dash-view" data-wide="${wide ? 'true' : 'false'}"></div>
    <footer class="dash-foot panel-sub">${escapeHtml(i18n.t('session.openTier'))}</footer>`;
  root.appendChild(element);

  const tablist = element.querySelector<HTMLElement>('[role=tablist]')!;
  const view = element.querySelector<HTMLElement>('[data-testid=dash-view]')!;
  const polite = element.querySelector<HTMLElement>('[data-testid=announce-polite]')!;
  const assertive = element.querySelector<HTMLElement>('[data-testid=announce-assertive]')!;
  const frozenLine = element.querySelector<HTMLElement>('[data-testid=frozen-line]')!;
  const titleEl = element.querySelector<HTMLElement>('[data-testid=dash-title]')!;
  const label = element.querySelector<HTMLElement>('[data-testid=session-label]')!;
  const timeEl = element.querySelector<HTMLTimeElement>('[data-testid=countdown]')!;
  const fineEl = element.querySelector<HTMLElement>('[data-testid=countdown-fine]')!;
  const panoramaEl = element.querySelector<HTMLElement>('[data-testid=panorama]')!;
  const meanderFig = element.querySelector<HTMLElement>('.dash-meander')!;
  const meanderEl = element.querySelector<HTMLElement>('[data-testid=session-ring]')!;
  const meanderLegend = element.querySelector<HTMLElement>('[data-testid=meander-legend]')!;
  const refreshState = element.querySelector<HTMLElement>('[data-testid=refresh-state]')!;
  const countdownToggle = element.querySelector<HTMLButtonElement>('[data-testid=toggle-countdown]')!;
  const refreshToggle = element.querySelector<HTMLButtonElement>('[data-testid=toggle-refresh]')!;
  const shareButton = element.querySelector<HTMLButtonElement>('[data-testid=share-city]')!;

  const tabs = LAYERS.map((layer) => {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.role = 'tab';
    tab.id = `tab-${layer}`;
    tab.dataset.layer = layer;
    tab.textContent = i18n.t(`layers.${layer}`);
    tab.setAttribute('aria-controls', `layer-${layer}`);
    tab.addEventListener('click', () => select(layer, true));
    tablist.appendChild(tab);
    return tab;
  });

  /** /d has no visible h1 (the invitation lives on /); this hidden one names
   *  the app and the active layer so the axe sweep finds exactly one, and is
   *  where focus lands on join (R-M1). Runs wherever `active` changes. */
  function updateDocumentTitle(): void {
    titleEl.textContent = i18n.t('session.documentTitle', {
      app: i18n.t('common.appName'),
      layer: i18n.t(`layers.${active}`),
    });
  }

  function paintTabs(): void {
    for (const tab of tabs) {
      const selected = tab.dataset.layer === active;
      tab.setAttribute('aria-selected', selected ? 'true' : 'false');
      tab.tabIndex = selected ? 0 : -1;
      tab.disabled = frozen;
    }
  }

  function layerContext() {
    return {
      i18n,
      snapshots,
      now: now(),
      onCopy: deps.onCopy,
      onShare: deps.onShare,
      onExport: deps.onExport,
      maps,
      schematic,
      mapView: lightweight ? undefined : { full: mapFull, toggle: () => setMapView(!mapFull) },
      reducedMotion: deps.reducedMotion,
      lightweight,
    };
  }

  /** Enters or leaves the full-map view mode and re-renders so the button
   *  reads the state it now leads to; render() hands focus back to it. */
  function setMapView(full: boolean): void {
    if (mapFull === full) return;
    mapFull = full;
    element.dataset.view = full ? 'map' : 'layers';
    render();
  }

  /** The panorama's vehicle count comes from the zet-rt snapshot already
   *  fetched for grad-sada/u-pokretu, not a fetch of its own — repainted at
   *  the end of every render() (a fresh snapshot may have just landed) and
   *  from onRepaint (theme change, resize). A returning user can sit on a
   *  stored layer (e.g. vijesti) that never fetches zet-rt for the whole
   *  session, so "no snapshot yet" must read as unknown, not a false zero —
   *  same distinction the kiosk's own panorama makes. The canvas draw itself
   *  still falls back to zero beads for "unknown", which is visually
   *  correct either way. */
  function paintPanoramaFigure(): void {
    const count = vehicleCount(snapshots['zet-rt']);
    const alt = count === null ? i18n.t('session.panoramaAltLoading') : i18n.t('session.panoramaAlt', { count });
    panoramaEl.setAttribute('aria-label', alt);
    // R-L2: the lightweight rule carries the same label; there is nothing to
    // paint on that path.
    if (lightweight) return;
    paintPanorama(panoramaEl as HTMLCanvasElement, {
      fg: tone(panoramaEl, '--tone-text-primary', '#f2ead8'),
      count: count ?? 0,
    });
  }

  function render(): void {
    const focusId = document.activeElement instanceof HTMLElement ? document.activeElement.id : '';
    const ctx = layerContext();
    const sections = (wide ? LAYERS : [active]).map((layer) => renderLayer(layer, ctx));
    view.replaceChildren(...sections);
    // Each map panel moved its own live container into the new section; the
    // maps of a layer this render did not draw are torn down here (R-54).
    maps.sweep();
    if (focusId) document.getElementById(focusId)?.focus();
    paintPanoramaFigure();
  }

  function select(layer: LayerId, fromUser: boolean): void {
    if (frozen) return;
    active = layer;
    // Another layer has no full map to show: leave the view mode with it.
    if (layer !== 'u-pokretu' && mapFull) {
      mapFull = false;
      element.dataset.view = 'layers';
      // The narrow path re-renders just below; the wide grid would otherwise
      // keep a button still reading "Skupi kartu".
      if (wide) render();
    }
    paintTabs();
    updateDocumentTitle();
    if (!wide) render();
    const heading = document.getElementById(`layer-title-${layer}`);
    if (fromUser) {
      storeLayer(layer);
      heading?.focus();
      session.sendView(layer);
      session.event('panel_open', layer);
      void refresh();
    }
  }

  async function refresh(): Promise<void> {
    const token = session.snapshot().dataToken;
    const fetchData = deps.fetchData;
    if (!token || !fetchData || frozen || paused) return;
    const ids = wide ? ALL_LAYER_MODULES : LAYER_MODULES[active];
    const results = await Promise.allSettled(ids.map((id) => fetchData(id, token)));
    // The session may have expired while these were in flight; a frozen view
    // must not be repainted by a fetch that started before the freeze.
    if (frozen) return;
    for (const result of results) if (result.status === 'fulfilled') snapshots[result.value.module] = result.value;
    render();
  }

  function paintTimer(): void {
    const expiresAt = session.snapshot().expiresAt;
    const seconds = frozen ? 0 : session.secondsLeft();
    const minutes = Math.ceil(seconds / 60);
    timeEl.textContent = i18n.t('common.minutes', { count: minutes });
    timeEl.dateTime = `PT${seconds}S`;
    timeEl.title = countdown(seconds);
    fineEl.textContent = i18n.t('session.remainingFine', { time: countdown(seconds) });
    meanderLegend.textContent = i18n.t('session.legendMeander', { time: zagrebTime(expiresAt ?? now()) });
    const total = totalSeconds ?? Math.max(1, seconds);
    const raw = total > 0 ? seconds / total : 0;
    // Quantised under reduced motion or lightweight (R-L1/R-L2), same as the
    // kiosk's own code meander.
    const pct = deps.reducedMotion || lightweight ? quantise(raw, MEANDER_STEPS) : raw;
    if (lightweight) {
      paintMeanderBar(meanderEl, pct);
    } else {
      paintMeander(meanderEl as HTMLCanvasElement, {
        ink: tone(meanderEl, '--tone-stroke', 'rgba(242,234,216,.2)'),
        fill: tone(meanderEl, '--tone-text-primary', '#f2ead8'),
        pct,
      });
    }
    // A session with no expiry yet (still connecting) is not "about to expire";
    // only an actual live countdown may trip the warnings. 60 s and 20 s are
    // the room's own 'expiring' frames and what the accessibility statement
    // promises, so the local clock uses the same two marks (R-58).
    if (!frozen && expiresAt !== null && seconds <= 60) announce(60);
    if (!frozen && expiresAt !== null && seconds <= 20) announce(20);
  }

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

  // --- Podijeli grad ---------------------------------------------------------
  // One hop: the person who scanned the screen may hand five minutes to someone
  // beside them, and that person may not pass it on again. The room mints the
  // peer batch; this only rotates it, exactly like the screen does (R-56).
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
    const body = document.createElement('div');
    body.className = 'share-body';
    const qrBox = document.createElement('div');
    qrBox.className = 'share-qr';
    const codeLine = document.createElement('p');
    codeLine.className = 'share-code';
    codeLine.dataset.testid = 'share-code';
    const copy = document.createElement('p');
    copy.className = 'panel-sub';
    copy.textContent = i18n.t('session.shareBody');
    body.append(qrBox, codeLine, copy);

    shareDialog = createDialog({
      titleId: 'share-title',
      title: i18n.t('session.shareTitle'),
      closeLabel: i18n.t('common.close'),
      body,
      className: 'dialog-share',
    });
    shareDialog.element.dataset.testid = 'share-dialog';
    shareDialog.open();

    shareRotation = createRotation({
      now,
      onSlot: (slot) => {
        // The room mints for the rest of the session and never for longer, so
        // an empty slot means the peer window is over, not that more are due.
        if (!slot) {
          closeShare();
          return;
        }
        codeLine.textContent = formatCode(slot.code);
        qrBox.replaceChildren(
          createQr({
            payload: codeUrl(slot.code),
            ariaLabel: i18n.t('kiosk.qrLabel', { code: speakableCode(slot.code) }),
            unavailableText: formatCode(slot.code),
          }).element,
        );
      },
      onMore: () => {},
      setInterval: setTimer as (fn: () => void, ms: number) => unknown,
      clearInterval: clearTimer,
    });
    shareRotation.setBatch(batch, serverNow);
  }

  shareButton.addEventListener('click', () => {
    session.share();
  });
  session.onCodes((batch, serverNow) => openShare(batch, serverNow));
  session.onError((code) => {
    if (code !== 'share-not-allowed' && code !== 'share-unavailable') return;
    // A room opened by another phone is already the second hop; a room with
    // less than one rotation slot left cannot mint at all.
    if (code === 'share-not-allowed') shareButton.hidden = true;
    assertive.textContent = i18n.t(code === 'share-not-allowed' ? 'session.shareUnavailable' : 'session.shareTooLate');
  });

  countdownToggle.addEventListener('click', () => {
    countdownHidden = !countdownHidden;
    // One flag hides all three time-pressure tells at once: the countdown
    // itself, the fine minutes:seconds line, and the whole meander figure.
    element.dataset.countdown = countdownHidden ? 'hidden' : 'shown';
    timeEl.hidden = countdownHidden;
    fineEl.hidden = countdownHidden;
    meanderFig.hidden = countdownHidden;
    countdownToggle.setAttribute('aria-pressed', countdownHidden ? 'true' : 'false');
    countdownToggle.textContent = i18n.t(countdownHidden ? 'session.showCountdown' : 'session.hideCountdown');
  });

  refreshToggle.addEventListener('click', () => {
    paused = !paused;
    refreshToggle.setAttribute('aria-pressed', paused ? 'true' : 'false');
    refreshToggle.textContent = i18n.t(paused ? 'session.resumeRefresh' : 'session.pauseRefresh');
    refreshState.textContent = paused ? i18n.t('status.paused') : '';
    if (!paused) void refresh();
  });

  // Escape leaves the full map from anywhere inside the dashboard (the map
  // canvas, its button, the header controls), the way a dialog closes.
  element.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !mapFull) return;
    event.preventDefault();
    setMapView(false);
  });

  tablist.addEventListener('keydown', (event) => {
    const keys = ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End'];
    if (!keys.includes(event.key) || frozen) return;
    event.preventDefault();
    const index = LAYERS.indexOf(active);
    const next =
      event.key === 'Home' ? 0
      : event.key === 'End' ? LAYERS.length - 1
      : event.key === 'ArrowRight' || event.key === 'ArrowDown' ? (index + 1) % LAYERS.length
      : (index - 1 + LAYERS.length) % LAYERS.length;
    select(LAYERS[next]!, true);
    tabs[next]!.focus();
  });

  session.onJoined((snapshot) => {
    label.textContent = i18n.t('session.unlocked', {
      label: deps.label ?? i18n.t('session.labelScreen'),
      time: zagrebTime(snapshot.expiresAt ?? now()),
    });
    // Both unlocked surfaces carry the same expiry to the millisecond (R-52).
    if (snapshot.expiresAt !== null) label.dataset.expiresAt = String(snapshot.expiresAt);
    // Only the person who scanned the screen may pass the city on (R-56).
    if (snapshot.role === 'scanner') shareButton.hidden = false;
    polite.textContent = i18n.t('session.unlockedAnnounce', { time: zagrebTime(snapshot.expiresAt ?? now()) });
    totalSeconds = snapshot.expiresAt ? Math.max(1, session.secondsLeft()) : null;
    paintTimer();
    titleEl.focus();
    void refresh();
  });
  function freeze(): void {
    if (frozen) return;
    frozen = true;
    closeShare();
    // "Prikaz je zamrznut": the drawn vehicles stop where they are, rather
    // than dead-reckoning on for another five minutes under a frozen clock.
    schematic.pause();
    shareButton.hidden = true;
    paintTabs();
    paintTimer();
    // The closing line is its own visible element, not another announcement in
    // the assertive region: the izjava promises the person is told the session
    // ended and that what is on the screen stays (R-52, WCAG 2.2.1).
    frozenLine.hidden = false;
    frozenLine.textContent = i18n.t('session.expired');
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
    if (meanderTimer !== null) {
      clearTimer(meanderTimer);
      meanderTimer = null;
    }
  }

  session.onExpiring((secondsLeft) => announce(secondsLeft));
  session.onCount(() => paintTimer());
  session.onExpired(freeze);

  paintTabs();
  updateDocumentTitle();
  render();
  paintTimer();
  timer = setTimer(() => {
    // The clock decides, not the socket: a phone whose socket died on the way
    // to the camera app still freezes on time and still shows the closing
    // line (R-53).
    if (session.snapshot().expiresAt !== null && session.secondsLeft() === 0) {
      freeze();
      return;
    }
    paintTimer();
    void refresh();
  }, pollMs);
  // A second, finer timer: the fine countdown line and the meander drain by
  // the second, independent of pollMs (which only governs re-fetching city
  // data) — cleared alongside `timer` in freeze() and destroy().
  meanderTimer = setTimer(() => paintTimer(), MEANDER_TICK_MS);

  // Canvas colours are read off computed style (`tone()`), so a theme flip
  // needs a repaint even with no new data; a resize needs one because the
  // canvas backing store itself is sized off the box. `onRepaint` (fires
  // once immediately, per its own contract) covers both in one subscription.
  const stopRepaint = deps.onRepaint?.(() => {
    paintPanoramaFigure();
    paintTimer();
  });

  return {
    element,
    selectLayer: (layer) => select(layer, false),
    destroy() {
      if (timer !== null) clearTimer(timer);
      timer = null;
      if (meanderTimer !== null) clearTimer(meanderTimer);
      meanderTimer = null;
      stopRepaint?.();
      closeShare();
      maps.destroy();
      schematic.destroy();
      element.remove();
    },
  };
}
