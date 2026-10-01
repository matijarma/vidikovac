#!/usr/bin/env node
// Uploads the built /snimka/ dataset (lane S1) to R2 bucket `vidikovac-feed`
// under archive/strike-2026-09/public/v1/, the only prefix the worker route
// maps (worker/routes/snimka.ts). Reads <out>/upload-list.txt, written by the
// manifest stage: `<key>\t<bytes>\t<content type>`, hashed objects first and
// manifest.json last, which is the order of the puts, so the page never sees
// a manifest whose objects are not there yet.
//
//   node scripts/snimka/upload.mjs [--out <dir>] [--dry-run]
//       production: `cf r2 objects put` per object, then `cf r2 objects list`
//       and a size check of every key (exit 1 on a mismatch). cf runs with the
//       owner's login; CF_API_TOKEN (the read-only S3 key of .r2.env) is unset
//       for it.
//   node scripts/snimka/upload.mjs --local [--persist-to <dir>] [--subset dev] [--dry-run]
//       local R2 for `wrangler dev`: `npx wrangler r2 object put ... --local`.
//   --subset dev   only what the dev page needs to open: the manifest, both
//                  series, the stations, events, notices, news, closures, the
//                  motion index, two chunks (Mon 28 Sep 07:40 and the same time
//                  of 24 Sep), one screen run (Mon 07:45) with its kiosk capture,
//                  plus the two networks, BAJS, the screen index and the board.
//   --dry-run      print the commands, run nothing.
// `npm run snimka:upload` is the same.

