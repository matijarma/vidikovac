#!/usr/bin/env node
// Type-checks the test tree (test/tsconfig.json) with the repository's own tsc
// and exits with its status. A thin runner on purpose: `npm run typecheck:tests`
// is the one name every lane's gate uses, and the program behind it (which
// config, which folders) can change here without touching package.json.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');
const result = spawnSync(process.execPath, [tsc, '--noEmit', '-p', 'test/tsconfig.json'], {
  cwd: root,
  stdio: 'inherit',
});
if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
