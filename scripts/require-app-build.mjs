// wrangler dev refuses to boot when assets.directory (app/dist) is missing and,
// on Windows, then dies on a libuv assertion (exit code 3221226505) that reads
// like a wrangler bug. Fail with a sentence instead. Used by the second
// Playwright webServer entry; the first entry runs `npm run build` itself.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { e2ePorts } from './e2e-ports.mjs';

const marker = resolve(process.cwd(), 'app/dist/index.html');
if (!existsSync(marker)) {
  console.error(`app/dist/index.html is missing. Run "npm run build" first; the :${e2ePorts().app} webServer entry does this.`);
  process.exit(1);
}
