#!/usr/bin/env node
// Replays a directory of recorded ZET frames (worker/twin/record.ts:
// `zet-rt/YYYY/MM/DD/HHMMSS-<headerTs>.pb`) through the twin's pure tick and
// prints the health table task B8 asks for: hindsight p50/p95 by horizon,
// overtakes and reversals (both must be 0), concessions, direction-known
// share, time to first moving plan, unknown-trip share, frames and vehicles
// processed, per-tick wall time. Nothing here fetches ZET, writes R2 or
// touches a Durable Object -- scripts/replay-core.ts drives the identical
// `runTick` every production tick goes through (worker/twin/tick.ts), fed
// from files on disk and the two committed artefacts instead of the twin's
// live copies.
//
// Usage:
//   node scripts/replay-twin.mjs <frames-dir> [--limit N]
//   node scripts/replay-twin.mjs <frames-dir> --network <path> --trips <path>
//   node scripts/replay-twin.mjs <frames-dir> --overrides <path>   (F11's dwell table)
//   node scripts/replay-twin.mjs <frames-dir> --fleet-series [--standing]
//
// --fleet-series prints one JSON line per frame instead of the table: the
// header `h`, the `pins` and the payload's `itemCount`, the `routeRows`, the
// pinned vehicle `ids`, the `futurePins` stamped more than 30 s after the
// payload's source time, the vehicles `hidden` in a depot or parked, and the
// reports the tick refused as `rejectedFuture` (scripts/replay-core.ts
// FleetFrame). --standing keeps the harness's own
// stand per vehicle and ends the output with one {"summary": ...} line:
// pinned (vehicle, frame) pairs standing past their mode's limit, and every
// vehicle ever held back (StandingSummary). Either flag replaces the table.
//
// The service state over a day (upgrade U2; worker/twin/service.ts judged
// exactly as production does, frame by frame, without the engine):
//   node scripts/replay-twin.mjs <frames-dir> --service-log [--expect <path>] [--every N] [--to HHMMSS]
//   node scripts/replay-twin.mjs <frames-dir> --assert-normal [--service-log] ...
// --service-log prints one line per Zagreb minute (HH:MM state ratio seen
// expected since, plus the hold) and the state changes; --expect names the
// expectation artefact (default app/public/data/zet-expect.json; the 000395
// fixture for days before 28 Sep 2026); --every keeps every Nth frame; --to
// stops after that UTC clock of the file names, inclusive; --assert-normal
// exits 1 when a judged minute reads reduced or silent, or when an hour with
// 20 or more expected has a 5th-percentile ratio below 0.65 (acceptance U2-6).
//
// The repo's TypeScript uses extensionless imports, which plain `node`
// cannot resolve; esbuild (already a dependency, pulled in by vite) bundles
// scripts/replay-core.ts -- and everything it imports from worker/ and
// shared/, plus gtfs-realtime-bindings itself (a static pbjs module, no
// dynamic requires, so it bundles cleanly) -- into one self-contained temp
// file, since that file is written outside the repo tree and could not
// resolve an external `node_modules` import from there. Node's own builtins
// (`node:fs`, `node:path`, ...) stay external automatically.
//
// No day is recorded yet (the twin is not deployed, R-TE12/D3): once the
// branch is live, a day's frames come off R2 with wrangler, one object at a
// time (there is no bulk-download command). With jq available:
//
//   mkdir -p recordings/2026/09/17
//   for key in $(npx wrangler r2 object list vidikovac-feed \
//       --prefix zet-rt/2026/09/17/ --json | jq -r '.[].key'); do
//     npx wrangler r2 object get "vidikovac-feed/$key" \
//       --file "recordings/${key#zet-rt/}"
//   done
//   node scripts/replay-twin.mjs recordings/2026/09/17
//
// or one file at a time while checking the pipeline:
//   npx wrangler r2 object get vidikovac-feed/zet-rt/2026/09/17/143000-1758112200.pb \
//     --file recordings/2026/09/17/143000-1758112200.pb

import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');

/** Bundles scripts/replay-core.ts, and everything it imports, into a
 *  throwaway, self-contained .mjs and imports it. */
