// Stage `manifest` (lanes S1, V1; dataset v2): the one mutable object of the dataset. Collects
// the refs every stage wrote, builds the motion and screen indexes, copies the
// two network artefacts byte for byte (the page decodes chunk indices against
// exactly the network that produced them), writes the attribution and the
// Croatian notes, and lists every referenced object in upload-list.txt (hashed
// objects first, manifest.json last), for scripts/snimka/upload.mjs.

import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodeNetwork } from '../../shared/motion/network';
import { decodeManifest } from '../../shared/snimka-codec';
import { MOTION_CHUNK_S, MOTION_STEP_S, SNIMKA_COMPARISONS, SNIMKA_WINDOW, type Attribution, type BoardRef, type HashedRef, type MotionIndex, type NetworkRef, type ScreenIndex, type SnimkaManifest } from '../../shared/snimka';
import type { BajsRefs } from './stage-bajs';
import type { CaptureWork } from './stage-captures';
import type { ClosuresRefs } from './stage-closures';
import type { EventsRefs } from './stage-events';
import type { MotionWork } from './stage-frames';
import type { NewsRefs } from './stage-news';
import type { ScreenWork } from './stage-screen';
import type { SeriesRefs } from './stage-series';
import type { ExportsRefs } from './stage-exports';
import type { PlacesRefs } from './stage-places';
import type { RoutesRefs } from './stage-routes';
import type { VoiceRefs } from './stage-voice';
import { CONTENT_TYPES, readWork, writeJsonObject, writeObject, type Paths } from './paths';
import { SEGMENT_KEYS, segmentOf } from './segments';

export const ATTRIBUTION: Attribution[] = [
  { id: 'zet', text: 'Public dataset by ZET provided under Open license, dataset source http://www.zet.hr/odredbe/datoteke-u-gtfs-formatu/669', url: 'http://www.zet.hr/odredbe/datoteke-u-gtfs-formatu/669', licence: 'Otvorena dozvola (NN 67/17)', adaptation: 'položaji vozila izvedeni modelom kretanja iz snimljenih GTFS-RT okvira, 10-sekundni korak; sirovi okviri se ne objavljuju' },
  { id: 'zet-rss', text: 'ZET, obavijesti: naslov, vrijeme objave i poveznica na obavijest', url: 'https://www.zet.hr/', licence: 'uvjeti ponovne uporabe nisu objavljeni; upit ZET-u je otvoren', adaptation: null },
  { id: 'nextbike', text: 'nextbike (BAJS), GBFS: stanje stanica svake minute', url: 'https://gbfs.nextbike.net/maps/gbfs/v2/nextbike_hd/hr/', licence: 'CC0 1.0', adaptation: 'brojevi bicikala po stanici svakih pet minuta; zbroj bicikala i praznih stanica po minuti' },
  { id: 'zagreb-closures', text: "Sadrži informacije Grada Zagreba (data.zagreb.hr) u skladu s Otvorenom dozvolom; skup 'Zatvaranje prometnica na području Grada Zagreba'", url: 'https://data.zagreb.hr/', licence: 'Otvorena dozvola (OD), http://data.gov.hr/otvorena-dozvola', adaptation: 'svaka snimljena inačica skupa, s krajem zatvaranja kako ga je ta inačica objavila' },
  { id: 'dhmz', text: 'Izvor: DHMZ, Otvorena dozvola; postaja Zagreb-Maksimir', url: 'https://vrijeme.hr/hrvatska1_n.xml', licence: 'Otvorena dozvola (NN 67/17)', adaptation: 'temperatura i vrijeme po satu' },
  { id: 'news', text: 'Jutarnji list, Večernji list i N1: naslovi i poveznice uz atribuciju, bez teksta članaka', url: null, licence: 'navod naslova s poveznicom na izvorni članak', adaptation: null },
  { id: 'osm', text: '© OpenStreetMap contributors', url: 'https://www.openstreetmap.org/copyright', licence: 'ODbL 1.0', adaptation: 'podloga karte i karta u snimkama zaslona' },
  { id: 'kajima', text: 'Kaj ima?: snimke javnog zaslona, objavljeni brojevi i stanje usluge izračunano istim pravilima nad snimljenim podacima', url: 'https://github.com/matijarma/vidikovac', licence: 'AGPL-3.0 (izvorni kod)', adaptation: null },
];

