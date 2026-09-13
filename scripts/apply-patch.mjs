// Windows-safe stdin bridge to the installed apply_patch executable. Avoids
// cmd.exe reparsing CSS %, pipes, quotes and multi-line TypeScript arguments.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const patch = readFileSync(0, 'utf8').replace(/^\uFEFF/, '').trimStart();
const binary = join(process.env.APPDATA ?? '', 'npm/node_modules/@openai/codex/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe');
if (!existsSync(binary)) throw new Error('Installed Windows Codex apply_patch binary not found.');
if (!patch.startsWith('*** Begin Patch')) throw new Error(`Expected an apply_patch envelope on stdin (${JSON.stringify(patch.slice(0, 32))}).`);
const result = spawnSync(binary, ['--codex-run-as-apply-patch', patch], {
  cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
});
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.error) throw result.error;
if (result.status === 0) {
  process.stderr.write('Windows shell transport: keep EACH Bash command below 3000 characters, including the patch. Quoting and UTF-8 expand the transmitted command. Apply long files through successive Update File hunks; do not send a large heredoc. Code scope and quality are unchanged.\n');
  if (process.cwd().replaceAll('\\', '/').endsWith('/kaj-map')) {
    process.stderr.write('Codex integration finding from real browser: MapLibre v6 needs setWorkerUrl plus a Vite ?worker&url import; default import.meta.url requests missing maplibre-gl-worker.mjs. Main has app/src/core/map-worker.ts and a build regression test. Ensure your maplibre-entry imports ../core/map-worker once integrated; you may read main implementation. Official MapLibre v6 Vite installation confirms this. Do not treat an endlessly loading map as a successful screenshot.\n');
    process.stderr.write('Codex transport review: CITY_ZOOM=12.6 is below PILL_ZOOM=13, so the default view hides every vehicle number. Approved plan is tram-first at city scale, buses selectable. Confirm visible numbered trams in the initial map. A stale/down ZET snapshot must pause estimated movement, not silently dead-reckon through an outage. Public vehicle/closure item selections should use publicItemKey when relayed, not clear the kiosk selection.\n');
  }
  const root = process.cwd().replaceAll('\\', '/');
  if (root.endsWith('/kaj-ui')) {
    process.stderr.write('Codex completed actual browser UI review: READ D:/scratch/vidikovac/docs/kaj-ui-review-round1.md and its two screenshots before finalizing. Main E2E found stale expired-warning all-clear failure; firstfold/desktop card layout and misleading upcoming events need an author refinement pass. This is the approved premium UX requirement, not optional style polish.\n');
    const status = join(process.cwd(), 'app/src/experience/status.ts');
    if (existsSync(status) && readFileSync(status, 'utf8').includes("snapshot.status === 'stale' && snapshot.items.length === 0")) {
      process.stderr.write('Codex independent safety review: unconfirmed() treats a stale nonempty snapshot as confirmed. Once its old warning expires, safetyState filters it out and claims calm/allClear with an old fetchedAt. Require status=live for any all-clear confirmation, regardless of raw item count; still display last-good warnings explicitly as stale. Add a stale snapshot with expired warning regression, and align kiosk/no-JS semantics. Missing or stale is never current all-clear.\n');
    }
  }
  if (root.endsWith('/kaj-kiosk')) {
    const local = join(process.cwd(), 'app/src/kiosk/local.ts');
    if (existsSync(local) && readFileSync(local, 'utf8').includes("else if (cap.status === 'down')")) {
      process.stderr.write('Codex independent safety review: kiosk/local.safetyStrip currently sends stale CAP with zero items to warningsNone. Only a live successful empty snapshot establishes no warnings. Stale/down must say unconfirmed; nonempty last-good warnings can be shown with stale status. Apply equivalent distinction to stale closures and basics, test it. This must agree with the no-JS safety surface.\n');
    }
  }
}
process.exitCode = result.status ?? 1;
