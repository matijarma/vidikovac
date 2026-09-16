import { describe, expect, it } from 'vitest';
import type { ModuleSnapshot } from '../../worker/feed/schema';
import { routeDelayMap, vehicleFixes } from '../../app/src/motion/fixes';

const NOW = Date.parse('2026-09-12T10:00:00Z');
const snapshot = (items: ModuleSnapshot['items'], sourceUpdatedAt?: string): ModuleSnapshot => ({
  module: 'zet-rt', tier: 'session', status: 'live', fetchedAt: new Date(NOW).toISOString(), ...(sourceUpdatedAt ? { sourceUpdatedAt } : {}),
  attribution: { text: 'Izvor: ZET', url: 'https://example.test/', licence: 'Otvorena dozvola (NN 67/17)' }, items,
});

// The wire to the integrator (R-TE13): every `vehicle:` pin becomes one Fix at
// the twin's estimate, dated by the pin's own time, carrying the join and the
// twin's scalars, and its plan with knot times resolved against the
// snapshot's source time; a pin without a plan is a plain fix; the route
// rows become the delay map.
describe('vehicleFixes and routeDelayMap', () => {
  it('decodes path plans, free plans and plain pins, dating knots against sourceUpdatedAt', () => {
    const origin = '2026-09-12T09:59:40Z';
    const T = Date.parse(origin);
    const fixes = vehicleFixes(snapshot([
      {
        id: 'vehicle:1', module: 'zet-rt', kind: 'vehicle', tier: 'session', title: '6', at: '2026-09-12T09:59:36Z',
        geo: { type: 'Point', coordinates: [15.9792, 45.8132] },
        data: { routeId: '6', tripId: 'T1', vehicleId: '1', routeShortName: '6', routeType: 0, direction: 0, headsign: 'Sopot', shapeId: '6_25', nextStopId: '231_2', delaySeconds: 45, speed: 9.5, confidence: 0.9, held: false },
        motion: { path: '6_25', plan: [[-20, 1200], [0, 1400], [30, 1700]] },
      },
      {
        id: 'vehicle:2', module: 'zet-rt', kind: 'vehicle', tier: 'session', title: '109',
        geo: { type: 'Point', coordinates: [15.98, 45.82] },
        data: { routeId: '109', routeType: 3, confidence: 0.4 },
        motion: { plan: [[0, 15.98, 45.82], [20, 15.981, 45.821]] },
      },
      { id: 'vehicle:3', module: 'zet-rt', kind: 'vehicle', tier: 'session', title: '12', geo: { type: 'Point', coordinates: [15.9, 45.8] }, data: { routeId: '12', routeType: 0 } },
      { id: 'route:6', module: 'zet-rt', kind: 'vehicle', tier: 'session', title: '6', data: { routeId: '6', medianDelaySeconds: 40, vehicles: 2 } },
      { id: 'vozila', module: 'zet-rt', kind: 'vehicle', tier: 'session', title: '2 vozila u pokretu', data: { vehicles: 2 } },
    ], origin), NOW);
    expect(fixes).toEqual([
      {
        id: 'vehicle:1', lon: 15.9792, lat: 45.8132, at: Date.parse('2026-09-12T09:59:36Z'), tripId: 'T1', routeId: '6', type: 0,
        shapeId: '6_25', direction: 0, headsign: 'Sopot', nextStopId: '231_2', delaySeconds: 45, speed: 9.5, confidence: 0.9, held: false,
        path: '6_25', plan: { on: 'path', knots: [[T - 20_000, 1200], [T, 1400], [T + 30_000, 1700]] },
      },
      { id: 'vehicle:2', lon: 15.98, lat: 45.82, at: T, routeId: '109', type: 3, confidence: 0.4, plan: { on: 'free', knots: [[T, 15.98, 45.82], [T + 20_000, 15.981, 45.821]] } },
      { id: 'vehicle:3', lon: 15.9, lat: 45.8, at: T, routeId: '12', type: 0 },
    ]);
    expect(routeDelayMap(snapshot([{ id: 'route:6', module: 'zet-rt', kind: 'vehicle', tier: 'session', title: '6', data: { routeId: '6', medianDelaySeconds: 40, vehicles: 2 } }]))).toEqual(new Map([['6', 40]]));
    // A pin without a point, or no snapshot at all, is nothing.
    expect(vehicleFixes(snapshot([{ id: 'vehicle:9', module: 'zet-rt', kind: 'vehicle', tier: 'session', title: '6' }]), NOW)).toEqual([]);
    expect(vehicleFixes(undefined, NOW)).toEqual([]);
  });
});
