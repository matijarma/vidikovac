#!/usr/bin/env node
// Builds the /snimka/ dataset (lanes S1 and V1, docs/snimka-2026-10.md) from the
// private recordings into review.local/snimka/build/v2/:
//   node scripts/snimka/build.mjs [--stage <name>|all] [--segment window|day-0924|day-0921] [--force] [--inputs <dir>] [--out <dir>]
// Stage names: scripts/snimka/main.ts STAGE_NAMES.
// `npm run build:snimka` is the same. Read-only against the recordings; the
// output is never committed (it is uploaded by scripts/snimka/upload.mjs).
//
// The repository's TypeScript uses extensionless imports, which plain `node`
// cannot resolve, so this bundles scripts/snimka/main.ts with esbuild into a
// throwaway file, as scripts/replay-twin.mjs bundles the replay core. sharp
// (a native module) stays external and is required from the repository.

import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');

async function loadMain() {
  const tmpDir = await mkdtemp(join(tmpdir(), 'snimka-build-'));
  const outfile = join(tmpDir, 'main.mjs');
  try {
    await build({
      entryPoints: [join(here, 'main.ts')],
      outfile,
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node20',
      logLevel: 'warning',
      // sharp is native; stage-captures loads it with a require bound to the repository.
      external: ['sharp'],
      // The voice stage runs the app's own sentence code (app/src/city), which reads Vite's env; under node it is empty,
      // as the strike seed review.local/strike/scratch/run.mjs runs it.
      define: { 'import.meta.env': '{}' },
      loader: { '.json': 'json' },
    });
    return await import(pathToFileURL(outfile).href);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

const main = await loadMain();
process.exitCode = await main.run(repoRoot, process.argv.slice(2));
