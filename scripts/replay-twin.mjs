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

function parseArgs(argv) {
  const args = argv.slice(2);
  const dir = args.find((a) => !a.startsWith('--'));
  const flag = (name) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : undefined;
  };
  const limitRaw = flag('limit');
  return {
    dir,
    limit: limitRaw !== undefined ? Number(limitRaw) : undefined,
    networkPath: flag('network'),
    tripsPath: flag('trips'),
  };
}

async function main() {
  const { dir, limit, networkPath, tripsPath } = parseArgs(process.argv);
  if (!dir) {
    console.error('usage: node scripts/replay-twin.mjs <frames-dir> [--limit N] [--network path] [--trips path]');
    process.exitCode = 1;
    return;
  }
  const core = await loadCore();
  const net = resolve(repoRoot, networkPath ?? 'app/public/data/zet-network.json');
  const trips = resolve(repoRoot, tripsPath ?? 'app/public/data/zet-trips.json');
  const engine = await core.loadRealEngine(net, trips);
  const report = await core.replayDirectory(resolve(dir), engine, { limit });
  console.log(core.formatTable(report));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
