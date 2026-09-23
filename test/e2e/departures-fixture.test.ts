import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Page } from '@playwright/test';
import { departuresBoard, gtfsSeconds, lastRunSnapshot, serviceDays } from '../../e2e/departures-fixture';
import { FIXTURE_PHARMACY_ADDRESSES, FIXTURE_STOP, installKioskFeedFixture } from '../../e2e/experience-fixtures';
import { CITY_VENUE } from '../../e2e/city-fixtures';
import { SCENES, SCENE_IDS } from '../../e2e/scenes';
import { scheduleInstant } from '../../worker/city/schedules';
import { emptyCity } from '../../shared/city/types';
import { selectNearby } from '../../app/src/city/nearby';
import { loadLastRun } from '../../app/src/core/lastrun';
import { createDefaultI18n } from '../../app/src/i18n/create-default-i18n';
import { vehicleFixes } from '../../app/src/motion/fixes';
import type { FeedItem } from '../../worker/feed/schema';

const MIN = 60_000;
const PLATFORMS = ['106_1', '106_2', '1849_23', '1849_24'] as const;
const DAY_ROUTES = ['1', '6', '11', '12', '13', '14', '17'];
const data = (path: string) => JSON.parse(readFileSync(new URL(`../../app/public/data/${path}`, import.meta.url), 'utf8'));
const tables = Object.fromEntries(PLATFORMS.map((id) => [id, data(`lastrun/${id}.json`)]));
const trips = data('zet-trips.json');
const network = data('zet-network.json');
const i18n = createDefaultI18n('hr');
// Only register the fixture routes. No browser, server or external request.
const page = { route: async () => {} } as unknown as Page;

