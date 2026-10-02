// Stage `verify` (lanes S1, V1): acceptance rows SN-1 to SN-3 of the brief
// (section 10) and every row of the v2 plan's section 8 "Pipeline", measured
// on the built objects, printed as a table; any miss makes the build exit 1. Also checks that every object upload-list.txt names
// exists with its size and the hash in its name, and that the manifest decodes.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { decodeManifest, decodeRoutes } from '../../shared/snimka-codec';
import { SNIMKA_COMPARISONS, SNIMKA_WINDOW, type EventsFile, type ExportRef, type Focus, type Mentions, type MotionIndex, type NewsFile, type NoticesFile, type OpisFile, type PlacesFile, type RoutesFile, type SeriesFile, type StationsFile, type VoiceFile, type VoiceIndex } from '../../shared/snimka';
import { CHUNK_GZIP_MAX } from './stage-frames';
import type { Paths } from './paths';

/** Zagreb wall time (CEST) of the strike week or 1 October, epoch seconds. */
export const z = (month: 9 | 10, day: number, hh: number, mm = 0): number => Date.UTC(2026, month - 1, day, hh - 2, mm) / 1000;
const clock = (sec: number | null): string => (sec === null ? 'none' : new Date((sec + 7200) * 1000).toISOString().slice(5, 16).replace('T', ' '));

interface Row { row: string; measure: string; value: string; threshold: string; ok: boolean }

export function verifySeries(win: SeriesFile, day: SeriesFile): Row[] {
  const at = (s: SeriesFile, sec: number): number => Math.floor((sec - s.t0) / 60);
  const rows: Row[] = [];
  const push = (row: string, measure: string, value: string, threshold: string, ok: boolean): void => { rows.push({ row, measure, value, threshold, ok }); };

  const mon3 = win.seen.all[at(win, z(9, 28, 3))];
  push('SN-1', 'seen.all Mon 28 Sep 03:00', String(mon3), 'at most 6', mon3 !== null && mon3 <= 6);
  const wed2030 = win.seen.all[at(win, z(9, 30, 20, 30))];
  push('SN-1', 'seen.all Wed 30 Sep 20:30', String(wed2030), 'at least 200', wed2030 !== null && wed2030 >= 200);

  let judged = 0;
  const off: string[] = [];
  for (let m = at(win, z(9, 28, 4, 30)); m <= at(win, z(9, 30, 18)); m++) {
    if (win.service.hold[m] !== null) continue;
    judged++;
    if (win.service.state[m] !== 'silent') off.push(`${clock(win.t0 + m * 60)} ${win.service.state[m]}`);
  }
  push('SN-1', 'state at every judged minute Mon 04:30 to Wed 18:00', `${judged - off.length} of ${judged} silent${off.length ? `; ${off.slice(0, 3).join(', ')}` : ''}`, 'all silent', judged > 0 && off.length === 0);

  const firstState = (state: string, from: number): number | null => {
    for (let m = at(win, from); m < win.n; m++) {
      if (win.service.state[m] !== state || win.service.hold[m] === 'gap') continue;
      const since = win.service.since[m];
      return since !== null && since >= from ? since : win.t0 + m * 60;
    }
    return null;
  };
  const reduced = firstState('reduced', z(9, 30, 12));
  push('SN-1', 'first reduced, Wed evening', clock(reduced), 'Wed 19:05 ± 3 min', reduced !== null && Math.abs(reduced - z(9, 30, 19, 5)) <= 180);
  const normal = firstState('normal', z(9, 30, 12));
  push('SN-1', 'first normal, Wed evening', clock(normal), 'Wed 20:15 to 20:30', normal !== null && normal >= z(9, 30, 20, 15) && normal <= z(9, 30, 20, 30) + 59);

  const m1927 = at(win, z(9, 28, 19, 27));
  const pub = win.published?.vehicles[m1927] ?? null;
  const ent = win.feed.entities[m1927];
  push('SN-1', 'published.vehicles and feed.entities Mon 19:27', `${pub} and ${ent}`, '5 and 0', pub === 5 && ent === 0);

  let wedEmpty: number | null = null;
  for (let m = at(win, z(9, 30, 0)); m < at(win, z(10, 1, 0)); m++) {
    const v = win.bikes?.empty[m] ?? null;
    if (v !== null && (wedEmpty === null || v > wedEmpty)) wedEmpty = v;
  }
  push('SN-1', 'highest bikes.empty on Wed 30 Sep', String(wedEmpty), 'at least 100', wedEmpty !== null && wedEmpty >= 100);
  const nulls = win.expected.all.filter((x) => x === null).length;
  push('SN-1', 'expected.all null minutes in the window', String(nulls), '0', nulls === 0);

  let dayJudged = 0;
  const dayOff: string[] = [];
  for (let m = 0; m < day.n; m++) {
    if (day.service.hold[m] !== null) continue;
    dayJudged++;
    if (day.service.state[m] === 'reduced' || day.service.state[m] === 'silent') dayOff.push(`${clock(day.t0 + m * 60)} ${day.service.state[m]}`);
  }
  push('SN-3', 'judged minutes of 24 Sep reduced or silent', `${dayOff.length} of ${dayJudged}${dayOff.length ? `; ${dayOff.slice(0, 3).join(', ')}` : ''}`, '0', dayJudged > 0 && dayOff.length === 0);
  return rows;
}

