// Kaj ima? public screen controller. Scanning leaves the useful public
// overview in place; a versioned, explicit request selects a separate
// presentation. The internal `paired` phase is retained for compatibility.
// One map survives composition changes. Injected clients own networking,
// code rotation and feed polling; tests drive these same paths with fakes.
// Screen credentials never enter public presentation markup or logs.
import type { ModuleId, ModuleSnapshot } from '../../worker/feed/schema';
import { CITY_AREA } from '../../worker/pairing/areas';
import type { CodeSlot, CreateBeaconResponse, LayerId, ScreenMetadata } from '../../worker/protocol';
import { fetchData as fetchDataImpl, fetchSentences as fetchSentencesImpl, fetchTeaser as fetchTeaserImpl, type TeaserResponse } from './api';
import { createBeaconClient, parseProvisionHash, readBeacon, reloadBeacon, storeBeacon, type BeaconClient, type BeaconClientDeps, type BeaconCredentials } from './beacon';
import { BUILT_AT } from './motion/network-meta';
import type { MotionMetadata } from '../../shared/motion/wire';
import { codeUrl, formatCode, speakableCode } from './code';
import { parseSelection, type PublicSelection, type ScreenStop } from './core/contracts';
import type { ScreenPresentation } from '../../worker/presentation';
import { createCityStore, type CityStore } from './core/city-store';
import { arrivalsAt } from '../../shared/city/arrivals';
import type { DepartureBoard } from '../../shared/city/types';
import { createBoardCache, type BoardCache } from './city/boards';
import { dynamicPlaces } from './city/discovery';
import { selectNearby, skippedTextCensus, type NearbyRow } from './city/nearby';
import { createSentenceSequence, modelSentenceFacts, sentenceFacts, templateSentences, SENTENCE_BUDGET, SENTENCE_NO_REPEAT_MS, SENTENCE_REFRESH_MS } from './city/sentence';
import { DEFAULT_PLACE_STOP_ID, placeFromStop, type ScreenPlace } from '../../shared/city/place';
import { readWrittenSentences, typedSentenceFact, type SentenceFact, type SentenceRequest, type WrittenSentence } from '../../shared/kiosk/sentence';
import { vetExternal, type ExternalTextRejection } from '../../shared/kiosk/external-text';
import { matchStreet } from '../../shared/city/geo';
import { presentationTargetLabel } from './experience/presentation';
import { FLAGS } from './core/flags';
import { loadLastRun as loadLastRunImpl, type LastRunSnapshot } from './core/lastrun';
import type { MapMode } from './core/map-mode-store';
import { createTemporaryScreen, loadStops as loadStopsImpl } from './core/screens';
import { loadStreets as loadStreetsImpl } from './core/streets';
import type { I18n } from './i18n/i18n';
import { withNetwork, withTimers, type MapFactory, type MapHighlight } from './map/city-map';
import { createMapSlots } from './map/map-slots';
import { continuePoll, nextPollDelay } from './motion/loop';
import { loadNetwork, type Network } from '../../shared/motion/network';
import { FRAME_RADIUS_M, frameLinesOf, frameRadiusM, frameStopsFrom, type FrameStop } from '../../shared/city/frame';
import { createRotation, slotProgress, type Rotation } from './rotation';
import { createSessionClient, type SessionClient } from './session';
import { escapeAttribute, escapeHtml } from './ui/dom/escape';
import { createQr } from './ui/qr';
import { THEME_PREFERENCES, type ThemeController } from './ui/theme';
import { forgetBeacon, msUntilExpiry, screenExpired, withScreen, type KioskPhase, type StorageLike } from './kiosk/credentials';
import { essentialsMarkup, essentialsRows, fitEssentials } from './kiosk/essentials';
import { presentationLabelKind } from './kiosk/external';
import { clock, weekdayDayMonth } from './kiosk/format';
import { frameStrip, stripMarkup } from './kiosk/frame';
import { cardMarkup, mountInvitation, type InvitationHandle, type InvitationModel } from './kiosk/invitation';
import { applyLayout, compositionOf, FIELD_DESIGN_HEIGHT, FIELD_DESIGN_WIDTH, measureViewport, type LayoutDecision, type Viewport } from './kiosk/layout';
import { byModule, downPlaceholder, KIOSK_TEASER_MODULES, staleCopy } from './kiosk/local';
import { busesVisible, createKioskMapAdapter, feedStateOf, requestKioskMap, vehiclePoints } from './kiosk/mapview';
import { platformIds, type StopArrivals } from './kiosk/arrivals';
import { KIOSK_LAYER_MODULES } from './kiosk/layer-modules';
import type { PairedContext, PairedHandle } from './kiosk/paired';
import { mountPlaceField } from './kiosk/place-field';
import type { StreetGeo } from './kiosk/places';
import { readRhythm, readView, writeRhythm, writeView, type Rhythm, type WallView } from './kiosk/prefs';
import { bindLongPress, mountSettings, wallPlaceOf, wallSpanM, type SettingsHandle, type WallPlace } from './kiosk/settings';
import { mountStart, type StartHandle, type StartScreenInput } from './kiosk/start';
import { CITY_CENTRE, routeType } from './kiosk/stops';
import { fill, kioskStrings, type KioskStrings } from './kiosk/strings';

export type { KioskPhase } from './kiosk/credentials';
export { safetyStripText, teaserCards, type TeaserCard } from './kiosk/teaser';

/** The paired compositions refresh their layer's modules on this tick; nothing else moves on it. */
export const REFRESH_MS = 20_000;
/** The code bar and clock tick once a second; time-sensitive rows and sentences are revalidated with them. */
export const CODE_TICK_MS = 1_000;
/** How long the basics panel waits, untouched, before the invitation returns. */
export const ESSENTIALS_IDLE_MS = 90_000;
/** Under reduced motion or lightweight the remaining-time bar moves in ten steps. */
export const PROGRESS_STEPS = 10;
/** A slot change crossfades the code digits: the old ones fade out beside the new for this long. */
export const CODE_SWAP_MS = 180;
/** A changed header sentence fades in once; no transition under reduced motion or lagano. */
export const SENTENCE_SWAP_MS = 220;
export { SENTENCE_REFRESH_MS } from './city/sentence';
/** A cached pre-place record still has a useful list before the DO enriches it. */
const DEFAULT_WALL_PLACE: ScreenPlace = {
  kind: 'tram', name: 'Trg bana J. Jelačića', ...CITY_CENTRE, stopId: DEFAULT_PLACE_STOP_ID,
};
/** The MapLibre layer whose placed names the e2e counts (contract 3): the prozor profile keeps at most eight major street names in the field. */
export const MAJOR_LABELS_LAYER = 'roads_labels_major';
/** A down last-run answer is asked for again on the first paint this long
 *  after it was fetched (R-KP23): a screen lives for months, and one bad
 *  answer must not silence the statement until the stop changes; an hour
 *  keeps a broken source from being hammered by the 10 s poll. */
export const LASTRUN_DOWN_RETRY_MS = 3_600_000;
export type PairedRenderer = Pick<typeof import('./kiosk/paired'), 'mountPaired' | 'fitRows'>;

