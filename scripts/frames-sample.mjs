#!/usr/bin/env node
// Cuts a small, committable sample out of a day of recorded ZET GTFS-RT
// frames (worker/twin/record.ts: `zet-rt/YYYY/MM/DD/HHMMSS-<headerTs>.pb`,
// UTC, pulled off R2 with the wrangler loop in scripts/replay-twin.mjs), so
// the tram-path acceptance test can replay real frames on any machine
// without the full recordings (hundreds of MB a day), which R2 keeps for
// seven days only.
//
// Usage:
//   node scripts/frames-sample.mjs <frames-dir> --from HHMMSS --to HHMMSS --out <dir>
//     [--all-modes] [--keep-alerts] [--every N] [--lead <line>] [--use <text>]
//   node scripts/frames-sample.mjs --readme-only <fixture-dir>
// README-only reads the existing frames and cut provenance; it never writes
// or removes a frame or expectation file and does not need the recordings.
//
// The window is inclusive and in UTC, read from the file names (the recorder
// derives HHMMSS from the header timestamp, so name and header agree). Each
// frame is decoded with gtfs-realtime-bindings, reduced to the entities
// whose vehicle or trip update runs a tram route (`type === 0` in
// app/src/data/zet-routes.json), and re-encoded with the same library from
// its own header and the kept entities in their original order: no
// reshaping, so worker/twin/feed-decode.ts reads the result exactly as it
// reads ZET's bytes. `--all-modes` copies the frames unchanged instead.
// `--keep-alerts` also keeps every Alert entity (an Alert has no route of
// its own) unchanged in the tram-only re-encode; with `--all-modes` the
// alerts are among the unchanged bytes anyway. The original file names are
// kept and frames stay at their recorded cadence (the matcher needs
// consecutive fixes) unless `--every N` keeps only the first frame of the
// window and every Nth after it, by name order, for a long window at a
// fraction of the bytes. A README.md with the provenance, the ZET licence
// sentence, the filter, the flags and the byte total is written next to
// them; `--lead` puts one line above its heading (a warning such as
// "Deviation fixture: ..."), `--use` replaces its grading section with a
// "What it is for" paragraph naming the tests that read the sample, and
// `--readme-only` keeps both. Stale `.pb` files already in <dir> are
// removed, so the directory always holds exactly one window.
//
// Refusals (exit 2, nothing written or removed): an --out anywhere under a
// directory named `recordings` (.gitignore ignores `recordings/` at any
// depth, and a sample git cannot see is no fixture), an --out that is the
// input directory or anywhere inside it, a dangling symlink as --out, a
// destination file that is a symlink, a malformed or inverted window. The
// paths are compared after resolving symlinks on every existing component,
// so a link cannot smuggle the output into a recording and the stale-frame
// cleanup can never reach the input's frames. Any other failure exits 1.
//
// The committed sample is a repository test fixture only [O-73]: never
// served by the Worker (its static assets are app/dist) and never
// downloaded by a client.
import GtfsRealtimeBindings from 'gtfs-realtime-bindings';
import { constants, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { lstat, mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const FeedMessage = GtfsRealtimeBindings.transit_realtime.FeedMessage;

export const ROUTES_PATH = 'app/src/data/zet-routes.json';
export const TRIPS_PATH = 'app/public/data/zet-trips.json';
export const NETWORK_PATH = 'app/public/data/zet-network.json';
/** GTFS route_type of a tram. */
export const TRAM_ROUTE_TYPE = 0;
/** A recorded frame's file name: UTC time of the header, then the header timestamp itself. */
export const FRAME_NAME = /^(\d{6})-(\d+)\.pb$/;
/** The directory name .gitignore ignores at any depth; a sample under it never reaches git. */
export const IGNORED_DIR = 'recordings';
export const ZET_RT_URL = 'https://www.zet.hr/gtfs-rt-protobuf';
/** The attribution docs/izvori.md gives for the `zet-rt` source, verbatim. */
export const ZET_ATTRIBUTION =
  'Public dataset by ZET provided under Open license, dataset source http://www.zet.hr/odredbe/datoteke-u-gtfs-formatu/669';

const ZAGREB_TZ = 'Europe/Zagreb';
const USAGE =
  'usage: node scripts/frames-sample.mjs <frames-dir> --from HHMMSS --to HHMMSS --out <dir>\n' +
  '         [--all-modes] [--keep-alerts] [--every N] [--lead <line>] [--use <text>]\n' +
  '       node scripts/frames-sample.mjs --readme-only <fixture-dir>';
/** Options that take a value. */
const VALUED = new Set(['--from', '--to', '--out', '--every', '--lead', '--use']);
const CANCELED = GtfsRealtimeBindings.transit_realtime.TripDescriptor.ScheduleRelationship.CANCELED;
const EFFECT = GtfsRealtimeBindings.transit_realtime.Alert.Effect;

/** A refusal: nothing was read or written, the caller exits 2. */
export class SampleRefusal extends Error {
  constructor(message) {
    super(message);
    this.name = 'SampleRefusal';
    this.exitCode = 2;
  }
}

/** `HHMMSS` with a real clock time (00:00:00 to 23:59:59), or null. */
export function parseClock(text) {
  if (typeof text !== 'string' || !/^\d{6}$/.test(text)) return null;
  const h = Number(text.slice(0, 2));
  const m = Number(text.slice(2, 4));
  const s = Number(text.slice(4, 6));
  return h <= 23 && m <= 59 && s <= 59 ? text : null;
}

/** `--every`: a whole number from 1 to 9999, or null. */
export function parseEvery(text) {
  return typeof text === 'string' && /^[1-9]\d{0,3}$/.test(text) ? Number(text) : null;
}

/**
 * A README line given on the command line (`--lead`, `--use`): one line of
 * text that --readme-only can find again, so no heading, table row or line
 * break.
 */
function readmeText(flag, value) {
  if (value === null) return null;
  const text = value.trim();
  if (text === '' || /[\r\n]/.test(text) || /^[#|]/.test(text)) {
    throw new SampleRefusal(`${flag} must be one line of text that is not a heading or a table row\n${USAGE}`);
  }
  return text;
}

export function parseArgs(argv) {
  if (argv.includes('--readme-only')) {
    if (argv.length !== 2 || argv[0] !== '--readme-only' || argv[1].startsWith('--')) {
      throw new SampleRefusal(`--readme-only needs one <fixture-dir> and no cutting flags\n${USAGE}`);
    }
    return { input: argv[1], out: argv[1], readmeOnly: true };
  }
  const positional = [];
  const flags = { from: null, to: null, out: null, every: '1', lead: null, use: null, allModes: false, keepAlerts: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--all-modes') flags.allModes = true;
    else if (arg === '--keep-alerts') flags.keepAlerts = true;
    else if (VALUED.has(arg)) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) throw new SampleRefusal(`${arg} needs a value\n${USAGE}`);
      flags[arg.slice(2)] = value;
      i += 1;
    } else if (arg.startsWith('--')) throw new SampleRefusal(`unknown option ${arg}\n${USAGE}`);
    else positional.push(arg);
  }
  if (positional.length !== 1) throw new SampleRefusal(`expected one <frames-dir>, got ${positional.length}\n${USAGE}`);
  if (flags.out === null) throw new SampleRefusal(`--out is required\n${USAGE}`);
  const from = parseClock(flags.from);
  const to = parseClock(flags.to);
  if (from === null || to === null) throw new SampleRefusal(`--from and --to must be UTC clock times HHMMSS\n${USAGE}`);
  if (from > to) throw new SampleRefusal(`--from ${from} is after --to ${to} (a window cannot cross midnight)`);
  const every = parseEvery(flags.every);
  if (every === null) throw new SampleRefusal(`--every must be a whole number from 1 to 9999, got ${flags.every}\n${USAGE}`);
  return {
    input: positional[0], from, to, out: flags.out, allModes: flags.allModes, keepAlerts: flags.keepAlerts, every,
    lead: readmeText('--lead', flags.lead), use: readmeText('--use', flags.use),
  };
}

/** Refused writes never follow a symlink, even one created after the checks. */
const WRITE_FLAGS = constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | (constants.O_NOFOLLOW ?? 0);

function isMissing(err) {
  return err?.code === 'ENOENT' || err?.code === 'ENOTDIR';
}

/**
 * The real path of `path`: symlinks resolved on its longest existing
 * prefix, the components that do not exist yet appended as written (they
 * cannot be links). Null for a dangling symlink, whose target cannot be
 * judged.
 */
export function realPathOf(path) {
  let head = resolve(path);
  const tail = [];
  for (;;) {
    try {
      return join(realpathSync(head), ...tail);
    } catch (err) {
      if (!isMissing(err)) throw err;
      try {
        if (lstatSync(head).isSymbolicLink()) return null;
      } catch (inner) {
        if (!isMissing(inner)) throw inner;
      }
      const parent = dirname(head);
      if (parent === head) return resolve(path);
      tail.unshift(basename(head));
      head = parent;
    }
  }
}

function underIgnoredDir(path) {
  return path.split(sep).some((segment) => segment.toLowerCase() === IGNORED_DIR);
}

/** True when `path` is `root` or lies inside it. */
function within(path, root) {
  const rel = relative(root, path);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

/** Why `out` must not be written, or null. Both paths are compared as written and after resolving symlinks. */
export function refusalFor(out, input) {
  const realOut = realPathOf(out);
  if (realOut === null) return `refusing --out ${out}: it is a symlink to nothing, so where the sample would land cannot be checked`;
  if (underIgnoredDir(resolve(out)) || underIgnoredDir(realOut)) {
    return `refusing --out ${out}: it lies under a "${IGNORED_DIR}/" directory, which .gitignore ignores at any depth, so the sample could never be committed`;
  }
  const realIn = input === undefined ? null : realPathOf(input) ?? resolve(input);
  if (realIn !== null && (within(realOut, realIn) || within(resolve(out), resolve(input)))) {
    return `refusing --out ${out}: it is the input directory or inside it, and the sample would write into the recording`;
  }
  return null;
}

/** Why one of the files the run writes cannot be written, or null: a symlinked destination would be written through. */
async function destinationRefusal(out, names) {
  for (const name of names) {
    try {
      if ((await lstat(resolve(out, name))).isSymbolicLink()) {
        return `refusing to write ${join(out, name)}: it is a symlink, and the sample would be written through it`;
      }
    } catch (err) {
      if (!isMissing(err)) throw err;
    }
  }
  return null;
}

/** The frame names inside the inclusive UTC window, in time order. */
export function selectFrames(names, from, to) {
  return names
    .filter((name) => {
      const m = FRAME_NAME.exec(name);
      return m !== null && m[1] >= from && m[1] <= to;
    })
    .sort();
}

/** The first of `names` and every `n`th after it, in their order. */
export function everyNth(names, n) {
  return names.filter((_, i) => i % n === 0);
}

export function tramRouteIds(routes) {
  return new Set(
    Object.entries(routes)
      .filter(([, route]) => route?.type === TRAM_ROUTE_TYPE)
      .map(([id]) => id),
  );
}

/** Front-coded trip ids of zet-trips.json (the inverse shared/motion/trips.ts applies). */
export function tripIdsOf(trips) {
  const common = trips?.trips?.idCommon ?? [];
  const suffix = trips?.trips?.idSuffix ?? [];
  const ids = new Set();
  let prev = '';
  for (let i = 0; i < suffix.length; i++) {
    const id = prev.slice(0, common[i]) + suffix[i];
    ids.add(id);
    prev = id;
  }
  return ids;
}

function routeOf(entity) {
  return entity.vehicle?.trip?.routeId || entity.tripUpdate?.trip?.routeId || '';
}

/** Decodes one frame and keeps the entities `keep(routeId, entity)` accepts, in order. */
export function filterFrame(bytes, keep) {
  const feed = FeedMessage.decode(bytes);
  const kept = feed.entity.filter((entity) => keep(routeOf(entity), entity));
  const out = FeedMessage.encode({ header: feed.header, entity: kept }).finish();
  return { bytes: out, headerTs: Number(String(feed.header?.timestamp ?? 0)), entities: feed.entity.length, kept };
}

function thousands(n) {
  return n.toLocaleString('en-US');
}

function utcDay(headerTs) {
  return new Date(headerTs * 1000).toISOString().slice(0, 10);
}

/** 1st, 2nd, 3rd, 4th, 11th, 21st. */
function ordinal(n) {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' })[n % 10] ?? 'th';
  return `${n}${suffix}`;
}

function clockText(hhmmss) {
  return `${hhmmss.slice(0, 2)}:${hhmmss.slice(2, 4)}:${hhmmss.slice(4, 6)}`;
}

function zagrebClock(ms) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: ZAGREB_TZ,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(ms));
}