describe('departures fixture realism', () => {
  it.each(PLATFORMS)('%s keeps timetable ids and times across polls, including a reconstructed options object', (stopId) => {
    const now = SCENES.outage0800.now;
    const first = departuresBoard({ now, stopId });
    for (let minutes = 1; minutes <= 10; minutes++) {
      const later = departuresBoard({ now: now + minutes * MIN, stopId });
      const old = first.departures.filter((d) => Date.parse(d.at) >= now + minutes * MIN);
      expect(later.departures.slice(0, old.length)).toEqual(old);
      expect(later.departures.every((d) => Date.parse(d.at) >= now + minutes * MIN)).toBe(true);
    }
  });

  it('removes a passed departure instead of moving the same trip into the future', () => {
    const now = SCENES.peak1745.now;
    const first = departuresBoard({ now });
    const departed = first.departures[0];
    const later = departuresBoard({ now: Date.parse(departed.at) + 1 });
    expect(later.departures.some((d) => d.tripId === departed.tripId)).toBe(false);
    expect(later.departures.slice(0, 11)).toEqual(first.departures.slice(1));
  });

  it('anchors tracked trips once per scene, expires them and never borrows them for the opposite platform', () => {
    const now = SCENES.morning0745.now;
    const vehicles: Pick<FeedItem, 'id' | 'data'>[] = [
      { id: 'vehicle:a', data: { tripId: 'scene-12', routeId: '12' } },
      { id: 'vehicle:b', data: { tripId: 'scene-6', routeId: '6' } },
    ];
    const first = departuresBoard({ now, vehicles });
    const tracked = first.departures.filter((d) => d.tripId.startsWith('scene-'));
    expect(tracked).toHaveLength(2);
    for (const minutes of [1, 3, 9, 11]) {
      const later = departuresBoard({ now: now + minutes * MIN, vehicles });
      expect(later.departures.filter((d) => d.tripId.startsWith('scene-')))
        .toEqual(tracked.filter((d) => Date.parse(d.at) >= now + minutes * MIN));
    }
    expect(departuresBoard({ now, stopId: '106_2', vehicles }).departures.some((d) => d.tripId.startsWith('scene-'))).toBe(false);
  });

  it.each(SCENE_IDS)('%s retains the spec-required rows in the real merged selection at its pinned clock', async (id) => {
    const scene = SCENES[id];
    const { now } = scene;
    const snapshots = await installKioskFeedFixture(page, scene.feedState, { now });
    const vehicles = snapshots['zet-rt'].items;
    const boards = PLATFORMS.map((stopId) => departuresBoard({ now, stopId, vehicles }));
    const file = lastRunSnapshot(FIXTURE_STOP.id, serviceDays(now));
    const lastRun = await loadLastRun(`selection-${id}`, (async () => new Response(JSON.stringify(file))) as typeof fetch, now);
    const rows = selectNearby({
      place: { ...FIXTURE_STOP, kind: 'tram', stopId: FIXTURE_STOP.id }, radiusM: 2000, now,
      boards, fixes: vehicleFixes(snapshots['zet-rt'], now), snapshots,
      city: { ...emptyCity(), places: [CITY_VENUE] }, lastRun, locale: 'hr', i18n,
    });
    const departures = rows.filter((r) => r.kind === 'departure');
    expect(departures.length).toBeGreaterThanOrEqual(1);
    expect(departures.length).toBeLessThanOrEqual(3);
    expect(new Set(departures.map((r) => `${r.arrival!.routeId}/${r.title}/${r.atMs}`)).size).toBe(departures.length);
    for (const kind of scene.expect.requiredKinds) expect(rows.some((r) => r.kind === kind), kind).toBe(true);
    for (const kind of scene.expect.noPastKinds) expect(rows.filter((r) => r.kind === kind).every((r) => r.atMs! >= now), kind).toBe(true);
    expect(rows.filter((r) => r.kind === 'solar').length).toBeGreaterThanOrEqual(scene.expect.solarMin);
    expect(rows.filter((r) => r.kind === 'solar').length).toBeLessThanOrEqual(1);
    expect(departures.filter((r) => r.live).length).toBeGreaterThanOrEqual(scene.expect.liveMin);
    if (scene.expect.liveMax !== null) expect(rows.filter((r) => r.live).length).toBeLessThanOrEqual(scene.expect.liveMax);
    if (scene.expect.departuresAsClockTimes) {
      expect(departures.every((r) => !r.live && r.source === 'zet-gtfs' && Number.isFinite(r.atMs))).toBe(true);
    }
    if (['afterLast0045', 'night0430', 'lastTrams2240'].includes(id)) {
      const firstRoute = id === 'night0430' ? '1' : '12';
      expect(rows.find((r) => r.kind === 'first')?.services?.[0]).toEqual({
        routeId: firstRoute, routeName: firstRoute,
        atMs: scheduleInstant('2026-09-22', gtfsSeconds(tables['106_1'].first[firstRoute]['2026-09-22'])),
      });
      const last = rows.filter((r) => r.kind === 'last');
      expect(last).toHaveLength(id === 'lastTrams2240' ? 1 : 0);
      if (last.length) expect(last[0].services).toEqual(
        DAY_ROUTES.map((routeId) => ({
          routeId, routeName: routeId,
          atMs: scheduleInstant('2026-09-21', gtfsSeconds(tables['106_1'].routes[routeId]['2026-09-21'])),
        })).sort((a, b) => a.atMs - b.atMs),
      );
      const pharmacy = rows.find((r) => r.kind === 'pharmacy');
      expect(pharmacy).toMatchObject({ title: '24/7', always: true, live: false });
      expect(FIXTURE_PHARMACY_ADDRESSES).toContain(pharmacy?.sub);
    }
  });

  it('anchors tracked departures to the stamped scene even when its first board poll is late', async () => {
    const now = SCENES.morning0745.now;
    const snapshots = await installKioskFeedFixture(page, 'ready', { now });
    const vehicles = snapshots['zet-rt'].items;
    const onTime = departuresBoard({ now, vehicles });
    for (const elapsed of [1000, MIN, 3 * MIN, 9 * MIN, 11 * MIN]) {
      // Independent array: do not accidentally prime the weak cache for the late poll.
      const late = departuresBoard({ now: now + elapsed, vehicles: [...vehicles] });
      const remaining = onTime.departures.filter((d) => Date.parse(d.at) >= now + elapsed);
      expect(late.departures.slice(0, remaining.length)).toEqual(remaining);
    }
  });

  it('never hides a committed first tram to make room for tracked fixture slots', () => {
    const now = SCENES.night0430.now;
    const vehicles: Pick<FeedItem, 'id' | 'data'>[] = [
      { id: 'vehicle:a', data: { tripId: 'scene-12', routeId: '12' } },
      { id: 'vehicle:b', data: { tripId: 'scene-17', routeId: '17' } },
    ];
    const board = departuresBoard({ now, vehicles });
    expect(board.departures.filter((d) => d.tripId.startsWith('scene-'))).toHaveLength(2);
    expect(board.departures).toContainEqual(expect.objectContaining({
      routeId: '1', at: new Date(scheduleInstant('2026-09-22', gtfsSeconds('04:33'))).toISOString(),
    }));
  });

  it.each(PLATFORMS)('%s uses its own committed lines, headsigns and service windows', (stopId) => {
    for (const id of SCENE_IDS) {
      const now = SCENES[id].now;
      const board = departuresBoard({ now, stopId });
      if (stopId === '1849_24') {
        expect(tables[stopId].routes).toEqual({});
        expect(board.departures).toEqual([]);
        continue;
      }
      expect(board.departures).toHaveLength(12);
      for (const departure of board.departures) {
        const routeId = departure.routeId;
        expect(Object.keys(tables[stopId].routes)).toContain(routeId);
        expect(network.routes.id).toContain(routeId);
        const p = trips.patterns;
        // Patterns prove this platform reaches that terminus; the network
        // supplies its rendered name, not GTFS's abbreviated trip_headsign.
        const heads = p.stops.flatMap((stops: string[], i: number) =>
          p.route[i] === routeId && stops.includes(stopId)
            ? [network.stops.name[network.stops.id.indexOf(stops.at(-1))]] : []);
        expect(heads).toContain(departure.headsign);
        const at = Date.parse(departure.at);
        expect(serviceDays(now, 1, 2).some((day) =>
          tables[stopId].first[routeId]?.[day] &&
          at >= scheduleInstant(day, gtfsSeconds(tables[stopId].first[routeId][day])) &&
          at <= scheduleInstant(day, gtfsSeconds(tables[stopId].routes[routeId][day])),
        )).toBe(true);
      }
    }
  });

  it.each(['afterLast0045', 'outage0800'] as const)('%s has three distinct line/headsign/time rows across the platforms', (scene) => {
    const now = SCENES[scene].now;
    const rows = PLATFORMS.flatMap((stopId) => departuresBoard({ now, stopId }).departures)
      .sort((a, b) => Date.parse(a.at) - Date.parse(b.at)).slice(0, 3);
    expect(new Set(rows.map((d) => `${d.routeId}/${d.headsign}/${d.at}`)).size).toBe(3);
  });

  it('returns every real first daytime tram in 106_1, including line 1, and retains explicit overrides', () => {
    const file = lastRunSnapshot('106_1', ['2026-09-21', '2026-09-22']);
    const expected = { '12': '04:13', '17': '04:24', '1': '04:33', '11': '04:51', '6': '04:57', '14': '05:11', '13': '05:27' };
    expect(Object.keys(file.first!)).toEqual(DAY_ROUTES);
    for (const [route, time] of Object.entries(expected)) {
      expect(file.first![route]['2026-09-21']).toBe(time);
      expect(file.first![route]).toEqual({ '2026-09-21': tables['106_1'].first[route]['2026-09-21'], '2026-09-22': time });
    }
    expect(lastRunSnapshot('106_1', ['2026-09-21'], { routes: ['6'], firstTram: '05:00' }).first)
      .toEqual({ '6': { '2026-09-21': '05:00' } });
    expect(lastRunSnapshot('106_1', ['2026-09-21'], { withFirst: false }).first).toBeUndefined();
  });

  it.each(PLATFORMS)('%s last-run dates follow the committed table, including weekends and non-operating lines', (stopId) => {
    const days = ['2026-09-21', '2026-09-26', '2026-09-27'];
    const file = lastRunSnapshot(stopId, days);
    for (const field of ['routes', 'first'] as const) {
      for (const [route, dates] of Object.entries(file[field]!)) {
        expect(dates).toEqual(Object.fromEntries(days.flatMap((day) =>
          tables[stopId][field][route]?.[day] ? [[day, tables[stopId][field][route][day]]] : [])));
      }
    }
  });
});
