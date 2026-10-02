// The snimka dataset build (lanes S1 and V1, dataset v2), bundled and run by scripts/snimka/build.mjs:
//   node scripts/snimka/build.mjs [--stage <name>|all] [--segment window|day-0924|day-0921] [--force] [--inputs <dir>] [--out <dir>]
// Stages, in the order `all` runs them: STAGE_NAMES (frames runs the three
// segments, or the one --segment names). places runs before events, which
// validates every pointer against the routes and places and publishes the
// curated headlines. Each stage fingerprints its inputs (and its own code) into
// state/<stage>[-<segment>].json and is skipped while they are unchanged;
// --force runs it anyway. verify always runs.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { filePrint, listingPrint, resolvePaths, type Paths } from './paths';
import { EXPECT_FILES, ROUTES_FILE, SEGMENT_KEYS, segmentOf, type SegmentKey } from './segments';
import { stageFrames } from './stage-frames';
import { stageBajs, stampSec } from './stage-bajs';
import { SNIMKA_WINDOW } from '../../shared/snimka';
import { stageClosures } from './stage-closures';
import { stageNews } from './stage-news';
import { stageSeries } from './stage-series';
import { stageEvents } from './stage-events';
import { stageRoutes } from './stage-routes';
import { stagePlaces } from './stage-places';
import { stageBoards } from './stage-boards';
import { stageVoice } from './stage-voice';
import { stageExports } from './stage-exports';
import { ATTRIBUTION } from './stage-manifest';
import { stageScreen } from './stage-screen';
import { stageCaptures } from './stage-captures';
import { stageManifest } from './stage-manifest';
import { stageVerify } from './stage-verify';

export const STAGE_NAMES = ['frames', 'bajs', 'closures', 'news', 'series', 'routes', 'places', 'events', 'screen', 'boards', 'voice', 'captures', 'exports', 'manifest', 'verify'] as const;
export type StageName = (typeof STAGE_NAMES)[number];

interface Args { stage: StageName | 'all'; segment: SegmentKey | null; force: boolean; inputs?: string; out?: string }

function parseArgs(argv: string[]): Args {
  const value = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const stage = (value('--stage') ?? 'all') as Args['stage'];
  if (stage !== 'all' && !(STAGE_NAMES as readonly string[]).includes(stage)) throw new Error(`--stage takes all or one of ${STAGE_NAMES.join(', ')}, got ${stage}`);
  const segment = value('--segment') ?? null;
  if (segment !== null && !(SEGMENT_KEYS as readonly string[]).includes(segment)) throw new Error(`--segment takes ${SEGMENT_KEYS.join(', ')}, got ${segment}`);
  return { stage, segment: segment as SegmentKey | null, force: argv.includes('--force'), inputs: value('--inputs'), out: value('--out') };
}

const code = (paths: Paths, ...files: string[]): string[] => files.map((f) => filePrint(join(paths.repo, f)));
const hashOf = (parts: unknown): string => createHash('sha256').update(JSON.stringify(parts)).digest('hex');

