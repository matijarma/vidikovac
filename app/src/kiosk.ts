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
import { CODE_URL_BASE, codeUrl, formatCode, speakableCode } from './code';
import { parseSelection, type PublicSelection, type ScreenStop } from './core/contracts';
import { createTemporaryScreen, loadStops as loadStopsImpl } from './core/screens';
import type { I18n } from './i18n/i18n';
import { withNetwork, withTimers, type MapFactory } from './map/city-map';
import { createMapSlots } from './map/map-slots';
import { continuePoll, nextPollDelay } from './motion/loop';
import { loadNetwork, type Network } from './motion/network';
import { createRotation, slotProgress, type Rotation } from './rotation';
import { createSessionClient, type SessionClient } from './session';
import { escapeAttribute, escapeHtml } from './ui/dom/escape';
import { createQr } from './ui/qr';
import { THEME_PREFERENCES, type ThemeController, type ThemePreference } from './ui/theme';
import { forgetBeacon, msUntilExpiry, screenExpired, withScreen, type KioskPhase, type StorageLike } from './kiosk/credentials';
import { essentialsRows } from './kiosk/essentials';
import { clock, dayTime, weekdayDate } from './kiosk/format';
import { countdownText, frameStrip, headerWeather, stripMarkup, weatherGroupMarkup, type RotationClock } from './kiosk/frame';
import { codeBlockMarkup, hintMarkup, mountInvitation, type InvitationHandle, type InvitationModel } from './kiosk/invitation';
import { applyLayout, measureViewport, type LayoutDecision, type Viewport } from './kiosk/layout';
import { byModule, downPlaceholder, KIOSK_TEASER_MODULES, staleCopy } from './kiosk/local';
import { createKioskMapAdapter, requestKioskMap } from './kiosk/mapview';
import { fitRows, KIOSK_LAYER_MODULES, mountPaired, type PairedContext, type PairedHandle } from './kiosk/paired';
import { mountSetup, type SetupHandle } from './kiosk/setup';
import { DEFAULT_STOP_ID } from './kiosk/stops';
import { fill, kioskStrings, type KioskStrings } from './kiosk/strings';

export type { KioskPhase } from './kiosk/credentials';
export { safetyStripText, teaserCards, type TeaserCard } from './kiosk/teaser';
export { STORY_LEAVE_MS } from './kiosk/invitation';

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
/** A slot change crossfades the code digits: the old ones fade out beside the new for this long. */
export const CODE_SWAP_MS = 180;

