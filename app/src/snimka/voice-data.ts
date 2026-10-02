// The replayed voice (decision S-15): the companion's own sentence for every
// minute of the window, computed offline with today's rules. The index is
// small and loads on first use; a day file (about 100 KB) loads when a minute
// of it is asked for, and the next day is prefetched then, so a passive replay
// never waits at midnight. One store per context: the subtitle, the feed and
// the Zaslon section share the same loads (the ref cache would share the
// fetch anyway; the store also shares the decoded state and the listeners).
//
// Every read is synchronous and answers 'loading' while a file is on its way,
// so a frame never awaits; whoever asked subscribes with onLoad and asks again.
import { isVoiceFile, isVoiceIndex, type VoiceFact, type VoiceFile, type VoiceIndex, type VoiceMinute, type VoiceRow } from '../../../shared/snimka';
import { SnimkaError } from '../../../shared/snimka-codec';
import type { SnimkaContext } from './context';

export type VoiceDay = VoiceIndex['days'][number];
/** A minute of the replayed voice with the day file it indexes into. */
export interface VoiceAt { file: VoiceFile; minute: VoiceMinute; i: number }

export type VoiceContext = Pick<SnimkaContext, 'manifest' | 'data'>;

export interface VoiceData {
  /** The index, null while loading or when it failed. */
  index(): VoiceIndex | null;
  /** The day whose span holds the instant (seconds), null outside every day or before the index. */
  dayAt(atSec: number): VoiceDay | null;
  /** A loaded day file; undefined while not loaded, null when it failed. */
  file(day: string): VoiceFile | null | undefined;
  /** Loads one day (once); resolves null when it cannot be had. */
  load(day: string): Promise<VoiceFile | null>;
  /** Loads the index (once); resolves null when it cannot be had. */
  loadIndex(): Promise<VoiceIndex | null>;
  /** The minute at the instant: 'loading' while the index or the day is on its way (the load starts here, the next day
   *  is prefetched), null where the voice has no minute (outside the days, a null minute, a failed file). */
  minuteAt(atSec: number): VoiceAt | null | 'loading';
  /** Every loaded day file, in day order. */
  loaded(): VoiceFile[];
  /** Called after the index or any day file settles. */
  onLoad(fn: () => void): () => void;
}

const decodeIndex = (raw: unknown): VoiceIndex => {
  if (!isVoiceIndex(raw)) throw new SnimkaError('voice index: not a voice index');
  return raw;
};
const decodeDay = (raw: unknown): VoiceFile => {
  if (!isVoiceFile(raw)) throw new SnimkaError('voice day: not a voice file');
  return raw;
};

const stores = new WeakMap<object, VoiceData>();

/** The context's voice store (one per context, created on first use). */
export function voiceData(ctx: VoiceContext): VoiceData {
  let store = stores.get(ctx);
  if (!store) {
    store = createVoiceData(ctx);
    stores.set(ctx, store);
  }
  return store;
}

