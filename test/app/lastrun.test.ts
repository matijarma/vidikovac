import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { firstDeparture, firstDepartureOn, lastDeparture, lastRunExpired, loadLastRun, type LastRunRoutes, type LastRunSnapshot } from '../../app/src/core/lastrun';
import { lastRunProducer } from '../../app/src/experience/producers';
import { bucketOf, columnsFor } from '../../app/src/experience/timeband';
import { createDefaultI18n } from '../../app/src/i18n/create-default-i18n';
import { zagrebDayKey, zagrebHour, zagrebTime } from '../../app/src/format';

// The last scheduled departure per line from the screen's stop (plan A.6, D7,
// Task T3.1): one static JSON per stop, written by scripts/gtfs-lastrun.mjs
// from ZET's GTFS and fetched once per session. The table is keyed by GTFS
// *service date* and keeps GTFS's own clock, in which a service day runs past
// 24:00 ("24:15" on Friday is Saturday 00:15); the loader turns that into an
// instant here, so a Saturday whose own service ends before midnight never
// collides with Friday's departure that rolled into it.

const at = (iso: string): number => Date.parse(iso);
const FRI_AFTERNOON = at('2026-09-11T12:32:00Z'); // Fri 11. 9. 14:32 CEST: the unit fixture
const SAT_0010 = at('2026-09-11T22:10:00Z');      // Sat 12. 9. 00:10 CEST: yesterday's service still rolling

function live(routes: LastRunRoutes, validUntil = '2026-09-13T22:30:00Z', first?: LastRunRoutes): LastRunSnapshot {
  return { status: 'live', fetchedAt: '2026-09-11T12:00:00Z', sourceUpdatedAt: '2026-09-10T03:00:00Z', validUntil, routes, ...(first ? { first } : {}) };
}

const TABLE: LastRunRoutes = {
  '6': { '2026-09-11': '24:15', '2026-09-12': '24:20' },
  '11': { '2026-09-11': '24:05', '2026-09-12': '23:50' },
  '12': { '2026-09-12': '23:40' },
  '17': { '2026-09-11': '23:53' },
};

describe('lastDeparture: the current service day’s last departure ahead of now', () => {
  it('Fri 14:32: a departure written "24:15" on Friday’s service date is Saturday 00:15', () => {
    expect(lastDeparture(live(TABLE), '6', FRI_AFTERNOON)).toEqual({ at: at('2026-09-11T22:15:00Z') });
    expect(lastDeparture(live(TABLE), '17', FRI_AFTERNOON)).toEqual({ at: at('2026-09-11T21:53:00Z') });
  });
  it('Sat 00:10: yesterday’s entry wins while its rolled time is still ahead', () => {
    expect(lastDeparture(live(TABLE), '6', SAT_0010)).toEqual({ at: at('2026-09-11T22:15:00Z') });
  });
  it('Sat 00:10: once yesterday’s rolled departure has left, today’s service date answers', () => {
    expect(lastDeparture(live(TABLE), '11', SAT_0010)).toEqual({ at: at('2026-09-12T21:50:00Z') });
    expect(lastDeparture(live(TABLE), '12', SAT_0010)).toEqual({ at: at('2026-09-12T21:40:00Z') });
  });
  it('is null for a line whose service day has no departure left and no entry today, and for a line the stop does not know', () => {
    expect(lastDeparture(live(TABLE), '17', SAT_0010)).toBeNull();
    expect(lastDeparture(live(TABLE), '99', FRI_AFTERNOON)).toBeNull();
  });
  it('is null once validUntil has passed, on a down snapshot and without a snapshot', () => {
    expect(lastDeparture(live(TABLE, '2026-09-11T12:00:00Z'), '6', FRI_AFTERNOON)).toBeNull();
    expect(lastDeparture(live(TABLE, 'never'), '6', FRI_AFTERNOON)).toBeNull();
    expect(lastDeparture({ status: 'down', fetchedAt: '2026-09-11T12:00:00Z' }, '6', FRI_AFTERNOON)).toBeNull();
    expect(lastDeparture(null, '6', FRI_AFTERNOON)).toBeNull();
    expect(lastDeparture(undefined, '6', FRI_AFTERNOON)).toBeNull();
  });
  it('ignores an entry whose time is not GTFS HH:MM', () => {
    expect(lastDeparture(live({ '6': { '2026-09-11': 'kasno' } }), '6', FRI_AFTERNOON)).toBeNull();
  });
  it('counts GTFS hours from noon minus twelve, so "27:30" on the night the clocks fall back is 02:30 CET, not 03:30', () => {
    const snapshot = live({ '31': { '2026-10-24': '27:30' } }, '2026-10-26T00:00:00Z');
    const result = lastDeparture(snapshot, '31', at('2026-10-24T21:00:00Z')); // Sat 24. 10. 23:00 CEST
    expect(result).toEqual({ at: at('2026-10-25T01:30:00Z') });
    expect(zagrebTime(result!.at)).toBe('02:30');
  });
  it('reads a winter service date in CET: "24:10" on 15. 1. is 16. 1. 00:10 CET', () => {
    const snapshot = live({ '6': { '2026-01-15': '24:10' } }, '2026-01-17T00:00:00Z');
    expect(lastDeparture(snapshot, '6', at('2026-01-15T19:00:00Z'))).toEqual({ at: at('2026-01-15T23:10:00Z') });
  });
});