function zagrebDate(ms) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ZAGREB_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
}

function zagrebOffset(ms) {
  const name = new Intl.DateTimeFormat('en-GB', { timeZone: ZAGREB_TZ, timeZoneName: 'shortOffset' })
    .formatToParts(new Date(ms))
    .find((part) => part.type === 'timeZoneName');
  return name ? name.value.replace('GMT', 'UTC') : ZAGREB_TZ;
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)];
}

/** Deterministic for the fixture and current artefact, not the graph at the original cut. */
export function renderReadme(s, networkPath = NETWORK_PATH) {
  const network = JSON.parse(readFileSync(networkPath, 'utf8'));
  const dayStart = Date.parse(`${s.day}T00:00:00Z`);
  const at = (hhmmss) => dayStart + (Number(hhmmss.slice(0, 2)) * 3600 + Number(hhmmss.slice(2, 4)) * 60 + Number(hhmmss.slice(4, 6))) * 1000;
  const localFrom = zagrebClock(at(s.from));
  const localTo = zagrebClock(at(s.to));
  const zagrebDay = zagrebDate(at(s.from));
  const every = s.every ?? 1;
  const dropped = s.keepAlerts
    ? ' or when it is an Alert, which has no route of its own and is kept unchanged whatever it informs; buses and reports without a route are dropped.'
    : '; buses, alerts and reports without a route are dropped.';
  const filter = s.allModes
    ? `none: every entity of every frame, bytes copied unchanged (\`--all-modes\`).${s.keepAlerts ? ' `--keep-alerts` adds nothing here: the Alert entities are among the unchanged bytes.' : ''}`
    : `tram only${s.keepAlerts ? ', plus every Alert entity (`--keep-alerts`)' : ''}. An entity is kept when its \`vehicle.trip.routeId\` or \`tripUpdate.trip.routeId\` is a tram route (\`type === ${TRAM_ROUTE_TYPE}\` in \`${ROUTES_PATH}\`, ${s.tramRoutes.length} ids: ${s.tramRoutes.join(', ')})${dropped} Each frame is decoded and re-encoded with \`gtfs-realtime-bindings\` from its own header and the kept entities in their original order, so \`worker/twin/feed-decode.ts\` reads it as ZET's own bytes.`;
  const cadence = every > 1
    ? `every ${ordinal(every)} recorded frame of the window's ${thousands(s.windowFrames)} (\`--every ${every}\`): header gap median ${s.medianGapS ?? 'n/a'} s, max ${s.maxGapS ?? 'n/a'} s`
    : `header gap median ${s.medianGapS ?? 'n/a'} s, max ${s.maxGapS ?? 'n/a'} s, as recorded`;
  const effects = Object.entries(s.alertEffects ?? {}).map(([name, n]) => `${name} ${thousands(n)}`).join(', ');
  const signals = `CANCELED trip updates ${thousands(s.canceledUpdates ?? 0)} (distinct trips ${s.canceledTrips ?? 0}); Alert entities ${thousands(s.alertEntities ?? 0)} (distinct ids ${s.alertIds ?? 0}${effects ? `; by effect ${effects}` : ''})`;
  const extraFlags = [s.lead && ['`--lead`', 'first line'], s.use && ['`--use`', '"What it is for" paragraph']].filter(Boolean);
  const join = s.tripReports > 0
    ? `${thousands(s.tripReportsJoined)} of ${thousands(s.tripReports)} tram reports with a trip id (${(100 * s.tripReportsJoined / s.tripReports).toFixed(3)} %) and ${thousands(s.tripsJoined)} of ${thousands(s.trips)} distinct tram trip ids are found in \`${TRIPS_PATH}\``
    : `no tram report in the sample carries a trip id`;
  const lines = [
    ...(s.lead ? [s.lead, ''] : []),
    `# ZET GTFS-RT frame sample, ${zagrebDay}, ${localFrom.slice(0, 5)}–${localTo.slice(0, 5)} Zagreb`,
    '',
    `**Test fixture only.** These ${s.frames} files are a fixture of this repository's tests and nothing else: the Worker never serves them (its static assets are \`app/dist\`, built from \`app/\`), no client downloads them and no page links to them. They let ${s.use ? 'the tests named under "What it is for"' : 'the tram-path acceptance test'} replay real frames on any machine without the full recordings (hundreds of megabytes a day), which are never committed.`,
    '',
    'Generated by `scripts/frames-sample.mjs`; edit the script, not this file. Use `--readme-only <fixture-dir>` to refresh this file without changing the frames.',
    '',
    '## Source and licence',
    '',
    `ZET GTFS-Realtime (${ZET_RT_URL}), the \`zet-rt\` source of \`docs/izvori.md\`, recorded frame by frame by the twin (\`worker/twin/record.ts\`) into R2 and pulled with the wrangler loop in \`scripts/replay-twin.mjs\`. ZET publishes it under the Croatian Open Licence (Otvorena dozvola) and marks the feed "SAMO ZA POTREBE TESTIRANJA". Attribution, verbatim:`,
    '',
    `> ${ZET_ATTRIBUTION}`,
    '',
    '## What is in it',
    '',
    '| | |',
    '|---|---|',
    `| window (UTC, from the file names, inclusive) | ${s.day} ${clockText(s.from)}–${clockText(s.to)} |`,
    `| window (Zagreb, ${zagrebOffset(at(s.from))}) | ${zagrebDay === s.day ? '' : `${zagrebDay} `}${localFrom}–${localTo} |`,
    `| frames | ${s.frames} (${s.distinctHeaders} distinct header timestamps, ${s.firstHeaderTs}–${s.lastHeaderTs}) |`,
    `| cadence | ${cadence} |`,
    `| file names | the recorder's own \`HHMMSS-<headerTs>.pb\` (UTC time of the header) |`,
    `| filter | ${filter} |`,
    `| entities kept | ${thousands(s.keptEntities)} of ${thousands(s.sourceEntities)}; per frame on average ${s.vehiclesPerFrame.toFixed(1)} tram vehicle reports and ${s.tripUpdatesPerFrame.toFixed(1)} tram trip updates |`,
    `| distinct tram vehicles / trips | ${s.vehicles} / ${s.trips} |`,
    ...(s.allModes ? [`| every mode, per frame | on average ${(s.allVehicleReports / s.frames).toFixed(1)} vehicle reports and ${(s.allTripUpdates / s.frames).toFixed(1)} trip updates |`] : []),
    ...(s.allModes || s.keepAlerts ? [`| operator signals in the kept entities | ${signals} |`] : []),
    `| bytes | **${thousands(s.bytes)} B** in the ${s.frames} \`.pb\` files (the unfiltered frames: ${thousands(s.sourceBytes)} B) |`,
    '',
    '## Artefact it belongs to',
    '',
    `The frames name trips of ZET's static GTFS feed **${s.feedVersion ?? 'unknown'}**: ${join} (feed ${s.feedVersion ?? 'unknown'}). Service prefixes of the tram trip ids: ${s.services.join(', ') || 'none'}. The network artefact of the same feed is \`${NETWORK_PATH}\`, graphHash \`${network.graphHash ?? 'unknown'}\`.`,
    '',
    'If the artefacts are rebuilt from a newer GTFS feed, the trip ids stop joining and a replay of these frames no longer measures the matcher. Re-cut the sample then from a fresh recording of the new feed (pull it off R2 within its seven days) and commit frames and artefacts together.',
    '',
    '## How it was cut',
    '',
    '```',
    `node scripts/frames-sample.mjs <recordings>/${s.day.replaceAll('-', '/')} --from ${s.from} --to ${s.to} --out ${s.outRel}${s.allModes ? ' --all-modes' : ''}${s.keepAlerts ? ' --keep-alerts' : ''}${every > 1 ? ` --every ${every}` : ''}`,
    '```',
    '',
    `\`<recordings>\` is a local copy of R2's \`zet-rt/\` prefix. The script refuses an \`--out\` under any \`recordings/\` directory, because \`.gitignore\` ignores \`recordings/\` at any depth.${extraFlags.length > 0 ? ` The cut also passed ${extraFlags.map(([flag]) => flag).join(' and ')} with the text of this file's ${extraFlags.map(([, part]) => part).join(' and ')}.` : ''}`,
    '',
    ...(s.use ? ['## What it is for', '', s.use, ''] : [
      '## How it is graded',
      '',
      '```',
      'npx vitest run --project accept test/accept/wrong-turn.test.ts',
      `npm run replay:grade -- ${s.outRel} --out <scratch>/wrong-turn --targets stage1`,
      '```',
      '',
      "The first is WP0's acceptance test: `scripts/grade-branches-core.ts` replays the frames through the real engine and the committed artefacts and judges the rows against the stage-1 targets; `test/accept/wrong-turn.expect.json` records the rows this sample gave before WP0 and after it. The second writes the grader's full report, `<scratch>/wrong-turn.json` and `.md`, and exits 1 while a row misses its target.",
      '',
      'The rows, their thresholds and the values measured on this sample at each deploy are in [`docs/kaj-verification.md`](../../../../docs/kaj-verification.md), section "Prihvaćanje, companion 2026-09" (row U1); the whole-day rows are in its "Kapija paketa WP0" table.',
      '',
    ]),
  ];
  return lines.join('\n');
}

