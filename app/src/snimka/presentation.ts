// Presentation mode (plan section 3.7): the button "Cijeli zaslon"
// (aria-pressed) puts the stage section into fullscreen (the pattern of
// app/src/kiosk.ts); fullscreenchange marks data-sn-presenting on the
// stage; while presenting, the controls hide after three idle seconds
// (data-sn-idle; a pointer or a key wakes them; never while the focus is
// inside the controls; not at all under reduced motion); key F toggles,
// Escape is the browser's own exit. A browser without element fullscreen
// (an iPhone) gets the same layout pinned over the page, left by Escape or
// the button. The caller resizes the map on every change (onChange).
import { SN } from './strings';

export const IDLE_MS = 3000;

export interface Timers { setTimeout(fn: () => void, ms: number): unknown; clearTimeout(handle: unknown): void }
const realTimers: Timers = { setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms), clearTimeout: (h) => globalThis.clearTimeout(h as number) };

export interface IdleTimer {
  /** A pointer or a key: wake, and start the count again. */
  poke(): void;
  /** Starts (true) or stops (false, waking) the idle watch. */
  arm(on: boolean): void;
  idle(): boolean;
  destroy(): void;
}

/** The idle watch, with injected timers (tests) and a guard that keeps the controls up while it answers true. */
export function createIdleTimer(o: { ms?: number; timers?: Timers; guard?: () => boolean; onChange: (idle: boolean) => void }): IdleTimer {
  const ms = o.ms ?? IDLE_MS;
  const timers = o.timers ?? realTimers;
  let armed = false;
  let idle = false;
  let handle: unknown = null;
  const set = (next: boolean): void => {
    if (next === idle) return;
    idle = next;
    o.onChange(idle);
  };
  const clear = (): void => { if (handle !== null) { timers.clearTimeout(handle); handle = null; } };
  const schedule = (): void => {
    clear();
    if (!armed) return;
    handle = timers.setTimeout(() => {
      handle = null;
      if (!armed) return;
      // Focus inside the controls keeps them up; look again a period later.
      if (o.guard?.()) { schedule(); return; }
      set(true);
    }, ms);
  };
  return {
    poke() { set(false); schedule(); },
    arm(on) {
      armed = on;
      if (on) schedule();
      else { clear(); set(false); }
    },
    idle: () => idle,
    destroy() { armed = false; clear(); },
  };
}

export interface PresentationOptions {
  reducedMotion: boolean;
  /** The elements whose focus keeps the controls up (the timeline bar, the chips). */
  controls?: () => readonly Element[];
  /** After entering or leaving (the map resizes). */
  onChange?: (presenting: boolean) => void;
  timers?: Timers;
}

interface FsDocument extends Document { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => Promise<void> | void }
interface FsElement extends HTMLElement { webkitRequestFullscreen?: () => Promise<void> | void }

/** Binds the mode to the stage root and its button; returns the unbinding. */
export function bindPresentation(stageRoot: HTMLElement, button: HTMLButtonElement | null, opts: PresentationOptions): () => void {
  const doc = stageRoot.ownerDocument as FsDocument;
  const target = (stageRoot.closest('section') ?? stageRoot) as FsElement;
  const canFullscreen = typeof target.requestFullscreen === 'function' || typeof target.webkitRequestFullscreen === 'function';
  let pinned = false;
  let presenting = false;

  const idle = createIdleTimer({
    timers: opts.timers,
    guard: () => (opts.controls?.() ?? []).some((c) => c.contains(doc.activeElement)),
    onChange: (on) => { if (on) stageRoot.dataset.snIdle = ''; else delete stageRoot.dataset.snIdle; },
  });

  const fullscreenElement = (): Element | null => doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;

  const render = (): void => {
    const next = pinned || fullscreenElement() === target;
    if (next === presenting) return;
    presenting = next;
    if (presenting) stageRoot.dataset.snPresenting = pinned ? 'pinned' : 'fullscreen';
    else delete stageRoot.dataset.snPresenting;
    if (button) {
      button.setAttribute('aria-pressed', presenting ? 'true' : 'false');
      button.textContent = presenting ? SN.present.exit : SN.present.enter;
    }
    idle.arm(presenting && !opts.reducedMotion);
    opts.onChange?.(presenting);
  };

  const enter = (): void => {
    if (canFullscreen) {
      try {
        const r = target.requestFullscreen ? target.requestFullscreen() : target.webkitRequestFullscreen?.();
        if (r && typeof (r as Promise<void>).catch === 'function') (r as Promise<void>).catch(() => { pinned = true; render(); });
        return;
      } catch { /* fall through to the pinned layout */ }
    }
    pinned = true;
    render();
  };
  const leave = (): void => {
    if (pinned) { pinned = false; render(); return; }
    if (fullscreenElement()) {
      try { void (doc.exitFullscreen ? doc.exitFullscreen() : doc.webkitExitFullscreen?.()); } catch { /* the browser left already */ }
    }
  };
  const toggle = (): void => { if (presenting) leave(); else enter(); };

  const onClick = (): void => toggle();
  const onFs = (): void => render();
  const onKey = (event: KeyboardEvent): void => {
    if (presenting) idle.poke();
    if (event.altKey || event.ctrlKey || event.metaKey || event.defaultPrevented) return;
    const tag = (event.target as HTMLElement | null)?.tagName ?? '';
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (event.code === 'KeyF') { event.preventDefault(); toggle(); }
    else if (event.key === 'Escape' && pinned) { pinned = false; render(); }
  };
  const onPointer = (): void => { if (presenting) idle.poke(); };

  button?.addEventListener('click', onClick);
  if (button && !canFullscreen) button.title = SN.present.unsupported;
  doc.addEventListener('fullscreenchange', onFs);
  doc.addEventListener('webkitfullscreenchange', onFs);
  stageRoot.addEventListener('keydown', onKey);
  stageRoot.addEventListener('pointermove', onPointer);
  stageRoot.addEventListener('pointerdown', onPointer);
  stageRoot.addEventListener('focusin', onPointer);

  return () => {
    button?.removeEventListener('click', onClick);
    doc.removeEventListener('fullscreenchange', onFs);
    doc.removeEventListener('webkitfullscreenchange', onFs);
    stageRoot.removeEventListener('keydown', onKey);
    stageRoot.removeEventListener('pointermove', onPointer);
    stageRoot.removeEventListener('pointerdown', onPointer);
    stageRoot.removeEventListener('focusin', onPointer);
    idle.destroy();
    if (pinned) { pinned = false; render(); }
  };
}
