// Kaj ima? public screen controller. Scanning leaves the useful public
// overview in place; a versioned, explicit request selects a separate
// presentation. The internal `paired` phase is retained for compatibility.
// One map survives composition changes. Injected clients own networking,
// code rotation and feed polling; tests drive these same paths with fakes.
// Screen credentials never enter public presentation markup or logs.
import type { ModuleId, ModuleSnapshot } from '../../worker/feed/schema';
import { CITY_AREA } from '../../worker/pairing/areas';
import type { CodeSlot, CreateBeaconResponse, LayerId, ScreenMetadata } from '../../worker/protocol';
import { fetchData as fetchDataImpl, fetchTeaser as fetchTeaserImpl, type TeaserResponse } from './api';
import { createBeaconClient, parseProvisionHash, readBeacon, storeBeacon, type BeaconClient, type BeaconClientDeps, type BeaconCredentials } from './beacon';
import { codeUrl, formatCode, speakableCode } from './code';
import { parseSelection, publicItemKey, type PublicSelection, type ScreenStop } from './core/contracts';
import type { ScreenPresentation } from '../../worker/presentation';
import { createCityStore, type CityStore } from './core/city-store';
import { discover,dynamicPlaces,type CityGroup,GROUP_SOURCES,CATEGORY_SOURCE } from './city/discovery';
import { placeDetail,placesMarkup,streetDetail } from './city/markup';
import { locatedEvents } from '../../shared/city/events';
import { ct, type CityWord } from './city/strings';
import { reconcile } from './ui/dom/reconcile';
import type { MapSelection } from './map/city-map';
import { matchStreet } from '../../shared/city/geo';
import { presentationTargetLabel } from './experience/presentation';
import { FLAGS } from './core/flags';
import { loadLastRun as loadLastRunImpl, type LastRunSnapshot } from './core/lastrun';
import type { MapMode } from './core/map-mode-store';
import { createTemporaryScreen, loadStops as loadStopsImpl } from './core/screens';
import type { I18n } from './i18n/i18n';
import { withNetwork, withTimers, type MapFactory } from './map/city-map';
import { createMapSlots } from './map/map-slots';
import { continuePoll, nextPollDelay } from './motion/loop';
import { loadNetwork, type Network } from '../../shared/motion/network';
import { createRotation, slotProgress, type Rotation } from './rotation';
import { createSessionClient, type SessionClient } from './session';
import { escapeAttribute, escapeHtml } from './ui/dom/escape';
import { iconMarkup, type IconName } from './ui/icons';
import { createQr } from './ui/qr';
import { THEME_PREFERENCES, type ThemeController, type ThemePreference } from './ui/theme';
import { forgetBeacon, msUntilExpiry, screenExpired, withScreen, type KioskPhase, type StorageLike } from './kiosk/credentials';
import { essentialsRows } from './kiosk/essentials';
import { clock, weekdayDayMonth } from './kiosk/format';
import { frameStrip, stripMarkup } from './kiosk/frame';
import { mountInvitation, type InvitationHandle, type InvitationModel } from './kiosk/invitation';
import { applyLayout, compositionOf, FIELD_DESIGN_HEIGHT, FIELD_DESIGN_WIDTH, measureViewport, type LayoutDecision, type Viewport } from './kiosk/layout';
import { byModule, downPlaceholder, KIOSK_TEASER_MODULES, staleCopy } from './kiosk/local';
import { busesVisible, createKioskMapAdapter, feedStateOf, FIELD_SPAN_M, HANDHELD_SPAN_M, requestKioskMap } from './kiosk/mapview';
import { fitRows, KIOSK_LAYER_MODULES, mountPaired, selectionCard, type PairedContext, type PairedHandle } from './kiosk/paired';
import { districtLabel } from './kiosk/districts';
import { mountSettings, type SettingsHandle } from './kiosk/settings';
import { mountStart, type StartHandle } from './kiosk/start';
import { fill, kioskStrings, type KioskStrings } from './kiosk/strings';
import { tickerIndex, tickerItems, type TickerItem } from './kiosk/ticker';

export type { KioskPhase } from './kiosk/credentials';
export { safetyStripText, teaserCards, type TeaserCard } from './kiosk/teaser';

