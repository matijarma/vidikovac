// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { createDefaultI18n } from '../../app/src/i18n/create-default-i18n';
import en from '../../app/src/i18n/en.json';
import hr from '../../app/src/i18n/hr.json';
import { toPlane } from '../../shared/motion/geo';
import type { Fix } from '../../app/src/motion/integrator';
import type { Network, Shape } from '../../shared/motion/network';
import { cumulative } from '../../shared/motion/polyline';
import { ROUTE_TYPE_BUS, ROUTE_TYPE_TRAM } from '../../app/src/motion/schematic';
import { createSchematicHost, HONESTY_NOTE_HR, TRAMS_ONLY } from '../../app/src/motion/schematic-host';
import { NETWORK_RELOAD_RETRY_MS } from '../../app/src/motion/network-reload';
import { corridorSpec, syntheticNetwork } from './synthetic-network';

const NOW = Date.parse('2026-09-12T10:00:00Z');

function shapeOf(id: string, route: string, lonlat: [number, number][]): Shape {
  const pts = lonlat.map(([lon, lat]) => toPlane(lon, lat));
  const cum = cumulative(pts);
  return { id, route, pts, cum, len: cum[cum.length - 1] };
}

/** A tram line through Trg bana Jelačića and a bus line far out east in
 *  Dubrava -- outside the default crop, inside the whole network. */
function testNetwork(): Network {
  const tram = shapeOf('S-tram', 'R-tram', [[15.965, 45.813], [15.99, 45.813]]);
  const bus = shapeOf('S-bus', 'R-bus', [[16.05, 45.83], [16.07, 45.83]]);
  return {
    version: 1,
    feedVersion: 'test',
    routes: new Map([
      ['R-tram', { short: '6', type: ROUTE_TYPE_TRAM, rank: 1, shapes: [0] }],
      ['R-bus', { short: '279', type: ROUTE_TYPE_BUS, rank: 2, shapes: [1] }],
    ]),
    shapes: [tram, bus],
    stops: [],
    diagram: { lines: [], box: [1, 1] },
    nextStop: () => null,
  };
}

function fix(over: Partial<Fix> & { id: string; lon: number; lat: number }): Fix {
  return { at: NOW, ...over };
}

const flush = async (): Promise<void> => { for (let i = 0; i < 6; i += 1) await Promise.resolve(); };
const frame = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()));
const legend = (el: HTMLElement) => el.querySelector('[data-testid=schematic-legend]')?.textContent;

function host(opts: { scope?: 'network' | 'crop'; lightweight?: boolean; net?: Network | null; deferred?: boolean; locale?: 'hr' | 'en'; publicDisplay?: boolean; reloadNetwork?: () => Promise<Network | null> } = {}) {
  let resolve: ((net: Network | null) => void) | null = null;
  const loadNetwork = vi.fn(() => new Promise<Network | null>((r) => {
    if (opts.deferred) resolve = r;
    else r(opts.net === undefined ? testNetwork() : opts.net);
  }));
  const h = createSchematicHost({
    i18n: createDefaultI18n(opts.locale ?? 'hr'),
    scope: opts.scope === 'crop' ? { kind: 'crop', types: TRAMS_ONLY } : { kind: 'network' },
    lightweight: opts.lightweight ?? false,
    publicDisplay: opts.publicDisplay,
    now: () => NOW,
    loadNetwork,
    ...(opts.reloadNetwork ? { reloadNetwork: opts.reloadNetwork } : {}),
  });
  const root = document.createElement('div');
  document.body.appendChild(root);
  return { h, root, loadNetwork, resolveNetwork: (net: Network | null) => resolve?.(net) };
}