// The first departure of the morning (WP1 step 1): the same service-date table, earliest per day.
const FIRST: LastRunRoutes = {
  '6': { '2026-09-11': '04:20', '2026-09-12': '04:16', '2026-09-13': '05:02' },
  '11': { '2026-09-12': '04:40' },
  '31': { '2026-09-11': '24:23' }, // a night tram: its service day starts after midnight
};
const FRI_2240 = at('2026-09-11T20:40:00Z'); // Fri 11. 9. 22:40 CEST

describe('firstDeparture: the next morning’s first departure ahead of now', () => {
  it('Fri 22:40: Friday’s 04:20 has left, so Saturday’s service date answers with 04:16', () => {
    expect(firstDeparture(live(TABLE, undefined, FIRST), '6', FRI_2240)).toEqual({ at: at('2026-09-12T02:16:00Z') });
    expect(zagrebTime(firstDeparture(live(TABLE, undefined, FIRST), '6', FRI_2240)!.at)).toBe('04:16');
  });
  it('Sat 00:10: the same day’s 04:16 is still ahead', () => {
    expect(firstDeparture(live(TABLE, undefined, FIRST), '6', SAT_0010)).toEqual({ at: at('2026-09-12T02:16:00Z') });
    expect(firstDeparture(live(TABLE, undefined, FIRST), '11', SAT_0010)).toEqual({ at: at('2026-09-12T02:40:00Z') });
  });
  it('Sat 04:17: once it has left, the next service date’s first departure answers', () => {
    expect(firstDeparture(live(TABLE, undefined, FIRST), '6', at('2026-09-12T02:17:00Z'))).toEqual({ at: at('2026-09-13T03:02:00Z') });
    expect(firstDeparture(live(TABLE, undefined, FIRST), '11', at('2026-09-12T02:41:00Z'))).toBeNull(); // no Sunday entry
  });
  it('is null without a first table, for an unknown line, past validUntil and on a down snapshot', () => {
    expect(firstDeparture(live(TABLE), '6', FRI_2240)).toBeNull();
    expect(firstDeparture(live(TABLE, undefined, FIRST), '99', FRI_2240)).toBeNull();
    expect(firstDeparture(live(TABLE, '2026-09-11T20:00:00Z', FIRST), '6', FRI_2240)).toBeNull();
    expect(firstDeparture({ status: 'down', fetchedAt: '2026-09-11T12:00:00Z' }, '6', FRI_2240)).toBeNull();
    expect(firstDeparture(null, '6', FRI_2240)).toBeNull();
  });
  it('firstDepartureOn reads one service date in GTFS hours, whatever the clock says', () => {
    expect(firstDepartureOn(live(TABLE, undefined, FIRST), '6', '2026-09-11')).toEqual({ at: at('2026-09-11T02:20:00Z') });
    expect(firstDepartureOn(live(TABLE, undefined, FIRST), '31', '2026-09-11')).toEqual({ at: at('2026-09-11T22:23:00Z') }); // Sat 00:23
    expect(firstDepartureOn(live(TABLE, undefined, FIRST), '11', '2026-09-11')).toBeNull();
    expect(firstDepartureOn(live(TABLE), '6', '2026-09-11')).toBeNull();
  });
});

