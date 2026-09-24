// The "U blizini" selection layer (app/src/city/nearby.ts, seam S5, WP1 step 2):
// what the wall and the phone list around a place, in time order, within the
// bounds of the brief §12. Eight scenes on fake clocks (the evening peak, late
// evening, the last trams, after the last tram, the quiet hour, the morning
// peak, midday and a ZET outage), then each builder and bound on its own.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveVehicleRef } from '../../shared/city/arrivals';
import { distanceM } from '../../shared/city/geo';
import type { ScreenPlace } from '../../shared/city/place';
import { emptyCity, type CityState, type DepartureBoard, type Place, type Settlement, type StreetStory } from '../../shared/city/types';
import type { FeedItem, ModuleId, ModuleSnapshot } from '../../worker/feed/schema';
import {
  ALWAYS_ALTERNATE_MS,
  MAX_DEPARTURES,
  firstSentence,
  nearbyHead,
  nearbyPill,
  openingTimes,
  placeStory,
  rowBudget,
  selectNearby,
  shorterLabel,
  type NearbyInput,
  type NearbyKind,
  type NearbyRow,
} from '../../app/src/city/nearby';
import type { FeedSnapshots, ScreenStop } from '../../app/src/core/contracts';
import type { LastRunRoutes, LastRunSnapshot } from '../../app/src/core/lastrun';
import { zagrebDayKey, zagrebHour, zagrebTime } from '../../app/src/format';
import { createDefaultI18n } from '../../app/src/i18n/create-default-i18n';
import { sunTimes } from '../../app/src/ui/solar';

const hr = createDefaultI18n('hr');
const en = createDefaultI18n('en');
const at = (iso: string): number => Date.parse(iso);
const MIN = 60_000;

// --- the fixture: Trg bana J. Jelačića on Tuesday 22 and Wednesday 23 September 2026 ---

const PLACE: ScreenPlace = { kind: 'tram', name: 'Trg bana J. Jelačića', lon: 15.97726, lat: 45.81286, stopId: '106_1' };
const STOPS: ScreenStop[] = [
  { id: '106_1', name: 'Trg bana J. Jelačića', lon: 15.97726, lat: 45.81286, routes: ['1', '6', '11', '12', '13', '14', '17', '31', '34'] },
  { id: '118_1', name: 'Frankopanska', lon: 15.97, lat: 45.8117, routes: ['1', '6', '11'] },
];

const attribution = { text: 'Izvor: test', url: 'https://example.test/', licence: 'test' };
function snap(module: ModuleId, items: FeedItem[], status: ModuleSnapshot['status'] = 'live'): ModuleSnapshot {
  return { module, tier: 'open', status, fetchedAt: '2026-09-22T05:00:00Z', attribution, items };
}
function item(module: ModuleId, id: string, kind: FeedItem['kind'], title: string, extra: Partial<FeedItem> = {}): FeedItem {
  return { id, module, kind, tier: 'open', title, ...extra };
}

const CLOSURES = [
  item('prometnice', 'c-ilica', 'closure', 'Ilica', { geo: { type: 'LineString', coordinates: [[15.9705, 45.813], [15.972, 45.8131]] }, until: '2026-09-22T16:00:00Z' }), // do 18:00 Tue
  item('prometnice', 'c-vlaska', 'closure', 'Vlaška', { geo: { type: 'Point', coordinates: [15.987, 45.814] }, until: '2026-09-25T20:00:00Z' }), // do 25. 9.
  item('prometnice', 'c-branimirova', 'closure', 'Branimirova', { geo: { type: 'Point', coordinates: [15.98, 45.802] }, until: '2026-10-30T20:00:00Z' }), // third nearest
  item('prometnice', 'c-palmoticeva', 'closure', 'Palmotićeva', { geo: { type: 'Point', coordinates: [15.982, 45.81] } }), // no published end
  item('prometnice', 'c-dubrava', 'closure', 'Dubrava', { geo: { type: 'Point', coordinates: [16.07, 45.83] }, until: '2026-12-01T12:00:00Z' }), // 7 km out
];
const EVENTS = [
  item('dogadanja', 'ev-intersonus', 'event', 'Intersonus', { at: '2026-09-22T17:30:00Z', dateBasis: 'event', data: { source: 'kulturpunkt', venue: 'Kino Europa', precision: 'time' } }),
  item('dogadanja', 'ev-jazz', 'event', 'Jazz večer', { at: '2026-09-23T17:00:00Z', dateBasis: 'event', data: { source: 'kulturpunkt', venue: 'Kino Europa', precision: 'time' } }),
  item('dogadanja', 'ev-mocvara', 'event', 'Koncert u Močvari', { at: '2026-09-22T19:00:00Z', dateBasis: 'event', data: { source: 'kulturpunkt', venue: 'Močvara', precision: 'time' } }),
  item('dogadanja', 'ev-allday', 'event', 'Izložba', { at: '2026-09-22T22:00:00Z', dateBasis: 'event', data: { source: 'kulturpunkt', venue: 'Kino Europa', precision: 'day' } }),
];

const place = (id: string, category: Place['category'], name: string, lon: number, lat: number, extra: Partial<Place> = {}): Place =>
  ({ id, category, name, lon, lat, sourceId: category === 'heritage' ? 'heritage' : category, sourceRecord: id, ...extra });
const square = (lon: number, lat: number): [number, number][][][] => [[[[lon - 0.0003, lat - 0.0002], [lon + 0.0003, lat - 0.0002], [lon + 0.0003, lat + 0.0002], [lon - 0.0003, lat + 0.0002], [lon - 0.0003, lat - 0.0002]]]];
const PLACES: Place[] = [
  place('culture-europa', 'culture', 'Kino Europa', 15.9712, 45.8108, { hours: 'Blagajna: 1h prije početka projekcije' }),
  place('culture-mocvara', 'culture', 'Močvara', 15.97, 45.788),
  place('culture-moderna', 'culture', 'Moderna galerija', 15.979, 45.808, { hours: 'uto-pet 11h-19h, sub i ned 11h-14h, pon zatvoreno', address: 'Andrije Hebranga 1' }),
  place('culture-centar', 'culture', 'Centar za kulturu Trnje', 15.99, 45.815, { hours: 'pon-pet 08h-20h, sub 08h-14h' }),
  place('culture-far', 'culture', 'Centar za kulturu Sesvete', 16.11, 45.83, { hours: 'pon-pet 08h-20h' }),
  place('market-dolac', 'market', 'Tržnica Dolac', 15.9768, 45.8145, { hours: 'http://www.trznice-zg.hr/default.aspx?id=300' }),
  place('heritage-stedionica', 'heritage', 'Zgrada nekadašnje Gradske štedionice, Trg bana Jelačića 9 i 10', 15.9765, 45.813, { address: 'Trg bana Jelačića 9 i 10', subtype: 'nepokretno kulturno dobro - pojedinacno', polygons: square(15.9765, 45.813) }),
  place('heritage-far', 'heritage', 'Dvorac Brezovica', 15.9, 45.73, { polygons: square(15.9, 45.73) }),
];
const SETTLEMENTS: Settlement[] = [{ id: '72150', name: 'Zagreb', polygons: [[[[15.9, 45.76], [16.05, 45.76], [16.05, 45.85], [15.9, 45.85], [15.9, 45.76]]]] }];
const STREETS: StreetStory[] = [
  { id: '721503305', name: 'Trg bana Josipa Jelačića', settlement: 'Zagreb', settlementId: '72150', description: 'hrvatski ban, 1848-1859; 1801-1859' },
  { id: '721500001', name: 'Ilica', settlement: 'Zagreb', settlementId: '72150', description: 'prema staroj riječi za ulicu' },
];
const CITY: CityState = { ...emptyCity(), places: PLACES, streets: STREETS, settlements: SETTLEMENTS };

