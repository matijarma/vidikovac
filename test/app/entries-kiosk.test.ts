// @vitest-environment happy-dom
// T5.3: the /kiosk/ entry's theme wiring, proven by actually executing the
// entry (every effect runs at import time, exactly like entries/theme-init
// in test/app/boot.test.ts and the T2.6 prefetch test in
// test/app/entries-dashboard.test.ts): a screen nobody has touched opens in
// the sun's own theme (grant §1.2: dark after sunset, light by day; the
// dashboard keeps auto, proven in test/app/boot.test.ts), an existing
// preference is left alone, and ?tema=auto|svijetla|tamna|sunce overrides it
// once and is stripped from the address bar like the provisioning hash.
// mountKiosk itself (beacon, session, rotation, the map) is mocked away: this
// test is about the entry's own wiring, not the controller T5.3 covers in
// test/app/kiosk.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountKiosk } from '../../app/src/kiosk';
import { THEME_STORAGE_KEY } from '../../app/src/ui/theme';
import { stubLocalStorage } from './helpers';

stubLocalStorage();

vi.mock('../../app/src/kiosk', () => ({
  mountKiosk: vi.fn(() => ({ element: document.createElement('div'), phase: () => 'setup' as const, destroy: vi.fn() })),
}));

/** A fresh #kiosk and location, then a fresh copy of the entry module (it runs
 *  entirely at import time, so vi.resetModules() plus a dynamic import is how
 *  it is re-run). */
async function importKioskEntry(search = '', hash = ''): Promise<void> {
  document.body.innerHTML = '<div id="kiosk"></div>';
  location.search = search;
  location.hash = hash;
  vi.resetModules();
  await import('../../app/src/entries/kiosk');
}

beforeEach(() => { localStorage.clear(); });
afterEach(() => { vi.restoreAllMocks(); });

describe('the /kiosk/ entry: the solar default and ?tema=', () => {
  it('resolves solar when nothing is stored, and persists it, so a screen nobody has touched opens by the sun', async () => {
    await importKioskEntry();
    expect(document.documentElement.getAttribute('data-theme')).toBe('solar');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('solar');
  });
  it('leaves an existing preference alone', async () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    await importKioskEntry();
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
  });
  it('?tema=tamna sets dark at mount, once, and is stripped from the address bar', async () => {
    await importKioskEntry('?tema=tamna');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(location.search).toBe('');
    expect(location.pathname).toBe('/kiosk/');
  });
  it('?tema= overrides even a stored preference', async () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    await importKioskEntry('?tema=svijetla');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
  });
  it.each([['auto', 'auto'], ['svijetla', 'light'], ['tamna', 'dark'], ['sunce', 'solar']] as const)('?tema=%s sets %s', async (tema, preference) => {
    await importKioskEntry(`?tema=${tema}`);
    expect(document.documentElement.getAttribute('data-theme')).toBe(preference);
  });
  it('an unrecognised ?tema= value is ignored, falling through to the stored/solar rule, and is still stripped', async () => {
    await importKioskEntry('?tema=neispravno');
    expect(document.documentElement.getAttribute('data-theme')).toBe('solar');
    expect(location.search).toBe('');
  });
  it('a provisioning hash is still cleared exactly as before, whether or not ?tema= rode along', async () => {
    await importKioskEntry('?tema=tamna', '#BEACON01.tajna');
    expect(location.hash).toBe('');
    expect(location.search).toBe('');
    expect(location.pathname).toBe('/kiosk/');
  });
});

describe('the kiosk map renderer at boot', () => {
  it('lets ?prikaz= override the per-device preference without changing it, preserves the override and chapter pin through URL cleanup, and otherwise reads the store', async () => {
    localStorage.setItem('kajima:map-mode:v1', 'map');
    await importKioskEntry('?lagano=0&tema=tamna&prizor=grad&prikaz=shema', '#BEACON01.tajna');
    expect(vi.mocked(mountKiosk).mock.lastCall?.[1]).toMatchObject({ mapMode: 'schema', pinScene: 'grad', lightweight: false });
    expect(location.hash).toBe('');
    expect(location.search).toBe('?prizor=grad&prikaz=shema');
    expect(localStorage.getItem('kajima:map-mode:v1')).toBe('map');
    localStorage.setItem('kajima:map-mode:v1', 'schema');
    await importKioskEntry('?lagano=0&tema=svijetla&prikaz=karta');
    expect(vi.mocked(mountKiosk).mock.lastCall?.[1]).toMatchObject({ mapMode: 'map' });
    expect(location.search).toBe('?prikaz=karta');
    expect(localStorage.getItem('kajima:map-mode:v1')).toBe('schema');
    await importKioskEntry('?lagano=0&prikaz=invalid');
    expect(vi.mocked(mountKiosk).mock.lastCall?.[1]).toMatchObject({ mapMode: 'schema' });
  });
});
