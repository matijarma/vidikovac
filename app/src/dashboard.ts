// The /d/ surface. Owns the layer switcher (a real tablist with roving
// tabindex), the session ring and countdown, the two WCAG toggles, the polling
// loop and the expiry freeze. Every browser global is injected so the whole
// behaviour is unit-tested under happy-dom.
import type { Attribution, ModuleId, ModuleSnapshot } from '../../worker/feed/schema';
import { LAYERS, type LayerId } from '../../worker/protocol';
import { countdown, zagrebTime } from './format';
import type { I18n } from './i18n/i18n';
import { ALL_LAYER_MODULES, LAYER_MODULES, renderLayer } from './layers';
import type { ExportKind } from './layers/types';
import type { MapFactory } from './map/city-map';
import type { SessionClient } from './session';
import { escapeHtml } from './ui/dom/escape';

/** How often a visible layer refetches its modules. */
export const POLL_MS = 20_000;
/** Circumference of the r=45 ring in the SVG below. */
const RING_LENGTH = 283;

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
  mapFactory?: MapFactory;
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

  const snapshots: Partial<Record<ModuleId, ModuleSnapshot>> = {};
  let active: LayerId = LAYERS[0]!;
  let frozen = false;
  let paused = false;
  let countdownHidden = false;
  let warned60 = false;
  let warned15 = false;
  let timer: unknown = null;
  // Captured once, the moment a live expiry first appears (join or resume):
  // the denominator for the ring's fill fraction. The wire contract carries
  // no session-start timestamp, so a reload mid-session sees the ring start
  // full at whatever time is left then — the best any client can infer.
  let totalSeconds: number | null = null;

  const element = document.createElement('div');
  element.className = 'dash';
  element.innerHTML = `
    <header class="dash-head">
      <p class="dash-label" data-testid="session-label"></p>
      <div class="dash-timer">
        <svg class="session-ring" data-testid="session-ring" viewBox="0 0 100 100" aria-hidden="true">
          <circle class="ring-track" cx="50" cy="50" r="45" />
          <circle class="ring-fill" cx="50" cy="50" r="45" stroke-dasharray="${RING_LENGTH}" stroke-dashoffset="0" />
        </svg>
        <time class="dash-countdown" data-testid="countdown"></time>
      </div>
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
  const label = element.querySelector<HTMLElement>('[data-testid=session-label]')!;
  const timeEl = element.querySelector<HTMLTimeElement>('[data-testid=countdown]')!;
  const ring = element.querySelector<SVGCircleElement>('.ring-fill')!;
  const refreshState = element.querySelector<HTMLElement>('[data-testid=refresh-state]')!;
  const countdownToggle = element.querySelector<HTMLButtonElement>('[data-testid=toggle-countdown]')!;
  const refreshToggle = element.querySelector<HTMLButtonElement>('[data-testid=toggle-refresh]')!;

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
      mapFactory: deps.mapFactory,
      reducedMotion: deps.reducedMotion,
    };
  }

  function render(): void {
    const focusId = document.activeElement instanceof HTMLElement ? document.activeElement.id : '';
    const ctx = layerContext();
    const sections = (wide ? LAYERS : [active]).map((layer) => renderLayer(layer, ctx));
    view.replaceChildren(...sections);
    if (focusId) document.getElementById(focusId)?.focus();
  }

  function select(layer: LayerId, fromUser: boolean): void {
    if (frozen) return;
    active = layer;
    paintTabs();
    if (!wide) render();
    const heading = document.getElementById(`layer-title-${layer}`);
    if (fromUser) {
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
    const total = totalSeconds ?? Math.max(1, seconds);
    ring.setAttribute('stroke-dashoffset', String(Math.round(RING_LENGTH * (1 - seconds / total))));
    // A session with no expiry yet (still connecting) is not "about to expire";
    // only an actual live countdown may trip the 60 s/15 s warnings.
    if (!frozen && expiresAt !== null && seconds <= 60) announce(60);
    if (!frozen && expiresAt !== null && seconds <= 15) announce(15);
  }

  function announce(secondsLeft: number): void {
    if (secondsLeft <= 15) {
      if (warned15) return;
      warned15 = true;
      assertive.textContent = i18n.t('session.expiring15');
      return;
    }
    if (warned60) return;
    warned60 = true;
    polite.textContent = i18n.t('session.expiring60');
  }

  countdownToggle.addEventListener('click', () => {
    countdownHidden = !countdownHidden;
    timeEl.hidden = countdownHidden;
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
    polite.textContent = i18n.t('session.unlockedAnnounce', { time: zagrebTime(snapshot.expiresAt ?? now()) });
    totalSeconds = snapshot.expiresAt ? Math.max(1, session.secondsLeft()) : null;
    paintTimer();
    document.getElementById(`layer-title-${active}`)?.focus();
    void refresh();
  });
  function freeze(): void {
    if (frozen) return;
    frozen = true;
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
  }

  session.onExpiring((secondsLeft) => announce(secondsLeft));
  session.onCount(() => paintTimer());
  session.onExpired(freeze);

  paintTabs();
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

  return {
    element,
    selectLayer: (layer) => select(layer, false),
    destroy() {
      if (timer !== null) clearTimer(timer);
      timer = null;
      element.remove();
    },
  };
}
