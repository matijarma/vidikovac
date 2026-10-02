// @vitest-environment happy-dom
// The two SVG minimaps (app/src/snimka/minimap.ts): the RDP simplification's
// bounds, one path per route of the file the network carries, the alive, dead
// and quiet classes once per five-minute sample on both sides (the comparison
// side aligned by time of day to the weekday-matched day), the captions, the
// subject outline, the legend when large, and the teardown.
import { describe, expect, it, vi } from 'vitest';
import { ROUTES_STEP_S, SNIMKA_COMPARISONS, SNIMKA_WINDOW, ZAGREB_OFFSET_S, type Speed } from '../../shared/snimka';
import { encodeRoutes } from '../../shared/snimka-codec';
import type { ReplayClock } from '../../app/src/snimka/clock';
import { createLayerStore, createViewStore, type SnimkaContext } from '../../app/src/snimka/context';
import { minimapGeometry, mountMinimaps, simplifyRdp } from '../../app/src/snimka/minimap';

describe('simplifyRdp', () => {
  it('keeps both ends, drops points within the tolerance of the chord and keeps the ones beyond it', () => {
    const line = [{ x: 0, y: 0 }, { x: 10, y: 1 }, { x: 20, y: 0 }, { x: 30, y: 40 }, { x: 40, y: 0 }];
    // (20, 0) lies 16 off the chord from (0, 0) to (30, 40), so it stays; (10, 1) is 1 off its chord and goes.
    expect(simplifyRdp(line, 5)).toEqual([{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 30, y: 40 }, { x: 40, y: 0 }]);
    expect(simplifyRdp(line, 0.5)).toEqual(line);
    expect(simplifyRdp(line.slice(0, 2), 5)).toEqual(line.slice(0, 2));
    expect(simplifyRdp([], 5)).toEqual([]);
  });
  it('a long straight shape with noise under the tolerance comes down to its two ends; every kept point stays within the tolerance', () => {
    const pts = Array.from({ length: 2000 }, (_, i) => ({ x: i * 10, y: (i % 2) * 3 }));
    expect(simplifyRdp(pts, 25)).toHaveLength(2);
    const wavy = Array.from({ length: 500 }, (_, i) => ({ x: i * 10, y: 200 * Math.sin(i / 20) }));
    const kept = simplifyRdp(wavy, 25);
    expect(kept.length).toBeGreaterThan(10);
    expect(kept.length).toBeLessThan(wavy.length / 3);
    expect(kept[0]).toEqual(wavy[0]);
    expect(kept[kept.length - 1]).toEqual(wavy[wavy.length - 1]);
  });
});

/** A network of three routes; 6 has two main shapes and a depot run, 228 one, 31 none the network knows. */
const net = {
  routes: new Map([
    ['6', { short: '6', type: 0, rank: 1, shapes: [0, 1, 2], main: [0, 1] }],
    ['228', { short: '228', type: 3, rank: 2, shapes: [3], main: [3] }],
  ]),
  shapes: [
    { id: 'a', route: '6', pts: [{ x: 0, y: 0 }, { x: 1000, y: 3 }, { x: 2000, y: 0 }], cum: [0, 1000, 2000], len: 2000, direction: 0 },
    { id: 'b', route: '6', pts: [{ x: 2000, y: 0 }, { x: 2000, y: 1500 }], cum: [0, 1500], len: 1500, direction: 1 },
    { id: 'c', route: '6', pts: [{ x: 0, y: 0 }, { x: -3000, y: -3000 }], cum: [0, 4243], len: 4243, direction: 0 },
    { id: 'd', route: '228', pts: [{ x: 500, y: 500 }, { x: 900, y: 900 }, { x: 1300, y: 500 }], cum: [0, 566, 1132], len: 1132, direction: 0 },
  ],
  stops: [], paths: [], edges: [], diagram: { lines: [], box: [0, 0] }, version: 3, feedVersion: '000396', graphHash: 'mm',
} as never;
const ROUTES = [{ id: '6', shortName: '6', type: 0 as const }, { id: '228', shortName: '228', type: 3 as const }, { id: '31', shortName: '31', type: 0 as const }];

