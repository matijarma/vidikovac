#!/usr/bin/env node
// Builds worker/data/street-points.json: the street index the Worker reads to put a
// utility cut or a road notice on a street (worker/feed/geo/streets.ts streetPoint).
// It is the name, the settlement, the point and the box of every street of the app's own
// street index (app/public/data/streets-geo.json), and nothing else: no lines, no register
// ids, no stops. The Worker has no other way to place a street named in a text.
//
// The streets are OpenStreetMap data (ODbL 1.0), so this file is a derived database under
// the same licence (docs/izvori.md, "Statički skupovi"); it is a build artefact of the
// Worker and is never served to the browser.
//
// Deterministic like scripts/streets-geo.mjs: no clock, no environment, rows sorted by name,
// settlement and point, so two runs over the same index write the same bytes.
//
//   node scripts/street-points.mjs                       # streets-geo.json -> worker/data/street-points.json
//   node scripts/street-points.mjs --in <file> --out <file>
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const INPUT_PATH = 'app/public/data/streets-geo.json';
export const OUTPUT_PATH = 'worker/data/street-points.json';
/** The Worker's budget for the file, bytes (the file is about 234 KB). */
export const MAX_BYTES = 240_000;
/** The columns of the wire, struct of arrays; every array has one entry per street. */
export const POINT_KEYS = ['name', 'settlement', 'lon', 'lat', 'bbox'];

const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The streets-geo wire (streets and settlements as scripts/streets-geo.mjs writes them) to the
 * street-points wire. `lon`/`lat` keep streets-geo's integer offsets in 1/pointScale of a degree
 * above `origin`, `bbox` its outward offsets in 1/shapeScale of a degree; `settlement` indexes the
 * settlement names.
 */
export function buildStreetPoints(index) {
  const { streets, settlements } = index;
  if (!streets || !Array.isArray(streets.name) || !Array.isArray(settlements) || !Array.isArray(index.origin)) {
    throw new Error('street-points: the input is not a streets-geo index');
  }
  const rows = streets.name.map((name, i) => ({
    name,
    settlement: streets.settlement[i],
    lon: streets.lon[i],
    lat: streets.lat[i],
    bbox: streets.bbox[i],
  }));
  rows.sort((a, b) =>
    compare(a.name, b.name) ||
    compare(settlements[a.settlement][1], settlements[b.settlement][1]) ||
    a.lon - b.lon ||
    a.lat - b.lat);
  return {
    version: 1,
    source: 'OpenStreetMap contributors via Protomaps zagreb-v1 (app/public/data/streets-geo.json)',
    licence: 'ODbL 1.0',
    attribution: '© OpenStreetMap contributors · Protomaps',
    origin: index.origin,
    pointScale: index.pointScale,
    shapeScale: index.shapeScale,
    settlements: settlements.map(([, settlementName]) => settlementName),
    name: rows.map((row) => row.name),
    settlement: rows.map((row) => row.settlement),
    lon: rows.map((row) => row.lon),
    lat: rows.map((row) => row.lat),
    bbox: rows.map((row) => row.bbox),
  };
}

export function serialise(points) {
  return `${JSON.stringify(points)}\n`;
}

function parseArgs(argv) {
  const args = { input: INPUT_PATH, output: OUTPUT_PATH };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--in') args.input = argv[++i];
    else if (argv[i] === '--out') args.output = argv[++i];
    else throw new Error(`street-points: unknown argument ${JSON.stringify(argv[i])}`);
  }
  if (!args.input || !args.output) throw new Error('street-points: --in and --out expect a path');
  return args;
}

export async function main({ argv = process.argv.slice(2), cwd = process.cwd(), log = console.log } = {}) {
  const args = parseArgs(argv);
  const index = JSON.parse(await readFile(resolve(cwd, args.input), 'utf8'));
  const points = buildStreetPoints(index);
  const json = serialise(points);
  const bytes = Buffer.byteLength(json, 'utf8');
  if (bytes > MAX_BYTES) {
    log(`street-points: ${bytes} bytes exceeds the ${MAX_BYTES} byte budget; nothing written`);
    process.exitCode = 1;
    return { points, bytes, written: false };
  }
  const target = resolve(cwd, args.output);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, json, 'utf8');
  log(`${points.name.length} streets in ${points.settlements.length} settlements, ${bytes} bytes -> ${args.output}`);
  return { points, bytes, written: true, target };
}

const invokedDirectly =
  typeof process.argv[1] === 'string' && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
