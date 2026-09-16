// A CSS-pixel viewport over a y-down artwork box. The canvas renderer owns
// its backing-store density; this controller owns only coordinate mapping
// and input. No frames, easing or inertia: fits also honour reduced motion.
import type { XY } from '../../../shared/motion/geo';

export interface PanZoomPadding {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
}

export interface PanZoomViewport extends XY {
  /** CSS px per artwork unit; x/y are CSS-pixel translations. */
  scale: number;
  fit: number;
  width: number;
  height: number;
}

export interface PanZoomOptions {
  box: readonly [number, number];
  width?: number;
  height?: number;
  /** Total clearance, including any breathing space the caller wants.
   *  The transport sheet's covered area belongs here, not in canvas size. */
  padding?: PanZoomPadding;
  interactive?: boolean;
  /** Accepted for the shared map contract. Fits are immediate in both modes. */
  reducedMotion?: boolean;
  onChange?: (viewport: PanZoomViewport) => void;
  /** Genuine pointer/wheel/keyboard input only, not programmatic methods. */
  onUserMove?: () => void;
  /** A short, unmoved pointer release in local CSS pixels. The second tap
   *  of a double tap zooms instead. Optional: a shared scene may own clicks. */
  onTap?: (point: XY) => void;
  document?: Document;
  now?: () => number;
}

export interface PanZoom {
  snapshot(): PanZoomViewport;
  toScreen(point: XY): XY;
  toWorld(point: XY): XY;
  resize(width: number, height: number): void;
  setPadding(padding: PanZoomPadding): void;
  fit(): void;
  /** Absolute scale (not a multiple of fit); current scale if omitted. */
  centreOn(point: XY, scale?: number): void;
  /** Anchor is local CSS pixels, uncovered viewport centre by default. */
  zoomBy(factor: number, anchor?: XY): void;
  panBy(dx: number, dy: number): void;
  destroy(): void;
}

export const MAX_ZOOM_FROM_FIT = 8;
const DRAG_SLOP_PX = 4;
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_PX = 24;
const TAP_MAX_MS = 500;
const CLICK_SUPPRESS_MS = 400;
const KEY_PAN_PX = 64;
const KEY_ZOOM = Math.SQRT2;
// Same room/breathing-space floors as the city map's fitInside. A detent
// larger than its host must still leave a finite, recoverable viewport.
const FIT_ROOM_PX = 80;
const BREATHING_SPACE_PX = 40;
const clamp = (n: number, min: number, max: number): number => Math.min(max, Math.max(min, n));
const finitePoint = (p: XY): boolean => Number.isFinite(p.x) && Number.isFinite(p.y);
const distance = (a: XY, b: XY): number => Math.hypot(a.x - b.x, a.y - b.y);

interface Pointer {
  point: XY;
  start: XY;
  at: number;
  moved: boolean;
  pinched: boolean;
  type: string;
}
type Gesture =
  | { kind: 'drag'; id: number; start: XY; x: number; y: number }
  | { kind: 'pinch'; ids: [number, number]; anchor: XY; distance: number; scale: number };

