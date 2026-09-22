// @vitest-environment happy-dom
// The /d/ entry without a room in the fragment: the composed empty state is the
// page's main landmark and the skip link's target, so a bookmarked or shared
// /d/ is as reachable as a running session (Lighthouse: landmark-one-main, skip-link).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountDashboard } from '../../app/src/dashboard';
import type { CityMapHandle, CityMapOptions, MapFactory } from '../../app/src/map/city-map';
import { LOCALE_STORAGE_KEY } from '../../app/src/i18n/create-default-i18n';
import { rememberScreenLabel, SCREEN_LABEL_KEY } from '../../app/src/core/screen-label';
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
async function importDashboardEntry(search: string, hash = '#room=r1&ticket=t1'): Promise<void> {
  document.body.innerHTML = '<div id="dash"></div>';
  location.search = search;
  location.hash = hash;
  vi.resetModules();
  await import('../../app/src/entries/dashboard');
}

describe('idle prefetch of the MapLibre chunk from Sada (T2.6)', () => {
  beforeEach(() => localStorage.removeItem('kajima:map-mode:v1'));
  afterEach(() => {
    localStorage.removeItem('kajima:map-mode:v1');
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

  it('does not idle-prefetch MapLibre when the device prefers the schema, and shares the store with the mounted dashboard', async () => {
    const idle = vi.fn();
    (globalThis as { requestIdleCallback?: typeof idle }).requestIdleCallback = idle;
    localStorage.setItem('kajima:map-mode:v1', 'schema');
    await importDashboardEntry('?lagano=0');
    expect(idle).not.toHaveBeenCalled();
    expect(vi.mocked(mountDashboard).mock.lastCall?.[1].mapMode?.snapshot()).toBe('schema');
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

// T5: /s/ hands /d/ the screen's label once, in the fragment; the entry drops it
// from the address, so a reload used to name the screen "zaslon". The label now
// stays with the tab, per room.
describe('a reload keeps the screen label (T5)', () => {
  beforeEach(() => sessionStorage.removeItem(SCREEN_LABEL_KEY));
  afterEach(() => { sessionStorage.removeItem(SCREEN_LABEL_KEY); vi.restoreAllMocks(); });
  const mountedLabel = (): string | null | undefined => vi.mocked(mountDashboard).mock.lastCall?.[1].label;

  it('mounts with the fragment’s label, drops it from the address, and mounts the same label again after a reload of that room', async () => {
    await importDashboardEntry('?lagano=1', '#room=r1&ticket=t1&label=Kavana%20Velebit');
    expect(mountedLabel()).toBe('Kavana Velebit');
    expect(location.hash).not.toContain('label=');
    expect(location.hash).not.toContain('ticket=');
    await importDashboardEntry('?lagano=1', location.hash);
    expect(mountedLabel()).toBe('Kavana Velebit');
  });
  it('never lends one room’s label to another room', async () => {
    await importDashboardEntry('?lagano=1', '#room=r1&ticket=t1&label=Kavana%20Velebit');
    await importDashboardEntry('?lagano=1', '#room=r2');
    expect(mountedLabel()).toBeNull();
  });
  it('rememberScreenLabel prefers the fragment, reads only its own room back, and survives storage that throws or holds junk', () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } };
    expect(rememberScreenLabel(storage, 'r1', null)).toBeNull();
    expect(rememberScreenLabel(storage, 'r1', 'Kaj ima? · Kvaternikov trg')).toBe('Kaj ima? · Kvaternikov trg');
    expect(rememberScreenLabel(storage, 'r1', null)).toBe('Kaj ima? · Kvaternikov trg');
    expect(rememberScreenLabel(storage, 'r2', null)).toBeNull();
    store.set(SCREEN_LABEL_KEY, '{not json');
    expect(rememberScreenLabel(storage, 'r1', null)).toBeNull();
    const denied = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
    expect(rememberScreenLabel(denied, 'r1', 'Kavana Velebit')).toBe('Kavana Velebit');
    expect(rememberScreenLabel(denied, 'r1', null)).toBeNull();
    expect(rememberScreenLabel(null, 'r1', null)).toBeNull();
  });
});

// T4.4 (plan "Entry"): /d/ without a room is a composed page in the shell's
// roles, not a bare alert: wordmark, the display h1, one sentence, the primary
// way in (48 px) and the open safety page (44 px). The kiosk is not offered
// here; a bookmark or a stray share landed a person, not an evaluator.
describe('the composed no-room page', () => {
  const CSS = read('src', 'ui', 'dashboard.css');
  afterEach(() => {
    localStorage.removeItem(LOCALE_STORAGE_KEY);
    vi.restoreAllMocks();
  });
  it('composes the wordmark with its peacock mark, the h1, the lead and exactly two actions, scan first, in the shell namespace', async () => {
    // happy-dom reports an English browser; the stored choice is how a Croatian reader boots here.
    localStorage.setItem(LOCALE_STORAGE_KEY, 'hr');
    await importDashboardEntry('?lagano=1', '');
    const main = document.querySelector<HTMLElement>('main#ki-main.ki-empty');
    expect(main).not.toBeNull();
    expect(main!.tabIndex).toBe(-1);
    expect(main!.querySelector('.ki-wordmark .ki-wordmark-mark')?.textContent).toBe('?');
    const h1 = main!.querySelector('h1.ki-empty-title')!;
    expect(h1.textContent).toBe('Ovdje se otključava Zagreb');
    expect(h1.hasAttribute('role')).toBe(false);
    expect(main!.querySelector('.ki-empty-lead')?.textContent).toBe('Skeniraj kod sa zaslona u prostoru ili upiši osam slova; deset minuta grada je na tvom uređaju.');
    const links = [...main!.querySelectorAll('a')].map((a) => ({ href: a.getAttribute('href'), cls: a.className, text: a.textContent }));
    expect(links).toEqual([
      { href: '/', cls: 'ki-wordmark', text: 'Kaj ima?' },
      { href: '/s/', cls: 'btn btn-primary', text: 'Skeniraj ili upiši kod' },
      { href: '/hitno', cls: 'btn-ghost', text: 'Sigurnost, bez skeniranja' },
    ]);
    expect(document.querySelectorAll('h1')).toHaveLength(1);
    expect(document.documentElement.getAttribute('data-page')).toBe('dashboard');
  });
  it('speaks English when the stored locale is en', async () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'en');
    await importDashboardEntry('?lagano=1', '');
    expect(document.querySelector('h1.ki-empty-title')?.textContent).toBe('This is where Zagreb unlocks');
    expect(document.querySelector('.ki-empty-actions a.btn-primary')?.textContent).toBe('Scan or type a code');
  });
  it('dashboard.css sets the title at the display role and stacks the actions full width on a phone, a row from 40rem', () => {
    expect(CSS).toMatch(/\.ki-empty-title \{[^}]*font-size: var\(--type-display\)/);
    expect(CSS).toMatch(/\.ki-empty-lead \{[^}]*font-size: var\(--type-head\)/);
    expect(CSS).toMatch(/\.ki-empty-actions \{ display: grid; gap: var\(--sp-3\); \}/);
    expect(CSS).toMatch(/@media \(min-width: 40rem\) \{[^}]*\.ki-empty-actions \{[^}]*display: flex/);
    expect(CSS).not.toContain('.ki-empty .actions');
  });
});

describe('the synchronous, lazy schema factory', () => {
  it('buffers the latest state until import, forwards the handle contract afterwards, and never creates or calls back from a disposed pending renderer', async () => {
    const { createMapRenderer } = await import('../../app/src/map/renderers');
    let resolve!: (module: { createSchemaMap: MapFactory }) => void;
    const module = new Promise<{ createSchemaMap: MapFactory }>((done) => { resolve = done; });
    const loadSchema = vi.fn(() => module);
    const real: CityMapHandle = {
      update: vi.fn(), pause: vi.fn(), resume: vi.fn(), destroy: vi.fn(),
      select: vi.fn(), selection: () => null, follow: vi.fn(), following: () => null,
      setTheme: vi.fn(), setLocale: vi.fn(), setModes: vi.fn(), setClosuresVisible: vi.fn(),
      setFeedState: vi.fn(), setStop: vi.fn(), setOutline: vi.fn(), setEmphasis: vi.fn(),
      setView: vi.fn(), setFitPadding: vi.fn(), resize: vi.fn(), fit: vi.fn(),
      status: () => 'ready', network: () => null, camera: () => null, vehicles: () => [],
    };
    const createSchemaMap = vi.fn((_options: CityMapOptions) => real);
    const onStatus = vi.fn();
    const options: CityMapOptions = {
      renderer: 'schema', container: document.createElement('div'), ariaLabel: 'Shema',
      loadNetwork: async () => null, setTimer: () => 1, clearTimer() {}, onStatus,
    };
    const handle: CityMapHandle = createMapRenderer(options, { loadSchema });
    expect(handle).not.toBeInstanceOf(Promise);
    expect(handle.status?.()).toBe('loading');
    handle.update([], []);
    const points = [{ id: 'v1', title: '6', lon: 15.97, lat: 45.81, at: 1000, type: 0 }];
    handle.update(points, []);
    handle.select?.({ kind: 'vehicle', id: 'v1' }, { fit: true });
    handle.follow?.('v1');
    handle.setTheme?.('dark');
    handle.setLocale?.('en');
    handle.setModes?.(new Set([0]));
    handle.setFeedState?.('stale');
    handle.setFeedState?.('down');
    handle.setStop?.(null);
    handle.setOutline?.(null);
    handle.setEmphasis?.(null);
    handle.setClosuresVisible?.(false);
    handle.setView?.({ zoom: 15 });
    handle.setFitPadding?.({ bottom: 300 });
    handle.resize?.();
    handle.fit?.('city');
    handle.resume();
    handle.pause();
    expect(handle.selection?.()).toEqual({ kind: 'vehicle', id: 'v1' });
    expect(handle.following?.()).toBe('v1');
    expect(handle.camera?.()).toBeNull();
    const canceledStatus = vi.fn();
    const canceled = createMapRenderer({ ...options, container: document.createElement('div'), onStatus: canceledStatus }, { loadSchema });
    canceled.update(points, []);
    canceled.destroy();
    canceled.destroy();
    expect(createSchemaMap).not.toHaveBeenCalled();
    resolve({ createSchemaMap });
    await vi.waitFor(() => expect(createSchemaMap).toHaveBeenCalledTimes(1));
    expect(createSchemaMap.mock.calls[0]?.[0]).toMatchObject({ loadNetwork: options.loadNetwork, setTimer: options.setTimer, clearTimer: options.clearTimer });
    expect(real.update).toHaveBeenCalledTimes(1);
    expect(real.update).toHaveBeenLastCalledWith(points, []);
    expect(real.select).toHaveBeenLastCalledWith({ kind: 'vehicle', id: 'v1' }, { fit: true });
    expect(real.follow).toHaveBeenLastCalledWith('v1');
    expect(real.setTheme).toHaveBeenLastCalledWith('dark');
    expect(real.setLocale).toHaveBeenLastCalledWith('en');
    expect(real.setModes).toHaveBeenLastCalledWith(new Set([0]));
    expect(real.setFeedState).toHaveBeenCalledTimes(1);
    expect(real.setFeedState).toHaveBeenLastCalledWith('down');
    expect(real.setStop).toHaveBeenCalledWith(null);
    expect(real.setOutline).toHaveBeenCalledWith(null);
    expect(real.setEmphasis).toHaveBeenCalledWith(null);
    expect(real.setClosuresVisible).toHaveBeenCalledWith(false);
    expect(real.setView).toHaveBeenCalledWith({ zoom: 15 });
    expect(real.setFitPadding).toHaveBeenCalledWith({ bottom: 300 });
    expect(real.resize).toHaveBeenCalledTimes(1);
    expect(real.fit).toHaveBeenCalledWith('city');
    expect(real.pause).toHaveBeenCalledTimes(1);
    expect(real.resume).not.toHaveBeenCalled();
    expect(handle.status?.()).toBe('ready');
    expect(handle.selection?.()).toBeNull(); // a real null must beat the buffered selection
    expect(handle.following?.()).toBeNull();
    expect(canceledStatus).not.toHaveBeenCalled();
    handle.resume();
    expect(real.resume).toHaveBeenCalledTimes(1);
    handle.destroy();
    handle.destroy();
    createSchemaMap.mock.calls[0]?.[0].onStatus?.('ready');
    expect(onStatus).not.toHaveBeenCalled();
    expect(real.destroy).toHaveBeenCalledTimes(1);
    handle.update([], []);
    expect(real.update).toHaveBeenCalledTimes(1);
    const failedStatus = vi.fn();
    const failed = createMapRenderer({ ...options, container: document.createElement('div'), onStatus: failedStatus }, { loadSchema: async () => { throw new Error('offline'); } });
    await vi.waitFor(() => expect(failed.status?.()).toBe('unavailable'));
    expect(failedStatus).toHaveBeenCalledWith('unavailable');
    failed.destroy();
  });
});