export function createVoiceData(ctx: VoiceContext): VoiceData {
  let index: VoiceIndex | null = null;
  let indexState: 'idle' | 'loading' | 'ready' | 'failed' = 'idle';
  let indexPromise: Promise<VoiceIndex | null> | null = null;
  const files = new Map<string, VoiceFile | null>();
  const pending = new Map<string, Promise<VoiceFile | null>>();
  const listeners = new Set<() => void>();
  const emit = (): void => { for (const fn of [...listeners]) fn(); };

  const loadIndex = (): Promise<VoiceIndex | null> => {
    if (indexPromise) return indexPromise;
    indexState = 'loading';
    indexPromise = ctx.data.get(ctx.manifest.files.voiceIndex, decodeIndex).then(
      (ix) => {
        index = { ...ix, days: [...ix.days].sort((a, b) => a.t0 - b.t0) };
        indexState = 'ready';
        emit();
        return index;
      },
      () => { indexState = 'failed'; emit(); return null; },
    );
    return indexPromise;
  };

  const dayAt = (atSec: number): VoiceDay | null => {
    if (!index) return null;
    for (const d of index.days) if (atSec >= d.t0 && atSec < d.t0 + d.n * 60) return d;
    return null;
  };

  const load = (day: string): Promise<VoiceFile | null> => {
    if (files.has(day)) return Promise.resolve(files.get(day) ?? null);
    const inFlight = pending.get(day);
    if (inFlight) return inFlight;
    const p = loadIndex().then(async (ix) => {
      const entry = ix?.days.find((d) => d.day === day);
      if (!entry) return null;
      try { return await ctx.data.get(entry.file, decodeDay); } catch { return null; }
    }).then((file) => {
      pending.delete(day);
      files.set(day, file);
      emit();
      return file;
    });
    pending.set(day, p);
    return p;
  };

  const minuteAt = (atSec: number): VoiceAt | null | 'loading' => {
    if (indexState === 'idle') void loadIndex();
    if (indexState === 'loading') return 'loading';
    if (!index) return null;
    const day = dayAt(atSec);
    if (!day) return null;
    const file = files.get(day.day);
    if (file === undefined) {
      void load(day.day);
      return 'loading';
    }
    // The next day is fetched while this one plays.
    const k = index.days.indexOf(day);
    const next = index.days[k + 1];
    if (next && !files.has(next.day) && !pending.has(next.day)) void load(next.day);
    if (file === null) return null;
    const i = Math.floor((atSec - file.t0) / file.step);
    const minute = i >= 0 && i < file.n ? file.minutes[i] ?? null : null;
    return minute ? { file, minute, i } : null;
  };

  return {
    index: () => index,
    dayAt,
    file: (day) => files.get(day),
    load,
    loadIndex,
    minuteAt,
    loaded: () => (index ? index.days.map((d) => files.get(d.day)).filter((f): f is VoiceFile => Boolean(f)) : []),
    onLoad(fn) {
      listeners.add(fn);
      return () => { listeners.delete(fn); };
    },
  };
}

/** The voice minute at an instant through the context's store (see VoiceData.minuteAt). */
export function voiceMinuteAt(ctx: VoiceContext, atSec: number): VoiceAt | null | 'loading' {
  return voiceData(ctx).minuteAt(atSec);
}

/** One day file by its day ('2026-09-28'), null when it cannot be had. */
export function loadVoiceDay(ctx: VoiceContext, day: string): Promise<VoiceFile | null> {
  return voiceData(ctx).load(day);
}

/** The minute's lead sentence, or null. */
export function voiceSentence(file: VoiceFile, minute: VoiceMinute): string | null {
  return minute.lead === null ? null : file.sentences[minute.lead] ?? null;
}

/** The minute's rows, in the order the voice gives them. */
export function voiceRows(file: VoiceFile, minute: VoiceMinute): VoiceRow[] {
  return minute.r.map((i) => file.rows[i]).filter((r): r is VoiceRow => Boolean(r));
}

/** The fact the lead sentence speaks: the minute's fact whose text opens the sentence, else its first fact. */
export function leadFact(file: VoiceFile, minute: VoiceMinute): VoiceFact | null {
  const facts = minute.f.map((i) => file.facts[i]).filter((f): f is VoiceFact => Boolean(f));
  if (!facts.length) return null;
  const sentence = voiceSentence(file, minute);
  if (sentence) {
    const match = facts.find((f) => f.text === sentence || sentence.startsWith(f.text.replace(/[.!?]$/, '')));
    if (match) return match;
  }
  return facts[0]!;
}

/** The family of a fact: its kind, with departures split by their wording (a live departure is a new voice). */
export function factFamily(fact: Pick<VoiceFact, 'kind' | 'wording'>): string {
  return fact.kind === 'departure' && fact.wording ? `departure-${fact.wording}` : fact.kind;
}
