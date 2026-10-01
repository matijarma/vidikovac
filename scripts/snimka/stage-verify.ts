// Stage `verify` (lane S1): acceptance rows SN-1 to SN-3 of the brief
// (section 10) measured on the built objects, printed as a table; any miss
// makes the build exit 1. Also checks that every object upload-list.txt names
// exists with its size and the hash in its name, and that the manifest decodes.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { decodeManifest } from '../../shared/snimka-codec';
import { SNIMKA_COMPARISON, type MotionIndex, type SeriesFile } from '../../shared/snimka';
import { CHUNK_GZIP_MAX } from './stage-frames';
import type { Paths } from './paths';

/** Zagreb wall time (CEST) of the strike week or 1 October, epoch seconds. */
const z = (month: 9 | 10, day: number, hh: number, mm = 0): number => Date.UTC(2026, month - 1, day, hh - 2, mm) / 1000;
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

export async function stageVerify(paths: Paths, log: (line: string) => void): Promise<boolean> {
  const manifestText = readFileSync(join(paths.objects, 'manifest.json'), 'utf8');
  const manifest = decodeManifest(JSON.parse(manifestText));
  const read = <T>(path: string): T => JSON.parse(readFileSync(join(paths.objects, path), 'utf8')) as T;
  const rows = verifySeries(read<SeriesFile>(manifest.files.series.path), read<SeriesFile>(manifest.files.comparisonSeries.path));

  const index = read<MotionIndex>(manifest.files.motionIndex.path);
  let largest = { gzip: 0, path: '' };
  let over = 0;
  for (const chunk of index.chunks) {
    const gzip = gzipSync(readFileSync(join(paths.objects, chunk.path))).length;
    if (gzip > largest.gzip) largest = { gzip, path: chunk.path };
    if (gzip > CHUNK_GZIP_MAX) over++;
  }
  rows.push({ row: 'SN-2', measure: 'largest motion chunk, gzip bytes', value: `${largest.gzip} (${largest.path}), ${over} over`, threshold: `at most ${CHUNK_GZIP_MAX}`, ok: over === 0 && index.chunks.length > 0 });
  const noon = SNIMKA_COMPARISON.fromSec + 12 * 3600;
  const noonChunk = index.chunks.find((c) => c.net === '395' && c.t0 === noon);
  rows.push({ row: 'SN-2', measure: 'vehicles in the 24 Sep chunk of 12:00', value: String(noonChunk?.vehicles ?? 'no chunk'), threshold: 'at least 300', ok: (noonChunk?.vehicles ?? 0) >= 300 });

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
