// The subject (app/src/snimka/subject.ts): from a map selection, to a label,
// to a focus; the comparison day's name for the twins caption.
import { describe, expect, it } from 'vitest';
import { comparisonDayLabel, focusOf, sameSubject, selectionOfSubject, subjectFromSelection, subjectLabel } from '../../app/src/snimka/subject';

const ctx = {
  routes: { routes: [{ id: '228', shortName: '228', type: 3 as const }, { id: '6', shortName: '6', type: 0 as const }] },
  places: { v: 2 as const, places: [{ id: 'glavni-kolodvor', name: 'Glavni kolodvor', lonLat: [15.97928, 45.80521] as [number, number], zoom: 14, from: 'stop' as const, ref: '109_1' }] },
};

describe('subjectFromSelection', () => {
  it('maps a route, a stop and a bajs: place; anything else is no subject', () => {
    expect(subjectFromSelection({ kind: 'route', id: '228' })).toEqual({ kind: 'route', id: '228' });
    expect(subjectFromSelection({ kind: 'stop', id: '109_1', ids: ['109_1', '109_2'] })).toEqual({ kind: 'stop', id: '109_1' });
    expect(subjectFromSelection({ kind: 'place', id: 'bajs:bajs-7' })).toEqual({ kind: 'station', id: 'bajs-7' });
    expect(subjectFromSelection({ kind: 'place', id: 'venue:1' })).toBeNull();
    expect(subjectFromSelection({ kind: 'vehicle', id: 'v1' })).toBeNull();
    expect(subjectFromSelection({ kind: 'closure', id: '3' })).toBeNull();
    expect(subjectFromSelection(null)).toBeNull();
  });
  it('round-trips through selectionOfSubject', () => {
    for (const subject of [{ kind: 'route', id: '6' }, { kind: 'stop', id: '109_1' }, { kind: 'station', id: 'bajs-7' }] as const) {
      expect(subjectFromSelection(selectionOfSubject(subject))).toEqual(subject);
    }
    expect(selectionOfSubject(null)).toBeNull();
    expect(sameSubject({ kind: 'route', id: '6' }, { kind: 'route', id: '6' })).toBe(true);
    expect(sameSubject({ kind: 'route', id: '6' }, { kind: 'stop', id: '6' })).toBe(false);
    expect(sameSubject(null, null)).toBe(true);
  });
});

describe('subjectLabel and focusOf', () => {
  it('names a line by its short name, a stop by the places file or a passed name, a station by a passed name, never empty', () => {
    expect(subjectLabel(ctx, { kind: 'route', id: '228' })).toBe('Linija 228');
    expect(subjectLabel(ctx, { kind: 'route', id: '99' })).toBe('Linija 99');
    expect(subjectLabel(ctx, { kind: 'stop', id: '109_1' })).toBe('Stajalište Glavni kolodvor');
    expect(subjectLabel(ctx, { kind: 'stop', id: '1_1' })).toBe('Stajalište 1_1');
    expect(subjectLabel(ctx, { kind: 'stop', id: '1_1' }, { stop: () => 'Črnomerec' })).toBe('Stajalište Črnomerec');
    expect(subjectLabel(ctx, { kind: 'station', id: 'bajs-7' })).toBe('Stanica BAJS-a bajs-7');
    expect(subjectLabel(ctx, { kind: 'station', id: 'bajs-7' }, { station: () => 'Stanica 7' })).toBe('Stanica BAJS-a Stanica 7');
  });
  it('the focus of a subject is its own kind', () => {
    expect(focusOf({ kind: 'route', id: '228' })).toEqual({ kind: 'route', id: '228' });
    expect(focusOf({ kind: 'station', id: 'bajs-7' })).toEqual({ kind: 'station', id: 'bajs-7' });
    expect(focusOf({ kind: 'stop', id: '109_1' })).toEqual({ kind: 'stop', id: '109_1' });
  });
});

describe('comparisonDayLabel', () => {
  it('names both comparison days in Croatian', () => {
    expect(comparisonDayLabel({ day: '2026-09-24', weekday: 4 })).toBe('četvrtak 24. rujna');
    expect(comparisonDayLabel({ day: '2026-09-21', weekday: 1 })).toBe('ponedjeljak 21. rujna');
  });
});
