// Stage `voice` (lane V1, plan section 5 "voice"): the companion's own voice
// at Jelačić for every minute of the window, computed afterwards with today's
// rules (S-15, voice-engine.ts), from the frames stage's trimmed zet-rt
// payload per minute (work/wall-window.jsonl.gz), the recorded boards of
// stops 106_1 and 106_2 (the nearest copy at or before the minute, at most
// 5 min old) and every other module from the nearest strike/teaser-full copy
// within 10 min. A minute without a payload holds the last one with its old
// header, so a frozen feed reads `unconfirmed` exactly as the wall would.
// Written as one VoiceFile per Zagreb day (facts, rows and sentences
// deduplicated into the day's dictionaries) and the VoiceIndex.

import { existsSync, readdirSync, readFileSync, createReadStream } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';
import { canonicalPlaces } from '../../shared/city/events';
import { placeFromStop } from '../../shared/city/place';
import { emptyCity, type CatalogueChunk, type CityState, type DepartureBoard } from '../../shared/city/types';
import { SNIMKA_WINDOW, VOICE_PLACE, ZAGREB_OFFSET_S, type HashedRef, type VoiceFact, type VoiceFile, type VoiceIndex, type VoiceMinute, type VoiceRow } from '../../shared/snimka';
import type { ScreenStop } from '../../app/src/core/contracts';
import type { ModuleSnapshot } from '../../worker/feed/schema';
import type { WallLine } from './stage-frames';
import { stampSec } from './stage-bajs';
import { writeJsonObject, writeWork, type Paths } from './paths';
import { createVoiceEngine, type VoiceStep } from './voice-engine';

export const BOARD_HOLD_S = 300;
export const TEASER_NEAR_S = 600;
const VOICE_BOARDS = ['106_1', '106_2'];
const STRIKE_WORD = /štrajk|strajk|strike/iu;

export interface VoiceStats {
  minutes: number; nullMinutes: number; firstSec: number | null;
  states: Record<string, number>; unconfirmed: { fromSec: number; toSec: number }[];
  leadWordings: Record<string, number>; strikeWord: number;
  probes: Record<string, { lead: string | null; leadFact: string | null; facts: string[]; state: string } | null>;
  days: { day: string; n: number; facts: number; rows: number; sentences: number; bytes: number }[];
}
export interface VoiceRefs { index: HashedRef; days: VoiceIndex['days'] }

/** The city catalogue as the wall loads it (app/public/data/city), as the strike seed reads it. */
export function loadCity(repo: string): CityState {
  const root = join(repo, 'app/public/data/city');
  const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8')) as { sources: { chunks: { hash: string; part?: unknown }[] }[] };
  const chunks: CatalogueChunk[] = [];
  for (const source of manifest.sources) for (const c of source.chunks) {
    if (c.part) continue;
    const file = join(root, 'chunks', `${c.hash}.json`);
    if (existsSync(file)) chunks.push(JSON.parse(readFileSync(file, 'utf8')) as CatalogueChunk);
  }
  const data = chunks.map((c) => (c as unknown as { data: Record<string, unknown[] | undefined> }).data);
  return { ...emptyCity(), manifest, places: canonicalPlaces(data.flatMap((d) => (d.places ?? []) as never[])), streets: data.flatMap((d) => d.streets ?? []),
    paths: data.flatMap((d) => d.paths ?? []), settlements: data.flatMap((d) => d.settlements ?? []) } as unknown as CityState;
}

/** A trimmed payload line as the zet-rt snapshot the wall polls: the header, the sources, the items. */
export function wallSnapshot(line: WallLine, attribution: ModuleSnapshot['attribution']): ModuleSnapshot {
  return {
    module: 'zet-rt', tier: 'session', status: 'live', fetchedAt: new Date(line.h * 1000).toISOString(),
    ...(line.sourceUpdatedAt ? { sourceUpdatedAt: line.sourceUpdatedAt } : {}), ...(line.validUntil ? { validUntil: line.validUntil } : {}),
    attribution, items: line.items.map((item) => ({ ...item, module: 'zet-rt', tier: 'session' })) as ModuleSnapshot['items'],
    ...(line.sources ? { sources: line.sources as ModuleSnapshot['sources'] } : {}),
  } as ModuleSnapshot;
}