export interface KioskDeps {
  i18n: I18n;
  hash: string;
  /** T5.3: the same controller entries/kiosk.ts already resolved (solar by
   *  default, or ?tema=) before this component ever sees it; the header
   *  button only ever calls setPreference, which does the persisting. */
  theme: ThemeController;
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
      <div class="k-head-when"><p class="k-date" data-testid="kiosk-date"></p><div class="k-clock-row"><button type="button" class="k-theme" data-testid="kiosk-theme"></button><time class="k-clock" data-testid="kiosk-clock"></time><div class="k-weather" data-testid="kiosk-weather" hidden></div></div></div>
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

/** The one-time provisioning URL for a screen, minted on the same base as the
 *  QR's scan URL (production, unless the entry says otherwise), the shape
 *  parseProvisionHash reads back: `/kiosk/#<beaconId>.<secret>`. */
function provisionUrl(creds: BeaconCredentials, base: string = CODE_URL_BASE): string {
  return `${base.replace(/\/$/, '')}/kiosk/#${creds.beaconId}.${creds.secret}`;
}

/** /kiosk/ on a handheld, once a screen exists: the provisioning link to open
 *  on a wide screen (the sentence from the shared catalogue, so the phone
 *  speaks the page's language) and the code card the rotation paints through
 *  the same testids the wall's invitation carries. No map, board, weather or
 *  story: those are drawn for a wall (kiosk/invitation.ts). */
function handheldMarkup(s: KioskStrings, i18n: I18n, url: string, codeBase?: string): string {
  return `<div class="k-handheld-link" data-testid="handheld-link-block">
      <h1 class="k-handheld-title" id="k-handheld-title">${escapeHtml(i18n.t('kiosk.setup.handheld'))}</h1>
      <a class="k-handheld-url" data-testid="handheld-link" href="${escapeAttribute(url)}">${escapeHtml(url)}</a>
    </div>
    <article class="k-invite" data-testid="kiosk-invite">
      <div class="k-qr" data-testid="kiosk-qr"><p class="k-qr-waiting">${escapeHtml(s.invitation.qrWaiting)}</p></div>
      <div class="k-invite-text">
        <p class="k-lead">${escapeHtml(s.invitation.lead)}</p>
        <p class="k-support">${escapeHtml(s.invitation.support)}</p>
        ${hintMarkup(s, codeBase)}
      </div>
      ${codeBlockMarkup(s)}
    </article>`;
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
  const themeBtn = q<HTMLButtonElement>('[data-testid=kiosk-theme]');
  const clockEl = q('[data-testid=kiosk-clock]');
  const weatherEl = q('[data-testid=kiosk-weather]');
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
  // The strip's rotation countdown (frameStrip's RotationClock): observes the
  // existing rotation tick's own storyIndex advance rather than a second
  // timer of its own. T2.10 drives this directly from sceneIndex once
  // scenes.ts lands (C.2 edit 9); this shim needs no change to the tick itself.
  let lastRotateAt = now();
  let lastStoryIndexSeen = storyIndex;
  let currentSlot: CodeSlot | null = null;
  let beacon: BeaconClient | null = null;
  let beaconWasLive = false;
  let session: SessionClient | null = null;
  let unlockedToken: string | null = null;
  let sessionSnapshots: Partial<Record<ModuleId, ModuleSnapshot>> = {};
  let activeLayer: LayerId = 'grad-sada';
  let selection: PublicSelection | null = null;
  let sessionLabel: HTMLElement | null = null;
  let sessionExpiresAt: number | null = null;
  let swapTimer: unknown = null;
  let setup: SetupHandle | null = null;
  let invitation: InvitationHandle | null = null;
  let handheld: HTMLElement | null = null;
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
    // Only strip-next's own text and hidden state: the tick must never touch
    // the rest of the strip, or the "Osnovno" button's focus would not survive it.
    paintCountdown();
  }
  /** The header's weather group (D11): a condition glyph, the reading and the
   *  sunset-then-sunrise line, hidden while dhmz-now loads or is down -- the
   *  clock stands alone, never a dash. Shares the strip's module choice: the
   *  session's own copy once paired, the open teaser otherwise. */
  function paintWeather(): void {
    const weather = headerWeather(currentSafetyModules(), s, locale, now());
    const markup = weatherGroupMarkup(weather, s);
    if (weatherEl.innerHTML !== markup) weatherEl.innerHTML = markup;
    weatherEl.hidden = weather === null;
    if (weather) weatherEl.dataset.state = weather.state;
    else delete weatherEl.dataset.state;
  }
  /** The modules the strip and the header weather group both read from: the
   *  session's own copy once paired (fresher, when it has one), the open
   *  teaser otherwise -- the same choice paintStrip has always made. */
  function currentSafetyModules(): ModuleSnapshot[] {
    return phase === 'paired' ? Object.values(mergedSnapshots()).filter((m): m is ModuleSnapshot => Boolean(m)) : teaser;
  }
  /** The strip's RotationClock: whether the field is rotating right now, and
   *  when it last did. Observes the existing rotation tick's own storyIndex
   *  advance instead of a second timer (see the note by its declaration). */
  function rotationClock(): RotationClock {
    if (storyIndex !== lastStoryIndexSeen) {
      lastStoryIndexSeen = storyIndex;
      lastRotateAt = now();
    }
    return { rotating: phase === 'invitation' && !reducedMotion && !lightweight, lastRotateAt, period: ROTATE_MS };
  }
  /** Ticks the countdown alone, once a second: the strip itself is rebuilt
   *  only by paintStrip, on a poll or a phase change. */
  function paintCountdown(): void {
    const nextEl = strip.querySelector<HTMLElement>('[data-testid=strip-next]');
    if (!nextEl) return;
    const { nextIn } = frameStrip(currentSafetyModules(), stop, i18n, s, now(), rotationClock());
    const text = countdownText(nextIn, s);
    if (nextEl.textContent !== text) nextEl.textContent = text;
    nextEl.hidden = nextIn === null;
  }
  /** "Tema: po suncu": the header button's own label, always the controller's
   *  current word -- never guessed, never stale between its own clicks and a
   *  change made elsewhere (?tema=, another tab). */
  function paintTheme(preference: ThemePreference): void {
    themeBtn.textContent = fill(s.header.theme, { pref: s.header.themeWord[preference] });
  }
  function cycleTheme(): void {
    const i = THEME_PREFERENCES.indexOf(deps.theme.getPreference());
    deps.theme.setPreference(THEME_PREFERENCES[(i + 1) % THEME_PREFERENCES.length]!);
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
    sessionExpiresAt = expiresAt;
    sessionLabel.dataset.expiresAt = String(expiresAt);
    paintSessionLabel();
  }
  /** "Otključano do 13:57 · Promet": the room's end and the domain the screen mirrors right now. */
  function paintSessionLabel(): void {
    if (!sessionLabel || sessionExpiresAt === null) return;
    sessionLabel.textContent = `${fill(s.header.unlockedUntil, { time: clock(sessionExpiresAt) })} · ${s.layers[activeLayer]}`;
  }
  function removeSessionLabel(): void { sessionLabel?.remove(); sessionLabel = null; sessionExpiresAt = null; }

