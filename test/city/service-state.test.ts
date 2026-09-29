// U0 step 5 (docs/history/upgrade-2026-10-plan/U0.md): the service-state seam. U0 fills loading, down and unconfirmed and
// says unknown for every other snapshot; unconfirmed is entered past three minutes of source age and held a minute.
import { afterEach, describe, expect, it } from 'vitest';
import {
  departureVoice, positionsUnavailable, resetServiceStateMemory, routeConfirmed, serviceStateOf,
  UNCONFIRMED_AFTER_MS, UNCONFIRMED_HOLD_MS,
} from '../../shared/city/service-state';
import { EVICT_S } from '../../shared/motion/plan';
import type { ModuleSnapshot } from '../../worker/feed/schema';

const NOW = Date.parse('2026-09-29T05:45:00Z');
const iso = (ms: number): string => new Date(ms).toISOString();
/** A zet-rt snapshot whose source (sources.zet and the module) last spoke at `sourceAt`. */
function zet(sourceAt: number, over: Partial<ModuleSnapshot> = {}, zetStatus: 'live' | 'stale' | 'down' = 'live'): ModuleSnapshot {
  return {
    module: 'zet-rt', tier: 'open', status: 'live', fetchedAt: iso(NOW), sourceUpdatedAt: iso(sourceAt),
    attribution: { text: 'ZET', url: 'https://example.test', licence: 'Otvorena dozvola' }, items: [],
    sources: { zet: { status: zetStatus, itemCount: 0, fetchedAt: iso(NOW), sourceUpdatedAt: iso(sourceAt) } },
    ...over,
  };
}

afterEach(() => resetServiceStateMemory());

describe('serviceStateOf (U0: loading, down, unconfirmed, unknown)', () => {
  it('is loading without a snapshot, down on the module status, unknown for a fresh one (U0 never claims normal)', () => {
    expect(serviceStateOf(undefined, NOW)).toEqual({ kind: 'loading', since: null });
    expect(serviceStateOf(zet(NOW - 5_000, { status: 'down' }), NOW)).toEqual({ kind: 'down', since: null });
    expect(serviceStateOf(zet(NOW - 5_000), NOW)).toEqual({ kind: 'unknown', since: null });
    // A snapshot with no source time says nothing about its age.
    expect(serviceStateOf({ ...zet(NOW), sourceUpdatedAt: undefined, sources: undefined }, NOW).kind).toBe('unknown');
  });

  it('enters unconfirmed at 180 001 ms of source age, not at 180 000, dated at source time + 180 s', () => {
    const sourceAt = NOW - UNCONFIRMED_AFTER_MS;
    expect(serviceStateOf(zet(sourceAt), NOW).kind).toBe('unknown');
    expect(serviceStateOf(zet(sourceAt), NOW + 1)).toEqual({ kind: 'unconfirmed', since: sourceAt + UNCONFIRMED_AFTER_MS });
  });

  it('reads the source time from sources.zet before the module\'s own', () => {
    const snapshot = zet(NOW - 5_000);
    snapshot.sources!.zet!.sourceUpdatedAt = iso(NOW - 10 * 60_000);
    expect(serviceStateOf(snapshot, NOW).kind).toBe('unconfirmed');
  });

  it('holds unconfirmed a minute from its entry when a fresh snapshot arrives five seconds in, then says unknown', () => {
    const frozen = NOW - 10 * 60_000;
    const entry = NOW;
    expect(serviceStateOf(zet(frozen), entry).kind).toBe('unconfirmed');
    const fresh = zet(entry + 5_000);
    expect(serviceStateOf(fresh, entry + 5_000)).toEqual({ kind: 'unconfirmed', since: frozen + UNCONFIRMED_AFTER_MS });
    expect(serviceStateOf(fresh, entry + UNCONFIRMED_HOLD_MS - 1).kind).toBe('unconfirmed');
    expect(serviceStateOf(fresh, entry + UNCONFIRMED_HOLD_MS)).toEqual({ kind: 'unknown', since: null });
    expect(serviceStateOf(fresh, entry + UNCONFIRMED_HOLD_MS + 1_000).kind).toBe('unknown');
  });

  it('never enters unconfirmed on ZET\'s own stale flag alone (it fires four to nine times a weekday)', () => {
    expect(serviceStateOf(zet(NOW - 40_000, {}, 'stale'), NOW)).toEqual({ kind: 'unknown', since: null });
  });

  it('keeps its threshold equal to the twin\'s eviction', () => {
    expect(UNCONFIRMED_AFTER_MS).toBe(EVICT_S * 1000);
    expect(UNCONFIRMED_HOLD_MS).toBe(60_000);
  });
});

describe('the voices', () => {
  it('says no departure while down or unconfirmed and every one otherwise; a route is unconfirmed only while down', () => {
    expect(departureVoice(undefined, NOW)).toBe('all');
    expect(departureVoice(zet(NOW - 5_000), NOW)).toBe('all');
    expect(departureVoice(zet(NOW - 5_000, { status: 'down' }), NOW)).toBe('none');
    expect(departureVoice(zet(NOW - 10 * 60_000), NOW)).toBe('none');
    resetServiceStateMemory();
    expect(routeConfirmed(zet(NOW - 5_000), '6')).toBe(true);
    expect(routeConfirmed(zet(NOW - 10 * 60_000), '6')).toBe(true);
    expect(routeConfirmed(zet(NOW, { status: 'down' }), '6')).toBe(false);
    expect(routeConfirmed(undefined, '6')).toBe(true);
  });

  it('makes positions unavailable exactly while down or unconfirmed', () => {
    expect(positionsUnavailable(undefined, NOW)).toBe(false);
    expect(positionsUnavailable(zet(NOW - 5_000), NOW)).toBe(false);
    expect(positionsUnavailable(zet(NOW, { status: 'down' }), NOW)).toBe(true);
    expect(positionsUnavailable(zet(NOW - 10 * 60_000), NOW)).toBe(true);
  });
});