// The stop file of 106_1 as the script cuts it: the last and the first departure per line and service date.
const DAYS = ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24'];
const perDay = (time: string): Record<string, string> => Object.fromEntries(DAYS.map((d) => [d, time]));
const LAST: LastRunRoutes = {
  '1': perDay('23:31'), '6': perDay('24:27'), '11': perDay('24:09'), '12': perDay('23:45'), '13': perDay('24:30'),
  '14': perDay('24:31'), '17': perDay('24:01'), '31': perDay('28:48'), '34': perDay('27:41'),
};
const FIRST: LastRunRoutes = {
  '1': perDay('04:33'), '6': perDay('04:57'), '11': perDay('04:51'), '12': perDay('04:13'), '13': perDay('05:27'),
  '14': perDay('05:11'), '17': perDay('04:24'), '31': perDay('24:23'), '34': perDay('23:24'),
};
const LASTRUN: LastRunSnapshot = { status: 'live', fetchedAt: '2026-09-22T05:00:00Z', sourceUpdatedAt: '2026-09-22T03:00:00Z', validUntil: '2026-10-13T02:48:00Z', routes: LAST, first: FIRST };

const HEADSIGN: Record<string, string> = { '1': 'Zapadni kolodvor', '6': 'Črnomerec', '11': 'Dubec', '12': 'Dubrava', '13': 'Žitnjak', '14': 'Zapruđe', '17': 'Prečko', '31': 'Savski most', '34': 'Dubec' };
/** A live board for 106_1 with departures `minutes` ahead of `now` (trip id t<route>). */
function board(now: number, rows: readonly [route: string, minutes: number][]): DepartureBoard {
  return {
    operator: 'zet', stopId: '106_1', stopName: 'Trg bana J. Jelačića', status: 'live', generatedAt: new Date(now - MIN).toISOString(),
    departures: rows.map(([route, minutes]) => ({ operator: 'zet', tripId: `t${route}`, routeId: route, routeName: route, headsign: HEADSIGN[route]!, at: new Date(now + minutes * MIN).toISOString() })),
  };
}
const DAY_BOARD: readonly [string, number][] = [['6', 3], ['13', 7], ['14', 12], ['1', 18], ['17', 24]];
/** Line 6 is tracked a minute late (za 4 min), 13 on time (za 7 min), 14 tracked but past the ten-minute horizon. */
const DAY_FIXES: LiveVehicleRef[] = [
  { id: 'v6', tripId: 't6', routeId: '6', delaySeconds: 60 },
  { id: 'v13', tripId: 't13', routeId: '13', delaySeconds: 0 },
  { id: 'v14', tripId: 't14', routeId: '14', delaySeconds: 0 },
];

function snapshots(zet: ModuleSnapshot['status'] = 'live', prometnice: ModuleSnapshot['status'] = 'live'): FeedSnapshots {
  return { 'zet-rt': snap('zet-rt', [], zet), prometnice: snap('prometnice', CLOSURES, prometnice), dogadanja: snap('dogadanja', EVENTS) };
}

function input(now: number, extra: Partial<NearbyInput> = {}): NearbyInput {
  return {
    place: PLACE, radiusM: 2000, now, boards: [board(now, DAY_BOARD)], fixes: DAY_FIXES, snapshots: snapshots(),
    city: CITY, lastRun: LASTRUN, locale: 'hr', i18n: hr, stops: STOPS, ...extra,
  };
}

const kinds = (rows: readonly NearbyRow[]): NearbyKind[] => rows.map((r) => r.kind);
const ids = (rows: readonly NearbyRow[]): string[] => rows.map((r) => r.id);
const one = (rows: readonly NearbyRow[], kind: NearbyKind): NearbyRow => {
  const found = rows.filter((r) => r.kind === kind);
  expect(found, kind).toHaveLength(1);
  return found[0]!;
};

const SUN_22 = sunTimes(new Date('2026-09-22T10:00:00Z'), PLACE.lat, PLACE.lon);
const SUN_23 = sunTimes(new Date('2026-09-23T10:00:00Z'), PLACE.lat, PLACE.lon);

/** The "uvijek" row a scene expects on its 20-minute turn: the square's story on even turns, the building on odd. */
const alwaysFor = (now: number): string => (Math.floor(now / ALWAYS_ALTERNATE_MS) % 2 === 0 ? 'always:story:721503305' : 'always:heritage:heritage-stedionica');

const FORBIDDEN = /registra|nije provjera|Obuhvat|Dohvaćeno|zastarjelo|nepotvrđeno|uživo|po redu vožnje|Procjena|nedostupn|…/i;

/** Bounds that hold in every scene (§12). */
function checkBounds(rows: readonly NearbyRow[]): void {
  const deps = rows.filter((r) => r.kind === 'departure');
  expect(deps.length).toBeLessThanOrEqual(MAX_DEPARTURES);
  expect(kinds(rows).slice(0, deps.length).every((k) => k === 'departure')).toBe(true); // departures first
  for (const k of ['solar', 'last', 'first'] as const) expect(rows.filter((r) => r.kind === k).length, k).toBeLessThanOrEqual(1);
  const timeless = rows.filter((r) => r.always);
  expect(timeless.length).toBeLessThanOrEqual(1);
  if (timeless.length) expect(rows.at(-1)).toBe(timeless[0]); // the uvijek row closes the list
  const timed = rows.filter((r) => r.kind !== 'departure' && !r.always).map((r) => r.atMs!);
  expect(timed).toEqual([...timed].sort((a, b) => a - b)); // time order
  for (const r of rows) {
    expect(r.always ? r.atMs : typeof r.atMs, r.id).toBe(r.always ? null : 'number');
    expect(`${r.title} ${r.sub}`, r.id).not.toMatch(FORBIDDEN);
    expect(r.title.trim(), r.id).not.toBe('');
    if (r.kind !== 'departure') expect(r.live, r.id).toBe(false);
    // A short label is a whole label, shorter than the one it stands in for (the wall prints it only when that runs long).
    for (const [full, short] of [[r.title, r.titleShort], [r.sub, r.subShort]] as const) {
      if (short === undefined) continue;
      expect(short.trim(), r.id).not.toBe('');
      expect(short.length, r.id).toBeLessThan(full.length);
      expect(short, r.id).not.toMatch(FORBIDDEN);
    }
  }
  expect(new Set(ids(rows)).size).toBe(rows.length);
}

