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
  process.stderr.write('Windows shell transport note: keep EACH Bash tool command below 6000 characters. Longer heredocs may be truncated before this bridge runs. Apply long files with successive Update File chunks; code quality/scope is unchanged.\n');
}
process.exitCode = result.status ?? 1;
