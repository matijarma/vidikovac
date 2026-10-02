// The events of the v2 page (scripts/snimka/events.json, stage-events.ts) and
// the pointer defaults of Appendix C (scripts/snimka/focus-defaults.ts).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { beatDefaults, eventDefaults, noticeDefaults, resolvePointers, withDefaults, type Known } from '../../scripts/snimka/focus-defaults';
import { KNOWN_SOURCES, resolveRule } from '../../scripts/snimka/stage-events';
import { SNIMKA_WINDOW, type SeriesFile } from '../../shared/snimka';

interface Entry { id: string; at?: string; rule?: { kind: string; value?: number; after: string }; kind: string; title: string; text: string | null; sources: { url: string }[]; chapter: boolean }
const events = (JSON.parse(readFileSync('scripts/snimka/events.json', 'utf8')) as { events: Entry[] }).events;
const byId = new Map(events.map((e) => [e.id, e] as const));
const z = (month: 9 | 10, day: number, hh: number, mm = 0, ss = 0): number => Date.UTC(2026, month - 1, day, hh - 2, mm, ss) / 1000;

const known: Known = {
  routes: new Set(['6', '17', '228']), stations: new Set(['s1']), stops: new Set(['109_1']),
  places: new Map([['jelacic', { name: 'Trg bana J. Jelačića', lonLat: [15.97726, 45.81286] as [number, number], zoom: 13.2 }], ['rebro', { name: 'Bolnica Rebro', lonLat: [16.00759, 45.82309] as [number, number], zoom: 14 }],
    ['spremiste-dubrava', { name: 'Spremište Dubrava', lonLat: [16.03995, 45.82043] as [number, number], zoom: 14 }], ['spremiste-ljubljanica', { name: 'Spremište Ljubljanica', lonLat: [15.9386, 45.79618] as [number, number], zoom: 14 }],
    ['glavni-kolodvor', { name: 'Glavni kolodvor', lonLat: [15.97928, 45.80521] as [number, number], zoom: 14 }]]),
};

describe('the four new events', () => {
  it('feed-stoji-pon: a derived ZET marker, the header-age rule after Mon 04:30', () => {
    const e = byId.get('feed-stoji-pon')!;
    expect(e).toMatchObject({ kind: 'zet', chapter: false, title: 'ZET-ovi podaci se ne mijenjaju: prvi put', rule: { kind: 'header-age-over', value: 300, after: '2026-09-28T04:30:00+02:00' } });
    expect(e.at).toBeUndefined();
  });

  it('vozni-red-396: the timetable swap at 08:34:58 with ZET\'s GTFS download as its source', () => {
    const e = byId.get('vozni-red-396')!;
    expect(Date.parse(e.at!) / 1000).toBe(z(9, 28, 8, 34, 58));
    expect(e.title).toBe('ZET objavljuje novi vozni red (000396)');
    expect(e.sources.map((s) => s.url)).toEqual(['https://www.zet.hr/gtfs-scheduled/latest']);
    expect(KNOWN_SOURCES.has('https://www.zet.hr/gtfs-scheduled/latest')).toBe(true);
  });

  it('drugo-uobicajeno-jutro is a chapter on Fri 07:45; kraj-snimke marks the end, not a chapter', () => {
    expect(byId.get('drugo-uobicajeno-jutro')).toMatchObject({ kind: 'recording', chapter: true, at: '2026-10-02T07:45:00+02:00' });
    expect(byId.get('kraj-snimke')).toMatchObject({ kind: 'recording', chapter: false });
    expect(Date.parse(byId.get('kraj-snimke')!.at!) / 1000).toBe(SNIMKA_WINDOW.toSec);
  });

  it('carries no dash, double hyphen or ellipsis in a title or text', () => {
    for (const e of events) expect(`${e.title} ${e.text ?? ''}`).not.toMatch(/—|--|…/);
  });
});

describe('the header-age rule', () => {
  it('resolves to the frozen header itself: a header of 05:03 read as over 300 s old at 05:09 gives 05:03', () => {
    const n = 600;
    const t0 = z(9, 28, 0);
    const headerAgeS: (number | null)[] = new Array(n).fill(10);
    const frozenAt = z(9, 28, 5, 3);
    for (let m = 0; m < n; m++) {
      const end = t0 + (m + 1) * 60;
      if (end > frozenAt + 60) headerAgeS[m] = end - frozenAt;
    }
    const series = { t0, n, feed: { headerAgeS } } as unknown as SeriesFile;
    expect(resolveRule(series, { kind: 'header-age-over', value: 300, after: '2026-09-28T04:30:00+02:00' })).toBe(frozenAt);
  });
});

