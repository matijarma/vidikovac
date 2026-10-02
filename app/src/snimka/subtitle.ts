// The subtitle band at the map's foot (plan section 3.4, decision S-15): the
// sentence the public screen at Trg bana J. Jelačića showed where an observed
// run covers the minute ("Zaslon je rekao", marked "Zapis"), else the sentence
// today's rules give for the minute ("Zaslon bi rekao", marked "Današnja
// pravila"). A sentence holds at least 1,200 ms of wall time at any speed; the
// latest offer wins when the hold expires; the same text is no change. At 600x
// and faster the observed readings are sampled at the first reading of each
// replay minute, so the band does not try to show twenty-second readings that
// pass in a thirtieth of a second. Not aria-live: the band changes too often
// to be announced, and the feed is the accessible account of what happened.
import { isScreenIndex, isScreenRun, type ScreenIndex, type ScreenRun } from '../../../shared/snimka';
import { SnimkaError } from '../../../shared/snimka-codec';
import type { SubtitleHandle, MountSubtitle } from './contracts';
import type { SnimkaContext } from './context';
import { nextRunAfter, readingIndexAt, runShownAt, type IndexRun } from './screen';
import { SN } from './strings';
import { voiceData, voiceSentence, type VoiceAt } from './voice-data';

export type SubtitleSource = 'observed' | 'replayed' | 'none';
export interface SubtitleLine { source: SubtitleSource; text: string | null }

export const SUBTITLE_HOLD_MS = 1200;
/** From this speed on, observed readings are sampled at the first reading of each replay minute. */
export const SAMPLE_FROM_SPEED = 600;

export interface SubtitleSelector {
  /** Offers the line for the current instant; true when the shown line changed. */
  offer(line: SubtitleLine): boolean;
  shown(): SubtitleLine | null;
  /** Milliseconds until a waiting line may show, or null when none waits. */
  dueIn(): number | null;
  /** Shows the waiting line if its hold is over; true when the shown line changed. */
  flush(): boolean;
}

const same = (a: SubtitleLine | null, b: SubtitleLine | null): boolean => Boolean(a && b && a.source === b.source && a.text === b.text);

/** The hold logic, pure over an injected wall clock. */
export function createSubtitleSelector(o: { holdMs?: number; now?: () => number } = {}): SubtitleSelector {
  const holdMs = o.holdMs ?? SUBTITLE_HOLD_MS;
  const now = o.now ?? ((): number => performance.now());
  let current: SubtitleLine | null = null;
  let shownAt = -Infinity;
  let waiting: SubtitleLine | null = null;
  const show = (line: SubtitleLine): true => {
    current = line;
    shownAt = now();
    waiting = null;
    return true;
  };
  return {
    offer(line) {
      if (same(line, current)) { waiting = null; return false; }
      if (now() - shownAt >= holdMs) return show(line);
      waiting = line;
      return false;
    },
    shown: () => current,
    dueIn: () => (waiting ? Math.max(0, shownAt + holdMs - now()) : null),
    flush() {
      if (!waiting || now() - shownAt < holdMs) return false;
      return show(waiting);
    },
  };
}

/** The observed reading's index at an instant: the latest at or before it, or at 600x and faster the first reading of
 *  the replay minute (the latest before it when the minute has none). -1 before the run's first reading. */
export function observedIndexAt(run: Pick<ScreenRun, 'readings'>, tSec: number, speed: number): number {
  if (speed >= SAMPLE_FROM_SPEED) {
    const from = Math.floor(tSec / 60) * 60;
    const i = readingIndexAt(run, from - 1) + 1;
    const r = run.readings[i];
    if (r && r.at < from + 60) return i;
  }
  return readingIndexAt(run, tSec);
}

export interface SubtitleInputs {
  /** The run covering the instant: loaded, on its way, or none. */
  run: ScreenRun | 'loading' | null;
  voice: VoiceAt | 'loading' | null;
  tSec: number;
  speed: number;
}

/** The line for an instant, or null while what decides it is still loading (the band keeps what it shows). */
export function subtitleLineAt(i: SubtitleInputs): SubtitleLine | null {
  if (i.run === 'loading') return null;
  if (i.run) {
    const k = Math.max(0, observedIndexAt(i.run, i.tSec, i.speed));
    const reading = i.run.readings[k];
    if (reading) return { source: 'observed', text: reading.sentence };
  }
  if (i.voice === 'loading') return null;
  const text = i.voice ? voiceSentence(i.voice.file, i.voice.minute) : null;
  return text ? { source: 'replayed', text } : { source: 'none', text: null };
}

/** Which source the subtitle uses at an instant, from the index alone (the Zaslon section's default). */
export { screenSourceAt as subtitleSourceAt } from './screen';

// ---- the screen's runs, shared by the band (the ref cache shares the fetches with screen.ts) ----

const decodeIndex = (raw: unknown): ScreenIndex => {
  if (!isScreenIndex(raw)) throw new SnimkaError('screen index: not a screen index');
  return raw;
};
const decodeRun = (raw: unknown): ScreenRun => {
  if (!isScreenRun(raw)) throw new SnimkaError('screen run: not a screen run');
  return raw;
};

export interface RunLoader {
  index(): ScreenIndex | null;
  /** The run shown at the instant: loaded, 'loading' (the load starts, the next run is prefetched), or null. */
  runAt(tSec: number): ScreenRun | 'loading' | null;
  destroy(): void;
}

