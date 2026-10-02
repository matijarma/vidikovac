#!/usr/bin/env node
// Cuts the one committed fixture of the /snimka/ dataset (lanes S1, V1) from a
// built dataset (v2 by default): one ten-minute motion chunk (by default network 396, Monday
// 28 September 2026 07:30 Zagreb, the first strike morning's peak), the build's
// manifest as a sample, and a README. Everything goes to test/fixtures/snimka/
// and stays under 20,000 bytes (the manifest is minified when an indented copy
// would bring the folder near the limit); the README's first line labels it a deviation
// fixture of the ZET strike and it carries ZET's licence sentence verbatim.
//
//   node scripts/snimka/fixture-cut.mjs [--out <build dir>] [--net 396] [--chunk 20260928-0730]

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');
const target = join(repo, 'test', 'fixtures', 'snimka');
const LIMIT = 20_000;
const LICENCE = 'Public dataset by ZET provided under Open license, dataset source http://www.zet.hr/odredbe/datoteke-u-gtfs-formatu/669';

const argv = process.argv.slice(2);
const value = (flag, fallback) => {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : fallback;
};
const main = (() => {
  try {
    return dirname(execFileSync('git', ['-C', repo, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' }).trim());
  } catch {
    return repo;
  }
})();
const out = resolve(value('--out', join(main, 'review.local', 'snimka', 'build', 'v2')));
const net = value('--net', '396');
const stamp = value('--chunk', '20260928-0730');

const dir = join(out, 'objects', 'motion', net);
const name = readdirSync(dir).find((f) => f.startsWith(`${stamp}.`) && f.endsWith('.json'));
if (!name) throw new Error(`no chunk ${stamp} of network ${net} under ${dir}`);
const chunk = readFileSync(join(dir, name));
const hash = createHash('sha256').update(chunk).digest('hex');
if (!name.includes(`.${hash.slice(0, 16)}.`)) throw new Error(`${name} does not carry its own hash`);
const manifestFile = join(out, 'objects', 'manifest.json');
if (!existsSync(manifestFile)) throw new Error(`${manifestFile} is missing: run the manifest stage first`);
const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
const parsed = JSON.parse(chunk.toString('utf8'));

mkdirSync(target, { recursive: true });
for (const f of readdirSync(target)) if (/^motion-\d{3}-\d{8}-\d{4}\.[0-9a-f]{16}\.json$/.test(f)) rmSync(join(target, f));
const chunkName = `motion-${net}-${stamp}.${hash.slice(0, 16)}.json`;
writeFileSync(join(target, chunkName), chunk);
// Indented while it fits with room to spare, minified otherwise (the README and the chunk need their share).
const NEAR = 17_000;
const indented = `${JSON.stringify(manifest, null, 1)}\n`;
const minified = indented.length + chunk.length + 2_500 >= NEAR;
writeFileSync(join(target, 'manifest.sample.json'), minified ? `${JSON.stringify(manifest)}\n` : indented);

const zagreb = (sec) => new Date((sec + 7200) * 1000).toISOString().slice(0, 16).replace('T', ' ');
const readme = `Deviation fixture: the ZET general strike of 28 to 30 September 2026. Never a normal-behaviour replay, tuning or fixture day.

# Snimka dataset sample (/snimka/, dataset v2)

One ten-minute motion chunk of the public /snimka/ dataset and the manifest of the build it came from, cut with \`node scripts/snimka/fixture-cut.mjs\` (this README is generated: edit the script, not the file). The dataset itself is built from the private recordings by \`node scripts/snimka/build.mjs\` and lives on R2, never in git.

| File | What |
|---|---|
| \`${chunkName}\` | network ${net}, ${zagreb(parsed.t0)} to ${zagreb(parsed.t0 + 600)} Zagreb, ${parsed.vehicles.length} vehicle entries, ${chunk.length} bytes; the positions the product's twin published for every 10-second tick, as metres along the paths and shapes of zet-network.json (feed 000${net}) |
| \`manifest.sample.json\` | the v2 manifest of that build (built ${manifest.builtAt}, commit ${String(manifest.build.commit).slice(0, 8)}${minified ? ', minified to keep the folder under 20,000 bytes' : ''}): the window Sun 27 Sep 20:00 to Fri 2 Oct 12:00, the comparison days ${manifest.comparisons.map((c) => c.id).join(' and ')}, ${manifest.files.boards.length} boards, ${manifest.files.exports.length} downloads, places, routes and the voice index; its other objects are not here |

Derived positions only: the raw GTFS-Realtime frames they come from are never committed and never served. ZET publishes the feed under the Croatian Open Licence (Otvorena dozvola); attribution, verbatim:

> ${LICENCE}

Read by \`test/snimka/fixture.test.ts\`.
`;
writeFileSync(join(target, 'README.md'), readme);
const total = readdirSync(target).reduce((s, f) => s + readFileSync(join(target, f)).length, 0);
if (total >= LIMIT) throw new Error(`test/fixtures/snimka/ is ${total} bytes, at or over ${LIMIT}`);
console.log(`fixture-cut: ${chunkName} (${chunk.length} B), manifest.sample.json, README.md; ${total} bytes in test/fixtures/snimka/`);
