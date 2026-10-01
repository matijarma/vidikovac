import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { arrivalsAt } from '../../shared/city/arrivals';
import { DEPOT_RUNS, depotRunOf, isDepotCode } from '../../shared/city/depot-run';
import type { DepartureBoard, ScheduledDeparture } from '../../shared/city/types';

const json = <T>(path: string): T => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')) as T;

// A pull-in is a passenger trip of its own (feed 000396: 721 trips under
// "Spr. Trešnj." and "Spr.Dubrava"); the app names it as the tram's sign does.
describe('depotRunOf', () => {
  it("reads ZET's two headsigns and the spelled-out sign", () => {
    expect(depotRunOf('Spr. Trešnj.')).toBe('ST');
    expect(depotRunOf('Spr.Dubrava')).toBe('SD');
    expect(depotRunOf('Spr. Dubrava')).toBe('SD');
    expect(depotRunOf('SPREMIŠTE TREŠNJEVKA')).toBe('ST');
    expect(depotRunOf('Spremište Dubrava')).toBe('SD');
    expect(depotRunOf(' spr.trešnjevka ')).toBe('ST');
  });

  it('leaves every other headsign alone', () => {
    for (const headsign of ['Sopot', 'Dubrava', 'Trešnjevački trg', 'Španko', 'Spansko', 'Savski most', 'Dubec', '', null, undefined]) {
      expect(depotRunOf(headsign), String(headsign)).toBeNull();
    }
  });

  it('classifies every depot headsign the shipped trip index and the 21 Sep fixture carry', () => {
    for (const path of ['../../app/public/data/zet-trips.json', '../fixtures/frames/2026-09-21-1715-1744/artefacts/zet-trips.json']) {
      const { headsigns } = json<{ headsigns: string[] }>(path);
      const depot = headsigns.filter((h) => /^spr/i.test(h));
      expect(depot.length, path).toBeGreaterThan(0);
      for (const h of depot) expect(depotRunOf(h), h).not.toBeNull();
      for (const h of headsigns.filter((x) => !/^spr/i.test(x))) expect(depotRunOf(h), h).toBeNull();
    }
  });

  it('knows its own codes and nothing else', () => {
    expect(isDepotCode('ST')).toBe(true);
    expect(isDepotCode('SD')).toBe(true);
    expect(isDepotCode('5')).toBe(false);
    expect(isDepotCode('st')).toBe(false);
  });
});

describe('a pull-in on the stop board', () => {
  const NOW = Date.parse('2026-09-28T05:46:58Z');
  const board = (departures: ScheduledDeparture[]): DepartureBoard => ({
    operator: 'zet', stopId: '247_1', stopName: 'Branimirova tržnica', status: 'live', generatedAt: new Date(NOW).toISOString(), departures,
  });

  it('is ST or SD with the depot for its destination, live off the tram that carries it (wall fixture, 28 Sep 07:47)', () => {
    // Tram 102269 on line 6's pull-in 0_25_602_6_32475, as the twin published it.
    const teaser = json<{ modules: Array<{ items: Array<{ id: string; data?: Record<string, unknown> }> }> }>('../fixtures/wall/2026-09-28-0745/teaser.json');
    const pin = teaser.modules.flatMap((m) => m.items).find((item) => item.id === 'vehicle:102269')!;
    expect(pin.data!.headsign).toBe('Spr.Dubrava');
    const out = arrivalsAt([board([
      { operator: 'zet', tripId: '0_25_602_6_32475', routeId: '6', routeName: '6', headsign: 'Spr.Dubrava', at: new Date(NOW + 4 * 60_000).toISOString() },
      { operator: 'zet', tripId: 'regular', routeId: '6', routeName: '6', headsign: 'Sopot', at: new Date(NOW + 6 * 60_000).toISOString() },
    ])], [{ id: 'vehicle:102269', tripId: pin.data!.tripId as string, routeId: '6', nextStopId: '247_1' }], NOW, { stopIds: ['247_1'] });
    expect(out.rows.map((r) => [r.routeId, r.routeName, r.headsign, r.depot, r.live])).toEqual([
      ['6', 'SD', DEPOT_RUNS.SD.name, 'SD', true],
      ['6', '6', 'Sopot', undefined, false],
    ]);
    expect('depot' in out.rows[1]).toBe(false);
  });

  it("never renames an HŽ train, whatever its headsign says", () => {
    const out = arrivalsAt([{ ...board([{ operator: 'hz', tripId: 'h1', routeId: 'R', routeName: 'R', headsign: 'Spr. Trešnj.', at: new Date(NOW + 60_000).toISOString() }]), operator: 'hz' }], [], NOW, { stopIds: ['247_1'] });
    expect(out.rows[0].routeName).toBe('R');
    expect(out.rows[0].depot).toBeUndefined();
  });
});