describe('loadLastRun: the stop’s file, once per stop', () => {
  const FILE = { generatedAt: '2026-09-10T03:00:00Z', validUntil: '2026-10-02T01:30:00Z', source: 'ZET GTFS', routes: TABLE };
  const answer = (status: number, body: string | null = JSON.stringify(FILE)) => async () => new Response(body, { status, headers: { 'content-type': 'application/json' } });
  const asFetch = (fn: unknown): typeof fetch => fn as typeof fetch;

  it('maps the file to a live snapshot: generatedAt is the source’s time, fetchedAt is the loader’s own', async () => {
    const fetchImpl = vi.fn(answer(200));
    const before = Date.now();
    const snapshot = await loadLastRun('106_1', asFetch(fetchImpl));
    expect(fetchImpl).toHaveBeenCalledWith('/data/lastrun/106_1.json');
    expect(snapshot).toMatchObject({ status: 'live', sourceUpdatedAt: '2026-09-10T03:00:00Z', validUntil: '2026-10-02T01:30:00Z', routes: TABLE });
    const fetchedAt = Date.parse((snapshot as { fetchedAt: string }).fetchedAt);
    expect(fetchedAt).toBeGreaterThanOrEqual(before);
    expect(fetchedAt).toBeLessThanOrEqual(Date.now());
  });
  it('caches a live answer per stop: the second call fetches nothing', async () => {
    const fetchImpl = vi.fn(answer(200));
    const first = await loadLastRun('200_1', asFetch(fetchImpl));
    const second = await loadLastRun('200_1', asFetch(fetchImpl));
    expect(second).toBe(first);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it('encodes the stop id in the path', async () => {
    const fetchImpl = vi.fn(answer(200));
    await loadLastRun('a b/c', asFetch(fetchImpl));
    expect(fetchImpl).toHaveBeenCalledWith('/data/lastrun/a%20b%2Fc.json');
  });
  it('answers null for a stop without a file (404) and remembers that too', async () => {
    const fetchImpl = vi.fn(answer(404, ''));
    expect(await loadLastRun('300_1', asFetch(fetchImpl))).toBeNull();
    expect(await loadLastRun('300_1', asFetch(fetchImpl))).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it('answers down on a server error, a body that is not the file, or a failed request, and does not cache it', async () => {
    const error = vi.fn(answer(500, 'boom'));
    expect(await loadLastRun('400_1', asFetch(error))).toMatchObject({ status: 'down' });
    expect(await loadLastRun('400_1', asFetch(error))).toMatchObject({ status: 'down' });
    expect(error).toHaveBeenCalledTimes(2);

    const garbage = vi.fn(answer(200, '<html>'));
    expect(await loadLastRun('400_2', asFetch(garbage))).toMatchObject({ status: 'down' });
    const shapeless = vi.fn(answer(200, JSON.stringify({ generatedAt: 'x' })));
    expect(await loadLastRun('400_3', asFetch(shapeless))).toMatchObject({ status: 'down' });
    const offline = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    expect(await loadLastRun('400_4', asFetch(offline))).toMatchObject({ status: 'down' });
  });
  it('reads the first table when the file carries one and refuses a malformed one', async () => {
    const withFirst = vi.fn(answer(200, JSON.stringify({ ...FILE, first: FIRST })));
    expect(await loadLastRun('700_1', asFetch(withFirst))).toMatchObject({ status: 'live', routes: TABLE, first: FIRST });
    const without = await loadLastRun('700_2', asFetch(vi.fn(answer(200))));
    expect(without && 'first' in without).toBe(false);
    const broken = vi.fn(answer(200, JSON.stringify({ ...FILE, first: { '6': { '2026-09-12': 416 } } })));
    expect(await loadLastRun('700_3', asFetch(broken))).toMatchObject({ status: 'down' });
    const notATable = vi.fn(answer(200, JSON.stringify({ ...FILE, first: 'early' })));
    expect(await loadLastRun('700_4', asFetch(notATable))).toMatchObject({ status: 'down' });
  });
  it('recovers after a down answer: the next call fetches again (the kiosk asks an hour later, R-KP23) and caches the live file', async () => {
    const fetchImpl = vi.fn(answer(503, ''));
    const fetched = at('2026-09-11T12:00:00Z');
    expect(await loadLastRun('500_1', asFetch(fetchImpl), fetched)).toMatchObject({ status: 'down' });
    fetchImpl.mockImplementation(answer(200));
    expect(await loadLastRun('500_1', asFetch(fetchImpl), fetched + 3_600_000)).toMatchObject({ status: 'live' });
    expect(await loadLastRun('500_1', asFetch(fetchImpl))).toMatchObject({ status: 'live' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
  it('evicts a live table once its own validUntil has passed, and fetches a fresh one', async () => {
    const before = at('2026-09-11T12:00:00Z');
    const after = at('2026-10-02T01:30:01Z'); // one second past FILE.validUntil below
    const fetchImpl = vi.fn(answer(200));
    const first = await loadLastRun('600_1', asFetch(fetchImpl), before);
    expect(first).toMatchObject({ status: 'live', validUntil: '2026-10-02T01:30:00Z' });
    // Still inside the window: the same promise, no second fetch.
    expect(await loadLastRun('600_1', asFetch(fetchImpl), before)).toBe(first);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const second = await loadLastRun('600_1', asFetch(fetchImpl), after);
    expect(second).not.toBe(first);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
  it('lastRunExpired is true only for a live table past its own validUntil', () => {
    const live = { status: 'live' as const, fetchedAt: '2026-09-11T12:00:00Z', sourceUpdatedAt: '2026-09-10T03:00:00Z', validUntil: '2026-09-13T22:30:00Z', routes: TABLE };
    expect(lastRunExpired(live, at('2026-09-13T22:29:59Z'))).toBe(false);
    expect(lastRunExpired(live, at('2026-09-13T22:30:00Z'))).toBe(true);
    expect(lastRunExpired({ status: 'down', fetchedAt: '2026-09-11T12:00:00Z' }, at('2026-09-13T22:30:00Z'))).toBe(false);
    expect(lastRunExpired(null, at('2026-09-13T22:30:00Z'))).toBe(false);
  });
});

describe('the committed artefact for the fixture stop 106_1 (Trg bana J. Jelačića)', () => {
  const file = JSON.parse(readFileSync(new URL('../../app/public/data/lastrun/106_1.json', import.meta.url), 'utf8')) as { generatedAt: string; validUntil: string; source: string; routes: LastRunRoutes; first: LastRunRoutes };
  const snapshot: LastRunSnapshot = { status: 'live', fetchedAt: file.generatedAt, sourceUpdatedAt: file.generatedAt, validUntil: file.validUntil, routes: file.routes, first: file.first };
  // 14:32 Zagreb on the day the file was generated: inside its window whatever day the script last ran.
  const now = Date.parse(`${zagrebDayKey(file.generatedAt)}T12:32:00Z`);

  it('is the script’s shape and names its source and the fixture lines', () => {
    expect(file.source).toBe('ZET GTFS');
    expect(Date.parse(file.validUntil)).toBeGreaterThan(now);
    for (const line of ['6', '11', '12', '13', '14', '17']) expect(Object.keys(file.routes), line).toContain(line);
    for (const table of [...Object.values(file.routes), ...Object.values(file.first)]) for (const [day, time] of Object.entries(table)) {
      expect(day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(time).toMatch(/^\d{2}:\d{2}$/);
    }
  });
  it('carries the first departure beside the last one for every line and date, never later than it', () => {
    expect(Object.keys(file.first)).toEqual(Object.keys(file.routes));
    for (const [routeId, table] of Object.entries(file.routes)) {
      expect(Object.keys(file.first[routeId]!), routeId).toEqual(Object.keys(table));
      for (const [day, last] of Object.entries(table)) expect(file.first[routeId]![day]! <= last, `${routeId} ${day}`).toBe(true);
    }
  });
  it('at 22:40 on the day the file was generated, the next first tram of line 6 leaves in the small hours of the next morning', () => {
    const late = Date.parse(`${zagrebDayKey(file.generatedAt)}T20:40:00Z`);
    const first = firstDeparture(snapshot, '6', late);
    expect(first).not.toBeNull();
    expect(zagrebDayKey(first!.at)).not.toBe(zagrebDayKey(late));
    expect(zagrebHour(first!.at)).toBeGreaterThanOrEqual(3);
    expect(zagrebHour(first!.at)).toBeLessThan(7);
  });
  it('gives the Sada band two Zadnji polazak tiles in večeras with xs badges, and never the word dolazak', () => {
    const hr = createDefaultI18n('hr');
    const columns = columnsFor(hr, now);
    const tiles = lastRunProducer.produce({ i18n: hr, snapshots: {}, now, lastRun: snapshot }, { columns, surface: 'desktop', bucket: (at, until, allDay) => bucketOf(now, columns, at, until, allDay) });
    expect(tiles).toHaveLength(2);
    for (const tile of tiles) {
      expect(tile.label).toBe('Zadnji polazak');
      expect(tile.context).toBe('po rasporedu · ZET GTFS');
      expect(tile.labelMarkup).toContain('data-size="xs"');
      expect(bucketOf(now, columns, tile.at)).toBe('veceras');
      expect(JSON.stringify(tile).toLowerCase()).not.toContain('dolazak');
    }
  });
});
