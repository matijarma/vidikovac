import { describe, expect, it } from 'vitest';
import {
  createDwellTable,
  DWELL_PLAN_QUANTILE,
  DWELL_RECENT_MIN,
  DWELL_RECENT_WINDOW_S,
  parseDwellOverrides,
  pushDwellRecent,
  sampleQuantile,
  trimDwellRecent,
  type DwellRecent,
} from '../../shared/motion/dwell';
import { addSample, emptyAggregates, emptyHistogram, stopKey } from '../../shared/motion/learn';
import { DWELL_DEFAULT_S } from '../../shared/motion/plan';
import type { TimesProvider } from '../../shared/motion/times';
import { straight, syntheticNetwork, type SynthSpec } from './synthetic-network';

// F11: the per-stop dwell table. Four sources answer in one fixed order --
// an owner override pinned to a number, the rolling recent window, the
// banded histogram, the timetable -- and every consumer of a dwell (the
// planner, the speed estimator's charge, the learner's "other stops") reads
// the same one, so no two parts of the engine disagree about one platform.

/** Two lines over one trunk with a shared place name: 'Beta' is two
 *  platforms, one served by line 1 and the other by line 2, which is what a
 *  name-scoped and a route-scoped override have to tell apart. */
function twoLineSpec(): SynthSpec {
  return {
    edges: [
      { from: 0, to: 1, pts: straight(0, 1200) },
      { from: 1, to: 2, pts: straight(1200, 2400) },
    ],
    routes: [
      { id: '1', type: 0, paths: [{ id: '1_0', direction: 0, edges: [0, 1], served: ['S0', 'S600', 'S1800'] }] },
      { id: '2', type: 0, paths: [{ id: '2_0', direction: 0, edges: [0], served: ['S0', 'S605'] }] },
      // A bus route over the same rails, whose BAY carries the same place
      // name as the tram platforms. In Zagreb that is the normal case:
      // "Crnomerec" is three tram platforms and eleven bus bays.
      { id: '109', type: 3, busShapes: [{ id: 'B109', pts: straight(0, 1200, -30) }] },
    ],
    stops: [
      { id: 'S0', name: 'Alfa', edge: 0, s: 0, terminal: true },
      { id: 'S600', name: 'Beta', edge: 0, s: 600 },
      { id: 'S605', name: 'Beta', edge: 0, s: 605 },
      { id: 'S610BUS', name: 'Beta', edge: 0, s: 610 },
      { id: 'S1800', name: 'Gama', edge: 1, s: 600, terminal: true },
    ],
  };
}

const net = syntheticNetwork(twoLineSpec());
const BAND = 12;
const DAY = 0 as const;
const NOW = 1_800_000_000;

/** The timetable: 15 s at Beta's line-1 platform, nothing anywhere else. */
const schedule: TimesProvider = {
  segmentSeconds: () => null,
  dwellSeconds: (stopId) => (stopId === 'S600' ? 15 : null),
};

