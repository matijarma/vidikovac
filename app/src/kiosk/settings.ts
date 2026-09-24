// Postavke: the screen's own settings, an overlay over the stage like Osnovno
// (Escape, a close button, 90 s idle), never over a granted session. Nothing
// in the header points at it: a press held on the brand opens it
// (bindLongPress), so a passer-by's screen carries no operator control.
//
// Six rows of click-toggles, each click changing the state at once -- no
// draft, no Spremi: Mjesto (the place, changed through the shared "Adresa ili
// stajalište" field or set to the whole city), Kadar (4 / 6 / 8 stops),
// Prikaz (map / schema), Tema, Ritam (20 / 30 / 60 s) and Zaslon (the expiry
// and the one way to forget the screen).
//
// Mjesto and Kadar live on the screen's record, so they travel to the DO as
// one screen-set version 2 frame through the SendQueue: 0.8 s after the last
// click, one frame in flight, a new frame only SCREEN_SET_MIN_MS after the
// DO's last answer, the latest state winning and nothing equal to what the DO
// already has. The DO's answer re-frames the wall through applyScreen --
// nothing here paints the map or the header -- and a refusal, a frame the
// socket could not carry, or no answer in eight seconds repaints the toggles
// from the DO's truth with one sentence; nothing is re-sent by the clock.
// Prikaz, Tema and Ritam belong to this browser (kiosk/prefs.ts, the theme
// controller) and apply at once.
import type { ScreenMetadata } from '../../../worker/protocol';
import { SCREEN_SET_ERRORS, SCREEN_SET_MIN_MS } from '../../../worker/protocol';
import { DEFAULT_FRAME_STOPS, FRAME_STOPS, frameRadiusM, frameSpanM, frameStopsFrom, isFrameStops, type FrameStop, type FrameStops } from '../../../shared/city/frame';
import { placeFromStop, type ScreenPlace } from '../../../shared/city/place';
import type { ScreenSetInput } from '../beacon';
import type { ScreenStop } from '../core/contracts';
import { escapeHtml } from '../ui/dom/escape';
import { vetExternal } from '../../../shared/kiosk/external-text-boundary';
import { iconMarkup, type IconName } from '../ui/icons';
import type { ThemePreference } from '../ui/theme';
import { LONG_PRESS_MS } from './constants';
import { clock, sameZagrebDay, weekdayDayMonth } from './format';
import { FIELD_SPAN_M, HANDHELD_SPAN_M } from './mapview';
import { placeInputOf } from './places';
import { nextInCycle, RHYTHMS, WALL_VIEWS, type Rhythm, type WallView } from './prefs';
import { fill, type KioskStrings } from './strings';

/** Untouched for this long, the panel closes itself and the screen returns to the invitation. */
export const SETTINGS_IDLE_MS = 90_000;
/** How long a frame waits for the DO's answer before the panel says it did
 *  not land: the same eight seconds the phone gives a presentation receipt
 *  (docs/kiosk.md). Nothing is re-sent and nothing is forgotten -- an answer
 *  that arrives after it is still the DO's truth. */
export const SAVE_TIMEOUT_MS = 8_000;
/** Mjesto and Kadar go to the DO this long after the last click, so three
 *  quick clicks are one frame carrying the last state. */
export const SETTINGS_SEND_DELAY_MS = 800;
/** A finger that moves further than this while holding the brand is a swipe, not a press. */
export const LONG_PRESS_SLOP_PX = 12;
/** The theme toggle's glyph per preference, moved from the header with the toggle itself. */
const THEME_ICON: Record<ThemePreference, IconName> = { auto: 'sun-moon', light: 'sun', dark: 'moon', solar: 'sunset' };

// --- What the wall and the panel read from the screen's record ---------------

/** The place the header names, whether the operator chose it, and the frame. */
export interface WallPlace {
  /** The DO's place (Trg bana Jelačića for an empty field, read-path enriched), or null before the DO's first answer on a record that has none. */
  place: ScreenPlace | null;
  /** True when the operator chose the place: the map then frames it; false keeps the whole-city window [O-65]. */
  placeSet: boolean;
  frame: FrameStops;
}