/** The paired compositions refresh their layer's modules on this tick; nothing else moves on it. */
export const REFRESH_MS = 20_000;
/** The code's remaining-time bar and the clock repaint once a second; the column follows the minute. */
export const CODE_TICK_MS = 1_000;
/** How long the basics panel waits, untouched, before the invitation returns. */
export const ESSENTIALS_IDLE_MS = 90_000;
/** Under reduced motion or lightweight the remaining-time bar moves in ten steps. */
export const PROGRESS_STEPS = 10;
/** A slot change crossfades the code digits: the old ones fade out beside the new for this long. */
export const CODE_SWAP_MS = 180;
/** A ticker item changes with a crossfade of this length; instant under reduced motion and lagano. */
export const TICKER_SWAP_MS = 220;
/** The MapLibre layer whose placed names the e2e counts (contract 3): the prozor profile keeps at most eight major street names in the field. */
export const MAJOR_LABELS_LAYER = 'roads_labels_major';
/** A down last-run answer is asked for again on the first paint this long
 *  after it was fetched (R-KP23): a screen lives for months, and one bad
 *  answer must not silence the statement until the stop changes; an hour
 *  keeps a broken source from being hammered by the 10 s poll. */
export const LASTRUN_DOWN_RETRY_MS = 3_600_000;

