// The phone's renderers vet third-party text through the boundary, which refuses everything until the policy is installed: load it here as the page's chunks do.
import '../../shared/kiosk/external-text';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ModuleSnapshot } from '../../worker/feed/schema';
import { createDefaultI18n } from '../../app/src/i18n/create-default-i18n';
import type { VehicleInfo } from '../../app/src/map/city-map';
import { decodeNetwork } from '../../shared/motion/network';
import { fullestShape } from '../../app/src/transport/catalogue';
import type { ArrivalRow, ArrivalsStatus } from '../../shared/city/arrivals';
import { closureDetailMarkup, departureRow, stopDetailMarkup } from '../../app/src/transport/view';
import { closureItems, countByRoute, headingFromBearing, runningRoutes, terminusName, vehicleDirection, vehiclesAtStop, vehiclesOfModes, vehiclesOnRoute, zetNotices } from '../../app/src/transport/detail';

const i18n = createDefaultI18n('hr');
const v = (id: string, routeId: string | undefined, type: number, over: Partial<VehicleInfo> = {}): VehicleInfo => ({
  id, routeId, short: routeId ?? '', kind: type === 0 ? 'tram' : type === 3 ? 'bus' : 'other', type, lon: 15.97, lat: 45.81, bearing: null, confidence: 0.5, held: false, onShape: null, ...over,
});
const FLEET = [v('a', '6', 0), v('b', '6', 0, { bearing: 90, confidence: 0.9 }), v('c', '11', 0), v('d', '109', 3), v('e', undefined, -1)];

describe('what runs now', () => {
  it('lists one row per route with a vehicle moving, trams first, counting and reading the route delay in words where the module has one and nothing where it has none; a vehicle without a route is no row', () => {
    const rows = runningRoutes(FLEET, new Map([['6', 130], ['109', -20]]), i18n);
    expect(rows.map((r) => [r.routeId, r.count, r.word])).toEqual([['6', 2, 'kasni 2 min'], ['11', 1, ''], ['109', 1, 'rani 1 min']]);
  });
  it('filters by GTFS type, on a route and at a stop, and counts per route', () => {
    expect(vehiclesOfModes(FLEET, new Set([0])).map((x) => x.id)).toEqual(['a', 'b', 'c']);
    expect(vehiclesOfModes(FLEET, null)).toHaveLength(5);
    expect(vehiclesOnRoute(FLEET, '6').map((x) => x.id)).toEqual(['a', 'b']);
    expect(vehiclesAtStop(FLEET, { id: 's', ids: ['s'], name: 'S', lon: 0, lat: 0, routes: ['11', '109'] }).map((x) => x.id)).toEqual(['c', 'd']);
    expect([...countByRoute(FLEET)]).toEqual([['6', 2], ['11', 1], ['109', 1]]);
  });
});

describe('which way a vehicle faces', () => {
  const net = decodeNetwork(JSON.parse(readFileSync(resolve(import.meta.dirname, '../../app/public/data/zet-network.json'), 'utf8')));
  it('reads "smjer nepoznat" without a heading, the shape\u2019s terminus with one, and the compass point off the geometry', () => {
    expect(vehicleDirection(i18n, net, v('a', '6', 0))).toBe('smjer nepoznat');
    const shape = fullestShape(net, '6')!;
    const terminus = terminusName(net, shape)!;
    expect(['Črnomerec', 'Sopot']).toContain(terminus);
    expect(vehicleDirection(i18n, net, v('a', '6', 0, { bearing: 90, onShape: shape }))).toBe(`smjer ${terminus}`);
    expect(vehicleDirection(i18n, null, v('a', '6', 0, { bearing: 90 }))).toBe('smjer istok');
    expect(vehicleDirection(i18n, net, v('a', '6', 0, { bearing: 0 }))).toBe('smjer sjever');
  });
  it('turns compass degrees back into a unit heading, x east and y north', () => {
    expect(headingFromBearing(90).x).toBeCloseTo(1);
    expect(headingFromBearing(0).y).toBeCloseTo(1);
    expect(headingFromBearing(180).y).toBeCloseTo(-1);
  });
});

