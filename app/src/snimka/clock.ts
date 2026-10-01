// The replay clock of /snimka/. One instant for the whole page, in epoch
// MILLISECONDS (the dataset is in seconds; convert at the edges):
//
//   now() = clamp(anchorT + (realNow() - anchorReal) * speed)  while playing and not suspended,
//   now() = anchorT                                             otherwise.
//
// Every mutation re-anchors at the current instant, so the clock is exact for
// an injected real clock (tests) and never drifts when the speed changes.
// onTick fires synchronously on mutations only: the frame loop (frames.ts)
// is what reads now() every animation frame. Reaching `end` while playing
// pauses the clock and fires 'end'.
import { SPEEDS, type Speed } from '../../../shared/snimka';

export type TickReason = 'play' | 'pause' | 'seek' | 'speed' | 'end' | 'suspend' | 'resume';

export interface Chapter { at: number; title: string; id: string }

export interface ReplayClock {
  /** The replay instant, epoch milliseconds, clamped to [start, end]. */
  now(): number;
  playing(): boolean;
  /** True between suspend() and resume() (a hidden tab): now() stands still even while playing. */
  suspended(): boolean;
  speed(): Speed;
  readonly start: number;
  readonly end: number;
  /** Starts from now(); at `end` it does nothing (seek first). */
  play(): void;
  pause(): void;
  toggle(): void;
  /** Keeps the instant, changes the rate. */
  setSpeed(s: Speed): void;
  /** Clamps into the window; keeps the playing state unless the target is the end. */
  seek(t: number): void;
  /** seek(now() + ms). */
  step(ms: number): void;
  chapters(): readonly Chapter[];
  /** Index of the latest chapter at or before now(), or -1. */
  chapterIndex(): number;
  /** Seeks to the latest chapter strictly more than 2 s of replay before now() and returns it; null when there is none. */
  prevChapter(): Chapter | null;
  /** Seeks to the first chapter after now() and returns it; null when there is none. */
  nextChapter(): Chapter | null;
  suspend(): void;
  resume(): void;
  onTick(fn: (t: number, reason: TickReason) => void): () => void;
  destroy(): void;
}

export interface ReplayClockOptions {
  start: number;
  end: number;
  at?: number;
  speed?: Speed;
  playing?: boolean;
  chapters?: readonly Chapter[];
  /** The real clock, epoch or monotonic milliseconds; Date.now by default. */
  now?: () => number;
}

/** prevChapter() skips a chapter the reader has only just reached. */
export const CHAPTER_BACK_MS = 2000;
export const DEFAULT_SPEED: Speed = 600;

export function createReplayClock(o: ReplayClockOptions): ReplayClock {
  const { start, end } = o;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new Error('replay clock: end must come after start');
  const realNow = o.now ?? ((): number => Date.now());
  const clamp = (t: number): number => (t < start ? start : t > end ? end : t);
  const chapters: readonly Chapter[] = Object.freeze([...(o.chapters ?? [])].sort((a, b) => a.at - b.at));
  const listeners = new Set<(t: number, reason: TickReason) => void>();

  let speed: Speed = o.speed ?? DEFAULT_SPEED;
  let anchorT = clamp(Number.isFinite(o.at ?? Number.NaN) ? (o.at as number) : start);
  let anchorReal = realNow();
  let playing = Boolean(o.playing) && anchorT < end;
  let suspended = false;
  let destroyed = false;

  /** The instant without side effects. */
  const current = (): number => (playing && !suspended ? clamp(anchorT + (realNow() - anchorReal) * speed) : anchorT);
  const emit = (reason: TickReason): void => {
    for (const fn of [...listeners]) fn(anchorT, reason);
  };
  const reanchor = (): void => {
    anchorT = current();
    anchorReal = realNow();
  };
  const finish = (): void => {
    anchorT = end;
    anchorReal = realNow();
    playing = false;
    emit('end');
  };

  const clock: ReplayClock = {
    start,
    end,
    now() {
      const t = current();
      if (playing && !suspended && t >= end) finish();
      return t;
    },
    playing: () => playing,
    suspended: () => suspended,
    speed: () => speed,
    play() {
      if (destroyed || playing) return;
      if (anchorT >= end) return;
      anchorReal = realNow();
      playing = true;
      emit('play');
    },
    pause() {
      if (!playing) return;
      reanchor();
      playing = false;
      emit('pause');
    },
    toggle() {
      if (playing) clock.pause();
      else clock.play();
    },
    setSpeed(s) {
      if (!(SPEEDS as readonly number[]).includes(s)) throw new Error(`replay clock: speed ${String(s)} is not one of ${SPEEDS.join(', ')}`);
      if (s === speed) return;
      reanchor();
      speed = s;
      emit('speed');
    },
    seek(t) {
      if (!Number.isFinite(t)) return;
      anchorT = clamp(t);
      anchorReal = realNow();
      emit('seek');
      if (playing && anchorT >= end) finish();
    },
    step(ms) {
      clock.seek(current() + ms);
    },
    chapters: () => chapters,
    chapterIndex() {
      const t = clock.now();
      let index = -1;
      for (let i = 0; i < chapters.length; i++) if (chapters[i]!.at <= t) index = i;
      return index;
    },
    prevChapter() {
      const limit = clock.now() - CHAPTER_BACK_MS;
      let found: Chapter | null = null;
      for (const ch of chapters) if (ch.at < limit) found = ch;
      if (found) clock.seek(found.at);
      return found;
    },
    nextChapter() {
      const t = clock.now();
      const found = chapters.find((ch) => ch.at > t) ?? null;
      if (found) clock.seek(found.at);
      return found;
    },
    suspend() {
      if (suspended) return;
      reanchor();
      suspended = true;
      emit('suspend');
    },
    resume() {
      if (!suspended) return;
      suspended = false;
      anchorReal = realNow();
      emit('resume');
    },
    onTick(fn) {
      listeners.add(fn);
      return () => { listeners.delete(fn); };
    },
    destroy() {
      destroyed = true;
      playing = false;
      listeners.clear();
    },
  };
  return clock;
}