describe('eight scenes on fake clocks', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  /** Runs a scene with the system clock set to it, and proves the answer reads `now` only. */
  function scene(now: number, extra: Partial<NearbyInput> = {}): NearbyRow[] {
    vi.setSystemTime(now);
    const rows = selectNearby(input(now, extra));
    vi.setSystemTime(now + 36 * 3_600_000);
    expect(selectNearby(input(now, extra))).toEqual(rows);
    checkBounds(rows);
    return rows;
  }

  it('peak1745: three departures (two blue, one grey), the closure ending tonight, sunset, events with the tram to the venue, one uvijek row', () => {
    const now = at('2026-09-22T15:45:00Z'); // Tue 17:45
    const rows = scene(now);
    expect(ids(rows)).toEqual([
      'dep:t6', 'dep:t13', 'dep:t14',
      'closure:c-ilica', 'solar:sunset:2026-09-22', 'event:ev-intersonus', 'event:ev-jazz', 'closure:c-vlaska',
      alwaysFor(now),
    ]);
    expect(rows.slice(0, 3).map((r) => r.live)).toEqual([true, true, false]);
    expect(rows[0]).toMatchObject({ title: 'Črnomerec', source: 'zet-rt', atMs: now + 4 * MIN, arrival: { routeId: '6', minutes: 4 } });
    expect(rows[2]).toMatchObject({ title: 'Zapruđe', source: 'zet-gtfs' }); // tracked, but past the countdown horizon: a clock time
    expect(rows.find((r) => r.id === 'closure:c-ilica')!.atMs).toBe(at('2026-09-22T16:00:00Z'));
    expect(one(rows, 'solar')).toMatchObject({ title: 'Zalazak sunca', atMs: SUN_22.sunset.getTime() });
    expect(rows.find((r) => r.id === 'event:ev-intersonus')).toMatchObject({ title: 'Intersonus', sub: 'Kino Europa · tramvaj 1', atMs: at('2026-09-22T17:30:00Z') });
  });

  it('late2130: the last trams as one row from four hours ahead, sunrise tomorrow, tomorrow’s openings once the evening has emptied', () => {
    const now = at('2026-09-22T19:30:00Z'); // Tue 21:30
    const rows = scene(now);
    expect(ids(rows)).toEqual([
      'dep:t6', 'dep:t13', 'dep:t14',
      'last:2026-09-22', 'solar:sunrise:2026-09-23',
      'open:culture-centar:2026-09-23', 'open:culture-moderna:2026-09-23',
      'event:ev-jazz', 'closure:c-vlaska', 'closure:c-branimirova', // Ilica has reopened: the next nearest closure takes its place
      alwaysFor(now),
    ]);
    const last = one(rows, 'last');
    expect(last).toMatchObject({ title: 'Zadnji tramvaji', atMs: at('2026-09-22T21:31:00Z'), sub: '1 23:31 · 12 23:45 · 17 00:01 · 11 00:09 · 6 00:27 · 13 00:30 · 14 00:31' });
    expect(last.services!.map((s) => s.routeName)).toEqual(['1', '12', '17', '11', '6', '13', '14']); // no night line
    expect(one(rows, 'solar')).toMatchObject({ title: 'Izlazak sunca', atMs: SUN_23.sunrise.getTime() });
    expect(rows.find((r) => r.kind === 'opening')).toMatchObject({ title: 'Centar za kulturu Trnje', sub: 'Kultura', atMs: at('2026-09-23T06:00:00Z') });
    expect(rows.filter((r) => r.kind === 'first')).toEqual([]); // before 22:00
  });

  it('lastTrams2240: the last trams, the first tram of tomorrow from 22:00, and the pharmacy takes the uvijek row', () => {
    const now = at('2026-09-22T20:40:00Z'); // Tue 22:40
    const rows = scene(now);
    expect(kinds(rows)).toEqual(['departure', 'departure', 'departure', 'last', 'first', 'solar', 'opening', 'opening', 'event', 'closure', 'closure', 'pharmacy']);
    const first = one(rows, 'first');
    expect(first).toMatchObject({ id: 'first:2026-09-23', title: 'Prvi tramvaj', atMs: at('2026-09-23T02:13:00Z') });
    expect(first.sub.startsWith('12 04:13 · 17 04:24 · 1 04:33')).toBe(true);
    expect(first.services!.some((s) => s.routeId === '31' || s.routeId === '34')).toBe(false); // night lines are not the morning's first tram
    expect(one(rows, 'pharmacy')).toMatchObject({ id: 'always:pharmacy', title: '24/7', sub: 'Trg bana J. Jelačića 3', always: true, atMs: null });
  });

  it('afterLast0045: the last-trams row has gone with the last tram, night trams leave by the timetable, the first tram waits', () => {
    const now = at('2026-09-22T22:45:00Z'); // Wed 00:45
    const rows = scene(now, { boards: [board(at('2026-09-22T22:45:00Z'), [['31', 20], ['34', 38]])], fixes: [] });
    expect(kinds(rows)).toEqual(['departure', 'departure', 'first', 'solar', 'opening', 'opening', 'event', 'closure', 'closure', 'pharmacy']);
    expect(rows.slice(0, 2).map((r) => [r.title, r.live])).toEqual([['Savski most', false], ['Dubec', false]]);
    expect(one(rows, 'first')).toMatchObject({ id: 'first:2026-09-23', atMs: at('2026-09-23T02:13:00Z') }); // the same row it was before midnight
    expect(one(rows, 'solar').id).toBe('solar:sunrise:2026-09-23');
  });

  it('night0430: the next line to start remains beside sunrise, the morning’s openings and the pharmacy', () => {
    const now = at('2026-09-23T02:30:00Z'); // Wed 04:30
    const rows = scene(now, { boards: [board(now, [['1', 3], ['31', 15], ['11', 21], ['6', 27]])], fixes: [] });
    expect(kinds(rows)).toEqual(['departure', 'departure', 'departure', 'first', 'solar', 'opening', 'opening', 'event', 'closure', 'closure', 'pharmacy']);
    expect(one(rows, 'first').services![0]).toMatchObject({ routeId: '1', atMs: at('2026-09-23T02:33:00Z') });
    expect(rows.slice(0, 3).map((r) => r.title)).toEqual(['Zapadni kolodvor', 'Savski most', 'Dubec']);
    expect(rows.filter((r) => r.kind === 'opening').map((r) => zagrebTime(r.atMs))).toEqual(['08:00', '11:00']);
  });

  it('morning0745: departures, the closure ending today, sunset, tonight’s event; no night rows', () => {
    const now = at('2026-09-22T05:45:00Z'); // Tue 07:45
    const rows = scene(now);
    expect(ids(rows)).toEqual([
      'dep:t6', 'dep:t13', 'dep:t14',
      'closure:c-ilica', 'solar:sunset:2026-09-22', 'event:ev-intersonus', 'event:ev-jazz', 'closure:c-vlaska',
      alwaysFor(now),
    ]);
  });

  it('midday1230: the same shape at midday, and the uvijek row alternates on the 20-minute boundary', () => {
    const now = at('2026-09-22T10:30:00Z'); // Tue 12:30
    const rows = scene(now);
    expect(kinds(rows)).toEqual(['departure', 'departure', 'departure', 'closure', 'solar', 'event', 'event', 'closure', 'always']);
    const boundary = Math.ceil(now / ALWAYS_ALTERNATE_MS) * ALWAYS_ALTERNATE_MS;
    const before = selectNearby(input(boundary - 1)).at(-1)!;
    const after = selectNearby(input(boundary)).at(-1)!;
    expect(new Set([before.id, after.id])).toEqual(new Set(['always:story:721503305', 'always:heritage:heritage-stedionica']));
    const story = [before, after].find((r) => r.id.startsWith('always:story'))!;
    const heritage = [before, after].find((r) => r.id.startsWith('always:heritage'))!;
    expect(story).toMatchObject({ title: 'Trg bana Josipa Jelačića', sub: 'hrvatski ban, 1848-1859; 1801-1859', always: true, selection: { kind: 'street', id: '721503305' } });
    expect(heritage).toMatchObject({ title: 'Zgrada nekadašnje Gradske štedionice', sub: 'Trg bana Jelačića 9 i 10', map: { geometry: { type: 'MultiPolygon' } } });
  });

  it('outage0800: ZET sends no positions, so every departure is a grey timetable time though vehicles are still held', () => {
    const now = at('2026-09-22T06:00:00Z'); // Tue 08:00
    const rows = scene(now, { snapshots: snapshots('down') });
    const deps = rows.filter((r) => r.kind === 'departure');
    expect(deps).toHaveLength(3);
    expect(deps.every((r) => !r.live && r.source === 'zet-gtfs')).toBe(true);
    expect(deps.map((r) => r.atMs)).toEqual([now + 3 * MIN, now + 7 * MIN, now + 12 * MIN]); // the timetable, no reported delay
    expect(kinds(rows).slice(3)).toEqual(['closure', 'solar', 'event', 'event', 'closure', 'always']); // the rest of the list stands
  });
});