describe('the pointer defaults (Appendix C)', () => {
  it('beats: city, route 17, route 228 with Rebro, the bikes layer, the station place, none, Jelačić', () => {
    expect(beatDefaults('nakon')).toMatchObject({ focus: { kind: 'city' }, facts: ['seen', 'expected', 'state'] });
    expect(beatDefaults('jedan-tramvaj')).toMatchObject({ focus: { kind: 'route', id: '17' }, facts: ['route:17', 'seen'] });
    expect(beatDefaults('linija-228')).toMatchObject({ focus: { kind: 'route', id: '228' }, mentions: { routes: ['228'], places: ['rebro'] } });
    expect(beatDefaults('bajs')).toMatchObject({ focus: { kind: 'layer', layer: 'bikes' }, facts: ['bikes', 'bikesEmpty'] });
    expect(beatDefaults('vlak')).toMatchObject({ focus: { kind: 'place', id: 'glavni-kolodvor' }, mentions: { tags: ['rail'] } });
    expect(beatDefaults('presuda')).toMatchObject({ focus: { kind: 'none' }, facts: ['state', 'seen', 'expected'] });
    expect(beatDefaults('taksi')).toMatchObject({ focus: { kind: 'place', id: 'jelacic' }, facts: ['seen', 'bikesEmpty'] });
  });

  it('events: the mornings at Jelačić with the screen, the pull-in at the depots with a dwell, ZET and the court with the state', () => {
    expect(eventDefaults('prvo-jutro')).toMatchObject({ focus: { kind: 'place', id: 'jelacic' }, spot: 'zaslon' });
    expect(eventDefaults('drugo-uobicajeno-jutro')).toMatchObject({ focus: { kind: 'place', id: 'jelacic' }, spot: 'zaslon' });
    expect(eventDefaults('povlacenje')).toMatchObject({ focus: { kind: 'place', id: 'spremiste-dubrava' }, mentions: { places: ['spremiste-dubrava', 'spremiste-ljubljanica'] }, dwellS: 6 });
    expect(eventDefaults('sud-zet')).toMatchObject({ focus: { kind: 'none' }, spot: 'stanje', facts: ['seen', 'expected', 'state'] });
    expect(eventDefaults('feed-stoji-pon')).toMatchObject({ focus: { kind: 'none' }, facts: ['feed', 'seen'] });
    expect(eventDefaults('linija-228')).toMatchObject({ focus: { kind: 'route', id: '228' } });
    expect(eventDefaults('uobicajeno')).toMatchObject({ focus: { kind: 'city' } });
    expect(noticeDefaults(10166)).toMatchObject({ focus: { kind: 'route', id: '228' }, mentions: { places: ['rebro'] } });
    expect(noticeDefaults(10168)).toMatchObject({ focus: { kind: 'city' } });
    expect(noticeDefaults(10164)).toMatchObject({ focus: { kind: 'none' } });
  });

  it('every chapter of events.json gets a spot from its defaults', () => {
    for (const e of events.filter((x) => x.chapter)) expect(eventDefaults(e.id).spot, e.id).toBeDefined();
  });

  it('an entry\'s own field wins; a place focus is filled from places.json; an unknown id is refused', () => {
    const own = withDefaults({ focus: { kind: 'route', id: '6' } }, beatDefaults('pocetak'));
    expect(own).toMatchObject({ focus: { kind: 'route', id: '6' }, facts: ['seen', 'expected', 'state'] });
    expect(resolvePointers('t', beatDefaults('taksi'), known).focus).toEqual({ kind: 'place', id: 'jelacic', name: 'Trg bana J. Jelačića', lonLat: [15.97726, 45.81286], zoom: 13.2 });
    expect(() => resolvePointers('t', { focus: { kind: 'route', id: '999' }, facts: [], mentions: {} }, known)).toThrow(/route 999/);
    expect(() => resolvePointers('t', { focus: { kind: 'city' }, facts: ['route:31'], mentions: {} }, known)).toThrow(/route:31/);
    expect(() => resolvePointers('t', { focus: { kind: 'city' }, facts: [], mentions: { places: ['savica'] } }, known)).toThrow(/place savica/);
    expect(() => resolvePointers('t', { focus: { kind: 'station', id: 's2' }, facts: [], mentions: {} }, known)).toThrow(/station s2/);
    expect(() => resolvePointers('t', { focus: { kind: 'city' }, facts: ['speed' as never], mentions: {} }, known)).toThrow(/not a FactKey/);
    for (const id of ['povlacenje', 'linija-228', 'prvo-jutro', 'feed-prazan']) expect(() => resolvePointers(id, eventDefaults(id), known)).not.toThrow();
  });
});