/** What each stage's output depends on: input listings, artefacts, upstream work files and its own code. */
function fingerprint(paths: Paths, stage: StageName, segment: SegmentKey | null): string {
  const work = (name: string): string => filePrint(join(paths.work, name));
  const strike = (dir: string): string => listingPrint(join(paths.inputs, 'strike', dir));
  // Stamped copies up to ten minutes past the window: the recorders still running never force a rerun.
  const windowCopies = (dir: string): string => listingPrint(join(paths.inputs, 'strike', dir), (name) => {
    const at = stampSec(name.replace(/\.json$/, ''));
    return at !== null && at < SNIMKA_WINDOW.toSec + 600;
  });
  switch (stage) {
    case 'frames': {
      const seg = segmentOf(paths, segment!);
      const files = EXPECT_FILES(paths);
      // Only the frames whose header lies in the segment (warm-up included): later frames of 2 Oct never force a rerun.
      const lo = seg.fromSec - seg.warmupSec;
      const hi = seg.fromSec + seg.minutes * 60;
      const inSegment = (name: string): boolean => {
        const match = /^\d{6}-(\d+)\.pb$/.exec(name);
        return match !== null && Number(match[1]) >= lo && Number(match[1]) < hi;
      };
      return hashOf([seg, seg.dirs.map((d) => listingPrint(d, inSegment)), filePrint(seg.network), filePrint(seg.trips), filePrint(seg.overrides),
        filePrint(files.e396), filePrint(files.e395), filePrint(ROUTES_FILE(paths)),
        code(paths, 'scripts/snimka/stage-frames.ts', 'scripts/snimka/segments.ts', 'scripts/snimka/expect-merge.ts', 'scripts/replay-core.ts', 'shared/snimka-codec.ts',
          'worker/twin/tick.ts', 'worker/twin/publish.ts', 'worker/twin/service.ts', 'worker/twin/engine.ts', 'shared/motion/plan.ts')]);
    }
    case 'bajs':
      return hashOf([strike('bajs'), listingPrint(join(paths.inputs, 'companion', 'data-calendar')), code(paths, 'scripts/snimka/stage-bajs.ts', 'shared/snimka-codec.ts')]);
    case 'closures':
      return hashOf([strike('prometnice'), code(paths, 'scripts/snimka/stage-closures.ts')]);
    case 'news':
      return hashOf([['jutarnji', 'vecernji', 'n1'].map((o) => listingPrint(join(paths.inputs, 'strike', 'context', o))),
        code(paths, 'scripts/snimka/stage-news.ts', 'scripts/snimka/news-filter.ts')]);
    case 'series':
      return hashOf([work('minutes-window.json'), work('minutes-day-0924.json'), work('minutes-day-0921.json'), work('bikes-minutes.json'), work('closures-minutes.json'), work('news-pulse.json'),
        filePrint(join(paths.inputs, 'strike', 'teaser.jsonl')), listingPrint(join(paths.inputs, 'strike', 'context', 'dhmz-now')), filePrint(EXPECT_FILES(paths).e396), filePrint(EXPECT_FILES(paths).e395),
        code(paths, 'scripts/snimka/stage-series.ts', 'scripts/snimka/expect-merge.ts')]);
    case 'routes':
      return hashOf([SEGMENT_KEYS.map((k) => work(`routes-seen-${k}.json`)), filePrint(EXPECT_FILES(paths).e396), filePrint(EXPECT_FILES(paths).e395), filePrint(ROUTES_FILE(paths)),
        code(paths, 'scripts/snimka/stage-routes.ts', 'scripts/snimka/expect-merge.ts', 'shared/motion/expect.ts', 'shared/snimka-codec.ts')]);
    case 'places':
      return hashOf([filePrint(join(paths.repo, 'scripts/snimka/places.json')), filePrint(join(paths.repo, 'app/public/data/stops.json')), code(paths, 'scripts/snimka/stage-places.ts', 'shared/motion/depots.ts')]);
    case 'events':
      return hashOf([work('series-window.json'), filePrint(join(paths.repo, 'scripts/snimka/events.json')), filePrint(join(paths.repo, 'scripts/snimka/notices-focus.json')),
        filePrint(join(paths.repo, 'scripts/snimka/news-curated.json')), work('news-items.json'), work('routes-window.json'), work('places.json'), work('bajs-refs.json'),
        strike('rss/novosti'), strike('rss/promet'), filePrint(join(paths.repo, 'app/public/data/stops.json')),
        code(paths, 'scripts/snimka/stage-events.ts', 'scripts/snimka/stage-news.ts', 'scripts/snimka/focus-defaults.ts')]);
    case 'screen':
      return hashOf([listingPrint(join(paths.inputs, 'strike'), (n) => n.startsWith('observe-')), code(paths, 'scripts/snimka/stage-screen.ts')]);
    case 'boards':
      return hashOf([windowCopies('boards'), work('places.json'), code(paths, 'scripts/snimka/stage-boards.ts')]);
    case 'voice':
      return hashOf([work('wall-window.jsonl.gz'), windowCopies('boards'), windowCopies('teaser-full'), filePrint(join(paths.repo, 'app/public/data/stops.json')), filePrint(join(paths.repo, 'app/public/data/city/manifest.json')),
        code(paths, 'scripts/snimka/stage-voice.ts', 'scripts/snimka/voice-engine.ts', 'app/src/city/nearby.ts', 'app/src/city/sentence.ts', 'shared/city/service-state.ts', 'app/src/motion/fixes.ts', 'shared/kiosk/sentence.ts')]);
    case 'captures':
      return hashOf([listingPrint(join(paths.inputs, 'strike'), (n) => n.startsWith('observe-')), work('screen-runs.json'), code(paths, 'scripts/snimka/stage-captures.ts')]);
    case 'exports':
      return hashOf([work('series-window.json'), work('routes-window.json'), work('bajs-refs.json'), work('closures-refs.json'), work('events-refs.json'), work('voice-refs.json'),
        code(paths, 'scripts/snimka/stage-exports.ts', 'scripts/snimka/stage-manifest.ts')]);
    case 'manifest':
      return hashOf([[...SEGMENT_KEYS.map((k) => `motion-${k}`), 'series-refs', 'routes-refs', 'bajs-refs', 'closures-refs', 'news-refs', 'events-refs', 'places-refs', 'boards-refs', 'voice-refs', 'exports-refs', 'screen-runs', 'captures'].map((n) => work(`${n}.json`)),
        filePrint(segmentOf(paths, 'window').network), filePrint(segmentOf(paths, 'day-0924').network), code(paths, 'scripts/snimka/stage-manifest.ts')]);
    case 'verify':
      return `${Date.now()}`;
  }
}

