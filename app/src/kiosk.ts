// Kaj ima? public screen: the controller. Decides the phase (setup,
// invitation, paired, expired, revoked), mounts that phase's composition from
// app/src/kiosk/*, and wires the real beacon and room sockets, the code
// rotation, the stop-scoped teaser poll and the one map. Nothing here talks
// to the network directly: every dependency is injected and defaults to the
// real client, so tests drive the same paths with fakes. The screen secret is
// stored and handed to the beacon client; it is never rendered or logged.
import type { ModuleId, ModuleSnapshot } from '../../worker/feed/schema';
import type { CodeSlot, CreateBeaconResponse, LayerId, ScreenMetadata } from '../../worker/protocol';
import { fetchData as fetchDataImpl, fetchTeaser as fetchTeaserImpl, type TeaserResponse } from './api';
import { createBeaconClient, parseProvisionHash, readBeacon, storeBeacon, type BeaconClient, type BeaconClientDeps, type BeaconCredentials } from './beacon';
import { codeUrl, formatCode, speakableCode } from './code';
import { parseSelection, type PublicSelection, type ScreenStop } from './core/contracts';
import { createTemporaryScreen, loadStops as loadStopsImpl } from './core/screens';
import type { I18n } from './i18n/i18n';
import { withNetwork, withTimers, type MapFactory } from './map/city-map';
import { createMapSlots } from './map/map-slots';
import { continuePoll, nextPollDelay } from './motion/loop';
import { loadNetwork, type Network } from './motion/network';
import { createRotation, slotProgress, type Rotation } from './rotation';
import { createSessionClient, type SessionClient } from './session';
import { escapeHtml } from './ui/dom/escape';
import { createQr } from './ui/qr';
import { forgetBeacon, msUntilExpiry, screenExpired, withScreen, type KioskPhase, type StorageLike } from './kiosk/credentials';
import { essentialsRows } from './kiosk/essentials';
import { clock, dayTime, weekdayDate } from './kiosk/format';
import { mountInvitation, type InvitationHandle, type InvitationModel } from './kiosk/invitation';
import { applyLayout, measureViewport, type LayoutDecision, type Viewport } from './kiosk/layout';
import { byModule, safetyStrip } from './kiosk/local';
import { createKioskMapAdapter, requestKioskMap } from './kiosk/mapview';
import { fitRows, KIOSK_LAYER_MODULES, mountPaired, type PairedContext, type PairedHandle } from './kiosk/paired';
import { mountSetup, type SetupHandle } from './kiosk/setup';
import { DEFAULT_STOP_ID } from './kiosk/stops';
import { fill, kioskStrings, type KioskStrings } from './kiosk/strings';

export type { KioskPhase } from './kiosk/credentials';
export { safetyStripText, teaserCards, type TeaserCard } from './kiosk/teaser';

/** The story, the clock line and the paired refresh all move on this tick. */
export const ROTATE_MS = 20_000;
/** The previous name of the same tick, kept for its callers. */
export const TEASER_ROTATE_MS = ROTATE_MS;
/** The code's remaining-time bar and the clock repaint once a second. */
export const CODE_TICK_MS = 1_000;
/** How long the basics panel waits, untouched, before the invitation returns. */
export const ESSENTIALS_IDLE_MS = 90_000;
/** Under reduced motion or lightweight the remaining-time bar moves in ten steps. */
export const PROGRESS_STEPS = 10;

export interface KioskDeps {
  i18n: I18n;
  hash: string;
  /** Where the ordinary credentials live; defaults to localStorage, null disables persistence. */
  storage?: StorageLike | null;
  now?: () => number;
  codeBase?: string;
  reducedMotion?: boolean;
  /** R-L1: decided once at the entry and passed down, exactly like `reducedMotion`. */
  lightweight?: boolean;
  /** Re-runs the layout decision on theme change and resize (ui/canvas.ts's `repaintOn`). */
  onRepaint?: (listener: () => void) => () => void;
  mapFactory?: MapFactory;
  loadNetwork?: () => Promise<Network | null>;
  fetchTeaser?: (stopId?: string) => Promise<TeaserResponse>;
  fetchData?: (module: ModuleId, token: string) => Promise<ModuleSnapshot>;
  /** One real POST /api/screens per press of the setup wizard's button. */
  createScreen?: (input: { area: string; stopId: string }) => Promise<CreateBeaconResponse>;
  loadStops?: () => Promise<ScreenStop[]>;
  createBeacon?: (deps: BeaconClientDeps) => BeaconClient;
  createSession?: (options: { roomId: string; ticket: string }) => SessionClient;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (handle: unknown) => void;
  requestFullscreen?: () => Promise<void>;
  requestWakeLock?: () => Promise<void>;
  /** Test seam: the viewport to lay out for; defaults to the root's box, then the window. */
  viewport?: Viewport;
  /** Test seam: the kiosk copy's locale; defaults to the i18n instance's. */
  locale?: string;
}