export const NOTES: string[] = [
  'Lokalni snimači rade od nedjelje 27. rujna u 22:07: za ranije minute brojevi koje je aplikacija objavila, bicikli i zatvorene ulice nemaju podatka.',
  'U srijedu 30. rujna od 22:41 do 22:54 lokalni snimači nisu radili; ZET-ovi podaci snimljeni su bez prekida.',
  'Aplikacija objavljuje stanje usluge od utorka 29. rujna u 23:17; za ranije minute stanje je izračunano naknadno, istim pravilima, iz snimljenih podataka.',
  'U utorak 29. rujna od 21:18 do 23:17 ZET-ovi podaci nisu se mijenjali gotovo dva sata; rečenice zaslona po današnjim pravilima u tom razdoblju govore o nepotvrđenim polascima.',
  'Od nedjelje u 20:00 do ponoći vozila su snimljena prema starom voznom redu ZET-a, a smještena na mrežu novoga; na dionicama s dva kolosijeka smjer vozila zato može biti pogrešan.',
  'Običan četvrtak 24. rujna nema snimljenih ZET-ovih podataka od ponoći do 02:00.',
  'Običnom ponedjeljku 21. rujna u snimci nedostaju dva okvira.',
  'Rečenice zaslona po današnjim pravilima izračunane su naknadno, samo iz predložaka aplikacije, bez jezičnog modela; zapis stvarnog zaslona postoji samo za snimljena razdoblja.',
  'Vozila koja ulaze u spremište označena su kako ih označava i aplikacija.',
  'Snimka završava u petak 2. listopada u 12:00.',
];

/** The notes of each comparison day, in SNIMKA_COMPARISONS order. */
export const COMPARISON_NOTES: Record<string, string[]> = {
  'cet-0924': ['Običan četvrtak 24. rujna nema snimljenih ZET-ovih podataka od ponoći do 02:00.'],
  'pon-0921': ['Običnom ponedjeljku 21. rujna u snimci nedostaju dva okvira.'],
};

function networkRef(paths: Paths, file: string, net: '395' | '396'): NetworkRef {
  const bytes = readFileSync(file);
  // Counted as decodeNetwork decodes it: a chunk's path index runs over the decoded paths, synthetic ones included.
  const decoded = decodeNetwork(JSON.parse(bytes.toString('utf8')) as unknown);
  const ref = writeObject(paths, `network/${net}`, 'json', bytes);
  if (decoded.feedVersion !== `000${net}`) throw new Error(`manifest: the ${net} network artefact is feed ${decoded.feedVersion}`);
  return { ...ref, feedVersion: decoded.feedVersion, graphHash: decoded.graphHash, paths: decoded.paths.length, shapes: decoded.shapes.length };
}