/**
 * The original window and unfiltered counts cannot be recovered from filtered
 * frames. Keep that provenance from the generated README, but measure everything
 * else again. Refuse a missing/malformed record instead of fabricating cut data.
 */
async function cutProvenance(out) {
  const readme = await readFile(resolve(out, 'README.md'), 'utf8');
  const window = /\| window \(UTC, from the file names, inclusive\) \| (\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})–(\d{2}:\d{2}:\d{2}) \|/.exec(readme);
  const entities = /\| entities kept \| [\d,]+ of ([\d,]+);/.exec(readme);
  const bytes = /\(the unfiltered frames: ([\d,]+) B\)/.exec(readme);
  const allModes = readme.includes('| filter | none:');
  const command = /^node scripts\/frames-sample\.mjs <recordings>\/\S+ --from \d{6} --to \d{6} --out \S+(.*)$/m.exec(readme);
  if (!window || !entities || !bytes || !command || (!allModes && !readme.includes('| filter | tram only'))) {
    throw new SampleRefusal('README.md has no complete cut provenance; --readme-only cannot recover the unfiltered recording');
  }
  const from = parseClock(window[2].replaceAll(':', ''));
  const to = parseClock(window[3].replaceAll(':', ''));
  if (from === null || to === null || from > to) throw new SampleRefusal('README.md has an invalid cut window');
  const flags = command[1];
  const every = parseEvery(/ --every (\S+)/.exec(flags)?.[1] ?? '1');
  const windowFrames = /of the window's ([\d,]+) \(`--every/.exec(readme)?.[1];
  if (every === null || (every > 1 && windowFrames === undefined)) {
    throw new SampleRefusal('README.md names an --every cut without its step or the window it thinned');
  }
  return {
    day: window[1], from, to, allModes,
    keepAlerts: / --keep-alerts\b/.test(flags),
    every,
    windowFrames: windowFrames === undefined ? null : Number(windowFrames.replaceAll(',', '')),
    lead: readme.startsWith('# ') ? null : readme.slice(0, readme.indexOf('\n')),
    use: /\n## What it is for\n\n([^\n]+)\n/.exec(readme)?.[1] ?? null,
    sourceEntities: Number(entities[1].replaceAll(',', '')),
    sourceBytes: Number(bytes[1].replaceAll(',', '')),
  };
}

