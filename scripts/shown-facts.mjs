#!/usr/bin/env node
// What the wall showed, per hour, from an observation's rotation.jsonl (docs/reveal-2026-10.md §5.2 (g)).
//   node scripts/shown-facts.mjs <observe-folder | file.jsonl> [--json <path>]
// Prints the Markdown report of scripts/lib/shown-facts.mjs (its header says what counts as transit and why) and writes
// the same measurement as JSON with --json. Exit 0 after a measurement, 2 with a usage line when the folder or its
// rotation.jsonl is missing or holds no valid reading.
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { shownFacts, shownFactsMarkdown } from './lib/shown-facts.mjs';

const USAGE = 'usage: node scripts/shown-facts.mjs <observe-folder | file.jsonl> [--json <path>]';

export async function main({ argv = process.argv.slice(2), log = console.log } = {}) {
  let target = null;
  let jsonPath = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--json') jsonPath = argv[++i] ?? null;
    else if (!argv[i].startsWith('--') && target === null) target = argv[i];
    else {
      log(USAGE);
      process.exitCode = 2;
      return null;
    }
  }
  if (!target || (argv.includes('--json') && !jsonPath)) {
    log(USAGE);
    process.exitCode = 2;
    return null;
  }
  const path = resolve(target);
  const file = existsSync(path) && statSync(path).isDirectory() ? join(path, 'rotation.jsonl') : path;
  if (!existsSync(file) || statSync(file).isDirectory()) {
    log(`${USAGE}\nno rotation.jsonl at ${file}`);
    process.exitCode = 2;
    return null;
  }
  const readings = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      readings.push(JSON.parse(line));
    } catch {
      readings.push({ error: 'malformed line' });
    }
  }
  const result = shownFacts(readings);
  if (result.readings === 0) {
    log(`${USAGE}\nno valid reading in ${file}`);
    process.exitCode = 2;
    return null;
  }
  const title = file === path ? basename(file) : basename(path);
  log(shownFactsMarkdown(result, title));
  if (jsonPath) writeFileSync(resolve(jsonPath), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}

const invokedDirectly =
  typeof process.argv[1] === 'string' && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
