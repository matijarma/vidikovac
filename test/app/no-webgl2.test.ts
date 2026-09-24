// @vitest-environment happy-dom
// MapLibre v6 draws with WebGL2 alone, and without it its Map constructor no longer throws: it reports a
// GPUInitializationError on the map's error event and returns a map with no painter, whose resize() and remove()
// then throw. happy-dom has no WebGL at all, so the real module here behaves as a phone without a GPU context does
// (e2e/experience.spec.ts "without WebGL", review-p-delta 2c): the Sada band's still map was left half built, its
// teardown threw inside the page's render when Karta swept the band away, and every later render threw with it,
// so the title kept "Sada" and Enter on a stop never reached the sheet.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ModuleId } from '../../worker/feed/schema';
import type { SessionClient, SessionSnapshot } from '../../app/src/session';
import { createDefaultI18n } from '../../app/src/i18n/create-default-i18n';
import { mountDashboard } from '../../app/src/dashboard';
import { createCityMap, type CityMapOptions } from '../../app/src/map/city-map';
import { loadSadaFeed } from '../../app/src/city/feed';
import { decodeNetwork } from '../../shared/motion/network';
import { stubLocalStorage, stubSessionStorage } from './helpers';
import { fakeCityStore } from '../city/fake-store';
import { experienceSnapshots, FIXTURE_STOP, wallDepartures } from '../../e2e/experience-fixtures';
import { FIXTURE_NOW } from '../feed/fixture-contexts';

