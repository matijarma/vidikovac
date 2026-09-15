import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DATA_KEYS, type FeedItem } from '../../worker/feed/schema';
import { parseZetRt } from '../../worker/feed/modules/zet-rt';
import { HISTORY_FIXES, isFreeMotion, isHistoryMotion, isPathMotion, type VehicleMotion } from '../../shared/motion/wire';

const zetRtFixture = new Uint8Array(readFileSync(new URL('../fixtures/zet-rt.pb', import.meta.url)));

/**
 * R-P3: the Worker stops publishing a bearing and a speed ZET never sends.
 * This is the schema-level guard, not the module-level one: it fails if
 * either side of the contract regresses independently of the other.
 *   - the vocabulary itself (DATA_KEYS.vehicle) could quietly re-admit the
 *     keys, which a "module emits only what DATA_KEYS allows" check would
 *     not catch, because both sides would agree again;
 *   - the module could start emitting them again without anyone touching
 *     DATA_KEYS, which a check anchored only to the constant would not see.
 * Both are driven off the real ZET fixture in test/fixtures/, not synthetic
 * data, so this is proof against the actual wire format, not an assumption
 * about it.
 *
 * R-TE1 narrows this to ZET's own fields: from B5 the vehicle row carries the
 * twin's own `speed`, and this guard is rewritten then to "never
 * position.speed". Until then the key stays out.
 */
describe('the vehicle data vocabulary never re-admits bearing or speed', () => {
  it('excludes bearing and speed from DATA_KEYS.vehicle', () => {
    expect(DATA_KEYS.vehicle).not.toContain('bearing');
    expect(DATA_KEYS.vehicle).not.toContain('speed');
  });

  it('never lets the real ZET fixture produce a bearing or a speed on a vehicle row', () => {
    const payload = parseZetRt(zetRtFixture, {});
    const vehicles = payload.items.filter((item) => item.kind === 'vehicle' && item.id.startsWith('vehicle:'));
    expect(vehicles.length).toBeGreaterThan(0);
    for (const item of vehicles) {
      expect(item.data).not.toHaveProperty('bearing');
      expect(item.data).not.toHaveProperty('speed');
    }
  });

  it('rejects any data key outside DATA_KEYS for its kind, decoding the real fixture', () => {
    const payload = parseZetRt(zetRtFixture, {});
    expect(payload.items.length).toBeGreaterThan(0);
    for (const item of payload.items) {
      for (const key of Object.keys(item.data ?? {})) {
        expect(DATA_KEYS[item.kind], `${item.kind} item ${item.id} emitted "${key}"`).toContain(key);
      }
    }
  });
});

/**
 * R-TE2: the twin's static-GTFS join rides on the vehicle row as scalars
 * (direction, headsign, shape, next stop, delay), and the one non-scalar a
 * feed item ever carries, the fix history or the motion plan, rides in the
 * typed `motion` object beside `data`, never inside it, so the closed
 * vocabulary above keeps its meaning.
 */
describe('the twin wire (R-TE2)', () => {
  it('admits the phase A join keys on a vehicle row', () => {
    for (const key of ['direction', 'headsign', 'shapeId', 'nextStopId', 'delaySeconds']) {
      expect(DATA_KEYS.vehicle).toContain(key);
    }
  });

  it('carries a vehicle history beside data, never inside it', () => {
    const item: FeedItem = {
      id: 'vehicle:460',
      module: 'zet-rt',
      kind: 'vehicle',
      tier: 'session',
      title: 'Linija 33',
      data: { routeId: '33', direction: 0, headsign: 'Savišće', shapeId: '33_28' },
      motion: { history: [[-20, 16.03709, 45.79139], [-10, 16.03801, 45.79201]] },
    };
    for (const key of Object.keys(item.data ?? {})) expect(DATA_KEYS.vehicle).toContain(key);
    for (const value of Object.values(item.data ?? {})) expect(['string', 'number', 'boolean']).toContain(typeof value);
    expect(isHistoryMotion(item.motion!)).toBe(true);
    expect(item.motion && 'history' in item.motion ? item.motion.history.length : 0).toBeLessThanOrEqual(HISTORY_FIXES);
  });

  it('tells the three motion forms apart by their keys alone', () => {
    const history: VehicleMotion = { history: [[-10, 15.97, 45.81]] };
    const onPath: VehicleMotion = { path: '6_25', plan: [[0, 1200], [30, 1500]] };
    const free: VehicleMotion = { plan: [[0, 15.97, 45.81], [30, 15.971, 45.811]] };
    expect([isHistoryMotion(history), isPathMotion(history), isFreeMotion(history)]).toEqual([true, false, false]);
    expect([isHistoryMotion(onPath), isPathMotion(onPath), isFreeMotion(onPath)]).toEqual([false, true, false]);
    expect([isHistoryMotion(free), isPathMotion(free), isFreeMotion(free)]).toEqual([false, false, true]);
  });
});