describe('departures', () => {
  const now = at('2026-09-22T10:30:00Z');
  it('never more than three, blue only for a tracked vehicle inside the countdown horizon', () => {
    const rows = selectNearby(input(now, { fixes: [...DAY_FIXES, { id: 'v1', tripId: 't1', routeId: '1', delaySeconds: 0 }] }));
    expect(rows.filter((r) => r.kind === 'departure')).toHaveLength(3);
    expect(rows.filter((r) => r.live).map((r) => r.id)).toEqual(['dep:t6', 'dep:t13']);
  });
  it('shows a tracked departure past the countdown horizon as its timetable time, ordered and cut by it', () => {
    const peak = at('2026-09-22T15:45:00Z'); // Tue 17:45
    // Line 17 is due 17:57 but tracked ten minutes late (ETA 18:07, past the horizon); line 14 at 18:00 carries no vehicle.
    const boards = [board(peak, [['6', 3], ['13', 7], ['17', 12], ['14', 15], ['1', 18]])];
    const fixes: LiveVehicleRef[] = [
      { id: 'v6', tripId: 't6', routeId: '6', delaySeconds: 60 },
      { id: 'v13', tripId: 't13', routeId: '13', delaySeconds: 0 },
      { id: 'v17', tripId: 't17', routeId: '17', delaySeconds: 600 },
    ];
    const deps = selectNearby(input(peak, { boards, fixes })).filter((r) => r.kind === 'departure');
    expect(ids(deps)).toEqual(['dep:t6', 'dep:t13', 'dep:t17']); // by 17:57, not by 18:07 (which would have let 14 in)
    const late = deps[2]!;
    expect(late).toMatchObject({ atMs: at('2026-09-22T15:57:00Z'), live: false, source: 'zet-gtfs' });
    expect(zagrebTime(late.atMs)).toBe('17:57');
    expect(late.arrival).toMatchObject({ tripId: 't17', atMs: at('2026-09-22T15:57:00Z'), live: false, minutes: null });
    expect(late.arrival).not.toHaveProperty('vehicleId');
    expect(deps[0]).toMatchObject({ live: true, atMs: peak + 4 * MIN, arrival: { live: true, minutes: 4, vehicleId: 'v6' } });
  });
  it('drops a late tram whose timetable time has passed rather than listing a time already gone', () => {
    const peak = at('2026-09-22T15:45:00Z');
    // Due 17:40, tracked twenty minutes late: blue would be za 15 min (past the horizon), grey would be 17:40, already gone.
    const boards = [board(peak, [['17', -5], ['6', 3], ['13', 7], ['14', 12]])];
    const fixes: LiveVehicleRef[] = [{ id: 'v17', tripId: 't17', routeId: '17', delaySeconds: 1200 }];
    expect(ids(selectNearby(input(peak, { boards, fixes })).filter((r) => r.kind === 'departure'))).toEqual(['dep:t6', 'dep:t13', 'dep:t14']);
  });
  it('invents no row: no boards, no departures; a board with nothing ahead, none either', () => {
    expect(selectNearby(input(now, { boards: [] })).some((r) => r.kind === 'departure')).toBe(false);
    expect(selectNearby(input(now, { boards: [board(now, [['6', -5]])] })).some((r) => r.kind === 'departure')).toBe(false);
  });
  it('keeps each departure’s id across ticks, so its row keeps its node', () => {
    const a = selectNearby(input(now));
    const b = selectNearby({ ...input(now), now: now + MIN });
    expect(ids(b).filter((id) => id.startsWith('dep:'))).toEqual(ids(a).filter((id) => id.startsWith('dep:')));
  });
});