/**
 * One answer for the header's words, the camera and the settings rows. A record (or a stored
 * copy of one) from before place-v2 names only its stop: that stop is the place its operator
 * chose, as the DO's own read-path enrichment says. A record with no place and no stop is the
 * whole city until the DO says which place it lists.
 */
export function wallPlaceOf(screen: ScreenMetadata | null | undefined, isTram: (routeId: string) => boolean): WallPlace {
  const stored = screen?.frame;
  const frame = isFrameStops(stored) ? stored : DEFAULT_FRAME_STOPS;
  if (screen?.place) return { place: screen.place, placeSet: screen.placeSet !== false, frame };
  if (screen && screen.place === undefined && screen.stop) return { place: placeFromStop(screen.stop, isTram), placeSet: true, frame };
  return { place: null, placeSet: false, frame };
}

const FRAME_STOPS_OF = new WeakMap<readonly ScreenStop[], FrameStop[]>();

/**
 * The invitation camera's span: a phone's band; the whole circle of the frame measured around
 * a chosen place (shared/city/frame.ts, [O-68]; the table's radius until the stop list has
 * loaded); the whole-city field otherwise.
 */
export function wallSpanM(input: { handheld: boolean; wall: WallPlace; stops: readonly ScreenStop[] | null; isTram: (routeId: string) => boolean }): number {
  if (input.handheld) return HANDHELD_SPAN_M;
  if (!input.wall.placeSet || !input.wall.place) return FIELD_SPAN_M;
  const table = input.stops ?? [];
  let frameStops = FRAME_STOPS_OF.get(table);
  if (!frameStops) { frameStops = frameStopsFrom(table, input.isTram); FRAME_STOPS_OF.set(table, frameStops); }
  return frameSpanM(frameRadiusM(input.wall.place, frameStops, input.wall.frame));
}

// --- The long press on the brand ----------------------------------------------

export interface LongPressDeps {
  open: () => void;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
  /** Whether this press arms at all (kiosk.ts: the wall-wide press skips the touch's own targets, the brand and the
   *  panel). Omitted, every primary press arms. The same answer decides whether the context menu is suppressed. */
  accept?: (event: MouseEvent) => boolean;
  /** `false` binds no keyboard: a target whose keys belong to what is inside it (the kiosk root). Default true. */
  keys?: boolean;
}

/**
 * A press held on `target` for LONG_PRESS_MS opens the settings; a shorter press, a finger that
 * moves more than LONG_PRESS_SLOP_PX, or a pointer that leaves opens nothing. Enter or Space on
 * the focused target opens at once (a keyboard is an operator's tool). The timer goes through
 * the injected pair, so the kiosk's clock -- and a test's -- drives it. The press is never
 * stopped: the kiosk's first-tap fullscreen and wake-lock listener hears it too. Returns the
 * unbinding.
 */
export function bindLongPress(target: HTMLElement, deps: LongPressDeps): () => void {
  let timer: unknown = null;
  let origin: { x: number; y: number } | null = null;
  const disarm = (): void => {
    if (timer !== null) { deps.clearTimeout(timer); timer = null; }
    origin = null;
  };
  const down = (event: PointerEvent): void => {
    if (event.button > 0) return; // a secondary button is not a press
    disarm();
    if (deps.accept && !deps.accept(event)) return;
    origin = { x: event.clientX, y: event.clientY };
    timer = deps.setTimeout(() => { timer = null; origin = null; deps.open(); }, LONG_PRESS_MS);
  };
  const move = (event: PointerEvent): void => {
    if (origin && Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > LONG_PRESS_SLOP_PX) disarm();
  };
  const key = (event: KeyboardEvent): void => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    if (event.repeat) return;
    disarm();
    deps.open();
  };
  // A held finger on a touch screen otherwise asks for the context menu or a text selection.
  const menu = (event: MouseEvent): void => { if (!deps.accept || deps.accept(event)) event.preventDefault(); };
  const keys = deps.keys !== false;
  const ends = ['pointerup', 'pointercancel', 'pointerleave'] as const;
  target.addEventListener('pointerdown', down);
  target.addEventListener('pointermove', move);
  for (const type of ends) target.addEventListener(type, disarm);
  if (keys) target.addEventListener('keydown', key);
  target.addEventListener('contextmenu', menu);
  return () => {
    disarm();
    target.removeEventListener('pointerdown', down);
    target.removeEventListener('pointermove', move);
    for (const type of ends) target.removeEventListener(type, disarm);
    if (keys) target.removeEventListener('keydown', key);
    target.removeEventListener('contextmenu', menu);
  };
}

