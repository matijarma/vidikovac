#!/usr/bin/env node
// Uploads the built /snimka/ dataset v2 (lanes S1 and V1) to R2 bucket
// `vidikovac-feed` under archive/strike-2026-09/public/v2/, the prefix the
// worker route maps for /api/snimka/v2/ (worker/routes/snimka.ts). Reads
// <out>/upload-list.txt, written by the manifest stage: `<key>\t<bytes>\t<content
// type>`, hashed objects first and manifest.json last. The hashed objects go up
// `--jobs` at a time; manifest.json only after every one of them succeeded, so
// the page never sees a manifest whose objects are not there yet.
//
//   node scripts/snimka/upload.mjs [--out <dir>] [--jobs N] [--dry-run]
//       production: `cf r2 objects put` per object, N at a time (default 4; the
//       local R2 always one at a time),
//       then `cf r2 objects list` (paginated) and a size check of every key
//       (exit 1 on a mismatch). cf runs with the owner's login; CF_API_TOKEN
//       (the read-only S3 key of .r2.env) is unset for it.
//   node scripts/snimka/upload.mjs --list-only [--prefix P]
//       read-only: lists every key under the prefix (default the v2 prefix)
//       through the same paginated listing and prints the count.
//   node scripts/snimka/upload.mjs --local [--persist-to <dir>] [--subset dev] [--dry-run]
//       local R2 for `wrangler dev`: `npx wrangler r2 object put ... --local`.
//   --subset dev   only what the dev page needs to open: the manifest, the three
//                  series, the window routes, places, events, notices, news,
//                  closures, stations, BAJS, the motion index, the chunks of
//                  Mon 28 Sep 07:40 (396) and 07:40 of both normal days (395),
//                  the screen index with run 0928-0745 and its kiosk capture,
//                  board 106_1, the voice index with the Monday voice day,
//                  opis and series.csv, both networks.
//   --dry-run      print the commands, run nothing.
// `npm run snimka:upload` is the same.

import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BUCKET = 'vidikovac-feed';
export const PREFIX = 'archive/strike-2026-09/public/v2/';

/** Content types by extension, as the manifest stage writes them (scripts/snimka/paths.ts CONTENT_TYPES). */
export const CONTENT_TYPES = { json: 'application/json', webp: 'image/webp', csv: 'text/csv; charset=utf-8', geojson: 'application/geo+json' };
export function contentTypeOf(key) {
  const type = CONTENT_TYPES[key.slice(key.lastIndexOf('.') + 1)];
  if (!type) throw new Error(`no content type for ${key}`);
  return type;
}

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
  const jobs = Number(value('--jobs') ?? 4);
  if (!Number.isInteger(jobs) || jobs < 1 || jobs > 16) throw new Error(`--jobs takes 1 to 16, got ${value('--jobs')}`);
  return {
    out: resolve(value('--out') ?? join(mainCheckout(), 'review.local', 'snimka', 'build', 'v2')),
    jobs,
    listOnly: argv.includes('--list-only'),
    prefix: value('--prefix') ?? PREFIX,
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
    return { key, bytes: Number(bytes), type: type || contentTypeOf(key) };
  });
}

