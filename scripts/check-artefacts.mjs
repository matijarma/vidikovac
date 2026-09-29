#!/usr/bin/env node
// Fails loudly before the committed timetable artefacts go stale: `npm run
// check:artefacts`. Two things went unnoticed in September 2026: ZET
// published feed 000396 on 28 September while the site still served 000395,
// and the last-tram files would have expired between 11 and 13 October
// without a word. This script checks, one line per check:
//
//   - that zet-network, zet-trips, zet-schema and zet-expect under
//     app/public/data/ carry the feed version app/src/motion/network-meta.ts
//     names (FEED_VERSION);
//   - that the median `validUntil` of the last-tram files
//     (app/public/data/lastrun/*.json) lies at least seven days after now,
//     reporting the count and the minimum beside it (the median, because
//     single routes end early by design and one of them must not fail the
//     whole set every week);
//   - with a HEAD of ZET's static archive, that it was not modified after
//     the artefacts were built (BUILT_AT), judged exactly as the Worker's
//     hourly watch judges it (worker/feed/static-watch.ts judgeStaticFeed).
//
// Exit 0 when everything is current; 1 when a version differs, the archive
// is newer or the median is within seven days (rebuild: npm run
// build:network, build:trips, build:schema and build:expect, and
// `node scripts/gtfs-lastrun.mjs`, then commit); 2 when the HEAD failed or
// carried no Last-Modified (unknown: run again). `--offline` skips the
// HEAD, `--now <iso>` sets the clock. Nothing is downloaded; the HEAD never
// runs inside `npm test`.

import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const STATIC_GTFS_URL = 'https://www.zet.hr/gtfs-scheduled/latest';
/** The identity scripts/gtfs-routes.mjs downloads the archive with. */
const USER_AGENT = 'Vidikovac/0.1 (zagreb.aningfilm.hr; kontakt@aningfilm.hr)';
export const HEAD_TIMEOUT_MS = 10_000;
/** The median validUntil must lie at least this far after now. */
export const LASTRUN_MARGIN_MS = 7 * 86_400_000;
export const VERSIONED_ARTEFACTS = ['zet-network.json', 'zet-trips.json', 'zet-schema.json', 'zet-expect.json'];

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** FEED_VERSION and BUILT_AT as network-meta.ts spells them, or null. */
export function readNetworkMeta(text) {
  const feedVersion = /export const FEED_VERSION = "([^"]*)"/.exec(text)?.[1] ?? null;
  const builtAt = /export const BUILT_AT = "([^"]*)"/.exec(text)?.[1] ?? null;
  return { feedVersion, builtAt };
}

/** worker/feed/static-watch.ts judgeStaticFeed, line for line: newer when
 *  the archive changed after the artefacts were built; unknown when the
 *  header is missing or unreadable, never a guess. */
export function judgeStaticFeed(lastModified, builtAt) {
  if (lastModified === null) return 'unknown';
  const modified = Date.parse(lastModified);
  const built = Date.parse(builtAt);
  if (!Number.isFinite(modified) || !Number.isFinite(built)) return 'unknown';
  return modified > built ? 'newer' : 'current';
}

/** The median of epoch-ms values: the lower middle for an even count, so it
 *  is always one file's own date. */
export function medianMs(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[(sorted.length - 1) >> 1];
}

/** validUntil of every last-tram file: the parsed values and the files
 *  without a readable one. */
export async function readLastrun(root = ROOT) {
  const dir = join(root, 'app/public/data/lastrun');
  const names = (await readdir(dir)).filter((name) => name.endsWith('.json')).sort();
  const values = [];
  const unreadable = [];
  for (const name of names) {
    let at = Number.NaN;
    try {
      at = Date.parse(JSON.parse(await readFile(join(dir, name), 'utf8')).validUntil);
    } catch {
      // counted below
    }
    if (Number.isFinite(at)) values.push(at);
    else unreadable.push(name);
  }
  return { count: names.length, values, unreadable };
}

