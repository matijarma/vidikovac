// Stage `screen` (lane S1): what the public screen at Trg bana J. Jelačića
// said, from the observer's runs (strike/observe-*/rotation.jsonl, one reading
// every 2 s): every tenth reading (one per 20 s), the rows of the "U blizini"
// list de-duplicated into the run's dictionary, each header sentence given its
// family. And the timetable board of stop 106_1 every 5 minutes, which the page
// shows between runs. The observer masked the pairing code (and anything that
// looked like one) as "••••·••••" before writing; that is kept as recorded.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SNIMKA_WINDOW, type BoardSeries, type HashedRef, type ScreenIndex, type ScreenReading, type ScreenRow, type ScreenRun, type SentenceFamily, type SnimkaState } from '../../shared/snimka';
import { stampSec } from './stage-bajs';
import { writeJsonObject, writeWork, type Paths } from './paths';

export const KEEP_EVERY = 10;

type RunKind = ScreenIndex['runs'][number]['kind'];
export interface ScreenRunWork { id: string; dir: string; kind: RunKind; fromSec: number; toSec: number; readings: number; file: HashedRef; summary: ScreenIndex['runs'][number]['summary'] }
export interface ScreenWork { runs: ScreenRunWork[]; board106: HashedRef }

/** The kind of an observer run, from its folder name. */
export function runKind(dir: string): RunKind {
  if (dir.endsWith('-series')) return 'series';
  if (dir.endsWith('-return')) return 'return';
  if (/^observe-\d{4}-\d{4}$/.test(dir)) return 'slot';
  return 'adhoc';
}

const DEPARTURE_LIVE = /polazi za \d+ min|\bsada\b/i;

/** The family of a header sentence: by its fact id first, by its kicker and words where the fact id is the sentence itself. */
export function familyOf(fact: string | null, sentence: string, kicker: string | null): SentenceFamily {
  const kind = (fact ?? '').split('|')[0];
  switch (kind) {
    case 'departureIn':
      return 'departure-live';
    case 'departureAt':
      return DEPARTURE_LIVE.test(sentence) ? 'departure-live' : 'departure-timetable';
    case 'firstTram':
    case 'lastTram':
      return 'first-last';
    case 'service':
      return 'service';
    case 'outage':
      return 'outage';
    case 'trainAt':
      return 'rail';
    case 'bikes':
    case 'bikesEmpty':
      return 'bikes';
    case 'closureUntil':
      return 'closure';
    case 'event':
      return 'event';
    case 'weather':
    case 'weatherTemperature':
    case 'hourlyTemp':
      return 'weather';
    case 'sunrise':
    case 'sunset':
    case 'sunriseAt':
    case 'sunsetAt':
    case 'sunsetTime':
      return 'solar';
    case 'notice':
      return 'notice';
    case 'text':
      return familyOfText(sentence, kicker);
    default:
      return 'other';
  }
}

/** Before the fact ids were typed (Monday and Tuesday), a reading's fact was `text|<sentence>`. */
function familyOfText(sentence: string, kicker: string | null): SentenceFamily {
  if (/^ZET ne šalje položaje/.test(sentence)) return 'outage';
  if (/^ZET: u pokretu/.test(sentence)) return 'service';
  if (/^ZET javlja|^ZET:/.test(sentence)) return 'notice';
  if (/^(Tramvaj|Autobus) \S+, smjer .*, polazi/.test(sentence)) return DEPARTURE_LIVE.test(sentence) ? 'departure-live' : 'departure-timetable';
  if (/^(Prvi|Zadnji) (tramvaj|autobus)/.test(sentence)) return 'first-last';
  if (/: vlak, smjer /.test(sentence)) return 'rail';
  if (/^BAJS /.test(sentence) || kicker === 'bicikli') return 'bikes';
  if (/zatvoreno za promet/.test(sentence) || kicker === 'radovi') return 'closure';
  if (/počinje događanje/.test(sentence)) return 'event';
  if (/[Ss]unce (izlazi|zalazi)|(Izlazak|Zalazak) sunca/.test(sentence)) return 'solar';
  if (/°C/.test(sentence)) return 'weather';
  return 'other';
}

interface RawRow { id?: string; kind?: string; source?: string | null; live?: boolean; title?: string; whenText?: string | null; sub?: string | null; caveat?: boolean }
interface RawReading { at?: number; place?: string; sentence?: string; kicker?: string | null; kickerText?: string | null; fact?: string | null; rows?: RawRow[]; pills?: string | null; fleet?: { pins?: number; service?: string } | null }

const STATES = new Set(['normal', 'reduced', 'silent', 'unknown']);
const orNull = (s: string | null | undefined): string | null => (typeof s === 'string' && s !== '' ? s : null);