describe('closures and ZET notices', () => {
  const snap = (module: ModuleSnapshot['module'], items: ModuleSnapshot['items']): ModuleSnapshot => ({
    module, tier: 'session', status: 'live', fetchedAt: '2026-09-11T12:00:00Z', attribution: { text: '', url: '', licence: '' }, items,
  });
  it('keeps only ZET\u2019s two feeds from the events module, newest first, capped', () => {
    const events = snap('dogadanja', [
      { id: 'k1', module: 'dogadanja', kind: 'event', tier: 'session', title: 'Koncert', at: '2026-09-12T18:00:00Z', data: { source: 'kulturpunkt' } },
      { id: 'z1', module: 'dogadanja', kind: 'event', tier: 'session', title: 'Izmjena trase 6', at: '2026-09-11T08:00:00Z', data: { source: 'zet-promet' } },
      { id: 'z2', module: 'dogadanja', kind: 'event', tier: 'session', title: 'Novi red vožnje', at: '2026-09-11T10:00:00Z', data: { source: 'zet-novosti' } },
    ]);
    expect(zetNotices(events).map((n) => n.id)).toEqual(['z2', 'z1']);
    expect(zetNotices(events, 1).map((n) => n.id)).toEqual(['z2']);
    expect(zetNotices(undefined)).toEqual([]);
  });
  it('lists closures by kind, whatever their geometry', () => {
    const closures = snap('prometnice', [
      { id: 'c1', module: 'prometnice', kind: 'closure', tier: 'open', title: 'Ilica' },
      { id: 'x', module: 'prometnice', kind: 'poi', tier: 'open', title: 'no' },
    ]);
    expect(closureItems(closures).map((c) => c.id)).toEqual(['c1']);
    expect(closureItems(undefined)).toEqual([]);
  });
});

