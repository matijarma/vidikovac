// Zaslon: a purpose-built miniature of the public screen at Trg bana J.
// Jelačića (its own sheet, never kiosk.css, so the replay never depends on the
// wall's styles), the nearest capture of the real screen, and five mornings at
// 07:45 (Monday to Friday). The miniature has two sources (plan section 4,
// decision S-15), chosen by a segmented control whose default is the one the
// subtitle uses at the clock: "Zapis", the latest recorded reading at or
// before the clock from the observed run whose span covers it (between runs
// the next timetable departures of the recorded board, with a note saying
// so); and "Današnja pravila", the sentence and the rows today's rules give
// for the minute, computed afterwards and labelled so. It re-renders only
// when what it shows changes, never on a frame that changes nothing. Every
// picture loads eagerly at low priority: the empty pictures of 1 October were
// lazy images never scrolled into view, not missing data.
import { isBoardSeries, isScreenIndex, isScreenRun, VOICE_PLACE, ZAGREB_OFFSET_S, type BoardSeries, type ScreenIndex, type ScreenReading, type ScreenRow, type ScreenRun } from '../../../shared/snimka';
import { SnimkaError } from '../../../shared/snimka-codec';
import { escapeHtml } from '../ui/dom/escape';
import type { SnimkaContext } from './context';
import { WEEKDAYS, zagrebClock, zagrebDay } from './format';
import { MORNING_S, midnightOf } from './reckoning';
import { SN, fill } from './strings';
import { voiceData, voiceRows, voiceSentence, type VoiceAt } from './voice-data';

export type IndexRun = ScreenIndex['runs'][number];

/** The nearest capture beside the miniature must be at most this far from the clock. */
export const CAPTURE_WITHIN_S = 6 * 3600;
/** A board sample older than this (two missed samples) is no longer "the next departures". */
export const BOARD_MAX_AGE_S = 15 * 60;
/** A slot run counts for a morning of the quartet when it starts this close to 07:45. */
export const QUARTET_WITHIN_S = 20 * 60;

// ---- choosing what to show (pure) ----------------------------------------------------

/** The run whose span covers the instant (seconds); where two overlap, the one that started last. */
export function runAt(index: ScreenIndex, tSec: number): IndexRun | null {
  let best: IndexRun | null = null;
  for (const r of index.runs) if (r.fromSec <= tSec && tSec <= r.toSec && (!best || r.fromSec > best.fromSec)) best = r;
  return best;
}

/** A run whose first reading comes at most this soon after the clock is shown from that reading: the observer's
 *  07:45 slots started a few seconds into their minute, and the replay opens and lands on chapters at :00. */
export const RUN_LEAD_S = 90;

/** The run the miniature shows: the one covering the instant, else one starting within RUN_LEAD_S after it. */
export function runShownAt(index: ScreenIndex, tSec: number): IndexRun | null {
  const covering = runAt(index, tSec);
  if (covering) return covering;
  const next = nextRunAfter(index, tSec);
  return next && next.fromSec - tSec <= RUN_LEAD_S ? next : null;
}

/** The first run that starts after the instant (prefetched while the current one shows). */
export function nextRunAfter(index: ScreenIndex, tSec: number): IndexRun | null {
  let best: IndexRun | null = null;
  for (const r of index.runs) if (r.fromSec > tSec && (!best || r.fromSec < best.fromSec)) best = r;
  return best;
}

/** The index of the latest reading at or before the instant, or -1 (binary search; readings are in time order). */
export function readingIndexAt(run: Pick<ScreenRun, 'readings'>, tSec: number): number {
  let lo = 0;
  let hi = run.readings.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (run.readings[mid]!.at <= tSec) { found = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return found;
}

export interface BoardView { at: number; next: BoardSeries['samples'][number]['next'] }

/** The latest board sample at or before the instant (within fifteen minutes) and its departures still to come. */
export function boardAt(board: BoardSeries, tSec: number): BoardView | null {
  let lo = 0;
  let hi = board.samples.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (board.samples[mid]!.at <= tSec) { found = mid; lo = mid + 1; } else hi = mid - 1;
  }
  if (found < 0) return null;
  const sample = board.samples[found]!;
  if (tSec - sample.at > BOARD_MAX_AGE_S) return null;
  return { at: sample.at, next: sample.next.filter(([, , atSec]) => atSec >= tSec) };
}

