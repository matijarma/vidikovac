// Stage `boards` (lane V1, split from the screen stage): the timetable boards
// of the eight recorded stops every 5 minutes (strike/boards/<stamp>/<stop>.json),
// one BoardSeries v2 per stop with its places.json id: up to three departures
// at or after each sample, never padded.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SNIMKA_WINDOW, type BoardRef, type BoardSeries, type PlacesFile } from '../../shared/snimka';
import { stampSec } from './stage-bajs';
import { readWork, writeJsonObject, writeWork, type Paths } from './paths';

/** The eight stops the recorder read, with the place each one belongs to. */
export const BOARD_STOPS: readonly { stop: string; place: string }[] = [
  { stop: '106_1', place: 'jelacic' }, { stop: '106_2', place: 'jelacic' }, { stop: '98_1', place: 'crnomerec' }, { stop: '208_24', place: 'dubrava' },
  { stop: '271_24', place: 'savski-most' }, { stop: '236_1', place: 'kvaternikov-trg' }, { stop: '109_1', place: 'glavni-kolodvor' }, { stop: '245_1', place: 'ljubljanica' },
];

interface BoardRaw { stopName?: string; status?: string; departures?: { routeId?: string; headsign?: string; at?: string }[] }

export function boardSeries(dir: string, stop: string, place: string | null, fromSec: number, toSec: number): BoardSeries {
  const out: BoardSeries = { v: 2, stop, name: stop, place, samples: [] };
  for (const stamp of readdirSync(dir).sort()) {
    const at = stampSec(stamp);
    const file = join(dir, stamp, `${stop}.json`);
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

export async function stageBoards(paths: Paths, log: (line: string) => void): Promise<boolean> {
  const places = new Set(readWork<PlacesFile>(paths, 'places.json').places.map((p) => p.id));
  const dir = join(paths.inputs, 'strike', 'boards');
  const boards: BoardRef[] = [];
  for (const { stop, place } of BOARD_STOPS) {
    if (!places.has(place)) throw new Error(`boards: ${stop} belongs to ${place}, which places.json does not have`);
    const series = boardSeries(dir, stop, place, SNIMKA_WINDOW.fromSec, SNIMKA_WINDOW.toSec);
    const ref = writeJsonObject(paths, `boards/${stop}`, series);
    boards.push({ ...ref, stop, name: series.name, samples: series.samples.length });
  }
  writeWork(paths, 'boards-refs.json', { boards });
  log(`boards: ${boards.map((b) => `${b.stop} ${b.samples}`).join(', ')} samples`);
  return true;
}