export function createRunLoader(ctx: Pick<SnimkaContext, 'manifest' | 'data'>, changed: () => void): RunLoader {
  let index: ScreenIndex | null = null;
  let indexState: 'loading' | 'ready' | 'failed' = 'loading';
  let destroyed = false;
  const runs = new Map<string, ScreenRun>();
  const pending = new Set<string>();
  const failed = new Set<string>();
  ctx.data.get(ctx.manifest.files.screenIndex, decodeIndex).then(
    (ix) => { index = ix; indexState = 'ready'; if (!destroyed) changed(); },
    () => { indexState = 'failed'; if (!destroyed) changed(); },
  );
  const load = (run: IndexRun): void => {
    if (runs.has(run.id) || pending.has(run.id) || failed.has(run.id)) return;
    pending.add(run.id);
    ctx.data.get(run.file, decodeRun).then(
      (value) => { pending.delete(run.id); runs.set(run.id, value); if (!destroyed) changed(); },
      () => { pending.delete(run.id); failed.add(run.id); if (!destroyed) changed(); },
    );
  };
  return {
    index: () => index,
    runAt(tSec) {
      if (indexState === 'loading') return 'loading';
      if (!index) return null;
      const next = nextRunAfter(index, tSec);
      if (next) load(next);
      const run = runShownAt(index, tSec);
      if (!run || failed.has(run.id)) return null;
      const loaded = runs.get(run.id);
      if (loaded) return loaded;
      load(run);
      return 'loading';
    },
    destroy() { destroyed = true; },
  };
}

// ---- the mount -------------------------------------------------------------------------------

let noteIds = 0;

export const mountSubtitle: MountSubtitle = (ctx, root): SubtitleHandle => {
  const doc = ctx.doc ?? root.ownerDocument;
  const S = SN.subtitle;
  const noteId = `sn-sub-note-${++noteIds}`;
  const band = doc.createElement('div');
  band.className = 'sn-sub';
  band.setAttribute('role', 'group');
  band.setAttribute('aria-label', S.label);
  band.dataset.snSubSource = 'none';
  const kicker = doc.createElement('span');
  kicker.className = 'sn-sub-kicker';
  const mark = doc.createElement('button');
  mark.type = 'button';
  mark.className = 'sn-sub-mark';
  mark.setAttribute('aria-describedby', noteId);
  mark.setAttribute('aria-expanded', 'false');
  const markText = doc.createElement('span');
  markText.className = 'sn-sub-mark-text';
  mark.append(markText);
  const note = doc.createElement('span');
  note.className = 'sn-sub-note';
  note.id = noteId;
  note.setAttribute('role', 'tooltip');
  const text = doc.createElement('span');
  text.className = 'sn-sub-text';
  const head = doc.createElement('span');
  head.className = 'sn-sub-head';
  head.append(kicker, mark, note);
  band.append(head, text);
  root.replaceChildren(band);

  // A tap shows the note on a touch screen; hover and focus show it through the sheet.
  const setOpen = (open: boolean): void => {
    band.dataset.open = open ? 'true' : 'false';
    mark.setAttribute('aria-expanded', open ? 'true' : 'false');
  };
  setOpen(false);
  mark.addEventListener('click', () => setOpen(band.dataset.open !== 'true'));
  mark.addEventListener('keydown', (e) => { if (e.key === 'Escape' && band.dataset.open === 'true') { setOpen(false); e.stopPropagation(); } });
  mark.addEventListener('blur', () => setOpen(false));

  const render = (line: SubtitleLine): void => {
    band.dataset.snSubSource = line.source;
    if (line.source === 'none') {
      head.hidden = true;
      text.textContent = S.none;
      return;
    }
    head.hidden = false;
    const observed = line.source === 'observed';
    kicker.textContent = observed ? S.observed : S.replayed;
    markText.textContent = observed ? S.markObserved : S.markReplayed;
    note.textContent = observed ? S.observedNote : S.replayedNote;
    text.textContent = line.text ?? '';
  };

  const selector = createSubtitleSelector({ holdMs: SUBTITLE_HOLD_MS });
  let timer: ReturnType<typeof setTimeout> | null = null;
  let destroyed = false;
  let lastT = ctx.clock.now();
  const voice = voiceData(ctx);

  const schedule = (): void => {
    if (timer !== null) return;
    const due = selector.dueIn();
    if (due === null) return;
    timer = setTimeout(() => {
      timer = null;
      if (destroyed) return;
      if (selector.flush()) render(selector.shown()!);
      schedule();
    }, due + 16);
  };

  const update = (t: number): void => {
    if (destroyed) return;
    lastT = t;
    const tSec = Math.floor(t / 1000);
    const line = subtitleLineAt({ run: runs.runAt(tSec), voice: voice.minuteAt(tSec), tSec, speed: ctx.clock.playing() ? ctx.clock.speed() : 1 });
    if (line && selector.offer(line)) render(line);
    schedule();
  };

  const runs = createRunLoader(ctx, () => update(lastT));
  const offVoice = voice.onLoad(() => update(lastT));
  update(lastT);

  return {
    update,
    destroy() {
      destroyed = true;
      runs.destroy();
      offVoice();
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
  };
};