/** The run with a kiosk capture nearest the instant (zero inside its span), within six hours. */
export function nearestCapture(index: ScreenIndex, tSec: number, within = CAPTURE_WITHIN_S): IndexRun | null {
  let best: IndexRun | null = null;
  let bestD = Infinity;
  for (const r of index.runs) {
    if (!r.captures.kiosk) continue;
    const d = tSec < r.fromSec ? r.fromSec - tSec : tSec > r.toSec ? tSec - r.toSec : 0;
    if (d < bestD || (d === bestD && best && r.fromSec > best.fromSec)) { best = r; bestD = d; }
  }
  return bestD <= within ? best : null;
}

export type QuartetKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri';
const QUARTET_DAY: Partial<Record<number, QuartetKey>> = { 1: 'mon', 2: 'tue', 3: 'wed', 4: 'thu', 5: 'fri' };

export interface QuartetSlot { key: QuartetKey; atSec: number; run: IndexRun | null }

/** The mornings at 07:45 inside the window (Monday to Friday), each with the slot run nearest it within twenty minutes. */
export function quartet(index: Pick<ScreenIndex, 'runs'>, fromSec: number, toSec: number): QuartetSlot[] {
  const out: QuartetSlot[] = [];
  for (let day = midnightOf(fromSec); day < toSec; day += 86_400) {
    const atSec = day + MORNING_S;
    if (atSec < fromSec || atSec >= toSec) continue;
    const key = QUARTET_DAY[new Date((day + ZAGREB_OFFSET_S) * 1000).getUTCDay()];
    if (!key) continue;
    let run: IndexRun | null = null;
    for (const r of index.runs) {
      if (r.kind !== 'slot' || Math.abs(r.fromSec - atSec) > QUARTET_WITHIN_S) continue;
      if (!run || Math.abs(r.fromSec - atSec) < Math.abs(run.fromSec - atSec)) run = r;
    }
    out.push({ key, atSec, run });
  }
  return out;
}

export interface Badge { label: string; kind: 'tram' | 'bus' | 'other'; rest: string }

/** A Zagreb route number in its mode: trams run under 100, buses from 100 (night lines included). */
export function routeKind(route: string): Badge['kind'] {
  const n = /^\d{1,3}$/.test(route) ? Number(route) : NaN;
  return Number.isNaN(n) ? 'other' : n < 100 ? 'tram' : 'bus';
}

const DEPARTURE = /^(?:(Tramvaj|Autobus)\s+)?(\d{1,3}[A-Za-z]?)\s+(.+)$/u;

/** The line badge of a departure row ("13 Kvat. trg", "Tramvaj 6 prema Črnomercu"), or null for any other row. */
export function badgeOf(row: Pick<ScreenRow, 'kind' | 'title'>): Badge | null {
  if (row.kind !== 'departure') return null;
  const m = DEPARTURE.exec(row.title.trim());
  if (!m) return null;
  const kind = m[1] === 'Tramvaj' ? 'tram' : m[1] === 'Autobus' ? 'bus' : routeKind(m[2]!.replace(/\D+$/, ''));
  return { label: m[2]!, kind, rest: m[3]! };
}

// ---- the markup -----------------------------------------------------------------------

const badgeHtml = (b: Pick<Badge, 'label' | 'kind'>): string => `<span class="line" data-kind="${b.kind}" data-size="s">${escapeHtml(b.label)}</span>`;

interface RowView { when: string | null; live: boolean; badge: Pick<Badge, 'label' | 'kind'> | null; title: string; sub: string | null; timed: boolean; caveat: boolean }