async function headArchive() {
  try {
    const response = await fetch(STATIC_GTFS_URL, {
      method: 'HEAD',
      headers: { 'user-agent': USER_AGENT },
      redirect: 'follow',
      signal: AbortSignal.timeout(HEAD_TIMEOUT_MS),
    });
    if (!response.ok) return { error: `HTTP ${response.status}` };
    return { lastModified: response.headers.get('last-modified') };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

const iso = (ms) => new Date(ms).toISOString();

/**
 * Runs every check. `head` answers the archive's HEAD ({ lastModified } or
 * { error }); it is never called when `offline`. Returns the exit code and
 * one line per check.
 */
export async function checkArtefacts({ root = ROOT, nowMs = Date.now(), offline = false, head = headArchive } = {}) {
  const lines = [];
  let failed = false;
  let unknown = false;
  const say = (status, text) => {
    if (status === 'FAIL') failed = true;
    if (status === 'unknown') unknown = true;
    lines.push(`${status.padEnd(7)} ${text}`);
  };

  const meta = readNetworkMeta(await readFile(join(root, 'app/src/motion/network-meta.ts'), 'utf8'));
  if (meta.feedVersion === null || meta.builtAt === null || !Number.isFinite(Date.parse(meta.builtAt))) {
    say('FAIL', 'network-meta.ts: FEED_VERSION or BUILT_AT unreadable');
  } else {
    say('ok', `network-meta.ts: feed ${meta.feedVersion}, built ${meta.builtAt}`);
  }

  for (const name of VERSIONED_ARTEFACTS) {
    let version = null;
    try {
      version = JSON.parse(await readFile(join(root, 'app/public/data', name), 'utf8')).feedVersion ?? null;
    } catch {
      // reported below
    }
    if (version === null) say('FAIL', `${name}: no feedVersion`);
    else if (version !== meta.feedVersion) say('FAIL', `${name}: feed ${version}, network-meta.ts says ${meta.feedVersion}: rebuild`);
    else say('ok', `${name}: feed ${version}`);
  }

  const lastrun = await readLastrun(root);
  if (lastrun.values.length === 0) {
    say('FAIL', `lastrun: ${lastrun.count} files, none with a readable validUntil`);
  } else {
    const min = Math.min(...lastrun.values);
    const median = medianMs(lastrun.values);
    const detail = `lastrun: ${lastrun.count} files, validUntil min ${iso(min)}, median ${iso(median)}`;
    if (lastrun.unreadable.length > 0) say('FAIL', `lastrun: ${lastrun.unreadable.length} files without a readable validUntil (${lastrun.unreadable.slice(0, 3).join(', ')})`);
    if (median < nowMs + LASTRUN_MARGIN_MS) say('FAIL', `${detail}; the median is less than 7 days after ${iso(nowMs)}: rebuild the last-tram files`);
    else say('ok', `${detail}; at least 7 days after ${iso(nowMs)}`);
  }

  if (offline) {
    say('skipped', 'static archive: --offline');
  } else {
    const answer = await head(STATIC_GTFS_URL);
    if ('error' in answer) {
      say('unknown', `static archive: HEAD failed (${answer.error}): run again`);
    } else {
      const outcome = meta.builtAt === null ? 'unknown' : judgeStaticFeed(answer.lastModified ?? null, meta.builtAt);
      if (outcome === 'newer') say('FAIL', `static archive: Last-Modified ${answer.lastModified} is after BUILT_AT ${meta.builtAt}: ZET has published a newer feed, rebuild`);
      else if (outcome === 'current') say('ok', `static archive: Last-Modified ${answer.lastModified}, not after BUILT_AT ${meta.builtAt}`);
      else say('unknown', `static archive: no readable Last-Modified (${answer.lastModified ?? 'absent'}): run again`);
    }
  }

  return { code: failed ? 1 : unknown ? 2 : 0, lines };
}

async function main(argv) {
  const args = argv.slice(2);
  const offline = args.includes('--offline');
  const nowAt = args.indexOf('--now');
  let nowMs = Date.now();
  if (nowAt >= 0) {
    nowMs = Date.parse(args[nowAt + 1] ?? '');
    if (!Number.isFinite(nowMs)) {
      console.error('usage: node scripts/check-artefacts.mjs [--offline] [--now <iso>]');
      return 2;
    }
  }
  const { code, lines } = await checkArtefacts({ nowMs, offline });
  for (const line of lines) console.log(line);
  return code;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv).then((code) => {
    process.exitCode = code;
  }, (error) => {
    console.error(error);
    process.exitCode = 2;
  });
}