describe('minimapGeometry', () => {
  it('one path per route the network carries, main shapes only, simplified, y down, with a padded viewBox', () => {
    const g = minimapGeometry(net, ROUTES, 25);
    expect(g.routes.map((r) => r.id)).toEqual(['6', '228']);
    expect(g.routes[0]).toEqual({ id: '6', kind: 'tram', d: 'M0 0L2000 0M2000 0L2000 -1500', points: 4 });
    expect(g.routes[1]!.kind).toBe('bus');
    expect(g.routes[1]!.d).toBe('M500 -500L900 -900L1300 -500');
    expect(g.viewBox).toBe('-200 -1700 2400 1900');
  });
});

// ---- mountMinimaps on a fake context ----------------------------------------------------------------------

const T0 = SNIMKA_WINDOW.fromSec;
const zg = (month: number, day: number, hour: number, minute = 0): number => Date.UTC(2026, month - 1, day, hour, minute) / 1000 - ZAGREB_OFFSET_S;
const slots = (SNIMKA_WINDOW.minutes * 60) / ROUTES_STEP_S;
const monday0745 = zg(9, 28, 7, 45);
const mondaySlot = Math.floor((monday0745 - T0) / ROUTES_STEP_S);
const tuesday0745 = zg(9, 29, 7, 45);

/** The window: 6 alive at Mon 07:45 only, 228 dead all day, 31 quiet. */
const windowRoutes = encodeRoutes(T0, ROUTES_STEP_S, ROUTES,
  [Uint8Array.from({ length: slots }, (_, j) => (j === mondaySlot ? 1 : 0)), new Uint8Array(slots), new Uint8Array(slots)],
  [new Uint8Array(slots).fill(4), new Uint8Array(slots).fill(2), new Uint8Array(slots)]);
/** Both comparison days: Thursday has 6 and 228 alive, Monday only 6. */
const compRoutes = (c: (typeof SNIMKA_COMPARISONS)[number]) => {
  const n = (c.minutes * 60) / ROUTES_STEP_S;
  const on = new Uint8Array(n).fill(2);
  return encodeRoutes(c.fromSec, ROUTES_STEP_S, ROUTES, [on, c.weekday === 4 ? on : new Uint8Array(n), new Uint8Array(n)], [on, on, new Uint8Array(n)], '395');
};

function fakeContext(startSec: number) {
  let nowMs = startSec * 1000;
  const clock = { now: () => nowMs, playing: () => false, suspended: () => false, speed: () => 600 as Speed, start: T0 * 1000, end: SNIMKA_WINDOW.toSec * 1000 } as ReplayClock;
  const subscribers = new Set<(t: number) => void>();
  const frames = { subscribe: (fn: (t: number) => void) => { subscribers.add(fn); return () => { subscribers.delete(fn); }; }, kick: vi.fn(), destroy: () => {} };
  const view = createViewStore();
  const comparisons = SNIMKA_COMPARISONS.map((c) => ({ id: c.id, day: c.day, weekday: c.weekday, fromSec: c.fromSec, series: {} as never, routes: compRoutes(c) }));
  const ctx = {
    manifest: { networks: { '396': { path: 'networks/396.json', bytes: 1, sha256: 'x' }, '395': { path: 'networks/395.json', bytes: 1, sha256: 'y' } } },
    routes: windowRoutes, comparisons, clock, frames, layers: createLayerStore(), view, reducedMotion: false, doc: document,
    data: { get: vi.fn(async () => net), url: () => '' },
  } as unknown as SnimkaContext;
  return { ctx, view, frame: (sec: number) => { nowMs = sec * 1000; for (const fn of [...subscribers]) fn(nowMs); }, subscribers };
}

const flush = async (): Promise<void> => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
const classesOf = (svg: Element, route: string): string[] => [...svg.querySelector(`[data-route="${route}"]`)!.classList].filter((c) => /^sn-mm-(alive|dead|quiet|subject)$/.test(c));