// --- The send queue -------------------------------------------------------------

/** What the panel changes on the screen's record: the chosen place (null for the whole city) and the frame. */
export interface SettingsState {
  place: ScreenPlace | null;
  frame: FrameStops;
}

/** Why a change did not land: no socket or no answer in time, a refusal, a frame inside the DO's window. */
export type SendFailure = 'offline' | 'refused' | 'busy';

export interface SendQueueDeps {
  /** The DO's truth, as the last screen it sent says. */
  current: () => SettingsState;
  /** Puts one frame on the socket; false when the socket cannot carry it now. */
  send: (state: SettingsState) => boolean;
  /** The change did not land; the queue has dropped it, and the panel repaints from current(). */
  onFail: (why: SendFailure) => void;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

export interface SendQueue {
  /** The operator's latest state; sent SETTINGS_SEND_DELAY_MS after the last change, when the window allows. */
  change(next: SettingsState): void;
  /** What the toggles show: the change waiting to be sent, else the one in flight, else the DO's truth. */
  shown(): SettingsState;
  /** A screen arrived from the DO. If it is the one in flight, that frame has landed and the window starts. */
  answered(): void;
  /** The DO answered with an error word; true when it was this queue's frame being refused. */
  refused(error: string): boolean;
  cancel(): void;
}

function sameText(a: string | undefined, b: string | undefined): boolean {
  return (a ?? '').trim() === (b ?? '').trim();
}

/** The same place as the DO would store it: a stop by its id, an address by its name and point, the typed address alike. */
export function samePlace(a: ScreenPlace | null, b: ScreenPlace | null): boolean {
  if (!a || !b) return !a && !b;
  if (!sameText(a.address, b.address)) return false;
  if (a.kind !== 'address' && b.kind !== 'address') return a.stopId === b.stopId;
  return a.kind === b.kind && sameText(a.name, b.name) && Math.abs(a.lon - b.lon) < 1e-5 && Math.abs(a.lat - b.lat) < 1e-5;
}

export function sameSettings(a: SettingsState, b: SettingsState): boolean {
  return a.frame === b.frame && samePlace(a.place, b.place);
}

/**
 * The DO takes one screen-set per socket per SCREEN_SET_MIN_MS and answers every other one
 * 'screen-set-rate'. Clicks are cheaper than that, so they collect here: the latest state
 * waits SETTINGS_SEND_DELAY_MS after the last change, then goes when no frame is in flight and
 * SCREEN_SET_MIN_MS have passed since the DO's last answer (counted from the answer, not the
 * send, so a slow first hop can never make the next frame early on the DO's clock). A state
 * equal to the DO's truth, or to the frame already in flight, is not sent. Any failure drops
 * what was waiting and says so once; nothing is ever re-sent by the clock.
 */
export function createSendQueue(deps: SendQueueDeps): SendQueue {
  let desired: SettingsState | null = null;
  let inFlight: SettingsState | null = null;
  let debounce: unknown = null;
  let waiting: unknown = null;
  /** SCREEN_SET_MIN_MS after the DO's last answer; no frame goes while it runs. */
  let spacing: unknown = null;
  const cancelTimer = (handle: unknown): null => { if (handle !== null) deps.clearTimeout(handle); return null; };

  function drop(): void {
    desired = null;
    inFlight = null;
    debounce = cancelTimer(debounce);
    waiting = cancelTimer(waiting);
  }
  function fail(why: SendFailure): void {
    drop();
    deps.onFail(why);
  }
  function startWindow(): void {
    spacing = cancelTimer(spacing);
    spacing = deps.setTimeout(() => { spacing = null; flush(); }, SCREEN_SET_MIN_MS);
  }
  function flush(): void {
    if (!desired || debounce !== null || inFlight || spacing !== null) return;
    const next = desired;
    desired = null;
    if (sameSettings(next, deps.current())) return;
    if (!deps.send(next)) { fail('offline'); return; }
    inFlight = next;
    waiting = deps.setTimeout(() => { waiting = null; fail('offline'); }, SAVE_TIMEOUT_MS);
  }

  return {
    change(next) {
      desired = next;
      debounce = cancelTimer(debounce);
      debounce = deps.setTimeout(() => { debounce = null; flush(); }, SETTINGS_SEND_DELAY_MS);
    },
    shown: () => desired ?? inFlight ?? deps.current(),
    answered() {
      if (!inFlight || !sameSettings(inFlight, deps.current())) return;
      inFlight = null;
      waiting = cancelTimer(waiting);
      startWindow();
    },
    refused(error) {
      if (!inFlight || !(SCREEN_SET_ERRORS as readonly string[]).includes(error)) return false;
      fail(error === 'screen-set-rate' ? 'busy' : 'refused');
      startWindow();
      return true;
    },
    cancel() {
      drop();
      spacing = cancelTimer(spacing);
    },
  };
}

// --- The panel ------------------------------------------------------------------

/** What the panel reads about the screen every time it paints. */
export interface SettingsScreen extends SettingsState {
  /** Unix ms, or null for a screen that does not expire. */
  expiresAt: number | null;
}

/** What the Mjesto row hands the shared "Adresa ili stajalište" field (kiosk/place-field.ts). */
export interface PlaceFieldOptions {
  initial: ScreenPlace | null;
  /** Where "nearest first" starts and distances are counted from: the place shown. Absent for the
   *  whole city, where the field ranks from the city centre (places.ts) and prints no distance. */
  near?: { lon: number; lat: number };
  /** A picked suggestion as a derived place; null and the typed text when the field was cleared or matched nothing. */
  onChange: (place: ScreenPlace | null, unresolved: string) => void;
}

export interface PlaceFieldHandle {
  focus(): void;
  destroy(): void;
}

/** kiosk.ts binds the field's strings, loaders, tram test and timers; the panel supplies the rest. */
export type PlaceFieldMount = (host: HTMLElement, options: PlaceFieldOptions) => PlaceFieldHandle;

export interface SettingsDeps {
  strings: KioskStrings;
  locale: string;
  screen: () => SettingsScreen;
  placeField: PlaceFieldMount;
  themePreference: () => ThemePreference;
  cycleTheme: () => void;
  rhythm: () => Rhythm;
  setRhythm: (rhythm: Rhythm) => void;
  view: () => WallView;
  setView: (view: WallView) => void;
  /** Sends one screen-set version 2 frame; false when the socket cannot carry it now. */
  save: (input: ScreenSetInput) => boolean;
  /** Forget the screen and start over; the panel is closed by then. */
  forget: () => void;
  onOpen?: () => void;
  onClose?: (restoreFocus: boolean) => void;
  /** The screen's own clock, so the expiry line can tell today from tomorrow. */
  now: () => number;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

export interface SettingsHandle {
  element: HTMLElement;
  open(): void;
  /** `restoreFocus` false is for a phase change, where the thing that opened the panel is going away. */
  close(restoreFocus?: boolean): void;
  isOpen(): boolean;
  /** Repaints every row: a change waiting to be sent, else the one in flight, else the DO's screen; the theme word; the expiry. */
  paint(): void;
  /** A screen arrived from the DO (applyScreen): the frame in flight has landed if it asked for this one. The panel stays open. */
  applied(): void;
  /** The DO answered with an error word; one that is not a screen-set refusal belongs to something else and is ignored. */
  refused(error: string): void;
  destroy(): void;
}

function toggle(testid: string): string {
  return `<button type="button" class="k-btn k-btn--ghost k-toggle" data-testid="${testid}"></button>`;
}

function settingsMarkup(s: KioskStrings): string {
  const row = (name: string, label: string, body: string): string =>
    `<section class="k-settings-row" data-row="${name}"><h3 class="k-settings-label">${escapeHtml(label)}</h3>${body}</section>`;
  return `<header class="k-basics-head">
      <div>
        <h2 id="k-settings-title" class="k-basics-title" tabindex="-1">${escapeHtml(s.settings.title)}</h2>
        <p class="k-basics-hint">${escapeHtml(s.settings.hint)}</p>
      </div>
      <button type="button" class="k-btn k-btn--ghost" data-testid="kiosk-settings-close">${escapeHtml(s.settings.close)}</button>
    </header>
    <div class="k-settings-rows">
      ${row('place', s.settings.place, `<p class="k-settings-value" data-testid="settings-place"></p>
        <button type="button" class="k-btn k-btn--ghost k-toggle" data-testid="toggle-place" aria-expanded="false" aria-controls="k-settings-place-edit">${escapeHtml(s.settings.placeChange)}</button>
        <div class="k-settings-place-edit" id="k-settings-place-edit" data-testid="settings-place-edit" hidden>
          <div class="k-settings-place-field"></div>
          <button type="button" class="k-btn k-btn--ghost k-toggle" data-testid="settings-place-city">${escapeHtml(s.settings.areaWhole)}</button>
        </div>`)}
      ${row('frame', s.settings.frame, toggle('toggle-frame'))}
      ${row('view', s.settings.view, toggle('toggle-view'))}
      ${row('theme', s.settings.theme, toggle('toggle-theme'))}
      ${row('rhythm', s.settings.rhythm, toggle('toggle-rhythm'))}
      ${row('screen', s.settings.screen, `<p class="k-setup-hint" data-testid="settings-expiry"></p>
        <button type="button" class="k-btn k-btn--ghost" data-testid="settings-forget">${escapeHtml(s.settings.forget)}</button>
        <div class="k-settings-confirm" data-testid="settings-forget-confirm" hidden>
          <p class="k-setup-hint">${escapeHtml(s.settings.forgetAsk)}</p>
          <button type="button" class="k-btn k-btn--ghost" data-testid="settings-forget-yes">${escapeHtml(s.settings.forgetYes)}</button>
          <button type="button" class="k-btn k-btn--ghost" data-testid="settings-forget-no">${escapeHtml(s.settings.forgetNo)}</button>
        </div>`)}
    </div>
    <p class="k-setup-error" role="alert" data-testid="settings-error" hidden></p>`;
}

/** The Mjesto row's value: a stop's name with the typed address beside it, an address as typed, or the whole city. */
export function placeText(s: KioskStrings, place: ScreenPlace | null): string {
  if (!place) return s.settings.areaWhole;
  const address = place.address?.trim();
  if (place.kind === 'address') return address || place.name;
  return address ? `${place.name} · ${address}` : place.name;
}

export function mountSettings(host: HTMLElement, deps: SettingsDeps): SettingsHandle {
  const { strings: s, locale } = deps;
  const element = document.createElement('section');
  element.className = 'k-basics k-settings';
  element.dataset.testid = 'kiosk-settings-panel';
  element.hidden = true;
  element.setAttribute('aria-labelledby', 'k-settings-title');
  element.innerHTML = settingsMarkup(s);
  host.appendChild(element);
  const q = <T extends HTMLElement>(selector: string): T => element.querySelector<T>(selector)!;
  const heading = q('#k-settings-title');
  const placeValue = q('[data-testid=settings-place]');
  const placeToggle = q<HTMLButtonElement>('[data-testid=toggle-place]');
  const placeEdit = q('[data-testid=settings-place-edit]');
  const placeHost = q('.k-settings-place-field');
  const placeCity = q<HTMLButtonElement>('[data-testid=settings-place-city]');
  const frameBtn = q<HTMLButtonElement>('[data-testid=toggle-frame]');
  const viewBtn = q<HTMLButtonElement>('[data-testid=toggle-view]');
  const themeBtn = q<HTMLButtonElement>('[data-testid=toggle-theme]');
  const rhythmBtn = q<HTMLButtonElement>('[data-testid=toggle-rhythm]');
  const expiryEl = q('[data-testid=settings-expiry]');
  const forgetBtn = q<HTMLButtonElement>('[data-testid=settings-forget]');
  const confirmBox = q('[data-testid=settings-forget-confirm]');
  const errorEl = q('[data-testid=settings-error]');

  let idle: unknown = null;
  let field: PlaceFieldHandle | null = null;

  function showError(text: string): void { errorEl.textContent = text; errorEl.hidden = false; }
  function clearError(): void { errorEl.hidden = true; errorEl.textContent = ''; }

  const queue = createSendQueue({
    current: () => { const { place, frame } = deps.screen(); return { place, frame }; },
    send: (state) => deps.save({ place: state.place ? placeInputOf(state.place) : null, frame: state.frame }),
    onFail: (why) => {
      showError(why === 'busy' ? s.settings.saveBusy : why === 'refused' ? s.settings.saveRefused : s.settings.saveOffline);
      paintRows();
    },
    setTimeout: deps.setTimeout,
    clearTimeout: deps.clearTimeout,
  });

  function paintTheme(): void {
    const preference = deps.themePreference();
    themeBtn.dataset.value = preference;
    themeBtn.innerHTML = `${iconMarkup(THEME_ICON[preference], undefined, 'icon k-icon')}<span>${escapeHtml(fill(s.header.theme, { pref: s.header.themeWord[preference] }))}</span>`;
  }
  /** Every toggle names its current state, so the one button is both the value and the way to change it. */
  function paintRows(): void {
    const shown = queue.shown();
    placeValue.textContent = vetExternal('name', placeText(s, shown.place), 'row') ?? '';
    // "Cijeli grad" is offered only while the screen names a place: pressing it on the whole city says nothing new.
    placeCity.hidden = shown.place === null;
    frameBtn.dataset.value = String(shown.frame);
    frameBtn.textContent = fill(s.settings.frameValue, { count: shown.frame });
    const view = deps.view();
    viewBtn.dataset.value = view;
    viewBtn.textContent = view === 'schema' ? s.settings.viewSchema : s.settings.viewMap;
    const rhythm = deps.rhythm();
    rhythmBtn.dataset.value = String(rhythm);
    rhythmBtn.textContent = fill(s.settings.rhythmValue, { seconds: rhythm });
    paintTheme();
  }
  /** A temporary screen is good for 24 hours, so the end of a screen made at
   *  23:40 is 23:40 TOMORROW -- and "Vrijedi do 23:43" on a panel opened at
   *  23:43 reads as "it is over now". A clock alone is only honest while the
   *  end falls on today; past midnight the day goes with it. */
  function paintScreenRow(): void {
    const { expiresAt } = deps.screen();
    if (expiresAt === null) { expiryEl.textContent = s.settings.expiryNone; return; }
    const time = clock(expiresAt);
    const when = sameZagrebDay(expiresAt, deps.now()) ? time : `${weekdayDayMonth(locale, expiresAt)} ${time}`;
    expiryEl.textContent = fill(s.settings.expiry, { time: when });
  }
  function hideConfirm(): void {
    confirmBox.hidden = true;
    forgetBtn.hidden = false;
  }

  function disarmIdle(): void {
    if (idle === null) return;
    deps.clearTimeout(idle);
    idle = null;
  }
  function armIdle(): void {
    disarmIdle();
    idle = deps.setTimeout(() => { idle = null; close(); }, SETTINGS_IDLE_MS);
  }

  /** A click is the change: the toggles say it at once, the queue sends it. */
  function choose(next: SettingsState): void {
    clearError();
    queue.change(next);
    paintRows();
    armIdle();
  }

  function closePlaceEdit(): void {
    field?.destroy();
    field = null;
    placeHost.replaceChildren();
    placeEdit.hidden = true;
    placeToggle.setAttribute('aria-expanded', 'false');
  }
  function openPlaceEdit(): void {
    const shown = queue.shown().place;
    placeEdit.hidden = false;
    placeToggle.setAttribute('aria-expanded', 'true');
    field = deps.placeField(placeHost, {
      initial: shown,
      ...(shown ? { near: shown } : {}),
      // Only a picked place is a change; clearing the field or typing what matches nothing is not
      // the whole city -- "Cijeli grad" is its own button.
      onChange: (place) => {
        if (!place) return;
        closePlaceEdit();
        choose({ place, frame: queue.shown().frame });
      },
    });
    field.focus();
  }

  function open(): void {
    if (!element.hidden) return;
    clearError();
    hideConfirm();
    paintRows();
    paintScreenRow();
    element.hidden = false;
    deps.onOpen?.();
    heading.focus();
    armIdle();
  }
  /** Closing never takes a click back: a change waiting in the queue is still sent. */
  function close(restoreFocus = true): void {
    disarmIdle();
    if (element.hidden) return;
    element.hidden = true;
    closePlaceEdit();
    hideConfirm();
    deps.onClose?.(restoreFocus);
  }

  placeToggle.addEventListener('click', () => { if (field) closePlaceEdit(); else openPlaceEdit(); armIdle(); });
  placeCity.addEventListener('click', () => { closePlaceEdit(); choose({ place: null, frame: queue.shown().frame }); });
  frameBtn.addEventListener('click', () => {
    const shown = queue.shown();
    choose({ place: shown.place, frame: nextInCycle(FRAME_STOPS, shown.frame) });
  });
  viewBtn.addEventListener('click', () => { deps.setView(nextInCycle(WALL_VIEWS, deps.view())); paintRows(); armIdle(); });
  themeBtn.addEventListener('click', () => { deps.cycleTheme(); paintTheme(); armIdle(); });
  rhythmBtn.addEventListener('click', () => { deps.setRhythm(nextInCycle(RHYTHMS, deps.rhythm())); paintRows(); armIdle(); });
  // Forgetting a screen is two presses, never one: the confirmation stands in
  // place of the button that opened it.
  forgetBtn.addEventListener('click', () => { forgetBtn.hidden = true; confirmBox.hidden = false; armIdle(); });
  q('[data-testid=settings-forget-no]').addEventListener('click', () => { hideConfirm(); armIdle(); });
  q('[data-testid=settings-forget-yes]').addEventListener('click', () => { queue.cancel(); close(false); deps.forget(); });
  q('[data-testid=kiosk-settings-close]').addEventListener('click', () => close());
  element.addEventListener('pointerdown', armIdle);
  element.addEventListener('keydown', (event) => {
    // An Escape the place field already used (closing its suggestions) is not the panel's.
    if (event.key === 'Escape' && !event.defaultPrevented) { close(); return; }
    armIdle();
  });

  return {
    element,
    open,
    close,
    isOpen: () => !element.hidden,
    paint: () => { paintRows(); paintScreenRow(); },
    applied: () => { queue.answered(); paintRows(); paintScreenRow(); },
    refused: (error) => { if (queue.refused(error) && !element.hidden) armIdle(); },
    destroy() {
      disarmIdle();
      queue.cancel();
      closePlaceEdit();
      element.remove();
    },
  };
}