const zClock = (sec: number): string => clock(sec);
type Push = (row: string, measure: string, value: string, threshold: string, ok: boolean) => void;

/** The plan's section 8 "Pipeline" rows over the window, the comparison days and the routes. */
export function verifyV2(win: SeriesFile, days: Record<string, SeriesFile>, routes: { window: RoutesFile; days: RoutesFile[] }, push: Push): void {
  const at = (s: SeriesFile, sec: number): number => Math.floor((sec - s.t0) / 60);
  const nulls = win.expected.all.filter((x) => x === null).length;
  push('V2-series', 'window n, expected.all null minutes', `${win.n}, ${nulls}`, '6720, 0', win.n === 6720 && nulls === 0);
  for (const [label, sec] of [['Thu 1 Oct 07:45', z(10, 1, 7, 45)], ['Fri 2 Oct 07:45', z(10, 2, 7, 45)]] as const) {
    const v = win.seen.all[at(win, sec)];
    push('V2-series', `seen.all ${label}`, String(v), 'at least 300', v !== null && v >= 300);
  }
  const off: string[] = [];
  for (let m = at(win, z(10, 1, 0)); m < win.n; m++) {
    if (win.service.hold[m] !== null) continue;
    if (win.service.state[m] === 'reduced' || win.service.state[m] === 'silent') off.push(`${zClock(win.t0 + m * 60)} ${win.service.state[m]}`);
  }
  push('V2-series', 'judged reduced or silent minutes, Thu 00:00 to the end', `${off.length}${off.length ? `; ${off.slice(0, 3).join(', ')}` : ''}`, '0', off.length === 0);
  let frozenMon = 0;
  for (let m = at(win, z(9, 28, 5, 3)); m <= at(win, z(9, 28, 5, 46)); m++) if (win.feed.frozen[m] === 1) frozenMon++;
  push('V2-series', 'feed.frozen minutes Mon 05:03 to 05:46', String(frozenMon), 'at least 40', frozenMon >= 40);
  const d24 = days['cet-0924'];
  const frozen24 = d24 ? d24.feed.frozen.filter((x) => x === 1).length : -1;
  push('V2-series', 'feed.frozen minutes on 24 Sep', String(frozen24), 'at most 5', frozen24 >= 0 && frozen24 <= 5);
  const alerts = win.feed.alerts.filter((x) => x !== null).length;
  push('V2-series', 'feed.alerts and cancelledTrips minutes with a value', `${alerts}, ${win.feed.cancelledTrips.filter((x) => x !== null).length}`, 'at least one each', alerts > 0 && win.feed.cancelledTrips.some((x) => x !== null));
  const pon = days['pon-0921'];
  // The plan expected 0 and exactly 120; ZET's own feed stalls a few minutes on a normal weekday (around 07:15,
  // service-state.ts), which is no recording gap: every null minute outside 24 Sep's missing 00:00 to 02:00 must
  // carry a header older than a minute, and there are at most five of them per day.
  const stalls = (s: SeriesFile | undefined, from: number): { n: number; recorded: number } => {
    let n = 0;
    let recorded = 0;
    if (!s) return { n: -1, recorded: -1 };
    for (let m = from; m < s.n; m++) {
      if (s.seen.all[m] !== null) continue;
      n++;
      if ((s.feed.headerAgeS[m] ?? 0) <= 60) recorded++;
    }
    return { n, recorded };
  };
  const ponGaps = stalls(pon, 0);
  const cetHead = d24 ? d24.seen.all.slice(0, 120).filter((x) => x === null).length : -1;
  const cetGaps = stalls(d24, 120);
  push('V2-days', 'seen.all null minutes: pon-0921; cet-0924 00:00 to 02:00 and after', `${ponGaps.n}; ${cetHead} and ${cetGaps.n}`, 'ZET stalls only (at most 5); 120 and ZET stalls only (at most 5)',
    ponGaps.n >= 0 && ponGaps.n <= 5 && ponGaps.recorded === 0 && cetHead === 120 && cetGaps.n >= 0 && cetGaps.n <= 5 && cetGaps.recorded === 0);

  const r = routes.window;
  const idx = (id: string): number => r.routes.findIndex((x) => x.id === id);
  const { seen, expected } = decodeRoutes(r);
  const slot = (sec: number): number => Math.floor((sec - r.t0) / r.step);
  const e6 = idx('6') >= 0 ? expected[idx('6')]![slot(z(9, 28, 7, 45))] : null;
  const s17 = idx('17') >= 0 ? seen[idx('17')]![slot(z(10, 1, 7, 45))] : null;
  push('V2-routes', 'window routes n, route count', `${r.n}, ${r.routes.length}`, '1344, at least 100', r.n === 1344 && r.routes.length >= 100);
  push('V2-routes', 'route 6 expected Mon 07:45, route 17 seen Thu 07:45', `${e6}, ${s17}`, 'over 0 (not 255), at least 1', e6 !== null && e6 > 0 && e6 !== 255 && s17 !== null && s17 >= 1 && s17 !== 255);
  push('V2-routes', 'comparison days n', routes.days.map((d) => d.n).join(', '), '288 each', routes.days.length === 2 && routes.days.every((d) => d.n === 288));
  const trams = r.routes.filter((x) => x.type === 0).length;
  push('V2-routes', 'trams first', `${trams} trams then ${r.routes.length - trams} buses`, 'no tram after a bus', r.routes.every((x, i) => i < trams ? x.type === 0 : x.type === 3));
}

