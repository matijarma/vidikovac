// The transport sheet's detents on the phone stage: peek, half, open. The
// sheet floats over the lower part of the map and moves by transform only;
// this controller decides how tall it is, writes that as two custom
// properties the stylesheet reads (--sheet-h, --sheet-open-h), marks the
// detent on the workspace root (data-sheet) and follows the finger. A drag
// starts on the head at any time, and on the body only from the top of its
// scroll and only downward, so the list keeps its own native scrolling. The
// release snaps to the nearest detent, or one detent further in the flick's
// direction. A drag's moves and release are read from the window, so a
// pointer that leaves the sheet, or a node the next poll replaces, never
// strands one. No dependency, pointer events only, and every browser-only
// primitive (ResizeObserver, setPointerCapture) is guarded so the same code
// runs under happy-dom.
export type Detent = 'peek' | 'half' | 'open';

export interface SheetController {
  detent(): Detent;
  set(detent: Detent, opts?: { animate?: boolean }): void;
  /** peek → half → open → peek: what the head's chevron does. */
  cycle(): void;
  /** One detent towards peek: what Escape does. */
  down(): void;
  heightFor(detent: Detent): number;
  destroy(): void;
}

export interface SheetDeps {
  /** The workspace root (`.transport`): carries data-sheet and the custom properties. */
  root: HTMLElement;
  sheet: HTMLElement;
  head: HTMLElement;
  body: HTMLElement;
  /** The stage the heights are measured from (`.transport-body`). */
  stage: () => HTMLElement;
  onChange?: (detent: Detent, heightPx: number) => void;
  reducedMotion?: boolean;
  /** The clock the flick velocity is measured with; performance.now() by default. */
  now?: () => number;
}

const ORDER: readonly Detent[] = ['peek', 'half', 'open'];
/** The head: a 24 px handle row and a 56 px board line. */
const PEEK_REM = 5;
/** The strip of map left above an open sheet. */
const OPEN_GAP_REM = 2.5;
/** Faster than this at release, the sheet goes one detent further in the finger's direction. */
const FLICK_PX_PER_MS = 0.3;
/** Movement below this is a tap, never a drag. */
const DRAG_SLOP_PX = 4;
/** A velocity older than this at release is a paused finger, not a flick. */
const STALE_MOVE_MS = 100;
/** The click a browser fires after a drag lands within this window and is swallowed. */
const CLICK_SUPPRESS_MS = 300;

