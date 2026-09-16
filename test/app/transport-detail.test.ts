import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ModuleSnapshot } from '../../worker/feed/schema';
import { createDefaultI18n } from '../../app/src/i18n/create-default-i18n';
import type { VehicleInfo } from '../../app/src/map/city-map';
import { decodeNetwork } from '../../shared/motion/network';
import { fullestShape } from '../../app/src/transport/catalogue';
import { closureItems, countByRoute, headingFromBearing, runningRoutes, terminusName, vehicleDirection, vehiclesAtStop, vehiclesOfModes, vehiclesOnRoute, zetNotices } from '../../app/src/transport/detail';

const i18n = createDefaultI18n('hr');
const v = (id: string, routeId: string | undefined, type: number, over: Partial<VehicleInfo> = {}): VehicleInfo => ({
  id, routeId, short: routeId ?? '', kind: type === 0 ? 'tram' : type === 3 ? 'bus' : 'other', type, lon: 15.97, lat: 45.81, bearing: null, confidence: 0.5, held: false, onShape: null, ...over,
});
const FLEET = [v('a', '6', 0), v('b', '6', 0, { bearing: 90, confidence: 0.9 }), v('c', '11', 0), v('d', '109', 3), v('e', undefined, -1)];

describe('what runs now', () => {
  it('lists one row per route with a vehicle moving, trams first, counting and reading the route delay in words where the module has one and nothing where it has none; a vehicle without a route is no row', () => {
    const rows = runningRoutes(FLEET, new Map([['6', 130], ['109', -20]]), i18n);
    expect(rows.map((r) => [r.routeId, r.count, r.word])).toEqual([['6', 2, 'kasni 2 min'], ['11', 1, ''], ['109', 1, 'rani 1 min']]);
  });
  it('filters by GTFS type, on a route and at a stop, and counts per route', () => {
    expect(vehiclesOfModes(FLEET, new Set([0])).map((x) => x.id)).toEqual(['a', 'b', 'c']);
    expect(vehiclesOfModes(FLEET, null)).toHaveLength(5);
    expect(vehiclesOnRoute(FLEET, '6').map((x) => x.id)).toEqual(['a', 'b']);
    expect(vehiclesAtStop(FLEET, { id: 's', ids: ['s'], name: 'S', lon: 0, lat: 0, routes: ['11', '109'] }).map((x) => x.id)).toEqual(['c', 'd']);
    expect([...countByRoute(FLEET)]).toEqual([['6', 2], ['11', 1], ['109', 1]]);
  });
});

describe('which way a vehicle faces', () => {
  const net = decodeNetwork(JSON.parse(readFileSync(resolve(import.meta.dirname, '../../app/public/data/zet-network.json'), 'utf8')));
  it('reads "smjer nepoznat" without a heading, the shape\u2019s terminus with one, and the compass point off the geometry', () => {
    expect(vehicleDirection(i18n, net, v('a', '6', 0))).toBe('smjer nepoznat');
    const shape = fullestShape(net, '6')!;
    const terminus = terminusName(net, shape)!;
    expect(['Črnomerec', 'Sopot']).toContain(terminus);
    expect(vehicleDirection(i18n, net, v('a', '6', 0, { bearing: 90, onShape: shape }))).toBe(`smjer ${terminus}`);
    expect(vehicleDirection(i18n, null, v('a', '6', 0, { bearing: 90 }))).toBe('smjer istok');
    expect(vehicleDirection(i18n, net, v('a', '6', 0, { bearing: 0 }))).toBe('smjer sjever');
  });
  it('turns compass degrees back into a unit heading, x east and y north', () => {
    expect(headingFromBearing(90).x).toBeCloseTo(1);
    expect(headingFromBearing(0).y).toBeCloseTo(1);
    expect(headingFromBearing(180).y).toBeCloseTo(-1);
  });
});

describe('closures and ZET notices', () => {
  const snap = (module: ModuleSnapshot['module'], items: ModuleSnapshot['items']): ModuleSnapshot => ({
    module, tier: 'session', status: 'live', fetchedAt: '2026-09-11T12:00:00Z', attribution: { text: '', url: '', licence: '' }, items,
  });
  it('keeps only ZET\u2019s two feeds from the events module, newest first, capped', () => {
    const events = snap('dogadanja', [
      { id: 'k1', module: 'dogadanja', kind: 'event', tier: 'session', title: 'Koncert', at: '2026-09-12T18:00:00Z', data: { source: 'kulturpunkt' } },
      { id: 'z1', module: 'dogadanja', kind: 'event', tier: 'session', title: 'Izmjena trase 6', at: '2026-09-11T08:00:00Z', data: { source: 'zet-promet' } },
      { id: 'z2', module: 'dogadanja', kind: 'event', tier: 'session', title: 'Novi red vožnje', at: '2026-09-11T10:00:00Z', data: { source: 'zet-novosti' } },
    ]);
    expect(zetNotices(events).map((n) => n.id)).toEqual(['z2', 'z1']);
    expect(zetNotices(events, 1).map((n) => n.id)).toEqual(['z2']);
    expect(zetNotices(undefined)).toEqual([]);
  });
  it('lists closures by kind, whatever their geometry', () => {
    const closures = snap('prometnice', [
      { id: 'c1', module: 'prometnice', kind: 'closure', tier: 'open', title: 'Ilica' },
      { id: 'x', module: 'prometnice', kind: 'poi', tier: 'open', title: 'no' },
    ]);
    expect(closureItems(closures).map((c) => c.id)).toEqual(['c1']);
    expect(closureItems(undefined)).toEqual([]);
  });
});