export interface KioskHandle {
  element: HTMLElement;
  phase(): KioskPhase;
  destroy(): void;
}

function safeLocalStorage(): StorageLike | null {
  try { return globalThis.localStorage; } catch { return null; }
}

/** The shell, built once: header, the stage every phase mounts into, the
 *  basics overlay, the safety strip, and the hidden holder the one map
 *  container is parked in while a composition without a map is shown. */
function shellMarkup(s: KioskStrings): string {
  return `<p class="k-alert" role="alert" data-testid="kiosk-alert" hidden></p>
    <header class="k-head">
      <div class="k-head-brand"><p class="k-brand">${escapeHtml(s.appName)} <span class="k-brand-sub">${escapeHtml(s.surface)}</span></p><p class="k-context" data-testid="kiosk-context"></p></div>
      <div class="k-head-mid" data-testid="kiosk-head-mid"></div>
      <div class="k-head-when"><p class="k-date" data-testid="kiosk-date"></p><time class="k-clock" data-testid="kiosk-clock"></time></div>
    </header>
    <section class="k-stage" data-testid="kiosk-stage"></section>
    <section class="k-basics" data-testid="kiosk-essentials" hidden aria-labelledby="ess-title">
      <header class="k-basics-head">
        <div><h2 id="ess-title" class="k-basics-title" tabindex="-1">${escapeHtml(s.basics.title)}</h2><p class="k-basics-hint">${escapeHtml(s.basics.hint)}</p></div>
        <button type="button" class="k-btn k-btn--ghost" data-testid="kiosk-essentials-close">${escapeHtml(s.basics.close)}</button>
      </header>
      <div class="k-basics-rows ess-rows" data-testid="kiosk-essentials-rows"></div>
    </section>
    <footer class="k-strip" data-testid="safety-strip"></footer>
    <div class="k-park" hidden></div>`;
}

function noticeMarkup(kind: 'expired' | 'revoked', s: KioskStrings): string {
  const title = kind === 'expired' ? s.notice.expiredTitle : s.notice.revokedTitle;
  const body = kind === 'expired' ? s.notice.expiredBody : s.notice.revokedBody;
  return `<div class="k-notice-card"><p class="k-kicker">${escapeHtml(s.appName)}</p><h1 class="k-notice-title">${escapeHtml(title)}</h1><p class="k-notice-body">${escapeHtml(body)}</p><button type="button" class="k-btn k-btn--primary" data-testid="kiosk-setup-again">${escapeHtml(s.notice.setupAgain)}</button></div>`;
}