/** Zagreb days of the window: Sun 240 minutes, Mon to Thu 1,440, Fri 720. */
export function voiceDays(fromSec: number, minutes: number): { day: string; t0: number; n: number }[] {
  const out: { day: string; t0: number; n: number }[] = [];
  let t = fromSec;
  const end = fromSec + minutes * 60;
  while (t < end) {
    const local = new Date((t + ZAGREB_OFFSET_S) * 1000);
    const day = local.toISOString().slice(0, 10);
    const nextMidnight = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + 1) / 1000 - ZAGREB_OFFSET_S;
    const to = Math.min(nextMidnight, end);
    out.push({ day, t0: t, n: (to - t) / 60 });
    t = to;
  }
  return out;
}

/** One day's dictionaries: each distinct fact, row and sentence once, the minutes as indices. */
export class DayBuilder {
  facts: VoiceFact[] = [];
  rows: VoiceRow[] = [];
  sentences: string[] = [];
  minutes: (VoiceMinute | null)[];
  private factIndex = new Map<string, number>();
  private rowIndex = new Map<string, number>();
  private sentenceIndex = new Map<string, number>();
  constructor(readonly day: string, readonly t0: number, readonly n: number) {
    this.minutes = new Array<VoiceMinute | null>(n).fill(null);
  }
  private intern<T>(list: T[], index: Map<string, number>, value: T): number {
    const key = JSON.stringify(value);
    let i = index.get(key);
    if (i === undefined) {
      i = list.length;
      list.push(value);
      index.set(key, i);
    }
    return i;
  }
  put(i: number, at: number, step: VoiceStep, numbers: { seen: number | null; expected: number | null }): void {
    const f = step.facts.map((fact) => this.intern(this.facts, this.factIndex, { id: fact.id, kind: String(fact.kind), wording: fact.wording ?? null, text: fact.text }));
    const r = step.rows.map((row) => this.intern(this.rows, this.rowIndex, {
      id: row.id, kind: String(row.kind), source: row.source ?? null, live: row.live === true, title: row.title, sub: row.sub ? row.sub : null,
      atSec: row.atMs === null || row.atMs === undefined ? null : Math.floor(row.atMs / 1000), caveat: (row as { caveat?: unknown }).caveat === true,
    } satisfies VoiceRow));
    const lead = step.lead ? this.intern(this.sentences, this.sentenceIndex, step.lead.text) : null;
    this.minutes[i] = { at, f, r, lead, state: step.state, voice: step.voice, seen: numbers.seen, expected: numbers.expected, note: null };
  }
  file(place: string): VoiceFile {
    return { v: 2, place, day: this.day, t0: this.t0, step: 60, n: this.n, facts: this.facts, rows: this.rows, sentences: this.sentences, minutes: this.minutes };
  }
}

/** Stamped copies in a folder (`<stamp>` or `<stamp>.json`), sorted by time. */
function stamped(dir: string): { sec: number; name: string }[] {
  return readdirSync(dir).map((name) => ({ sec: stampSec(name.replace(/\.json$/, '')), name })).filter((x): x is { sec: number; name: string } => x.sec !== null).sort((a, b) => a.sec - b.sec);
}

export async function stageVoice(paths: Paths, log: (line: string) => void): Promise<boolean> {
  const strike = join(paths.inputs, 'strike');
  const stops = JSON.parse(readFileSync(join(paths.repo, 'app/public/data/stops.json'), 'utf8')) as ScreenStop[];
  const stop = stops.find((s) => s.id === VOICE_PLACE);
  if (!stop) throw new Error(`voice: stop ${VOICE_PLACE} is not in stops.json`);
  const place = placeFromStop(stop, (r) => Number(r) < 100);
  const city = loadCity(paths.repo);
  // The sentence code reports every refused slot on console.debug, once per minute and fact; counted, not printed.
  const debug = console.debug;
  let refused = 0;
  console.debug = () => { refused++; };
  try {
    return await runVoice(paths, log, strike, place, stops, city, () => refused);
  } finally {
    console.debug = debug;
  }
}

