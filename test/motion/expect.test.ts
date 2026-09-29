import { describe, expect, it } from 'vitest';
import { decodeExpectIndex, expectedAt, ExpectIndexError, zagrebDate, type ExpectIndexWire } from '../../shared/motion/expect';

// shared/motion/expect.ts: the declared fleet of app/public/data/zet-expect.json
// (scripts/gtfs-expect.mjs) and what it says at an instant. A service day
// starts at GTFS noon minus twelve hours and runs past 24:00, so at 00:30 the
// night runs of yesterday's service and the first of today's are summed; a
// date the calendar does not name makes the answer unknown, never zero.

const SLOTS = 372;
const zeros = () => new Array<number>(SLOTS).fill(0);
const slot = (hh: number, mm = 0) => (hh * 60 + mm) / 5;
/** Epoch seconds of a Zagreb wall-clock time: `2026-10-06T00:30` at `+02:00`. */
const at = (local: string, offset: '+02:00' | '+01:00') => Date.parse(`${local}:00${offset}`) / 1000;

/** Two services: `wd` (a tram run 07:00-07:50, a bus run 07:00-07:15, a night tram 24:30-25:10), `we` (one bus). */
function wire(): ExpectIndexWire {
  const wd = { all: zeros(), tram: zeros(), bus: zeros() };
  for (let k = slot(7); k <= slot(7, 50); k++) (wd.all[k]++, wd.tram[k]++);
  for (let k = slot(7); k <= slot(7, 15); k++) (wd.all[k]++, wd.bus[k]++);
  for (let k = slot(24, 30); k <= slot(25, 10); k++) (wd.all[k]++, wd.tram[k]++);
  const we = { all: zeros(), tram: zeros(), bus: zeros() };
  we.all[slot(9)] = 4;
  we.bus[slot(9)] = 4;
  const tripsT = zeros();
  tripsT[slot(7)] = 2;
  const tripsN = zeros();
  tripsN[slot(24, 30)] = 1;
  // A synthetic DST day: on Sunday 25 Oct 2026 the service day starts 01:00 CEST
  // (23:00 UTC the day before), an hour after local midnight.
  const dst = { all: zeros(), tram: zeros(), bus: zeros() };
  dst.all[slot(8)] = 5;
  dst.all[slot(9)] = 7;
  return {
    version: 1,
    feedVersion: '000777',
    builtAt: '2026-10-01T00:00:00.000Z',
    slotSec: 300,
    slots: SLOTS,
    services: ['wd', 'we', 'dst'],
    calendar: { '2026-10-05': [0], '2026-10-06': [0], '2026-10-07': [1], '2026-10-24': [1], '2026-10-25': [2] },
    routes: { id: ['T', 'B', 'N'], type: [0, 3, 0] },
    blocks: { wd, we, dst },
    trips: { wd: { T: tripsT, N: tripsN }, we: {}, dst: {} },
  };
}

describe('decodeExpectIndex', () => {
  it('reads the calendar as service ids and names its first and last date', () => {
    const index = decodeExpectIndex(wire());
    expect(index.feedVersion).toBe('000777');
    expect(index.calendar.get('2026-10-06')).toEqual(['wd']);
    expect(index.calendar.get('2026-10-07')).toEqual(['we']);
    expect([index.firstDate, index.lastDate]).toEqual(['2026-10-05', '2026-10-25']);
    expect(index.routeType.get('B')).toBe(3);
    expect(index.trips.get('wd')?.get('T')?.[slot(7)]).toBe(2);
  });

  it('refuses a wire it cannot read, naming what is wrong', () => {
    expect(() => decodeExpectIndex(null)).toThrow(ExpectIndexError);
    expect(() => decodeExpectIndex({ ...wire(), version: 2 })).toThrow(/version 2, this decoder reads 1/);
    expect(() => decodeExpectIndex({ ...wire(), calendar: { '2026-10-05': [9] } })).toThrow(/calendar 2026-10-05 names service index 9/);
    const short = wire();
    short.blocks.wd.bus = short.blocks.wd.bus.slice(1);
    expect(() => decodeExpectIndex(short)).toThrow(/blocks of service wd are not three lists of 372 counts/);
    const negative = wire();
    negative.trips.wd.T[3] = -1;
    expect(() => decodeExpectIndex(negative)).toThrow(/trips of route T in service wd/);
  });
});

describe('expectedAt', () => {
  const index = decodeExpectIndex(wire());

  it('reads the slot of the service day the instant falls in, by mode, and the trips of the routes asked for', () => {
    expect(expectedAt(index, at('2026-10-05T07:02', '+02:00'), ['T', 'B'])).toEqual({
      known: true,
      blocks: { all: 2, tram: 1, bus: 1 },
      routes: { T: 2, B: 0 },
    });
    expect(expectedAt(index, at('2026-10-05T07:20', '+02:00')).blocks).toEqual({ all: 1, tram: 1, bus: 0 });
    expect(expectedAt(index, at('2026-10-05T12:00', '+02:00')).blocks.all).toBe(0);
  });

  it('adds yesterday\'s night runs past 24:00 to today\'s, and counts them on the day they belong to', () => {
    // Tuesday 00:32: Monday's night tram (its 24:30) is running; Tuesday's own service has not started.
    const night = expectedAt(index, at('2026-10-06T00:32', '+02:00'), ['N']);
    expect(night).toEqual({ known: true, blocks: { all: 1, tram: 1, bus: 0 }, routes: { N: 1 } });
    // Wednesday 00:32: Tuesday is a `wd` day too, so its night tram runs; Wednesday (`we`) adds nothing then.
    expect(expectedAt(index, at('2026-10-07T00:32', '+02:00')).blocks.all).toBe(1);
    // Thursday 00:32: Wednesday ran `we`, which has no night runs.
    expect(expectedAt(index, at('2026-10-08T00:32', '+02:00')).blocks.all).toBe(0);
  });

  it('is unknown, never zero by default, when a service day that may be running is not in the calendar', () => {
    // 8 October is not named at all.
    expect(expectedAt(index, at('2026-10-08T09:00', '+02:00'))).toMatchObject({ known: false, reason: 'no-calendar' });
    // Monday 5 October 00:32: the calendar starts that day, so Sunday's night runs are unknown; what is known still counts.
    const first = expectedAt(index, at('2026-10-05T00:32', '+02:00'));
    expect(first).toMatchObject({ known: false, reason: 'no-calendar', blocks: { all: 0 } });
    // After 07:00 on a named day, the day before no longer runs (31 hours end at 07:00): known again.
    expect(expectedAt(index, at('2026-10-06T07:02', '+02:00')).known).toBe(true);
  });

  it('starts the service day where GTFS does on the day the clocks go back', () => {
    // 25 Oct 2026, 08:02 CET is 07:02 UTC; the service day began 23:00 UTC on the 24th,
    // so this is its 08:00 slot (5), not the 09:00 one (7) local midnight would give.
    expect(expectedAt(index, at('2026-10-25T08:02', '+01:00')).blocks.all).toBe(5);
    expect(zagrebDate(at('2026-10-25T00:30', '+02:00'))).toBe('2026-10-25');
  });
});
