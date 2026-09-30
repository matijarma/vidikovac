// The values of the wall's rows (shared/kiosk/takt.ts, brief §5.2(a)): the base values of brief §3, the imminence
// bands, the rain and cut overrides, freshness, and determinism (R0's static order; R2's scheduler is takt.test.ts).
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BASE_VALUE, candidateValue, EMPTY_HISTORY, imminence, type TaktCandidate, type TaktHistory,
} from '../../shared/kiosk/takt';

const at = (iso: string): number => Date.parse(iso);
const MIN = 60_000;
const cand = (over: Partial<TaktCandidate> & Pick<TaktCandidate, 'kind'>): TaktCandidate =>
  ({ id: 'x', reserved: false, imminent: false, ...over });

describe('takt values (R0)', () => {
  afterEach(() => vi.useRealTimers());

  it('holds the base values of brief §3', () => {
    expect(BASE_VALUE).toEqual({
      departure: 100, departures: 100, 'next-departures': 100, notice: 90, last: 80, rain: 70, cut: 70,
      closure: 60, event: 60, first: 60, rail: 50, road: 40, pharmacy: 40, open: 30, opening: 30, solar: 20, always: 10,
    });
    expect(Object.isFrozen(BASE_VALUE)).toBe(true);
  });

  it('bands imminence at their edges', () => {
    const now = at('2026-10-01T10:00:00+02:00');
    expect(imminence(now + 30 * MIN, undefined, now)).toBe(1);
    expect(imminence(now + 31 * MIN, undefined, now)).toBe(0.8);
    expect(imminence(now + 120 * MIN, undefined, now)).toBe(0.8);
    expect(imminence(now + 121 * MIN, undefined, now)).toBe(0.5);
    expect(imminence(now + 360 * MIN, undefined, now)).toBe(0.5);
    const late = at('2026-10-01T22:00:00+02:00');
    expect(imminence(at('2026-10-01T23:00:00+02:00'), undefined, late)).toBe(0.8);
    const early = at('2026-10-01T06:00:00+02:00');
    expect(imminence(at('2026-10-01T18:00:00+02:00'), undefined, early)).toBe(0.3);
    expect(imminence(at('2026-10-02T08:00:00+02:00'), undefined, late)).toBe(0.1);
  });

  it('counts a fact under way by its end, a timeless row in full, a clockless caller in full', () => {
    const now = at('2026-10-01T10:00:00+02:00');
    expect(imminence(undefined, now + MIN, now)).toBe(1);
    expect(imminence(undefined, now - MIN, now)).toBe(0);
    expect(imminence(now - MIN, now + MIN, now)).toBe(1);
    expect(imminence(now - 2 * MIN, now - MIN, now)).toBe(0);
    expect(imminence(undefined, undefined, now)).toBe(1);
    expect(imminence(now + 600 * MIN, undefined, Number.NaN)).toBe(1);
  });

  it('counts rain in full within the hour', () => {
    const now = at('2026-10-01T10:00:00+02:00');
    expect(candidateValue(cand({ kind: 'rain', atMs: now + 50 * MIN }), now, null)).toBeCloseTo(70 * 1.2);
    expect(candidateValue(cand({ kind: 'rain', atMs: now + 90 * MIN }), now, null)).toBeCloseTo(70 * 0.8 * 1.2);
  });

  it('counts a cut tomorrow 0.6 from 18:00', () => {
    const cut = cand({ kind: 'cut', atMs: at('2026-10-02T08:00:00+02:00') });
    expect(candidateValue(cut, at('2026-10-01T17:59:00+02:00'), null)).toBeCloseTo(70 * 0.1 * 1.2);
    expect(candidateValue(cut, at('2026-10-01T18:00:00+02:00'), null)).toBeCloseTo(70 * 0.6 * 1.2);
  });

  it('counts freshness ×1.2 unless shown in the last 10 minutes', () => {
    const now = at('2026-10-01T10:00:00+02:00');
    const c = cand({ kind: 'event', id: 'event:a', atMs: now + 10 * MIN });
    const shown = (ago: number): TaktHistory => ({ beat: 3, shownAt: { 'event:a': now - ago * MIN }, lastReveal: null });
    expect(candidateValue(c, now, null)).toBeCloseTo(60 * 1.2);
    expect(candidateValue(c, now, shown(5))).toBeCloseTo(60);
    expect(candidateValue(c, now, shown(11))).toBeCloseTo(60 * 1.2);
    expect(Object.isFrozen(EMPTY_HISTORY)).toBe(true);
    expect(Object.isFrozen(EMPTY_HISTORY.shownAt)).toBe(true);
    expect(candidateValue(c, now, EMPTY_HISTORY)).toBe(candidateValue(c, now, null));
  });

  it('is deterministic and never reads the clock', () => {
    const now = at('2026-10-01T17:45:00+02:00');
    const cs = (['departure', 'closure', 'solar', 'cut', 'rain'] as const)
      .map((kind, i) => cand({ kind, id: `${kind}:${i}`, atMs: now + (i * 50) * MIN }));
    const first = cs.map((c) => candidateValue(c, now, null));
    expect(cs.map((c) => candidateValue(c, now, null))).toEqual(first);
    vi.useFakeTimers();
    vi.setSystemTime(now + 86_400_000);
    expect(cs.map((c) => candidateValue(c, now, null))).toEqual(first);
  });
});