function rowHtml(r: RowView): string {
  return `<li class="sn-mini-row" data-live="${r.live}"${r.caveat ? ' data-caveat="true"' : ''}>` +
    `<span class="sn-mini-when">${escapeHtml(r.when ?? '')}</span>` +
    `<span class="sn-mini-dot" data-timed="${r.timed}" aria-hidden="true"></span>` +
    `<span class="sn-mini-main"><span class="sn-mini-title">${r.badge ? `${badgeHtml(r.badge)} ` : ''}${escapeHtml(r.title)}</span>${r.sub ? `<span class="sn-mini-sub">${escapeHtml(r.sub)}</span>` : ''}</span></li>`;
}

function readingRows(run: ScreenRun, reading: ScreenReading): RowView[] {
  const out: RowView[] = [];
  for (const i of reading.rows) {
    const row = run.rows[i];
    if (!row) continue;
    const badge = badgeOf(row);
    out.push({ when: row.whenText, live: row.live, badge, title: badge ? badge.rest : row.title, sub: row.sub, timed: row.kind !== 'always', caveat: row.caveat });
  }
  return out;
}

function head(place: string, atSec: number, sentence: string, kicker: { key: string | null; text: string | null } | null): string {
  return `<header class="sn-mini-head">` +
    `<span class="sn-mini-where"><span class="sn-mini-brand">Kaj ima?</span> <span class="sn-mini-place">${escapeHtml(place)}</span></span>` +
    (kicker
      ? `<p class="sn-mini-sentence" data-kicker="${escapeHtml(kicker.key ?? '')}">${kicker.text ? `<span class="sn-mini-kicker">${escapeHtml(kicker.text)}</span> ` : ''}<span class="sn-mini-text">${escapeHtml(sentence)}</span></p>`
      : `<p class="sn-mini-sentence sn-mini-between"><span class="sn-mini-text">${escapeHtml(sentence)}</span></p>`) +
    `<span class="sn-mini-time"><span class="sn-mini-date">${escapeHtml(zagrebDay(atSec * 1000))}</span> <span class="sn-mini-clock">${escapeHtml(zagrebClock(atSec * 1000))}</span></span>` +
    `</header>`;
}

function nearby(rows: readonly RowView[], empty: string | null): string {
  return `<div class="sn-mini-nearby"><p class="sn-mini-nearby-title">${escapeHtml(SN.screen.nearby)}</p>` +
    (rows.length ? `<ol class="sn-mini-rows">${rows.map(rowHtml).join('')}</ol>` : `<p class="sn-mini-empty">${escapeHtml(empty ?? SN.strip.noValue)}</p>`) +
    `</div>`;
}

/** The miniature for one recorded reading. */
export function readingHtml(run: ScreenRun, reading: ScreenReading): string {
  return head(run.place, reading.at, reading.sentence, { key: reading.kicker, text: reading.kickerText }) +
    (reading.mapNote ? `<p class="sn-mini-note">${escapeHtml(reading.mapNote)}</p>` : '') +
    nearby(readingRows(run, reading), null);
}

/** The miniature between runs: the timetable's next departures with the note that says what they are. */
export function boardHtml(name: string, view: BoardView): string {
  const rows: RowView[] = view.next.map(([route, headsign, atSec]) => ({
    when: zagrebClock(atSec * 1000), live: false, badge: { label: route, kind: routeKind(route) }, title: headsign, sub: null, timed: true, caveat: false,
  }));
  return head(name || SN.screen.place, view.at, SN.screen.boardNote, null) + nearby(rows, SN.screen.boardNone);
}

/** Which source the subtitle uses at an instant: the record where a run is shown, else today's rules. */
export function screenSourceAt(index: Pick<ScreenIndex, 'runs'> | null, tSec: number): ScreenSource {
  return index && runShownAt(index as ScreenIndex, tSec) ? 'observed' : 'replayed';
}
export type ScreenSource = 'observed' | 'replayed';

/** The miniature for one replayed minute: today's sentence and rows, marked as today's rules. */
export function replayedHtml(place: string, voice: VoiceAt): string {
  const sentence = voiceSentence(voice.file, voice.minute);
  const rows: RowView[] = voiceRows(voice.file, voice.minute).map((row) => {
    const badge = badgeOf({ kind: row.kind, title: row.title });
    return { when: row.atSec === null ? null : zagrebClock(row.atSec * 1000), live: row.live, badge, title: badge ? badge.rest : row.title, sub: row.sub, timed: row.kind !== 'always', caveat: row.caveat };
  });
  return head(place, voice.minute.at, sentence ?? SN.screen.noReplayed, { key: 'replayed', text: SN.subtitle.markReplayed }) + nearby(rows, null);
}