export async function main({
  argv = process.argv.slice(2),
  cwd = process.cwd(),
  routesPath = ROUTES_PATH,
  tripsPath = TRIPS_PATH,
  networkPath = NETWORK_PATH,
  log = console.log,
} = {}) {
  const args = parseArgs(argv);
  const input = resolve(cwd, args.input);
  const out = resolve(cwd, args.out);
  const refusal = refusalFor(out, args.readmeOnly ? undefined : input);
  if (refusal !== null) throw new SampleRefusal(refusal);

  const destination = await destinationRefusal(out, ['README.md']);
  if (destination !== null) throw new SampleRefusal(destination);
  const provenance = args.readmeOnly ? await cutProvenance(out) : null;
  if (provenance) Object.assign(args, provenance);
  const windowNames = selectFrames(await readdir(input), args.from, args.to);
  if (windowNames.length === 0) throw new SampleRefusal(`no frame in ${args.input} between ${args.from} and ${args.to} UTC`);
  // A fixture's frames were thinned when it was cut; README-only reads them as they are.
  const names = args.readmeOnly ? windowNames : everyNth(windowNames, args.every);

  const routes = JSON.parse(await readFile(resolve(cwd, routesPath), 'utf8'));
  const trams = tramRouteIds(routes);
  if (trams.size === 0) throw new Error(`${routesPath} lists no tram route`);
  const trips = JSON.parse(await readFile(resolve(cwd, tripsPath), 'utf8'));
  const knownTrips = tripIdsOf(trips);
  const network = JSON.parse(await readFile(resolve(cwd, networkPath), 'utf8'));
  const keep = args.allModes ? () => true : (routeId, entity) => trams.has(routeId) || (args.keepAlerts && entity.alert != null);

  const written = [];
  let bytes = 0;
  let sourceBytes = 0;
  let sourceEntities = 0;
  let keptEntities = 0;
  let vehicleReports = 0;
  let tripUpdates = 0;
  let tripReports = 0;
  let tripReportsJoined = 0;
  let allVehicleReports = 0;
  let allTripUpdates = 0;
  let canceledUpdates = 0;
  let alertEntities = 0;
  const canceledTrips = new Set();
  const alertIds = new Set();
  const alertEffects = new Map();
  const headers = [];
  const vehicles = new Set();
  const tripIds = new Set();
  const services = new Set();
  for (const name of names) {
    const source = new Uint8Array(await readFile(resolve(input, name)));
    sourceBytes += source.byteLength;
    // README-only decodes existing bytes; no filtering or re-encoding is needed.
    const decoded = args.readmeOnly ? FeedMessage.decode(source) : null;
    const frame = decoded
      ? { headerTs: Number(String(decoded.header.timestamp)), entities: decoded.entity.length, kept: decoded.entity }
      : filterFrame(source, keep);
    const data = args.readmeOnly || args.allModes ? source : frame.bytes;
    if (!args.readmeOnly) written.push({ name, data });
    bytes += data.byteLength;
    sourceEntities += frame.entities;
    keptEntities += frame.kept.length;
    headers.push(frame.headerTs);
    for (const entity of frame.kept) {
      if (entity.alert) {
        alertEntities += 1;
        alertIds.add(entity.id);
        const effect = EFFECT[entity.alert.effect] ?? String(entity.alert.effect);
        alertEffects.set(effect, (alertEffects.get(effect) ?? 0) + 1);
      }
      if (entity.vehicle) allVehicleReports += 1;
      if (entity.tripUpdate) {
        allTripUpdates += 1;
        if (entity.tripUpdate.trip?.scheduleRelationship === CANCELED) {
          canceledUpdates += 1;
          canceledTrips.add(entity.tripUpdate.trip.tripId || entity.id);
        }
      }
      if (!trams.has(routeOf(entity))) continue;
      const tripId = entity.vehicle?.trip?.tripId || entity.tripUpdate?.trip?.tripId || '';
      if (entity.vehicle) {
        vehicleReports += 1;
        if (entity.vehicle.vehicle?.id) vehicles.add(entity.vehicle.vehicle.id);
        if (tripId) {
          tripReports += 1;
          if (knownTrips.has(tripId)) tripReportsJoined += 1;
        }
      }
      if (entity.tripUpdate) tripUpdates += 1;
      if (tripId) {
        tripIds.add(tripId);
        const service = /^([^_]+_[^_]+)_/.exec(tripId);
        if (service) services.add(service[1]);
      }
    }
  }

  let removed = 0;
  if (!args.readmeOnly) {
    const destination = await destinationRefusal(out, names);
    if (destination !== null) throw new SampleRefusal(destination);
    await mkdir(out, { recursive: true });
    const keepNames = new Set(names);
    for (const name of await readdir(out)) {
      if (!name.toLowerCase().endsWith('.pb') || keepNames.has(name)) continue;
      await unlink(resolve(out, name));
      removed += 1;
    }
    for (const { name, data } of written) await writeFile(resolve(out, name), data, { flag: WRITE_FLAGS });
  }
  if (provenance) {
    sourceEntities = provenance.sourceEntities;
    sourceBytes = provenance.sourceBytes;
  }

  const ordered = [...headers].sort((a, b) => a - b);
  const gaps = ordered.slice(1).map((ts, i) => ts - ordered[i]);
  const summary = {
    day: utcDay(ordered[0]),
    from: args.from,
    to: args.to,
    allModes: args.allModes,
    keepAlerts: args.keepAlerts,
    every: args.every,
    windowFrames: args.readmeOnly ? (args.windowFrames ?? names.length) : windowNames.length,
    lead: args.lead,
    use: args.use,
    outRel: relative(cwd, out).split(sep).join('/') || '.',
    frames: names.length,
    distinctHeaders: new Set(headers).size,
    firstHeaderTs: ordered[0],
    lastHeaderTs: ordered.at(-1),
    medianGapS: median(gaps),
    maxGapS: gaps.length > 0 ? Math.max(...gaps) : null,
    tramRoutes: [...trams].sort((a, b) => Number(a) - Number(b) || a.localeCompare(b)),
    sourceEntities,
    keptEntities,
    vehiclesPerFrame: vehicleReports / names.length,
    tripUpdatesPerFrame: tripUpdates / names.length,
    vehicles: vehicles.size,
    trips: tripIds.size,
    tripsJoined: [...tripIds].filter((id) => knownTrips.has(id)).length,
    tripReports,
    tripReportsJoined,
    allVehicleReports,
    allTripUpdates,
    canceledUpdates,
    canceledTrips: canceledTrips.size,
    alertEntities,
    alertIds: alertIds.size,
    alertEffects: Object.fromEntries([...alertEffects].sort(([a], [b]) => a.localeCompare(b))),
    services: [...services].sort(),
    feedVersion: typeof trips?.feedVersion === 'string' ? trips.feedVersion : null,
    graphHash: typeof network?.graphHash === 'string' ? network.graphHash : null,
    bytes,
    sourceBytes,
  };
  await writeFile(resolve(out, 'README.md'), renderReadme(summary, resolve(cwd, networkPath)), { encoding: 'utf8', flag: WRITE_FLAGS });
  log(
    `${summary.frames} frames ${summary.day} ${args.from}-${args.to} UTC -> ${summary.outRel}: ${bytes} B ` +
      `(${args.allModes ? 'all modes' : 'tram only'}${args.keepAlerts ? ', alerts kept' : ''}${args.every > 1 ? `, every ${args.every} of ${summary.windowFrames}` : ''}, ` +
      `from ${sourceBytes} B; ${removed} stale frames removed); ` +
      `${canceledUpdates} CANCELED trip updates, ${alertEntities} alerts kept; ` +
      `feed ${summary.feedVersion ?? 'unknown'}: ${tripReportsJoined}/${tripReports} tram reports join, ` +
      `${summary.tripsJoined}/${summary.trips} trips; graphHash ${summary.graphHash ?? 'unknown'}`,
  );
  return { ...summary, removed, target: out, names };
}

const invokedDirectly =
  typeof process.argv[1] === 'string' && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = err instanceof SampleRefusal ? err.exitCode : 1;
  });
}