async function loadCore() {
  const tmpDir = await mkdtemp(join(tmpdir(), 'replay-twin-'));
  const outfile = join(tmpDir, 'replay-core.mjs');
  try {
    await build({
      entryPoints: [join(here, 'replay-core.ts')],
      outfile,
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node18',
      logLevel: 'silent',
    });
    return await import(pathToFileURL(outfile).href);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

/** Flags that take a value: their value is never the frames directory. */
const VALUE_FLAGS = new Set(['limit', 'network', 'trips', 'overrides', 'expect', 'every', 'to']);

function parseArgs(argv) {
  const args = argv.slice(2);
  let dir;
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      if (VALUE_FLAGS.has(args[i].slice(2))) i++;
      continue;
    }
    dir ??= args[i];
  }
  const flag = (name) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : undefined;
  };
  const limitRaw = flag('limit');
  const everyRaw = flag('every');
  const to = flag('to');
  if (to !== undefined && !/^\d{6}$/.test(to)) throw new Error(`--to takes a UTC clock HHMMSS, got ${to}`);
  if (everyRaw !== undefined && !/^[1-9]\d*$/.test(everyRaw)) throw new Error(`--every takes a whole number from 1, got ${everyRaw}`);
  return {
    dir,
    limit: limitRaw !== undefined ? Number(limitRaw) : undefined,
    networkPath: flag('network'),
    tripsPath: flag('trips'),
    overridesPath: flag('overrides'),
    fleetSeries: args.includes('--fleet-series'),
    standing: args.includes('--standing'),
    serviceLog: args.includes('--service-log'),
    assertNormal: args.includes('--assert-normal'),
    expectPath: flag('expect'),
    every: everyRaw !== undefined ? Number(everyRaw) : undefined,
    to,
  };
}

async function main() {
  const { dir, limit, networkPath, tripsPath, overridesPath, fleetSeries, standing, serviceLog, assertNormal, expectPath, every, to } = parseArgs(process.argv);
  if (!dir) {
    console.error(
      'usage: node scripts/replay-twin.mjs <frames-dir> [--limit N] [--network path] [--trips path] [--overrides path] [--fleet-series] [--standing]\n' +
        '       node scripts/replay-twin.mjs <frames-dir> --service-log|--assert-normal [--expect path] [--every N] [--to HHMMSS]',
    );
    process.exitCode = 1;
    return;
  }
  const core = await loadCore();
  if (serviceLog || assertNormal) {
    const expect = await core.loadExpectIndexFile(resolve(repoRoot, expectPath ?? 'app/public/data/zet-expect.json'));
    const routes = await core.loadZetRoutesFile(resolve(repoRoot, 'app/src/data/zet-routes.json'));
    const lines = await core.replayServiceDirectory(resolve(dir), { expect, routes, every, to });
    if (serviceLog) console.log(core.formatServiceLog(lines));
    if (assertNormal) {
      const verdict = core.assertNormalDay(lines);
      for (const h of verdict.hours) console.log(`${h.hour}h p05 ${h.p05.toFixed(2)} over ${h.minutes} judged minutes`);
      if (verdict.ok) console.log(`normal day: ${lines.length} minutes, no minute outside normal, every hour's p05 at or above ${core.NORMAL_DAY_P05}`);
      else {
        for (const problem of verdict.problems) console.error(`not a normal day: ${problem}`);
        process.exitCode = 1;
      }
    }
    return;
  }
  const net = resolve(repoRoot, networkPath ?? 'app/public/data/zet-network.json');
  const trips = resolve(repoRoot, tripsPath ?? 'app/public/data/zet-trips.json');
  // The owner's dwell table (F11) reaches the replay from the same file the
  // deployed Worker serves, so the run measures the engine as it ships.
  const overrides = resolve(repoRoot, overridesPath ?? 'app/public/data/stop-dwell-overrides.json');
  const engine = await core.loadRealEngine(net, trips, overrides);
  if (fleetSeries || standing) {
    const onFrame = fleetSeries ? (frame) => process.stdout.write(`${JSON.stringify(frame)}\n`) : undefined;
    const report = await core.replayDirectory(resolve(dir), engine, { limit, onFrame, standing });
    if (standing) process.stdout.write(`${JSON.stringify({ summary: report.standing })}\n`);
    return;
  }
  const report = await core.replayDirectory(resolve(dir), engine, { limit });
  console.log(core.formatTable(report));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
