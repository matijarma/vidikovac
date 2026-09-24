// The two functions a CPU profile of the local wall and phone found on top of
// every paint (lane v-lh, 24 September): U blizini's event rows run
// locatedEvents -> resolveVenues -> normalName for every event against every
// culture venue, and eventInWindow asks dayKey for the Zagreb day of each
// instant. In fifteen seconds of the provisioned wall normalName took 1.6 s
// and dayKey 0.7 s of 3.7 s busy (the phone's Sada: 0.8 s and 0.4 s of
// 2.7 s): dayKey built a new Intl.DateTimeFormat on every call, and
// normalName re-folded the same place names on every call. Both are pure,
// so the answers must stay exactly what they were while the work goes.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dayKey, locatedEvents } from '../../shared/city/events';
import { normalName } from '../../shared/city/geo';
import type { Place } from '../../shared/city/types';
import type { FeedItem } from '../../worker/feed/schema';

afterEach(() => { vi.restoreAllMocks(); });

describe('dayKey', () => {
  it('reads the Zagreb calendar day without building a formatter per call', () => {
    const Original = Intl.DateTimeFormat;
    // Counts constructions and still hands back a real formatter, so the answers below are the real ones.
    const construct = vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(function (...args: ConstructorParameters<typeof Intl.DateTimeFormat>) {
      return new Original(...args);
    } as unknown as typeof Intl.DateTimeFormat);
    // 22:30 UTC on 23 September is already the 24th in Zagreb (CEST, UTC+2); 21:59 UTC is still the 23rd.
    expect(dayKey('2026-09-23T22:30:00Z')).toBe('2026-09-24');
    expect(dayKey(Date.parse('2026-09-23T21:59:00Z'))).toBe('2026-09-23');
    // The winter side of the clock change (CET, UTC+1).
    expect(dayKey('2026-12-31T23:30:00Z')).toBe('2027-01-01');
    for (let i = 0; i < 50; i++) dayKey(Date.parse('2026-09-24T10:00:00Z') + i * 3_600_000);
    expect(construct).not.toHaveBeenCalled();
  });
});

describe('normalName', () => {
  it('folds case, diacritics, đ, quotes and punctuation exactly as before', () => {
    expect(normalName('Kino Tuškanac')).toBe('kino tuskanac');
    expect(normalName('  „Đuro”  Salaj, Dom! ')).toBe('duro salaj dom');
    expect(normalName('MSU — Muzej suvremene umjetnosti')).toBe('msu muzej suvremene umjetnosti');
    expect(normalName('Močvara')).toBe('mocvara');
    expect(normalName('')).toBe('');
  });

  it('folds a name it has already seen without normalising the string again', () => {
    const name = 'Galerija Klovićevi dvori · hot-path probe';
    const first = normalName(name);
    const normalize = vi.spyOn(String.prototype, 'normalize');
    for (let i = 0; i < 20; i++) expect(normalName(name)).toBe(first);
    expect(normalize).not.toHaveBeenCalled();
  });

  it('keeps every answer right while a stream of distinct names churns its memory', () => {
    for (let i = 0; i < 20_000; i++) expect(normalName(`Mjesto ${i} Š`)).toBe(`mjesto ${i} s`);
  });
});

describe('locatedEvents over a real-sized programme', () => {
  it('folds each venue name once per paint, not once per event and venue', () => {
    const places: Place[] = Array.from({ length: 60 }, (_, i) => ({
      id: `culture-${i}`, name: `Kulturni centar ${i} Črnomerec`, category: 'culture', lon: 15.9 + i / 1000, lat: 45.8, sourceId: 'culture', sourceRecord: String(i),
    }));
    const items: FeedItem[] = Array.from({ length: 80 }, (_, i) => ({
      id: `e${i}`, module: 'dogadanja', tier: 'session', kind: 'event', title: `Predstava ${i}`, dateBasis: 'event',
      at: '2026-09-24T18:00:00Z', data: { source: 'kulturpunkt', venue: `Kulturni centar ${i % 60} Črnomerec`, venueHint: `U centru ${i % 60}`, precision: 'time' },
    }));
    const now = Date.parse('2026-09-24T12:00:00Z');
    const first = locatedEvents(items, places, now, 'week');
    expect(first).toHaveLength(80);
    expect(first.every((e) => e.location === 'verified')).toBe(true);
    const normalize = vi.spyOn(String.prototype, 'normalize');
    // The next paint over the same programme and the same venues: nothing new to fold.
    expect(locatedEvents(items, places, now, 'week')).toEqual(first);
    expect(normalize).not.toHaveBeenCalled();
  });
});
