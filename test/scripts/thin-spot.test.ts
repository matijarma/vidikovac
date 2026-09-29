// scripts/thin-spot.mjs: the KPI port (docs/history/upgrade-2026-10-plan/U3.md O4). Four sample folders of a
// Tuesday morning carry an event that names its venue only in words, a power cut, a rain step and a
// rolled closure; the first folder also carries the run's osm-hours.json with one pharmacy and the
// venue. The event is placed at the venue, the pharmacy is the open row, the rolled closure is never a
// fact. Without osm-hours.json (the product before DU3) the event stays unplaced and no open row is
// scored, as in the zero baseline.
import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../../scripts/thin-spot.mjs';
import type { OsmHoursFile } from '../../shared/city/osm-hours';

interface KpiResult {
  samples: number;
  eventsPlacedByVenue: number;
  places: Record<string, Record<string, number | null>>;
  summary: { dayMedian: number; minDay: number; cityPerDayMedian: number };
  days: { date: string; city: number; unionSix: number; placedByVenue: number; timedEventsWithoutPoint: number; openRows: number }[];
  funnel: { kind: string; facts: number }[];
}

const FOLDERS = ['20261006T080000Z', '20261006T083000Z', '20261006T090000Z', '20261006T093000Z'];
const point = (lon: number, lat: number) => ({ type: 'Point', coordinates: [lon, lat] });
const TEASER = {
  generatedAt: '2026-10-06T08:00:00.000Z',
  modules: [
    { module: 'dogadanja', items: [{
      id: 'kulturpunkt:1', kind: 'event', tier: 'session', title: 'Koncert u kvartu', dateBasis: 'event',
      at: '2026-10-06T10:00:00.000Z', until: '2026-10-06T12:00:00.000Z',
      data: { source: 'kulturpunkt', category: 'koncert', precision: 'time', venueHint: '20 sati u Testnom prostoru Kvart' },
    }] },
    { module: 'prekidi', items: [{
      id: 'prekidi:hep:2026-10-06:ilica', kind: 'cut', tier: 'session', title: 'Ilica', dateBasis: 'event',
      at: '2026-10-06T06:00:00.000Z', until: '2026-10-06T14:00:00.000Z', geo: point(15.979, 45.8125),
      data: { utility: 'struja', source: 'hep-ods', precision: 'time' },
    }] },
    { module: 'dhmz-hourly', items: [{
      id: 'dhmz-hourly:gric:2026-10-06T09:00:00.000Z', kind: 'forecast', tier: 'session', title: 'Zagreb-Grič',
      at: '2026-10-06T09:00:00.000Z', until: '2026-10-06T10:00:00.000Z', geo: point(15.97, 45.81),
      data: { station: 'Zagreb-Grič', temp: 14, precip: 1.2, prob: 80, weather: 'kiša' },
    }] },
    { module: 'prometnice', items: [{
      // Started 16 days ago, "ends" tonight: the rolled placeholder end of F4, never a fact.
      id: 'prometnice:ilica:2026-09-20T06:00:00.000Z', kind: 'closure', tier: 'session', title: 'Ilica', dateBasis: 'event',
      at: '2026-09-20T06:00:00.000Z', until: '2026-10-06T20:00:00.000Z', geo: { type: 'LineString', coordinates: [[15.975, 45.8125], [15.98, 45.8125]] },
    }] },
  ],
};
const EVERY = (field: string) => Array(7).fill(field).join('|');
const OSM: OsmHoursFile = {
  version: 1, builtAt: '2026-10-06T07:00:00Z', osmDate: '2026-10-05T20:00:00Z', licence: 'ODbL 1.0', attribution: '© OpenStreetMap contributors',
  count: 1, venues: 1, dropped: 0, origin: [1_587_000, 4_572_000], kinds: ['ljekarna', 'venue'],
  // Sorted by name: "Ljekarna Proba" at 15.978 45.812, then "Testni prostor Kvart" at 15.976 45.814.
  name: ['Ljekarna Proba', 'Testni prostor Kvart'], kind: [0, 1],
  lon: [1_597_800 - 1_587_000, -200], lat: [4_581_200 - 4_572_000, 200], week: [EVERY('0700-2000'), null],
};
const NEAR = ['106_1', '236_1', '109_1'];
const FAR = ['98_1', '208_24', '245_1'];

async function folderSet(withOsm: boolean): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'thin-spot-'));
  for (const [i, f] of FOLDERS.entries()) {
    await mkdir(join(dir, f));
    await writeFile(join(dir, f, 'teaser.json'), JSON.stringify(TEASER));
    if (withOsm && i === 0) await writeFile(join(dir, f, 'osm-hours.json'), JSON.stringify(OSM));
  }
  return dir;
}
const run = async (dir: string) => (await main({ argv: [dir, '--from', '2026-10-06', '--to', '2026-10-06'], log: () => {} })) as unknown as KpiResult;

describe('thin-spot KPI port', () => {
  it('scores the placed event, the cut, the rain step and the open row, never the rolled closure', async () => {
    const r = await run(await folderSet(true));
    expect(r.samples).toBe(4);
    for (const id of NEAR) expect(r.places[id].day, id).toBe(4);
    for (const id of FAR) expect(r.places[id].day, id).toBe(1); // the rain step reaches every place
    // Citywide: the event, the cut and the rain step; the open row counts at its places, not citywide.
    expect(r.summary).toMatchObject({ dayMedian: 2.5, minDay: 1, cityPerDayMedian: 3 });
    expect(r.eventsPlacedByVenue).toBe(1);
    expect(r.days).toMatchObject([{ date: '2026-10-06', city: 3, unionSix: 4, placedByVenue: 1, timedEventsWithoutPoint: 0, openRows: 1 }]);
    const facts = Object.fromEntries(r.funnel.map((f) => [f.kind, f.facts]));
    expect(facts['closure:prometnice']).toBe(0);
    // One open row per place and sample, at the three near places of six.
    expect(facts['open:osm-hours']).toBe(0.5);
  });

  it('without the run\'s osm-hours.json places nothing and scores no open row, as before DU3', async () => {
    const r = await run(await folderSet(false));
    for (const id of NEAR) expect(r.places[id].day, id).toBe(2);
    expect(r.eventsPlacedByVenue).toBe(0);
    expect(r.days).toMatchObject([{ city: 2, placedByVenue: 0, timedEventsWithoutPoint: 1, openRows: 0 }]);
    expect(r.funnel.some((f) => f.kind === 'open:osm-hours')).toBe(false);
  });
});