export interface KioskDeps {
  cityStore?: CityStore;
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
  /** Renderer fixed at boot: ?prikaz= wins over the entry's per-device preference. */
  mapMode?: MapMode;
  /** Re-runs the layout decision on theme change and resize (ui/canvas.ts's `repaintOn`). */
  onRepaint?: (listener: () => void) => () => void;
  mapFactory?: MapFactory;
  loadNetwork?: () => Promise<Network | null>;
  fetchTeaser?: (stopId?: string) => Promise<TeaserResponse>;
  fetchData?: (module: ModuleId, token: string) => Promise<ModuleSnapshot>;
  /** The stop's last-departure table (core/lastrun.ts); the real loader by default, behind FLAGS.FEED_LASTRUN. */
  loadLastRun?: (stopId: string) => Promise<LastRunSnapshot | null>;
  /** One real POST /api/screens per press of the start screen's button; the body is empty (the whole city, no stop). */
  createScreen?: () => Promise<CreateBeaconResponse>;
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

/** The theme button's glyph per preference (kajimafix 03.1): a public screen carries no operator words in its header. */
const THEME_ICON: Record<ThemePreference, IconName> = { auto: 'sun-moon', light: 'sun', dark: 'moon', solar: 'sunset' };

/** The shell, built once: header, the stage every phase mounts into, the
 *  basics overlay, the safety strip, and the hidden holder the one map
 *  container is parked in while a composition without a map is shown. */
function shellMarkup(s: KioskStrings): string {
  return `<p class="k-alert" role="alert" data-testid="kiosk-alert" hidden></p>
    <header class="k-head">
      <div class="k-head-brand"><p class="k-brand">${escapeHtml(s.appName)}</p><p class="k-context" data-testid="kiosk-context"></p></div>
      <div class="k-head-mid" data-testid="kiosk-head-mid"></div>
      <div class="k-head-when"><p class="k-date" data-testid="kiosk-date"></p><div class="k-clock-row"><button type="button" class="k-theme" data-testid="kiosk-settings" aria-label="${escapeAttribute(s.settings.open)}" title="${escapeAttribute(s.settings.open)}" hidden>${iconMarkup('sliders-horizontal', undefined, 'icon k-icon')}</button><button type="button" class="k-theme" data-testid="kiosk-theme"></button><time class="k-clock" data-testid="kiosk-clock"></time></div></div>
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
  const fetchData = deps.fetchData ?? ((module: ModuleId, token: string) => fetchDataImpl(module, token));
  const fetchLastRun = deps.loadLastRun ?? ((stopId: string) => loadLastRunImpl(stopId));
  const loadStops = deps.loadStops ?? (() => loadStopsImpl());
  const createScreen = deps.createScreen ?? (() => createTemporaryScreen({}));
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
  const settingsBtn = q<HTMLButtonElement>('[data-testid=kiosk-settings]');
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
  /** The area the screen is set to: a četvrt slug, `zagreb` for the whole city, or null on a screen that never named one. */
  let area: string | null = null;
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
  /** The header's news line; built when the middle is free, removed when the session pill or the return button needs it. */
  let ticker: HTMLElement | null = null;
  let tickerSwap: unknown = null;
  /** What the last built list was read from: the visible copy of the sources, the city catalogue and the minute. */
  let tickerFrom: { modules: readonly ModuleSnapshot[]; city: unknown; minute: number } | null = null;
  let tickerList: TickerItem[] = [];
  let paired: PairedHandle | null = null;
  let presentation: ScreenPresentation | null = null;
  let acknowledgedRevision = -1;
  let acknowledgedStatus: 'displayed' | 'unavailable' | null = null;
  let presentationLoaded = false;
  let pairingNoticeUntil = 0;
  let exploring=false;
  let exploreUntil=0;
  let localSelection:MapSelection|null=null;
  let localGroup:CityGroup='living';
  let localCategory='';
  let localQuery='';
  let localLimit=20;
  function paintExplore():void {
    const slot=element.querySelector<HTMLElement>('.k-discovery-slot');
    element.dataset.exploring=String(exploring);
    if(!slot)return;
    if(!exploring){slot.replaceChildren();return;}
    const city=cityStore.snapshot(),events=locatedEvents(teaser.find(m=>m.module==='dogadanja')?.items??[],city.places,now());
    const p=localSelection?.kind==='place'?[...city.places,...dynamicPlaces(city,now())].find(p=>p.id===localSelection!.id):null;
    const street=localSelection?.kind==='street'?city.streets.find(s=>s.id===localSelection!.id):null;
    const transportSelection:PublicSelection|null=localSelection?.kind==='route'||localSelection?.kind==='stop'?{kind:localSelection.kind,id:localSelection.id}:
      localSelection?.kind==='vehicle'||localSelection?.kind==='closure'?{kind:'item',module:localSelection.kind==='vehicle'?'zet-rt':'prometnice',id:publicItemKey(localSelection.kind==='vehicle'?'zet-rt':'prometnice',localSelection.id)}:null;
    const result=discover(city,teaser.find(m=>m.module==='dogadanja')?.items??[],{group:localGroup,category:localCategory,window:'week',query:localQuery,center:stop??{lon:15.97726,lat:45.81286},radius:5000,now:now()});
    const categories:CityWord[]=localGroup==='useful'?['water','toilet','sport','dogs','recycling','market','wifi','cycle-parking','garage','charging']:
      localGroup==='heritage'?['heritage','streets']:localGroup==='culture'?['activeVenues','allVenues']:localGroup==='transport'?['bikes','rail','air']:[];
    const next=document.createElement('div');
    next.innerHTML=`<button class="btn-ghost" data-key="leave" data-action="kiosk-leave">${ct(i18n,'leave')}</button>${p?placeDetail(i18n,p,city,events):street?streetDetail(i18n,street):transportSelection?`<article class="city-detail"><button class="btn-quiet" data-action="clear-selection">${ct(i18n,'back')}</button>${selectionCard({...pairedContext(),selection:transportSelection})}</article>`:
      `<div data-key="browse"><label for="kiosk-city-search">${ct(i18n,'search')}</label><input id="kiosk-city-search" class="city-search" type="search" value="${escapeAttribute(localQuery)}" autocomplete="off">
      <div class="city-groups">${(['living','culture','useful','heritage','transport'] as CityGroup[]).map(g=>`<button class="city-group" data-key="${g}" data-action="kiosk-group" data-group="${g}" aria-pressed="${localGroup===g}">${ct(i18n,g==='living'?'all':g==='transport'?'movement':g)}</button>`).join('')}</div>
      <div class="city-filters">${categories.map(c=>{const key=c==='activeVenues'?'':c==='allVenues'?'culture':c;return `<button class="city-filter" data-action="kiosk-category" data-category="${key}" aria-pressed="${localCategory===key}">${ct(i18n,c)}</button>`;}).join('')}</div>
      ${placesMarkup(i18n,result.places,result.events,localLimit)}
      ${result.streets.slice(0,localLimit).map(s=>`<button class="city-row" data-key="${escapeAttribute(s.id)}" data-action="select-street" data-id="${escapeAttribute(s.id)}"><span><strong>${escapeHtml(s.name)}</strong><span class="city-meta">${escapeHtml(s.settlement)}</span></span></button>`).join('')}
      ${result.streets.length>localLimit?`<button class="btn-quiet" data-action="city-more">${ct(i18n,'more')}</button>`:''}
      ${city.loading?`<p role="status">${ct(i18n,'loading')}</p>`:!result.places.length&&!result.streets.length?`<p>${ct(i18n,'noResults')}</p>`:''}</div>`}`;
    // Public exploration does not save a stranger's preference on the venue device.
    next.querySelectorAll('[data-action=city-save],[data-action=city-copy]').forEach(e=>e.remove());
    // Third-party pages belong on the visitor's device, not in a public kiosk tab.
    next.querySelectorAll<HTMLElement>('a[href],[data-action=nav]').forEach(link=>{
      const text=document.createElement('div');text.className=link.className;text.innerHTML=link.innerHTML;link.replaceWith(text);
    });
    reconcile(slot,next);
  }
  function endExplore():void {exploring=false;localSelection=null;localGroup='living';localCategory='';localQuery='';localLimit=20;paintExplore();paintMap();element.querySelector<HTMLElement>('[data-action=kiosk-explore]')?.focus();}
  function exploreSelection(sel:MapSelection|null):void {
    if(phase!=='invitation'||presentation?.target)return;
    exploring=true;exploreUntil=now()+90_000;localSelection=sel;
    if(sel?.kind==='stop')void ensureStops();
    paintExplore();
  }
  element.addEventListener('click',event=>{
    if(phase!=='invitation'||presentation?.target)return;
    const target=(event.target as Element)?.closest<HTMLElement>('[data-action]');
    if(!target)return;
    const action=target.dataset.action;
    if(action==='kiosk-explore'){exploreSelection(null);void cityStore.ensure(['culture','heritage','streets','settlements']);}
    if(action==='kiosk-leave')endExplore();
    if(action==='clear-selection'){exploreSelection(null);paintMap();}
    if(action==='select-place'){exploreSelection({kind:'place',id:target.dataset.id!});paintMap();mapAdapter.handle()?.select?.(localSelection,{fit:true});}
    if(action==='select-street')exploreSelection({kind:'street',id:target.dataset.id!});
    if(action==='kiosk-group'){localGroup=target.dataset.group as CityGroup;localCategory='';localLimit=20;localSelection=null;void cityStore.ensure(GROUP_SOURCES[localGroup]);paintExplore();paintMap();}
    if(action==='kiosk-category'){localCategory=target.dataset.category??'';localLimit=20;void cityStore.ensure(CATEGORY_SOURCE[localCategory]??[]);paintExplore();paintMap();}
    if(action==='city-more'){localLimit+=20;paintExplore();}
  });
  element.addEventListener('input',event=>{
    const target=event.target as HTMLInputElement;
    if(!exploring||phase!=='invitation'||presentation?.target||target.id!=='kiosk-city-search')return;
    localQuery=target.value;localLimit=20;exploreUntil=now()+90_000;
    if(localQuery)void cityStore.ensure(Object.values(CATEGORY_SOURCE).flat());
    paintExplore();paintMap();
  });
  element.addEventListener('pointerdown',()=>{if(exploring)exploreUntil=now()+90_000;});
  element.addEventListener('keydown',e=>{if(exploring){exploreUntil=now()+90_000;if(e.key==='Escape')endExplore();}});
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
   *  role is what tells the ticker the middle is taken, so a role left behind
   *  is a screen that never says another word between its brand and its
   *  clock. */
  function clearPairingNotice(): void {
    pairingNoticeUntil = 0;
    if (headMid.getAttribute('role') !== 'status') return;
    headMid.textContent = '';
    headMid.removeAttribute('role');
  }

  /** The header's one line of city news (kiosk/ticker.ts): a kicker and one
   *  sentence, the item chosen by the clock alone, crossfaded on a swap and
   *  changed instantly under reduced motion. The middle of the header belongs
   *  first to the session pill and the return button: while either is there
   *  the ticker is not. The list itself is rebuilt only when the sources, the
   *  city catalogue or the minute change; the second hand only picks from it. */
  function paintTicker(): void {
    const taken = sessionLabel !== null || headMid.hasAttribute('role') || headMid.querySelector('[data-testid=kiosk-stop-presentation]') !== null;
    if (taken || phase !== 'invitation') { ticker?.remove(); ticker = null; return; }
    const modules = currentSafetyModules();
    const city = cityStore.snapshot();
    const minute = Math.floor(now() / 60_000);
    if (!tickerFrom || tickerFrom.modules !== modules || tickerFrom.city !== city || tickerFrom.minute !== minute) {
      tickerFrom = { modules, city, minute };
      tickerList = tickerItems(modules, city, now(), s, i18n);
    }
    const index = tickerIndex(tickerList.length, now());
    if (index < 0) { ticker?.remove(); ticker = null; return; }
    if (!ticker) {
      ticker = document.createElement('p');
      ticker.className = 'k-ticker';
      ticker.dataset.testid = 'kiosk-ticker';
      headMid.appendChild(ticker);
    }
    const item = tickerList[index]!;
    if (ticker.dataset.key === item.key) return;
    // The first item is simply there; only a change from one sentence to another is a swap.
    const swapping = ticker.dataset.key !== undefined;
    ticker.dataset.key = item.key;
    ticker.innerHTML = `<span class="k-ticker-kicker">${escapeHtml(item.kicker)}</span><span class="k-ticker-text">${escapeHtml(item.text)}</span>`;
    if (!swapping || reducedMotion || lightweight) return;
    const swapped = ticker;
    swapped.dataset.swap = '1';
    if (tickerSwap !== null) clearTimer(tickerSwap);
    tickerSwap = oneShot(() => { tickerSwap = null; delete swapped.dataset.swap; }, TICKER_SWAP_MS);
  }
  /** The modules the strip and the ticker both read from: the
   *  session's own copy once paired (fresher, when it has one), the open
   *  teaser otherwise -- the same choice paintStrip has always made. */
  function currentSafetyModules(): ModuleSnapshot[] {
    return phase === 'paired' ? Object.values(mergedSnapshots()).filter((m): m is ModuleSnapshot => Boolean(m)) : teaser;
  }
  /** "Tema: po suncu": the header button's own label, always the controller's
   *  current word -- never guessed, never stale between its own clicks and a
   *  change made elsewhere (?tema=, another tab). */
  function paintTheme(preference: ThemePreference): void {
    // A glyph, with the sentence in the name and the tooltip: "Tema: po suncu" is an operator's word, not a passer-by's.
    const label = fill(s.header.theme, { pref: s.header.themeWord[preference] });
    themeBtn.innerHTML = iconMarkup(THEME_ICON[preference], undefined, 'icon k-icon');
    themeBtn.setAttribute('aria-label', label);
    themeBtn.title = label;
    settings?.paint();
  }
  function cycleTheme(): void {
    const i = THEME_PREFERENCES.indexOf(deps.theme.getPreference());
    deps.theme.setPreference(THEME_PREFERENCES[(i + 1) % THEME_PREFERENCES.length]!);
  }
  /** The četvrt the screen is set to, or null for the whole city -- which is
   *  both a screen set to `zagreb` and a screen that never named an area at
   *  all. The header chip and the invitation's camera read this one answer, so
   *  "no stop, whole city" cannot mean one thing in the words and another in
   *  the picture. */
  function configuredDistrict(): string | null {
    return area && area !== CITY_AREA.slug ? area : null;
  }
  /** The stop chip is the stop's name alone (kajimafix 03.1): a venue's kind or
   *  a temporary screen's expiry are operator facts and belong to the
   *  settings panel, never to a passer-by's header. A screen without a stop
   *  names its četvrt instead; one set to the whole city names nothing -- the
   *  brand beside it already says which city. */
  function paintContext(): void {
    const district = districtLabel(configuredDistrict());
    contextEl.textContent = !credentials ? '' : stop ? stop.name : district;
    // Settings belong to a live screen showing the invitation: never before one
    // exists, never over a granted session, and never over a screen that has
    // expired or been revoked, whose notice carries the one way on.
    settingsBtn.hidden = phase !== 'invitation';
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
      ? i18n.t('presentation.showing', { name: presentationTargetLabel(i18n, presentation.target,mergedSnapshots(),stops??[],cityStore.snapshot()) })
      : fill(s.header.unlockedUntil, { time: clock(sessionExpiresAt) });
    const layer = document.createElement('span');
    layer.className = 'k-session-layer';
    layer.textContent = presentation?.target ? ` · ${i18n.t('presentation.until', { time: clock(sessionExpiresAt) })}` : ` · ${s.layers[activeLayer]}`;
    sessionLabel.replaceChildren(until, layer);
    if (presentation?.target && !headMid.querySelector('[data-testid=kiosk-stop-presentation]')) {
      const back = document.createElement('button');
      back.type = 'button';
      back.className = 'k-return';
      back.dataset.testid = 'kiosk-stop-presentation';
      back.textContent = i18n.t('presentation.stop');
      back.addEventListener('click', () => { if (presentation) beacon?.stopPresentation?.(presentation.revision); });
      headMid.appendChild(back);
    }
  }
  function removeSessionLabel(): void {
    sessionLabel?.remove(); sessionLabel = null; sessionExpiresAt = null;
    headMid.querySelector('[data-testid=kiosk-stop-presentation]')?.remove();
  }

  // --- Safety strip: always present, sharing the visible source state --------
  function paintStrip(): void {
    // A session response may still confirm a source while the preview request
    // fails (and vice versa). All visible safety copy must use the same choice.
    const noBasics = phase === 'paired' || phase === 'setup';
    const built = frameStrip(currentSafetyModules(), stop, i18n, s, now());
    strip.innerHTML = stripMarkup(built, s, { noBasics });
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
  /** Never over a grant (the driver's layer shows more) and never over the start screen. */
  function openEssentials(): void {
    if (phase === 'paired' || phase === 'setup') return;
    closeSettings(false);
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
  /** A phase without a map -- the wizard, a notice, lagano -- keeps the
   *  container alive, off screen and paused. */
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
   *  spans FIELD_SPAN_M of ground whatever the screen (R-KP2; a phone's band
   *  spans half of it). A paired screen keeps the Promet contract (R-KP8). */
  function paintMap(): void {
    const host = currentMapHost();
    const snapshots = phase === 'paired' ? mergedSnapshots() : byModule(teaser);
    // A phase without a map keeps the container parked, and the feed state
    // still reaches it: a map that returns mid-outage must already be holding,
    // never coasting on a state it heard before the outage.
    if (!host) { parkMap(); mapAdapter.setFeedState(feedStateOf(snapshots['zet-rt'])); return; }
    const composition = compositionOf(layout);
    const container = requestKioskMap(maps, {
      stop, snapshots, now: now(), reducedMotion, locale, renderer: mapMode,
      // What the screen was set to frames the invitation when no stop does: a
      // četvrt opens on its outline, the whole city on the city window.
      district: configuredDistrict(),
      city:cityStore.snapshot(),localSelection,localGroup,localCategory,localQuery,exploring,
      onSelect:exploreSelection,
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
      spanM: composition === 'handheld' ? HANDHELD_SPAN_M : FIELD_SPAN_M,
      ariaLabel: stop ? `${s.paired.overviewTransport} · ${stop.name}` : s.paired.overviewTransport,
    }, mapAdapter);
    if (!container) return;
    container.inert=phase!=='invitation'||Boolean(presentation?.target);
    mapContainer = container;
    if (container.parentElement !== host) {
      host.appendChild(container);
      // The box changed while the container sat outside the layout.
      mapAdapter.handle()?.resize?.();
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
    const id = stop?.id ?? null;
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
      invitation?.update(invitationModel());
    }, () => {
      // The loader answers down itself; a rejection here is the injected dependency's, and the table stays absent until the stop changes.
      if (!disposed && lastRunStop === id) lastRunFetch = 'done';
    });
  }

  function invitationModel(): InvitationModel {
    return { modules: teaser, stop, now: now(), lastRun, composition: compositionOf(layout),city:cityStore.snapshot() };
  }
  function pairedContext(): PairedContext {
    // The paired compositions are drawn for a wall; a handheld that is unlocked gets the compact drawing and scrolls it.
    const target = presentation?.target;
    return { layer: activeLayer, strings: s, i18n, locale, snapshots: mergedSnapshots(), now: now(), stop, selection, lightweight, size: layout.size === 'wide' ? 'wide' : 'compact', stops,city:cityStore.snapshot(), ...(target ? { target } : {}) };
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
    invitation?.update(invitationModel());
    paired?.update(pairedContext());
    if(presentation?.target)showSessionLabel(presentation.expiresAt);
    paintTicker();
    paintStrip();
    paintMap();
    paintExplore();
    if (!basics.hidden) paintEssentials();
    fitAll();
    acknowledgePresentation();
  }
  /** Rows that do not fit a paired block are hidden and counted, never half-shown; a statement past two lines is shortened at a word and one the column does not hold is hidden whole. Runs after every paint and on a resize (the invitation also re-fits itself once the fonts arrive); never on the 1 s tick, which has nothing new to measure. */
  function fitAll(): void {
    invitation?.fit();
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
    const copy = element.querySelector<HTMLButtonElement>('[data-testid=pair-copy]');
    if (copy) {
      copy.disabled = !slot;
      copy.innerHTML = iconMarkup('copy');
      copy.setAttribute('aria-label', s.invitation.copyCode);
      copy.title = s.invitation.copyCode;
    }
    const copyStatus = element.querySelector<HTMLElement>('[data-testid=pair-copy-status]');
    if (copyStatus) copyStatus.textContent = '';
    if (!slot) {
      if (qrBox) qrBox.innerHTML = `<p class="k-qr-waiting">${escapeHtml(screenDead ? s.notice.endsAfterSession : s.invitation.qrWaiting)}</p>`;
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
  stage.addEventListener('click', async (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>('[data-testid=pair-copy]');
    const slot = codesAllowed() ? currentSlot : null;
    if (!button || !slot || button.disabled) return;
    button.disabled = true;
    let copied = false;
    try { await navigator.clipboard.writeText(formatCode(slot.code)); copied = true; } catch { /* manual selection remains available */ }
    if (disposed || !button.isConnected) return;
    button.disabled = !codesAllowed() || !currentSlot;
    if (currentSlot?.code !== slot.code) return; // a rotated code has its own label
    const message = i18n.t(copied ? 'session.shareCopied' : 'export.copyFailed');
    button.innerHTML = iconMarkup(copied ? 'check-circle' : 'alert-circle');
    button.title = message;
    button.setAttribute('aria-label', message);
    const status = element.querySelector<HTMLElement>('[data-testid=pair-copy-status]');
    if (status) status.textContent = message;
    if (!copied) {
      const code = element.querySelector('[data-testid=pair-code]');
      if (code) {
        const range = document.createRange();
        range.selectNodeContents(code);
        const selected = window.getSelection();
        selected?.removeAllRanges(); selected?.addRange(range);
      }
    }
  });
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
    const dash = previous.search(/[-·]/);
    ghost.innerHTML = dash === -1
      ? `<span>${escapeHtml(previous)}</span>`
      : `<span>${escapeHtml(previous.slice(0, dash))}</span><span class="k-code-dash">·</span><span>${escapeHtml(previous.slice(dash + 1))}</span>`;
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
    parkMap();
    start?.destroy(); start = null;
    invitation?.destroy(); invitation = null;
    ticker?.remove(); ticker = null;
    paired?.destroy(); paired = null;
    notice?.remove(); notice = null;
  }
  function setPhase(next: KioskPhase): void {
    // Postavke belong to the composition that was on the stage: whatever
    // replaces it -- a grant, a notice, the start screen -- gets the stage
    // back at once, never behind a panel waiting out its 90 s.
    closeSettings(false);
    phase = next;
    // The sheet reads the phase for the stage's room: the invitation is edge to edge, the wizard and the notices keep their padding.
    element.dataset.phase = next;
    element.dataset.mode = next === 'paired' ? 'unlocked' : 'teaser';
    clearStage();
    clearPairingNotice();
    if (next === 'paired') closeEssentials(false);
    else removeSessionLabel();
    if (next === 'setup') mountStartPhase();
    else if (next === 'invitation') {
      invitation = mountInvitation(stage, { strings: s, i18n, locale, lightweight, codeBase: deps.codeBase });
    }
    else if (next === 'paired') paired = mountPaired(stage, { strings: s, i18n, locale, lightweight, codeBase: deps.codeBase, onShell: paintCode });
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
    beaconEpoch += 1;
    beacon?.close(); beacon = null;
    resetPresentation();
    beaconWasLive = false;
    clearAlert('beacon');
    rotation.stop(); rotation = newRotation(); currentSlot = null;
    forgetBeacon(storage);
    credentials = null; stop = null; area = null; screenDead = null;
    disarmExpiry();
    setPhase('setup');
    if (pollingStarted) void loadTeaser();
  }
  function mountStartPhase(): void {
    start = mountStart(stage, {
      strings: s,
      createScreen,
      onCreated: (response) => adoptCredentials({ beaconId: response.beaconId, secret: response.secret, ...(response.screen ? { screen: response.screen } : {}) }, true),
      now,
      setTimeout: oneShot,
      clearTimeout: clearTimer,
    });
  }
  /** Postavke, built on the first press of the gear and kept for the screen's
   *  life. Saving is one `screen-set` frame; the DO's answer re-frames the
   *  wall through applyScreen, exactly as a stop change from the DO does. */
  function openSettings(): void {
    if (!credentials || phase !== 'invitation') return;
    closeEssentials(false);
    settings ??= mountSettings(element, {
      strings: s,
      locale,
      loadStops: async () => { stops = await loadStops(); return stops; },
      screen: () => ({ area, stopId: stop?.id ?? null, expiresAt: credentials?.screen?.expiresAt ?? null }),
      themePreference: () => deps.theme.getPreference(),
      cycleTheme,
      save: (stopId, next) => {
        if (!beacon || beacon.status() !== 'live') return false;
        beacon.setScreen(stopId, next);
        return true;
      },
      forget: startOver,
      onOpen: () => { stage.hidden = true; mapAdapter.handle()?.pause(); },
      onClose: (restoreFocus) => {
        stage.hidden = false;
        if (mapContainer && mapContainer.parentElement !== park) resumeMap();
        if (restoreFocus) settingsBtn.focus();
      },
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
    area = creds.screen?.area ?? null;
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
    const epoch = ++beaconEpoch;
    const current = (): boolean => !disposed && epoch === beaconEpoch;
    beacon = makeBeacon({
      credentials: creds,
      presentationVersion: 1,
      capabilities:['city-v1'],
      onCodes: (batch, serverNow) => { if (current()) rotation.setBatch(batch, serverNow); },
      onContext: (screen) => { if (current()) applyScreen(screen); },
      onError: (error) => { if (current()) settings?.refused(error); },
      onUnlocked: ({ roomId, ticket }) => { if (current()) openSession(roomId, ticket); },
      onPaired: () => {
        if (!current() || phase !== 'invitation') return;
        pairingNoticeUntil = now() + 4500;
        headMid.textContent = i18n.t('presentation.connected');
        headMid.setAttribute('role', 'status');
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
        else if (status === 'live') { beaconWasLive = true; clearAlert('beacon');void cityStore.start().then(()=>cityStore.ensure(['heritage'])); }
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
    selection = null;
    activeLayer = 'grad-sada';
    removeSessionLabel();
    headMid.replaceChildren();
    headMid.removeAttribute('role');
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
    exploring=false;localSelection=null;localQuery='';localCategory='';localLimit=20;paintExplore();
    presentationLoaded = false;
    pairingNoticeUntil = 0;
    headMid.textContent = '';
    headMid.removeAttribute('role');
    sessionLabel = null;
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
    if (selection?.kind === 'stop') void ensureStops();
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
    area = screen.area ?? null;
    paintContext();
    settings?.paint();
    // The panel is waiting for exactly this: the screen it asked for.
    settings?.applied();
    armExpiry();
    // The screen follows its stop at once (the field's name, the camera, the last-run table dropped), then asks for that stop's own teaser.
    paintLocal();
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
  async function ensureStops(): Promise<void> {
    try {
      stops = await loadStops();
      if (!disposed) paintLocal();
    } catch {
      // Resolved failure is distinct from a stop list still loading. A later
      // explicit request may retry; this one must not claim a rendered stop.
      if (!disposed) { stops = []; paintLocal(); }
    }
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
  settingsBtn.addEventListener('click', openSettings);
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
    if (changed) { paintLocal(); return; }
    paintMap();
    fitAll();
  });

  const codeTimer = setTimer(() => {
    if(exploring&&now()>=exploreUntil)endExplore();
    paintClock();
    paintProgress();
    // The notice's own end comes before the repaint that reads the middle: the
    // second it stops speaking is the second the ticker has the room back.
    if (pairingNoticeUntil > 0 && now() >= pairingNoticeUntil) clearPairingNotice();
    paintTicker();
    if (presentation?.target && presentation.expiresAt !== null && rotation.serverNow() >= presentation.expiresAt) {
      presentation = { ...presentation, target: null, dataToken: undefined };
      endSession();
    }
    if (presentation?.target) acknowledgePresentation();
    // The column names the ZET time in a context: it repaints when the minute turns, never every second.
    const minute = Math.floor(now() / 60_000);
    if (minute !== paintedMinute && invitation) {
      paintedMinute = minute;
      ensureLastRun();
      invitation.update(invitationModel());
    }
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
  const stopCity=cityStore.subscribe(()=>{if(!disposed){paintLocal();paintExplore();}});

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
      if (tickerSwap !== null) { clearTimer(tickerSwap); tickerSwap = null; }
      if (teaserTimer !== null) { clearTimer(teaserTimer); teaserTimer = null; }
      disarmExpiry();
      disarmEssentialsIdle();
      stopRepaint?.();
      stopTheme();
      beacon?.close(); beacon = null;
      session?.close(); session = null;
      settings?.destroy(); settings = null;
      clearStage();
      maps.destroy();
      element.remove();
    },
  };
}