describe('the stop sheet says what comes next, first', () => {
  const STOP = { id: '106', ids: ['106_1', '106_2', '106_3'], name: 'Kvaternikov trg', lon: 15.99, lat: 45.81, routes: ['11'] };
  const ROUTES = [{ id: '11', short: '11', long: 'Črnomerec - Dubec', type: 0 }];
  const NOW = Date.parse('2026-09-19T10:00:00Z');
  const row = (over: Partial<ArrivalRow> = {}): ArrivalRow => ({
    tripId: 't1', routeId: '11', routeName: '11', headsign: 'Dubec', atMs: NOW + 3 * 60_000, live: true, minutes: 3, ...over,
  });
  const stop = (arrivals: ArrivalRow[], arrivalsStatus: ArrivalsStatus = 'live', frozenAt?: number): string =>
    stopDetailMarkup(i18n, { stop: STOP, routes: ROUTES, counts: new Map([['11', 2]]), delays: new Map(), isScreenStop: false, kiosk: false, arrivals, arrivalsStatus, frozenAt });

  /** One row's own markup, by its trip id. */
  const rowOf = (html: string, tripId: string): string => html.split(`data-key="${tripId}|`)[1]!.split('</li>')[0]!;

  it('puts the arrivals section above the platform count and the lines, with a live countdown, a clock row and one note', () => {
    const html = stop([
      row({ tripId: 't0', atMs: NOW + 20_000, minutes: 0 }),
      row(),
      row({ tripId: 't2', headsign: 'Črnomerec', atMs: Date.parse('2026-09-19T10:24:00Z'), live: false, minutes: null }),
    ]);
    // First under the head: before "3 perona" and before the lines list.
    expect(html.indexOf('data-testid="stop-arrivals"')).toBeGreaterThan(-1);
    expect(html.indexOf('data-testid="stop-arrivals"')).toBeLessThan(html.indexOf('data-testid="stop-meta"'));
    expect(html.indexOf('data-testid="stop-meta"')).toBeLessThan(html.indexOf('data-testid="stop-routes"'));
    // The rows lead under the stop's own name: no heading of their own, and the first is a departure row.
    expect(html).not.toContain('Sljedeći polasci');
    expect(html.indexOf('class="sada-departure"')).toBeLessThan(html.indexOf('data-testid="stop-meta"'));
    expect(html).toContain('sada');
    expect(html).toContain('za 3 min');
    // 10:24 UTC is 12:24 in Zagreb; a clock row is a plain <time> that says nothing live, with no word for its kind [O-27].
    expect(rowOf(html, 't2')).toContain('<time');
    expect(rowOf(html, 't2')).toContain('data-live="false"');
    expect(html).toContain('12:24');
    expect(html.split('vozni red').length - 1).toBe(0);
    expect(html.split('Procjena iz ZET-ovih podataka o vozilima; ostalo po voznom redu.').length - 1).toBe(1);
    expect(html).toContain('aria-label="uživo"');
    expect(html).toContain('Dubec');
    // The retired sentence is gone, and the platform count and lines still stand.
    expect(html).not.toContain('ZET ne objavljuje dolaske');
    expect(html).toContain('3 perona');
  });

  it('draws each row\'s badge in the mode the route table knows even when the stop\'s own route list lacks the route: line 1 at Trg (the stop catalogue predates it) is a tram, never the plain badge a person reads as a bus (round 1 finding F4)', () => {
    const html = stop([
      row({ tripId: 't1', routeId: '1', routeName: '1', headsign: 'Borongaj' }),
      row({ tripId: 't150', routeId: '150', routeName: '150', headsign: 'G. Tuškanac' }),
      row({ tripId: 't999', routeId: '999', routeName: '999', headsign: 'Nigdje' }),
    ]);
    expect(rowOf(html, 't1')).toContain('data-kind="tram"');
    expect(rowOf(html, 't150')).toContain('data-kind="bus"');
    expect(rowOf(html, 't999')).toContain('data-kind="other"');
  });

  it('a timetable row on the next Zagreb day says "sutra" under its clock, so 04:31 read at 19:00 is not today\'s (round 1 finding F12); a row today carries no day word, and a board without a clock of its own prints none', () => {
    const kindOf = (): 'tram' => 'tram';
    const tomorrow = row({ tripId: 'tm', atMs: Date.parse('2026-09-20T02:31:00Z'), live: false, minutes: null });
    const today = row({ tripId: 'td', atMs: Date.parse('2026-09-19T21:24:00Z'), live: false, minutes: null });
    const withNow = departureRow(i18n, tomorrow, kindOf, undefined, 'timetable', NOW);
    expect(withNow).toContain('04:31');
    expect(withNow).toContain('<span class="t-eta-day">sutra</span>');
    // The text a reader or a copy takes has a space between the clock and the day (review of round 1, note 4).
    const etaText = (/class="t-eta"[^>]*>(.*)$/.exec(withNow)?.[1] ?? '').replace(/<[^>]+>/g, '');
    expect(etaText.startsWith('04:31 sutra')).toBe(true);
    expect(departureRow(i18n, today, kindOf, undefined, 'timetable', NOW)).not.toContain('t-eta-day');
    expect(departureRow(i18n, tomorrow, kindOf, undefined, 'timetable')).not.toContain('t-eta-day');
    // The stop sheet passes the page's clock through StopDetailData.now: its "Vozni red" tail says the day too.
    const html = stopDetailMarkup(i18n, { stop: STOP, routes: ROUTES, counts: new Map(), delays: new Map(), isScreenStop: false, kiosk: false, arrivals: [row(), tomorrow], arrivalsStatus: 'live', now: NOW });
    expect(rowOf(html, 'tm')).toContain('t-eta-day');
    expect(rowOf(html, 't1')).not.toContain('t-eta-day');
  });

  it('never says no vehicle is moving above a live row: a line the stop\'s own route list lacks still has its tram (round 1, desktop F10)', () => {
    const html = stopDetailMarkup(i18n, { stop: STOP, routes: ROUTES, counts: new Map(), delays: new Map(), isScreenStop: false, kiosk: false, arrivals: [row({ routeId: '1', routeName: '1', headsign: 'Borongaj', live: true, minutes: 4 })], arrivalsStatus: 'live' });
    expect(html).not.toContain('nije u pokretu');
    expect(html).not.toContain('data-testid="stop-moving"');
    const quiet = stopDetailMarkup(i18n, { stop: STOP, routes: ROUTES, counts: new Map(), delays: new Map(), isScreenStop: false, kiosk: false, arrivals: [row({ live: false, minutes: null })], arrivalsStatus: 'live' });
    expect(quiet).toContain('nije u pokretu');
  });

  it('counts down for every row inside the horizon, whatever stands behind it, and keeps the clock for the rest', () => {
    const html = stop([
      row({ tripId: 'near', headsign: 'Črnomerec', atMs: NOW + 4 * 60_000, live: false, minutes: 4 }),
      row({ tripId: 'far', headsign: 'Črnomerec', atMs: NOW + 14 * 60_000, live: false, minutes: null }),
      row({ tripId: 'tracked', atMs: NOW + 4 * 60_000, live: true, minutes: 4 }),
    ]);
    // Inside the horizon the question is how long the wait is, and the timetable
    // answers it too: said as a wait, marked as the timetable, with no live dot.
    const near = rowOf(html, 'near');
    expect(near).toContain('12:04');
    expect(near).not.toContain('za 4 min');
    expect(near).toContain('<time');
    expect(near).not.toContain('t-live');
    expect(near).toContain('data-live="false"');
    expect(near).not.toContain('data-live="true"');
    // The same wait with a vehicle behind it: the dot and the live tone.
    const tracked = rowOf(html, 'tracked');
    expect(tracked).toContain('za 4 min');
    expect(tracked).toContain('data-live="true"');
    expect(tracked).toContain('aria-label="uživo"');
    expect(tracked).not.toContain('vozni red');
    // Beyond it a countdown would be a guess dressed as a fact: 10:14 UTC is 12:14 in Zagreb.
    const far = rowOf(html, 'far');
    expect(far).toContain('12:14');
    expect(far).not.toContain('za 1');
    expect(far).toContain('data-live="false"');
    expect(far).not.toContain('vozni red');
  });

  it('labels a row beyond the horizon too: a tracked clock keeps the live dot, a timetable clock keeps the mark', () => {
    // The clock on a tracked row is the schedule plus ZET's delay, not the
    // timetable moment. Unlabelled it would read as the timetable, and the note
    // under the list would then be saying the wrong thing about it.
    const html = stop([
      row({ tripId: 'farLive', atMs: NOW + 14 * 60_000, live: true, minutes: null }),
      row({ tripId: 'farPlan', headsign: 'Črnomerec', atMs: NOW + 18 * 60_000, live: false, minutes: null }),
    ]);
    const live = rowOf(html, 'farLive');
    expect(live).toContain('12:14');
    expect(live).toContain('class="t-live"');
    expect(live).toContain('aria-label="uživo"');
    expect(live).toContain('data-live="true"');
    expect(live).not.toContain('vozni red');
    const plan = rowOf(html, 'farPlan');
    expect(plan).toContain('12:18');
    expect(plan).toContain('<time');
    expect(plan).toContain('data-live="false"');
    expect(plan).not.toContain('vozni red');
    expect(plan).not.toContain('class="t-live"');
  });

  it('the three lead rows name their kind for the probe (§15.6, §16.4 `[data-kind=departure]`), the "Vozni red" rows their own', () => {
    const one = departureRow(i18n, row(), () => 'tram');
    expect(one.startsWith('<li class="sada-departure" data-kind="departure" ')).toBe(true);
    // Once on the row (the line badge names its mode in its own data-kind: tram, bus).
    expect(one.split('data-kind="departure"')).toHaveLength(2);
    expect(one).not.toContain('data-kind="timetable"');
    expect(departureRow(i18n, row(), () => 'tram', undefined, 'timetable').startsWith('<li class="sada-departure" data-kind="timetable" ')).toBe(true);
    // Twelve trips: the board's probe counts the three that lead it, never the nine of the timetable after them.
    const trips = Array.from({ length: 12 }, (_, i) => row({ tripId: `k${i}`, atMs: NOW + (i + 1) * 5 * 60_000 }));
    const html = stop(trips);
    const kinds = (testid: string): string[] => ((html.split(`data-testid="${testid}"`)[1] ?? '').split('</ul>')[0]!.match(/<li class="sada-departure" data-kind="[a-z]+"/g) ?? []).map((li) => li.slice(li.indexOf('data-kind="') + 11, -1));
    expect(kinds('arrival-rows')).toEqual(['departure', 'departure', 'departure']);
    expect(kinds('timetable-rows')).toEqual(Array(9).fill('timetable'));
    expect(html.split('data-kind="departure"')).toHaveLength(4);
  });

  it('leads with the three departures Sada shows, then "Vozni red" with the rest to the twelfth, then the note once', () => {
    const trips = Array.from({ length: 13 }, (_, i) => row({ tripId: `r${i}`, atMs: NOW + (i + 1) * 5 * 60_000, live: i === 0, minutes: i === 0 ? 5 : null }));
    const html = stop(trips);
    const rowsIn = (testid: string): string[] => (html.split(`data-testid="${testid}"`)[1] ?? '').split('</ul>')[0]!.split('<li ').slice(1);
    expect(rowsIn('arrival-rows')).toHaveLength(3);
    expect(rowsIn('arrival-rows').every((li) => li.startsWith('class="sada-departure"'))).toBe(true);
    // Rows four to twelve under the one timetable word; the thirteenth is not on the sheet.
    expect(rowsIn('timetable-rows')).toHaveLength(9);
    expect(html).not.toContain('data-key="r12|');
    expect(html).toContain('<h4 class="t-head">Vozni red</h4>');
    expect(html.indexOf('data-testid="arrival-rows"')).toBeLessThan(html.indexOf('Vozni red'));
    expect(html.indexOf('Vozni red')).toBeLessThan(html.indexOf('data-testid="timetable-rows"'));
    // One note, after every row and before the platform count.
    const note = 'Procjena iz ZET-ovih podataka o vozilima; ostalo po voznom redu.';
    expect(html.split(note).length - 1).toBe(1);
    expect(html.indexOf('data-testid="timetable-rows"')).toBeLessThan(html.indexOf(note));
    expect(html.indexOf(note)).toBeLessThan(html.indexOf('data-testid="stop-meta"'));
    // Three trips or fewer: no timetable head at all.
    const three = stop(trips.slice(0, 3));
    expect(three).not.toContain('Vozni red');
    expect(three).not.toContain('timetable-rows');
    expect(stopDetailMarkup(createDefaultI18n('en'), { stop: STOP, routes: ROUTES, counts: new Map(), delays: new Map(), isScreenStop: false, kiosk: false, arrivals: trips, arrivalsStatus: 'live' })).toContain('<h4 class="t-head">Timetable</h4>');
  });

  it('"Vozni red" is the timetable: the caller\'s scheduled rows when it has them, else the later trips as their clock, never a live estimate (WP4 review)', () => {
    // Five tracked trips inside the horizon: three lead with their countdown, the two under "Vozni red" are clocks.
    const tracked = Array.from({ length: 5 }, (_, i) => row({ tripId: `v${i}`, atMs: NOW + (i + 1) * 2 * 60_000, live: true, minutes: (i + 1) * 2 }));
    const html = stop(tracked);
    const tail = html.split('data-testid="timetable-rows"')[1]!.split('</ul>')[0]!;
    expect(tail.split('<li ').length - 1).toBe(2);
    expect(tail).not.toContain('data-live="true"');
    expect(tail).not.toContain('class="t-live"');
    expect(tail).not.toMatch(/za \d+ min/);
    expect(tail.split('<time ').length - 1).toBe(2);
    const lead = html.split('data-testid="arrival-rows"')[1]!.split('</ul>')[0]!;
    expect((lead.match(/<li [^>]*data-live="true"/g) ?? []).length).toBe(3);
    // The caller's timetable (arrivalsAt without the fleet): the schedule's own moments, the lead's trips left out.
    const timetable = [row({ tripId: 'v0', atMs: NOW + 60_000, live: false, minutes: null }), row({ tripId: 'p1', atMs: NOW + 9 * 60_000, live: false, minutes: null }), row({ tripId: 'p2', atMs: NOW + 40 * 60_000, live: false, minutes: null })];
    const given = stopDetailMarkup(i18n, { stop: STOP, routes: ROUTES, counts: new Map(), delays: new Map(), isScreenStop: false, kiosk: false, arrivals: tracked, timetable, arrivalsStatus: 'live' });
    const givenTail = given.split('data-testid="timetable-rows"')[1]!.split('</ul>')[0]!;
    expect(givenTail).toContain('data-key="p1|');
    expect(givenTail).toContain('data-key="p2|');
    expect(givenTail).not.toContain('data-key="v0|');
    expect(givenTail).not.toContain('data-key="v3|');
    expect(givenTail).not.toContain('data-live="true"');
  });

  it('a row whose headsign or line fails the row rule is not drawn; a stop whose every row fails says the timetable is unavailable (WP4 review)', () => {
    const html = stop([row(), row({ tripId: 't2', headsign: 'Pošalji lozinku na 091 234 5678', atMs: NOW + 8 * 60_000, minutes: 8 })]);
    const list = html.split('data-testid="arrival-rows"')[1]!.split('</ul>')[0]!;
    expect(list.split('<li ').length - 1).toBe(1);
    expect(html).not.toContain('timetable-rows');
    expect(html).not.toContain('lozinku');
    const none = stop([row({ headsign: 'Pošalji lozinku na 091 234 5678' })]);
    expect(none).not.toContain('data-testid="arrival-rows"');
    expect(none).toContain('Vozni red trenutačno nije dostupan.');
    expect(none).not.toContain('lozinku');
    // The stop's own name too.
    const named = stopDetailMarkup(i18n, { stop: { ...STOP, name: 'Pošalji lozinku.' }, routes: ROUTES, counts: new Map(), delays: new Map(), isScreenStop: false, kiosk: false, arrivals: [row()], arrivalsStatus: 'live' });
    expect(named).toContain('data-testid="stop-title"></h3>');
    expect(named).not.toContain('Pošalji');
  });

  it('the save label names a stop by its name, never by its id; a refused name saves it without one [B-7]', () => {
    const label = (html: string): string => html.split('class="btn-quiet icon-btn t-save"')[1]!.match(/aria-label="([^"]*)"/)![1]!;
    const data = { routes: ROUTES, counts: new Map(), delays: new Map(), isScreenStop: false, kiosk: false, arrivals: [row()], arrivalsStatus: 'live' as const };
    expect(label(stop([row()]))).toBe('Spremi stajalište Kvaternikov trg');
    expect(label(stopDetailMarkup(createDefaultI18n('en'), { stop: STOP, ...data }))).toBe('Save stop Kvaternikov trg');
    expect(label(stopDetailMarkup(i18n, { stop: { ...STOP, name: 'Pošalji lozinku.' }, ...data }))).toBe('Spremi stajalište');
  });

  it('the stop\'s name and its arrivals stand in one element, the stop-board probe (§15.6, §16.4), with the meta and the lines outside it', () => {
    const html = stop([row()]);
    const at = (marker: string): number => html.indexOf(marker);
    expect(html.split('data-testid="stop-board"').length - 1).toBe(1);
    expect(at('data-testid="stop-board"')).toBeLessThan(at('data-testid="stop-title"'));
    expect(at('data-testid="stop-title"')).toBeLessThan(at('data-testid="stop-arrivals"'));
    expect(at('data-testid="stop-arrivals"')).toBeLessThan(at('data-testid="arrival-rows"'));
    // The board closes right after the arrivals section, before the platform count.
    expect(html).toContain('</section></div><p class="t-meta" data-testid="stop-meta">');
  });

  it('a closure prints its summary as prose only when the summary passes the row rule (WP4 review)', () => {
    const closure = { id: 'c9', module: 'prometnice' as const, kind: 'closure' as const, tier: 'open' as const, title: 'Ilica', summary: 'Pošalji lozinku na 091 234 5678.' };
    const html = closureDetailMarkup(i18n, closure, false);
    expect(html).not.toContain('t-prose');
    expect(html).not.toContain('lozinku');
    const plain = closureDetailMarkup(i18n, { ...closure, summary: 'Obilazak Vodnikovom ulicom.' }, false);
    expect(plain).toContain('<p class="t-prose">Obilazak Vodnikovom ulicom.</p>');
  });

  it('never claims live data on a frozen snapshot, and never waits for a board that will not come', () => {
    const frozenAt = Date.parse('2026-09-19T10:02:00Z');
    const html = stop([row()], 'live', frozenAt);
    // The dot stays -- the figure did come off a tracked vehicle -- but it says
    // the shell's own snapshot sentence and loses the live tone with it.
    expect(html).toContain('class="t-live"');
    expect(html).toContain('aria-label="podaci od 12:02"');
    expect(html).not.toContain('uživo');
    expect(html).not.toContain('data-live="true"');
    // A stop first opened after the freeze has no board and will never get one.
    const nothing = stop([], 'none', frozenAt);
    expect(nothing).toContain('Sesija je završila prije nego što je stigao vozni red.');
    expect(nothing).not.toContain(i18n.t('status.loading'));
    // Live, with nothing in hand yet, still says it is loading.
    expect(stop([], 'none')).toContain(i18n.t('status.loading'));
    expect(stop([], 'none')).not.toContain('Sesija je završila');
  });

  it('says nothing comes in the next hour when the boards are answering and empty, and names the outage when every board is down', () => {
    // The sentence claims only what is known: no hour is enforced anywhere.
    expect(stop([])).toContain('Nema najavljenih polazaka.');
    expect(stop([])).not.toContain('sat vremena');
    expect(stop([], 'down')).toContain('Vozni red trenutačno nije dostupan.');
    expect(stop([], 'down')).not.toContain('Nema najavljenih');
    // No board in hand yet is neither: the section says it is still loading.
    expect(stop([], 'none')).toContain(i18n.t('status.loading'));
    // The note explains rows; with none it has nothing to explain.
    expect(stop([])).not.toContain('Procjena iz ZET-ovih podataka');
  });
});
