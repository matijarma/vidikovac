// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { createDefaultI18n } from '../../app/src/i18n/create-default-i18n';
import { toPlane } from '../../app/src/motion/geo';
import type { Fix } from '../../app/src/motion/model';
import type { Network, Shape } from '../../app/src/motion/network';
import { cumulative } from '../../app/src/motion/polyline';
import { ROUTE_TYPE_BUS, ROUTE_TYPE_TRAM } from '../../app/src/motion/schematic';
import { createSchematicHost, HONESTY_NOTE_HR, TRAMS_ONLY } from '../../app/src/motion/schematic-host';

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

function host(opts: { scope?: 'network' | 'crop'; lightweight?: boolean; net?: Network | null; deferred?: boolean } = {}) {
  let resolve: ((net: Network | null) => void) | null = null;
  const loadNetwork = vi.fn(() => new Promise<Network | null>((r) => {
    if (opts.deferred) resolve = r;
    else r(opts.net === undefined ? testNetwork() : opts.net);
  }));
  const h = createSchematicHost({
    i18n: createDefaultI18n('hr'),
    scope: opts.scope === 'crop' ? { kind: 'crop', types: TRAMS_ONLY } : { kind: 'network' },
    lightweight: opts.lightweight ?? false,
    now: () => NOW,
    loadNetwork,
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
    expect(HONESTY_NOTE_HR).toBe('Položaj je izračunat iz vlastitih očitanja svakog vozila i geometrije linije; ZET ne objavljuje smjer ni brzinu.');
    expect(root.querySelector('[data-testid=schematic-loading]')!.textContent).toBe('učitavanje podataka');
    expect(root.querySelector('[data-testid=schematic]')).toBeNull();
    await flush();
    expect(root.querySelector('[data-testid=schematic-loading]')).toBeNull();
    expect(root.querySelector('[data-testid=schematic]')).not.toBeNull();
    // Note after the view, so the map is read first and the caveat under it.
    const children = [...root.querySelector('[data-testid=schematic-host]')!.children].map((c) => c.getAttribute('data-testid'));
    expect(children.indexOf('schematic')).toBeLessThan(children.indexOf('schematic-note'));
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

  it('in lightweight mode never asks for the network, mounts the list synchronously, and still carries the note', () => {
    const { h, root, loadNetwork } = host({ lightweight: true });
    root.appendChild(h.mount());
    expect(loadNetwork).not.toHaveBeenCalled();
    expect(root.querySelector('canvas')).toBeNull();
    expect(root.querySelector('[data-testid=schematic-list]')).not.toBeNull();
    expect(root.querySelector('[data-testid=schematic-loading]')).toBeNull();
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
