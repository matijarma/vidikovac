import { spawnSync } from 'node:child_process';
import { closeSync, existsSync, openSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import GtfsRealtimeBindings from 'gtfs-realtime-bindings';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { main, parseArgs, realPathOf, refusalFor, SampleRefusal, selectFrames, tripIdsOf } from '../../scripts/frames-sample.mjs';
import { decodeFeed } from '../../worker/twin/feed-decode';
import { recordingKey } from '../../worker/twin/record';

// scripts/frames-sample.mjs cuts the committed tram sample
// (test/fixtures/frames/2026-09-21-1715-1744/) out of a day of recorded
// frames: an inclusive UTC window read from the recorder's own file names,
// tram entities only, re-encoded so the twin's decoder reads them as ZET's
// bytes, and a hard refusal to write anywhere .gitignore would hide
// (`recordings/` at any depth). Here on a tiny synthetic day in a temp dir.

const FeedMessage = GtfsRealtimeBindings.transit_realtime.FeedMessage;

/** 2026-09-21 at `hhmmss` UTC, in seconds: the Monday of the committed sample. */
function at(hhmmss: string): number {
  const h = Number(hhmmss.slice(0, 2));
  const m = Number(hhmmss.slice(2, 4));
  const s = Number(hhmmss.slice(4, 6));
  return Date.UTC(2026, 8, 21, h, m, s) / 1000;
}

/** One ZET-shaped frame: a tram trip update, a bus, an alert, a tram vehicle, interleaved on purpose. */
function frameBytes(headerTs: number): Uint8Array {
  const trip = (tripId: string, routeId: string) => ({ tripId, routeId, startDate: '20260921' });
  return FeedMessage.encode({
    header: { gtfsRealtimeVersion: '1.0', incrementality: 0, timestamp: headerTs },
    entity: [
      { id: 'tu-6', tripUpdate: { trip: trip('0_23_1_6_1', '6'), stopTimeUpdate: [{ stopSequence: 4, stopId: '101_1', departure: { delay: 60 } }], timestamp: headerTs - 20 } },
      { id: 'bus-220', vehicle: { trip: trip('0_23_2_220_9', '220'), position: { latitude: 45.77, longitude: 15.99 }, vehicle: { id: '195' }, timestamp: headerTs - 30 } },
      { id: 'alert', alert: { headerText: { translation: [{ text: 'Obavijest', language: 'hr' }] } } },
      { id: 'veh-6', vehicle: { trip: trip('0_23_1_6_1', '6'), position: { latitude: 45.81, longitude: 15.97 }, vehicle: { id: '2201' }, timestamp: headerTs - 5 } },
      { id: 'veh-13', vehicle: { trip: trip('0_23_1_13_7', '13'), position: { latitude: 45.8, longitude: 15.98 }, vehicle: { id: '2202' }, timestamp: headerTs - 8 } },
    ],
  }).finish();
}

/** The recorder's own file name for a header (worker/twin/record.ts), without the day prefix. */
function nameOf(headerTs: number): string {
  return recordingKey(headerTs).split('/').at(-1)!;
}

const REPO = fileURLToPath(new URL('../..', import.meta.url));
const CLOCKS = ['151455', '151500', '151505', '154459', '154500'];

let root: string;
let input: string;
let tripsPath: string;
let networkPath: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'frames-sample-'));
  input = join(root, 'day');
  await mkdir(input);
  for (const clock of CLOCKS) await writeFile(join(input, nameOf(at(clock))), frameBytes(at(clock)));
  await writeFile(join(input, 'notes.txt'), 'not a frame');
  await writeFile(join(input, '151510-oops.pb'), 'not a recorder name');
  // A two-trip artefact, front-coded like zet-trips.json: '0_23_1_6_1' joins, '0_23_1_13_7' does not.
  tripsPath = join(root, 'trips.json');
  await writeFile(tripsPath, JSON.stringify({ feedVersion: '000395', trips: { idCommon: [0, 9], idSuffix: ['0_23_1_6_1', '2'] } }));
  networkPath = join(root, 'network.json');
  await writeFile(networkPath, JSON.stringify({ feedVersion: '000395', graphHash: 'd421e3a1f7b23b4f' }));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function run(argv: string[]) {
  return main({ argv, tripsPath, networkPath, log: () => {} });
}

