#!/usr/bin/env node
// The wrong-branch grader (WP6 step 2): replays a directory of recorded ZET
// frames through the twin's production `runTick` (worker/twin/tick.ts) and
// counts, per vehicle per tick, every change of the matched rail path within
// an unchanged trip, with the matcher state that led to it, the client
// integrator's re-seed displacement when the new path reaches the page, and
// the WP0 acceptance rows (A to H, U, S, I) judged against a stage's targets.
// The core is scripts/grade-branches-core.ts, a port of the review-only
// grader review.local/companion/replay/grade-branches.mjs that takes the same
// arguments, so the two stay comparable on the same frames.
//
// Bundling: exactly as scripts/replay-twin.mjs does, esbuild bundles the core
// together with everything it imports from scripts/, worker/, shared/ and
// app/src/ into one throwaway .mjs and imports it (the repo's TypeScript uses
// extensionless imports plain `node` cannot resolve; gtfs-realtime-bindings is
// bundled in too, Node builtins stay external).
//
// Usage:
//   npm run replay:grade -- <frames-dir> --out <prefix> \
//       [--targets stage1|stage2|none] [--limit N] [--client-hz 4] [--label text] \
//       [--network app/public/data/zet-network.json] [--trips app/public/data/zet-trips.json] \
//       [--overrides app/public/data/stop-dwell-overrides.json] [--stops app/public/data/stops.json]
//
//   npm run replay:grade -- test/fixtures/frames/2026-09-21-1715-1744 --out /tmp/wrong-turn --targets stage1
//
// Writes <prefix>.json (events and aggregates) and <prefix>.md (the tables);
// when --out names an existing directory (or ends in /), the prefix is
// <dir>/<frames-dir name>. Prints the summary and the acceptance rows. Exit
// code: 0 done (and, with --targets, every judged row met), 1 a judged row
// failed or the run failed, 2 bad arguments.

import { build } from 'esbuild';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');

/** Bundles scripts/grade-branches-core.ts, and everything it imports, into a
 *  throwaway, self-contained .mjs and imports it. */
async function loadCore() {
  const tmpDir = await mkdtemp(join(tmpdir(), 'grade-branches-'));
  const outfile = join(tmpDir, 'grade-branches-core.mjs');
  try {
    await build({
      entryPoints: [join(here, 'grade-branches-core.ts')],
      outfile,
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node18',
      logLevel: 'silent',
      absWorkingDir: repoRoot,
    });
    return await import(pathToFileURL(outfile).href);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

const VALUE_FLAGS = ['out', 'limit', 'client-hz', 'network', 'trips', 'overrides', 'stops', 'label', 'targets'];

export function parseArgs(argv) {
  const args = argv.slice(2);
  const errors = [];
  const values = {};
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const name = arg.slice(2);
    if (!VALUE_FLAGS.includes(name)) {
      errors.push(`unknown flag ${arg}`);
      continue;
    }
    if (args[i + 1] === undefined) {
      errors.push(`${arg} needs a value`);
      continue;
    }
    values[name] = args[++i];
  }
  if (positional.length !== 1) errors.push(positional.length === 0 ? 'the frames directory is missing' : `one frames directory, got ${positional.join(' ')}`);
  if (values.out === undefined) errors.push('--out <prefix> is required');
  const number = (name, fallback) => {
    if (values[name] === undefined) return fallback;
    const n = Number(values[name]);
    if (!Number.isInteger(n) || n < 0) errors.push(`--${name} takes a whole number, got ${values[name]}`);
    return n;
  };
  const targets = values.targets ?? 'none';
  if (!['stage1', 'stage2', 'none'].includes(targets)) errors.push(`--targets takes stage1, stage2 or none, got ${targets}`);
  return {
    errors,
    dir: positional[0],
    out: values.out,
    limit: number('limit', undefined),
    clientHz: number('client-hz', 4),
    networkPath: values.network,
    tripsPath: values.trips,
    overridesPath: values.overrides,
    stopsPath: values.stops,
    label: values.label,
    targets,
  };
}

/** The output prefix: as given, or <dir>/<frames-dir name> when --out names a directory. */
async function outPrefix(out, framesDir) {
  const path = resolve(out);
  if (out.endsWith('/')) return join(path, basename(resolve(framesDir)));
  try {
    if ((await stat(path)).isDirectory()) return join(path, basename(resolve(framesDir)));
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  return path;
}

const USAGE = 'usage: npm run replay:grade -- <frames-dir> --out <prefix> [--targets stage1|stage2|none] [--limit N] [--client-hz 4] [--label text] [--network p] [--trips p] [--overrides p] [--stops p]';

async function main() {
  const opts = parseArgs(process.argv);
  if (opts.errors.length > 0) {
    for (const line of opts.errors) console.error(`grade-branches: ${line}`);
    console.error(USAGE);
    process.exitCode = 2;
    return;
  }
  const artefact = (given, fallback) => (given !== undefined ? resolve(given) : join(repoRoot, fallback));
  const core = await loadCore();
  const engine = await core.loadRealEngine(
    artefact(opts.networkPath, 'app/public/data/zet-network.json'),
    artefact(opts.tripsPath, 'app/public/data/zet-trips.json'),
    artefact(opts.overridesPath, 'app/public/data/stop-dwell-overrides.json'),
  );
  const report = await core.gradeDirectory(resolve(opts.dir), engine, {
    limit: opts.limit,
    clientHz: opts.clientHz,
    stopsPath: artefact(opts.stopsPath, 'app/public/data/stops.json'),
    label: opts.label ?? opts.dir,
    log: (line) => console.error(line),
  });
  const prefix = await outPrefix(opts.out, opts.dir);
  await core.writeReport(report, prefix);
  console.log(core.formatSummary(report));
  console.log('');
  const rows = core.acceptanceRows(report);
  const targets = opts.targets === 'none' ? null : core.ACCEPTANCE_TARGETS[opts.targets];
  console.log(core.formatRows(rows, targets));
  console.log(`\nwrote ${prefix}.json and ${prefix}.md`);
  if (targets && !core.judge(rows, targets).ok) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