describe('closures', () => {
  const now = at('2026-09-22T10:30:00Z');
  const only = (closure: FeedItem, radiusM: number, status: ModuleSnapshot['status'] = 'live') =>
    selectNearby(input(now, { radiusM, snapshots: { prometnice: snap('prometnice', [closure], status) } })).filter((r) => r.kind === 'closure');
  const away = item('prometnice', 'c-away', 'closure', 'Savska', { geo: { type: 'Point', coordinates: [15.955, 45.7955] }, until: '2026-09-22T16:00:00Z' });

  it('lists a closure inside the circle by its end, not one outside it', () => {
    const d = distanceM(PLACE, { lon: 15.955, lat: 45.7955 });
    expect(d).toBeGreaterThan(2000);
    expect(d).toBeLessThan(3000);
    expect(only(away, 2000)).toEqual([]);
    expect(only(away, 3000)).toMatchObject([{ id: 'closure:c-away', title: 'Savska', atMs: at('2026-09-22T16:00:00Z'), source: 'prometnice' }]);
  });
  it('keeps the two nearest, never a closure without a published end, and keeps it while the feed is stale (Q7)', () => {
    const rows = selectNearby(input(now)).filter((r) => r.kind === 'closure');
    expect(ids(rows)).toEqual(['closure:c-ilica', 'closure:c-vlaska']);
    expect(rows[0]!.map).toEqual({ id: 'c-ilica', geometry: { type: 'LineString', coordinates: [[15.9705, 45.813], [15.972, 45.8131]] } });
    expect(ids(selectNearby(input(now, { snapshots: snapshots('live', 'stale') })).filter((r) => r.kind === 'closure'))).toEqual(['closure:c-ilica', 'closure:c-vlaska']);
    expect(selectNearby(input(now, { snapshots: snapshots('live', 'down') })).some((r) => r.kind === 'closure')).toBe(false);
  });
  it('drops a closure once its end has passed', () => {
    expect(ids(selectNearby(input(at('2026-09-22T16:00:01Z'))).filter((r) => r.kind === 'closure'))).toEqual(['closure:c-vlaska', 'closure:c-branimirova']);
  });
});

describe('events', () => {
  it('only timed events that have not started, at a located venue inside the circle, with the tram when the venue is a walk away', () => {
    const rows = selectNearby(input(at('2026-09-22T15:45:00Z'))).filter((r) => r.kind === 'event');
    expect(ids(rows)).toEqual(['event:ev-intersonus', 'event:ev-jazz']); // Močvara lies outside the circle; the all-day show has no time
    expect(rows[0]!.map).toEqual({ id: 'culture-europa', geometry: { type: 'Point', coordinates: [15.9712, 45.8108] } });
    const noStops = selectNearby({ ...input(at('2026-09-22T15:45:00Z')), stops: undefined }).find((r) => r.kind === 'event')!;
    expect(noStops.sub).toBe('Kino Europa');
    expect(selectNearby(input(at('2026-09-22T17:30:01Z'))).some((r) => r.id === 'event:ev-intersonus')).toBe(false); // it has started
  });
});

describe('the solar event', () => {
  it('only the next one, flipping from sunset to tomorrow’s sunrise at sunset', () => {
    const sunset = SUN_22.sunset.getTime();
    const before = selectNearby(input(sunset - MIN)).filter((r) => r.kind === 'solar');
    const after = selectNearby(input(sunset + MIN)).filter((r) => r.kind === 'solar');
    expect(before).toMatchObject([{ id: 'solar:sunset:2026-09-22', atMs: sunset, title: 'Zalazak sunca' }]);
    expect(after).toMatchObject([{ id: 'solar:sunrise:2026-09-23', atMs: SUN_23.sunrise.getTime(), title: 'Izlazak sunca' }]);
    expect(selectNearby(input(SUN_22.sunrise.getTime() - MIN)).filter((r) => r.kind === 'solar')).toMatchObject([{ id: 'solar:sunrise:2026-09-22' }]);
  });
});

describe('the last trams', () => {
  const lastRow = (now: number) => selectNearby(input(now)).filter((r) => r.kind === 'last');
  it('appears four hours ahead of a line’s last departure, one line at a time', () => {
    expect(lastRow(at('2026-09-22T17:30:00Z'))).toEqual([]); // 19:30, 4 h 01 min before line 1's 23:31
    expect(lastRow(at('2026-09-22T17:31:00Z'))).toMatchObject([{ id: 'last:2026-09-22', sub: '1 23:31' }]);
  });
  it('drops each line as it leaves, keeps its id across midnight, and goes after the last one', () => {
    const at2332 = lastRow(at('2026-09-22T21:32:00Z'))[0]!;
    expect(at2332.sub).toBe('12 23:45 · 17 00:01 · 11 00:09 · 6 00:27 · 13 00:30 · 14 00:31');
    expect(at2332.atMs).toBe(at('2026-09-22T21:45:00Z'));
    const at0028 = lastRow(at('2026-09-22T22:28:00Z'))[0]!;
    expect(at0028).toMatchObject({ id: 'last:2026-09-22', sub: '13 00:30 · 14 00:31' });
    expect(lastRow(at('2026-09-22T22:31:00Z'))).toMatchObject([{ sub: '14 00:31' }]);
    expect(lastRow(at('2026-09-22T22:31:01Z'))).toEqual([]);
  });
  it('leaves out night service and a line that only pulls out early here', () => {
    const routes: LastRunRoutes = { ...LAST, '11': perDay('04:20') };
    const row = one(selectNearby(input(at('2026-09-22T20:40:00Z'), { lastRun: { ...LASTRUN, routes } })), 'last');
    expect(row.services!.map((s) => s.routeId)).toEqual(['1', '12', '17', '6', '13', '14']); // no 11 (04:20 is a morning run), no 31 or 34
  });
  it('needs a live stop file', () => {
    expect(selectNearby(input(at('2026-09-22T20:40:00Z'), { lastRun: null })).some((r) => r.kind === 'last' || r.kind === 'first')).toBe(false);
    expect(selectNearby(input(at('2026-09-22T20:40:00Z'), { lastRun: { status: 'down', fetchedAt: '2026-09-22T20:00:00Z' } })).some((r) => r.kind === 'last')).toBe(false);
  });
});