export function mountKiosk(root: HTMLElement, deps: KioskDeps): KioskHandle {
  const { i18n } = deps;
  const locale = deps.locale ?? i18n.getLocale();
  const s = kioskStrings(locale);
  const now = deps.now ?? (() => Date.now());
  const setTimer = deps.setInterval ?? ((fn, ms) => globalThis.setInterval(fn, ms));
  const clearTimer = deps.clearInterval ?? ((h) => globalThis.clearInterval(h as never));
  const storage = deps.storage === undefined ? safeLocalStorage() : deps.storage;
  const lightweight = Boolean(deps.lightweight);
  const reducedMotion = Boolean(deps.reducedMotion);
  const fetchTeaser = deps.fetchTeaser ?? ((stopId?: string) => fetchTeaserImpl(fetch, stopId));
  const fetchData = deps.fetchData ?? ((module: ModuleId, token: string) => fetchDataImpl(module, token));
  const loadStops = deps.loadStops ?? (() => loadStopsImpl());
  const createScreen = deps.createScreen ?? ((input: { area: string; stopId: string }) => createTemporaryScreen(input));
  const makeBeacon = deps.createBeacon ?? ((d: BeaconClientDeps) => createBeaconClient(d));
  const makeSession = deps.createSession ?? ((o: { roomId: string; ticket: string }) => createSessionClient(o));

  /** The injected pair is interval-shaped; this makes a one-shot of it. */
  function oneShot(fn: () => void, ms: number): unknown {
    const box: { handle: unknown } = { handle: null };
    box.handle = setTimer(() => { clearTimer(box.handle); fn(); }, ms);
    return box.handle;
  }

  const element = document.createElement('div');
  element.className = 'kiosk';
  element.dataset.testid = 'kiosk';
  element.innerHTML = shellMarkup(s);
  root.appendChild(element);
  const q = <T extends HTMLElement>(selector: string): T => element.querySelector<T>(selector)!;
  const alertBox = q('[data-testid=kiosk-alert]');
  const contextEl = q('[data-testid=kiosk-context]');
  const headMid = q('[data-testid=kiosk-head-mid]');
  const dateEl = q('[data-testid=kiosk-date]');
  const clockEl = q('[data-testid=kiosk-clock]');
  const stage = q('[data-testid=kiosk-stage]');
  const basics = q('[data-testid=kiosk-essentials]');
  const basicsHeading = q('#ess-title');
  const basicsClose = q<HTMLButtonElement>('[data-testid=kiosk-essentials-close]');
  const basicsRows = q('[data-testid=kiosk-essentials-rows]');
  const strip = q('[data-testid=safety-strip]');
  const park = q('.k-park');

  let layout: LayoutDecision = applyLayout(element, deps.viewport ?? measureViewport(element));

  let disposed = false;
  let phase: KioskPhase = 'setup';
  let credentials: BeaconCredentials | null = null;
  let stop: ScreenStop | null = null;
  let stops: ScreenStop[] | null = null;
  /** Set once the screen can issue no more codes; an open session runs on to its end. */
  let screenDead: 'expired' | 'revoked' | null = null;
  let teaser: ModuleSnapshot[] = [];
  let storyIndex = 0;
  let currentSlot: CodeSlot | null = null;
  let beacon: BeaconClient | null = null;
  let beaconWasLive = false;
  let session: SessionClient | null = null;
  let unlockedToken: string | null = null;
  let sessionSnapshots: Partial<Record<ModuleId, ModuleSnapshot>> = {};
  let activeLayer: LayerId = 'grad-sada';
  let selection: PublicSelection | null = null;
  let sessionLabel: HTMLElement | null = null;
  let setup: SetupHandle | null = null;
  let invitation: InvitationHandle | null = null;
  let paired: PairedHandle | null = null;
  let notice: HTMLElement | null = null;
  let mapContainer: HTMLElement | null = null;
  let essentialsIdle: unknown = null;
  let expiryTimer: unknown = null;
  let teaserTimer: unknown = null;
  let pollingStarted = false;

  // One network artefact and one map for the screen's whole life (R-54); the
  // lightweight path has neither: no factory, so map-slots hands out nothing.
  let networkPromise: Promise<Network | null> | null = null;
  const loadNetworkOnce = (): Promise<Network | null> => (networkPromise ??= (deps.loadNetwork ?? (() => loadNetwork(fetch, lightweight)))());
  const mapAdapter = createKioskMapAdapter(lightweight ? undefined : withTimers(withNetwork(deps.mapFactory, loadNetworkOnce), setTimer, clearTimer));
  const maps = createMapSlots(mapAdapter.factory);

  // --- Alerts: the beacon socket and the teaser fetch fail independently -------
  type AlertSource = 'beacon' | 'teaser';
  const alerts = new Map<AlertSource, string>();
  function renderAlert(): void {
    const text = alerts.get('beacon') ?? alerts.get('teaser');
    alertBox.hidden = text === undefined;
    alertBox.textContent = text ?? '';
  }
  function showAlert(text: string, source: AlertSource): void { alerts.set(source, text); renderAlert(); }
  function clearAlert(source: AlertSource): void { if (alerts.delete(source)) renderAlert(); }

  // --- Header -----------------------------------------------------------------
  function paintClock(): void {
    const t = now();
    const date = weekdayDate(t);
    if (dateEl.textContent !== date) dateEl.textContent = date;
    const time = clock(t);
    if (clockEl.textContent !== time) {
      clockEl.textContent = time;
      clockEl.setAttribute('datetime', new Date(t).toISOString());
    }
  }
  function paintContext(): void {
    if (!credentials) { contextEl.textContent = ''; return; }
    const screen = credentials.screen;
    const sub = screen?.kind === 'temporary' && screen.expiresAt !== null
      ? fill(s.header.temporaryUntil, { time: dayTime(screen.expiresAt) })
      : screen ? s.header.venue : '';
    contextEl.innerHTML = `${escapeHtml(stop?.name ?? '')}${sub ? `<span class="k-context-sub">${escapeHtml(sub)}</span>` : ''}`;
  }
  function showSessionLabel(expiresAt: number | null): void {
    if (expiresAt === null) return;
    if (!sessionLabel) {
      sessionLabel = document.createElement('p');
      sessionLabel.className = 'k-session';
      sessionLabel.dataset.testid = 'session-label';
      headMid.appendChild(sessionLabel);
    }
    sessionLabel.dataset.expiresAt = String(expiresAt);
    sessionLabel.textContent = fill(s.header.unlockedUntil, { time: clock(expiresAt) });
  }
  function removeSessionLabel(): void { sessionLabel?.remove(); sessionLabel = null; }

  // --- Safety strip: always painted, never a session's ------------------------
  function paintStrip(): void {
    const parts = safetyStrip(teaser, stop, i18n, s);
    const noBasics = phase === 'paired' || phase === 'setup';
    const w = parts.warning;
    strip.innerHTML = `<button type="button" class="k-strip-basics" data-testid="kiosk-essentials-open"${noBasics ? ' hidden' : ''}>${escapeHtml(s.safety.basics)}</button>
      <span class="k-strip-label">${escapeHtml(s.safety.label)}</span>
      <span class="k-strip-item" data-testid="strip-warning" data-state="${w.state}"${w.severity ? ` data-severity="${escapeHtml(w.severity)}"` : ''}>${escapeHtml(w.text)}</span>
      <span class="k-strip-item" data-testid="strip-closures" data-state="${parts.closures.state}">${escapeHtml(parts.closures.text)}${parts.closures.nearestText ? ` <span class="k-strip-sub">${escapeHtml(parts.closures.nearestText)}</span>` : ''}</span>
      <span class="k-strip-item" data-testid="strip-pharmacy">${escapeHtml(s.safety.pharmacy)}: <strong>${escapeHtml(parts.pharmacy.label)}</strong></span>
      <a class="k-strip-hitno" href="/hitno">${escapeHtml(s.safety.hitno)}</a>`;
  }

  // --- Basics: the sessionless panel over the stage, 90 s idle outside a grant --
  function paintEssentials(): void {
    basicsRows.innerHTML = essentialsRows(teaser, i18n, s, locale, stop).map((row) => `<div class="ess-row k-ess-row" data-testid="ess-row" data-row="${row.id}">${row.label ? `<p class="k-ess-label">${escapeHtml(row.label)}</p>` : ''}<p class="k-ess-value">${escapeHtml(row.value)}</p>${row.detail ? `<p class="k-ess-detail">${escapeHtml(row.detail)}</p>` : ''}${row.attribution ? `<p class="k-meta ess-attr">${escapeHtml(row.attribution)}</p>` : ''}</div>`).join('');
  }
  function disarmEssentialsIdle(): void {
    if (essentialsIdle === null) return;
    clearTimer(essentialsIdle);
    essentialsIdle = null;
  }
  function armEssentialsIdle(): void {
    disarmEssentialsIdle();
    essentialsIdle = setTimer(() => closeEssentials(), ESSENTIALS_IDLE_MS);
  }
  /** Never over a grant (the driver's layer shows more) and never over the wizard. */
  function openEssentials(): void {
    if (phase === 'paired' || phase === 'setup') return;
    paintEssentials();
    basics.hidden = false;
    stage.hidden = true;
    mapAdapter.handle()?.pause();
    basicsHeading.focus();
    armEssentialsIdle();
  }
  function closeEssentials(restoreFocus = true): void {
    disarmEssentialsIdle();
    if (basics.hidden) return;
    basics.hidden = true;
    stage.hidden = false;
    if (mapContainer && mapContainer.parentElement !== park) resumeMap();
    if (restoreFocus) element.querySelector<HTMLButtonElement>('[data-testid=kiosk-essentials-open]')?.focus();
  }

  // --- The one map and the local content --------------------------------------
  function currentMapHost(): HTMLElement | null {
    if (lightweight) return null;
    if (phase === 'invitation') return invitation?.mapHost ?? null;
    if (phase === 'paired') return paired?.mapHost ?? null;
    return null;
  }
  /** A composition without a map keeps the container alive, off screen and paused. */
  function parkMap(): void {
    if (!mapContainer || mapContainer.parentElement === park) return;
    park.appendChild(mapContainer);
    mapAdapter.handle()?.pause();
  }
  /** Motion may run again only if the feed allows it: the hold is re-asserted after every resume. */
  function resumeMap(): void {
    const handle = mapAdapter.handle();
    if (!handle) return;
    handle.resume();
    mapAdapter.setFeedState(mapAdapter.feedState());
  }
  /** The lines board over the map's foot, in CSS px; 0 without layout or in lightweight mode. */
  function boardHeight(): number {
    const box = element.querySelector<HTMLElement>('.k-lines--overlay');
    return box ? box.getBoundingClientRect().height : 0;
  }
  function paintMap(): void {
    const host = currentMapHost();
    if (!host) { parkMap(); return; }
    const snapshots = phase === 'paired' ? { ...byModule(teaser), ...sessionSnapshots } : byModule(teaser);
    const container = requestKioskMap(maps, {
      stop, snapshots, now: now(), reducedMotion, locale, boardPx: boardHeight(),
      selection: phase === 'paired' ? selection : null,
      ariaLabel: stop ? `${s.paired.overviewTransport} · ${stop.name}` : s.paired.overviewTransport,
    }, mapAdapter);
    if (!container) return;
    mapContainer = container;
    if (container.parentElement !== host) {
      host.appendChild(container);
      // The box changed while the container sat outside the layout.
      mapAdapter.handle()?.resize?.();
      resumeMap();
    }
    element.dataset.live = '1';
  }
  function invitationModel(): InvitationModel {
    return { modules: teaser, stop, now: now(), storyIndex, lineCap: lightweight ? 10 : layout.size === 'wide' ? 5 : 4 };
  }
  function pairedContext(): PairedContext {
    return { layer: activeLayer, strings: s, i18n, locale, snapshots: { ...byModule(teaser), ...sessionSnapshots }, now: now(), stop, selection, lightweight, size: layout.size, stops };
  }
  function paintLocal(): void {
    invitation?.update(invitationModel());
    paired?.update(pairedContext());
    paintStrip();
    paintMap();
    if (!basics.hidden) paintEssentials();
    // Rows that do not fit a paired block are hidden and counted, never half-shown.
    if (paired) fitRows(paired.element, s.paired.coverage);
  }

  // --- Codes: the rotation's slot into the QR and the readable code -------------
  function codesAllowed(): boolean {
    return beacon !== null && screenDead === null;
  }
  function paintCode(): void {
    const slot = codesAllowed() ? currentSlot : null;
    const qrBox = element.querySelector<HTMLElement>('[data-testid=kiosk-qr]');
    const codeEl = element.querySelector<HTMLElement>('[data-testid=pair-code]');
    const codeA = element.querySelector<HTMLElement>('[data-testid=code-a]');
    const codeB = element.querySelector<HTMLElement>('[data-testid=code-b]');
    const link = element.querySelector<HTMLAnchorElement>('[data-testid=pair-url]');
    const corner = element.querySelector<HTMLElement>('[data-testid=corner-qr]');
    const joinCode = element.querySelector<HTMLElement>('[data-testid=join-code]');
    if (!slot) {
      if (qrBox) qrBox.innerHTML = `<p class="k-qr-waiting">${escapeHtml(s.invitation.qrWaiting)}</p>`;
      if (codeA) codeA.textContent = '····';
      if (codeB) codeB.textContent = '····';
      if (codeEl) codeEl.dataset.state = 'waiting';
      if (link) { link.hidden = true; link.removeAttribute('href'); link.textContent = ''; }
      if (corner) corner.replaceChildren();
      if (joinCode) joinCode.textContent = screenDead ? s.notice.endsAfterSession : s.invitation.codeWaiting;
      paintProgress();
      return;
    }
    const display = formatCode(slot.code);
    const payload = codeUrl(slot.code, deps.codeBase);
    const label = fill(s.invitation.qrLabel, { code: speakableCode(slot.code) });
    if (qrBox) qrBox.replaceChildren(createQr({ payload, ariaLabel: label, unavailableText: display }).element);
    if (codeA) codeA.textContent = display.slice(0, 4);
    if (codeB) codeB.textContent = display.slice(5);
    if (codeEl) codeEl.dataset.state = 'live';
    if (link) { link.href = payload; link.textContent = payload; link.hidden = false; }
    if (corner) corner.replaceChildren(createQr({ payload, ariaLabel: label, unavailableText: display }).element);
    if (joinCode) joinCode.textContent = display;
    paintProgress();
  }
  /** The remaining share of the current slot; quantised where motion is unwanted. */
  function paintProgress(): void {
    const bar = element.querySelector<HTMLElement>('[data-testid=code-progress]');
    if (!bar) return;
    const slot = codesAllowed() ? currentSlot : null;
    const raw = slot ? 1 - slotProgress(slot, rotation.serverNow()) : 0;
    const pct = reducedMotion || lightweight ? Math.round(raw * PROGRESS_STEPS) / PROGRESS_STEPS : raw;
    bar.dataset.pct = pct.toFixed(2);
    bar.setAttribute('aria-valuenow', String(Math.round(pct * 100)));
    const fillEl = bar.firstElementChild as HTMLElement | null;
    if (fillEl) fillEl.style.width = `${Math.round(pct * 1000) / 10}%`;
  }
  /** A rotation belongs to one screen: forgetting the screen starts a fresh one,
   *  so a dead screen's still-open slots can never surface as the next screen's code. */
  function newRotation(): Rotation {
    return createRotation({
      now,
      onSlot: (slot) => { currentSlot = slot; paintCode(); },
      onMore: () => beacon?.requestMore(),
      setInterval: setTimer,
      clearInterval: clearTimer,
    });
  }
  let rotation = newRotation();

  // --- Phases -------------------------------------------------------------------
  function clearStage(): void {
    parkMap();
    setup?.destroy(); setup = null;
    invitation?.destroy(); invitation = null;
    paired?.destroy(); paired = null;
    notice?.remove(); notice = null;
  }
  function setPhase(next: KioskPhase): void {
    phase = next;
    element.dataset.phase = next;
    element.dataset.mode = next === 'paired' ? 'unlocked' : 'teaser';
    clearStage();
    if (next === 'paired') closeEssentials(false);
    else removeSessionLabel();
    if (next === 'setup') mountSetupPhase();
    else if (next === 'invitation') invitation = mountInvitation(stage, { strings: s, i18n, locale, lightweight });
    else if (next === 'paired') paired = mountPaired(stage, { strings: s, i18n, locale, lightweight, onShell: paintCode });
    else mountNotice(next);
    paintContext();
    paintLocal();
    paintCode();
  }
  function mountNotice(kind: 'expired' | 'revoked'): void {
    notice = document.createElement('section');
    notice.className = 'k-notice';
    notice.dataset.testid = 'kiosk-notice';
    notice.dataset.kind = kind;
    notice.innerHTML = noticeMarkup(kind, s);
    stage.appendChild(notice);
    notice.querySelector<HTMLButtonElement>('[data-testid=kiosk-setup-again]')?.addEventListener('click', startOver);
  }
  /** The one way back from a dead screen: forget it and open the wizard.
   *  Nothing automatic -- no recreation, no retry, one person's press. */
  function startOver(): void {
    beacon?.close(); beacon = null;
    rotation.stop(); rotation = newRotation(); currentSlot = null;
    forgetBeacon(storage);
    credentials = null; stop = null; screenDead = null;
    disarmExpiry();
    setPhase('setup');
    if (pollingStarted) void loadTeaser();
  }
  function mountSetupPhase(): void {
    setup = mountSetup(stage, {
      strings: s,
      locale,
      loadStops: async () => { stops = await loadStops(); return stops; },
      createScreen,
      onCreated: (response) => adoptCredentials({ beaconId: response.beaconId, secret: response.secret, ...(response.screen ? { screen: response.screen } : {}) }, true),
      now,
      setTimeout: oneShot,
      clearTimeout: clearTimer,
      initialStopId: DEFAULT_STOP_ID,
    });
  }
  /** Credentials from the fragment, storage or a fresh creation take one path.
   *  A screen already past its expiry never connects (no reconnect loop against
   *  a socket the DO refuses) and shows the notice instead. */
  function adoptCredentials(creds: BeaconCredentials, persist: boolean): void {
    credentials = creds;
    if (persist) storeBeacon(storage, creds);
    stop = creds.screen?.stop ?? null;
    screenDead = null;
    if (screenExpired(creds.screen, now())) {
      screenDead = 'expired';
      setPhase('expired');
      return;
    }
    setPhase('invitation');
    startBeacon(creds);
    armExpiry();
    if (pollingStarted) void loadTeaser();
  }

  // --- The beacon socket ---------------------------------------------------------
  function startBeacon(creds: BeaconCredentials): void {
    beacon = makeBeacon({
      credentials: creds,
      onCodes: (batch, serverNow) => rotation.setBatch(batch, serverNow),
      onContext: applyScreen,
      onUnlocked: ({ roomId, ticket }) => openSession(roomId, ticket),
      onRevoked: () => {
        screenDead = screenExpired(credentials?.screen, now()) ? 'expired' : 'revoked';
        if (phase === 'paired') paintCode();
        else setPhase(screenDead);
      },
      onStatus: (status) => {
        if (status === 'offline') showAlert(s.status.offline, 'beacon');
        else if (status === 'connecting' && beaconWasLive) showAlert(s.status.reconnecting, 'beacon');
        else if (status === 'live') { beaconWasLive = true; clearAlert('beacon'); }
      },
    });
    beacon.connect();
  }
  /** The DO's copy of the screen metadata is authoritative: it is stored beside
   *  the existing credentials, never a new secret. */
  function applyScreen(screen: ScreenMetadata): void {
    if (!credentials) return;
    const before = stop?.id;
    credentials = withScreen(credentials, screen);
    storeBeacon(storage, credentials);
    stop = screen.stop;
    paintContext();
    armExpiry();
    if (stop?.id !== before) void loadTeaser();
    else paintLocal();
  }

  // --- Expiry: past 24 h a temporary screen issues no codes; a session runs on ---
  function disarmExpiry(): void {
    if (expiryTimer === null) return;
    clearTimer(expiryTimer);
    expiryTimer = null;
  }
  function armExpiry(): void {
    disarmExpiry();
    const ms = msUntilExpiry(credentials?.screen, now());
    if (ms === null) return;
    expiryTimer = oneShot(() => { expiryTimer = null; onScreenExpired(); }, ms);
  }
  function onScreenExpired(): void {
    screenDead = 'expired';
    beacon?.close();
    beacon = null;
    if (phase === 'paired') { paintCode(); paintContext(); }
    else setPhase('expired');
  }

  // --- The room session: the driver's phone steers, the kiosk mirrors ------------
  function openSession(roomId: string, ticket: string): void {
    // A second redeem mid-session opens a fresh room; the socket of the one it
    // replaces must not leak.
    session?.close();
    const live = makeSession({ roomId, ticket });
    session = live;
    live.onJoined((snapshot) => {
      if (session !== live || disposed) return;
      unlockedToken = snapshot.dataToken;
      if (phase !== 'paired') setPhase('paired');
      showSessionLabel(snapshot.expiresAt);
      void refreshSessionData();
    });
    live.onView((layer, params) => {
      if (session !== live || disposed) return;
      activeLayer = layer;
      // The allowlist is the whole relay contract: a layer, a route, a stop or a
      // public item key. Filters, search text and coordinates never arrive here.
      selection = params ? parseSelection(params) : null;
      if (selection?.kind === 'stop' && !stops) void ensureStops();
      paintLocal();
      void refreshSessionData();
    });
    live.onExpired(() => { if (session === live) endSession(); });
    live.connect();
  }
  /** Back to the invitation -- or to the notice, when the screen died meanwhile. */
  function endSession(): void {
    session?.close();
    session = null;
    unlockedToken = null;
    sessionSnapshots = {};
    selection = null;
    activeLayer = 'grad-sada';
    setPhase(screenDead ?? 'invitation');
  }
  async function refreshSessionData(): Promise<void> {
    const token = unlockedToken;
    if (!token) return;
    const results = await Promise.allSettled(KIOSK_LAYER_MODULES[activeLayer].map((id) => fetchData(id, token)));
    if (disposed || unlockedToken !== token) return;
    for (const result of results) if (result.status === 'fulfilled') sessionSnapshots[result.value.module] = result.value;
    paintLocal();
  }
  async function ensureStops(): Promise<void> {
    try {
      stops = await loadStops();
      if (!disposed) paintLocal();
    } catch { /* the selection keeps its id */ }
  }

  // --- The stop-scoped teaser poll, aligned to the realtime feed's own tick -------
  function armTeaserPoll(): void {
    if (disposed || teaserTimer !== null) return;
    teaserTimer = setTimer(() => {
      clearTimer(teaserTimer); // the injected pair is interval-shaped
      teaserTimer = null;
      continuePoll(loadTeaser(), armTeaserPoll, 'kiosk teaser');
    }, nextPollDelay(byModule(teaser)['zet-rt']?.sourceUpdatedAt, now()));
  }
  async function loadTeaser(): Promise<void> {
    const stopId = stop?.id;
    try {
      const response = await fetchTeaser(stopId);
      // A late answer for a stop the screen no longer has is dropped, not painted.
      if (disposed || stopId !== stop?.id) return;
      clearAlert('teaser');
      teaser = response.modules;
      paintLocal();
    } catch {
      if (!disposed) showAlert(s.status.dataDown, 'teaser');
    }
  }

  // --- Wiring ---------------------------------------------------------------------
  // First tap only: a kiosk browser grants fullscreen and the wake lock on a
  // user gesture, and never asks again.
  const onFirstTap = (): void => {
    element.removeEventListener('pointerdown', onFirstTap);
    void (deps.requestFullscreen ?? (() => document.documentElement.requestFullscreen()))().catch(() => {});
    void (deps.requestWakeLock ?? (async () => {
      await (navigator as { wakeLock?: { request(type: 'screen'): Promise<unknown> } }).wakeLock?.request('screen');
    }))().catch(() => {});
  };
  element.addEventListener('pointerdown', onFirstTap);
  // The strip is rebuilt on every poll, so its button is reached by delegation.
  strip.addEventListener('click', (event) => {
    if ((event.target as HTMLElement).closest('[data-testid=kiosk-essentials-open]')) openEssentials();
  });
  basicsClose.addEventListener('click', () => closeEssentials());
  // Any touch or key inside the open panel means someone is still reading it.
  basics.addEventListener('pointerdown', armEssentialsIdle);
  basics.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { closeEssentials(); return; }
    armEssentialsIdle();
  });

  // Credentials: the one-time fragment, then storage, else the setup wizard.
  const fromHash = parseProvisionHash(deps.hash);
  const initial = fromHash ?? readBeacon(storage);
  if (initial) adoptCredentials(initial, fromHash !== null);
  else setPhase('setup');
  paintClock();
  pollingStarted = true;
  continuePoll(loadTeaser(), armTeaserPoll, 'kiosk teaser');

  // A theme flip or a resize re-decides the composition; the content repaints
  // only when the composition actually changed.
  const stopRepaint = deps.onRepaint?.(() => {
    const next = applyLayout(element, deps.viewport ?? measureViewport(element));
    const changed = next.size !== layout.size;
    layout = next;
    if (changed) paintLocal();
  });

  const codeTimer = setTimer(() => { paintClock(); paintProgress(); }, CODE_TICK_MS);
  const rotateTimer = setTimer(() => {
    paintClock();
    if (phase === 'paired') {
      // The big screen is the one nobody touches: it moves itself, and if the
      // room's clock ran out while the socket was down it returns on its own.
      const live = session;
      if (live && live.snapshot().expiresAt !== null && live.secondsLeft() === 0) endSession();
      else void refreshSessionData();
    } else {
      storyIndex += 1;
      invitation?.update(invitationModel());
    }
  }, ROTATE_MS);

  return {
    element,
    phase: () => phase,
    destroy() {
      disposed = true;
      rotation.stop();
      clearTimer(rotateTimer);
      clearTimer(codeTimer);
      if (teaserTimer !== null) { clearTimer(teaserTimer); teaserTimer = null; }
      disarmExpiry();
      disarmEssentialsIdle();
      stopRepaint?.();
      beacon?.close(); beacon = null;
      session?.close(); session = null;
      clearStage();
      maps.destroy();
      element.remove();
    },
  };
}