  // --- Safety strip: always present, sharing the visible source state --------
  function paintStrip(): void {
    // A session response may still confirm a source while the preview request
    // fails (and vice versa). All visible safety copy must use the same choice.
    const noBasics = phase === 'paired' || phase === 'setup';
    const built = frameStrip(currentSafetyModules(), stop, i18n, s, now(), rotationClock());
    strip.innerHTML = stripMarkup(built, s, { noBasics });
    fitStrip();
  }
  /** One fixed-height row (--k-strip-h): when the three items do not fit
   *  beside the verdict and the countdown, the countdown -- the least
   *  essential word on the strip -- goes first and alone; the type never
   *  steps down and nothing is clipped mid-word. */
  function fitStrip(): void {
    strip.classList.remove('k-strip--nonext');
    const items = strip.querySelector<HTMLElement>('.k-strip-items');
    if (!items || items.clientHeight === 0) return;
    if (items.scrollHeight > items.clientHeight + 1) strip.classList.add('k-strip--nonext');
  }

  // --- Basics: the sessionless panel over the stage, 90 s idle outside a grant --
  function paintEssentials(): void {
    basicsRows.innerHTML = essentialsRows(teaser, i18n, s, locale, stop, now()).map((row) => `<div class="ess-row k-ess-row" data-testid="ess-row" data-row="${row.id}">${row.label ? `<p class="k-ess-label">${escapeHtml(row.label)}</p>` : ''}<p class="k-ess-value">${escapeHtml(row.value)}</p>${row.detail ? `<p class="k-ess-detail">${escapeHtml(row.detail)}</p>` : ''}${row.attribution ? `<p class="k-meta ess-attr">${escapeHtml(row.attribution)}</p>` : ''}</div>`).join('');
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
    const snapshots = phase === 'paired' ? mergedSnapshots() : byModule(teaser);
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
    return { modules: teaser, stop, now: now(), storyIndex, lineCap: lightweight ? 10 : layout.size === 'wide' ? 5 : 4, size: layout.size === 'wide' ? 'wide' : 'compact' };
  }
  function pairedContext(): PairedContext {
    // The paired compositions are drawn for a wall; a handheld that is unlocked gets the compact drawing and scrolls it.
    return { layer: activeLayer, strings: s, i18n, locale, snapshots: mergedSnapshots(), now: now(), stop, selection, lightweight, size: layout.size === 'wide' ? 'wide' : 'compact', stops };
  }
  /** Both tiers of one module: the session copy, unless it is no longer live and the teaser holds a live one. */
  function mergedSnapshots(): Partial<Record<ModuleId, ModuleSnapshot>> {
    const out: Partial<Record<ModuleId, ModuleSnapshot>> = { ...byModule(teaser) };
    for (const copy of Object.values(sessionSnapshots)) {
      if (!copy) continue;
      const open = out[copy.module];
      out[copy.module] = copy.status !== 'live' && open?.status === 'live' ? open : copy;
    }
    return out;
  }
  function paintLocal(): void {
    invitation?.update(invitationModel());
    paired?.update(pairedContext());
    paintWeather();
    paintStrip();
    paintMap();
    if (!basics.hidden) paintEssentials();
    fitAll();
  }
  /** Rows that do not fit a paired block are hidden and counted, never half-shown; the story title gets the lines its box has; the strip drops its sun line and its street when two lines are not enough. Runs after every paint and once a second, so fonts arriving late and a resize are absorbed. */
  function fitAll(): void {
    invitation?.fit();
    if (paired) fitRows(paired.element, s.paired.coverage);
    fitStrip();
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
    // A slot change (a live code giving way to a different one) crossfades; the first code, a re-sent batch and a fresh mount paint at once.
    const previous = codeEl?.dataset.state === 'live' ? (codeEl.textContent ?? '').trim() : null;
    if (qrBox) qrBox.replaceChildren(createQr({ payload, ariaLabel: label, unavailableText: display }).element);
    if (codeA) codeA.textContent = display.slice(0, 4);
    if (codeB) codeB.textContent = display.slice(5);
    if (codeEl) codeEl.dataset.state = 'live';
    if (link) { link.href = payload; link.textContent = payload; link.hidden = false; }
    if (corner) corner.replaceChildren(createQr({ payload, ariaLabel: label, unavailableText: display }).element);
    if (joinCode) joinCode.textContent = display;
    if (codeEl && previous !== null && previous !== display) swapCode(codeEl, previous, joinCode);
    paintProgress();
  }
  /** The outgoing digits stay 180 ms as a ghost over the live code, fading, while the new ones fade in (data-swap); the join code fades in the same beat.
   *  The ghost repeats the live code's three spans (digits, the dimmed dash with its margins, digits) so both copies sit on the same pixels and the
   *  crossfade never reads as the second half sliding sideways; it carries no testid, so `pair-code` stays one element mid-swap. */
  function swapCode(codeEl: HTMLElement, previous: string, joinCode: HTMLElement | null): void {
    const box = codeEl.parentElement;
    if (!box || !box.classList.contains('k-code-box')) return;
    box.querySelector('.k-code-ghost')?.remove();
    const ghost = document.createElement('p');
    ghost.className = 'k-code k-code-ghost';
    ghost.setAttribute('aria-hidden', 'true');
    const dash = previous.indexOf('-');
    ghost.innerHTML = dash === -1
      ? `<span>${escapeHtml(previous)}</span>`
      : `<span>${escapeHtml(previous.slice(0, dash))}</span><span class="k-code-dash">-</span><span>${escapeHtml(previous.slice(dash + 1))}</span>`;
    box.appendChild(ghost);
    codeEl.dataset.swap = '1';
    if (joinCode) joinCode.dataset.swap = '1';
    if (swapTimer !== null) clearTimer(swapTimer);
    swapTimer = oneShot(() => {
      swapTimer = null;
      ghost.remove();
      delete codeEl.dataset.swap;
      if (joinCode) delete joinCode.dataset.swap;
    }, CODE_SWAP_MS);
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
    handheld?.remove(); handheld = null;
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
    else if (next === 'invitation' && layout.size === 'handheld') mountHandheld();
    else if (next === 'invitation') invitation = mountInvitation(stage, { strings: s, i18n, locale, lightweight, codeBase: deps.codeBase, defer: (fn, ms) => { const handle = oneShot(fn, ms); return () => clearTimer(handle); } });
    else if (next === 'paired') paired = mountPaired(stage, { strings: s, i18n, locale, lightweight, onShell: paintCode });
    else mountNotice(next);
    paintContext();
    paintLocal();
    paintCode();
  }
  /** The handheld's invitation: the link block and the code card (handheldMarkup). */
  function mountHandheld(): void {
    if (!credentials) return;
    handheld = document.createElement('section');
    handheld.className = 'k-handheld';
    handheld.dataset.testid = 'kiosk-handheld';
    handheld.setAttribute('aria-labelledby', 'k-handheld-title');
    handheld.innerHTML = handheldMarkup(s, i18n, provisionUrl(credentials, deps.codeBase), deps.codeBase);
    stage.appendChild(handheld);
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
      paintSessionLabel();
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
  let sessionSeq = 0;
  async function refreshSessionData(): Promise<void> {
    const token = unlockedToken;
    if (!token) return;
    const seq = ++sessionSeq;
    const modules = KIOSK_LAYER_MODULES[activeLayer];
    const results = await Promise.allSettled(modules.map((id) => fetchData(id, token)));
    // Another session, or a newer refresh, has spoken since: this answer is history.
    if (disposed || unlockedToken !== token || seq !== sessionSeq) return;
    const at = new Date(now()).toISOString();
    results.forEach((result, i) => {
      const id = modules[i]!;
      if (result.status === 'fulfilled') sessionSnapshots[result.value.module] = result.value;
      // A request that failed leaves its last-good copy stale, source by source; a module never seen is down.
      else sessionSnapshots[id] = sessionSnapshots[id] ? staleCopy(sessionSnapshots[id]!, at) : downPlaceholder(id, at);
    });
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
  let teaserSeq = 0;
  async function loadTeaser(): Promise<void> {
    const stopId = stop?.id;
    const seq = ++teaserSeq;
    // A late answer -- for a stop the screen no longer has, or to a request a newer one has overtaken -- is dropped, not painted.
    const outdated = (): boolean => disposed || stopId !== stop?.id || seq !== teaserSeq;
    try {
      const response = await fetchTeaser(stopId);
      if (outdated()) return;
      clearAlert('teaser');
      teaser = response.modules;
      paintLocal();
    } catch {
      if (outdated()) return;
      // The request itself failed: every last-good copy is stale from now on, source by source,
      // and a module with no copy is down -- the map holds and nothing reads as an all-clear.
      const at = new Date(now()).toISOString();
      const kept = teaser.map((m) => staleCopy(m, at));
      const have = new Set(kept.map((m) => m.module));
      teaser = [...kept, ...KIOSK_TEASER_MODULES.filter((m) => !have.has(m)).map((m) => downPlaceholder(m, at))];
      showAlert(s.status.dataDown, 'teaser');
      paintLocal();
    }
  }

  // --- Wiring ---------------------------------------------------------------------
  // First tap only: a kiosk browser grants fullscreen and the wake lock on a
  // user gesture, and never asks again. A handheld is a phone in a hand, not
  // a screen on a wall: it gets neither, and the listener stays armed until
  // a tap lands on a screen-sized layout.
  const onFirstTap = (): void => {
    if (layout.size === 'handheld') return;
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
  themeBtn.addEventListener('click', cycleTheme);
  // Repaints on every change: the button's own clicks, ?tema= landing after
  // this mount, another tab, or the OS answer for auto -- one source of truth.
  const stopTheme = deps.theme.onChange((state) => paintTheme(state.preference));
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
  // only when the composition actually changed, and crossing the handheld
  // bound in either direction swaps the invitation's composition outright.
  const stopRepaint = deps.onRepaint?.(() => {
    const next = applyLayout(element, deps.viewport ?? measureViewport(element));
    const changed = next.size !== layout.size;
    const crossed = (next.size === 'handheld') !== (layout.size === 'handheld');
    layout = next;
    if (!changed) return;
    if (crossed && phase === 'invitation') setPhase('invitation');
    else paintLocal();
  });

  const codeTimer = setTimer(() => { paintClock(); paintProgress(); fitAll(); }, CODE_TICK_MS);
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
      if (swapTimer !== null) { clearTimer(swapTimer); swapTimer = null; }
      if (teaserTimer !== null) { clearTimer(teaserTimer); teaserTimer = null; }
      disarmExpiry();
      disarmEssentialsIdle();
      stopRepaint?.();
      stopTheme();
      beacon?.close(); beacon = null;
      session?.close(); session = null;
      clearStage();
      maps.destroy();
      element.remove();
    },
  };
}
