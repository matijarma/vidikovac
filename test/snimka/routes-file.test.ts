// The routes stage (scripts/snimka/stage-routes.ts): a synthetic routes-seen
// work and a calendar-less expectation into a RoutesFile, through the codec.
import { describe, expect, it } from 'vitest';
import { buildRoutesFile, routeOrder } from '../../scripts/snimka/stage-routes';
import type { RoutesSeenWork } from '../../scripts/snimka/stage-frames';
import { decodeRoutes, ROUTES_MISSING } from '../../shared/snimka-codec';
import { isRoutesFile } from '../../shared/snimka';

const catalogue = {
  '6': { shortName: '6', type: 0 }, '17': { shortName: '17', type: 0 }, '4': { shortName: '4', type: 0 },
  '228': { shortName: '228', type: 3 }, '109': { shortName: '109', type: 3 }, '999': { shortName: '999', type: 3 },
};
const seen = (over: Partial<RoutesSeenWork> = {}): RoutesSeenWork => ({
  segment: 'window', t0: 1790532000, step: 300, n: 4, covered: [true, true, false, true],
  routes: { '17': [3, 2, 0, 1], '6': [0, 1, 0, 0], '228': [0, 0, 0, 2], '109': [300, 0, 0, 0], 'X9': [1, 0, 0, 0] }, ...over,
});

describe('the routes file', () => {
  it('lists seen routes trams first by short name in numeric order, then buses; a route never seen nor expected stays out', () => {
    const { file, unknownSeen } = buildRoutesFile(seen(), catalogue, null, '396+395');
    expect(isRoutesFile(file)).toBe(true);
    expect(file.routes.map((r) => r.id)).toEqual(['6', '17', '109', '228']);
    expect(file.routes.map((r) => r.type)).toEqual([0, 0, 3, 3]);
    expect(unknownSeen).toEqual(['X9']);
    expect(file.net).toBe('396+395');
    expect(file.n).toBe(4);
  });

  it('writes 255 for a slot without a sampled tick, the count elsewhere (zero is a real zero), capped below the sentinel', () => {
    const { file } = buildRoutesFile(seen(), catalogue, null, '395');
    const { seen: rows } = decodeRoutes(file);
    const row = (id: string): number[] => [...rows[file.routes.findIndex((r) => r.id === id)]!];
    expect(row('17')).toEqual([3, 2, ROUTES_MISSING, 1]);
    expect(row('6')).toEqual([0, 1, ROUTES_MISSING, 0]);
    expect(row('109')[0]).toBe(254);
  });

  it('writes 255 for every expected slot when no calendar knows the date', () => {
    const { file } = buildRoutesFile(seen(), catalogue, null, '395');
    for (const row of decodeRoutes(file).expected) expect([...row]).toEqual([255, 255, 255, 255]);
  });

  it('orders trams before buses and numbers numerically', () => {
    const list = [{ shortName: '31', type: 0 }, { shortName: '4', type: 0 }, { shortName: '101', type: 3 }, { shortName: '17', type: 0 }, { shortName: '6b', type: 3 }];
    expect([...list].sort(routeOrder).map((r) => r.shortName)).toEqual(['4', '17', '31', '6b', '101']);
  });
});