describe('frames-sample window', () => {
  it('keeps the frames whose UTC name falls inside the inclusive window, under their original names', async () => {
    const out = join(root, 'sample');
    const result = await run([input, '--from', '151500', '--to', '154459', '--out', out]);
    const expected = ['151500', '151505', '154459'].map((c) => nameOf(at(c)));
    expect(result.frames).toBe(3);
    expect(result.names).toEqual(expected);
    expect((await readdir(out)).sort()).toEqual([...expected, 'README.md'].sort());
    expect(result.firstHeaderTs).toBe(at('151500'));
    expect(result.lastHeaderTs).toBe(at('154459'));
  });

  it('selects by name only and ignores files that are not recorder frames', () => {
    const names = ['154459-1.pb', 'x.pb', '151500-2.pb', '151500-2.pb.tmp', '1515-3.pb', '154500-4.pb'];
    expect(selectFrames(names, '151500', '154459')).toEqual(['151500-2.pb', '154459-1.pb']);
  });

  it('re-encodes tram entities only, in their original order, and the twin decodes them as it decodes the source', async () => {
    const out = join(root, 'sample');
    const result = await run([input, '--from', '151500', '--to', '151500', '--out', out]);
    const name = nameOf(at('151500'));
    const bytes = new Uint8Array(await readFile(join(out, name)));
    const feed = FeedMessage.decode(bytes);
    expect(feed.entity.map((e) => e.id)).toEqual(['tu-6', 'veh-6', 'veh-13']);
    expect(Number(String(feed.header.timestamp))).toBe(at('151500'));

    const source = decodeFeed(new Uint8Array(await readFile(join(input, name))));
    const sample = decodeFeed(bytes);
    expect(sample.headerTs).toBe(source.headerTs);
    expect(sample.vehicles).toEqual(source.vehicles.filter((v) => v.routeId !== '220'));
    expect(sample.tripUpdates).toEqual(source.tripUpdates);

    expect(result.bytes).toBe(bytes.byteLength);
    expect(result.keptEntities).toBe(3);
    expect(result.sourceEntities).toBe(5);
    expect(result.vehicles).toBe(2);
    expect(result.trips).toBe(2);
    expect(result.tripsJoined).toBe(1);
    expect(result.tripReports).toBe(2);
    expect(result.tripReportsJoined).toBe(1);
    expect(result.feedVersion).toBe('000395');
  });

  it('copies the frames unchanged with --all-modes', async () => {
    const out = join(root, 'all');
    await run([input, '--from', '151505', '--to', '151505', '--out', out, '--all-modes']);
    const name = nameOf(at('151505'));
    expect(new Uint8Array(await readFile(join(out, name)))).toEqual(new Uint8Array(await readFile(join(input, name))));
  });

  it('leaves exactly one window behind: a re-run removes stale frames and rewrites the README', async () => {
    const out = join(root, 'sample');
    await run([input, '--from', '151500', '--to', '154459', '--out', out]);
    const second = await run([input, '--from', '154459', '--to', '154459', '--out', out]);
    expect(second.removed).toBe(2);
    expect((await readdir(out)).sort()).toEqual([nameOf(at('154459')), 'README.md'].sort());
    const readme = await readFile(join(out, 'README.md'), 'utf8');
    expect(readme).toContain('| frames | 1 (');
    expect(readme).toContain('--from 154459 --to 154459');
  });

  it('writes a README that says fixture only, credits ZET and states the count, bytes, window and artefact', async () => {
    const out = join(root, 'sample');
    const result = await run([input, '--from', '151500', '--to', '154459', '--out', out]);
    const readme = await readFile(join(out, 'README.md'), 'utf8');
    expect(readme).toMatch(/^# ZET GTFS-RT frame sample, 2026-09-21, 17:15–17:44 Zagreb/);
    expect(readme).toContain('**Test fixture only.**');
    expect(readme).toContain('the Worker never serves them');
    expect(readme).toContain('Public dataset by ZET provided under Open license, dataset source http://www.zet.hr/odredbe/datoteke-u-gtfs-formatu/669');
    expect(readme).toContain('| frames | 3 (3 distinct header timestamps');
    expect(readme).toContain(`**${result.bytes.toLocaleString('en-US')} B**`);
    expect(readme).toContain('| window (UTC, from the file names, inclusive) | 2026-09-21 15:15:00–15:44:59 |');
    expect(readme).toContain('| window (Zagreb, UTC+2) | 17:15:00–17:44:59 |');
    expect(readme).toContain('feed **000395**');
    expect(readme).toContain('graphHash `d421e3a1f7b23b4f`');
    expect(readme).not.toContain('—');
  });
});

describe('frames-sample refusals', () => {
  it('refuses an --out under any recordings/ directory and writes nothing', async () => {
    const out = join(root, 'recordings', '2026', 'sample');
    await expect(run([input, '--from', '151500', '--to', '154459', '--out', out])).rejects.toBeInstanceOf(SampleRefusal);
    await expect(readdir(join(root, 'recordings'))).rejects.toThrow();
    expect(refusalFor('/x/Recordings/y', '/in')).toMatch(/recordings\//);
    expect(refusalFor('/x/recordings', '/in')).toMatch(/recordings\//);
    expect(refusalFor('/x/my-recordings/y', '/in')).toBeNull();
    expect(refusalFor('test/fixtures/frames/2026-09-21-1715-1744', '/in')).toBeNull();
  });

  it('refuses to write over the input directory', async () => {
    await expect(run([input, '--from', '151500', '--to', '154459', '--out', input])).rejects.toThrow(/input directory/);
  });

  it('refuses an --out inside the input directory, as written or through a symlink', async () => {
    await expect(run([input, '--from', '151500', '--to', '154459', '--out', join(input, 'sample')])).rejects.toThrow(/inside it/);
    await symlink(input, join(root, 'alias'));
    await expect(run([input, '--from', '151500', '--to', '154459', '--out', join(root, 'alias')])).rejects.toThrow(/input directory/);
    await expect(run([input, '--from', '151500', '--to', '154459', '--out', join(root, 'alias', 'sample')])).rejects.toThrow(/inside it/);
    // The input read through the link is the input too.
    await expect(run([join(root, 'alias'), '--from', '151500', '--to', '154459', '--out', input])).rejects.toThrow(/input directory/);
    expect((await readdir(input)).sort()).toEqual([...CLOCKS.map((c) => nameOf(at(c))), '151510-oops.pb', 'notes.txt'].sort());
    expect(refusalFor(join(root, 'day-2'), input)).toBeNull();
  });

  it('refuses an --out that reaches a recordings/ directory through a symlink, itself or an ancestor', async () => {
    const hidden = join(root, 'recordings', 'real');
    await mkdir(hidden, { recursive: true });
    await symlink(hidden, join(root, 'link'));
    await expect(run([input, '--from', '151500', '--to', '154459', '--out', join(root, 'link')])).rejects.toThrow(/recordings\//);
    await expect(run([input, '--from', '151500', '--to', '154459', '--out', join(root, 'link', 'deeper', 'sample')])).rejects.toThrow(/recordings\//);
    expect(await readdir(hidden)).toEqual([]);
    expect(realPathOf(join(root, 'link', 'deeper', 'sample'))).toBe(join(realPathOf(hidden)!, 'deeper', 'sample'));
  });

  it('refuses a dangling symlink as --out', async () => {
    await symlink(join(root, 'recordings', 'gone'), join(root, 'dangling'));
    expect(realPathOf(join(root, 'dangling'))).toBeNull();
    await expect(run([input, '--from', '151500', '--to', '154459', '--out', join(root, 'dangling')])).rejects.toThrow(/symlink to nothing/);
  });

  it('refuses to write through a destination file that is a symlink, before writing or removing anything', async () => {
    const out = join(root, 'sample');
    await mkdir(out);
    const victim = join(root, 'victim.bin');
    await writeFile(victim, 'keep me');
    await symlink(victim, join(out, nameOf(at('151505'))));
    await writeFile(join(out, '120000-1789992000.pb'), 'stale');
    await expect(run([input, '--from', '151500', '--to', '154459', '--out', out])).rejects.toThrow(/is a symlink/);
    expect(await readFile(victim, 'utf8')).toBe('keep me');
    expect((await readdir(out)).sort()).toEqual(['120000-1789992000.pb', nameOf(at('151505'))].sort());

    await rm(join(out, nameOf(at('151505'))));
    await symlink(victim, join(out, 'README.md'));
    await expect(run([input, '--from', '151500', '--to', '154459', '--out', out])).rejects.toThrow(/README\.md: it is a symlink/);
    expect(await readFile(victim, 'utf8')).toBe('keep me');
  });

  it('refuses a malformed, inverted or empty window and a missing --out', async () => {
    expect(() => parseArgs([input, '--from', '156000', '--to', '154459', '--out', 'o'])).toThrow(SampleRefusal);
    expect(() => parseArgs([input, '--from', '1515', '--to', '154459', '--out', 'o'])).toThrow(SampleRefusal);
    expect(() => parseArgs([input, '--from', '154459', '--to', '151500', '--out', 'o'])).toThrow(/after/);
    expect(() => parseArgs([input, '--from', '151500', '--to', '154459'])).toThrow(/--out/);
    expect(() => parseArgs([input, '--from', '151500', '--to', '154459', '--out', 'o', '--bogus'])).toThrow(/unknown option/);
    await expect(run([input, '--from', '000000', '--to', '000100', '--out', join(root, 'none')])).rejects.toThrow(/no frame/);
  });

  it('exits non-zero from the command line when --out is under recordings/', () => {
    const out = join(root, 'recordings', 'sample');
    // A regular file also captures stderr in sandboxes where spawnSync's
    // pipe polling returns EPERM after the child has correctly exited.
    const log = join(root, 'cli-stderr.txt');
    const stderr = openSync(log, 'w');
    let status: number | null;
    try {
      status = spawnSync(process.execPath, ['scripts/frames-sample.mjs', input, '--from', '151500', '--to', '154459', '--out', out],
        { cwd: REPO, stdio: ['ignore', 'ignore', stderr] }).status;
    } finally { closeSync(stderr); }
    expect(status).toBe(2);
    expect(readFileSync(log, 'utf8')).toMatch(/refusing --out .*recordings\//);
    expect(existsSync(out)).toBe(false);
  });
});

describe('tripIdsOf', () => {
  it('undoes the front coding of zet-trips.json', () => {
    const ids = tripIdsOf({ trips: { idCommon: [0, 9, 5], idSuffix: ['0_23_1_6_1', '2', '2_13_1'] } });
    expect([...ids]).toEqual(['0_23_1_6_1', '0_23_1_6_2', '0_23_2_13_1']);
  });
});