describe('the dwell table', () => {
  it('falls through override, recent window, histogram, timetable, default -- in that order', () => {
    const aggregates = emptyAggregates();
    const recent: DwellRecent = {};
    const table = createDwellTable({ net, schedule, aggregates, overrides: [], recent });

    // Nothing known: the timetable where it speaks, the planner's default elsewhere.
    expect(table.defaultSec('S600')).toBe(15);
    expect(table.defaultSec('S1800')).toBe(DWELL_DEFAULT_S);
    expect(table.dynamicSec('S600', NOW, BAND, DAY)).toBeNull();
    expect(table.plannedSec('S600', NOW, BAND, DAY)).toBe(15);
    expect(table.plannedSec('S1800', NOW, BAND, DAY)).toBe(DWELL_DEFAULT_S);

    // A thick banded cell, but fewer than DWELL_RECENT_MIN recent samples:
    // the histogram's 0.7 quantile answers, not its median.
    const cell = emptyHistogram();
    for (const s of [10, 10, 10, 10, 10, 10, 40, 40, 40, 40]) addSample(cell, s);
    aggregates.stops[stopKey('S1800', BAND, DAY)] = cell;
    const banded = table.dynamicSec('S1800', NOW, BAND, DAY);
    expect(banded).toBeGreaterThan(25); // the 0.7 quantile sits in the 40 s bins, the median in the 10 s ones
    expect(banded).toBeLessThan(55);
    expect(table.plannedSec('S1800', NOW, BAND, DAY)).toBe(banded);

    // A thin cell teaches nothing: fewer than LEARN_MIN_SAMPLES and the default stands.
    const thin = emptyHistogram();
    addSample(thin, 90);
    aggregates.stops[stopKey('S0', BAND, DAY)] = thin;
    expect(table.dynamicSec('S0', NOW, BAND, DAY)).toBeNull();

    // DWELL_RECENT_MIN samples inside the window beat the histogram: the
    // planning quantile of five samples is read by nearest rank, so at 0.9
    // it is the slowest of the five -- the platform's recent worst, which is
    // exactly the tram the plan must not drive off without.
    for (const [at, secs] of [[NOW - 100, 12], [NOW - 200, 14], [NOW - 300, 16], [NOW - 400, 18], [NOW - 500, 26]] as const) {
      pushDwellRecent(recent, 'S1800', at, secs);
    }
    expect(recent['S1800']).toHaveLength(DWELL_RECENT_MIN);
    expect(table.dynamicSec('S1800', NOW, BAND, DAY)).toBe(sampleQuantile([12, 14, 16, 18, 26], DWELL_PLAN_QUANTILE));
    expect(table.dynamicSec('S1800', NOW, BAND, DAY)).toBe(26);

    // Samples older than the window do not count: shift the clock past it and
    // the histogram answers again.
    const later = NOW + DWELL_RECENT_WINDOW_S + 1;
    expect(table.dynamicSec('S1800', later, BAND, DAY)).toBe(banded);
    expect(DWELL_PLAN_QUANTILE).toBe(0.9); // tuned on the replay of 17 Sept; the constant carries the sweep
  });

  it('reads an owner override by name, by platform id and by route, and pin beats the measured estimate', () => {
    const aggregates = emptyAggregates();
    const recent: DwellRecent = {};
    // Beta is measured at 40 s on both platforms.
    const measured = emptyHistogram();
    for (let i = 0; i < 12; i++) addSample(measured, 40);
    aggregates.stops[stopKey('S600', BAND, DAY)] = measured;
    aggregates.stops[stopKey('S605', BAND, DAY)] = measured;

    // A name matches every platform of that name.
    const byName = createDwellTable({
      net,
      schedule,
      aggregates,
      recent,
      overrides: parseDwellOverrides([{ stop: 'Beta', defaultSec: 55, reason: 'test: the whole place' }]),
    });
    expect(byName.defaultSec('S600')).toBe(55);
    expect(byName.defaultSec('S605')).toBe(55);
    expect(byName.defaultSec('S0')).toBe(DWELL_DEFAULT_S);
    // F11 review, item 2: a NAME is a place, and a place is usually several
    // platforms of several modes. S610BUS carries the name but no tram path
    // calls there, so the entry must not reach it: the dwell table also
    // feeds the speed estimator's per-stop charge, and a 55 s terminus
    // layover charged against a bus bay would push a BUS plan ahead of its
    // bus. A platform id still matches whatever it names.
    expect(byName.defaultSec('S610BUS')).toBe(DWELL_DEFAULT_S);
    const byBusId = createDwellTable({
      net,
      schedule,
      aggregates,
      recent,
      overrides: parseDwellOverrides([{ stop: 'S610BUS', defaultSec: 55, reason: 'test: an id is not a guess' }]),
    });
    expect(byBusId.defaultSec('S610BUS')).toBe(55);
    // Without pin the measured estimate still speaks: the override is only the default.
    expect(byName.plannedSec('S600', NOW, BAND, DAY)).toBeGreaterThan(30);
    expect(byName.plannedSec('S600', NOW, BAND, DAY)).toBeLessThan(55);

    // A route narrows the entry to the platforms that route's paths serve.
    const byRoute = createDwellTable({
      net,
      schedule,
      aggregates,
      recent,
      overrides: parseDwellOverrides([{ stop: 'Beta', route: '2', defaultSec: 55, reason: 'test: line 2 only' }]),
    });
    expect(byRoute.defaultSec('S605')).toBe(55);
    expect(byRoute.defaultSec('S600')).toBe(15); // line 1's platform keeps the timetable

    // A platform id names one platform, and pin makes the override the plan.
    const pinned = createDwellTable({
      net,
      schedule,
      aggregates,
      recent,
      overrides: parseDwellOverrides([{ stop: 'S600', defaultSec: 70, pin: true, reason: 'test: pinned' }]),
    });
    expect(pinned.plannedSec('S600', NOW, BAND, DAY)).toBe(70);
    expect(pinned.dynamicSec('S600', NOW, BAND, DAY)).toBeGreaterThan(30); // still measured, for /stats
    expect(pinned.plannedSec('S605', NOW, BAND, DAY)).toBeGreaterThan(30);

    // A platform id beats a name, and a route-scoped entry beats an unscoped one.
    const layered = createDwellTable({
      net,
      schedule,
      aggregates,
      recent,
      overrides: parseDwellOverrides([
        { stop: 'Beta', defaultSec: 55, reason: 'test: the whole place' },
        { stop: 'S600', defaultSec: 33, reason: 'test: one platform' },
      ]),
    });
    expect(layered.defaultSec('S600')).toBe(33);
    expect(layered.defaultSec('S605')).toBe(55);

    // What /stats shows: one row per platform anything is known about.
    const row = layered.rows(NOW, BAND, DAY).find((r) => r.stopId === 'S600');
    expect(row).toMatchObject({ name: 'Beta', defaultSec: 33, recent: 0, lastSampleSec: null });
    expect(row?.override).toMatchObject({ defaultSec: 33, pin: false, route: null });
    expect(row?.p50).toBeGreaterThan(30);
    expect(row?.pPlan).toBeGreaterThan(30);
  });

  it('fails loudly on a malformed entry, printing it', () => {
    expect(() => parseDwellOverrides([{ stop: 'Beta', defaultSec: 'brzo', reason: 'test' }])).toThrow(/"defaultSec":"brzo"/);
    expect(() => parseDwellOverrides([{ defaultSec: 20, reason: 'test' }])).toThrow(/stop/);
    expect(() => parseDwellOverrides([{ stop: 'Beta', defaultSec: 20 }])).toThrow(/reason/);
    expect(() => parseDwellOverrides([{ stop: 'Beta', defaultSec: -1, reason: 'test' }])).toThrow(/defaultSec/);
    expect(() => parseDwellOverrides([{ stop: 'Beta', defaultSec: 20, reason: 'test', pin: 'da' }])).toThrow(/pin/);
    expect(() => parseDwellOverrides([{ stop: 'Beta', defaultSec: 20, reason: 'test', tko: 1 }])).toThrow(/tko/);
    expect(() => parseDwellOverrides('nothing')).toThrow();
    // The `_comment` key documents the file's shape and is not an entry.
    expect(parseDwellOverrides({ _comment: 'shape', entries: [{ stop: 'Beta', defaultSec: 20, reason: 'test' }] })).toHaveLength(1);
    expect(parseDwellOverrides([])).toEqual([]);
  });

  it('keeps at most DWELL_RECENT_N samples per stop, newest last', () => {
    const recent: DwellRecent = {};
    for (let i = 0; i < 40; i++) pushDwellRecent(recent, 'S600', NOW + i, i);
    expect(recent['S600']).toHaveLength(30);
    expect(recent['S600'][0][1]).toBe(10); // the ten oldest fell off the front
    expect(recent['S600'][29][1]).toBe(39);
  });
});