function commitOf(repo: string): string {
  try {
    return execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

export async function stageManifest(paths: Paths, inputs: Record<string, string>, log: (line: string) => void): Promise<boolean> {
  const motion = SEGMENT_KEYS.map((key) => readWork<MotionWork>(paths, `motion-${key}.json`));
  const series = readWork<SeriesRefs>(paths, 'series-refs.json');
  const routes = readWork<RoutesRefs>(paths, 'routes-refs.json');
  const bajs = readWork<BajsRefs>(paths, 'bajs-refs.json');
  const closures = readWork<ClosuresRefs>(paths, 'closures-refs.json');
  const news = readWork<NewsRefs>(paths, 'news-refs.json');
  const events = readWork<EventsRefs>(paths, 'events-refs.json');
  const places = readWork<PlacesRefs>(paths, 'places-refs.json');
  const boards = readWork<{ boards: BoardRef[] }>(paths, 'boards-refs.json').boards;
  const voice = readWork<VoiceRefs>(paths, 'voice-refs.json');
  const exportsRefs = readWork<ExportsRefs>(paths, 'exports-refs.json');
  const screen = readWork<ScreenWork>(paths, 'screen-runs.json');
  const captures = readWork<{ runs: Record<string, CaptureWork> }>(paths, 'captures.json').runs;

  const chunks = motion.flatMap((m) => m.chunks).sort((a, b) => a.t0 - b.t0 || a.net.localeCompare(b.net));
  const motionIndex: MotionIndex = { v: 2, step: MOTION_STEP_S, chunkSec: MOTION_CHUNK_S, chunks: chunks.map(({ path, bytes, net, t0, vehicles }) => ({ path, bytes, net, t0, vehicles })) };
  const motionIndexRef = writeJsonObject(paths, 'motion/index', motionIndex);
  const screenIndex: ScreenIndex = {
    v: 1,
    runs: screen.runs.map((r) => ({ id: r.id, kind: r.kind, fromSec: r.fromSec, toSec: r.toSec, readings: r.readings, file: r.file, captures: { kiosk: captures[r.id]?.kiosk ?? null, phone: captures[r.id]?.phone ?? null }, summary: r.summary })),
  };
  const screenIndexRef = writeJsonObject(paths, 'screen/index', screenIndex);
  const networks = { '395': networkRef(paths, segmentOf(paths, 'day-0924').network, '395'), '396': networkRef(paths, segmentOf(paths, 'window').network, '396') };

  const comparisons: SnimkaManifest['comparisons'] = SNIMKA_COMPARISONS.map((c) => {
    const s = series.comparisons[c.id];
    const r = routes.comparisons[c.id];
    if (!s || !r) throw new Error(`manifest: comparison ${c.id} has no series or routes`);
    return { ...c, files: { series: s, routes: r }, notes: COMPARISON_NOTES[c.id] ?? [] };
  });
  const manifest: SnimkaManifest = {
    version: 2,
    builtAt: new Date().toISOString(),
    title: 'Tri dana bez tramvaja',
    build: { commit: commitOf(paths.repo), inputs },
    window: { ...SNIMKA_WINDOW, tz: 'Europe/Zagreb', utcOffsetMin: 120 },
    comparisons,
    serviceLiveFromSec: series.serviceLiveFromSec,
    networks,
    files: {
      series: series.series, motionIndex: motionIndexRef, routes: routes.window, stations: bajs.stations, bajs: bajs.bajs, closures: closures.closures,
      events: events.events, notices: events.notices, news: news.news, places: places.places, screenIndex: screenIndexRef, boards,
      voiceIndex: voice.index, exports: exportsRefs.exports, opis: exportsRefs.opis, grid: null,
    },
    attribution: ATTRIBUTION,
    notes: NOTES,
  };
  const text = `${JSON.stringify(manifest)}\n`;
  decodeManifest(JSON.parse(text));
  writeFileSync(join(paths.objects, 'manifest.json'), text);

  // Every referenced object once, hashed objects first and the manifest last.
  const refs: HashedRef[] = [
    ...chunks, motionIndexRef, networks['395'], networks['396'],
    series.series, ...comparisons.flatMap((c) => [c.files.series, c.files.routes]), routes.window, bajs.stations, bajs.bajs, closures.closures,
    events.events, events.notices, news.news, places.places, ...boards, ...voice.days.map((d) => d.file), voice.index, ...exportsRefs.exports,
    ...screen.runs.map((r) => r.file),
    ...Object.values(captures).flatMap((c) => [c.kiosk, c.phone]).filter((r): r is HashedRef => r !== null),
    screenIndexRef,
  ];
  const seen = new Set<string>();
  const lines: string[] = [];
  let total = 0;
  for (const ref of refs) {
    if (seen.has(ref.path)) continue;
    seen.add(ref.path);
    lines.push(`${ref.path}\t${ref.bytes}\t${contentTypeOf(ref.path)}`);
    total += ref.bytes;
  }
  lines.push(`manifest.json\t${Buffer.byteLength(text)}\tapplication/json`);
  total += Buffer.byteLength(text);
  writeFileSync(join(paths.out, 'upload-list.txt'), `${lines.join('\n')}\n`);
  // Objects of an earlier build that nothing references any more (a re-encoded capture, a rebuilt chunk) are removed,
  // so objects/ holds exactly what the manifest names.
  let pruned = 0;
  for (const rel of readdirSync(paths.objects, { recursive: true }) as string[]) {
    const path = String(rel).split('\\').join('/');
    if (!/\.[0-9a-f]{16}\.(json|webp|csv|geojson)$/.test(path) || seen.has(path)) continue;
    rmSync(join(paths.objects, path));
    pruned++;
  }
  if (pruned > 0) log(`manifest: removed ${pruned} unreferenced objects of an earlier build`);
  log(`manifest: ${lines.length} objects, ${total} bytes (${(total / 1e6).toFixed(1)} MB), ${chunks.length} motion chunks, ${screen.runs.length} screen runs, ${boards.length} boards, ${voice.days.length} voice days, ${exportsRefs.exports.length} exports`);
  return true;
}

/** The content type of an object by its extension (upload-list.txt's third column). */
export function contentTypeOf(path: string): string {
  const ext = path.slice(path.lastIndexOf('.') + 1) as keyof typeof CONTENT_TYPES;
  const type = CONTENT_TYPES[ext];
  if (!type) throw new Error(`manifest: no content type for ${path}`);
  return type;
}