interface StateFile { fingerprint: string; finishedAt: string }

export function stageInputs(paths: Paths): Record<string, string> {
  const out: Record<string, string> = {};
  for (const stage of STAGE_NAMES) {
    for (const seg of stage === 'frames' ? SEGMENT_KEYS : [null]) {
      const file = join(paths.state, `${stage}${seg ? `-${seg}` : ''}.json`);
      if (existsSync(file)) out[`${stage}${seg ? `-${seg}` : ''}`] = (JSON.parse(readFileSync(file, 'utf8')) as StateFile).fingerprint;
    }
  }
  return out;
}

async function runStage(paths: Paths, stage: StageName, segment: SegmentKey | null, force: boolean, log: (line: string) => void): Promise<boolean> {
  const label = `${stage}${segment ? `-${segment}` : ''}`;
  const stateFile = join(paths.state, `${label}.json`);
  const print = fingerprint(paths, stage, segment);
  if (!force && stage !== 'verify' && existsSync(stateFile) && (JSON.parse(readFileSync(stateFile, 'utf8')) as StateFile).fingerprint === print) {
    log(`${label}: inputs unchanged, skipped`);
    return true;
  }
  const started = Date.now();
  log(`${label}: running`);
  let ok = true;
  switch (stage) {
    case 'frames': await stageFrames(paths, segment!, log); break;
    case 'bajs': await stageBajs(paths, log); break;
    case 'closures': await stageClosures(paths, log); break;
    case 'news': await stageNews(paths, log); break;
    case 'series': await stageSeries(paths, log); break;
    case 'routes': await stageRoutes(paths, log); break;
    case 'places': await stagePlaces(paths, log); break;
    case 'events': await stageEvents(paths, log); break;
    case 'screen': await stageScreen(paths, log); break;
    case 'boards': await stageBoards(paths, log); break;
    case 'voice': await stageVoice(paths, log); break;
    case 'captures': await stageCaptures(paths, log); break;
    case 'exports': await stageExports(paths, ATTRIBUTION, log); break;
    case 'manifest': await stageManifest(paths, stageInputs(paths), log); break;
    case 'verify': ok = await stageVerify(paths, log); break;
  }
  if (stage !== 'verify') writeFileSync(stateFile, `${JSON.stringify({ fingerprint: print, finishedAt: new Date().toISOString() } satisfies StateFile)}\n`);
  log(`${label}: done in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  return ok;
}

export async function run(repo: string, argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  const paths = resolvePaths(repo, { inputs: args.inputs, out: args.out });
  const log = (line: string): void => console.log(`[snimka ${new Date().toISOString().slice(11, 19)}Z] ${line}`);
  log(`inputs ${paths.inputs}, out ${paths.out}`);
  const stages: StageName[] = args.stage === 'all' ? [...STAGE_NAMES] : [args.stage];
  let ok = true;
  for (const stage of stages) {
    const segments: (SegmentKey | null)[] = stage === 'frames' ? (args.segment ? [args.segment] : [...SEGMENT_KEYS]) : [null];
    for (const segment of segments) ok = (await runStage(paths, stage, segment, args.force, log)) && ok;
  }
  return ok ? 0 : 1;
}