export interface KioskDeps {
  cityStore?: CityStore;
  i18n: I18n;
  hash: string;
  /** T5.3: the same controller entries/kiosk.ts already resolved (solar by
   *  default, or ?tema=) before this component ever sees it; the header
   *  settings toggle only calls setPreference, which does the persisting. */
  theme: ThemeController;
  /** Where the ordinary credentials live; defaults to localStorage, null disables persistence. */
  storage?: StorageLike | null;
  now?: () => number;
  codeBase?: string;
  reducedMotion?: boolean;
  /** R-L1: decided once at the entry and passed down, exactly like `reducedMotion`. */
  lightweight?: boolean;
  /** Renderer fixed at boot: ?prikaz= wins over the entry's per-device preference. */
  mapMode?: MapMode;
  /** Re-runs the layout decision on theme change and resize (ui/canvas.ts's `repaintOn`). */
  onRepaint?: (listener: () => void) => () => void;
  mapFactory?: MapFactory;
  loadNetwork?: () => Promise<Network | null>;
  fetchTeaser?: (stopId?: string) => Promise<TeaserResponse>;
  /** Optional inference only; local templates are painted before this settles. */
  fetchSentences?: (request: SentenceRequest) => Promise<WrittenSentence[]>;
  fetchData?: (module: ModuleId, token: string) => Promise<ModuleSnapshot>;
  /** The stop's last-departure table (core/lastrun.ts); the real loader by default, behind FLAGS.FEED_LASTRUN. */
  loadLastRun?: (stopId: string) => Promise<LastRunSnapshot | null>;
  /** One real POST /api/screens per press of the start screen's Pokreni: `{}` for an empty field (the whole city), `{ place, frame }` for a picked stop or street. */
  createScreen?: (input: StartScreenInput) => Promise<CreateBeaconResponse>;
  loadStops?: () => Promise<ScreenStop[]>;
  /** The offline street index the one place field suggests from; core/screens.ts's lazy loader by default. */
  loadStreets?: () => Promise<readonly StreetGeo[]>;
  /** How the scheduled boards are fetched and remembered; defaults to
   *  city/boards.ts's createBoardCache. The kiosk owns what this makes for
   *  its whole life and destroys it with itself. */
  createBoards?: () => BoardCache;
  createBeacon?: (deps: BeaconClientDeps) => BeaconClient;
  createSession?: (options: { roomId: string; ticket: string }) => SessionClient;
  /** Presentation code loads on demand; a synchronous renderer is injectable in controller tests. */
  loadPaired?: () => PairedRenderer | Promise<PairedRenderer>;
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
      <div class="k-head-brand"><button type="button" class="k-brand" data-testid="kiosk-brand" aria-label="${escapeAttribute(`${s.appName} · ${s.settings.open}`)}">${escapeHtml(s.appName)}</button><p class="k-context" data-testid="kiosk-context"></p></div>
      <div class="k-head-mid" data-testid="kiosk-head-mid">
        <p class="k-sentence" data-testid="kiosk-sentence" hidden><span class="k-sentence-kicker" data-testid="kiosk-sentence-kicker"></span><span class="k-sentence-text" data-testid="kiosk-sentence-text"></span></p>
        <span class="k-sentence k-sentence-probe" aria-hidden="true"><span class="k-sentence-kicker"></span><span class="k-sentence-text"></span></span>
        <p class="k-pairing-notice" hidden></p>
      </div>
      <div class="k-head-when"><p class="k-date" data-testid="kiosk-date"></p><div class="k-clock-row"><time class="k-clock" data-testid="kiosk-clock"></time></div></div>
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
  const cityStore=deps.cityStore??createCityStore();
  const { i18n } = deps;
  const locale = deps.locale ?? i18n.getLocale();
  const s = kioskStrings(locale);
  const now = deps.now ?? (() => Date.now());
  const setTimer = deps.setInterval ?? ((fn, ms) => globalThis.setInterval(fn, ms));
  const clearTimer = deps.clearInterval ?? ((h) => globalThis.clearInterval(h as never));
  const storage = deps.storage === undefined ? safeLocalStorage() : deps.storage;
  const lightweight = Boolean(deps.lightweight);
  const mapMode: MapMode = lightweight ? 'map' : deps.mapMode ?? 'map';
  const reducedMotion = Boolean(deps.reducedMotion);
  const fetchTeaser = deps.fetchTeaser ?? ((stopId?: string) => fetchTeaserImpl(fetch, stopId));
  const fetchSentences = deps.fetchSentences ?? fetchSentencesImpl;
  const fetchData = deps.fetchData ?? ((module: ModuleId, token: string) => fetchDataImpl(module, token));
  const fetchLastRun = deps.loadLastRun ?? ((stopId: string) => loadLastRunImpl(stopId));
  const loadStops = deps.loadStops ?? (() => loadStopsImpl());
  const loadStreets = deps.loadStreets ?? (() => loadStreetsImpl());
  const createScreen = deps.createScreen ?? ((input: StartScreenInput) => createTemporaryScreen(input));
  const makeBeacon = deps.createBeacon ?? ((d: BeaconClientDeps) => createBeaconClient(d));
  const makeSession = deps.createSession ?? ((o: { roomId: string; ticket: string }) => createSessionClient(o));
  const loadPaired = deps.loadPaired ?? (() => import('./kiosk/paired'));

  /** A tram route by the static table (GTFS route_type 0): what makes a stop place a tram place and what the frame counts. */
  const isTram = (routeId: string): boolean => routeType(routeId) === 0;

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
  const sentenceEl = q('[data-testid=kiosk-sentence]');
  const sentenceKicker = q('[data-testid=kiosk-sentence-kicker]');
  const sentenceText = q('[data-testid=kiosk-sentence-text]');
  const sentenceProbe = q('.k-sentence-probe');
  const probeKicker = q('.k-sentence-probe .k-sentence-kicker');
  const probeText = q('.k-sentence-probe .k-sentence-text');
  const pairingNote = q('.k-pairing-notice');
  const dateEl = q('[data-testid=kiosk-date]');
  const brand = q<HTMLButtonElement>('[data-testid=kiosk-brand]');
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
  /** The place the screen is about, whether its operator chose it, and its frame (kiosk/settings.ts wallPlaceOf). */
  let wall: WallPlace = wallPlaceOf(null, isTram);
  /** This browser's Ritam and Prikaz (kiosk/prefs.ts): the header sentence's cadence and map or schema. */
  let rhythm: Rhythm = readRhythm(storage);
  let view: WallView = readView(storage);
  let stops: ScreenStop[] | null = null;
  /** Set once the screen can issue no more codes; an open session runs on to its end. */
  let screenDead: 'expired' | 'revoked' | null = null;
  let teaser: ModuleSnapshot[] = [];
  let currentSlot: CodeSlot | null = null;
  let beacon: BeaconClient | null = null;
  let beaconEpoch = 0;
  let beaconWasLive = false;
  let session: SessionClient | null = null;
  let unlockedToken: string | null = null;
  let sessionSnapshots: Partial<Record<ModuleId, ModuleSnapshot>> = {};
  let activeLayer: LayerId = 'grad-sada';
  let selection: PublicSelection | null = null;
  let sessionLabel: HTMLElement | null = null;
  let sessionExpiresAt: number | null = null;
  let swapTimer: unknown = null;
  let start: StartHandle | null = null;
  let settings: SettingsHandle | null = null;
  let invitation: InvitationHandle | null = null;
  let sentenceSequence = createSentenceSequence({ rhythmMs: rhythm * 1000, noRepeatMs: SENTENCE_NO_REPEAT_MS });
  let wallItems: NearbyRow[] = [];
  let facts: SentenceFact[] = [];
  let modelSentences: WrittenSentence[] = [];
  let currentSentence: WrittenSentence | null = null;
  let sentenceFetchKey = '';
  let sentencesFetchedAt = -Infinity;
  let sentenceFetchSeq = 0;
  let sentenceSwapTimer: unknown = null;
  // A Ritam change replaces the sequence's cadence, not its ten-minute memory.
  const shownSentences = new Map<string, number>();
  let paired: PairedHandle | null = null;
  let pairedRenderer: PairedRenderer | null = null;
  let pairedRendererPending: Promise<PairedRenderer> | null = null;
  let pairedMount = 0;
  let presentation: ScreenPresentation | null = null;
  let acknowledgedRevision = -1;
  let acknowledgedStatus: 'displayed' | 'unavailable' | null = null;
  let presentationLoaded = false;
  let pairingNoticeUntil = 0;
  let notice: HTMLElement | null = null;
  let mapContainer: HTMLElement | null = null;
  let essentialsIdle: unknown = null;
  let expiryTimer: unknown = null;
  let teaserTimer: unknown = null;
  let pollingStarted = false;
  /** The minute the column was last painted for: the 1 s tick repaints it only when the minute turns. */
  let paintedMinute = -1;

  // One network artefact and one map for the screen's whole life (R-54); the
  // lightweight path has neither: no factory, so map-slots hands out nothing.
  let networkPromise: Promise<Network | null> | null = null;
  let motionMetadata = new Map<string, MotionMetadata>();
  let reloadingBundle = false;
  const loadNetworkOnce = (): Promise<Network | null> => (networkPromise ??= (deps.loadNetwork ?? (() => loadNetwork(fetch, lightweight)))());
  const mapAdapter = createKioskMapAdapter(lightweight ? undefined : withTimers(withNetwork(deps.mapFactory, loadNetworkOnce, id => motionMetadata.get(id)), setTimer, clearTimer));
  const maps = createMapSlots(mapAdapter.factory);

