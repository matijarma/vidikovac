import { describe, expect, it } from 'vitest';
import { SILENCE_HOLD_S } from '../../shared/motion/plan';
import { isPathMotion } from '../../shared/motion/wire';
import { createEngine } from '../../worker/twin/engine';
import type { TripJoin } from '../../worker/twin/publish';
import { emptyState, type TwinState } from '../../worker/twin/state';
import { runTick } from '../../worker/twin/tick';
import { corridorSpec, lonLatOf, syntheticNetwork } from '../motion/synthetic-network';
import { corridorIndex } from './engine-fixture';

// T8 through the whole tick: buildPlan holds a silent tram at its next stop,
// and the ordering register that runs after it must not undo that. Two trams
// of line 1 on the corridor's trunk, A ahead of B; A falls silent running for
// T600 while B keeps reporting behind it, close enough that B's own plan
// would carry a tram length past T600 inside the horizon. A push is B's plan,
// an extrapolation, so it may not lift A past the stop T8 holds it at.
describe('runTick with a silent leader', () => {
  const net = syntheticNetwork(corridorSpec());
  const index = corridorIndex(net, [
    { tripId: 'tA', pathId: '1_0' },
    { tripId: 'tB', pathId: '1_0' },
  ]);
  const engine = createEngine(net, index);
  const join: TripJoin = { direction: 0, headsign: 'Kraj 1_0', shapeId: '1_0', pathId: '1_0' };
  const joins = new Map<string, TripJoin>([
    ['tA', join],
    ['tB', join],
  ]);
  const routes = { '1': { shortName: '1', longName: 'Trunk east', type: 0 } };
  const T = 1_800_000_000;
  const vehicle = (id: string, x: number, atSec: number) => {
    const { lon, lat } = lonLatOf({ x, y: 0 });
    return { vehicleId: id, tripId: `t${id}`, routeId: '1', lon, lat, atSec };
  };

  it('keeps a silent leader at its next stop through the ordering register, with the order still on the wire', () => {
    // A's last fix is at 500 m at T+8; ZET keeps repeating it, as it does.
    const frames: [header: number, a: [number, number], b: [number, number]][] = [
      [T, [400, T - 2], [200, T - 2]],
      [T + 10, [500, T + 8], [300, T + 8]],
      [T + 20, [500, T + 8], [400, T + 18]],
      [T + 30, [500, T + 8], [480, T + 28]],
      [T + 40, [500, T + 8], [530, T + 38]],
      [T + 50, [500, T + 8], [555, T + 48]],
      [T + 60, [500, T + 8], [560, T + 58]],
    ];
    let state: TwinState = emptyState();
    let silentTicks = 0;
    for (const [header, [ax, aAt], [bx, bAt]] of frames) {
      const nowMs = (header + 2) * 1000;
      const feed = { headerTs: header, vehicles: [vehicle('A', ax, aAt), vehicle('B', bx, bAt)], tripUpdates: [] };
      const result = runTick({ state, feed, nowMs, joins, routes, engine, validUntilMs: nowMs + 10_000 });
      state = result.state;
      const a = result.payload.items.find((item) => item.id === 'vehicle:A')!;
      const b = result.payload.items.find((item) => item.id === 'vehicle:B')!;
      expect(a.motion && isPathMotion(a.motion)).toBe(true);
      expect(b.motion && isPathMotion(b.motion)).toBe(true);
      if (header >= T + 10) expect(b.data?.behind, `B's leader at header ${header - T}`).toBe('A');
      if (header + 2 - aAt <= SILENCE_HOLD_S) continue;
      silentTicks++;
      // Silent: A's published plan never passes T600 (arc 600, decimetre wire
      // rounding aside), and the next stop it publishes is still T600.
      const plan = isPathMotion(a.motion!) ? a.motion.plan : [];
      for (const [t, s] of plan) expect(s, `A at +${t} s, header ${header - T}`).toBeLessThanOrEqual(600 + 0.1);
      expect(plan[plan.length - 1][1]).toBeCloseTo(600, 0);
      expect(a.data?.nextStopId).toBe('T600');
      // The world the rule is about: B's own plan runs well past T600, so an
      // unbounded push would have lifted A a tram length ahead of it.
      const bPlan = isPathMotion(b.motion!) ? b.motion.plan : [];
      expect(bPlan[bPlan.length - 1][1]).toBeGreaterThan(600);
    }
    expect(silentTicks).toBeGreaterThanOrEqual(3);
  });
});