describe('the first tram', () => {
  const firstRow = (now: number) => selectNearby(input(now)).filter((r) => r.kind === 'first');
  it('names the next unstarted line until every morning line has started, with a hard stop at 06:00 (decision 27)', () => {
    for (const [time, route, next] of [
      ['04:13', '17', '04:24'], ['04:30', '1', '04:33'], ['04:33', '11', '04:51'],
      ['04:57', '14', '05:11'], ['05:11', '13', '05:27'],
    ]) {
      const now = at(`2026-09-23T${time}:00+02:00`);
      const first = firstRow(now);
      expect(first).toHaveLength(1);
      expect(first[0]!.id).toBe('first:2026-09-23');
      expect(first[0]!.services![0]).toMatchObject({ routeId: route, atMs: at(`2026-09-23T${next}:00+02:00`) });
      expect(first[0]!.services!.every(s => s.atMs > now)).toBe(true);
      expect(first[0]!.sub.startsWith(`${route} ${next}`)).toBe(true);
    }
    expect(firstRow(at('2026-09-23T05:27:00+02:00'))).toEqual([]);
    const lastRun = { ...LASTRUN, first: { ...FIRST, '13': perDay('06:15') } };
    expect(selectNearby(input(at('2026-09-23T05:59:00+02:00'), { lastRun })).filter(r => r.kind === 'first')).toHaveLength(1);
    expect(selectNearby(input(at('2026-09-23T06:00:00+02:00'), { lastRun })).filter(r => r.kind === 'first')).toEqual([]);
  });
  it('from 22:00 until all lines have started', () => {
    expect(firstRow(at('2026-09-22T19:59:00Z'))).toEqual([]); // 21:59
    expect(firstRow(at('2026-09-22T20:00:00Z'))).toMatchObject([{ id: 'first:2026-09-23', atMs: at('2026-09-23T02:13:00Z') }]); // 22:00, tomorrow 04:13
    expect(firstRow(at('2026-09-23T02:12:00Z'))).toMatchObject([{ id: 'first:2026-09-23' }]); // 04:12
    expect(firstRow(at('2026-09-23T02:13:00Z'))).toMatchObject([{ id: 'first:2026-09-23', atMs: at('2026-09-23T02:24:00Z') }]); // 04:13: line 17 is next
    expect(firstRow(at('2026-09-23T10:00:00Z'))).toEqual([]); // midday
  });
  it('reads GTFS time against the service date: 24:00 or later is the next day’s small hours, and night service never counts', () => {
    const tuesday = at('2026-09-22T20:40:00Z'); // Tue 22:40: the morning is Wednesday's
    const routes: LastRunRoutes = { ...LAST, '15': perDay('24:40'), '33': perDay('28:15') };
    const first: LastRunRoutes = { ...FIRST, '12': perDay('24:05'), '15': perDay('24:10'), '33': perDay('28:15') };
    const row = one(selectNearby(input(tuesday, { lastRun: { ...LASTRUN, routes, first } })), 'first');
    // 12's "24:05" on Wednesday's service date is Thursday 00:05; 15's "24:10" likewise; 33 is a night line.
    expect(row.services!.map((s) => s.routeId)).toEqual(['17', '1', '11', '6', '14', '13']);
    expect(row.atMs).toBe(at('2026-09-23T02:24:00Z'));
  });
  it('the committed file of 112_1 on 22 September at 22:40: line 33’s "28:15" is not Wednesday’s first tram', () => {
    const file = JSON.parse(readFileSync(new URL('../../app/public/data/lastrun/112_1.json', import.meta.url), 'utf8')) as { generatedAt: string; validUntil: string; routes: LastRunRoutes; first: LastRunRoutes };
    const snapshot: LastRunSnapshot = { status: 'live', fetchedAt: file.generatedAt, sourceUpdatedAt: file.generatedAt, validUntil: file.validUntil, routes: file.routes, first: file.first };
    const day = zagrebDayKey(file.generatedAt);
    const next = zagrebDayKey(Date.parse(`${day}T12:00:00Z`) + 86_400_000);
    expect(file.first['33']?.[next]).toMatch(/^2[4-9]:\d\d$/); // the counterexample is in the artefact: the next morning's 04:xx under the next date
    const stop: ScreenPlace = { kind: 'tram', name: 'Branim. tržnica', lon: 15.99198, lat: 45.80614, stopId: '112_1' };
    const lateEvening = Date.parse(`${day}T20:40:00Z`);
    const row = one(selectNearby({ ...input(lateEvening), place: stop, boards: [], fixes: [], snapshots: {}, city: emptyCity(), lastRun: snapshot }), 'first');
    const lines = row.services!.map((s) => s.routeId);
    expect(lines).not.toContain('33');
    expect(lines).not.toContain('31');
    expect(lines.length).toBeGreaterThan(0);
    for (const service of row.services!) {
      expect(zagrebDayKey(service.atMs), service.routeId).toBe(next);
      expect(zagrebHour(service.atMs), service.routeId).toBeGreaterThanOrEqual(3);
      expect(zagrebHour(service.atMs), service.routeId).toBeLessThan(12);
    }
    expect(row.atMs).toBe(Math.min(...row.services!.map((s) => s.atMs)));
  });
  it('is absent for a stop file cut before the first table existed', () => {
    const { first: _dropped, ...withoutFirst } = LASTRUN as LastRunSnapshot & { first: LastRunRoutes };
    expect(selectNearby(input(at('2026-09-22T20:40:00Z'), { lastRun: withoutFirst })).some((r) => r.kind === 'first')).toBe(false);
  });
});