stubSessionStorage();
stubLocalStorage();
vi.mock('../../app/src/core/screens', () => ({ loadStops: vi.fn(async () => []) }));
vi.mock('../../app/src/core/lastrun', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../app/src/core/lastrun')>()), loadLastRun: vi.fn(async () => null) }));

const NET = decodeNetwork(JSON.parse(readFileSync(resolve(import.meta.dirname, '../../app/public/data/zet-network.json'), 'utf8')));
const NOW = FIXTURE_NOW.getTime();
/** The real entry: MapLibre v6 itself, the one module that imports it. */
type Entry = typeof import('../../app/src/map/maplibre-entry');
let entry: Entry;
beforeAll(async () => {
  entry = await import('../../app/src/map/maplibre-entry');
  expect(await loadSadaFeed()).not.toBeNull();
}, 60_000);

const settle = async (): Promise<void> => {
  for (let i = 0; i < 6; i += 1) {
    await new Promise((r) => setTimeout(r, 20));
    for (let j = 0; j < 10; j += 1) await Promise.resolve();
  }
};

function stillMap(lib: () => Promise<Entry>) {
  const container = document.createElement('div');
  document.body.append(container);
  const statuses: string[] = [];
  const handle = createCityMap(
    { container, ariaLabel: 'Karta', points: [], lines: [], interactive: false, center: [15.977, 45.813], zoom: 15, loadNetwork: async () => NET, onStatus: (s) => { statuses.push(s); } },
    { loadMaplibre: lib as never },
  );
  return { handle, statuses, container };
}

describe('a map without WebGL2 (MapLibre v6)', () => {
  it('a still map (the Sada band) says it is unavailable and never builds a half map: no camera, and resize and teardown are safe', async () => {
    const { handle, statuses, container } = stillMap(async () => entry);
    await settle();
    expect(statuses).toEqual(['unavailable']);
    expect(handle.status?.()).toBe('unavailable');
    expect(handle.camera?.()).toBeNull();
    expect(container.querySelector('.maplibregl-canvas')).toBeNull();
    // The model keeps the network for the lists.
    expect(handle.network?.()).toBe(NET);
    expect(() => handle.resize?.()).not.toThrow();
    expect(() => handle.destroy()).not.toThrow();
  });

  it('a map MapLibre could not finish (the probe answered yes, the constructor still found no context) is torn down without a throw', async () => {
    const { handle } = stillMap(async () => ({ ...entry, webgl2Available: () => true }));
    await settle();
    expect(() => handle.destroy()).not.toThrow();
  });
});

function fixtureSession() {
  let snapshot: SessionSnapshot = { phase: 'connecting', role: null, expiresAt: null, dataToken: null, participants: 0, secondsLeft: 0 };
  const joined: ((s: SessionSnapshot) => void)[] = [];
  const off = () => () => {};
  const client = {
    connect: vi.fn(), snapshot: () => snapshot, serverNow: () => NOW, secondsLeft: () => 600,
    onJoined: (l: (s: SessionSnapshot) => void) => { joined.push(l); return () => {}; },
    onExpiring: off, onExpired: off, onView: off, onPresentation: off, onPresentationResult: off, onCodes: off, onCount: off, onError: off, onClose: off,
    present: vi.fn(), refreshPresentation: vi.fn(), sendView: vi.fn(), share: vi.fn(), event: vi.fn(), close: vi.fn(),
  } as unknown as SessionClient;
  const join = (): void => {
    snapshot = {
      phase: 'live', role: 'scanner', expiresAt: NOW + 600_000, dataToken: 'dt', participants: 1, secondsLeft: 600,
      screen: { kind: 'temporary', expiresAt: NOW + 86_400_000, stop: FIXTURE_STOP } as SessionSnapshot['screen'],
    };
    joined.forEach((l) => l(snapshot));
  };
  return { client, join };
}

describe('the phone without WebGL2, e2e/experience.spec.ts "without WebGL" in one page', () => {
  it('Sada with its band, then Karta: the page renders without a throw, the title follows, and Enter on a stop from the search opens it', async () => {
    const snapshots = await experienceSnapshots();
    const errors: unknown[] = [];
    const onError = (event: Event): void => { errors.push((event as ErrorEvent).error ?? (event as ErrorEvent).message); };
    window.addEventListener('error', onError);
    const root = document.createElement('div');
    document.body.replaceChildren(root);
    const session = fixtureSession();
    const boards = new Map<string, ReturnType<typeof wallDepartures>>();
    const made: string[] = [];
    const handle = mountDashboard(root, {
      cityStore: fakeCityStore(),
      createBoards: () => ({
        get: (_operator: string, stopId: string) => boards.get(stopId),
        ensure: vi.fn((operator: string, ids: readonly string[]) => { for (const id of ids) boards.set(id, wallDepartures(NOW, id, operator as 'zet')); }),
        destroy: vi.fn(),
      }) as never,
      i18n: createDefaultI18n('hr'), session: session.client, now: () => NOW,
      fetchData: (async (module: ModuleId) => snapshots[module]) as never,
      mapFactory: ((options: CityMapOptions) => { made.push(options.container.dataset.testid ?? ''); return createCityMap(options, { now: () => NOW, loadMaplibre: async () => entry }); }) as never,
      lightweight: false, loadNetwork: async () => NET, matchMedia: () => ({ matches: false }),
      setInterval: () => ({}), clearInterval: () => {},
    } as never);
    try {
      session.join();
      await settle();
      // Sada drew its band, and the band's map has booted (half built before the fix).
      expect(made).toContain('sada-map-canvas');
      root.querySelector<HTMLElement>('.ki-tab[data-layer="u-pokretu"]')!.click();
      await settle();
      expect(errors).toEqual([]);
      expect(root.querySelector('[data-testid=dash-title]')?.textContent).toBe('Kaj ima? · Karta');
      expect(root.querySelector('[data-testid=map-canvas]')?.getAttribute('data-map-status')).toBe('unavailable');
      const input = root.querySelector<HTMLInputElement>('[data-testid=transport-search]')!;
      input.focus();
      input.value = 'Jela';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      const options = [...root.querySelectorAll<HTMLElement>('[data-testid=transport-results] [role=option]')];
      const stop = options.findIndex((option) => option.dataset.action === 'select-stop');
      expect(stop).toBeGreaterThanOrEqual(0);
      for (let i = 0; i <= stop; i += 1) input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      expect(errors).toEqual([]);
      expect(root.querySelector('[data-testid=stop-title]')?.textContent).toContain('Jela');
      expect(root.querySelector('[data-testid=stop-routes] button')).not.toBeNull();
      expect(input.value).toBe('');
      // Leaving the page tears every map down, the band's included.
      expect(() => handle.destroy()).not.toThrow();
    } finally {
      window.removeEventListener('error', onError);
    }
  }, 60_000);
});