import { spawnSync, execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BUCKET = 'vidikovac-feed';
export const PREFIX = 'archive/strike-2026-09/public/v1/';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');

function mainCheckout() {
  try {
    return dirname(execFileSync('git', ['-C', repo, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' }).trim());
  } catch {
    return repo;
  }
}

function parseArgs(argv) {
  const value = (flag) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const subset = value('--subset');
  if (subset !== undefined && subset !== 'dev') throw new Error(`--subset takes dev, got ${subset}`);
  return {
    out: resolve(value('--out') ?? join(mainCheckout(), 'review.local', 'snimka', 'build', 'v1')),
    local: argv.includes('--local'),
    persistTo: value('--persist-to'),
    subset: subset ?? null,
    dryRun: argv.includes('--dry-run'),
  };
}

export function readList(out) {
  const file = join(out, 'upload-list.txt');
  if (!existsSync(file)) throw new Error(`${file} is missing: run node scripts/snimka/build.mjs --stage manifest first`);
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => {
    const [key, bytes, type] = line.split('\t');
    return { key, bytes: Number(bytes), type };
  });
}

/** The dev subset, picked by the manifest's own refs. */
export function devSubset(list, manifest) {
  const f = manifest.files;
  const keep = new Set(['manifest.json', f.series.path, f.comparisonSeries.path, f.stations.path, f.events.path, f.notices.path, f.news.path, f.closures.path, f.motionIndex.path,
    f.bajs.path, f.screenIndex.path, f.board106.path, manifest.networks['395'].path, manifest.networks['396'].path]);
  const zagreb = (sec) => new Date((sec + 7200) * 1000).toISOString().slice(0, 16);
  const index = JSON.parse(readFileSync(join(manifest.__objects, f.motionIndex.path), 'utf8'));
  for (const chunk of index.chunks) if ((chunk.net === '396' && zagreb(chunk.t0) === '2026-09-28T07:40') || (chunk.net === '395' && zagreb(chunk.t0) === '2026-09-24T07:40')) keep.add(chunk.path);
  const screen = JSON.parse(readFileSync(join(manifest.__objects, f.screenIndex.path), 'utf8'));
  const run = screen.runs.find((r) => r.id === '0928-0745') ?? screen.runs[0];
  if (run) {
    keep.add(run.file.path);
    if (run.captures.kiosk) keep.add(run.captures.kiosk.path);
  }
  return list.filter((item) => keep.has(item.key));
}

function commandFor(o, item) {
  const file = join(o.out, 'objects', item.key);
  if (o.local) {
    const args = ['wrangler', 'r2', 'object', 'put', `${BUCKET}/${PREFIX}${item.key}`, '--file', file, '--content-type', item.type, '--local'];
    if (o.persistTo) args.push('--persist-to', o.persistTo);
    return { cmd: 'npx', args };
  }
  return { cmd: 'cf', args: ['r2', 'objects', 'put', `${PREFIX}${item.key}`, '--bucket-name', BUCKET, '--file', file, '--content-type', item.type] };
}

const quote = (a) => (/^[\w./:=@+-]+$/.test(a) ? a : `'${a.replaceAll("'", "'\\''")}'`);
const cfEnv = () => {
  const env = { ...process.env };
  delete env.CF_API_TOKEN;
  return env;
};

/** Every key under the prefix with its size, through cf's paginated list. */
function listRemote() {
  const sizes = new Map();
  let cursor;
  for (let page = 0; page < 1000; page++) {
    const args = ['r2', 'objects', 'list', '--bucket-name', BUCKET, '--prefix', PREFIX, '--per-page', '1000', ...(cursor ? ['--cursor', cursor] : [])];
    const res = spawnSync('cf', args, { encoding: 'utf8', env: cfEnv(), maxBuffer: 64 * 1024 * 1024 });
    if (res.status !== 0) throw new Error(`cf r2 objects list failed: ${res.stderr || res.stdout}`);
    const body = JSON.parse(res.stdout);
    const items = Array.isArray(body) ? body : body.result ?? body.objects ?? [];
    for (const o of items) sizes.set(o.key, Number(o.size));
    cursor = Array.isArray(body) ? undefined : body.cursor ?? body.result_info?.cursor;
    const truncated = Array.isArray(body) ? false : body.truncated ?? body.result_info?.is_truncated ?? false;
    if (!cursor || !truncated) break;
  }
  return sizes;
}

function main() {
  const o = parseArgs(process.argv.slice(2));
  let list = readList(o.out);
  if (list.at(-1)?.key !== 'manifest.json') throw new Error('upload-list.txt must end with manifest.json');
  if (o.subset === 'dev') {
    const manifest = JSON.parse(readFileSync(join(o.out, 'objects', 'manifest.json'), 'utf8'));
    manifest.__objects = join(o.out, 'objects');
    list = devSubset(list, manifest);
  }
  const bytes = list.reduce((s, i) => s + i.bytes, 0);
  console.log(`snimka upload: ${list.length} objects, ${bytes} bytes, ${o.local ? 'local R2' : `r2://${BUCKET}/${PREFIX}`}${o.dryRun ? ' (dry run)' : ''}`);
  for (const item of list) {
    if (!existsSync(join(o.out, 'objects', item.key))) throw new Error(`missing object ${item.key}`);
    const { cmd, args } = commandFor(o, item);
    if (o.dryRun) {
      console.log([cmd, ...args].map(quote).join(' '));
      continue;
    }
    const res = spawnSync(cmd, args, { stdio: ['ignore', 'ignore', 'inherit'], env: o.local ? process.env : cfEnv(), cwd: repo });
    if (res.status !== 0) {
      console.error(`snimka upload: ${item.key} failed (exit ${res.status}); the manifest was not uploaded`);
      process.exitCode = 1;
      return;
    }
  }
  if (o.dryRun) {
    if (!o.local) console.log(`cf r2 objects list --bucket-name ${BUCKET} --prefix ${PREFIX} --per-page 1000   # then a size check of all ${list.length} keys`);
    return;
  }
  if (o.local) return;
  const remote = listRemote();
  const wrong = list.filter((item) => remote.get(`${PREFIX}${item.key}`) !== item.bytes);
  for (const item of wrong) console.error(`size check: ${PREFIX}${item.key} is ${remote.get(`${PREFIX}${item.key}`) ?? 'absent'}, expected ${item.bytes}`);
  console.log(`size check: ${list.length - wrong.length} of ${list.length} keys match`);
  if (wrong.length > 0) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
