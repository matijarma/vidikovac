// The address of /snimka/ carries a Zagreb minute inside the window, one of
// the four speeds, the comparison switch (on unless usporedba=0), the panel,
// the subject (linija or stanica), the living network and the following
// camera; everything else in the query survives a write
// (app/src/snimka/address.ts).
import { describe, expect, it } from 'vitest';
import { SNIMKA_WINDOW } from '../../shared/snimka';
import { WINDOW_END_MS, WINDOW_START_MS, readAddress, writeAddress, type Replace } from '../../app/src/snimka/address';

const MONDAY_0745 = Date.UTC(2026, 8, 28, 5, 45);
const DEFAULTS = { compare: true, panel: null, subject: null, live: true, following: true } as const;

describe('readAddress', () => {
  it('reads a shared link', () => {
    expect(readAddress('?t=2026-09-28T07:45&brzina=600&usporedba=1')).toEqual({ ...DEFAULTS, t: MONDAY_0745, speed: 600 });
    expect(readAddress('?t=2026-09-28T07%3A45&brzina=1&usporedba=0')).toEqual({ ...DEFAULTS, t: MONDAY_0745, speed: 1, compare: false });
    expect(readAddress('t=2026-10-02T12:00&brzina=3600')).toEqual({ ...DEFAULTS, t: WINDOW_END_MS, speed: 3600 });
    expect(readAddress('?t=2026-09-27T20:00&brzina=60')).toEqual({ ...DEFAULTS, t: WINDOW_START_MS, speed: 60 });
  });
  it('reads the panel, the subject, the living network and the following camera', () => {
    expect(readAddress('?panel=linije&linija=228&mreza=0&prati=0')).toEqual({ ...DEFAULTS, t: null, speed: null, panel: 'linije', subject: { kind: 'route', id: '228' }, live: false, following: false });
    expect(readAddress('?panel=bicikli&stanica=bajs-12')).toEqual({ ...DEFAULTS, t: null, speed: null, panel: 'bicikli', subject: { kind: 'station', id: 'bajs-12' } });
    // A line wins over a station when a link carries both; an unknown panel or an id with odd characters reads as absent.
    expect(readAddress('?linija=6&stanica=bajs-1').subject).toEqual({ kind: 'route', id: '6' });
    expect(readAddress('?panel=karta&linija=../x&mreza=1&prati=yes')).toEqual({ ...DEFAULTS, t: null, speed: null });
  });
  it('a time outside the window, a malformed time or an unknown speed reads as absent', () => {
    const absent = { ...DEFAULTS, t: null, speed: null };
    expect(readAddress('?t=2026-09-27T19:59')).toEqual(absent);
    expect(readAddress('?t=2026-10-02T12:01')).toEqual(absent);
    expect(readAddress('?t=2026-09-24T07:45')).toEqual(absent);
    expect(readAddress('?t=ponedjeljak&brzina=7&usporedba=yes')).toEqual(absent);
    expect(readAddress('?brzina=600.0')).toEqual(absent);
    expect(readAddress('')).toEqual(absent);
    expect(readAddress('?lagano=1')).toEqual(absent);
  });
});

describe('writeAddress', () => {
  function fake(): { replace: Replace; calls: [unknown, string, string][] } {
    const calls: [unknown, string, string][] = [];
    return { replace: (data, unused, url) => { calls.push([data, unused, url]); }, calls };
  }
  it('writes its keys first with the colon kept, keeps every other parameter and the hash', () => {
    const f = fake();
    const url = writeAddress({ ...DEFAULTS, t: MONDAY_0745, speed: 600, compare: false }, f.replace, { pathname: '/snimka/', search: '?lagano=1&t=2026-09-29T10:00&usporedba=1&panel=vozila', hash: '#tijek' });
    expect(url).toBe('/snimka/?t=2026-09-28T07:45&brzina=600&usporedba=0&lagano=1#tijek');
    expect(f.calls).toEqual([[null, '', url]]);
  });
  it('writes the panel, the subject, the living network and the following camera only when they differ from the defaults', () => {
    const f = fake();
    const loc = { pathname: '/snimka/', search: '', hash: '' };
    expect(writeAddress({ ...DEFAULTS, t: MONDAY_0745, speed: 600, panel: 'linije', subject: { kind: 'route', id: '228' }, live: false, following: false }, f.replace, loc))
      .toBe('/snimka/?t=2026-09-28T07:45&brzina=600&panel=linije&linija=228&mreza=0&prati=0');
    expect(writeAddress({ ...DEFAULTS, t: MONDAY_0745, speed: 600, subject: { kind: 'station', id: 'bajs-3' } }, f.replace, loc)).toBe('/snimka/?t=2026-09-28T07:45&brzina=600&stanica=bajs-3');
    // A stop subject has no address key yet (plan section 3.5 names linija and stanica).
    expect(writeAddress({ ...DEFAULTS, t: MONDAY_0745, speed: 600, subject: { kind: 'stop', id: '109_1' } }, f.replace, loc)).toBe('/snimka/?t=2026-09-28T07:45&brzina=600');
  });
  it('leaves usporedba out when the overlay is on and clamps the time into the window', () => {
    const f = fake();
    expect(writeAddress({ ...DEFAULTS, t: MONDAY_0745 + 30_000, speed: 1 }, f.replace, { pathname: '/snimka/', search: '', hash: '' })).toBe('/snimka/?t=2026-09-28T07:45&brzina=1');
    expect(writeAddress({ ...DEFAULTS, t: WINDOW_END_MS + 5_000_000, speed: 3600 }, f.replace, { pathname: '/snimka/', search: '?usporedba=0', hash: '' })).toBe('/snimka/?t=2026-10-02T12:00&brzina=3600');
    expect(writeAddress({ ...DEFAULTS, t: 0, speed: 60 }, f.replace, { pathname: '/snimka/', search: '', hash: '' })).toBe('/snimka/?t=2026-09-27T20:00&brzina=60');
  });
  it('round-trips through readAddress', () => {
    const f = fake();
    for (const state of [
      { ...DEFAULTS, t: MONDAY_0745, speed: 600, compare: false },
      { ...DEFAULTS, t: SNIMKA_WINDOW.fromSec * 1000, speed: 1 },
      { ...DEFAULTS, t: SNIMKA_WINDOW.toSec * 1000, speed: 3600, panel: 'mreza', subject: { kind: 'route', id: '17' }, live: false },
      { ...DEFAULTS, t: MONDAY_0745, speed: 60, panel: 'bicikli', subject: { kind: 'station', id: 'bajs-7' }, following: false },
    ] as const) {
      const url = writeAddress(state, f.replace, { pathname: '/snimka/', search: '', hash: '' });
      expect(readAddress(url.slice(url.indexOf('?')))).toEqual(state);
    }
  });
});
