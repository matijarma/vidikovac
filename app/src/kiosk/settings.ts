// Postavke: the screen's own settings, an overlay over the stage like Osnovno
// (Escape, a close button, 90 s idle), never over a granted session. Nothing
// in the header points at it: a press held on the brand opens it
// (bindLongPress), so a passer-by's screen carries no operator control.
//
// Six rows of click-toggles, each click changing the state at once -- no
// draft, no Spremi: Mjesto (the place, changed through the shared "Adresa ili
// stajalište" field or set to the whole city), Kadar (2 / 4 / 6 stops),
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
import { DEFAULT_FRAME, FRAME_CITY, FRAME_CYCLE, frameRadiusM, frameSpanM, frameStopsFrom, frameStopsOf, isFrame, type Frame, type FrameStop } from '../../../shared/city/frame';
import { placeFromStop, type ScreenPlace } from '../../../shared/city/place';
import type { ScreenSetInput } from '../beacon';
import type { ScreenStop } from '../core/contracts';
import { escapeHtml } from '../ui/dom/escape';
import { vetExternal } from '../../../shared/kiosk/external-text-boundary';
import { iconMarkup, type IconName } from '../ui/icons';
import type { ThemePreference } from '../ui/theme';
import { DOUBLE_TAP_MS, DOUBLE_TAP_SLOP_PX, LONG_PRESS_BEAT_MS, LONG_PRESS_MS } from './constants';
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
  /** True when the operator chose the place (the header names it as theirs); false is the read-path default place. The
   *  camera follows the Kadar either way (kiosk/mapview.ts framedPlace): 2 / 4 / 6 frame the place, `city` the whole city. */
  placeSet: boolean;
  frame: Frame;
}

/**
 * One answer for the header's words, the camera and the settings rows. A record (or a stored
 * copy of one) from before place-v2 names only its stop: that stop is the place its operator
 * chose, as the DO's own read-path enrichment says. A record with no place and no stop is the
 * whole city until the DO says which place it lists.
 */
