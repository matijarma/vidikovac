// The fleet's states of the service-state helper (upgrade U2, S2): the twin's
// judgement on the wire (sources.zet.service) read into a kind, the voice
// table of docs/upgrade-2026-10-plan/U2.md §0.1, the two numbers the surfaces
// say, and the rail promotion. U0's own states are held by
// test/city/service-state.test.ts.
import { afterEach, describe, expect, it } from 'vitest';
import {
  aboutExpected, departureVoice, railPolicy, resetServiceStateMemory, routeConfirmed, serviceNumbers, serviceStateOf,
} from '../../shared/city/service-state';
import type { ZetService } from '../../shared/city/service-wire';
import type { ModuleSnapshot } from '../../worker/feed/schema';

const NOW = Date.parse('2026-09-28T05:47:00Z');

// U0's unconfirmed hold is module memory: every case starts without one (U0-client's handoff).
afterEach(() => resetServiceStateMemory());
const SOURCE = new Date(NOW - 20_000).toISOString();
const SINCE = '2026-09-28T05:40:54Z';

function service(over: Partial<ZetService> = {}): ZetService {
  return {
    state: 'normal', since: SINCE, observedAt: SOURCE, expected: 460, seen: 402, ratio: 0.87, confidence: 1,
    baseline: 'declared', byMode: { tram: [120, 140], bus: [282, 320] }, ...over,
  };
}
function zet(wire: ZetService | undefined, over: Partial<ModuleSnapshot> = {}): ModuleSnapshot {
  return {
    module: 'zet-rt', tier: 'open', status: 'live', fetchedAt: SOURCE, sourceUpdatedAt: SOURCE,
    attribution: { text: 'ZET', url: 'https://www.zet.hr', licence: 'Fixture' }, items: [],
    sources: { zet: { status: 'live', itemCount: 0, sourceUpdatedAt: SOURCE, ...(wire ? { service: wire } : {}) } },
    ...over,
  };
}
const silent = service({ state: 'silent', seen: 2, ratio: 0, byMode: { tram: [0, 140], bus: [2, 320] },
  routes: { '6': [0, 9], '14': [0, 8], '109': [0, 3] } });
const reduced = service({ state: 'reduced', seen: 190, ratio: 0.41, byMode: { tram: [20, 140], bus: [170, 320] },
  routes: { '6': [1, 9], '14': [0, 8] } });

describe('the fleet states read from sources.zet.service', () => {
  it('names each kind from the wire, with its start', () => {
    for (const state of ['normal', 'reduced', 'silent', 'unknown'] as const) {
      expect(serviceStateOf(zet(service({ state })), NOW)).toEqual({ kind: state, since: Date.parse(SINCE) });
    }
  });
  it('reads an absent or unreadable judgement as unknown, never as normal', () => {
    expect(serviceStateOf(zet(undefined), NOW)).toEqual({ kind: 'unknown', since: null });
    expect(serviceStateOf(zet({ ...service(), state: 'strike' as never }), NOW)).toEqual({ kind: 'unknown', since: null });
    expect(serviceStateOf(zet(service({ state: 'silent', since: 'not a time' })), NOW)).toEqual({ kind: 'silent', since: null });
  });
  it('lets the source\'s own states outrank the fleet', () => {
    expect(serviceStateOf(undefined, NOW).kind).toBe('loading');
    expect(serviceStateOf(zet(silent, { status: 'down' }), NOW).kind).toBe('down');
  });
});

describe('the voice table', () => {
  it('gives every kind its departure voice', () => {
    expect(departureVoice(undefined, NOW)).toBe('all');
    expect(departureVoice(zet(service({ state: 'normal' })), NOW)).toBe('all');
    expect(departureVoice(zet(service({ state: 'unknown' })), NOW)).toBe('all');
    expect(departureVoice(zet(undefined), NOW)).toBe('all');
    expect(departureVoice(zet(reduced), NOW)).toBe('live-only');
    expect(departureVoice(zet(silent), NOW)).toBe('none');
    expect(departureVoice(zet(service(), { status: 'down' }), NOW)).toBe('none');
  });
  it('confirms a route in reduced only when the twin did not list it, and none in silent', () => {
    expect(routeConfirmed(zet(reduced), '6')).toBe(false);
    expect(routeConfirmed(zet(reduced), '14')).toBe(false);
    expect(routeConfirmed(zet(reduced), '11')).toBe(true);
    expect(routeConfirmed(zet(reduced), '__proto__')).toBe(true);
    expect(routeConfirmed(zet(silent), '11')).toBe(false);
    expect(routeConfirmed(zet(silent), '6')).toBe(false);
  });
  it('confirms every route in normal, unknown and loading, none while the module is down', () => {
    expect(routeConfirmed(zet(service({ routes: { '6': [0, 9] } })), '6')).toBe(true);
    expect(routeConfirmed(zet(service({ state: 'unknown' })), '6')).toBe(true);
    expect(routeConfirmed(undefined, '6')).toBe(true);
    expect(routeConfirmed(zet(service(), { status: 'down' }), '6')).toBe(false);
  });
});

describe('the numbers and the promotion', () => {
  it('says the two numbers in reduced and silent only', () => {
    expect(serviceNumbers(zet(silent))).toEqual({ seen: 2, expected: 460 });
    expect(serviceNumbers(zet(reduced))).toEqual({ seen: 190, expected: 460 });
    expect(serviceNumbers(zet(service()))).toBeNull();
    expect(serviceNumbers(zet(service({ state: 'unknown' })))).toBeNull();
    expect(serviceNumbers(zet(undefined))).toBeNull();
    expect(serviceNumbers(undefined)).toBeNull();
    // A count that is not a whole number is not said.
    expect(serviceNumbers(zet({ ...silent, seen: 1.5 }))).toBeNull();
    expect(serviceNumbers(zet({ ...silent, expected: 0 }))).toBeNull();
  });
  it('rounds the timetable\'s count as "oko" says it: to ten above a hundred, else to five, at least five', () => {
    expect([460, 384, 103, 100, 97, 22, 3].map(aboutExpected)).toEqual([460, 380, 100, 100, 95, 20, 5]);
  });
  it('moves rail forward while ZET deviates, and leaves today\'s order otherwise', () => {
    expect(railPolicy('silent')).toEqual({ railMax: 3, railFirst: true });
    expect(railPolicy('reduced')).toEqual({ railMax: 2, railFirst: true });
    for (const kind of ['loading', 'down', 'unconfirmed', 'normal', 'unknown'] as const) expect(railPolicy(kind)).toBeUndefined();
  });
});

// Last in the file: U0's unconfirmed state keeps a module-private hold (60 s from its entry), so
// an earlier case at the same instant would read a fresh snapshot as unconfirmed too.
describe('a frozen feed', () => {
  it('never reads as a silent city: the source\'s own state outranks the fleet\'s', () => {
    const later = NOW + 3_600_000;
    const frozen = new Date(later - 600_000).toISOString();
    const held = zet(silent, { sourceUpdatedAt: frozen, sources: { zet: { status: 'stale', itemCount: 0, sourceUpdatedAt: frozen, service: silent } } });
    expect(serviceStateOf(held, later).kind).toBe('unconfirmed');
    expect(departureVoice(held, later)).toBe('none');
  });
});
