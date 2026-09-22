// Seam S5: app/src/city/nearby.ts. The row and input shapes (radiusM, not a
// Kadar), the head over the measured circle, and the row budget; selectNearby
// is WP1's and answers no rows until it lands.
import { describe, expect, expectTypeOf, it } from 'vitest';
import { emptyCity } from '../../shared/city/types';
import { ROW_MAX_PX, ROW_MIN_PX, nearbyHead, rowBudget, selectNearby, type NearbyInput, type NearbyKind, type NearbyRow } from '../../app/src/city/nearby';
import { createDefaultI18n } from '../../app/src/i18n/create-default-i18n';

const i18n = createDefaultI18n('hr');
const input: NearbyInput = {
  place: { kind: 'tram', name: 'Trg bana J. Jelačića', lon: 15.97726, lat: 45.81286, stopId: '106_1' },
  radiusM: 2000,
  now: Date.parse('2026-09-22T15:45:00Z'),
  boards: [],
  fixes: [],
  snapshots: {},
  city: emptyCity(),
  lastRun: null,
  locale: 'hr',
  i18n,
};

describe('nearby contract', () => {
  it('names the nine row kinds', () => {
    expectTypeOf<NearbyKind>().toEqualTypeOf<'departure' | 'closure' | 'event' | 'solar' | 'last' | 'first' | 'opening' | 'always' | 'pharmacy'>();
    const row: NearbyRow = { id: 'dep:1', kind: 'departure', atMs: input.now + 180_000, always: false, title: 'Črnomerec', sub: '', live: true, source: 'zet-rt' };
    const always: NearbyRow = { id: 'always:story:1', kind: 'always', atMs: null, always: true, title: 'Ilica', sub: '', live: false, source: 'city' };
    expect([row.kind, always.kind]).toEqual(['departure', 'always']);
  });

  it('takes the measured radius, not a Kadar', () => {
    expectTypeOf<NearbyInput['radiusM']>().toEqualTypeOf<number>();
    expectTypeOf<NearbyInput>().not.toHaveProperty('frame');
    expect(selectNearby(input)).toEqual([]);
  });

  it('heads the list with the measured circle', () => {
    expect(nearbyHead(i18n, 2000)).toBe('U blizini · 2 km · ~15 min');
    expect(nearbyHead(i18n, 2170)).toBe('U blizini · 2,2 km · ~16 min');
    expect(nearbyHead(i18n, 680)).toMatch(/^U blizini · \d+(,\d)? km · ~\d+ min$/);
  });

  it('sizes rows between 64 and 92 px and shows whole rows only', () => {
    expect([ROW_MIN_PX, ROW_MAX_PX]).toEqual([64, 92]);
    expect(rowBudget(600, 3)).toEqual({ rowPx: 92, rows: 6 });
    expect(rowBudget(600, 12)).toEqual({ rowPx: 64, rows: 9 });
    expect(rowBudget(600, 8)).toEqual({ rowPx: 75, rows: 8 });
    expect(rowBudget(600, 0)).toEqual({ rowPx: 92, rows: 6 });
    expect(rowBudget(0, 5)).toEqual({ rowPx: 64, rows: 0 });
    expect(rowBudget(Number.POSITIVE_INFINITY, 7)).toEqual({ rowPx: 64, rows: 7 });
  });
});
