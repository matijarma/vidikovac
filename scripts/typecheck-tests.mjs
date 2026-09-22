#!/usr/bin/env node
// Type-checks the tests, e2e/ and scripts/*.ts: `npm run typecheck:tests`.
//   node scripts/typecheck-tests.mjs                 # all programs
//   node scripts/typecheck-tests.mjs unit-worker     # only the named programs
// The tests need four TypeScript programs, not one: lib.dom and
// @cloudflare/workers-types both declare globals (Element, CacheStorage,
// Response...), and one program that loads both mistypes DOM and worker code
// alike. See the comments in test/tsconfig*.json for what each program holds.
// Before compiling, the script checks that every test file (and every .ts file
// in e2e/ and scripts/) is a root of exactly one program, so a new test cannot
// fall between them. Runs tsc once per program, one after another, prints the
// errors and a per-program count, and exits 1 when anything is red.
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(ROOT, 'package.json'));
const ts = require('typescript');
const TSC = require.resolve('typescript/bin/tsc');

const PROGRAMS = [
  { name: 'unit-dom', config: 'test/tsconfig.json' },
  { name: 'unit-worker', config: 'test/tsconfig.unit-worker.json' },
  { name: 'unit-mixed', config: 'test/tsconfig.unit-mixed.json' },
  { name: 'workers', config: 'test/tsconfig.workers.json' },
];

/** Files that must be a root of exactly one program, relative to the repo root. */
function requiredFiles() {
  const list = (dir, keep) => readdirSync(join(ROOT, dir), { recursive: true })
    .map((f) => join(dir, String(f)).split('\\').join('/'))
    .filter(keep);
  return [
    ...list('test', (f) => f.endsWith('.test.ts')),
    ...list('e2e', (f) => f.endsWith('.ts')),
    ...list('scripts', (f) => f.endsWith('.ts')),
  ].sort();
}

/** Root file names of one tsconfig, relative to the repo root. */
function rootsOf(config) {
  const path = join(ROOT, config);
  const read = ts.readConfigFile(path, ts.sys.readFile);
  if (read.error) throw new Error(`${config}: ${ts.flattenDiagnosticMessageText(read.error.messageText, '\n')}`);
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, dirname(path), undefined, path);
  return parsed.fileNames.map((f) => relative(ROOT, f).split('\\').join('/'));
}

function membership() {
  const owners = new Map();
  for (const program of PROGRAMS) {
    for (const file of rootsOf(program.config)) {
      owners.set(file, [...(owners.get(file) ?? []), program.name]);
    }
  }
  const problems = [];
  for (const file of requiredFiles()) {
    const names = owners.get(file) ?? [];
    if (names.length === 0) problems.push(`${file} is in no test program`);
    if (names.length > 1) problems.push(`${file} is in ${names.join(' and ')}`);
  }
  return problems;
}

function compile(program) {
  const started = Date.now();
  const run = spawnSync(process.execPath, [TSC, '--noEmit', '--pretty', 'false', '-p', program.config], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;
  const lines = output.split('\n').filter((line) => /\berror TS\d+:/.test(line));
  // app/, worker/ and shared/ are green under their own tsconfigs (npm run
  // typecheck); an error there means a test pulled them into the wrong program.
  const inSources = lines.filter((line) => /^(app|worker|shared)\//.test(line)).length;
  return { output, errors: lines.length, inSources, status: run.status ?? 1, seconds: (Date.now() - started) / 1000 };
}

function main(argv) {
  const wanted = argv.length ? PROGRAMS.filter((p) => argv.includes(p.name)) : PROGRAMS;
  const unknown = argv.filter((name) => !PROGRAMS.some((p) => p.name === name));
  if (unknown.length) {
    console.error(`Unknown program ${unknown.join(', ')}; known: ${PROGRAMS.map((p) => p.name).join(', ')}.`);
    return 2;
  }

  const problems = membership();
  for (const line of problems) console.error(line);

  const rows = [];
  for (const program of wanted) {
    const result = compile(program);
    if (result.output.trim()) process.stdout.write(result.output.endsWith('\n') ? result.output : `${result.output}\n`);
    rows.push({ ...program, ...result });
  }

  console.log('');
  const width = Math.max(...PROGRAMS.map((p) => p.config.length));
  for (const row of rows) {
    const verdict = row.status === 0 && row.errors === 0 ? 'ok' : 'FAILED';
    console.log(`${row.name.padEnd(12)} ${row.config.padEnd(width)} ${String(row.errors).padStart(4)} errors  ${row.seconds.toFixed(1).padStart(5)} s  ${verdict}`);
  }
  for (const row of rows.filter((r) => r.inSources > 0)) {
    console.log(`${row.name}: ${row.inSources} of the errors are in app/, worker/ or shared/, which npm run typecheck keeps green: ` +
      'a test in this program imports code written for the other library (lib.dom or workers-types); move that test to the program its imports need.');
  }
  if (problems.length) console.log(`membership: ${problems.length} test file(s) not in exactly one program`);
  const red = problems.length > 0 || rows.some((row) => row.status !== 0 || row.errors > 0);
  return red ? 1 : 0;
}

process.exitCode = main(process.argv.slice(2));