export async function stageVerify(paths: Paths, log: (line: string) => void): Promise<boolean> {
  const manifestText = readFileSync(join(paths.objects, 'manifest.json'), 'utf8');
  const manifest = decodeManifest(JSON.parse(manifestText));
  const read = <T>(path: string): T => JSON.parse(readFileSync(join(paths.objects, path), 'utf8')) as T;
  const win = read<SeriesFile>(manifest.files.series.path);
  const days: Record<string, SeriesFile> = Object.fromEntries(manifest.comparisons.map((c) => [c.id, read<SeriesFile>(c.files.series.path)]));
  const rows = verifySeries(win, days['cet-0924']!);
  const push: Push = (row, measure, value, threshold, ok) => { rows.push({ row, measure, value, threshold, ok }); };
  const routesWindow = read<RoutesFile>(manifest.files.routes.path);
  verifyV2(win, days, { window: routesWindow, days: manifest.comparisons.map((c) => read<RoutesFile>(c.files.routes.path)) }, push);

  // Motion: every chunk within budget, the count, the 12:00 chunks of both normal days.
  const index = read<MotionIndex>(manifest.files.motionIndex.path);
  let largest = { gzip: 0, path: '' };
  let over = 0;
  for (const chunk of index.chunks) {
    const gzip = gzipSync(readFileSync(join(paths.objects, chunk.path))).length;
    if (gzip > largest.gzip) largest = { gzip, path: chunk.path };
    if (gzip > CHUNK_GZIP_MAX) over++;
  }
  push('V2-motion', 'chunks, largest gzip bytes', `${index.chunks.length}, ${largest.gzip} (${largest.path}), ${over} over`, `at least 900, at most ${CHUNK_GZIP_MAX}`, over === 0 && index.chunks.length >= 900);
  for (const c of SNIMKA_COMPARISONS) {
    const noon = index.chunks.find((x) => x.net === '395' && x.t0 === c.fromSec + 12 * 3600);
    push('V2-motion', `vehicles in the ${c.id} chunk of 12:00`, String(noon?.vehicles ?? 'no chunk'), 'at least 300', (noon?.vehicles ?? 0) >= 300);
  }

  // Events: the Monday freeze resolves to 05:03, and every pointer resolves (the events stage refused any that did not; re-checked here).
  const events = read<EventsFile>(manifest.files.events.path);
  const pon = events.events.find((e) => e.id === 'feed-stoji-pon');
  push('V2-events', 'feed-stoji-pon resolves to', pon ? zClock(pon.atSec) : 'absent', '09-28 05:03', pon !== undefined && zClock(pon.atSec) === '09-28 05:03');
  const places = read<PlacesFile>(manifest.files.places.path);
  const stations = read<StationsFile>(manifest.files.stations.path);
  const notices = read<NoticesFile>(manifest.files.notices.path);
  const news = read<NewsFile>(manifest.files.news.path);
  const known = { routes: new Set(routesWindow.routes.map((x) => x.id)), stations: new Set(stations.stations.map((x) => x.id)), places: new Set(places.places.map((x) => x.id)) };
  const bad: string[] = [];
  const check = (where: string, item: { focus: Focus; mentions: Mentions; facts: string[] }): void => {
    const f = item.focus;
    if (f.kind === 'route' && !known.routes.has(f.id)) bad.push(`${where} route ${f.id}`);
    if (f.kind === 'station' && !known.stations.has(f.id)) bad.push(`${where} station ${f.id}`);
    if (f.kind === 'place' && (!known.places.has(f.id) || !f.lonLat)) bad.push(`${where} place ${f.id}`);
    for (const x of item.mentions.routes ?? []) if (!known.routes.has(x)) bad.push(`${where} mentions route ${x}`);
    for (const x of item.mentions.stations ?? []) if (!known.stations.has(x)) bad.push(`${where} mentions station ${x}`);
    for (const x of item.mentions.places ?? []) if (!known.places.has(x)) bad.push(`${where} mentions place ${x}`);
    for (const x of item.facts) if (x.startsWith('route:') && !known.routes.has(x.slice(6))) bad.push(`${where} fact ${x}`);
  };
  for (const e of events.events) check(`event ${e.id}`, e);
  for (const n of notices.items) check(`notice ${n.id}`, n);
  for (const n of news.items) check(`news ${n.id}`, n);
  const chaptersWithoutSpot = events.events.filter((e) => e.chapter && e.spot === undefined).map((e) => e.id);
  push('V2-pointers', 'focus and mentions ids that do not resolve; chapters without a spot', `${bad.length}${bad.length ? `: ${bad.slice(0, 3).join(', ')}` : ''}; ${chaptersWithoutSpot.length}`, '0; 0', bad.length === 0 && chaptersWithoutSpot.length === 0);
  const outside = places.places.filter((p) => p.lonLat[0] < 15.8 || p.lonLat[0] > 16.2 || p.lonLat[1] < 45.7 || p.lonLat[1] > 45.95).map((p) => p.id);
  push('V2-places', 'places outside 15.8 to 16.2 E, 45.7 to 45.95 N', `${outside.length} of ${places.places.length}`, '0', outside.length === 0 && places.places.length >= 12);

  // Boards and voice.
  const thinBoards = manifest.files.boards.filter((b) => b.samples < 1000).map((b) => `${b.stop} ${b.samples}`);
  push('V2-boards', 'boards, those under 1,000 samples', `${manifest.files.boards.length}, ${thinBoards.length ? thinBoards.join(', ') : 'none'}`, '8, none', manifest.files.boards.length === 8 && thinBoards.length === 0);
  const voiceIndex = read<VoiceIndex>(manifest.files.voiceIndex.path);
  const voice = voiceIndex.days.map((d) => read<VoiceFile>(d.file.path));
  const covered = voice.reduce((sum, d) => sum + d.minutes.filter((m) => m !== null).length, 0);
  const total = voice.reduce((sum, d) => sum + d.n, 0);
  push('V2-voice', 'voice minutes with a reading', `${covered} of ${total}`, `all ${SNIMKA_WINDOW.minutes}`, covered === SNIMKA_WINDOW.minutes && total === SNIMKA_WINDOW.minutes);
  const minuteAt = (sec: number): { d: VoiceFile; m: VoiceFile['minutes'][number] } | null => {
    const d = voice.find((x) => sec >= x.t0 && sec < x.t0 + x.n * 60);
    return d ? { d, m: d.minutes[(sec - d.t0) / 60] ?? null } : null;
  };
  const mon = minuteAt(z(9, 28, 7, 45));
  const monLead = mon?.m ? mon.d.facts[mon.m.f[0] ?? -1]?.id ?? null : null;
  push('V2-voice', 'lead fact Mon 07:45', String(monLead), 'service:zet', monLead === 'service:zet');
  const thu = minuteAt(z(10, 1, 7, 45));
  const thuDep = thu?.m ? thu.m.f.some((i) => thu.d.facts[i]!.id.startsWith('dep:')) : false;
  push('V2-voice', 'a dep: fact Thu 07:45', String(thuDep), 'true', thuDep);
  const strike = voice.flatMap((d) => [...d.facts.map((f) => f.text), ...d.sentences]).filter((t) => /štrajk/iu.test(t)).length;
  push('V2-voice', 'voice facts and sentences matching /štrajk/i', String(strike), '0', strike === 0);
  // The rows quote ZET's own notice titles as the wall listed them; nothing else may carry the word.
  const strikeRows = voice.flatMap((d) => d.rows).filter((r) => /štrajk/iu.test(`${r.title} ${r.sub ?? ''}`));
  const foreign = strikeRows.filter((r) => !(r.kind === 'notice' && r.source === 'zet-novosti'));
  push('V2-voice', 'rows with /štrajk/i that are not ZET notice titles', `${foreign.length} (${strikeRows.length} ZET notice rows)`, '0', foreign.length === 0);

  // Exports: row counts and shape.
  const exp = (name: string): ExportRef | undefined => manifest.files.exports.find((e) => e.name === name);
  const rowsOf = (name: string): number | null => exp(name)?.rows ?? null;
  const bikesHead = exp('bikes-5min') ? readFileSync(join(paths.objects, exp('bikes-5min')!.path), 'utf8').split('\n', 1)[0]!.split(',').length : 0;
  push('V2-exports', 'rows: series, hourly', `${rowsOf('series')}, ${rowsOf('hourly')}`, '6721, 113', rowsOf('series') === 6721 && rowsOf('hourly') === 113);
  push('V2-exports', 'rows: routes-5min', String(rowsOf('routes-5min')), `${1344 * routesWindow.routes.length + 1}`, rowsOf('routes-5min') === 1344 * routesWindow.routes.length + 1);
  push('V2-exports', 'bikes-5min rows and columns', `${rowsOf('bikes-5min')} x ${bikesHead}`, `1345 x ${stations.stations.length + 2}`, rowsOf('bikes-5min') === 1345 && bikesHead === stations.stations.length + 2);
  const geo = exp('closures') ? read<{ type: string; features: unknown[] }>(exp('closures')!.path) : null;
  const opis = read<OpisFile>(manifest.files.opis.path);
  push('V2-exports', 'closures FeatureCollection features; opis exports', `${geo?.type} ${geo?.features.length}; ${opis.exports.length}`, 'FeatureCollection, at least 1; every export but opis', geo?.type === 'FeatureCollection' && (geo?.features.length ?? 0) > 0 && opis.exports.length === manifest.files.exports.length - 1);

  // Integrity of what would be uploaded.
  let missing = 0;
  let objects = 0;
  let bytes = 0;
  for (const line of readFileSync(join(paths.out, 'upload-list.txt'), 'utf8').split('\n').filter(Boolean)) {
    const [path, size] = line.split('\t');
    objects++;
    const file = join(paths.objects, path);
    if (!existsSync(file)) { missing++; continue; }
    const body = readFileSync(file);
    bytes += body.length;
    const named = path === 'manifest.json' || path.includes(`.${createHash('sha256').update(body).digest('hex').slice(0, 16)}.`);
    if (body.length !== Number(size) || !named) missing++;
  }
  rows.push({ row: 'objects', measure: 'upload list: present, sized and named by hash', value: `${objects - missing} of ${objects}, ${bytes} bytes`, threshold: 'all', ok: missing === 0 });

  const width = (k: keyof Row): number => Math.max(k.length, ...rows.map((r) => String(r[k]).length));
  const cols: (keyof Row)[] = ['row', 'measure', 'value', 'threshold'];
  const fmt = (r: Record<string, string>): string => `| ${cols.map((c) => String(r[c]).padEnd(width(c))).join(' | ')} | ${r.ok} |`;
  console.log(fmt({ row: 'row', measure: 'measure', value: 'value', threshold: 'threshold', ok: 'ok' }));
  for (const r of rows) console.log(fmt({ ...r, ok: r.ok ? 'pass' : 'MISS' } as unknown as Record<string, string>));
  const misses = rows.filter((r) => !r.ok).length;
  log(`verify: ${rows.length - misses} of ${rows.length} rows pass${misses ? `, ${misses} MISS` : ''}`);
  return misses === 0;
}
