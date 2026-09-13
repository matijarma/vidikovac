// @vitest-environment happy-dom
// The /d/ entry without a room in the fragment: the composed empty state is the
// page's main landmark and the skip link's target, so a bookmarked or shared
// /d/ is as reachable as a running session (Lighthouse: landmark-one-main, skip-link).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { stubLocalStorage } from './helpers';

const read = (...parts: string[]): string => readFileSync(join(import.meta.dirname, '..', '..', 'app', ...parts), 'utf8');

describe('the /d/ no-room state', () => {
  const ENTRY = read('src', 'entries', 'dashboard.ts');
  const PAGE = read('d', 'index.html');
  it('composes the empty state as <main id="ki-main">, the element the page skip link points at', () => {
    expect(ENTRY).toContain("document.createElement('main')");
    expect(ENTRY).toContain("empty.className = 'ki-empty'");
    expect(ENTRY).toContain("empty.id = 'ki-main'");
    expect(ENTRY).toContain('empty.tabIndex = -1');
    expect(PAGE).toContain('<a class="skip-link" href="#ki-main"');
  });
});

// T2.6: Sada prefetches the MapLibre chunk while the phone is idle, once a
// session exists, but never on the lightweight path. Proven by actually
// executing the entry (it has no exports; every effect runs at import time,
// exactly like entries/theme-init in test/app/boot.test.ts) with its heavy
// collaborators mocked away, rather than by reading its source -- a
// regression that reorders or misguards the call would fail this test.
stubLocalStorage();

vi.mock('../../app/src/dashboard', () => ({
  mountDashboard: vi.fn(() => ({ activeLayer: () => 'grad-sada' })),
  // A stand-in with the same contract as the real parseSessionHash (room
  // required, ticket/label optional) -- the real mountDashboard is mocked
  // out below it, so importing the real module here would cost this test
  // its whole transitive graph (feed-store, chrome, layers, motion/*...)
  // for a function four lines long.
  parseSessionHash(hash: string) {
    const params = new URLSearchParams(hash.replace(/^#/, ''));
    const roomId = params.get('room');
    if (!roomId) return null;
    return { roomId, ticket: params.get('ticket'), label: params.get('label') };
  },
}));
vi.mock('../../app/src/session', () => ({
  createSessionClient: vi.fn(() => ({ connect: vi.fn(), event: vi.fn() })),
}));
// The heavy MapLibre + worker module: this test only needs to see whether the
// entry asks for it, never its real contents (a CSS import, WebGL, a worker).
vi.mock('../../app/src/map/maplibre-entry', () => ({}));

/** A fresh #dash and location, then a fresh copy of the entry module (it runs
 *  entirely at import time, so vi.resetModules() plus a dynamic import is how
 *  it is re-run, exactly as test/app/boot.test.ts re-runs entries/theme-init). */
async function importDashboardEntry(search: string): Promise<void> {
  document.body.innerHTML = '<div id="dash"></div>';
  location.search = search;
  location.hash = '#room=r1&ticket=t1';
  vi.resetModules();
  await import('../../app/src/entries/dashboard');
}

describe('idle prefetch of the MapLibre chunk from Sada (T2.6)', () => {
  afterEach(() => {
    delete (globalThis as { requestIdleCallback?: unknown }).requestIdleCallback;
    vi.restoreAllMocks();
  });

  it('schedules exactly one prefetch through requestIdleCallback, with a timeout, when not lightweight', async () => {
    const idle = vi.fn();
    (globalThis as { requestIdleCallback?: typeof idle }).requestIdleCallback = idle;
    await importDashboardEntry('?lagano=0');
    expect(idle).toHaveBeenCalledTimes(1);
    const [callback, options] = idle.mock.calls[0]!;
    expect(options).toEqual({ timeout: 4000 });
    // The scheduled work is the chunk import: calling it must not throw.
    expect(() => (callback as () => void)()).not.toThrow();
  });

  it('schedules no prefetch at all on the lightweight path (?lagano=1)', async () => {
    const idle = vi.fn();
    (globalThis as { requestIdleCallback?: typeof idle }).requestIdleCallback = idle;
    await importDashboardEntry('?lagano=1');
    expect(idle).not.toHaveBeenCalled();
  });

  it('falls back to setTimeout(…, 2500) when the browser has no requestIdleCallback', async () => {
    delete (globalThis as { requestIdleCallback?: unknown }).requestIdleCallback;
    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    await importDashboardEntry('?lagano=0');
    const scheduled = timeoutSpy.mock.calls.find(([, ms]) => ms === 2500);
    expect(scheduled).toBeDefined();
    expect(typeof scheduled?.[0]).toBe('function');
  });
});