async function runVoice(paths: Paths, log: (line: string) => void, strike: string, place: ReturnType<typeof placeFromStop>, stops: ScreenStop[], city: CityState, refused: () => number): Promise<boolean> {
  const engine = createVoiceEngine({ place, stops, city });

  const boardStamps = stamped(join(strike, 'boards'));
  const teaserStamps = stamped(join(strike, 'teaser-full'));
  let boardCache: { name: string; boards: DepartureBoard[] } | null = null;
  let teaserCache: { name: string; modules: ModuleSnapshot[] } | null = null;
  let attribution: ModuleSnapshot['attribution'] | null = null;
  const boardsAt = (sec: number): DepartureBoard[] => {
    let pick: { sec: number; name: string } | null = null;
    for (const s of boardStamps) { if (s.sec > sec) break; pick = s; }
    if (!pick || sec - pick.sec > BOARD_HOLD_S) return [];
    if (boardCache?.name !== pick.name) {
      const dir = join(strike, 'boards', pick.name);
      boardCache = { name: pick.name, boards: VOICE_BOARDS.filter((b) => existsSync(join(dir, `${b}.json`))).map((b) => JSON.parse(readFileSync(join(dir, `${b}.json`), 'utf8')) as DepartureBoard) };
    }
    return boardCache.boards;
  };
  const teaserAt = (sec: number): ModuleSnapshot[] => {
    let best: { sec: number; name: string } | null = null;
    for (const s of teaserStamps) if (Math.abs(s.sec - sec) <= TEASER_NEAR_S && (!best || Math.abs(s.sec - sec) < Math.abs(best.sec - sec))) best = s;
    if (!best) return [];
    if (teaserCache?.name !== best.name) {
      const modules = (JSON.parse(readFileSync(join(strike, 'teaser-full', best.name), 'utf8')) as { modules: ModuleSnapshot[] }).modules;
      attribution ??= modules.find((m) => m.module === 'zet-rt')?.attribution ?? null;
      teaserCache = { name: best.name, modules: modules.filter((m) => m.module !== 'zet-rt') };
    }
    return teaserCache.modules;
  };
  // The ZET attribution of the snapshot: the recorded teaser's own.
  for (const s of teaserStamps) { teaserAt(s.sec); if (attribution) break; }
  if (!attribution) throw new Error('voice: no zet-rt module in strike/teaser-full to take the attribution from');

  const t0 = SNIMKA_WINDOW.fromSec;
  const n = SNIMKA_WINDOW.minutes;
  const days = voiceDays(t0, n).map((d) => new DayBuilder(d.day, d.t0, d.n));
  const dayOf = (m: number): { b: DayBuilder; i: number } => {
    const sec = t0 + m * 60;
    const b = days.find((d) => sec >= d.t0 && sec < d.t0 + d.n * 60)!;
    return { b, i: (sec - b.t0) / 60 };
  };
  const stats: VoiceStats = { minutes: n, nullMinutes: 0, firstSec: null, states: {}, unconfirmed: [], leadWordings: {}, strikeWord: 0, probes: {}, days: [] };
  const PROBES: Record<string, number> = { 'mon-0745': Date.UTC(2026, 8, 28, 5, 45) / 1000, 'thu-0745': Date.UTC(2026, 9, 1, 5, 45) / 1000, 'fri-0745': Date.UTC(2026, 9, 2, 5, 45) / 1000, 'mon-0520': Date.UTC(2026, 8, 28, 3, 20) / 1000 };

  const lines = createInterface({ input: createReadStream(join(paths.work, 'wall-window.jsonl.gz')).pipe(createGunzip()), crlfDelay: Infinity });
  const iterator = lines[Symbol.asyncIterator]();
  let pending: WallLine | null = null;
  const nextLine = async (): Promise<WallLine | null> => {
    const r = await iterator.next();
    return r.done ? null : (JSON.parse(r.value) as WallLine);
  };
  pending = await nextLine();
  let held: WallLine | null = null;
  let snapshot: ModuleSnapshot | null = null;
  let unconfirmedFrom: number | null = null;
  for (let m = 0; m < n; m++) {
    let fresh = false;
    while (pending && pending.m <= m) {
      if (pending.m === m) fresh = true;
      held = pending;
      pending = await nextLine();
    }
    const { b, i } = dayOf(m);
    const minuteSec = t0 + m * 60;
    if (!held) { stats.nullMinutes++; continue; }
    if (fresh || !snapshot) snapshot = wallSnapshot(held, attribution);
    stats.firstSec ??= minuteSec;
    // `now` is the minute's last header; a minute without one is read at its end, against the held payload.
    const nowMs = fresh ? held.h * 1000 : (minuteSec + 59) * 1000;
    const step = engine.step([snapshot, ...teaserAt(Math.floor(nowMs / 1000))], boardsAt(Math.floor(nowMs / 1000)), nowMs);
    const service = (snapshot.sources?.zet as { service?: { seen?: unknown; expected?: unknown } } | undefined)?.service;
    const whole = (x: unknown): number | null => (typeof x === 'number' && Number.isInteger(x) && x >= 0 ? x : null);
    b.put(i, minuteSec, step, { seen: whole(service?.seen), expected: whole(service?.expected) });
    stats.states[step.state] = (stats.states[step.state] ?? 0) + 1;
    if (step.state === 'unconfirmed') unconfirmedFrom ??= minuteSec;
    else if (unconfirmedFrom !== null) { stats.unconfirmed.push({ fromSec: unconfirmedFrom, toSec: minuteSec }); unconfirmedFrom = null; }
    const wording = step.lead?.wording ?? (step.lead ? 'none' : 'no-lead');
    stats.leadWordings[wording] = (stats.leadWordings[wording] ?? 0) + 1;
    if (step.facts.some((f) => STRIKE_WORD.test(f.text)) || (step.lead && STRIKE_WORD.test(step.lead.text))) stats.strikeWord++;
    for (const [key, sec] of Object.entries(PROBES)) {
      if (sec !== minuteSec) continue;
      stats.probes[key] = { lead: step.lead?.text ?? null, leadFact: step.lead ? (step.lead.factKey ?? step.lead.refs[0] ?? null) : null, facts: step.facts.map((f) => f.id), state: step.state };
    }
    if (m % 720 === 0) log(`voice: ${new Date((minuteSec + ZAGREB_OFFSET_S) * 1000).toISOString().slice(5, 16)} ${step.state} ${step.facts.length} facts, lead ${JSON.stringify(step.lead?.text ?? null)}`);
  }
  if (unconfirmedFrom !== null) stats.unconfirmed.push({ fromSec: unconfirmedFrom, toSec: t0 + n * 60 });
  lines.close();

  const index: VoiceIndex = { v: 2, place: VOICE_PLACE, days: [] };
  for (const d of days) {
    const file = d.file(VOICE_PLACE);
    const ref = writeJsonObject(paths, `voice/${d.day}`, file);
    index.days.push({ day: d.day, t0: d.t0, n: d.n, file: ref });
    stats.days.push({ day: d.day, n: d.n, facts: file.facts.length, rows: file.rows.length, sentences: file.sentences.length, bytes: ref.bytes });
    writeWork(paths, `voice-${d.day}.json`, file);
  }
  const indexRef = writeJsonObject(paths, 'voice/index', index);
  writeWork(paths, 'voice-refs.json', { index: indexRef, days: index.days } satisfies VoiceRefs);
  writeWork(paths, 'voice-stats.json', stats);
  log(`voice: ${n - stats.nullMinutes} of ${n} minutes, states ${JSON.stringify(stats.states)}, ${stats.unconfirmed.length} unconfirmed stretches, lead wordings ${JSON.stringify(stats.leadWordings)}, strike word in ${stats.strikeWord} minutes, ${refused()} refused sentence slots; days ${stats.days.map((d) => `${d.day} ${d.bytes} B`).join(', ')}`);
  if (stats.strikeWord > 0) throw new Error(`voice: ${stats.strikeWord} minutes carry the word štrajk`);
  return true;
}