  // WP2: the frame's radius around the wall's place, measured along the tram
  // lines (shared/city/frame.ts), so it needs the stop table and the network
  // artefact's call order; until both are in it is the Kadar's fallback
  // (FRAME_RADIUS_M), never a guess. One number for the camera, the
  // "U blizini" circle and the pill: every reader calls wallRadiusM().
  let frameNetwork: Network | null = null;
  let frameNetworkAsked = false;
  let frameTable: { stops: readonly ScreenStop[]; network: Network | null; table: FrameStop[] } | null = null;
  function placeForNearby(): ScreenPlace {
    if (wall.place) return wall.place;
    const defaultStop = stops?.find(candidate => candidate.id === DEFAULT_PLACE_STOP_ID);
    return defaultStop ? placeFromStop(defaultStop, isTram) : DEFAULT_WALL_PLACE;
  }
  function stopForNearby(): ScreenStop | null {
    const place = placeForNearby();
    if (!place.stopId) return null;
    return stops?.find(candidate => candidate.id === place.stopId)
      ?? (stop?.id === place.stopId ? stop : { id: place.stopId, name: place.name, lon: place.lon, lat: place.lat, routes: [] });
  }
  function wallRadiusM(): number {
    if (!stops?.length) return FRAME_RADIUS_M[wall.frame];
    if (frameTable?.stops !== stops || frameTable.network !== frameNetwork) {
      frameTable = { stops, network: frameNetwork, table: frameStopsFrom(stops, isTram, frameNetwork ? frameLinesOf(frameNetwork) : []) };
    }
    return frameRadiusM(placeForNearby(), frameTable.table, wall.frame);
  }

  // --- Alerts: the beacon socket and the teaser fetch fail independently -------
  type AlertSource = 'beacon' | 'teaser';
  const alerts = new Map<AlertSource, string>();
  function renderAlert(): void {
    const text = alerts.get('beacon') ?? (phase === 'invitation' ? undefined : alerts.get('teaser'));
    alertBox.hidden = text === undefined;
    alertBox.textContent = text ?? '';
  }
  function showAlert(text: string, source: AlertSource): void { alerts.set(source, text); renderAlert(); }
  function clearAlert(source: AlertSource): void { if (alerts.delete(source)) renderAlert(); }

  // --- Header -----------------------------------------------------------------
  function paintClock(): void {
    const t = now();
    // Weekday, day and month; the year is not a fact a passer-by needs (kajimafix 03.1).
    const date = weekdayDayMonth(locale, t);
    if (dateEl.textContent !== date) dateEl.textContent = date;
    const time = clock(t);
    if (clockEl.textContent !== time) {
      clockEl.textContent = time;
      clockEl.setAttribute('datetime', new Date(t).toISOString());
    }
  }
  /** "Povezano": the pairing notice owns the header's middle for a few seconds,
   *  and it owns the status role with it. The two are cleared together -- the
   *  role is what tells the sentence the middle is taken, so a role left behind
   *  is a screen that never says another word between its brand and its
   *  clock. */
  function clearPairingNotice(): void {
    pairingNoticeUntil = 0;
    if (headMid.getAttribute('role') !== 'status') return;
    pairingNote.hidden = true;
    pairingNote.textContent = '';
    headMid.removeAttribute('role');
  }

  function sentenceSuspended(): boolean {
    return phase !== 'invitation' || Boolean(presentation?.target) || sessionLabel !== null || headMid.getAttribute('role') === 'status';
  }
  function outage(): boolean {
    return feedStateOf(byModule(teaser)['zet-rt']) === 'down';
  }
  function setText(node: HTMLElement, value: string): void {
    if (node.textContent !== value) node.textContent = value;
  }
  /** The probe is laid out even while the live sentence yields to a notice.
   * Its kicker, gap, font and available width are the live sentence's exact twins. */
  function sentenceOverflows(sentence: WrittenSentence): boolean {
    if (!typedSentenceFact({ id: 'render', kind: sentence.kicker, text: sentence.text, validUntil: sentence.validUntil }, locale.startsWith('en') ? 'en' : 'hr').ok) return true;
    setText(probeKicker, s.sentence.kicker[sentence.kicker]);
    setText(probeText, sentence.text);
    return sentenceProbe.clientWidth > 0
      && (probeText.scrollWidth > probeText.clientWidth + 1 || sentenceProbe.scrollWidth > sentenceProbe.clientWidth + 1);
  }
  function paintSentence(): void {
    if (currentSentence && !typedSentenceFact({ id: 'render', kind: currentSentence.kicker, text: currentSentence.text, validUntil: currentSentence.validUntil }, locale.startsWith('en') ? 'en' : 'hr').ok) currentSentence = null;
    const hidden = sentenceSuspended() || currentSentence === null;
    const previous = sentenceText.textContent;
    if (sentenceEl.hidden !== hidden) sentenceEl.hidden = hidden;
    if (hidden || !currentSentence) {
      if (sentenceSwapTimer !== null) { clearTimer(sentenceSwapTimer); sentenceSwapTimer = null; }
      delete sentenceEl.dataset.swap;
      return;
    }
    const next = currentSentence;
    const deadline = String(next.validUntil);
    if (sentenceEl.dataset.kicker !== next.kicker) sentenceEl.dataset.kicker = next.kicker;
    if (sentenceEl.dataset.validUntil !== deadline) sentenceEl.dataset.validUntil = deadline;
    setText(sentenceKicker, s.sentence.kicker[next.kicker]);
    setText(sentenceText, next.text);
    if (previous && previous !== next.text && !reducedMotion && !lightweight) {
      if (sentenceSwapTimer !== null) clearTimer(sentenceSwapTimer);
      sentenceEl.dataset.swap = '1';
      sentenceSwapTimer = oneShot(() => { sentenceSwapTimer = null; delete sentenceEl.dataset.swap; }, SENTENCE_SWAP_MS);
    }
  }
  /** Geometry follows the accepted sentence's refs; it never chooses a camera. */
  function sentenceHighlight(): MapHighlight | null {
    if (sentenceSuspended() || !currentSentence) return null;
    for (const ref of currentSentence.refs) {
      const row = wallItems.find(item => item.id === ref || ref.startsWith(`${item.id}:`));
      if (row?.map) return row.map;
      const city = cityStore.snapshot();
      const place = [...city.places, ...dynamicPlaces(city, now())].find(item => item.id === ref);
      if (place?.lon !== undefined && place.lat !== undefined) {
        return { id: place.id, geometry: { type: 'Point', coordinates: [place.lon, place.lat] } };
      }
    }
    return null;
  }
  /** data-skipped-text on the root: the rows the last selection left out for their third-party text, and why. */
  function paintSkippedText(reasons: readonly ExternalTextRejection[]): void {
    const census = skippedTextCensus(reasons);
    if (element.dataset.skippedText !== census) element.dataset.skippedText = census;
  }
  /** Select once for both readers. The selector rebuilds timetable departures
   * without live fixes during an outage; grey never means a relabelled ETA. */
  function paintWall(): void {
    const at = now();
    const budget = SENTENCE_BUDGET[compositionOf(layout)];
    if (phase === 'invitation' && !presentation?.target) {
      const place = placeForNearby();
      const subject = stopForNearby();
      const snapshots = byModule(teaser);
      const city = cityStore.snapshot();
      const radiusM = wallRadiusM();
      const held = (subject ? platformIds(subject, stops) : [])
        .map(id => boards.get('zet', id)).filter((board): board is DepartureBoard => board !== undefined);
      // Third-party text that fails the shared check leaves its row out; the census says how many and why.
      const skipped: ExternalTextRejection[] = [];
      wallItems = selectNearby({
        place, radiusM, now: at, boards: held, fixes: outage() ? [] : vehiclePoints(snapshots['zet-rt'], at),
        snapshots, city, lastRun, locale, i18n, stops: stops ?? undefined, onSkip: reason => skipped.push(reason),
      });
      paintSkippedText(skipped);
      facts = sentenceFacts({ place, radiusM, rows: wallItems, snapshots, city, now: at, outage: outage(), locale, i18n });
      invitation?.update(invitationModel());
    } else {
      wallItems = [];
      facts = [];
      paintSkippedText([]);
    }
    // Old answers are never trusted against the facts they were requested with.
    modelSentences = readWrittenSentences(modelSentences, { facts, budget, now: at });
    for (const [text, shownAt] of shownSentences) {
      if (at - shownAt >= SENTENCE_NO_REPEAT_MS && text !== currentSentence?.text) shownSentences.delete(text);
    }
    const pool = [...modelSentences, ...templateSentences(facts, i18n, budget, at)]
      .filter(sentence => sentence.text === currentSentence?.text || !shownSentences.has(sentence.text));
    const next = sentenceSequence.read(pool, at, sentenceSuspended(), sentenceOverflows);
    if (currentSentence && next?.text !== currentSentence.text) shownSentences.set(currentSentence.text, at);
    currentSentence = next;
    if (next && !sentenceSuspended()) shownSentences.set(next.text, at);
    paintSentence();
    mapAdapter.handle()?.setHighlight?.(sentenceHighlight());
    // Templates above paint synchronously, including the cold and failed-network paths.
    ensureSentences();
  }
  function ensureSentences(): void {
    if (disposed || lightweight || phase !== 'invitation' || presentation?.target) return;
    const at = now();
    const stable = modelSentenceFacts(facts, at);
    if (!stable.length) return;
    const budget = SENTENCE_BUDGET[compositionOf(layout)];
    const key = JSON.stringify([locale, budget, placeForNearby(), stable.map(fact => [fact.id, fact.kind, fact.text])]);
    if (key === sentenceFetchKey && at - sentencesFetchedAt < SENTENCE_REFRESH_MS) return;
    sentenceFetchKey = key;
    sentencesFetchedAt = at;
    const seq = ++sentenceFetchSeq;
    void fetchSentences({ locale: locale.startsWith('en') ? 'en' : 'hr', budget, facts: stable }).then(answer => {
      if (disposed || seq !== sentenceFetchSeq || phase !== 'invitation') return;
      modelSentences = readWrittenSentences(answer, { facts, budget: SENTENCE_BUDGET[compositionOf(layout)], now: now() });
      paintWall();
    }, () => { /* Optional inference never replaces the useful local templates with an error. */ });
  }
  /** The modules the strip reads from: the
   *  session's own copy once paired (fresher, when it has one), the open
   *  teaser otherwise -- the same choice paintStrip has always made. */
  function currentSafetyModules(): ModuleSnapshot[] {
    return phase === 'paired' ? Object.values(mergedSnapshots()).filter((m): m is ModuleSnapshot => Boolean(m)) : teaser;
  }
  function cycleTheme(): void {
    const i = THEME_PREFERENCES.indexOf(deps.theme.getPreference());
    deps.theme.setPreference(THEME_PREFERENCES[(i + 1) % THEME_PREFERENCES.length]!);
  }
  /** The chip names the screen's place alone (kajimafix 03.1): the stop or
   *  the street, Trg bana J. Jelačića for a screen set up with an empty field,
   *  "Zagreb" until the DO has said which; a venue's kind or a temporary
   *  screen's expiry are operator facts and belong to the settings panel. The
   *  shell carries the frame, the place's kind, Ritam and Prikaz for the
   *  compositions and the specs. */
  function paintContext(): void {
    contextEl.textContent = !credentials ? '' : vetExternal('name', wall.place?.name ?? CITY_AREA.name, 'row') ?? '';
    element.dataset.frame = String(wall.frame);
    element.dataset.placeKind = wall.placeSet && wall.place ? wall.place.kind : 'city';
    element.dataset.rhythm = String(rhythm);
    element.dataset.view = view;
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
    // Two spans, one text: at compact and in portrait the CSS drops the layer word (the stage shows the layer) so the pill fits the header's one row.
    const until = document.createElement('span');
    until.className = 'k-session-until';
    until.textContent = presentation?.target
      ? i18n.t('presentation.showing', { name: vetExternal(presentationLabelKind(presentation.target), presentationTargetLabel(i18n, presentation.target,mergedSnapshots(),stops??[],cityStore.snapshot()), 'row') ?? '' })
      : fill(s.header.unlockedUntil, { time: clock(sessionExpiresAt) });
    const layer = document.createElement('span');
    layer.className = 'k-session-layer';
    layer.textContent = presentation?.target ? ` · ${i18n.t('presentation.until', { time: clock(sessionExpiresAt) })}` : ` · ${s.layers[activeLayer]}`;
    sessionLabel.replaceChildren(until, layer);
    // No control here ends the presentation (T6, principle 8): the presenter's phone, expiry or a
    // confirmed takeover does, so nobody at the screen can end a stranger's presentation.
  }
  function removeSessionLabel(): void {
    sessionLabel?.remove(); sessionLabel = null; sessionExpiresAt = null;
  }