export function wallPlaceOf(screen: ScreenMetadata | null | undefined, isTram: (routeId: string) => boolean): WallPlace {
  const stored = screen?.frame;
  const frame = isFrame(stored) ? stored : DEFAULT_FRAME;
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
export function wallSpanM(input: { handheld: boolean; wall: WallPlace; place?: ScreenPlace | null; stops: readonly ScreenStop[] | null; isTram: (routeId: string) => boolean }): number {
  if (input.handheld) return HANDHELD_SPAN_M;
  const place = input.place ?? input.wall.place;
  if (input.wall.frame === FRAME_CITY || !place) return FIELD_SPAN_M;
  const table = input.stops ?? [];
  let frameStops = FRAME_STOPS_OF.get(table);
  if (!frameStops) { frameStops = frameStopsFrom(table, input.isTram); FRAME_STOPS_OF.set(table, frameStops); }
  return frameSpanM(frameRadiusM(place, frameStops, frameStopsOf(input.wall.frame)));
}

// --- The long press on the brand ----------------------------------------------

/** How the panel was asked for: a press held (a finger, a mouse) or the keyboard (Enter, Space). */
export type LongPressVia = 'pointer' | 'keyboard';
export interface LongPressDeps {
  open: (via: LongPressVia) => void;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
  /** An animation frame between the timer and its beat (review N6): a coalesced pointermove is delivered before
   *  the frame's callbacks, so a swipe whose move waited for the frame ends the press before the beat judges it.
   *  Absent (a harness without frames), the beat follows the timer at once. */
  raf?: (fn: () => void) => unknown;
  cancelRaf?: (handle: unknown) => void;
  /** Whether this press arms at all (kiosk.ts: the wall-wide press skips the touch's own targets, the brand and the
   *  panel). Omitted, every primary press arms. The same answer decides whether the context menu is suppressed. */
  accept?: (event: MouseEvent) => boolean;
  /** `false` binds no keyboard: a target whose keys belong to what is inside it (the kiosk root). Default true. */
  keys?: boolean;
}

/**
 * A press held on `target` for LONG_PRESS_MS opens the settings; a shorter press, a finger that
 * moves more than LONG_PRESS_SLOP_PX, or a pointer that leaves opens nothing. Enter or Space on
 * the focused target opens at once (a keyboard is an operator's tool). The click that follows a
 * press that opened is swallowed on the target, so the press is never also a tap. The timer goes through
 * the injected pair, so the kiosk's clock -- and a test's -- drives it. The press is never
 * stopped: the kiosk's first-tap wake-lock listener and its double tap hear it too. Returns the
 * unbinding.
 *
 * The press is judged twice, and the timer is only the early answer. While the finger stays
 * down the timer opens the panel at LONG_PRESS_MS; but a timer runs only when the main thread
 * is free, and a wall drawing its map (software WebGL, a tile decode, the first paint) holds it
 * for whole seconds: on the release smoke of D5.21 an 800 ms timer fired 600 to 3000 ms late
 * under load, after a real 0.9 to 1.2 s press had already let go, so nothing ever opened. The
 * release therefore judges the press by its own duration: the pointer events carry the input's
 * own timestamps, which are right however late their handlers run, and a pointerup stamped
 * LONG_PRESS_MS or more after its pointerdown opens the panel then, once, whether or not the
 * timer got its turn. A clock the tests fake never reaches these stamps, which is why the
 * unit tests set them on the events themselves.
 */
/** What retires the swallow of a long press's click: the next gesture, a finger or a key. */
const RETIRES = ['pointerdown', 'keydown'] as const;

export function bindLongPress(target: HTMLElement, deps: LongPressDeps): () => void {
  let timer: unknown = null;
  /** The frame after the timer (review N6), then the beat. */
  let frame: unknown = null;
  /** The beat after the timer (review N2): the open waits one task of the same clock, so a pointermove the
   *  queue holds (a swipe whose events ran late behind the map's work) still ends the press first. */
  let beat: unknown = null;
  let origin: { x: number; y: number } | null = null;
  /** The pointerdown's own timestamp while a press is armed and the timer has not opened yet. */
  let downAt: number | null = null;
  /** The pointers down on the whole document right now (review N3, N7): a press is one finger, wherever the
   *  other one rests. Shared by every binding of the document, kept by listeners on the document itself. */
  const pointers = downPointers(target.ownerDocument);
  const disarm = (): void => {
    if (timer !== null) { deps.clearTimeout(timer); timer = null; }
    if (frame !== null) { deps.cancelRaf?.(frame); frame = null; }
    if (beat !== null) { deps.clearTimeout(beat); beat = null; }
    origin = null;
    downAt = null;
  };
  const near = (event: PointerEvent): boolean => origin !== null && Math.hypot(event.clientX - origin.x, event.clientY - origin.y) <= LONG_PRESS_SLOP_PX;
  /** The click a press's release makes after the press opened the panel belongs to the press, not to a tap: kiosk.ts
   *  onTouch would open a row's detail under Postavke (5 Oct 2026, the press arms on the rows too). It is swallowed
   *  once, in the capture phase on the target, before anything inside or below hears it. The next pointerdown or key
   *  anywhere retires the swallow, so a release that made no click here can never eat a later tap. */
  let swallowing: (() => void) | null = null;
  const swallowClick = (): void => {
    swallowing?.();
    const doc = target.ownerDocument;
    const eat = (event: Event): void => { event.stopPropagation(); event.preventDefault(); retire(); };
    const retire = (): void => {
      target.removeEventListener('click', eat, true);
      for (const type of RETIRES) doc.removeEventListener(type, retire, true);
      swallowing = null;
    };
    target.addEventListener('click', eat, true);
    for (const type of RETIRES) doc.addEventListener(type, retire, true);
    swallowing = retire;
  };
  const opened = (): void => { swallowClick(); deps.open('pointer'); };
  const onBeat = (): void => { beat = null; if (origin === null) return; disarm(); opened(); };
  const down = (event: PointerEvent): void => {
    if (event.button > 0) return; // a secondary button is not a press
    disarm();
    // Two fingers resting on the wall are not a press (N3): nothing arms while more than one is down.
    if (pointers.size > 1) return;
    if (deps.accept && !deps.accept(event)) return;
    origin = { x: event.clientX, y: event.clientY };
    downAt = event.timeStamp;
    timer = deps.setTimeout(() => {
      timer = null;
      if (deps.raf) frame = deps.raf(() => { frame = null; beat = deps.setTimeout(onBeat, LONG_PRESS_BEAT_MS); });
      else beat = deps.setTimeout(onBeat, LONG_PRESS_BEAT_MS);
    }, LONG_PRESS_MS);
  };
  const move = (event: PointerEvent): void => {
    if (origin && !near(event)) disarm();
  };
  /** The release: a press the timer has answered but the beat has not (opens now, within the slop of the press),
   *  or one the timer has not yet answered, held LONG_PRESS_MS by the events' own clock, opens now. */
  const up = (event: PointerEvent): void => {
    const long = beat !== null || frame !== null || (downAt !== null && timer !== null && Number.isFinite(event.timeStamp) && event.timeStamp - downAt >= LONG_PRESS_MS);
    const opens = long && near(event);
    disarm();
    if (opens) opened();
  };
  const gone = (): void => { disarm(); };
  /** A second finger anywhere on the document ends a press already armed (N7); the document's own listener
   *  (downPointers) has counted it first. */
  const elsewhere = (event: PointerEvent): void => { if (event.button <= 0 && pointers.size > 1) disarm(); };
  const key = (event: KeyboardEvent): void => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    if (event.repeat) return;
    disarm();
    deps.open('keyboard');
  };
  // A held finger on a touch screen otherwise asks for the context menu or a text selection.
  const menu = (event: MouseEvent): void => { if (!deps.accept || deps.accept(event)) event.preventDefault(); };
  const keys = deps.keys !== false;
  const ends = ['pointercancel', 'pointerleave'] as const;
  target.addEventListener('pointerdown', down);
  target.addEventListener('pointermove', move);
  target.addEventListener('pointerup', up);
  for (const type of ends) target.addEventListener(type, gone);
  target.ownerDocument.addEventListener('pointerdown', elsewhere, true);
  if (keys) target.addEventListener('keydown', key);
  target.addEventListener('contextmenu', menu);
  return () => {
    disarm();
    swallowing?.();
    target.removeEventListener('pointerdown', down);
    target.removeEventListener('pointermove', move);
    target.removeEventListener('pointerup', up);
    for (const type of ends) target.removeEventListener(type, gone);
    target.ownerDocument.removeEventListener('pointerdown', elsewhere, true);
    if (keys) target.removeEventListener('keydown', key);
    target.removeEventListener('contextmenu', menu);
  };
}

