// WP0's wrong-turn acceptance on the committed sample (WP6 step 3, brief
// §16.2, plan row A1): the 162 tram frames of Monday 21 September, 17:15-17:44
// Zagreb (test/fixtures/frames/2026-09-21-1715-1744), replayed through the
// real engine and the committed artefacts by scripts/grade-branches-core.ts,
// judged against the stage-1 targets. Accept tier: red by design until the
// WP0 engine fixes land; `npm test` does not run it.
//
//   npx vitest run --project accept test/accept/wrong-turn.test.ts
//
// wrong-turn.expect.json is data: the rows measured on this sample before WP0
// (b300af3) and after lane T (f78ae0a), printed beside today's rows. Nothing
// here compares against them; the test asserts the targets only.
//
// The frames name trips of one static feed, the one their README states. When
// the committed timetable artefacts are cut from a newer feed (FEED_VERSION in
// app/src/motion/network-meta.ts), the sample's trip ids no longer join them,
// so the test reads the copies of its own feed kept beside the frames
// (artefacts/: network, trip index and the stop list derived from that
// network). On the same feed it reads the committed artefacts, so a rebuilt
// network is still measured here.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { FEED_VERSION } from '../../app/src/motion/network-meta';
import {
  ACCEPTANCE_ROW_KEYS,
  ACCEPTANCE_TARGETS,
  acceptanceRows,
  gradeDirectory,
  isTargetRow,
  judge,
  loadRealEngine,
  type AcceptanceRows,
  type BranchReport,
  type Stage,
} from '../../scripts/grade-branches-core';

const root = (path: string): string => fileURLToPath(new URL(`../../${path}`, import.meta.url));

interface Measurement {
  commit: string;
  engine: string;
  graphHash: string;
  unknownTripShare: number;
  rows: Record<(typeof ACCEPTANCE_ROW_KEYS)[number], number>;
}

interface Expectation {
  fixture: string;
  frames: number;
  artefact: { feed: string; graphHash: string };
  targets: Stage;
  baseline: Measurement;
  measured: Measurement;
}

const RERECORD = "artefact feed changed: re-record the sample with scripts/frames-sample.mjs from the owner's recordings";

interface SampleArtefacts {
  feed: string;
  own: boolean;
  network: string;
  trips: string;
  stops: string;
}

/** The artefacts the sample's trip ids join: the committed ones on the README's feed, else the fixture's own copies. */
async function sampleArtefacts(fixture: string): Promise<SampleArtefacts> {
  const readme = await readFile(root(`${fixture}/README.md`), 'utf8');
  const feed = /static GTFS feed \*\*(\d+)\*\*/.exec(readme)?.[1];
  if (feed === undefined) throw new Error(`${fixture}/README.md names no static feed`);
  const own = feed !== FEED_VERSION;
  const dir = own ? `${fixture}/artefacts` : 'app/public/data';
  return { feed, own, network: root(`${dir}/zet-network.json`), trips: root(`${dir}/zet-trips.json`), stops: root(`${dir}/stops.json`) };
}

describe('WP0 wrong turn on the committed 162-frame sample', () => {
  let expected: Expectation;
  let report: BranchReport;
  let rows: AcceptanceRows;
  let artefacts: SampleArtefacts;

  beforeAll(async () => {
    expected = JSON.parse(await readFile(root('test/accept/wrong-turn.expect.json'), 'utf8')) as Expectation;
    artefacts = await sampleArtefacts(expected.fixture);
    const engine = await loadRealEngine(artefacts.network, artefacts.trips, root('app/public/data/stop-dwell-overrides.json'));
    report = await gradeDirectory(root(expected.fixture), engine, { clientHz: 4, stopsPath: artefacts.stops, label: expected.fixture });
    rows = acceptanceRows(report);

    const targets = ACCEPTANCE_TARGETS[expected.targets];
    const cell = (n: number | null | undefined): string => (n === null || n === undefined ? 'n/a' : Number.isInteger(n) ? String(n) : n.toFixed(2));
    const lines = [
      `wrong turn, ${expected.fixture}: ${report.frames} frames, ${report.tramVehicleHours} tram vehicle-hours, feed ${engine.index.feedVersion} (${artefacts.own ? "the fixture's own artefacts" : 'the committed artefacts'}), graphHash ${engine.net.graphHash}, unknown trips ${cell(report.unknownTripShare === null ? null : report.unknownTripShare * 100)} %`,
      `  ${'row'.padEnd(15)}${expected.baseline.commit.padStart(10)}${expected.measured.commit.padStart(10)}${'now'.padStart(10)}  ${targets.stage}`,
      ...ACCEPTANCE_ROW_KEYS.map((key) => {
        const target = isTargetRow(key) ? `<= ${targets[key]}` : '';
        return `  ${key.padEnd(15)}${cell(expected.baseline.rows[key]).padStart(10)}${cell(expected.measured.rows[key]).padStart(10)}${cell(rows[key]).padStart(10)}  ${target}`;
      }),
    ];
    console.log(lines.join('\n'));
  }, 180_000);

  it('records a baseline and a later measurement for every row', () => {
    for (const measurement of [expected.baseline, expected.measured]) {
      expect(Object.keys(measurement.rows).sort()).toEqual([...ACCEPTANCE_ROW_KEYS].sort());
    }
    expect(ACCEPTANCE_TARGETS[expected.targets]).toBeDefined();
  });

  it('grades the committed sample on artefacts its trips still join (preconditions)', () => {
    expect(report.frames).toBe(expected.frames);
    expect(artefacts.feed, 'the README states the feed the expectation was recorded on').toBe(expected.artefact.feed);
    expect(report.unknownTripShare, RERECORD).not.toBeNull();
    expect(report.unknownTripShare!, RERECORD).toBeLessThan(0.02);
  });

  it('meets the stage-1 targets: A and A-prime at most 5, B to F and I 0, G 0 with p95 at most 50 m, H at most 60 m, U at most 3 % without parked trams, S at most 50 m beyond the hold at the next stop', () => {
    expect(judge(rows, ACCEPTANCE_TARGETS[expected.targets]).failures).toEqual([]);
  });
});