  // --- Safety strip: always present, sharing the visible source state --------
  function paintStrip(): void {
    // A session response may still confirm a source while the preview request
    // fails (and vice versa). All visible safety copy must use the same choice.
    const noBasics = phase === 'paired' || phase === 'setup';
    const built = frameStrip(currentSafetyModules(), stop, i18n, s, now());
    strip.innerHTML = stripMarkup(built, s, { noBasics, passive: layout.size !== 'handheld' });
  }

  // --- Basics: the sessionless panel over the stage, 90 s idle outside a grant --
  function paintEssentials(): void {
    basicsRows.innerHTML = essentialsMarkup(essentialsRows(teaser, i18n, s, locale, stop, now()));
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
  /** Never over a grant (the driver's layer shows more) and never over the start screen. */
  function openEssentials(): void {
    if (phase === 'paired' || phase === 'setup') return;
    closeSettings(false);
    paintEssentials();
    basics.hidden = false;
    stage.hidden = true;
    fitEssentials(basicsRows);
    mapAdapter.handle()?.pause();
    basicsHeading.focus();
    armEssentialsIdle();
  }
  function closeEssentials(restoreFocus = true): void {
    disarmEssentialsIdle();
    if (basics.hidden) return;
    basics.hidden = true;
    showStage();
    if (restoreFocus) element.querySelector<HTMLButtonElement>('[data-testid=kiosk-essentials-open]')?.focus();
  }
  /** The stage back from under a full-screen overlay -- the basics panel or
   *  Postavke. Both hide it the same way and both must give it back the same
   *  way, because what happens next is not the same: the basics panel closes
   *  into a screen that was already drawn, while Postavke closes on the DO's
   *  answer and the very next thing the kiosk does is move the camera. */
  function showStage(): void {
    stage.hidden = false;
    if (mapContainer && mapContainer.parentElement !== park) resumeMap();
  }

  // --- The one map and the local content --------------------------------------
  function currentMapHost(): HTMLElement | null {
    if (lightweight) return null;
    if (phase === 'invitation') return invitation?.mapHost ?? null;
    if (phase === 'paired') return paired?.mapHost ?? null;
    return null;
  }
  /** A phase without a map -- the wizard, a notice, lagano -- keeps the
   *  container alive, off screen and paused. */
  function parkMap(): void {
    if (!mapContainer || mapContainer.parentElement === park) return;
    park.appendChild(mapContainer);
    mapAdapter.handle()?.pause();
  }
  /** The map's box is only real while the stage is on screen. An overlay hides
   *  the stage outright, so for as long as one is open MapLibre measures a box
   *  of nothing -- and a camera moved against that box puts its subject about a
   *  third of the field from the middle instead of in it. Postavke closes on
   *  exactly that beat (applyScreen: the panel closes, then paintMap pushes the
   *  new view), so every resume re-measures first, the same way a re-parented
   *  container does. Motion may run again only if the feed allows it: the hold
   *  is re-asserted after every resume. */
  function resumeMap(): void {
    const handle = mapAdapter.handle();
    if (!handle) return;
    handle.resize?.();
    handle.resume();
    mapAdapter.setFeedState(mapAdapter.feedState());
  }
  /** The live map's own zoom, as its camera last reported it. The buses join
   *  the trams on the picture from CITY_DETAIL_ZOOM (mapview.ts busesVisible),
   *  and a tap that takes the camera over that line must show them then, not
   *  at the next poll -- so crossing it repaints, and nothing else does. */
  let mapZoom: number | null = null;
  function onMapCamera(camera: { zoom: number }): void {
    const before = mapZoom;
    mapZoom = camera.zoom;
    if (before === null || busesVisible(before) !== busesVisible(camera.zoom)) paintMap();
  }
  /** The map into the composition's host, or parked while none shows it. The
   *  invitation's camera is derived from the field's measured width -- the
   *  composition's design width before anything is laid out -- so the picture
   *  spans the ground wallSpanM() names whatever the screen (R-KP2): the
   *  measured Kadar around a place the operator chose [O-68], FIELD_SPAN_M
   *  otherwise, a phone's band HANDHELD_SPAN_M. A paired screen keeps the
   *  Promet contract (R-KP8). */
  function paintMap(): void {
    // A stale bundle is navigating away (reloadBeacon): nothing more is painted.
    if (reloadingBundle) return;
    // Postavke over the stage: the map's box is nothing, and a camera moved
    // against it lands off centre. The camera waits for the close (onClose
    // repaints after showStage has re-measured).
    if (settings?.isOpen()) return;
    invitation?.setFrame(wall.frame);
    const host = currentMapHost();
    const snapshots = phase === 'paired' ? mergedSnapshots() : byModule(teaser);
    motionMetadata = new Map((snapshots['zet-rt']?.items ?? []).filter(i => i.motion).map(i => [
      i.id, { network: i.motion!.network, generatedAt: i.motion!.generatedAt, builtAt: i.motion!.builtAt },
    ]));
    const staleNetwork = [...motionMetadata.values()].find(m => m.builtAt && m.builtAt !== BUILT_AT);
    if (host) {
      if (staleNetwork) host.dataset.networkStale = 'true';
      else delete host.dataset.networkStale;
    }
    if (credentials && staleNetwork) {
      reloadingBundle = reloadBeacon(credentials, storage, () => {
        mapAdapter.handle()?.pause();
        globalThis.location.reload();
      }, [BUILT_AT, staleNetwork.network ?? staleNetwork.builtAt!]);
      if (reloadingBundle) return;
    }
    // A phase without a map keeps the container parked, and the feed state
    // still reaches it: a map that returns mid-outage must already be holding,
    // never coasting on a state it heard before the outage.
    if (!host) { parkMap(); mapAdapter.setFeedState(feedStateOf(snapshots['zet-rt'])); return; }
    const composition = compositionOf(layout);
    const container = requestKioskMap(maps, {
      stop, snapshots, now: now(), reducedMotion, locale, renderer: mapMode,
      // A place the operator chose frames the invitation at its measured
      // Kadar; the whole city opens on the city window.
      district: null,
      city:cityStore.snapshot(),
      handheld: composition === 'handheld',
      displayScale: layout.zoom,
      onCamera:onMapCamera,
      cameraZoom:mapZoom ?? undefined,
      resolveStreet:(name,point)=>matchStreet(name,point,cityStore.snapshot().streets,cityStore.snapshot().settlements)?.id??null,
      phase: phase === 'paired' ? 'paired' : 'invitation',
      selection: phase === 'paired' ? selection : null,
      target: presentation?.target ?? undefined,
      stops: stops ?? undefined,
      widthPx: host.clientWidth || invitation?.measureWidth() || FIELD_DESIGN_WIDTH[composition],
      // With the width, the ground the field shows: the street names' padding follows it (mapview.ts labelPadding).
      heightPx: host.clientHeight || invitation?.measureHeight() || FIELD_DESIGN_HEIGHT[composition],
      spanM: wallSpanM({ handheld: composition === 'handheld', wall, stops, isTram }),
      // WP2: the frame. A chosen place frames its measured Kadar on a wall; the
      // read-path default (placeSet false) keeps the whole-city window. Prikaz
      // shema, or ?prikaz=shema at boot, is the whole network without zoom.
      place: wall.place, placeSet: wall.placeSet, frame: wall.frame, radiusM: wallRadiusM(),
      view: mapMode === 'schema' ? 'schema' : view,
      vehiclesVisible: feedStateOf(snapshots['zet-rt']) !== 'down',
      ariaLabel: stop ? `${s.paired.overviewTransport} · ${vetExternal('name', stop.name, 'row') ?? ''}` : s.paired.overviewTransport,
    }, mapAdapter);
    if (!container) return;
    // The network the map already fetches (withNetwork) carries the tram lines'
    // call order: once it lands the frame is measured, and the map is asked again once.
    if (!frameNetworkAsked) {
      frameNetworkAsked = true;
      void loadNetworkOnce().then((net) => { if (net && !disposed) { frameNetwork = net; paintLocal(); } });
    }
    container.inert=true;
    mapAdapter.handle()?.setHighlight?.(sentenceHighlight());
    mapContainer = container;
    if (container.parentElement !== host) {
      // The box changed while the container sat outside the layout; resumeMap re-measures it.
      host.appendChild(container);
      resumeMap();
    }
    element.dataset.live = '1';
    paintMajorLabels();
  }
  /** Contract 3, R-KP19: how many distinct major street names the map has
   *  placed, written on the field's map host for the e2e's proof (at most
   *  eight in the prozor profile). MapLibre's idle event never fires while
   *  vehicles are pushed at 12 Hz, so the count is sampled after each map
   *  paint (the poll's beat) and once more when the map first reports itself
   *  ready -- the 1 s tick polls status() only until then. A handle without
   *  the seam writes nothing, and an empty answer before the style has
   *  loaded is not a count of zero and is not written either. */
  let majorLabelsSampledAtReady = false;
  function paintMajorLabels(): void {
    const handle = mapAdapter.handle();
    if (!invitation || !handle?.placedNames || handle.status?.() !== 'ready') return;
    invitation.setMajorLabels(new Set(handle.placedNames(MAJOR_LABELS_LAYER)).size);
  }
  function sampleMajorLabelsOnceReady(): void {
    if (majorLabelsSampledAtReady || mapAdapter.handle()?.status?.() !== 'ready') return;
    majorLabelsSampledAtReady = true;
    paintMajorLabels();
  }

  // --- Last departures (R-KP6): the stop's table, on stop change and again once it expired ---
  let lastRun: LastRunSnapshot | null = null;
  let lastRunStop: string | null = null;
  let lastRunFetch: 'none' | 'pending' | 'done' = 'none';
  /** Behind FLAGS.FEED_LASTRUN (the dashboard's pattern): a new stop drops
   *  the old table at once -- it must not pose as the new stop's until the
   *  fetch answers -- and fetches its own; a live table past its validUntil
   *  is asked for again (the loader evicts it too), so a screen that runs for
   *  months does not lose the statement the day the table ends; a down
   *  answer is asked for again an hour after it was fetched
   *  (LASTRUN_DOWN_RETRY_MS; the loader never caches a down answer, so the
   *  call reaches the wire). A missing table (null: the stop is not in the
   *  generated set) stays until the stop changes. */
  function ensureLastRun(): void {
    if (!FLAGS.FEED_LASTRUN) return;
    const id = (phase === 'invitation' ? placeForNearby().stopId : stop?.id) ?? null;
    if (id !== lastRunStop) {
      lastRunStop = id;
      lastRun = null;
      lastRunFetch = 'none';
    }
    if (!id || lastRunFetch === 'pending') return;
    const expired = lastRun?.status === 'live' && now() >= Date.parse(lastRun.validUntil);
    const downForAnHour = lastRun?.status === 'down' && now() - Date.parse(lastRun.fetchedAt) >= LASTRUN_DOWN_RETRY_MS;
    if (lastRunFetch === 'done' && !expired && !downForAnHour) return;
    lastRunFetch = 'pending';
    fetchLastRun(id).then((snapshot) => {
      if (disposed || lastRunStop !== id) return;
      lastRunFetch = 'done';
      lastRun = snapshot;
      paintWall();
    }, () => {
      // The loader answers down itself; a rejection here is the injected dependency's, and the table stays absent until the stop changes.
      if (!disposed && lastRunStop === id) lastRunFetch = 'done';
    });
  }

  // --- Arrivals (WP5b): what comes next at a stop, on the screen's own beat ---
  /** The scheduled boards this screen has in hand: one request per platform
   *  per minute however many surfaces ask (city/boards.ts), made once with the
   *  kiosk and destroyed with it. */
  const boards: BoardCache = (deps.createBoards ?? (() => createBoardCache({ now })))();
  /** One function, not one per paint: the cache keeps everyone waiting for a
   *  platform in a Set, and a fresh closure each time would make a stop with
   *  eight platforms repaint 2^8 times as its boards landed one after another
   *  (the lesson is transport/workspace.ts's own onBoardSettled). */
  const onBoardSettled = (): void => { if (!disposed) paintLocal(); };
  /** The stops whose boards are worth having right now: the screen's own, and
   *  whichever one a person or a phone is asking about.
   *
   *  Ruling 31: while a presentation owns the screen its subject is the only
   *  one -- a phone putting THAT stop on the wall is asking for exactly this
   *  board, so it is fetched, and nothing else is. The gate was written to
   *  stop the screen polling the city behind a presented subject, not to
   *  starve the subject itself; a presented route, place or item still leaves
   *  the screen quiet. */
  function arrivalSubjects(): { id: string; name?: string }[] {
    const presented = presentation?.target;
    if (presented) return presented.selection?.kind === 'stop' ? [{ id: presented.selection.id }] : [];
    const out: { id: string; name?: string }[] = [];
    const local = phase === 'invitation' ? stopForNearby() : stop;
    if (local) out.push(local);
    if (selection?.kind === 'stop') out.push({ id: selection.id });
    return out;
  }
  /** Asks for what the cache does not already hold, on the beats that can
   *  change the answer -- the teaser poll, a tap, a relayed stop, the stop
   *  list landing -- and never on a paint: the 60 s memo turns the 10 s poll
   *  into one request a minute per platform.
   *
   *  A screen still in setup, or showing the expired notice, has no stop to
   *  ask about; what a presentation changes is which stop is worth asking
   *  about, not whether to ask (arrivalSubjects, Ruling 31). */
  function ensureArrivals(): void {
    if (disposed || (phase !== 'invitation' && phase !== 'paired')) return;
    for (const subject of arrivalSubjects()) boards.ensure('zet', platformIds(subject, stops), onBoardSettled);
  }
  /** What the cache holds for these platforms, merged with the live fleet the
   *  map is already drawing (kiosk/mapview.ts vehiclePoints): the screen has
   *  one source of live vehicles and this is it, not a second one. */
  function arrivalsAtStop(stopIds: readonly string[]): StopArrivals {
    const held = stopIds.map((id) => boards.get('zet', id)).filter((board): board is DepartureBoard => board !== undefined);
    const at = now();
    const fleet = vehiclePoints((phase === 'paired' ? mergedSnapshots() : byModule(teaser))['zet-rt'], at);
    // The shared module's own six: what a surface shows is its own business
    // (ARRIVAL_ROWS), but a card that trimmed the list must be able to say how
    // many it trimmed, and that count is this one.
    return arrivalsAt(held, fleet, at, { stopIds });
  }
  function invitationModel(): InvitationModel {
    // The field is the map's side of the invitation (its name, and lagano's
    // lines board in place of the map), so it follows the map: the chosen
    // place's stop, or the whole city while Trg is only the read-path default
    // for the list and the departures [O-52], [O-65].
    return { items: wallItems, radiusM: wallRadiusM(), frame: wall.frame, outage: outage(),
      modules: teaser, stop: wall.placeSet ? stopForNearby() : stop, now: now(), composition: compositionOf(layout) };
  }
  function pairedContext(): PairedContext {
    // The paired compositions are drawn for a wall; a handheld that is unlocked gets the compact drawing and scrolls it.
    const target = presentation?.target;
    return { layer: activeLayer, strings: s, i18n, locale, snapshots: mergedSnapshots(), now: now(), stop, selection, lightweight, size: layout.size === 'wide' ? 'wide' : 'compact', stops,city:cityStore.snapshot(), arrivals: arrivalsAtStop, ...(target ? { target } : {}) };
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
    ensureLastRun();
    paintedMinute = Math.floor(now() / 60_000);
    paired?.update(pairedContext());
    if(presentation?.target)showSessionLabel(presentation.expiresAt);
    paintWall();
    paintStrip();
    paintMap();
    if (!basics.hidden) paintEssentials();
    fitAll();
    acknowledgePresentation();
  }
  /** Rows that do not fit a paired block are hidden and counted, never half-shown; a statement past two lines is shortened at a word and one the column does not hold is hidden whole; Osnovno keeps the whole cards its box holds. Runs after every paint and on a resize (the invitation also re-fits itself once the fonts arrive); never on the 1 s tick, which has nothing new to measure. */
  function fitAll(): void {
    invitation?.fit();
    if (paired) pairedRenderer?.fitRows(paired.element, s.paired.coverage);
    if (!basics.hidden) fitEssentials(basicsRows);
  }

  // --- Codes: the rotation's slot into the QR and the readable code -------------
  function codesAllowed(): boolean {
    return beacon !== null && screenDead === null;
  }
  function paintCode(): void {
    const slot = codesAllowed() ? currentSlot : null;
    const qrBox = element.querySelector<HTMLElement>('[data-testid=kiosk-qr]');
    const codeEl = element.querySelector<HTMLElement>('[data-testid=kiosk-code]');
    const codeA = element.querySelector<HTMLElement>('[data-testid=code-a]');
    const codeB = element.querySelector<HTMLElement>('[data-testid=code-b]');
    let link = element.querySelector<HTMLElement>('[data-testid=pair-url]');
    const linkTag = layout.size === 'handheld' ? 'A' : 'SPAN';
    if (link && link.tagName !== linkTag) {
      const next = document.createElement(linkTag.toLowerCase());
      next.className = link.className;
      next.dataset.testid = 'pair-url';
      link.replaceWith(next);
      link = next;
    }
    if (!slot) {
      if (qrBox) qrBox.innerHTML = `<p class="k-qr-waiting">${escapeHtml(screenDead ? s.notice.endsAfterSession : s.invitation.qrWaiting)}</p>`;
      if (codeA) codeA.textContent = '····';
      if (codeB) codeB.textContent = '····';
      if (codeEl) codeEl.dataset.state = 'waiting';
      if (link) { link.hidden = true; link.removeAttribute('href'); link.textContent = ''; }
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
    if (link) {
      if (link instanceof HTMLAnchorElement) link.href = payload;
      link.textContent = payload;
      link.hidden = false;
    }
    if (codeEl && previous !== null && previous !== display) swapCode(codeEl, previous);
    paintProgress();
  }
  /** The outgoing digits stay 180 ms as a ghost over the live code, fading, while the new ones fade in (data-swap).
   *  The ghost repeats the live code's three spans (digits, the dimmed dash with its margins, digits) so both copies sit on the same pixels and the
   *  crossfade never reads as the second half sliding sideways; it carries no testid, so `kiosk-code` stays one element mid-swap. */
  function swapCode(codeEl: HTMLElement, previous: string): void {
    const box = codeEl.parentElement;
    if (!box || !box.classList.contains('k-code-box')) return;
    box.querySelector('.k-code-ghost')?.remove();
    const ghost = document.createElement('p');
    ghost.className = 'k-code k-code-ghost';
    ghost.setAttribute('aria-hidden', 'true');
    const dash = previous.search(/[-·]/);
    ghost.innerHTML = dash === -1
      ? `<span>${escapeHtml(previous)}</span>`
      : `<span>${escapeHtml(previous.slice(0, dash))}</span><span class="k-code-dash">·</span><span>${escapeHtml(previous.slice(dash + 1))}</span>`;
    box.appendChild(ghost);
    codeEl.dataset.swap = '1';
    if (swapTimer !== null) clearTimer(swapTimer);
    swapTimer = oneShot(() => {
      swapTimer = null;
      ghost.remove();
      delete codeEl.dataset.swap;
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
    if (fillEl) fillEl.style.transform = `scaleX(${Math.round(pct * 1000) / 1000})`;
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
    pairedMount += 1;
    parkMap();
    start?.destroy(); start = null;
    invitation?.destroy(); invitation = null;
    paired?.destroy(); paired = null;
    notice?.remove(); notice = null;
  }
  function setPhase(next: KioskPhase): void {
    // Postavke belong to the composition that was on the stage: whatever
    // replaces it -- a grant, a notice, the start screen -- gets the stage
    // back at once, never behind a panel waiting out its 90 s.
    closeSettings(false);
    phase = next;
    renderAlert();
    // The sheet reads the phase for the stage's room: the invitation is edge to edge, the wizard and the notices keep their padding.
    element.dataset.phase = next;
    element.dataset.mode = next === 'paired' ? 'unlocked' : 'teaser';
    clearStage();
    clearPairingNotice();
    if (next === 'paired') closeEssentials(false);
    else removeSessionLabel();
    if (next === 'setup') mountStartPhase();
    else if (next === 'invitation') {
      invitation = mountInvitation(stage, { strings: s, i18n, locale, lightweight, reducedMotion, codeBase: deps.codeBase });
    }
    else if (next === 'paired') mountPairedPhase();
    else mountNotice(next);
    paintContext();
    paintLocal();
    paintCode();
  }
  /** A public overview does not load the six presented-view compositions.
   * Loading keeps scanning and safety available; stale loads cannot remount a
   * cancelled presentation, and no success receipt precedes the actual render. */
  function mountPairedPhase(): void {
    const generation = pairedMount;
    const current = (): boolean => !disposed && phase === 'paired' && pairedMount === generation;
    const mount = (renderer: PairedRenderer): void => {
      paired?.destroy();
      paired = renderer.mountPaired(stage, { strings: s, i18n, locale, lightweight, codeBase: deps.codeBase, onShell: paintCode });
    };
    if (pairedRenderer) { mount(pairedRenderer); return; }
    const placeholder = document.createElement('section');
    placeholder.className = 'k-paired';
    placeholder.dataset.testid = 'kiosk-layer';
    placeholder.dataset.layer = activeLayer;
    placeholder.dataset.presentationStatus = 'loading';
    placeholder.innerHTML = `<div class="k-main"><p class="k-board-note" role="status">${escapeHtml(i18n.t('status.loading'))}</p></div>
      <aside class="k-side"><div class="k-present-invite" data-testid="kiosk-join">${cardMarkup(s, deps.codeBase)}</div></aside>`;
    stage.appendChild(placeholder);
    paired = { element: placeholder, mapHost: null, update: () => {}, destroy: () => placeholder.remove() };
    const failed = (): void => {
      if (!current()) return;
      placeholder.dataset.presentationStatus = 'unavailable';
      setText(placeholder.querySelector<HTMLElement>('[role=status]')!, i18n.t('presentation.unavailable'));
      acknowledgePresentation();
    };
    let result: PairedRenderer | Promise<PairedRenderer>;
    try { result = pairedRendererPending ?? loadPaired(); } catch { failed(); return; }
    if (!('then' in result)) {
      pairedRenderer = result;
      mount(result);
      return;
    }
    pairedRendererPending ??= Promise.resolve(result).then(renderer => {
      pairedRenderer = renderer;
      return renderer;
    }, error => { pairedRendererPending = null; throw error; });
    void pairedRendererPending.then(renderer => {
      if (!current()) return;
      mount(renderer);
      paintLocal();
      paintCode();
    }, failed);
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
    beaconEpoch += 1;
    beacon?.close(); beacon = null;
    resetPresentation();
    beaconWasLive = false;
    clearAlert('beacon');
    rotation.stop(); rotation = newRotation(); currentSlot = null;
    forgetBeacon(storage);
    credentials = null; stop = null; wall = wallPlaceOf(null, isTram); screenDead = null;
    disarmExpiry();
    setPhase('setup');
    if (pollingStarted) void loadTeaser();
  }
  function mountStartPhase(): void {
    start = mountStart(stage, {
      strings: s,
      locale,
      createScreen,
      loadStops: async () => { stops = await loadStops(); return stops; },
      loadStreets,
      isTram: (routeId) => routeType(routeId) === 0,
      onCreated: (response) => adoptCredentials({ beaconId: response.beaconId, secret: response.secret, ...(response.screen ? { screen: response.screen } : {}) }, true),
      now,
      setTimeout: oneShot,
      clearTimeout: clearTimer,
    });
  }
  /** Postavke, built on the first long press of the brand and kept for the
   *  screen's life. Mjesto and Kadar go to the DO as screen-set version 2
   *  (the panel's SendQueue); the DO's answer re-frames the wall through
   *  applyScreen, exactly as a change from the DO does. Prikaz, Tema and
   *  Ritam are this browser's and apply at once. */
  function openSettings(): void {
    if (!credentials || phase !== 'invitation') return;
    closeEssentials(false);
    settings ??= mountSettings(element, {
      strings: s,
      locale,
      screen: () => ({ place: wall.placeSet ? wall.place : null, frame: wall.frame, expiresAt: credentials?.screen?.expiresAt ?? null }),
      placeField: (host, options) => mountPlaceField(host, {
        strings: s, locale, isTram, setTimeout: oneShot, clearTimeout: clearTimer, ...options,
        loadStops: async () => { if (!stops || stops.length === 0) stops = await loadStops(); return stops; },
        loadStreets,
      }),
      themePreference: () => deps.theme.getPreference(),
      cycleTheme,
      rhythm: () => rhythm,
      setRhythm: (next) => {
        rhythm = next;
        writeRhythm(storage, next);
        sentenceSequence = createSentenceSequence({ rhythmMs: rhythm * 1000, noRepeatMs: SENTENCE_NO_REPEAT_MS });
        paintContext();
        paintWall();
      },
      view: () => view,
      setView: (next) => { view = next; writeView(storage, next); paintContext(); },
      save: (input) => {
        if (!beacon || beacon.status() !== 'live') return false;
        beacon.setScreen(input);
        return true;
      },
      forget: startOver,
      onOpen: () => { stage.hidden = true; mapAdapter.handle()?.pause(); },
      onClose: (restoreFocus) => {
        showStage();
        // The camera held while the panel covered the stage; the box is real
        // again. A phase change (restoreFocus false) repaints on its own.
        if (restoreFocus) { paintLocal(); brand.focus(); }
      },
      now,
      setTimeout: oneShot,
      clearTimeout: clearTimer,
    });
    settings.open();
  }
  function closeSettings(restoreFocus = true): void {
    settings?.close(restoreFocus);
  }
  /** Credentials from the fragment, storage or a fresh creation take one path.
   *  A screen already past its expiry never connects (no reconnect loop against
   *  a socket the DO refuses) and shows the notice instead. */
  function adoptCredentials(creds: BeaconCredentials, persist: boolean): void {
    resetPresentation();
    credentials = creds;
    if (persist) storeBeacon(storage, creds);
    stop = creds.screen?.stop ?? null;
    wall = wallPlaceOf(creds.screen, isTram);
    screenDead = null;
    if (screenExpired(creds.screen, now())) {
      screenDead = 'expired';
      setPhase('expired');
      return;
    }
    setPhase('invitation');
    startBeacon(creds);
    void ensureStops();
    ensureArrivals();
    armExpiry();
    if (pollingStarted) void loadTeaser();
  }

  // --- The beacon socket ---------------------------------------------------------
  function startBeacon(creds: BeaconCredentials): void {
    const epoch = ++beaconEpoch;
    const current = (): boolean => !disposed && epoch === beaconEpoch;
    beacon = makeBeacon({
      credentials: creds,
      presentationVersion: 1,
      capabilities:['city-v1','place-v2'],
      onCodes: (batch, serverNow) => { if (current()) rotation.setBatch(batch, serverNow); },
      onContext: (screen) => { if (current()) applyScreen(screen); },
      onError: (error) => { if (current()) settings?.refused(error); },
      onUnlocked: ({ roomId, ticket }) => { if (current()) openSession(roomId, ticket); },
      onPaired: () => {
        if (!current() || phase !== 'invitation') return;
        pairingNoticeUntil = now() + 4500;
        pairingNote.textContent = i18n.t('presentation.connected');
        pairingNote.hidden = false;
        headMid.setAttribute('role', 'status');
        paintWall();
      },
      onPresentation: (next) => { if (current()) applyPresentation(next); },
      onRevoked: () => {
        if (!current()) return;
        screenDead = screenExpired(credentials?.screen, now()) ? 'expired' : 'revoked';
        if (phase === 'paired') paintCode();
        else setPhase(screenDead);
      },
      onStatus: (status) => {
        if (!current()) return;
        if (status === 'offline') showAlert(s.status.offline, 'beacon');
        else if (status === 'replaced') showAlert(i18n.t('presentation.replaced'), 'beacon');
        else if (status === 'connecting' && beaconWasLive) showAlert(s.status.reconnecting, 'beacon');
        else if (status === 'live') {
          beaconWasLive = true;
          clearAlert('beacon');
          void cityStore.start().then(() => {
            if (!disposed) return cityStore.ensure(['heritage', 'streets', 'settlements', 'markets']);
          });
        }
      },
    });
    beacon.connect();
  }

  /** Revisions and pending loads belong to one beacon, never the next screen
   *  created in this browser. Invalidate in-flight fetches even if a token is
   *  reused by an injected transport. */
  function resetPresentation(): void {
    presentation = null;
    acknowledgedRevision = -1;
    acknowledgedStatus = null;
    presentationLoaded = false;
    pairingNoticeUntil = 0;
    sessionSeq += 1;
    session?.close(); session = null;
    unlockedToken = null;
    sessionSnapshots = {};
    sentenceFetchSeq += 1;
    sentenceFetchKey = '';
    modelSentences = [];
    selection = null;
    activeLayer = 'grad-sada';
    removeSessionLabel();
    clearPairingNotice();
  }

  function applyPresentation(next: ScreenPresentation): void {
    if (next.version !== 1 || disposed || (presentation && next.revision < presentation.revision)) return;
    if (next.target && next.expiresAt !== null && next.expiresAt <= rotation.serverNow()) return;
    if (presentation?.revision === next.revision) {
      acknowledgePresentation();
      return;
    }
    if (!next.target && phase !== 'paired' && !session && !unlockedToken) {
      // Initial/repeated idle state is not a composition change. In
      // particular, do not detach a useful overview as authentication ends.
      presentation = next;
      presentationLoaded = false;
      return;
    }
    presentation = next;
    presentationLoaded = false;
    clearPairingNotice();
    removeSessionLabel();
    if (!next.target) { endSession(); presentation = next; return; }
    session?.close(); session = null;
    unlockedToken = next.dataToken ?? null;
    sessionSnapshots = {};
    selection = next.target.selection ?? null;
    if(selection?.kind==='place')void cityStore.ensure(['culture','heritage','water','toilets','dogs','sport','recycling','markets','wifi','cycle-parking','garages','charging','hz-schedule']);
    if(selection?.kind==='street')void cityStore.ensure(['streets','settlements']);
    activeLayer = next.target.layer === 'kvart' ? 'grad-sada' : next.target.layer;
    setPhase('paired');
    showSessionLabel(next.expiresAt);
    if (selection?.kind === 'stop') { void ensureStops(); ensureArrivals(); }
    void refreshSessionData();
  }

  /** Receipt means the subject exists in the rendered composition, not merely
   *  that a socket accepted a frame. Loading maps wait; failed maps retain a
   *  text alternative. A removed selection is explicitly unavailable. */
  function acknowledgePresentation(): void {
    if (!presentation?.target || !presentationLoaded || !paired || disposed) return;
    const status = mapAdapter.handle()?.status?.();
    if (paired.mapHost && !lightweight && status === 'loading') return;
    const rendered = paired.element.dataset.presentationStatus;
    if (rendered !== 'displayed' && rendered !== 'unavailable') return;
    if (acknowledgedRevision === presentation.revision && acknowledgedStatus === rendered) return;
    beacon?.acknowledgePresentation?.(presentation.revision, rendered);
    acknowledgedRevision = presentation.revision;
    acknowledgedStatus = rendered;
  }
  /** The DO's copy of the screen metadata is authoritative: it is stored beside
   *  the existing credentials, never a new secret. */
  function applyScreen(screen: ScreenMetadata): void {
    if (!credentials) return;
    const before = stop?.id;
    credentials = withScreen(credentials, screen);
    storeBeacon(storage, credentials);
    stop = screen.stop;
    wall = wallPlaceOf(screen, isTram);
    paintContext();
    settings?.paint();
    // The panel may be waiting for exactly this: the frame it sent has landed. It stays open.
    settings?.applied();
    armExpiry();
    // The screen follows its stop at once (the field's name, the camera, the last-run table dropped), then asks for that stop's own teaser.
    paintLocal();
    ensureArrivals();
    if (!stops?.length) void ensureStops();
    if (stop?.id !== before) void loadTeaser();
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

  // --- Legacy room compatibility; versioned screens use explicit presentation ---
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
      if (selection?.kind === 'stop') ensureArrivals();
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
    const modules = [...new Set([
      ...KIOSK_LAYER_MODULES[activeLayer],
      ...(selection?.kind === 'item' ? [selection.module] : []),
    ])];
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
    if (presentation?.target) presentationLoaded = true;
    paintLocal();
  }
  let stopsPending: Promise<void> | null = null;
  function ensureStops(): Promise<void> {
    if (stops?.length) return Promise.resolve();
    if (stopsPending) return stopsPending;
    stopsPending = loadStops().then(loaded => {
      // Sibling platforms and the measured circle become knowable together.
      if (!disposed) { stops = loaded; ensureArrivals(); paintLocal(); }
    }, () => {
      // A later explicit request can retry; no per-tick retries.
      if (!disposed) { stops = []; paintLocal(); }
    }).finally(() => { stopsPending = null; });
    return stopsPending;
  }

  // --- The stop-scoped teaser poll, aligned to the realtime feed's own tick -------
  function armTeaserPoll(): void {
    if (disposed || teaserTimer !== null) return;
    teaserTimer = setTimer(() => {
      clearTimer(teaserTimer); // the injected pair is interval-shaped
      teaserTimer = null;
      continuePoll(loadTeaser(), armTeaserPoll, 'kiosk teaser');
    }, nextPollDelay(byModule(teaser)['zet-rt']?.sourceUpdatedAt, now(), byModule(teaser)['zet-rt']?.validUntil));
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
      // The poll's own beat is the arrivals' beat, and the memo decides what
      // that costs: one request a minute per platform, never one per paint.
      ensureArrivals();
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
  // Postavke open on a press held on the brand (or Enter/Space on it), never on
  // a tap: the header carries no operator control a passer-by could meet.
  const unbindBrand = bindLongPress(brand, { open: openSettings, setTimeout: oneShot, clearTimeout: clearTimer });
  // The panel's Tema toggle repaints on every change: its own clicks, ?tema=
  // landing after this mount, another tab, or the OS answer for auto.
  const stopTheme = deps.theme.onChange(() => settings?.paint());
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
  // when the composition actually changed, and crossing the handheld bound in
  // either direction swaps the invitation's composition outright. The same
  // drawing in a different box still moves the camera (the field's measured
  // width decides it, R-KP2) and re-fits the column.
  const stopRepaint = deps.onRepaint?.(() => {
    const next = applyLayout(element, deps.viewport ?? measureViewport(element));
    const changed = compositionOf(next) !== compositionOf(layout);
    const crossed = (next.size === 'handheld') !== (layout.size === 'handheld');
    layout = next;
    if (crossed && phase === 'invitation') { setPhase('invitation'); return; }
    if (changed) { paintLocal(); if (crossed) paintCode(); return; }
    paintWall();
    paintMap();
    fitAll();
  });

  const codeTimer = setTimer(() => {
    paintClock();
    paintProgress();
    // The notice's own end comes before the repaint that reads the middle: the
    // second it stops speaking is the second the sentence has the room back.
    if (pairingNoticeUntil > 0 && now() >= pairingNoticeUntil) clearPairingNotice();
    if (presentation?.target && presentation.expiresAt !== null && rotation.serverNow() >= presentation.expiresAt) {
      presentation = { ...presentation, target: null, dataToken: undefined };
      endSession();
    }
    if (presentation?.target) acknowledgePresentation();
    // Revalidate times each second without fetching; keyed rows only change when their content does.
    const minute = Math.floor(now() / 60_000);
    if (minute !== paintedMinute && invitation) {
      paintedMinute = minute;
      ensureLastRun();
    }
    paintWall();
    sampleMajorLabelsOnceReady();
  }, CODE_TICK_MS);
  const refreshTimer = setTimer(() => {
    if (phase !== 'paired') return;
    // The big screen is the one nobody touches: it moves itself, and if the
    // room's clock ran out while the socket was down it returns on its own.
    const live = session;
    if (live && live.snapshot().expiresAt !== null && live.secondsLeft() === 0) endSession();
    else void refreshSessionData();
  }, REFRESH_MS);
  const stopCity=cityStore.subscribe(()=>{if(!disposed)paintLocal();});

  return {
    element,
    phase: () => phase,
    destroy() {
      stopCity();cityStore.destroy();
      disposed = true;
      rotation.stop();
      clearTimer(refreshTimer);
      clearTimer(codeTimer);
      if (swapTimer !== null) { clearTimer(swapTimer); swapTimer = null; }
      if (sentenceSwapTimer !== null) { clearTimer(sentenceSwapTimer); sentenceSwapTimer = null; }
      if (teaserTimer !== null) { clearTimer(teaserTimer); teaserTimer = null; }
      disarmExpiry();
      disarmEssentialsIdle();
      stopRepaint?.();
      stopTheme();
      unbindBrand();
      beacon?.close(); beacon = null;
      session?.close(); session = null;
      settings?.destroy(); settings = null;
      boards.destroy();
      clearStage();
      maps.destroy();
      element.remove();
    },
  };
}
