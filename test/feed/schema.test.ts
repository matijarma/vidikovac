import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DATA_KEYS } from '../../worker/feed/schema';
import { parseZetRt } from '../../worker/feed/modules/zet-rt';

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
