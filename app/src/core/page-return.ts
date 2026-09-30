// The page coming back into view (lane tab-return, 30 Sep): a tab brought to the front again, a phone unlocked, a
// page restored from the back-forward cache. While a page is away the browser runs no animation frame, throttles its
// timers, and on a phone runs nothing at all; what it drew last is stale the moment it is seen again. The motion loop
// (motion/loop.ts), the city store and both surfaces' polls listen here so that a return re-seeds and re-asks at once
// instead of waiting for the next beat.

/** Where the lifecycle events come from: the page's own document and window by default, any pair in a test. */
export interface PageLifecycle {
  doc?: { readonly visibilityState?: string; addEventListener?(type: string, fn: () => void): void; removeEventListener?(type: string, fn: () => void): void } | null;
  win?: { addEventListener?(type: string, fn: (event: { persisted?: boolean }) => void): void; removeEventListener?(type: string, fn: (event: { persisted?: boolean }) => void): void } | null;
  now?: () => number;
}

export interface PageReturnHandlers {
  /** The page went out of view. */
  hide?(): void;
  /** The page is in view again after `awayMs` (Infinity when the away time is unknown: a bfcache restore). */
  show(awayMs: number): void;
}

/** Listens for the page leaving and returning; the answer unsubscribes. Without a document it listens to nothing. */
export function watchPageReturn(handlers: PageReturnHandlers, lifecycle: PageLifecycle = {}): () => void {
  const doc = lifecycle.doc === undefined ? (typeof document === 'undefined' ? null : document) : lifecycle.doc;
  const win = lifecycle.win === undefined ? (typeof window === 'undefined' ? null : window) : lifecycle.win;
  const now = lifecycle.now ?? Date.now;
  let hiddenAt: number | null = doc?.visibilityState === 'hidden' ? now() : null;
  const onVisibility = (): void => {
    if (doc?.visibilityState === 'hidden') {
      if (hiddenAt === null) { hiddenAt = now(); handlers.hide?.(); }
      return;
    }
    if (hiddenAt === null) return;
    const away = Math.max(0, now() - hiddenAt);
    hiddenAt = null;
    handlers.show(away);
  };
  // A page restored from the back-forward cache was frozen whole, for as long as the reader was elsewhere.
  const onPageShow = (event: { persisted?: boolean }): void => {
    if (!event?.persisted) return;
    hiddenAt = null;
    handlers.show(Infinity);
  };
  if (typeof doc?.addEventListener === 'function') doc.addEventListener('visibilitychange', onVisibility);
  if (typeof win?.addEventListener === 'function') win.addEventListener('pageshow', onPageShow);
  return () => {
    if (typeof doc?.removeEventListener === 'function') doc.removeEventListener('visibilitychange', onVisibility);
    if (typeof win?.removeEventListener === 'function') win.removeEventListener('pageshow', onPageShow);
  };
}
