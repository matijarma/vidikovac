// Shared plumbing for every canvas motif (panorama, meander): sizing at 2x
// density, reading a token colour off computed style, and re-running a paint
// callback on theme change and resize. This is the ONLY file in ui/ that
// touches the DOM; panorama.ts and meander.ts are pure geometry plus a draw
// function over a narrow structural context (StrokeContext, FillContext) so
// every happy-dom test — and node, where there is no DOM at all — can exercise
// them without a real <canvas>.
export const DENSITY = 2;

export interface SizedCanvas {
  ctx: CanvasRenderingContext2D;
  w: number;
  h: number;
}

/** happy-dom lays nothing out, so this is where every unit test leaves. */
export function prepareCanvas(canvas: HTMLCanvasElement, density = DENSITY): SizedCanvas | null {
  const rect = canvas.getBoundingClientRect?.();
  const cssW = rect?.width || canvas.clientWidth || 0;
  const cssH = rect?.height || canvas.clientHeight || 0;
  if (cssW <= 0 || cssH <= 0) return null;
  const w = Math.round(cssW * density);
  const h = Math.round(cssH * density);
  canvas.width = w;
  canvas.height = h;
  let ctx: CanvasRenderingContext2D | null = null;
  try { ctx = canvas.getContext('2d'); } catch { ctx = null; }
  return ctx ? { ctx, w, h } : null;
}

/** Reads a `--tone-*` custom property off computed style, falling back when
 *  the property is unset or getComputedStyle throws (no layout box). */
export function tone(el: Element, name: string, fallback: string): string {
  try { return getComputedStyle(el).getPropertyValue(name).trim() || fallback; } catch { return fallback; }
}

/** Subscribes a paint callback to theme changes (fired once immediately by
 *  `theme.onChange`, so the first paint needs no separate call) and to
 *  window resize, coalesced onto one animation frame -- or, with `refit`, to
 *  resize, orientationchange and fullscreenchange, once per change after it
 *  has settled. Returns an unsubscribe that tears everything down. */
export function repaintOn(
  theme: { onChange(listener: () => void): () => void },
  view: Pick<Window, 'addEventListener' | 'removeEventListener' | 'requestAnimationFrame'> = globalThis as unknown as Window,
  refit?: RefitOptions,
): (listener: () => void) => () => void {
  return (listener: () => void) => {
    let queued = false;
    let timer: unknown = null;
    const run = (): void => { queued = false; timer = null; listener(); };
    // With a refit, a change to the box (a resize, a fullscreen change, a turn
    // of the screen) runs once, settleMs after its last event: a fullscreen
    // toggle sends a burst, and each run would be a camera move.
    const schedule = refit
      ? (): void => { if (timer !== null) refit.clearTimeout(timer); timer = refit.setTimeout(run, refit.settleMs); }
      : (): void => { if (queued) return; queued = true; view.requestAnimationFrame(run); };
    const offTheme = theme.onChange(listener); // fires once immediately: first paint
    view.addEventListener('resize', schedule);
    if (refit) {
      view.addEventListener('orientationchange', schedule);
      refit.doc.addEventListener('fullscreenchange', schedule);
    }
    return () => {
      offTheme();
      view.removeEventListener('resize', schedule);
      if (refit) {
        view.removeEventListener('orientationchange', schedule);
        refit.doc.removeEventListener('fullscreenchange', schedule);
        if (timer !== null) refit.clearTimeout(timer);
        timer = null;
      }
    };
  };
}

/** repaintOn's refit mode (the wall, lane p-map): the document whose
 *  fullscreenchange counts, how long a change must stand before the one run,
 *  and the timer pair. */
export interface RefitOptions {
  doc: Pick<Document, 'addEventListener' | 'removeEventListener'>;
  settleMs: number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(timer: unknown): void;
}

/** How long a change to the wall's box must stand before it refits: a
 *  fullscreen toggle's burst of resize events is over well inside it. */
export const REFIT_SETTLE_MS = 250;

/** R-L3: one number in JS instead of container queries, so a 2016 browser
 *  lays the kiosk out exactly like a 2026 one. */
export function applyScale(el: HTMLElement, designWidth: number): number {
  const width = el.getBoundingClientRect?.().width || el.clientWidth || designWidth;
  const scale = width / designWidth;
  el.style.setProperty('--kiosk-scale', String(Math.round(scale * 1000) / 1000));
  return scale;
}
