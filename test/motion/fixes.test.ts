import { describe, expect, it } from 'vitest';
import type { ModuleSnapshot } from '../../worker/feed/schema';
import { routeDelayMap, vehicleFixes } from '../../app/src/motion/fixes';

const NOW = Date.parse('2026-09-12T10:00:00Z');
const snapshot = (items: ModuleSnapshot['items']): ModuleSnapshot => ({
  module: 'zet-rt', tier: 'session', status: 'live', fetchedAt: new Date(NOW).toISOString(),
  attribution: { text: 'Izvor: ZET', url: 'https://example.test/', licence: 'Otvorena dozvola (NN 67/17)' }, items,
});

describe('vehicleFixes', () => {
  it('turns every vehicle: pin with a point into a Fix carrying its own timestamp, trip, route and type', () => {
    const fixes = vehicleFixes(snapshot([
      { id: 'vehicle:1', module: 'zet-rt', kind: 'vehicle', tier: 'session', title: '6', at: '2026-09-12T09:59:30Z', geo: { type: 'Point', coordinates: [15.977, 45.813] }, data: { routeId: '6', tripId: 'T1', vehicleId: '1', routeShortName: '6', routeType: 0 } },
      { id: 'vehicle:2', module: 'zet-rt', kind: 'vehicle', tier: 'session', title: '109', geo: { type: 'Point', coordinates: [15.98, 45.82] }, data: { routeId: '109', routeType: 3 } },
      { id: 'route:6', module: 'zet-rt', kind: 'vehicle', tier: 'session', title: '6', data: { routeId: '6', medianDelaySeconds: 40, vehicles: 2 } },
      { id: 'vozila', module: 'zet-rt', kind: 'vehicle', tier: 'session', title: '2 vozila u pokretu', data: { vehicles: 2 } },
    ]), NOW);
    expect(fixes).toEqual([
      { id: 'vehicle:1', lon: 15.977, lat: 45.813, at: Date.parse('2026-09-12T09:59:30Z'), tripId: 'T1', routeId: '6', type: 0 },
      { id: 'vehicle:2', lon: 15.98, lat: 45.82, at: NOW, tripId: undefined, routeId: '109', type: 3 },
    ]);
  });
  // A pin with no timestamp of its own (ZET omits it now and then) is dated
  // at the snapshot's own source time, never at "now" on the reader's clock
  // when the source time is known -- the fix is evidence about when the
  // source saw it, and the same snapshot re-read on the next poll must not
  // read as a fresh fix.
  it('dates a pin without its own timestamp at the snapshot sourceUpdatedAt, then fetchedAt, then now', () => {
    const pin: ModuleSnapshot['items'][number] = { id: 'vehicle:1', module: 'zet-rt', kind: 'vehicle', tier: 'session', title: '6', geo: { type: 'Point', coordinates: [15.977, 45.813] } };
    const withSource = { ...snapshot([pin]), sourceUpdatedAt: '2026-09-12T09:59:00Z' };
    expect(vehicleFixes(withSource, NOW)[0].at).toBe(Date.parse('2026-09-12T09:59:00Z'));
    expect(vehicleFixes(snapshot([pin]), NOW)[0].at).toBe(NOW); // fetchedAt === NOW in this fixture
    expect(vehicleFixes({ ...snapshot([pin]), fetchedAt: 'garbage' }, NOW)[0].at).toBe(NOW);
  });
  it('drops a pin without a point, and returns nothing for no snapshot', () => {
    expect(vehicleFixes(snapshot([{ id: 'vehicle:9', module: 'zet-rt', kind: 'vehicle', tier: 'session', title: '6' }]), NOW)).toEqual([]);
    expect(vehicleFixes(undefined, NOW)).toEqual([]);
  });
});

describe('routeDelayMap', () => {
  it('maps routeId to medianDelaySeconds from the route: rows only', () => {
    const map = routeDelayMap(snapshot([
      { id: 'route:6', module: 'zet-rt', kind: 'vehicle', tier: 'session', title: '6', data: { routeId: '6', medianDelaySeconds: 40, vehicles: 2 } },
      { id: 'route:11', module: 'zet-rt', kind: 'vehicle', tier: 'session', title: '11', data: { routeId: '11', medianDelaySeconds: -20, vehicles: 1 } },
      { id: 'route:x', module: 'zet-rt', kind: 'vehicle', tier: 'session', title: 'x', data: { routeId: 'x', vehicles: 1 } },
      { id: 'vehicle:1', module: 'zet-rt', kind: 'vehicle', tier: 'session', title: '6', data: { routeId: '6' } },
    ]));
    expect([...map]).toEqual([['6', 40], ['11', -20]]);
    expect(routeDelayMap(undefined).size).toBe(0);
  });
});

// A6 (R-TE2): a pin with the twin's history becomes one Fix per past report,
// oldest first, dated against the source time, each carrying the join.
describe('vehicleFixes with the twin history', () => {
  it('expands the history with the join on each fix, keeps direction 0, and falls back to the pin without a source time', () => {
    const origin = '2026-09-12T09:59:40Z';
    const pin: ModuleSnapshot['items'][number] = {
      id: 'vehicle:1', module: 'zet-rt', kind: 'vehicle', tier: 'session', title: '6', at: '2026-09-12T09:59:36Z',
      geo: { type: 'Point', coordinates: [15.9792, 45.8132] },
      data: { routeId: '6', tripId: 'T1', vehicleId: '1', routeShortName: '6', routeType: 0, direction: 0, headsign: 'Sopot', shapeId: '6_25', nextStopId: '231_2', delaySeconds: 45 },
      motion: { history: [[-24, 15.977, 45.813], [-4, 15.9792, 45.8132]] },
    };
    const T = Date.parse(origin);
    expect(vehicleFixes({ ...snapshot([pin]), sourceUpdatedAt: origin }, NOW)).toEqual([
      { id: 'vehicle:1', lon: 15.977, lat: 45.813, at: T - 24_000, tripId: 'T1', routeId: '6', type: 0, shapeId: '6_25', direction: 0, headsign: 'Sopot' },
      { id: 'vehicle:1', lon: 15.9792, lat: 45.8132, at: T - 4_000, tripId: 'T1', routeId: '6', type: 0, shapeId: '6_25', direction: 0, headsign: 'Sopot' },
    ]);
    const single = vehicleFixes(snapshot([pin]), NOW);
    expect(single).toHaveLength(1);
    expect(single[0]).toMatchObject({ lon: 15.9792, at: Date.parse('2026-09-12T09:59:36Z'), shapeId: '6_25', direction: 0, headsign: 'Sopot' });
  });
});