function remPx(): number {
  const size = typeof getComputedStyle === 'function' ? Number.parseFloat(getComputedStyle(document.documentElement).fontSize) : Number.NaN;
  return Number.isFinite(size) && size > 0 ? size : 16;
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

interface Drag {
  pointerId: number;
  fromBody: boolean;
  startY: number;
  startH: number;
  lastY: number;
  lastT: number;
  /** px/ms, positive downward. */
  velocity: number;
  committed: boolean;
}

export function createSheet(deps: SheetDeps): SheetController {
  const { root, sheet, head, body } = deps;
  const now = deps.now ?? (() => performance.now());
  let current: Detent = 'half';
  let stageHeight = -1;
  let drag: Drag | null = null;
  let dragEndedAt = Number.NEGATIVE_INFINITY;

  function heightFor(detent: Detent): number {
    const rem = remPx();
    const stage = deps.stage().clientHeight;
    const peek = PEEK_REM * rem;
    if (detent === 'peek') return peek;
    const open = Math.max(peek, stage - OPEN_GAP_REM * rem);
    if (detent === 'open') return open;
    return clamp(stage / 2, peek, open);
  }

  function write(heightPx: number): void {
    root.style.setProperty('--sheet-open-h', `${heightFor('open')}px`);
    root.style.setProperty('--sheet-h', `${heightPx}px`);
  }

  function set(detent: Detent, opts: { animate?: boolean } = {}): void {
    current = detent;
    const height = heightFor(detent);
    const animate = opts.animate !== false && !deps.reducedMotion;
    // A recomputed height (a banner in flow, a rotation) lands without a
    // transition: the drag state disables it, a forced style read commits
    // the new transform with it off, then it comes back for the next move.
    if (!animate) root.dataset.dragging = 'true';
    root.dataset.sheet = detent;
    write(height);
    if (!animate) {
      void sheet.offsetHeight;
      delete root.dataset.dragging;
    }
    stageHeight = deps.stage().clientHeight;
    deps.onChange?.(detent, height);
  }

  function nearest(heightPx: number, velocity: number): Detent {
    const heights = ORDER.map((d): [Detent, number] => [d, heightFor(d)]);
    if (velocity < -FLICK_PX_PER_MS) {
      const above = heights.find(([, h]) => h > heightPx + 1);
      if (above) return above[0];
    }
    if (velocity > FLICK_PX_PER_MS) {
      const below = [...heights].reverse().find(([, h]) => h < heightPx - 1);
      if (below) return below[0];
    }
    let best = heights[0]!;
    for (const candidate of heights) if (Math.abs(candidate[1] - heightPx) < Math.abs(best[1] - heightPx)) best = candidate;
    return best[0];
  }

  // --- The stage's size --------------------------------------------------------
  function onResize(): void {
    if (deps.stage().clientHeight === stageHeight) return;
    set(current, { animate: false });
  }
  let observer: ResizeObserver | null = null;
  if (typeof ResizeObserver === 'function') {
    observer = new ResizeObserver(onResize);
    observer.observe(deps.stage());
  } else {
    window.addEventListener('resize', onResize);
  }

  // --- The body's scroll position decides who owns a downward pan --------------------
  const markTop = (): void => {
    body.dataset.atTop = body.scrollTop <= 0 ? 'true' : 'false';
  };
  body.addEventListener('scroll', markTop, { passive: true });
  markTop();

  // --- Pointer drags -------------------------------------------------------------
  // The pointerdown is heard on the sheet; the moves and the release are heard on
  // the window while a drag is pending. A mouse has no implicit capture and the
  // head sits at the sheet's top edge, so its first move often lands over the map
  // already; a finger's implicit capture sits on the node it touched, which the
  // next poll may replace. Either way the events must reach the controller, or
  // the drag would never end. Once a drag has committed the sheet itself, the one
  // node a render never replaces, captures the pointer. Capture waits for the
  // commit: a pointer captured at pointerdown retargets the click that follows a
  // tap to the capturing node (Chrome, Firefox), and every row and the chevron
  // would stop answering taps.
  function capture(pointerId: number): void {
    if (typeof sheet.setPointerCapture !== 'function') return;
    try {
      sheet.setPointerCapture(pointerId);
    } catch {
      /* the pointer is already gone (happy-dom, a cancelled touch) */
    }
  }
  function release(pointerId: number): void {
    if (typeof sheet.releasePointerCapture !== 'function') return;
    try {
      sheet.releasePointerCapture(pointerId);
    } catch {
      /* never captured */
    }
  }
  function listen(on: boolean): void {
    if (on) {
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    } else {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    }
  }
  /** Forgets the pending drag and stops listening to the window for it. */
  function endDrag(): void {
    if (!drag) return;
    drag = null;
    listen(false);
  }
  function heightAt(d: Drag, clientY: number): number {
    return clamp(d.startH - (clientY - d.startY), heightFor('peek'), heightFor('open'));
  }

  function onDown(event: PointerEvent): void {
    if (drag || event.button > 0) return;
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    const fromBody = body.contains(target);
    if (!fromBody && !head.contains(target)) return;
    if (fromBody && body.scrollTop > 0) return;
    drag = { pointerId: event.pointerId, fromBody, startY: event.clientY, startH: heightFor(current), lastY: event.clientY, lastT: now(), velocity: 0, committed: false };
    listen(true);
  }
  function onMove(event: PointerEvent): void {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const dy = event.clientY - drag.startY;
    if (!drag.committed) {
      if (Math.abs(dy) < DRAG_SLOP_PX) return;
      if (drag.fromBody && dy < 0) {
        // The first move goes up: the list scrolls itself.
        endDrag();
        return;
      }
      drag.committed = true;
      capture(event.pointerId);
      root.dataset.dragging = 'true';
    }
    const t = now();
    drag.velocity = (event.clientY - drag.lastY) / Math.max(1, t - drag.lastT);
    drag.lastY = event.clientY;
    drag.lastT = t;
    write(heightAt(drag, event.clientY));
  }
  function onUp(event: PointerEvent): void {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const d = drag;
    endDrag();
    if (!d.committed) return;
    release(event.pointerId);
    delete root.dataset.dragging;
    dragEndedAt = now();
    // A cancel (the browser took the gesture for a scroll) carries no position worth reading: the finger's last known one stands, with no flick.
    const cancelled = event.type !== 'pointerup';
    const velocity = !cancelled && now() - d.lastT <= STALE_MOVE_MS ? d.velocity : 0;
    set(nearest(heightAt(d, cancelled ? d.lastY : event.clientY), velocity));
  }
  /** The click a drag leaves behind lands on whatever is under the lifted finger; it was a drag, not a choice. */
  function onClick(event: Event): void {
    if (now() - dragEndedAt >= CLICK_SUPPRESS_MS) return;
    event.stopPropagation();
    event.preventDefault();
  }
  sheet.addEventListener('pointerdown', onDown);
  sheet.addEventListener('click', onClick, true);

  if (deps.reducedMotion) root.dataset.sheetMotion = 'none';
  set('half', { animate: false });

  return {
    detent: () => current,
    set,
    cycle() {
      set(ORDER[(ORDER.indexOf(current) + 1) % ORDER.length]!);
    },
    down() {
      const index = ORDER.indexOf(current);
      if (index > 0) set(ORDER[index - 1]!);
    },
    heightFor,
    destroy() {
      observer?.disconnect();
      window.removeEventListener('resize', onResize);
      body.removeEventListener('scroll', markTop);
      sheet.removeEventListener('pointerdown', onDown);
      sheet.removeEventListener('click', onClick, true);
      endDrag();
      root.style.removeProperty('--sheet-h');
      root.style.removeProperty('--sheet-open-h');
      delete root.dataset.dragging;
      delete root.dataset.sheetMotion;
      delete body.dataset.atTop;
    },
  };
}