// --- The double tap: fullscreen on and off ------------------------------------

export interface DoubleTapDeps {
  /** The second tap of a pair. */
  onDoubleTap: () => void;
  /** The most time between the two releases, by the events' own clock (default DOUBLE_TAP_MS). */
  within?: number;
  /** The most distance between the two taps, and the most a finger may move during one (default DOUBLE_TAP_SLOP_PX). */
  slop?: number;
  /** Whether a press here counts at all (kiosk.ts: never on a handheld, a control or an open panel). Omitted, every
   *  primary press does. A press that is refused forgets a first tap. */
  accept?: (event: PointerEvent) => boolean;
}

/**
 * Two taps on `target`, their releases within `within` ms and `slop` px of each other, call onDoubleTap once; the
 * next tap starts a new pair. A tap is one finger (or the primary button) down and up again within the slop and
 * shorter than LONG_PRESS_MS, the press that opens Postavke: a held press, a finger that moves, a second finger
 * anywhere on the document or a cancelled pointer is no tap and forgets a first one. The releases are judged by
 * the events' own timestamps, as bindLongPress judges its press, so a wall whose main thread is busy drawing its
 * map still counts a real double tap. Nothing is stopped: the long press, the first tap's wake lock and the
 * read-only touch hear the same events. Returns the unbinding.
 */