export function buildRun(id: string, kind: RunKind, lines: RawReading[]): ScreenRun | null {
  const readings = lines.filter((r) => typeof r.at === 'number' && typeof r.sentence === 'string');
  if (readings.length === 0) return null;
  const rows: ScreenRow[] = [];
  const rowIndex = new Map<string, number>();
  const kept: ScreenReading[] = [];
  readings.forEach((r, i) => {
    if (i % KEEP_EVERY !== 0) return;
    const refs: number[] = [];
    for (const raw of r.rows ?? []) {
      const row: ScreenRow = { id: String(raw.id ?? ''), kind: String(raw.kind ?? ''), source: orNull(raw.source), live: raw.live === true, title: String(raw.title ?? ''), whenText: orNull(raw.whenText), sub: orNull(raw.sub), caveat: raw.caveat === true };
      const key = JSON.stringify(row);
      let idx = rowIndex.get(key);
      if (idx === undefined) {
        idx = rows.length;
        rowIndex.set(key, idx);
        rows.push(row);
      }
      refs.push(idx);
    }
    const fleet = r.fleet ? { pins: Number.isInteger(r.fleet.pins) ? r.fleet.pins! : null, service: typeof r.fleet.service === 'string' && STATES.has(r.fleet.service) ? (r.fleet.service as SnimkaState) : null } : null;
    const fact = orNull(r.fact);
    // The observer records how many map notes were drawn, never their text: the note is unknown, so null.
    kept.push({ at: Math.floor(r.at! / 1000), sentence: r.sentence!, kicker: orNull(r.kicker), kickerText: orNull(r.kickerText), fact, family: familyOf(fact, r.sentence!, orNull(r.kicker)), rows: refs, pills: orNull(r.pills), mapNote: null, fleet });
  });
  return {
    v: 1, id, kind, place: readings.find((r) => typeof r.place === 'string')?.place ?? 'Trg bana J. Jelačića',
    fromSec: Math.floor(readings[0].at! / 1000), toSec: Math.ceil(readings[readings.length - 1].at! / 1000), rows, readings: kept,
  };
}

export function summaryOf(run: ScreenRun): ScreenIndex['runs'][number]['summary'] {
  const sentences: Partial<Record<SentenceFamily, number>> = {};
  let departureRows = 0;
  let liveRows = 0;
  for (const r of run.readings) {
    sentences[r.family] = (sentences[r.family] ?? 0) + 1;
    for (const idx of r.rows) {
      const row = run.rows[idx];
      if (row.kind !== 'departure') continue;
      departureRows++;
      if (row.live) liveRows++;
    }
  }
  return { sentences, departureRows, liveRows };
}

interface BoardRaw { stopName?: string; status?: string; departures?: { routeId?: string; headsign?: string; at?: string }[] }

export function boardSeries(dir: string, fromSec: number, toSec: number): BoardSeries {
  const out: BoardSeries = { v: 2, stop: '106_1', name: 'Trg bana J. Jelačića', place: 'jelacic', samples: [] };
  for (const stamp of readdirSync(dir).sort()) {
    const at = stampSec(stamp);
    const file = join(dir, stamp, '106_1.json');
    if (at === null || at < fromSec || at >= toSec || !existsSync(file)) continue;
    let board: BoardRaw;
    try {
      board = JSON.parse(readFileSync(file, 'utf8')) as BoardRaw;
    } catch {
      continue;
    }
    if (typeof board.stopName === 'string') out.name = board.stopName;
    const next: [string, string, number][] = [];
    for (const d of board.departures ?? []) {
      const sec = d.at ? Math.floor(Date.parse(d.at) / 1000) : NaN;
      if (!Number.isFinite(sec) || sec < at || typeof d.routeId !== 'string') continue;
      next.push([d.routeId, String(d.headsign ?? ''), sec]);
      if (next.length === 3) break;
    }
    out.samples.push({ at, status: String(board.status ?? 'unknown'), next });
  }
  return out;
}

export async function stageScreen(paths: Paths, log: (line: string) => void): Promise<boolean> {
  const root = join(paths.inputs, 'strike');
  const runs: ScreenRunWork[] = [];
  for (const dir of readdirSync(root).filter((d) => d.startsWith('observe-') && existsSync(join(root, d, 'rotation.jsonl'))).sort()) {
    const lines: RawReading[] = [];
    for (const line of readFileSync(join(root, dir, 'rotation.jsonl'), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        lines.push(JSON.parse(line) as RawReading);
      } catch {
        // a truncated last line of an interrupted run
      }
    }
    const id = dir.slice('observe-'.length);
    const run = buildRun(id, runKind(dir), lines);
    if (!run || run.toSec <= SNIMKA_WINDOW.fromSec || run.fromSec >= SNIMKA_WINDOW.toSec) continue;
    const file = writeJsonObject(paths, `screen/${id}`, run);
    runs.push({ id, dir, kind: run.kind, fromSec: run.fromSec, toSec: run.toSec, readings: run.readings.length, file, summary: summaryOf(run) });
  }
  runs.sort((a, b) => a.fromSec - b.fromSec);
  const board = boardSeries(join(root, 'boards'), SNIMKA_WINDOW.fromSec, SNIMKA_WINDOW.toSec);
  const board106 = writeJsonObject(paths, 'screen/board-106_1', board);
  writeWork(paths, 'screen-runs.json', { runs, board106 } satisfies ScreenWork);
  const families: Record<string, number> = {};
  for (const r of runs) for (const [f, c] of Object.entries(r.summary.sentences)) families[f] = (families[f] ?? 0) + (c ?? 0);
  log(`screen: ${runs.length} runs (${runs.reduce((s, r) => s + r.readings, 0)} readings kept), board 106_1 ${board.samples.length} samples; families ${JSON.stringify(families)}`);
  return true;
}