const captureAlt = (run: IndexRun): string => fill(SN.screen.captureCaption, { day: zagrebDay(run.fromSec * 1000), time: zagrebClock(run.fromSec * 1000) });

/** A capture of the real screen as a picture, its alt and caption naming the day and the time. */
export function captureHtml(url: string, run: IndexRun, caption: string | null): string {
  const alt = captureAlt(run);
  return `<picture><source srcset="${escapeHtml(url)}" type="image/webp"><img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" width="1280" height="720" loading="eager" fetchpriority="low" decoding="async"></picture>` +
    `<figcaption>${caption === null ? escapeHtml(alt) : caption}</figcaption>`;
}

// ---- the mount ---------------------------------------------------------------------------

const decodeIndex = (raw: unknown): ScreenIndex => {
  if (!isScreenIndex(raw)) throw new SnimkaError('screen index: not a screen index');
  return raw;
};
const decodeRun = (raw: unknown): ScreenRun => {
  if (!isScreenRun(raw)) throw new SnimkaError('screen run: not a screen run');
  return raw;
};
const decodeBoard = (raw: unknown): BoardSeries => {
  if (!isBoardSeries(raw)) throw new SnimkaError('board: not a board series');
  return raw;
};

/** Zaslon on the page. Resolves the screen index for whoever else needs it (the reckoning's screen card). */
export function mountScreen(ctx: SnimkaContext, root: HTMLElement, onIndex: (index: ScreenIndex | null) => void): () => void {
  const S = SN.screen;
  root.innerHTML =
    `<div class="sn-screen-source" role="group" aria-label="${escapeHtml(S.sourceLabel)}">` +
    `<span class="sn-screen-source-label" aria-hidden="true">${escapeHtml(S.sourceLabel)}</span>` +
    `<button type="button" class="sn-screen-source-option" data-source="observed" aria-pressed="false">${escapeHtml(S.sourceObserved)}</button>` +
    `<button type="button" class="sn-screen-source-option" data-source="replayed" aria-pressed="false">${escapeHtml(S.sourceReplayed)}</button>` +
    `</div>` +
    `<p class="sn-screen-note" hidden>${escapeHtml(S.replayedNote)}</p>` +
    `<div class="sn-screen-grid">` +
    `<div class="sn-mini" role="group" aria-label="${escapeHtml(S.miniLabel)}" data-view="loading" aria-busy="true"><span class="skeleton sn-mini-skeleton"></span></div>` +
    `<figure class="sn-capture" data-view="none"><p class="sn-capture-none">${escapeHtml(S.noCapture)}</p></figure>` +
    `</div>` +
    `<section class="sn-quartet" aria-labelledby="sn-quartet-h"><h3 id="sn-quartet-h">${escapeHtml(S.quartetTitle)}</h3><p class="sn-quartet-lede">${escapeHtml(S.quartetLede)}</p><ol class="sn-quartet-list"></ol></section>`;
  root.removeAttribute('aria-busy');
  const mini = root.querySelector<HTMLElement>('.sn-mini')!;
  const capture = root.querySelector<HTMLElement>('.sn-capture')!;
  const list = root.querySelector<HTMLElement>('.sn-quartet-list')!;
  const note = root.querySelector<HTMLElement>('.sn-screen-note')!;
  const options = [...root.querySelectorAll<HTMLButtonElement>('.sn-screen-source-option')];

  let destroyed = false;
  let index: ScreenIndex | null = null;
  let board: BoardSeries | null = null;
  const runs = new Map<string, ScreenRun>();
  const pending = new Set<string>();
  /** Runs that did not load (after the cache's own retry): shown as between runs, never asked for again. */
  const failed = new Set<string>();
  let miniKey = '';
  let captureKey = '';
  /** The reader's choice; null follows the subtitle's source at the clock. */
  let chosen: ScreenSource | null = null;
  let shownSource: ScreenSource | null = null;
  const voice = voiceData(ctx);

  const setMini = (key: string, view: string, html: string): void => {
    if (key === miniKey) return;
    miniKey = key;
    mini.dataset.view = view;
    mini.innerHTML = html;
    if (view === 'loading') mini.setAttribute('aria-busy', 'true');
    else mini.removeAttribute('aria-busy');
  };

  const setSource = (source: ScreenSource): void => {
    if (source === shownSource) return;
    shownSource = source;
    root.dataset.snScreenSource = source;
    for (const b of options) b.setAttribute('aria-pressed', b.dataset.source === source ? 'true' : 'false');
    note.hidden = source !== 'replayed';
  };

  const load = (run: IndexRun): void => {
    if (runs.has(run.id) || pending.has(run.id) || failed.has(run.id)) return;
    pending.add(run.id);
    ctx.data.get(run.file, decodeRun).then(
      (value) => { pending.delete(run.id); runs.set(run.id, value); if (!destroyed) update(ctx.clock.now()); },
      () => { pending.delete(run.id); failed.add(run.id); if (!destroyed) update(ctx.clock.now()); },
    );
  };

  const showObserved = (tSec: number): void => {
    const covering = runShownAt(index!, tSec);
    const run = covering && !failed.has(covering.id) ? covering : null;
    if (run) {
      const loaded = runs.get(run.id);
      if (!loaded) {
        load(run);
        setMini(`loading:${run.id}`, 'loading', '<span class="skeleton sn-mini-skeleton"></span>');
      } else {
        // Before the first reading (a run starting within RUN_LEAD_S) the first one shows, with its own time.
        const i = Math.max(0, readingIndexAt(loaded, tSec));
        const reading = loaded.readings[i];
        if (reading) setMini(`run:${run.id}:${i}`, 'reading', readingHtml(loaded, reading));
      }
    } else {
      const view = board ? boardAt(board, tSec) : null;
      if (view) setMini(`board:${view.at}:${view.next.map((d) => d[2]).join(',')}`, 'board', boardHtml(board!.name, view));
      else setMini('none', 'none', head(S.place, tSec, S.boardNote, null) + nearby([], S.boardNone));
    }
  };

  const showReplayed = (tSec: number): void => {
    const at = voice.minuteAt(tSec);
    if (at === 'loading') setMini('voice:loading', 'loading', '<span class="skeleton sn-mini-skeleton"></span>');
    else if (at === null) setMini(`voice:none:${Math.floor(tSec / 60)}`, 'none', head(S.place, Math.floor(tSec / 60) * 60, S.noReplayed, null) + nearby([], SN.strip.noValue));
    else setMini(`voice:${at.file.day}:${at.i}`, 'replayed', replayedHtml(S.place, at));
  };

  const update = (tMs: number): void => {
    if (!index) return;
    const tSec = Math.floor(tMs / 1000);
    const source = chosen ?? screenSourceAt(index, tSec);
    setSource(source);
    if (source === 'observed') showObserved(tSec);
    else showReplayed(tSec);
    const next = nextRunAfter(index, tSec);
    if (next) load(next);
    const near = nearestCapture(index, tSec);
    const key = near ? near.id : 'none';
    if (key !== captureKey) {
      captureKey = key;
      capture.dataset.view = near ? 'capture' : 'none';
      capture.innerHTML = near && near.captures.kiosk
        ? captureHtml(ctx.data.url(near.captures.kiosk), near, null)
        : `<p class="sn-capture-none">${escapeHtml(S.noCapture)}</p>`;
    }
  };

  for (const b of options) {
    b.addEventListener('click', () => {
      chosen = b.dataset.source === 'replayed' ? 'replayed' : 'observed';
      update(ctx.clock.now());
    });
  }

  // ---- five mornings: the capture where one exists, and today's sentence for every morning ----
  let slots: QuartetSlot[] = [];
  const replayedLine = (slot: QuartetSlot): string => {
    const day = voice.dayAt(slot.atSec);
    const file = day ? voice.file(day.day) : null;
    if (file === undefined) return `<p class="sn-screen-replayed" data-state="loading"><span class="sn-screen-replayed-kicker">${escapeHtml(SN.subtitle.replayed)}</span> <span class="skeleton sn-screen-replayed-skeleton"></span></p>`;
    const minute = file ? file.minutes[Math.floor((slot.atSec - file.t0) / file.step)] ?? null : null;
    const sentence = file && minute ? voiceSentence(file, minute) : null;
    return `<p class="sn-screen-replayed"${sentence ? '' : ' data-state="none"'}><span class="sn-screen-replayed-kicker">${escapeHtml(SN.subtitle.replayed)}</span> ` +
      `<span class="sn-screen-replayed-text">${escapeHtml(sentence ?? S.noReplayed)}</span></p>`;
  };
  const renderQuartet = (): void => {
    list.innerHTML = slots
      .map((slot) => {
        const day = `<strong class="sn-quartet-day">${escapeHtml(zagrebDay(slot.atSec * 1000))}</strong> ${escapeHtml(S.quartet[slot.key])}`;
        const body = slot.run?.captures.kiosk
          ? captureHtml(ctx.data.url(slot.run.captures.kiosk), slot.run, day)
          : `<p class="sn-capture-none">${escapeHtml(S.noCapture)}</p><figcaption>${day}</figcaption>`;
        return `<li class="sn-quartet-item" data-day="${slot.key}" data-weekday="${WEEKDAYS[new Date((slot.atSec + ZAGREB_OFFSET_S) * 1000).getUTCDay()]}"><figure class="sn-capture">${body}</figure>${replayedLine(slot)}</li>`;
      })
      .join('');
  };
  // The mornings' sentences are five day files: they load when the section comes near the view (at once without an observer).
  let mornings: IntersectionObserver | null = null;
  const loadMornings = (): void => {
    mornings?.disconnect();
    mornings = null;
    void voice.loadIndex().then(() => {
      if (destroyed) return;
      const days = new Set(slots.map((slot) => voice.dayAt(slot.atSec)?.day).filter((d): d is string => Boolean(d)));
      if (!days.size) { renderQuartet(); return; }
      for (const day of days) void voice.load(day);
    });
  };
  const watchMornings = (): void => {
    const IO = (globalThis as { IntersectionObserver?: typeof IntersectionObserver }).IntersectionObserver;
    if (!IO) { loadMornings(); return; }
    mornings = new IO((entries) => { if (entries.some((e) => e.isIntersecting)) loadMornings(); }, { rootMargin: '600px 0px' });
    mornings.observe(list);
  };
  let quartetKey = '';
  const offVoice = voice.onLoad(() => {
    if (destroyed) return;
    if (slots.length) {
      const key = slots.map((slot) => { const d = voice.dayAt(slot.atSec); return d ? String(voice.file(d.day) === undefined ? 'u' : voice.file(d.day) ? 'f' : 'n') : '-'; }).join('');
      if (key !== quartetKey) { quartetKey = key; renderQuartet(); }
    }
    if (shownSource === 'replayed') update(ctx.clock.now());
  });

  Promise.all([
    ctx.data.get(ctx.manifest.files.screenIndex, decodeIndex),
    (() => { const ref = ctx.manifest.files.boards.find((b) => b.stop === VOICE_PLACE); return ref ? ctx.data.get(ref, decodeBoard).catch(() => null) : Promise.resolve(null); })(),
  ]).then(
    ([ix, b]) => {
      if (destroyed) return;
      index = ix;
      board = b;
      onIndex(ix);
      slots = quartet(ix, ctx.manifest.window.fromSec, ctx.manifest.window.toSec);
      renderQuartet();
      watchMornings();
      update(ctx.clock.now());
    },
    () => {
      if (destroyed) return;
      onIndex(null);
      setMini('error', 'error', `<p class="state" data-kind="down">${escapeHtml(SN.error.load)}</p>`);
      list.innerHTML = '';
    },
  );

  const off = ctx.frames.subscribe(update);
  return () => {
    destroyed = true;
    mornings?.disconnect();
    offVoice();
    off();
  };
}