export function bindDoubleTap(target: HTMLElement, deps: DoubleTapDeps): () => void {
  const within = deps.within ?? DOUBLE_TAP_MS;
  const slop = deps.slop ?? DOUBLE_TAP_SLOP_PX;
  const pointers = downPointers(target.ownerDocument);
  /** The press under way: its pointer, where and when it came down. */
  let press: { id: number; x: number; y: number; at: number } | null = null;
  /** The first tap of a pair: where and when it was released. */
  let first: { x: number; y: number; at: number } | null = null;
  const forget = (): void => { press = null; first = null; };
  const point = (event: PointerEvent): { x: number; y: number } => ({
    x: Number.isFinite(event.clientX) ? event.clientX : 0,
    y: Number.isFinite(event.clientY) ? event.clientY : 0,
  });
  const down = (event: PointerEvent): void => {
    if (event.button > 0) return; // a secondary button is not a tap
    if (pointers.size > 1 || (deps.accept && !deps.accept(event))) { forget(); return; }
    press = { id: event.pointerId, ...point(event), at: event.timeStamp };
  };
  const up = (event: PointerEvent): void => {
    const pressed = press;
    press = null;
    if (!pressed || pressed.id !== event.pointerId || event.button > 0) return;
    const at = point(event);
    const held = event.timeStamp - pressed.at;
    if (Math.hypot(at.x - pressed.x, at.y - pressed.y) > slop || !(held < LONG_PRESS_MS)) { first = null; return; }
    const tap = { ...at, at: event.timeStamp };
    const gap = first ? tap.at - first.at : NaN;
    if (first && gap >= 0 && gap <= within && Math.hypot(tap.x - first.x, tap.y - first.y) <= slop) {
      first = null;
      deps.onDoubleTap();
      return;
    }
    first = tap;
  };
  /** A second finger anywhere on the document ends the pair (downPointers has counted it first). */
  const elsewhere = (event: PointerEvent): void => { if (event.button <= 0 && pointers.size > 1) forget(); };
  target.addEventListener('pointerdown', down);
  target.addEventListener('pointerup', up);
  target.addEventListener('pointercancel', forget);
  target.ownerDocument.addEventListener('pointerdown', elsewhere, true);
  return () => {
    forget();
    target.removeEventListener('pointerdown', down);
    target.removeEventListener('pointerup', up);
    target.removeEventListener('pointercancel', forget);
    target.ownerDocument.removeEventListener('pointerdown', elsewhere, true);
  };
}

/** The pointers down on a document right now, by pointer id, counted once per document by capture listeners on
 *  the document itself (review N7: a set per binding never saw the finger resting on another target). */
const DOWN_POINTERS = new WeakMap<Document, Set<number>>();
function downPointers(doc: Document): Set<number> {
  const known = DOWN_POINTERS.get(doc);
  if (known) return known;
  const set = new Set<number>();
  DOWN_POINTERS.set(doc, set);
  doc.addEventListener('pointerdown', (event) => { if (event.button <= 0) set.add(event.pointerId); }, true);
  for (const type of ['pointerup', 'pointercancel'] as const) doc.addEventListener(type, (event) => { set.delete(event.pointerId); }, true);
  return set;
}

// --- The send queue -------------------------------------------------------------

/** What the panel changes on the screen's record: the chosen place (null for the whole city) and the frame. */
export interface SettingsState {
  place: ScreenPlace | null;
  frame: Frame;
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
  /** `via` is how the panel was opened (open's argument): the caller returns the focus by it (round 2 F18). */
  onClose?: (restoreFocus: boolean, via: LongPressVia) => void;
  /** The screen's own clock, so the expiry line can tell today from tomorrow. */
  now: () => number;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

export interface SettingsHandle {
  element: HTMLElement;
  /** `via` says how it was asked for; a pointer press by default. */
  open(via?: LongPressVia): void;
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
    frameBtn.textContent = shown.frame === FRAME_CITY ? s.settings.frameCity : fill(s.settings.frameValue, { count: shown.frame });
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
        // The field that had the focus is gone: the focus returns to the disclosure that opened it, as it
        // does for any disclosure, so the panel's Escape still reaches the panel (round 1, 24 Sep: with the
        // focus fallen to the body a pick with the mouse left Escape doing nothing until the idle close).
        placeToggle.focus();
        choose({ place, frame: queue.shown().frame });
      },
    });
    field.focus();
  }

  /** How the panel on screen was opened, for the close (round 2 F18). */
  let openedBy: LongPressVia = 'pointer';
  function open(via: LongPressVia = 'pointer'): void {
    if (!element.hidden) return;
    openedBy = via;
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
    deps.onClose?.(restoreFocus, openedBy);
  }

  placeToggle.addEventListener('click', () => { if (field) closePlaceEdit(); else openPlaceEdit(); armIdle(); });
  placeCity.addEventListener('click', () => { closePlaceEdit(); placeToggle.focus(); choose({ place: null, frame: queue.shown().frame }); });
  frameBtn.addEventListener('click', () => {
    const shown = queue.shown();
    choose({ place: shown.place, frame: nextInCycle(FRAME_CYCLE, shown.frame) });
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
