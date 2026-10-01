// The address of /snimka/ carries a Zagreb minute inside the window, one of
// the four speeds and the comparison switch; everything else in the query
// survives a write (app/src/snimka/address.ts).
import { describe, expect, it } from 'vitest';
import { SNIMKA_WINDOW } from '../../shared/snimka';
import { WINDOW_END_MS, WINDOW_START_MS, readAddress, writeAddress, type Replace } from '../../app/src/snimka/address';

const MONDAY_0745 = Date.UTC(2026, 8, 28, 5, 45);

describe('readAddress', () => {
  it('reads a shared link', () => {
    expect(readAddress('?t=2026-09-28T07:45&brzina=600&usporedba=1')).toEqual({ t: MONDAY_0745, speed: 600, compare: true });
    expect(readAddress('?t=2026-09-28T07%3A45&brzina=1')).toEqual({ t: MONDAY_0745, speed: 1, compare: false });
    expect(readAddress('t=2026-10-01T08:00&brzina=3600&usporedba=0')).toEqual({ t: WINDOW_END_MS, speed: 3600, compare: false });
    expect(readAddress('?t=2026-09-27T20:00&brzina=60')).toEqual({ t: WINDOW_START_MS, speed: 60, compare: false });
  });
  it('a time outside the window, a malformed time or an unknown speed reads as absent', () => {
    expect(readAddress('?t=2026-09-27T19:59')).toEqual({ t: null, speed: null, compare: false });
    expect(readAddress('?t=2026-10-01T08:01')).toEqual({ t: null, speed: null, compare: false });
    expect(readAddress('?t=2026-09-24T07:45')).toEqual({ t: null, speed: null, compare: false });
    expect(readAddress('?t=ponedjeljak&brzina=7&usporedba=yes')).toEqual({ t: null, speed: null, compare: false });
    expect(readAddress('?brzina=600.0')).toEqual({ t: null, speed: null, compare: false });
    expect(readAddress('')).toEqual({ t: null, speed: null, compare: false });
    expect(readAddress('?lagano=1')).toEqual({ t: null, speed: null, compare: false });
  });
});

describe('writeAddress', () => {
  function fake(): { replace: Replace; calls: [unknown, string, string][] } {
    const calls: [unknown, string, string][] = [];
    return { replace: (data, unused, url) => { calls.push([data, unused, url]); }, calls };
  }
  it('writes its keys first with the colon kept, keeps every other parameter and the hash', () => {
    const f = fake();
    const url = writeAddress({ t: MONDAY_0745, speed: 600, compare: true }, f.replace, { pathname: '/snimka/', search: '?lagano=1&t=2026-09-29T10:00&usporedba=1', hash: '#tijek' });
    expect(url).toBe('/snimka/?t=2026-09-28T07:45&brzina=600&usporedba=1&lagano=1#tijek');
    expect(f.calls).toEqual([[null, '', url]]);
  });
  it('leaves usporedba out when the overlay is off and clamps the time into the window', () => {
    const f = fake();
    expect(writeAddress({ t: MONDAY_0745 + 30_000, speed: 1, compare: false }, f.replace, { pathname: '/snimka/', search: '', hash: '' })).toBe('/snimka/?t=2026-09-28T07:45&brzina=1');
    expect(writeAddress({ t: WINDOW_END_MS + 5_000_000, speed: 3600, compare: false }, f.replace, { pathname: '/snimka/', search: '?usporedba=1', hash: '' })).toBe('/snimka/?t=2026-10-01T08:00&brzina=3600');
    expect(writeAddress({ t: 0, speed: 60, compare: false }, f.replace, { pathname: '/snimka/', search: '', hash: '' })).toBe('/snimka/?t=2026-09-27T20:00&brzina=60');
  });
  it('round-trips through readAddress', () => {
    const f = fake();
    for (const state of [
      { t: MONDAY_0745, speed: 600, compare: true },
      { t: SNIMKA_WINDOW.fromSec * 1000, speed: 1, compare: false },
      { t: SNIMKA_WINDOW.toSec * 1000, speed: 3600, compare: true },
    ] as const) {
      const url = writeAddress(state, f.replace, { pathname: '/snimka/', search: '', hash: '' });
      expect(readAddress(url.slice(url.indexOf('?')))).toEqual(state);
    }
  });
});