describe('the uvijek row', () => {
  it('stands in with the other kind when one has nothing to say, and is absent when neither has', () => {
    const now = at('2026-09-22T10:30:00Z');
    const noStreets = { ...CITY, streets: [] };
    expect(selectNearby(input(now, { city: noStreets })).at(-1)!.id).toBe('always:heritage:heritage-stedionica');
    const noHeritage = { ...CITY, places: PLACES.filter((p) => p.category !== 'heritage') };
    expect(selectNearby(input(now, { city: noHeritage })).at(-1)!.id).toBe('always:story:721503305');
    expect(selectNearby(input(now, { city: emptyCity() })).some((r) => r.always)).toBe(false);
  });
  it('is the 24/7 pharmacy from 22:00 to 06:00, the one nearest the place', () => {
    const at0300 = selectNearby(input(at('2026-09-23T01:00:00Z')));
    expect(at0300.at(-1)).toMatchObject({ kind: 'pharmacy', title: '24/7', sub: 'Trg bana J. Jelačića 3', map: { geometry: { type: 'Point' } } });
    const far: ScreenPlace = { kind: 'tram', name: 'Dubrava', lon: 16.056, lat: 45.8235, stopId: '999_1' };
    expect(selectNearby(input(at('2026-09-23T01:00:00Z'), { place: far })).at(-1)).toMatchObject({ sub: 'Grižanska 4' });
    expect(selectNearby(input(at('2026-09-23T04:00:00Z'))).at(-1)!.kind).toBe('always'); // 06:00
  });
  it('finds the square’s story through its abbreviated name, never a random street of the settlement', () => {
    expect(placeStory(PLACE, CITY)?.id).toBe('721503305');
    expect(placeStory({ name: 'Ilica', lon: 15.97, lat: 45.813 }, CITY)?.id).toBe('721500001');
    expect(placeStory({ name: 'Glavni kolodvor', lon: 15.978, lat: 45.805 }, CITY)).toBeNull();
    expect(placeStory({ ...PLACE, lon: 16.2, lat: 45.9 }, CITY)).toBeNull(); // outside every settlement
    const twin = { ...STREETS[0]!, id: 'twin', name: 'Trg bana Jurja Jelačića' };
    expect(placeStory(PLACE, { streets: [...STREETS, twin], settlements: SETTLEMENTS })).toBeNull(); // two readings: none
  });
  it('names a protected building by its name and the first street of its register address', () => {
    const block = place('heritage-blok', 'heritage', 'Zakladni blok', 15.9772, 45.8125, { address: 'Gajeva 02,2a,2b,2c, Bogovićeva 1,1a,1b, 2 i 4, Petričeva ulica 1,3,5 i 7 i Ilici 1 i 1a' });
    const oktogon = place('heritage-oktogon', 'heritage', 'Kompleks Prve hrvatske štedionice - Oktogon, Ilica 5 - Margaretska 1-3', 15.9772, 45.8125, { address: 'Ilica 005 - Margaretska 01-03 - Bogovićeva 06' });
    const row = (p: Place) => selectNearby(input(at('2026-09-22T10:30:00Z'), { city: { ...CITY, streets: [], places: [p] } })).at(-1)!;
    expect(row(block)).toMatchObject({ title: 'Zakladni blok', sub: 'Gajeva 2,2a,2b,2c' });
    // Decision 24: a named house-number range is legitimate. Still inspect
    // the complete raw field: a phone suffix cannot disappear in shortening.
    expect(row(oktogon)).toMatchObject({ title: 'Kompleks Prve hrvatske štedionice - Oktogon', sub: 'Ilica 5' });
    const skips: string[] = [];
    const rows = selectNearby(input(at('2026-09-22T10:30:00Z'), {
      city: { ...CITY, streets: [], places: [{ ...oktogon, address: `${oktogon.address}, 01 234 567` }] }, onSkip: reason => skips.push(reason),
    }));
    expect(rows.some(r => r.kind === 'always')).toBe(false);
    expect(skips).toContain('phone');
    expect(row({ ...oktogon, address: 'Ilica 005' })).toMatchObject({ title: 'Kompleks Prve hrvatske štedionice - Oktogon', sub: 'Ilica 5' });
  });
  it('cuts a story at its first sentence, never mid-word', () => {
    expect(firstSentence('hrvatski ban, 1848-1859; 1801-1859')).toBe('hrvatski ban, 1848-1859; 1801-1859');
    expect(firstSentence('Trg je nazvan po banu Josipu Jelačiću 1848. godine. Kip je djelo Antona Fernkorna.')).toBe('Trg je nazvan po banu Josipu Jelačiću 1848. godine.');
    const long = 'riječ '.repeat(40).trim();
    const cut = firstSentence(long);
    expect(cut.length).toBeLessThanOrEqual(140);
    expect(cut.endsWith('riječ')).toBe(true);
  });
});

describe('tomorrow’s openings', () => {
  it('reads ten real catalogue hours conservatively: whole phrases with days, or nothing', () => {
    const wed = 3, sat = 6, sun = 0, mon = 1;
    const cases: [string, Record<number, number | null | undefined>][] = [
      ['pon-pet 08h-20h, sub 08h-14h', { [wed]: 480, [sat]: 480, [sun]: undefined }],
      ['uto-pet 11h-19h, sub i ned 11h-14h, pon zatvoreno', { [wed]: 660, [sun]: 660, [mon]: null }],
      ['pon-pet 08.30h-19.30h, sub 8.30h-13h', { [wed]: 510, [sat]: 510 }],
      ['uto, sri, pet i sub 10h -18h čet 10h - 20h ned 10h - 13h, pon zatvoreno', { [wed]: 600, 4: 600, [sun]: 600, [mon]: null }],
      ['pon-pet 10h-13:30h i 16h-19:30h, sub 10h-14h', { [wed]: 600 }],
      ['pon-pet 10h-18h. sub-ned 10h-13h', { [sun]: 600 }],
      ['uto-ned 11h-19h, sub 11h-20h, pon zatvoreno', { [sat]: 660, [mon]: null }],
    ];
    for (const [text, expected] of cases) {
      const times = openingTimes(text);
      expect(times, text).not.toBeNull();
      for (const [day, minutes] of Object.entries(expected)) expect(times!.get(Number(day)), `${text} @${day}`).toBe(minutes);
    }
    for (const doubt of [
      '08h-16h (stranke 09h-15h)', // no day: says nothing about Saturday
      'Blagajna: 1h prije početka predstave',
      'zimsko: pon-pet 10h-17h(čet 10h-13 i 17h-20h), sub 10h-13h, ljetno(lipanj, srpanj): pon-pet 09h-14h i 18h-20h, sub 10h-13h',
      'http://www.trznice-zg.hr/default.aspx?id=314',
      'utorkom 11h-17h',
      'pon-pet 10h-16h, 17h-20h, sbu 10h-14h',
    ]) expect(openingTimes(doubt), doubt).toBeNull();
  });
  it('only from 20:00, only while no event is left tonight, the two nearest', () => {
    const openings = (now: number, extra: Partial<NearbyInput> = {}) => selectNearby(input(now, extra)).filter((r) => r.kind === 'opening');
    expect(openings(at('2026-09-22T17:59:00Z'))).toEqual([]); // 19:59
    expect(ids(openings(at('2026-09-22T18:00:00Z')))).toEqual(['open:culture-centar:2026-09-23', 'open:culture-moderna:2026-09-23']);
    const late = item('dogadanja', 'ev-late', 'event', 'Kasni koncert', { at: '2026-09-22T20:30:00Z', dateBasis: 'event', data: { source: 'kulturpunkt', venue: 'Kino Europa', precision: 'time' } });
    expect(openings(at('2026-09-22T18:00:00Z'), { snapshots: { ...snapshots(), dogadanja: snap('dogadanja', [...EVENTS, late]) } })).toEqual([]);
    expect(openings(at('2026-09-22T18:00:00Z'), { radiusM: 700 }).map((r) => r.title)).toEqual(['Moderna galerija']);
  });
});