export function createPanZoom(element: HTMLElement, options: PanZoomOptions): PanZoom {
  const [boxWidth, boxHeight] = options.box;
  if (![boxWidth, boxHeight].every((n) => Number.isFinite(n) && n > 0)) throw new Error('pan-zoom: box dimensions must be finite and positive');
  const doc = options.document ?? element.ownerDocument;
  const win = doc.defaultView;
  const now = options.now ?? (() => Date.now());
  const interactive = options.interactive !== false;
  const rect = element.getBoundingClientRect();
  const dimension = (n: number): number => Number.isFinite(n) ? Math.max(0, n) : 0;
  let width = dimension(options.width ?? rect.width);
  let height = dimension(options.height ?? rect.height);
  let padding = { ...options.padding };
  let dead = false;
  let listening = false;
  let gesture: Gesture | null = null;
  const pointers = new Map<number, Pointer>();
  let lastTap: { point: XY; at: number; type: string } | null = null;
  let doubleZoomAt = -Infinity;
  let suppressClickUntil = -Infinity;
  const previousTouchAction = element.style.touchAction;

  function bounds(): { left: number; top: number; right: number; bottom: number } {
    const side = (name: keyof PanZoomPadding): number => dimension(padding[name] ?? 0);
    const p = { top: side('top'), right: side('right'), bottom: side('bottom'), left: side('left') };
    const fitInside = (a: keyof typeof p, b: keyof typeof p, size: number): void => {
      const room = Math.max(0, size - FIT_ROOM_PX);
      let excess = p[a] + p[b] - room;
      if (excess <= 0) return;
      for (const key of p[a] >= p[b] ? [a, b] : [b, a]) {
        const take = Math.min(excess, Math.max(0, p[key] - BREATHING_SPACE_PX));
        p[key] -= take;
        excess -= take;
      }
      if (excess > 0) {
        const total = p[a] + p[b];
        p[a] = total > 0 ? (p[a] * room) / total : 0;
        p[b] = total > 0 ? (p[b] * room) / total : 0;
      }
    };
    fitInside('left', 'right', width);
    fitInside('top', 'bottom', height);
    // Zero-size mounts are common before layout. Keep the transform finite;
    // the first resize will refit to the actual host.
    return { left: p.left, top: p.top, right: Math.max(1, width) - p.right, bottom: Math.max(1, height) - p.bottom };
  }
  let area = bounds();
  const fitScale = (): number => Math.min((area.right - area.left) / boxWidth, (area.bottom - area.top) / boxHeight);
  let state: PanZoomViewport = { x: 0, y: 0, scale: fitScale(), fit: fitScale(), width, height };
  const snapshot = (): PanZoomViewport => ({ ...state });
  const centre = (): XY => ({ x: (area.left + area.right) / 2, y: (area.top + area.bottom) / 2 });
  const toScreen = (p: XY): XY => ({ x: state.x + p.x * state.scale, y: state.y + p.y * state.scale });
  const toWorld = (p: XY): XY => ({ x: (p.x - state.x) / state.scale, y: (p.y - state.y) / state.scale });

  function constrained(x: number, y: number, scale: number): PanZoomViewport {
    scale = clamp(scale, state.fit, MAX_ZOOM_FROM_FIT * state.fit);
    const spanX = boxWidth * scale;
    const spanY = boxHeight * scale;
    x = spanX <= area.right - area.left ? (area.left + area.right - spanX) / 2 : clamp(x, area.right - spanX, area.left);
    y = spanY <= area.bottom - area.top ? (area.top + area.bottom - spanY) / 2 : clamp(y, area.bottom - spanY, area.top);
    return { x, y, scale, fit: state.fit, width, height };
  }
  // No callback during construction: the caller can safely take a snapshot
  // before wiring its scene and its change callback.
  state = constrained(0, 0, state.fit);

  function apply(x: number, y: number, scale: number, user = false, force = false): void {
    if (dead) return;
    const next = constrained(x, y, scale);
    const changed = force || next.x !== state.x || next.y !== state.y || next.scale !== state.scale;
    state = next;
    if (user) options.onUserMove?.();
    if (changed && !dead) options.onChange?.(snapshot());
  }
  function zoom(factor: number, anchor = centre(), user = false): void {
    if (dead || !Number.isFinite(factor) || factor <= 0 || !finitePoint(anchor)) return;
    const point = toWorld(anchor);
    const scale = clamp(state.scale * factor, state.fit, MAX_ZOOM_FROM_FIT * state.fit);
    apply(anchor.x - point.x * scale, anchor.y - point.y * scale, scale, user);
  }
  function pan(dx: number, dy: number, user = false): void {
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
    apply(state.x + dx, state.y + dy, state.scale, user);
  }
  function rebase(): void {
    const ids = [...pointers.keys()];
    if (ids.length === 0) {
      gesture = null;
    } else if (ids.length === 1) {
      gesture = { kind: 'drag', id: ids[0], start: { ...pointers.get(ids[0])!.point }, x: state.x, y: state.y };
    } else {
      const a = pointers.get(ids[0])!.point;
      const b = pointers.get(ids[1])!.point;
      const midpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      gesture = { kind: 'pinch', ids: [ids[0], ids[1]], anchor: toWorld(midpoint), distance: Math.max(1, distance(a, b)), scale: state.scale };
    }
  }
  function reframe(): void {
    const point = toWorld(centre());
    const wasFit = Math.abs(state.scale - state.fit) < 1e-9;
    area = bounds();
    state.fit = fitScale();
    const scale = clamp(wasFit ? state.fit : state.scale, state.fit, MAX_ZOOM_FROM_FIT * state.fit);
    const anchor = centre();
    apply(anchor.x - point.x * scale, anchor.y - point.y * scale, scale, false, true);
    rebase();
  }
  function fit(user = false): void {
    apply(0, 0, state.fit, user);
    rebase();
  }
  function local(event: MouseEvent): XY {
    const r = element.getBoundingClientRect();
    return { x: event.clientX - r.left, y: event.clientY - r.top };
  }
  function controlTarget(event: Event): boolean {
    const target = event.target as Element | null;
    return !!target && typeof target.closest === 'function'
      && !!target.closest('input, textarea, select, button, a[href], [role="textbox"], [contenteditable]:not([contenteditable="false"])');
  }
  function capture(id: number): void {
    try { element.setPointerCapture?.(id); } catch { /* cancelled or synthetic pointer */ }
  }
  function release(id: number): void {
    try { element.releasePointerCapture?.(id); } catch { /* no longer captured */ }
  }
  function listen(active: boolean): void {
    if (active === listening) return;
    listening = active;
    if (active) {
      doc.addEventListener('pointermove', onMove, { passive: false });
      doc.addEventListener('pointerup', onUp);
      doc.addEventListener('pointercancel', onUp);
    } else {
      doc.removeEventListener('pointermove', onMove);
      doc.removeEventListener('pointerup', onUp);
      doc.removeEventListener('pointercancel', onUp);
    }
  }
  function cancel(): void {
    const ids = [...pointers.keys()];
    pointers.clear();
    gesture = null;
    lastTap = null;
    listen(false);
    for (const id of ids) release(id);
  }
  function onDown(event: PointerEvent): void {
    if (dead || event.defaultPrevented || event.button !== 0 || controlTarget(event) || pointers.has(event.pointerId)) return;
    const point = local(event);
    if (!finitePoint(point)) return;
    if (pointers.size === 0) suppressClickUntil = -Infinity;
    pointers.set(event.pointerId, { point, start: point, at: now(), moved: false, pinched: false, type: event.pointerType });
    if (pointers.size > 1) {
      for (const p of pointers.values()) p.pinched = true;
      lastTap = null;
    }
    capture(event.pointerId);
    listen(true);
    rebase();
    if (element.tabIndex >= 0) element.focus({ preventScroll: true });
  }
  function onMove(event: PointerEvent): void {
    const pointer = pointers.get(event.pointerId);
    if (dead || !pointer || !gesture) return;
    const point = local(event);
    if (!finitePoint(point)) return;
    pointer.point = point;
    if (gesture.kind === 'pinch') {
      if (!gesture.ids.includes(event.pointerId)) return;
      const a = pointers.get(gesture.ids[0])!.point;
      const b = pointers.get(gesture.ids[1])!.point;
      const scale = clamp(gesture.scale * distance(a, b) / gesture.distance, state.fit, MAX_ZOOM_FROM_FIT * state.fit);
      apply((a.x + b.x) / 2 - gesture.anchor.x * scale, (a.y + b.y) / 2 - gesture.anchor.y * scale, scale, true);
      pointer.moved = true;
    } else {
      if (!pointer.moved && !pointer.pinched && distance(pointer.start, point) < DRAG_SLOP_PX) return;
      pointer.moved = true;
      apply(gesture.x + point.x - gesture.start.x, gesture.y + point.y - gesture.start.y, state.scale, true);
    }
    lastTap = null;
    suppressClickUntil = now() + CLICK_SUPPRESS_MS;
    event.preventDefault();
  }
  function onUp(event: PointerEvent): void {
    const pointer = pointers.get(event.pointerId);
    if (dead || !pointer) return;
    const completed = event.type === 'pointerup';
    if (completed) onMove(event); // include a final move delivered only at release
    pointers.delete(event.pointerId);
    release(event.pointerId);
    rebase();
    if (pointers.size === 0) listen(false);
    if (!completed || pointer.moved || pointer.pinched || now() - pointer.at > TAP_MAX_MS) {
      lastTap = null;
      suppressClickUntil = now() + CLICK_SUPPRESS_MS;
      return;
    }
    const point = pointer.point;
    if (lastTap && now() - lastTap.at <= DOUBLE_TAP_MS && lastTap.type === pointer.type && distance(lastTap.point, point) <= DOUBLE_TAP_PX) {
      lastTap = null;
      doubleZoomAt = now();
      suppressClickUntil = now() + CLICK_SUPPRESS_MS;
      zoom(2, point, true);
    } else {
      lastTap = { point, at: now(), type: pointer.type };
      options.onTap?.({ ...point });
      if (options.onTap) suppressClickUntil = now() + CLICK_SUPPRESS_MS;
    }
  }
  function onWheel(event: WheelEvent): void {
    if (dead || event.defaultPrevented || controlTarget(event) || !Number.isFinite(event.deltaY) || event.deltaY === 0) return;
    const units = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? Math.max(1, height) : 1;
    event.preventDefault();
    zoom(Math.exp(-clamp(event.deltaY * units, -1000, 1000) * 0.002), local(event), true);
    lastTap = null;
    rebase();
  }
  function onDoubleClick(event: MouseEvent): void {
    if (dead || controlTarget(event)) return;
    event.preventDefault();
    event.stopPropagation();
    if (now() - doubleZoomAt <= DOUBLE_TAP_MS) return; // pointer releases already zoomed
    doubleZoomAt = now();
    lastTap = null;
    zoom(2, local(event), true);
    rebase();
  }
  function onClick(event: MouseEvent): void {
    // detail=0 is keyboard/programmatic activation, never a drag's click.
    if (event.detail === 0 || now() >= suppressClickUntil) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }
  function onKey(event: KeyboardEvent): void {
    if (dead || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || controlTarget(event)) return;
    const key = event.key;
    if (key === '+' || key === '=' || key === 'Add') zoom(KEY_ZOOM, centre(), true);
    else if (key === '-' || key === '_' || key === 'Subtract') zoom(1 / KEY_ZOOM, centre(), true);
    else if (key === '0') fit(true);
    else if (event.shiftKey && key === 'ArrowLeft') pan(KEY_PAN_PX, 0, true);
    else if (event.shiftKey && key === 'ArrowRight') pan(-KEY_PAN_PX, 0, true);
    else if (event.shiftKey && key === 'ArrowUp') pan(0, KEY_PAN_PX, true);
    else if (event.shiftKey && key === 'ArrowDown') pan(0, -KEY_PAN_PX, true);
    else return; // plain arrows belong to the accessible vehicle selection
    event.preventDefault();
    lastTap = null;
    rebase();
  }
  if (interactive) {
    element.style.touchAction = 'none';
    element.addEventListener('pointerdown', onDown);
    element.addEventListener('lostpointercapture', onUp);
    element.addEventListener('wheel', onWheel, { passive: false });
    element.addEventListener('dblclick', onDoubleClick);
    element.addEventListener('click', onClick, true);
    element.addEventListener('keydown', onKey);
    win?.addEventListener('blur', cancel);
  }

  return {
    snapshot, toScreen, toWorld,
    resize(w, h) {
      if (dead) return;
      w = dimension(w);
      h = dimension(h);
      if (width === w && height === h) return;
      width = w;
      height = h;
      reframe();
    },
    setPadding(next) {
      if (dead) return;
      padding = { ...next };
      reframe();
    },
    fit: () => fit(),
    centreOn(point, scale = state.scale) {
      if (dead || !finitePoint(point) || !Number.isFinite(scale) || scale <= 0) return;
      scale = clamp(scale, state.fit, MAX_ZOOM_FROM_FIT * state.fit);
      const anchor = centre();
      apply(anchor.x - point.x * scale, anchor.y - point.y * scale, scale);
      rebase();
    },
    zoomBy(factor, anchor) { zoom(factor, anchor); rebase(); },
    panBy(dx, dy) { pan(dx, dy); rebase(); },
    destroy() {
      if (dead) return;
      dead = true;
      cancel();
      if (!interactive) return;
      element.removeEventListener('pointerdown', onDown);
      element.removeEventListener('lostpointercapture', onUp);
      element.removeEventListener('wheel', onWheel);
      element.removeEventListener('dblclick', onDoubleClick);
      element.removeEventListener('click', onClick, true);
      element.removeEventListener('keydown', onKey);
      win?.removeEventListener('blur', cancel);
      element.style.touchAction = previousTouchAction;
    },
  };
}
