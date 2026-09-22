// @vitest-environment happy-dom
// WP2 [O-72]: the wall's Prikaz "shema" is the whole network without zoom.
// Driven through requestKioskMap into the real schema renderer
// (motion/schema-map.ts), because the diagram decides its own crop from the
// stop it is handed: the factory's options alone cannot show the picture.
import { afterEach, expect, it, vi } from 'vitest';
import { createKioskMapAdapter, FIELD_SPAN_M, HANDHELD_SPAN_M, requestKioskMap, type KioskMapInput } from '../../app/src/kiosk/mapview';
import { createMapSlots } from '../../app/src/map/map-slots';
import type { CityMapHandle, CityMapOptions } from '../../app/src/map/city-map';
import { createSchemaMap } from '../../app/src/motion/schema-map';
import { corridorSpec, syntheticNetwork } from '../motion/synthetic-network';

const NOW = Date.parse('2026-09-16T10:00:00Z');
const NET = syntheticNetwork(corridorSpec());
// The one-line artwork test/motion/schema-map.test.ts draws: T0 to C1200 across 1000 units.
const ART = {
  version: 1, source: 'synthetic-test.svg', builtAt: '2026-09-16', feedVersion: NET.feedVersion,
  box: [1190, 840],
  lines: [{
    route: '1', night: false, colour: '#cc706f', width: 3.5345,
    pts: [[100, 400], [1100, 400]],
    stops: [{ u: 0, name: 'T0', ownCircle: true }, { u: 500, name: 'T600', ownCircle: true }, { u: 1000, name: 'C1200', ownCircle: true }],
  }],
  stops: [
    { name: 'T0', x: 100, y: 400, r: 2, half: null, terminal: true, label: { text: 'T0', rows: 1, x: 100, y: 388, rot: 0, anchor: 'start' } },
    { name: 'T600', x: 600, y: 400, r: 2, half: null, terminal: false, label: { text: 'T600', rows: 1, x: 605, y: 388, rot: 0, anchor: 'start' } },
    { name: 'C1200', x: 1100, y: 400, r: 2, half: 'D', terminal: true, label: { text: 'C1200', rows: 1, x: 1100, y: 388, rot: 0, anchor: 'end' } },
  ],
  water: [],
};
const STOP = { id: 'T600', name: 'T600', lon: 0, lat: 0, routes: ['1'] };
const flush = async (): Promise<void> => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const handles: CityMapHandle[] = [];

afterEach(() => {
  for (const handle of handles.splice(0)) handle.destroy();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

/** A 1920 x 1080 screen whose map slot builds the real schema renderer; returns what the diagram painted: its scale and whether it named the stops. */
async function wall(extra: Partial<KioskMapInput>, direct?: Partial<CityMapOptions>) {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ width: 1920, height: 1080, left: 0, top: 0 }) as DOMRect);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function () {
    return new Proxy({}, { get: (_t, k: string) => (k === 'measureText' ? () => ({ width: 10 }) : () => undefined), set: () => true }) as CanvasRenderingContext2D;
  } as never);
  let time = NOW;
  const queue = new Map<number, (t: number) => void>();
  let id = 0;
  const deps = { now: () => time, raf: (cb: (t: number) => void) => { queue.set(++id, cb); return id; }, cancel: (h: number) => { queue.delete(h); }, loadSchema: async () => ART };
  const factory = (options: CityMapOptions): CityMapHandle => {
    const handle = createSchemaMap({ ...options, ...direct, loadNetwork: async () => NET }, deps);
    handles.push(handle);
    return handle;
  };
  const adapter = createKioskMapAdapter(factory);
  const maps = createMapSlots(adapter.factory);
  const input: KioskMapInput = { stop: STOP, placeSet: true, snapshots: {}, now: NOW, selection: null, phase: 'invitation', widthPx: 1920, heightPx: 1080, spanM: FIELD_SPAN_M, ariaLabel: 'shema', ...extra };
  const container = requestKioskMap(maps, input, adapter)!;
  document.body.appendChild(container);
  await flush();
  adapter.handle()?.resize?.();
  time += 16;
  for (const cb of [...queue.values()]) cb(time);
  const scene = container.querySelector<HTMLElement>('[data-testid=schema-map]')!;
  return { container, status: container.dataset.mapStatus, scale: Number(scene.dataset.scale), labels: scene.dataset.labels };
}

it('draws the whole network without zoom for the wall’s Prikaz "shema", where the boot renderer alone crops round the stop', async () => {
  const shema = await wall({ view: 'schema' });
  expect(shema.container.dataset.renderer).toBe('schema');
  expect(shema.status).toBe('ready');
  expect(shema.scale).toBeGreaterThan(0);
  // The same diagram handed no stop at all: the network fitted to the box, at the same scale.
  const fitted = await wall({ view: 'schema', stop: null, placeSet: undefined });
  expect(shema.scale).toBe(fitted.scale);
  expect(shema.labels).toBe(fitted.labels);
  // ?prikaz=shema as the boot renderer with the setting on karta keeps the legible crop round the screen's stop: closer in, the names on.
  const crop = await wall({ renderer: 'schema', view: 'map' });
  expect(crop.scale).toBeGreaterThan(shema.scale);
  expect(crop.labels).toBe('true');
});

it('keeps the phone’s band on its stop: a handheld schema is not the wall’s whole network', async () => {
  const phone = await wall({ view: 'schema', handheld: true, spanM: HANDHELD_SPAN_M });
  const shema = await wall({ view: 'schema' });
  expect(phone.scale).toBeGreaterThan(shema.scale);
  expect(phone.labels).toBe('true');
});