describe('mountMinimaps', () => {
  it('draws both sides once the network is in, classes the routes per sample on each side, captions the comparison day', async () => {
    const f = fakeContext(monday0745);
    const host = document.createElement('div');
    const unmount = mountMinimaps(f.ctx, host, { large: false });
    expect(host.querySelector('.sn-mm')!.getAttribute('data-sn-minimaps')).toBe('loading');
    await flush();
    const root = host.querySelector('.sn-mm')!;
    expect(root.getAttribute('data-sn-minimaps')).toBe('ready');
    const now = root.querySelector('.sn-mm-now svg')!;
    const normal = root.querySelector('.sn-mm-normal svg')!;
    expect(now.querySelectorAll('path')).toHaveLength(2);
    expect(now.getAttribute('data-sn-mm-paths')).toBe('2');
    expect(classesOf(now, '6')).toEqual(['sn-mm-alive']);
    expect(classesOf(now, '228')).toEqual(['sn-mm-dead']);
    expect(root.querySelector('.sn-mm-now .sn-mm-name')!.textContent).toBe('sada');
    expect(root.querySelector('.sn-mm-now .sn-mm-count')!.textContent).toBe('1 od 2 linija s vozilom');
    // Monday against Monday 21 Sep (S-12): 6 alive, 228 dead there too.
    expect(root.querySelector('.sn-mm-normal .sn-mm-name')!.textContent).toBe('ponedjeljak 21. rujna u isto doba');
    expect(classesOf(normal, '6')).toEqual(['sn-mm-alive']);
    expect(classesOf(normal, '228')).toEqual(['sn-mm-dead']);
    expect(root.querySelector('.sn-mm-legend')).toBeNull();
    // Tuesday: the window has nothing alive; the comparison is Thursday with both alive.
    f.frame(tuesday0745);
    expect(classesOf(now, '6')).toEqual(['sn-mm-dead']);
    expect(root.querySelector('.sn-mm-now .sn-mm-count')!.textContent).toBe('0 od 2 linija s vozilom');
    expect(root.querySelector('.sn-mm-normal .sn-mm-name')!.textContent).toBe('četvrtak 24. rujna u isto doba');
    expect(classesOf(normal, '228')).toEqual(['sn-mm-alive']);
    expect(normal.getAttribute('data-sn-mm-alive')).toBe('2');
    unmount();
    expect(host.querySelector('.sn-mm')).toBeNull();
    expect(f.subscribers.size).toBe(0);
  });
  it('a route subject outlines that route on both sides; large adds the three-word legend', async () => {
    const f = fakeContext(monday0745);
    const host = document.createElement('div');
    const unmount = mountMinimaps(f.ctx, host, { large: true });
    await flush();
    const root = host.querySelector('.sn-mm')!;
    expect([...root.querySelectorAll('.sn-mm-legend li')].map((li) => li.textContent)).toEqual(['linija s vozilom', 'po voznom redu, bez vozila', 'izvan voznog reda']);
    f.view.set({ subject: { kind: 'route', id: '228' } }, 'user');
    expect(root.getAttribute('data-sn-mm-subject')).toBe('228');
    for (const side of ['now', 'normal']) expect(classesOf(root.querySelector(`.sn-mm-${side} svg`)!, '228')).toContain('sn-mm-subject');
    expect(classesOf(root.querySelector('.sn-mm-now svg')!, '6')).not.toContain('sn-mm-subject');
    f.view.set({ subject: null }, 'user');
    expect(root.hasAttribute('data-sn-mm-subject')).toBe(false);
    expect(classesOf(root.querySelector('.sn-mm-now svg')!, '228')).toEqual(['sn-mm-dead']);
    unmount();
  });
  it('a network that fails to load leaves the frame unavailable and draws nothing', async () => {
    const f = fakeContext(monday0745);
    (f.ctx.data.get as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('offline'));
    const host = document.createElement('div');
    const unmount = mountMinimaps(f.ctx, host, { large: false });
    await flush();
    expect(host.querySelector('.sn-mm')!.getAttribute('data-sn-minimaps')).toBe('unavailable');
    expect(host.querySelectorAll('path')).toHaveLength(0);
    unmount();
  });
});