/** The dev subset, picked by the manifest's own refs. */
export function devSubset(list, manifest) {
  const f = manifest.files;
  const keep = new Set(['manifest.json', f.series.path, ...manifest.comparisons.map((c) => c.files.series.path), f.routes.path, f.places.path, f.events.path, f.notices.path, f.news.path,
    f.closures.path, f.stations.path, f.bajs.path, f.motionIndex.path, f.screenIndex.path, f.voiceIndex.path, f.opis.path, manifest.networks['395'].path, manifest.networks['396'].path]);
  const board = f.boards.find((b) => b.stop === '106_1');
  if (board) keep.add(board.path);
  const series = f.exports.find((e) => e.name === 'series');
  if (series) keep.add(series.path);
  const zagreb = (sec) => new Date((sec + 7200) * 1000).toISOString().slice(0, 16);
  const index = JSON.parse(readFileSync(join(manifest.__objects, f.motionIndex.path), 'utf8'));
  const chunkTimes = { '396': ['2026-09-28T07:40'], '395': ['2026-09-24T07:40', '2026-09-21T07:40'] };
  for (const chunk of index.chunks) if (chunkTimes[chunk.net].includes(zagreb(chunk.t0))) keep.add(chunk.path);
  const screen = JSON.parse(readFileSync(join(manifest.__objects, f.screenIndex.path), 'utf8'));
  const run = screen.runs.find((r) => r.id === '0928-0745') ?? screen.runs[0];
  if (run) {
    keep.add(run.file.path);
    if (run.captures.kiosk) keep.add(run.captures.kiosk.path);
  }
  const voice = JSON.parse(readFileSync(join(manifest.__objects, f.voiceIndex.path), 'utf8'));
  const monday = voice.days.find((d) => d.day === '2026-09-28');
  if (monday) keep.add(monday.file.path);
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
export function listRemote(prefix = PREFIX) {
  const sizes = new Map();
  const perPage = 1000;
  let cursor;
  let startAfter;
  for (let page = 0; page < 1000; page++) {
    // `cf r2 objects list` prints a bare, key-sorted array with no cursor: paginate by keyset (`--start-after` the
    // last key of a full page). A body with a cursor (an object) still paginates by cursor.
    const args = ['r2', 'objects', 'list', '--bucket-name', BUCKET, '--prefix', prefix, '--per-page', String(perPage),
      ...(cursor ? ['--cursor', cursor] : []), ...(!cursor && startAfter ? ['--start-after', startAfter] : [])];
    const res = spawnSync('cf', args, { encoding: 'utf8', env: cfEnv(), maxBuffer: 64 * 1024 * 1024 });
    if (res.status !== 0) throw new Error(`cf r2 objects list failed: ${res.stderr || res.stdout}`);
    const body = JSON.parse(res.stdout);
    const items = Array.isArray(body) ? body : body.result ?? body.objects ?? [];
    for (const o of items) sizes.set(o.key, Number(o.size));
    if (Array.isArray(body)) {
      if (items.length < perPage) break;
      startAfter = items[items.length - 1].key;
      continue;
    }
    cursor = body.cursor ?? body.result_info?.cursor;
    const truncated = body.truncated ?? body.result_info?.is_truncated ?? false;
    if (!cursor || !truncated) break;
  }
  return sizes;
}

/** One put, as a promise of its exit code. */
function put(o, item) {
  const { cmd, args } = commandFor(o, item);
  return new Promise((resolvePut) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'inherit'], env: o.local ? process.env : cfEnv(), cwd: repo });
    child.on('error', () => resolvePut(1));
    child.on('close', (code) => resolvePut(code ?? 1));
  });
}

/** Every item but the last N at a time; the first failure stops new puts. */
async function putAll(o, items) {
  let next = 0;
  let failed = null;
  let done = 0;
  const worker = async () => {
    while (failed === null && next < items.length) {
      const item = items[next++];
      const code = await put(o, item);
      if (code !== 0) failed ??= { item, code };
      done++;
      if (done % 100 === 0) console.log(`snimka upload: ${done} of ${items.length}`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(o.jobs, items.length) }, worker));
  return failed;
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  // The local R2 is one miniflare store on disk: concurrent `wrangler r2 object put --local` processes crash its
  // workerd, so local puts go one at a time.
  if (o.local) o.jobs = 1;
  if (o.listOnly) {
    const remote = listRemote(o.prefix);
    console.log(`snimka list: ${remote.size} keys under r2://${BUCKET}/${o.prefix}`);
    return;
  }
  let list = readList(o.out);
  if (list.at(-1)?.key !== 'manifest.json') throw new Error('upload-list.txt must end with manifest.json');
  if (o.subset === 'dev') {
    const manifest = JSON.parse(readFileSync(join(o.out, 'objects', 'manifest.json'), 'utf8'));
    manifest.__objects = join(o.out, 'objects');
    list = devSubset(list, manifest);
  }
  const bytes = list.reduce((s, i) => s + i.bytes, 0);
  console.log(`snimka upload: ${list.length} objects, ${bytes} bytes, ${o.local ? 'local R2' : `r2://${BUCKET}/${PREFIX}`}, ${o.jobs} at a time${o.dryRun ? ' (dry run)' : ''}`);
  for (const item of list) if (!existsSync(join(o.out, 'objects', item.key))) throw new Error(`missing object ${item.key}`);
  if (o.dryRun) {
    for (const item of list) {
      const { cmd, args } = commandFor(o, item);
      console.log([cmd, ...args].map(quote).join(' '));
    }
    if (!o.local) console.log(`cf r2 objects list --bucket-name ${BUCKET} --prefix ${PREFIX} --per-page 1000   # paginated, then a size check of all ${list.length} keys`);
    return;
  }
  const manifestItem = list.at(-1);
  const failed = await putAll(o, list.slice(0, -1));
  if (failed) {
    console.error(`snimka upload: ${failed.item.key} failed (exit ${failed.code}); the manifest was not uploaded`);
    process.exitCode = 1;
    return;
  }
  if ((await put(o, manifestItem)) !== 0) {
    console.error('snimka upload: manifest.json failed; every other object is up');
    process.exitCode = 1;
    return;
  }
  if (o.local) return;
  const remote = listRemote();
  const wrong = list.filter((item) => remote.get(`${PREFIX}${item.key}`) !== item.bytes);
  for (const item of wrong) console.error(`size check: ${PREFIX}${item.key} is ${remote.get(`${PREFIX}${item.key}`) ?? 'absent'}, expected ${item.bytes}`);
  console.log(`size check: ${list.length - wrong.length} of ${list.length} keys match`);
  if (wrong.length > 0) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