describe('shorter complete labels (titleShort, subShort)', () => {
  const now = at('2026-09-22T15:45:00Z');
  const event = (id: string, title: string, extra: Partial<FeedItem> = {}) =>
    item('dogadanja', id, 'event', title, { at: '2026-09-22T18:00:00Z', dateBasis: 'event', data: { source: 'kulturpunkt', venue: 'Kino Europa', precision: 'time' }, ...extra });
  const eventRow = (ev: FeedItem, extra: Partial<NearbyInput> = {}): NearbyRow =>
    selectNearby(input(now, { snapshots: { ...snapshots(), dogadanja: snap('dogadanja', [ev]) }, ...extra })).find((r) => r.id === `event:${ev.id}`)!;

  // Review W (P2): the words before a colon or a dash are not a name the source gave the event
  // ("Javno predavanje: Povijest Zagreba" is not "Javno predavanje"). A short title comes only from
  // the source's own words; without one the wall wraps the whole title (app/src/kiosk/timeline.ts).
  it('never makes a short title by cutting the source title at its punctuation', () => {
    for (const title of ['Večer u Kvaterniku: razgovor o gradu i kulturnoj baštini', 'Javno predavanje: Povijest Zagreba',
      'S druge strane zrcala – psihoanaliza i film', 'Noć kazališta (program za djecu)', '„Kiša: pjesme“ – koncert u dvorištu',
      'Predavanje: Povijest Zagreba', 'Koncert u 19:30 sati', 'Koncert „Kiša: pjesme“', 'Intersonus', 'Erdödy-Keglević danas']) {
      const row = eventRow(event(`ev-${title.length}`, title));
      expect(row.title, title).toBe(title);
      expect(row, title).not.toHaveProperty('titleShort');
    }
  });
  it('prefers the source’s own title where a machine brief stands in for it', () => {
    const row = eventRow(event('ev-brief', 'Jazz u Europi', { brief: 'Večer jazza u Kinu Europa s gostima iz Ljubljane i Beča' }));
    expect(row).toMatchObject({ title: 'Večer jazza u Kinu Europa s gostima iz Ljubljane i Beča', titleShort: 'Jazz u Europi' });
  });
  it('gives the venue alone as the short sub when the tram to it follows, and nothing when the venue is the whole sub', () => {
    const row = eventRow(event('ev-tram', 'Intersonus'));
    expect(row).toMatchObject({ sub: 'Kino Europa · tramvaj 1', subShort: 'Kino Europa' });
    expect(eventRow(event('ev-notram', 'Intersonus'), { stops: undefined })).not.toHaveProperty('subShort');
  });
  it('names the square’s story by the stop’s own shorter name, and a street matched exactly has no shorter one', () => {
    const story = (place: ScreenPlace) => selectNearby(input(at('2026-09-22T10:30:00Z'), { place, city: { ...CITY, places: [] } })).at(-1)!;
    expect(story(PLACE)).toMatchObject({ kind: 'always', title: 'Trg bana Josipa Jelačića', titleShort: 'Trg bana J. Jelačića' });
    expect(story({ kind: 'tram', name: 'Ilica', lon: 15.97, lat: 45.813, stopId: '118_1' })).not.toHaveProperty('titleShort');
  });
  it('gives a closure the feed’s own summary where a long brief is its sub, and nothing more', () => {
    const closure = (extra: Partial<FeedItem>) => selectNearby(input(at('2026-09-22T10:30:00Z'), {
      snapshots: { prometnice: snap('prometnice', [item('prometnice', 'c-x', 'closure', 'Ilica', { geo: { type: 'Point', coordinates: [15.9705, 45.813] }, until: '2026-09-22T16:00:00Z', summary: 'zatvoreno zbog radova, oba smjera', ...extra })]) },
    })).find((r) => r.kind === 'closure')!;
    expect(closure({ brief: 'Zatvoren kolnik Ilice između Frankopanske i Britanskog trga zbog radova na vodovodu' }))
      .toMatchObject({ sub: 'Zatvoren kolnik Ilice između Frankopanske i Britanskog trga zbog radova na vodovodu', subShort: 'zatvoreno zbog radova, oba smjera' });
    expect(closure({})).not.toHaveProperty('subShort');
    expect(closure({})).not.toHaveProperty('titleShort');
  });
  it('shorterLabel: the first whole candidate shorter than the label, never an ellipsis, else nothing', () => {
    expect(shorterLabel('Gradsko dramsko kazalište Gavella', [undefined, '', 'Gavella…', 'Gavella'])).toBe('Gavella');
    expect(shorterLabel('Gavella', ['Gradsko dramsko kazalište Gavella', 'Gavella'])).toBeUndefined();
    expect(shorterLabel('Trg bana Josipa Jelačića', ['  Trg bana   J. Jelačića ', 'Trg'])).toBe('Trg bana J. Jelačića');
  });
  it('offers none for the rows with no shorter whole label: departures, heritage, openings, the pharmacy; the last and first trams shorten only their line list', () => {
    const rows = [
      ...selectNearby(input(at('2026-09-22T19:30:00Z'))),
      ...selectNearby(input(at('2026-09-22T20:40:00Z'))),
      ...selectNearby(input(at('2026-09-23T01:00:00Z'))),
      ...selectNearby(input(at('2026-09-22T10:40:00Z'), { city: { ...CITY, streets: [] } })),
    ];
    for (const r of rows.filter((x) => ['departure', 'always', 'last', 'first', 'opening', 'pharmacy', 'solar'].includes(x.kind) && !x.id.startsWith('always:story:'))) {
      expect(r.titleShort, r.id).toBeUndefined();
      // A promise row's twin is the next two lines of its own list (lane-w-fix8), nothing else has one.
      if (r.kind === 'last' || r.kind === 'first') expect(r.subShort === undefined || r.sub.startsWith(r.subShort), r.id).toBe(true);
      else expect(r.subShort, r.id).toBeUndefined();
    }
    expect(rows.some((r) => r.kind === 'last')).toBe(true);
    expect(rows.some((r) => r.id.startsWith('always:heritage:'))).toBe(true);
  });
});

describe('the head and the row budget', () => {
  it('prints the measured circle with the owner’s words', () => {
    expect(nearbyHead(hr, 2000)).toBe('U blizini · 2 km · ~15 min');
    expect(nearbyHead(hr, 2170)).toBe('U blizini · 2,2 km · ~16 min');
    expect(nearbyPill(hr, 2170)).toBe('2,2 km · ~16 min');
    expect(nearbyHead(en, 2170)).toBe('Nearby · 2.2 km · ~16 min');
  });
  it('rowBudget: 600/3 → 92 px (6 fit), 600/12 → 64 px (9 fit), an unbounded list shows every row', () => {
    expect(rowBudget(600, 3)).toEqual({ rowPx: 92, rows: 6 });
    expect(rowBudget(600, 12)).toEqual({ rowPx: 64, rows: 9 });
    expect(rowBudget(Number.POSITIVE_INFINITY, 11)).toEqual({ rowPx: 64, rows: 11 });
  });
});
