// Stage `closures` (lane S1): the City's road-closure dataset (data.zagreb.hr,
// "prometnice"), one recorded copy per change, as one list of closures and,
// per copy, which closures it lists with the end that copy published. The
// ends roll: about half of the works move their `expectedEndTime` a day
// forward every night (REPORT.md section 4.3), so an end is kept as each copy
// published it and never used to decide whether a listed closure is active.

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SNIMKA_WINDOW, type ClosuresFile, type Col, type HashedRef } from '../../shared/snimka';
import { stampSec } from './stage-bajs';
import { writeJsonObject, writeWork, type Paths } from './paths';

export interface ClosuresMinutes { t0: number; n: number; active: Col<number>; version: Col<number> }
export interface ClosuresRefs { closures: HashedRef; versions: number; closureCount: number }

interface RawClosure { type?: string; street?: string; subtype?: string | null; polyline?: string; direction?: string | null; expectedEndTime?: string | null; expectedStartTime?: string | null }

const isoSec = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
};

/** "lat lon lat lon ..." as [lon, lat] pairs, six decimals. */
export function parsePolyline(text: string): [number, number][] {
  const nums = text.trim().split(/\s+/).map(Number);
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) {
    const [lat, lon] = [nums[i], nums[i + 1]];
    if (Number.isFinite(lat) && Number.isFinite(lon)) out.push([Math.round(lon * 1e6) / 1e6, Math.round(lat * 1e6) / 1e6]);
  }
  return out;
}

export async function stageClosures(paths: Paths, log: (line: string) => void): Promise<boolean> {
  const dir = join(paths.inputs, 'strike', 'prometnice');
  const t0 = SNIMKA_WINDOW.fromSec;
  const n = SNIMKA_WINDOW.minutes;
  const copies: { at: number; list: RawClosure[]; hash: string }[] = [];
  for (const name of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    const at = stampSec(name);
    if (at === null || at >= SNIMKA_WINDOW.toSec) continue;
    const text = readFileSync(join(dir, name), 'utf8');
    let list: RawClosure[];
    try {
      list = JSON.parse(text) as RawClosure[];
    } catch {
      log(`closures: ${name} unreadable, skipped`);
      continue;
    }
    if (!Array.isArray(list)) continue;
    const hash = createHash('sha256').update(text).digest('hex');
    // A copy identical to the one before is the same version.
    if (copies.length > 0 && copies[copies.length - 1].hash === hash) continue;
    copies.push({ at, list, hash });
  }
  const file: ClosuresFile = { v: 1, versions: [], closures: [], byVersion: [] };
  const byIdentity = new Map<string, number>();
  copies.forEach((copy, i) => {
    file.versions.push({ fromSec: copy.at, toSec: i + 1 < copies.length ? copies[i + 1].at : null });
    const row: [number, number | null][] = [];
    const seen = new Set<number>();
    for (const raw of copy.list) {
      if (typeof raw.street !== 'string' || typeof raw.polyline !== 'string') continue;
      const identity = `${raw.street}\t${createHash('sha256').update(raw.polyline).digest('hex')}`;
      let idx = byIdentity.get(identity);
      if (idx === undefined) {
        idx = file.closures.length;
        byIdentity.set(identity, idx);
        file.closures.push({
          id: idx,
          street: raw.street,
          type: String(raw.type ?? ''),
          subtype: typeof raw.subtype === 'string' ? raw.subtype : null,
          direction: typeof raw.direction === 'string' ? raw.direction : null,
          line: parsePolyline(raw.polyline),
          startSec: isoSec(raw.expectedStartTime),
        });
      }
      if (seen.has(idx)) continue;
      seen.add(idx);
      row.push([idx, isoSec(raw.expectedEndTime)]);
    }
    file.byVersion.push(row);
  });
  // Active in a minute: listed by the copy that covers it and already started (the published end is not applied).
  const minutes: ClosuresMinutes = { t0, n, active: new Array(n).fill(null), version: new Array(n).fill(null) };
  let v = -1;
  for (let m = 0; m < n; m++) {
    const at = t0 + m * 60;
    while (v + 1 < file.versions.length && file.versions[v + 1].fromSec <= at + 59) v++;
    if (v < 0) continue;
    minutes.version[m] = v;
    minutes.active[m] = file.byVersion[v].filter(([idx]) => { const s = file.closures[idx].startSec; return s === null || s <= at + 59; }).length;
  }
  const ref = writeJsonObject(paths, 'closures/window', file);
  writeWork(paths, 'closures-minutes.json', minutes);
  writeWork(paths, 'closures-refs.json', { closures: ref, versions: file.versions.length, closureCount: file.closures.length } satisfies ClosuresRefs);
  log(`closures: ${file.versions.length} versions, ${file.closures.length} closures, first copy ${new Date(file.versions[0]!.fromSec * 1000).toISOString()}`);
  return true;
}