// The committed file itself (app/public/data/stop-dwell-overrides.json): the
// twin reads it straight through the ASSETS binding with no build step in
// between, so a typo in it is a production outage and belongs in the tests.
describe('the committed override file', () => {
  it('parses, documents its own shape, and names platforms the network knows', async () => {
    const { readFile } = await import('node:fs/promises');
    const raw = JSON.parse(await readFile(new URL('../../app/public/data/stop-dwell-overrides.json', import.meta.url), 'utf8')) as {
      _comment?: unknown;
    };
    expect(typeof raw._comment).toBe('string');
    const entries = parseDwellOverrides(raw);
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) expect(entry.reason.trim().length).toBeGreaterThan(0);

    const artefact = JSON.parse(await readFile(new URL('../../app/public/data/zet-network.json', import.meta.url), 'utf8')) as {
      stops: { id: string[]; name: string[] };
    };
    const known = new Set<string>([...artefact.stops.id, ...artefact.stops.name]);
    for (const entry of entries) expect(known.has(entry.stop), `override names ${entry.stop}, which the network does not know`).toBe(true);
  });

  // F11 review, item 2. The seed is written by NAME, which is what an owner
  // can read -- but a Zagreb place name covers tram platforms and bus bays
  // alike, and the dwell table feeds the speed estimator's per-stop charge
  // as well as the planner. So what the seed actually RESOLVES TO against
  // the committed network has to be checked, not assumed: every platform it
  // reaches must be one a tram path calls at, and none may be a bus bay.
  it('resolves the seed to tram platforms only, and names the entries it cannot place', async () => {
    const { readFile } = await import('node:fs/promises');
    const { decodeNetwork } = await import('../../shared/motion/network');
    const raw = JSON.parse(await readFile(new URL('../../app/public/data/zet-network.json', import.meta.url), 'utf8')) as unknown;
    const real = decodeNetwork(raw);
    const overrides = parseDwellOverrides(
      JSON.parse(await readFile(new URL('../../app/public/data/stop-dwell-overrides.json', import.meta.url), 'utf8')) as unknown,
    );
    expect(overrides).toHaveLength(20); // the twenty tram termini the seed was derived from

    // Every platform some tram path calls at, and every platform of any name
    // the seed uses -- the two sets the matching has to tell apart.
    const servedByTram = new Set<string>();
    real.paths.forEach((path, pathIdx) => {
      if (real.routes.get(path.route)?.type !== 0) return;
      for (const entry of real.stopsOnPath(pathIdx)) servedByTram.add(entry.stop.id);
    });
    const seedNames = new Set(overrides.map((entry) => entry.stop));
    const platformsOfSeedNames = real.stops.filter((stop) => seedNames.has(stop.name)).map((stop) => stop.id);
    // The places the seed names carry far more platforms than trams use.
    expect(platformsOfSeedNames.length).toBeGreaterThan(100);

    const table = createDwellTable({ net: real, schedule: { segmentSeconds: () => null, dwellSeconds: () => null }, aggregates: emptyAggregates(), overrides });
    const matched = platformsOfSeedNames.filter((id) => table.defaultSec(id) === 60);
    const busBays = matched.filter((id) => !servedByTram.has(id));
    expect(busBays, `the seed reached ${busBays.length} platforms no tram path calls at`).toEqual([]);
    // And a second angle on the same question, since "served" is derived
    // from the artefact the filter itself reads: all but two of the matched
    // platforms lie on the RAIL GRAPH, which a bus bay never does. The two
    // exceptions are 317_1 and 317_2, Zapadni kolodvor -- line 1's terminus,
    // 93 and 168 m west of the Republike Austrije tracks on a stub no shape
    // draws, so they carry no `onEdge` link while standing in their paths'
    // served lists as set-back termini (since the Trg dr. F. Tuđmana
    // connector, both directions reach them). Pinned by name so a third such
    // platform would fail here rather than pass unnoticed.
    const byId = new Map(real.stops.map((stop) => [stop.id, stop] as const));
    const offRail = matched.filter((id) => (byId.get(id)?.onEdge ?? []).length === 0);
    expect(offRail, `the seed reached ${offRail.length} platforms that lie on no rail edge`).toEqual(['317_1', '317_2']);
    expect(matched.length).toBe(62);
    // ...which is far fewer than the names alone would have matched.
    expect(matched.length).toBeLessThan(platformsOfSeedNames.length / 2);

    // And every one of the twenty places a platform: the seed has no dead
    // lines. An entry that placed none would be reported here rather than
    // silently dropped, which is what /stats shows the operator.
    expect(table.unmatchedOverrides).toEqual([]);
  });
});

// The engine holds the rolling window BY REFERENCE (worker/twin/engine.ts
// hands the same object to createDwellTable and keeps appending to it), so
// trimming it must never hand back a different object: a twin that replaced
// its window once a tick would leave the table reading one that never grows.
describe('trimDwellRecent', () => {
  it('drops what left the window and keeps the object it was given', () => {
    const recent: DwellRecent = {};
    pushDwellRecent(recent, 'S600', NOW - 100, 18);
    pushDwellRecent(recent, 'S600', NOW - DWELL_RECENT_WINDOW_S - 10, 90);
    pushDwellRecent(recent, 'S605', NOW - DWELL_RECENT_WINDOW_S - 10, 90);
    const back = trimDwellRecent(recent, NOW);
    expect(back).toBe(recent);
    expect(recent['S600']).toEqual([[NOW - 100, 18]]);
    expect(recent['S605']).toBeUndefined();
  });
});