describe('createSchematicHost', () => {
  it('carries the honesty note verbatim (R-P2) and a loading line until the network has settled, and loads nothing before mount()', async () => {
    const { h, root, loadNetwork } = host();
    expect(loadNetwork).not.toHaveBeenCalled();
    root.appendChild(h.mount());
    expect(loadNetwork).toHaveBeenCalledTimes(1);
    expect(root.querySelector('[data-testid=schematic-note]')!.textContent).toBe(HONESTY_NOTE_HR);
    expect(HONESTY_NOTE_HR).toBe('Položaj je izračunat iz vlastitih očitanja svakog vozila, geometrije pruge i voznog reda; ZET ne objavljuje smjer ni brzinu.');
    expect(HONESTY_NOTE_HR).toBe(hr.motion.note);
    expect(root.querySelector('[data-testid=schematic-loading]')!.textContent).toBe('učitavanje podataka');
    expect(root.querySelector('[data-testid=schematic]')).toBeNull();
    await flush();
    expect(root.querySelector('[data-testid=schematic-loading]')).toBeNull();
    expect(root.querySelector('[data-testid=schematic]')).not.toBeNull();
    // Note after the view, so the map is read first and the caveat under it.
    const children = [...root.querySelector('[data-testid=schematic-host]')!.children].map((c) => c.getAttribute('data-testid'));
    expect(children.indexOf('schematic')).toBeLessThan(children.indexOf('schematic-note'));
  });

  it('prints no note on a public display: the wall carries no caveat (companion brief §12), the phone keeps it', async () => {
    const { h, root } = host({ scope: 'crop', publicDisplay: true });
    root.appendChild(h.mount());
    await flush();
    expect(root.querySelector('[data-testid=schematic]')).not.toBeNull();
    expect(root.querySelector('[data-testid=schematic-note], .schematic-note')).toBeNull();
    expect(root.textContent).not.toContain(HONESTY_NOTE_HR);
  });

  it('prints the note from the catalogue in the page language, so an English page reads motion.note in English', () => {
    const { h, root } = host({ locale: 'en', lightweight: true });
    root.appendChild(h.mount());
    expect(root.querySelector('[data-testid=schematic-note]')!.textContent).toBe(en.motion.note);
    expect(en.motion.note).not.toBe(HONESTY_NOTE_HR);
  });

  it('returns the same element from every mount() and loads the network once', async () => {
    const { h, root, loadNetwork } = host();
    const first = h.mount();
    root.appendChild(first);
    await flush();
    expect(h.mount()).toBe(first);
    expect(loadNetwork).toHaveBeenCalledTimes(1);
  });

  it('replays the last update into the view once the network arrives, and a session scope shows the whole network', async () => {
    const { h, root, resolveNetwork } = host({ deferred: true });
    root.appendChild(h.mount());
    // Data landed before the artefact did: a bus out in Dubrava, far outside
    // the default 900 m crop but on the network.
    h.update({ fixes: [fix({ id: 'bus', lon: 16.06, lat: 45.83, routeId: 'R-bus' })] }, NOW);
    resolveNetwork(testNetwork());
    await flush();
    await frame();
    expect(legend(root)).toBe('1 od 1 praćenih vozila u kadru');
  });

  it('a crop scope keeps to the screen centre and to trams (R-P1)', async () => {
    const { h, root } = host({ scope: 'crop' });
    root.appendChild(h.mount());
    await flush();
    h.update({ fixes: [
      fix({ id: 'tram', lon: 15.977, lat: 45.813, routeId: 'R-tram' }),
      fix({ id: 'bus-here', lon: 15.977, lat: 45.8135, routeId: 'R-bus' }), // inside the crop, wrong type: in neither number (R-F2)
      fix({ id: 'tram-far', lon: 15.99, lat: 45.813, routeId: 'R-tram' }), // on the line, ~1 km east: outside the crop
    ] }, NOW);
    await frame();
    expect(legend(root)).toBe('1 od 2 praćenih vozila u kadru');
  });

  it('in lightweight mode never asks for the network, mounts the list synchronously (with the honest loading line before the first poll, R-F8), and still carries the note', () => {
    const { h, root, loadNetwork } = host({ lightweight: true });
    root.appendChild(h.mount());
    expect(loadNetwork).not.toHaveBeenCalled();
    expect(root.querySelector('canvas')).toBeNull();
    expect(root.querySelector('[data-testid=schematic-list]')).not.toBeNull();
    // R-F8: the list is built from the poll's own vehicles now, not from
    // network-artefact stops that were known before any poll landed -- so,
    // like the legend right beside it, it says "loading" rather than a
    // false empty until the first update() actually arrives.
    expect(root.querySelector('[data-testid=schematic-loading]')).not.toBeNull();
    expect(root.querySelector('[data-testid=schematic-note]')!.textContent).toBe(HONESTY_NOTE_HR);
  });

  it('a failed network load (null) still mounts the view: vehicles free-plane, no crash', async () => {
    const { h, root } = host({ net: null });
    root.appendChild(h.mount());
    await flush();
    expect(root.querySelector('[data-testid=schematic]')).not.toBeNull();
    h.update({ fixes: [fix({ id: 'v', lon: 15.977, lat: 45.813 })] }, NOW);
    await frame();
    expect(legend(root)).toBe('1 od 1 praćenih vozila u kadru');
  });

  it('pause() and resume() reach the view once it exists, and a pause before mount is remembered', async () => {
    const { h, root, resolveNetwork } = host({ deferred: true });
    root.appendChild(h.mount());
    h.pause();
    resolveNetwork(testNetwork());
    await flush();
    const view = root.querySelector<HTMLElement>('[data-testid=schematic]')!;
    const framesBefore = view.dataset.frames;
    h.update({ fixes: [fix({ id: 'v', lon: 15.977, lat: 45.813, routeId: 'R-tram' })] }, NOW);
    await frame();
    await frame();
    expect(view.dataset.frames).toBe(framesBefore); // paused: no frame drawn
    h.resume();
    await frame();
    await frame();
    expect(Number(view.dataset.frames)).toBeGreaterThan(Number(framesBefore));
  });

  // A rebuilt rail graph under a new graphHash (decision 25's connectors at
  // D3): the city map migrates in place (city-map.ts acceptNetwork); the host,
  // which owns this schematic's artefact, does the same rather than showing no
  // trams until a page reload (review of D3, finding 3).
  it('adopts a rebuilt graph as the city map does: a fix naming another graphHash reloads the artefact once, the view is remounted on the new graph and the vehicles reappear without a page reload', async () => {
    const oldGraph = { ...syntheticNetwork(corridorSpec()), graphHash: 'aaaaaaaaaaaaaaaa' };
    const newGraph = { ...syntheticNetwork(corridorSpec()), graphHash: 'bbbbbbbbbbbbbbbb' };
    let finish!: (net: Network | null) => void;
    const reloadNetwork = vi.fn(() => new Promise<Network | null>((r) => { finish = r; }));
    const { h, root, loadNetwork } = host({ net: oldGraph, reloadNetwork });
    root.appendChild(h.mount());
    await flush();
    const onPath = (network: string, s: number): Fix => fix({ id: 'tram', lon: 16, lat: 46, routeId: '1', type: ROUTE_TYPE_TRAM, path: '1_0', network, plan: { on: 'path', knots: [[NOW, s], [NOW + 60_000, s]] } });
    h.update({ fixes: [onPath(oldGraph.graphHash, 500)] }, NOW);
    await frame();
    expect(legend(root)).toBe('1 od 1 praćenih vozila u kadru');
    expect(reloadNetwork).not.toHaveBeenCalled();
    const before = root.querySelector('[data-testid=schematic]');

    h.update({ fixes: [onPath(newGraph.graphHash, 500)] }, NOW + 1000);
    await frame();
    // Never a new arc on old rails: the tram is gone until the replacement graph is in.
    expect(reloadNetwork).toHaveBeenCalledTimes(1);
    expect(h.element.dataset.networkStale).toBe('true');
    expect(root.querySelector('[data-testid=schematic]')).toBeNull();
    expect(root.querySelector('[data-testid=schematic-loading]')).not.toBeNull();
    h.update({ fixes: [onPath(newGraph.graphHash, 500)] }, NOW + 2000);
    expect(reloadNetwork).toHaveBeenCalledTimes(1); // one request in flight, not one per poll

    finish(newGraph);
    await flush();
    await frame();
    expect(h.element.dataset.networkStale).toBeUndefined();
    expect(root.querySelector('[data-testid=schematic]')).not.toBe(before);
    expect(legend(root)).toBe('1 od 1 praćenih vozila u kadru');
    expect(loadNetwork).toHaveBeenCalledTimes(1);
  });

  it('in lightweight mode a fix naming a graph reloads nothing (R-L4), and a matching graph is never reloaded', async () => {
    const graph = { ...syntheticNetwork(corridorSpec()), graphHash: 'aaaaaaaaaaaaaaaa' };
    const named = fix({ id: 'tram', lon: 16, lat: 46, routeId: '1', type: ROUTE_TYPE_TRAM, path: '1_0', network: graph.graphHash, plan: { on: 'path', knots: [[NOW, 500], [NOW + 60_000, 500]] } });
    const lightReload = vi.fn<() => Promise<Network | null>>();
    const light = host({ lightweight: true, reloadNetwork: lightReload });
    light.root.appendChild(light.h.mount());
    light.h.update({ fixes: [named] }, NOW);
    await frame();
    expect(lightReload).not.toHaveBeenCalled();
    expect(light.loadNetwork).not.toHaveBeenCalled();
    const reloadNetwork = vi.fn();
    const full = host({ net: graph, reloadNetwork });
    full.root.appendChild(full.h.mount());
    await flush();
    full.h.update({ fixes: [named] }, NOW);
    await frame();
    expect(legend(full.root)).toBe('1 od 1 praćenih vozila u kadru');
    expect(reloadNetwork).not.toHaveBeenCalled();
    expect(lightReload).not.toHaveBeenCalled();
    expect(light.h.element.dataset.networkStale).toBeUndefined();
  });

  // update() runs on every dashboard render and kiosk repaint, not only per
  // poll (review of lane/t-schema, finding 1): a failed reload is asked again
  // at most once per poll interval, on the update's own clock.
  it('spends at most one artefact reload attempt per poll interval: twenty identical updates on one clock are one fetch, the next interval one more', async () => {
    const oldGraph = { ...syntheticNetwork(corridorSpec()), graphHash: 'aaaaaaaaaaaaaaaa' };
    const newGraph = { ...syntheticNetwork(corridorSpec()), graphHash: 'bbbbbbbbbbbbbbbb' };
    const reloadNetwork = vi.fn<() => Promise<Network | null>>().mockResolvedValue(null);
    const { h, root } = host({ net: oldGraph, reloadNetwork });
    root.appendChild(h.mount());
    await flush();
    const named = fix({ id: 'tram', lon: 16, lat: 46, routeId: '1', type: ROUTE_TYPE_TRAM, path: '1_0', network: newGraph.graphHash, plan: { on: 'path', knots: [[NOW, 500], [NOW + 60_000, 500]] } });
    for (let i = 0; i < 20; i++) {
      h.update({ fixes: [named] }, NOW);
      await flush();
    }
    expect(reloadNetwork).toHaveBeenCalledTimes(1);
    h.update({ fixes: [named] }, NOW + NETWORK_RELOAD_RETRY_MS - 1);
    await flush();
    expect(reloadNetwork).toHaveBeenCalledTimes(1);
    h.update({ fixes: [named] }, NOW + NETWORK_RELOAD_RETRY_MS);
    await flush();
    expect(reloadNetwork).toHaveBeenCalledTimes(2);
    reloadNetwork.mockResolvedValueOnce(newGraph);
    h.update({ fixes: [named] }, NOW + 2 * NETWORK_RELOAD_RETRY_MS);
    await flush();
    expect(reloadNetwork).toHaveBeenCalledTimes(3);
    await frame();
    expect(legend(root)).toBe('1 od 1 praćenih vozila u kadru');
  });

  it('retries a failed or wrong-graph reload at the next poll interval, and a completion after destroy() mounts nothing', async () => {
    const oldGraph = { ...syntheticNetwork(corridorSpec()), graphHash: 'aaaaaaaaaaaaaaaa' };
    const newGraph = { ...syntheticNetwork(corridorSpec()), graphHash: 'bbbbbbbbbbbbbbbb' };
    const reloadNetwork = vi.fn<() => Promise<Network | null>>().mockResolvedValueOnce(null).mockResolvedValueOnce(oldGraph).mockResolvedValueOnce(newGraph);
    const { h, root } = host({ net: oldGraph, reloadNetwork });
    root.appendChild(h.mount());
    await flush();
    const onPath = (network: string): Fix => fix({ id: 'tram', lon: 16, lat: 46, routeId: '1', type: ROUTE_TYPE_TRAM, path: '1_0', network, plan: { on: 'path', knots: [[NOW, 500], [NOW + 60_000, 500]] } });
    // One poll interval apart: the budget (network-reload.ts) allows one attempt per interval.
    for (let i = 0; i < 3; i++) {
      h.update({ fixes: [onPath(newGraph.graphHash)] }, NOW + NETWORK_RELOAD_RETRY_MS * (i + 1));
      if (i === 2) h.destroy();
      await flush();
      expect(root.querySelector('[data-testid=schematic]')).toBeNull();
    }
    expect(reloadNetwork).toHaveBeenCalledTimes(3);
    expect(h.element.querySelector('[data-testid=schematic]')).toBeNull();
  });

  it('destroy() removes the element, and a network resolving afterwards mounts nothing', async () => {
    const { h, root, resolveNetwork } = host({ deferred: true });
    root.appendChild(h.mount());
    h.destroy();
    expect(root.querySelector('[data-testid=schematic-host]')).toBeNull();
    resolveNetwork(testNetwork());
    await flush();
    expect(h.element.querySelector('[data-testid=schematic]')).toBeNull();
  });
});
