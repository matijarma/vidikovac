import { describe, expect, it } from 'vitest';
import { arrivalsAt, type LiveVehicleRef } from '../../shared/city/arrivals';
import type { DepartureBoard, ScheduledDeparture } from '../../shared/city/types';

const NOW = Date.parse('2026-09-19T10:00:00Z');
const at = (minutes: number): string => new Date(NOW + minutes * 60_000).toISOString();

const dep = (over: Partial<ScheduledDeparture> & { tripId: string; at: string }): ScheduledDeparture => ({
  operator: 'zet', routeId: '6', routeName: '6', headsign: 'Sopot', ...over,
});

const board = (stopId: string, departures: ScheduledDeparture[], status: DepartureBoard['status'] = 'live'): DepartureBoard => ({
  operator: 'zet', stopId, stopName: 'Trg', status, generatedAt: new Date(NOW).toISOString(), departures,
});

const vehicle = (over: Partial<LiveVehicleRef> & { id: string }): LiveVehicleRef => ({ ...over });

// arrivalsAt is the one place the scheduled board and the live fleet meet
// (owner ruling: a tapped stop first says which trams come next and in how
// many minutes). It is pure: boards in, vehicles in, a clock in, rows out.
describe('arrivalsAt', () => {
  it('pushes a late trip back by the reported delay and keeps it live', () => {
    const boards = [board('100_1', [dep({ tripId: 'T1', at: at(3) })])];
    const vehicles = [vehicle({ id: 'vehicle:1', tripId: 'T1', routeId: '6', delaySeconds: 180, nextStopId: '999_1' })];
    const out = arrivalsAt(boards, vehicles, NOW, { stopIds: ['100_1'] });
    expect(out.status).toBe('live');
    expect(out.rows).toEqual([
      { tripId: 'T1', routeId: '6', routeName: '6', headsign: 'Sopot', atMs: NOW + 6 * 60_000, live: true, vehicleId: 'vehicle:1', minutes: 6 },
    ]);
  });

  it('pulls an early trip forward: a negative delay moves the ETA earlier', () => {
    const boards = [board('100_1', [dep({ tripId: 'T1', at: at(5) })])];
    const vehicles = [vehicle({ id: 'vehicle:1', tripId: 'T1', delaySeconds: -120 })];
    const out = arrivalsAt(boards, vehicles, NOW, { stopIds: ['100_1'] });
    expect(out.rows.map((r) => [r.atMs, r.minutes, r.live])).toEqual([[NOW + 3 * 60_000, 3, true]]);
  });

  it('drops a departure whose ETA is further in the past than the grace, and keeps one inside it at sada', () => {
    const boards = [board('100_1', [
      dep({ tripId: 'GONE', at: at(-5) }),
      // Scheduled two minutes ago, running four minutes early: 6 min in the past.
      dep({ tripId: 'ALSO-GONE', at: at(-2), routeName: '11' }),
      dep({ tripId: 'JUST', at: at(-0.5) }),
      dep({ tripId: 'SOON', at: at(4) }),
    ])];
    const vehicles = [vehicle({ id: 'vehicle:9', tripId: 'ALSO-GONE', delaySeconds: -240 })];
    const out = arrivalsAt(boards, vehicles, NOW, { stopIds: ['100_1'] });
    expect(out.rows.map((r) => r.tripId)).toEqual(['JUST', 'SOON']);
    // Inside the grace but already due: zero minutes, never a negative count.
    expect(out.rows[0].minutes).toBe(0);
  });

  // The board now carries a quarter of an hour of scheduled past
  // (DEPARTURES_PAST_WINDOW_MS, worker/city/schedules.ts). Those rows are
  // exactly the ones a rider still cares about, and exactly the ones only the
  // live fleet can sort out: the schedule cannot tell a tram that is seven
  // minutes late from one that left on time five minutes ago.
  it('sorts the board’s scheduled past by what the fleet is doing: the late tram stays, the one that left goes', () => {
    const boards = [board('100_1', [
      // Scheduled five minutes ago, running seven minutes late: still two minutes away.
      dep({ tripId: 'LATE', at: at(-5) }),
      // Scheduled five minutes ago and on time: long gone.
      dep({ tripId: 'LEFT', at: at(-5), routeId: '11', routeName: '11', headsign: 'Dubec' }),
      // Scheduled five minutes ago with no vehicle on the wire at all: the
      // schedule alone says it has gone, and nothing here says otherwise.
      dep({ tripId: 'UNTRACKED', at: at(-5), routeId: '12', routeName: '12', headsign: 'Ljubljanica' }),
    ])];
    const vehicles = [
      vehicle({ id: 'vehicle:1', tripId: 'LATE', delaySeconds: 420 }),
      vehicle({ id: 'vehicle:2', tripId: 'LEFT', delaySeconds: 0 }),
    ];
    const out = arrivalsAt(boards, vehicles, NOW, { stopIds: ['100_1'] });
    expect(out.rows.map((r) => [r.tripId, r.minutes, r.live])).toEqual([['LATE', 2, true]]);
  });

  it('shows the clock time beyond the horizon: minutes is null, atMs still carries the moment', () => {
    const boards = [board('100_1', [dep({ tripId: 'T1', at: at(4) }), dep({ tripId: 'T2', at: at(10) }), dep({ tripId: 'T3', at: at(22) })])];
    const out = arrivalsAt(boards, [], NOW, { stopIds: ['100_1'] });
    expect(out.rows.map((r) => [r.tripId, r.minutes])).toEqual([['T1', 4], ['T2', 10], ['T3', null]]);
    expect(out.rows[2].atMs).toBe(NOW + 22 * 60_000);
    // The horizon is an option, not a constant.
    const narrow = arrivalsAt(boards, [], NOW, { stopIds: ['100_1'], horizonMin: 5 });
    expect(narrow.rows.map((r) => r.minutes)).toEqual([4, null, null]);
  });

  it('merges the sibling platforms of one stop and keeps one row per trip, at its earliest ETA', () => {
    const boards = [
      board('100_1', [dep({ tripId: 'T1', at: at(6) }), dep({ tripId: 'T2', at: at(2), routeId: '11', routeName: '11', headsign: 'Dubec' })]),
      board('100_2', [dep({ tripId: 'T1', at: at(4) }), dep({ tripId: 'T3', at: at(8), routeId: '12', routeName: '12', headsign: 'Ljubljanica' })]),
    ];
    const out = arrivalsAt(boards, [], NOW, { stopIds: ['100_1', '100_2'] });
    expect(out.rows.map((r) => [r.tripId, r.minutes])).toEqual([['T2', 2], ['T1', 4], ['T3', 8]]);
  });

  it('lets the twin ETA win when the vehicle is coming to this very platform', () => {
    const boards = [board('100_1', [dep({ tripId: 'T1', at: at(5) })]), board('100_2', [dep({ tripId: 'T2', at: at(5), routeName: '11' })])];
    const vehicles = [
      // Next stop is a sibling platform of the tapped stop: the twin's own ETA replaces schedule + delay.
      vehicle({ id: 'vehicle:1', tripId: 'T1', delaySeconds: 300, nextStopId: '100_2', nextStopEtaMs: NOW + 2 * 60_000 }),
      // Same trick, but the vehicle's next stop is somewhere else entirely: the delay stands.
      vehicle({ id: 'vehicle:2', tripId: 'T2', delaySeconds: 60, nextStopId: '500_1', nextStopEtaMs: NOW + 30_000 }),
    ];
    const out = arrivalsAt(boards, vehicles, NOW, { stopIds: ['100_1', '100_2'] });
    expect(out.rows.map((r) => [r.tripId, r.minutes, r.live])).toEqual([['T1', 2, true], ['T2', 6, true]]);
  });

  it('keeps a matched vehicle without a twin ETA on schedule plus delay', () => {
    const boards = [board('100_1', [dep({ tripId: 'T1', at: at(5) })])];
    const vehicles = [vehicle({ id: 'vehicle:1', tripId: 'T1', delaySeconds: 60, nextStopId: '100_1' })];
    expect(arrivalsAt(boards, vehicles, NOW, { stopIds: ['100_1'] }).rows[0].minutes).toBe(6);
  });

  it('takes the first vehicle of a duplicated trip id and ignores vehicles without one', () => {
    const boards = [board('100_1', [dep({ tripId: 'T1', at: at(5) })])];
    const vehicles = [
      vehicle({ id: 'vehicle:ghost' }),
      vehicle({ id: 'vehicle:1', tripId: 'T1', delaySeconds: 60 }),
      vehicle({ id: 'vehicle:2', tripId: 'T1', delaySeconds: 600 }),
    ];
    const out = arrivalsAt(boards, vehicles, NOW, { stopIds: ['100_1'] });
    expect(out.rows[0].vehicleId).toBe('vehicle:1');
    expect(out.rows[0].minutes).toBe(6);
  });

  it('cuts the list to the row budget, sorted by ETA', () => {
    const boards = [board('100_1', Array.from({ length: 12 }, (_, i) => dep({ tripId: `T${11 - i}`, at: at(11 - i) })))];
    const out = arrivalsAt(boards, [], NOW, { stopIds: ['100_1'] });
    expect(out.rows.map((r) => r.tripId)).toEqual(['T0', 'T1', 'T2', 'T3', 'T4', 'T5']);
    expect(arrivalsAt(boards, [], NOW, { stopIds: ['100_1'], rows: 3 }).rows.map((r) => r.tripId)).toEqual(['T0', 'T1', 'T2']);
  });

  it('reads an HŽ board as clock times: no live vehicle can ever match it, whatever the trip id says', () => {
    const hz: DepartureBoard = {
      operator: 'hz', stopId: 'HZ-GK', stopName: 'Glavni kolodvor', status: 'live', generatedAt: new Date(NOW).toISOString(),
      departures: [
        { operator: 'hz', tripId: '2201', routeId: 'R1', routeName: 'R1', headsign: 'Savski Marof', at: at(9) },
        { operator: 'hz', tripId: '2203', routeId: 'R1', routeName: 'R1', headsign: 'Dugo Selo', at: at(40) },
      ],
    };
    // The tram numbered 2201 is on the wire with ten minutes of delay; the train numbered 2201 keeps its timetable.
    const out = arrivalsAt([hz], [vehicle({ id: 'vehicle:1', tripId: '2201', delaySeconds: 600 })], NOW, { stopIds: ['HZ-GK'] });
    expect(out.rows.map((r) => [r.tripId, r.minutes, r.live, r.vehicleId])).toEqual([['2201', 9, false, undefined], ['2203', null, false, undefined]]);
  });

  it('answers none without a board and down when every board failed', () => {
    expect(arrivalsAt([], [], NOW, { stopIds: ['100_1'] })).toEqual({ rows: [], status: 'none' });
    const downs = [board('100_1', [], 'down'), board('100_2', [], 'down')];
    expect(arrivalsAt(downs, [], NOW, { stopIds: ['100_1', '100_2'] })).toEqual({ rows: [], status: 'down' });
  });

  it('grades a partial answer: live when every board answered live or a live board put a row up, stale otherwise', () => {
    const rowsOn = [dep({ tripId: 'T1', at: at(3) })];
    // Every board live, nothing left to come today: still live -- the source is answering.
    expect(arrivalsAt([board('100_1', [])], [], NOW, { stopIds: ['100_1'] }).status).toBe('live');
    // A live platform with rows beside a stale sibling: what is on the list is live.
    expect(arrivalsAt([board('100_1', rowsOn), board('100_2', [], 'stale')], [], NOW, { stopIds: ['100_1', '100_2'] }).status).toBe('live');
    // The rows came from the stale sibling; the live one had nothing.
    expect(arrivalsAt([board('100_1', []), board('100_2', rowsOn, 'stale')], [], NOW, { stopIds: ['100_1', '100_2'] }).status).toBe('stale');
    // No live board at all.
    expect(arrivalsAt([board('100_1', rowsOn, 'stale')], [], NOW, { stopIds: ['100_1'] }).status).toBe('stale');
    expect(arrivalsAt([board('100_1', rowsOn, 'stale'), board('100_2', [], 'down')], [], NOW, { stopIds: ['100_1', '100_2'] }).status).toBe('stale');
    // A live platform beside a dead sibling, and the live one carries the list.
    expect(arrivalsAt([board('100_1', rowsOn), board('100_2', [], 'down')], [], NOW, { stopIds: ['100_1', '100_2'] }).status).toBe('live');
  });

  it('ignores a departure with an unreadable time and never collapses two untripped rows into one', () => {
    const boards = [board('100_1', [
      dep({ tripId: 'T1', at: 'not a time' }),
      dep({ tripId: '', at: at(2) }),
      dep({ tripId: '', at: at(3), routeId: '11', routeName: '11', headsign: 'Dubec' }),
    ])];
    const out = arrivalsAt(boards, [], NOW, { stopIds: ['100_1'] });
    expect(out.rows.map((r) => [r.routeName, r.minutes])).toEqual([['6', 2], ['11', 3]]);
  });

  it('takes the grace as an option', () => {
    const boards = [board('100_1', [dep({ tripId: 'T1', at: at(-2) })])];
    expect(arrivalsAt(boards, [], NOW, { stopIds: ['100_1'] }).rows).toEqual([]);
    expect(arrivalsAt(boards, [], NOW, { stopIds: ['100_1'], pastGraceS: 300 }).rows.map((r) => r.minutes)).toEqual([0]);
  });
});
