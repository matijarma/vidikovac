// Zaslon (plan v3, decision V3-22): a purpose-built miniature of the public
// screen on Trg bana Jelačića (its own sheet, never kiosk.css, so the replay
// never depends on the screen's styles) that always draws the record: the
// latest recorded reading at or before the clock from the observed run whose
// span covers it, or between runs the next timetable departures of the
// recorded board with a note saying so. Under it two lines: what the screen
// showed ("Na zaslonu je pisalo:", or that the minute was not recorded) and
// the sentence today's rules give for the minute ("Po današnjim pravilima
// pisalo bi:", computed afterwards and labelled so). A photograph of the real
// screen shows only while the clock is inside the shown run (±1 min), as a
// small thumbnail that opens the full picture. Then "Pet jutara u 07:45": a
// five-row table (the day, the moving fleet against the normal day, the
// recorded sentence of the slot run's 07:45 reading, today's sentence).
// Everything re-renders only when what it shows changes, never on a frame
// that changes nothing.
import { isBoardSeries, isScreenIndex, isScreenRun, VOICE_PLACE, ZAGREB_OFFSET_S, type BoardSeries, type ScreenIndex, type ScreenReading, type ScreenRow, type ScreenRun, type SeriesFile } from '../../../shared/snimka';
import { SnimkaError } from '../../../shared/snimka-codec';
import { escapeHtml } from '../ui/dom/escape';
import { comparisonFor, comparisonMinute, type SnimkaContext } from './context';
import { num, zagrebClock, zagrebDay } from './format';
import { SN, fill } from './strings';
import { voiceData, voiceSentence } from './voice-data';

export type IndexRun = ScreenIndex['runs'][number];

/** The photograph shows only while the clock is this close to the shown run's span. */
export const CAPTURE_WITHIN_S = 60;
/** A board sample older than this (two missed samples) is no longer "the next departures". */
export const BOARD_MAX_AGE_S = 15 * 60;
/** A slot run counts for a morning when it starts this close to 07:45. */
export const MORNING_WITHIN_S = 20 * 60;
/** 07:45 in seconds after the Zagreb midnight: the observer's daily slot. */
export const MORNING_S = 7 * 3600 + 45 * 60;
const DAY_S = 86_400;

/** The Zagreb midnight at or before an instant (seconds). */
const midnightOf = (sec: number): number => Math.floor((sec + ZAGREB_OFFSET_S) / DAY_S) * DAY_S - ZAGREB_OFFSET_S;

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

/** The run whose photograph shows beside the miniature: the shown run, when it has one and the clock is within a
 *  minute of its span; otherwise none (a picture of another hour would repeat the wrong moment). */
export function captureInRun(index: ScreenIndex, tSec: number, within = CAPTURE_WITHIN_S): IndexRun | null {
  const run = runShownAt(index, tSec);
  if (!run || !run.captures.kiosk) return null;
  return tSec >= run.fromSec - within && tSec <= run.toSec + within ? run : null;
}

export type MorningKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri';
const MORNING_DAY: Partial<Record<number, MorningKey>> = { 1: 'mon', 2: 'tue', 3: 'wed', 4: 'thu', 5: 'fri' };

export interface MorningSlot { key: MorningKey; atSec: number; run: IndexRun | null }

/** The mornings at 07:45 inside the window (Monday to Friday), each with the slot run nearest it within twenty minutes. */
export function mornings(index: ScreenIndex, fromSec: number, toSec: number): MorningSlot[] {
  const out: MorningSlot[] = [];
  for (let day = midnightOf(fromSec); day < toSec; day += DAY_S) {
    const atSec = day + MORNING_S;
    if (atSec < fromSec || atSec >= toSec) continue;
    const key = MORNING_DAY[new Date((day + ZAGREB_OFFSET_S) * 1000).getUTCDay()];
    if (!key) continue;
    let run: IndexRun | null = null;
    for (const r of index.runs) {
      if (r.kind !== 'slot' || Math.abs(r.fromSec - atSec) > MORNING_WITHIN_S) continue;
      if (!run || Math.abs(r.fromSec - atSec) < Math.abs(run.fromSec - atSec)) run = r;
    }
    out.push({ key, atSec, run });
  }
  return out;
}

/** The sentence a slot run recorded for its morning: the reading at or before 07:45, else its first (the observer's
 *  slots started a few seconds into the minute). */
export function morningSentence(run: Pick<ScreenRun, 'readings'>, atSec: number): string | null {
  const reading = run.readings[Math.max(0, readingIndexAt(run, atSec))];
  return reading ? reading.sentence : null;
}

/** "2 (321)": the fleet moving at the instant and, in brackets, the weekday-matched normal day at the same time of
 *  day; "bez podatka" for either one that is missing, never 0. */
export function movingText(ctx: Pick<SnimkaContext, 'series' | 'comparisons'>, atSec: number): string {
  const nv = (v: number | null | undefined): string => (typeof v === 'number' ? num(v) : SN.strip.noValue);
  const s: SeriesFile = ctx.series;
  const m = Math.floor((atSec - s.t0) / 60);
  const seen = m >= 0 && m < s.n ? s.seen.all[m] : null;
  let normal: number | null = null;
  if (ctx.comparisons.length) {
    const cm = comparisonMinute(ctx, atSec);
    normal = cm === null ? null : comparisonFor(ctx, atSec).series.seen.all[cm] ?? null;
  }
  return `${nv(seen)} (${nv(normal)})`;
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
export function screenSourceAt(index: ScreenIndex | null, tSec: number): ScreenSource {
  return index && runShownAt(index, tSec) ? 'observed' : 'replayed';
}
export type ScreenSource = 'observed' | 'replayed';

const captureAlt = (run: IndexRun): string => fill(SN.screen.captureCaption, { day: zagrebDay(run.fromSec * 1000), time: zagrebClock(run.fromSec * 1000) });

/** The photograph of the real screen as a small thumbnail: a link to the full picture (a new tab), its text naming
 *  the day and the time. Eager at low priority: a lazy picture below the fold was never fetched on 1 October. */
export function captureHtml(url: string, run: IndexRun): string {
  return `<a class="sn-screen-capture-link" href="${escapeHtml(url)}" target="_blank" rel="noopener">` +
    `<img class="sn-screen-thumb" src="${escapeHtml(url)}" alt="" width="1280" height="720" loading="eager" fetchpriority="low" decoding="async">` +
    `<span class="sn-screen-capture-text"><span class="sn-screen-capture-open">${escapeHtml(SN.screen.captureOpen)}</span>` +
    `<span class="sn-screen-capture-when">${escapeHtml(captureAlt(run))}</span></span>` +
    `<span class="visually-hidden"> ${escapeHtml(SN.news.newTab)}</span></a>`;
}

/** A link to a morning's photograph inside the table (text only: a 300 px picture of a 1280 px screen reads nothing). */
function captureLink(url: string, run: IndexRun): string {
  return ` <a class="sn-screen-photo" href="${escapeHtml(url)}" target="_blank" rel="noopener" title="${escapeHtml(captureAlt(run))}">${escapeHtml(SN.screen.captureOpen)}<span class="visually-hidden">, ${escapeHtml(captureAlt(run))} ${escapeHtml(SN.news.newTab)}</span></a>`;
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

const SKELETON_LINE = '<span class="skeleton sn-screen-line-skeleton"></span>';

/** Zaslon on the page. Resolves the screen index for whoever else needs it (the reckoning's screen card). */
export function mountScreen(ctx: SnimkaContext, root: HTMLElement, onIndex: (index: ScreenIndex | null) => void): () => void {
  const S = SN.screen;
  root.innerHTML =
    '<div class="sn-screen-grid">' +
    `<div class="sn-mini" role="group" aria-label="${escapeHtml(S.miniLabel)}" data-view="loading" aria-busy="true"><span class="skeleton sn-mini-skeleton"></span></div>` +
    '<div class="sn-screen-side">' +
    '<dl class="sn-screen-lines">' +
    `<div class="sn-screen-line" data-line="wrote"><dt>${escapeHtml(S.wrote)}</dt><dd data-sn="screen-wrote" aria-busy="true">${SKELETON_LINE}</dd></div>` +
    `<div class="sn-screen-line" data-line="would"><dt title="${escapeHtml(S.replayedNote)}">${escapeHtml(S.wouldWrite)}<span class="visually-hidden"> ${escapeHtml(S.replayedNote)}</span></dt><dd data-sn="screen-would" aria-busy="true">${SKELETON_LINE}</dd></div>` +
    '</dl>' +
    '<div class="sn-screen-capture" data-sn="screen-capture" hidden></div>' +
    '</div></div>' +
    '<section class="sn-screen-mornings" aria-labelledby="sn-mornings-h">' +
    `<h3 id="sn-mornings-h" class="sn-screen-mornings-title">${escapeHtml(S.morningsTitle)}</h3>` +
    `<p class="sn-screen-mornings-lede">${escapeHtml(S.morningsLede)}</p>` +
    '<table class="sn-screen-table">' +
    `<caption class="visually-hidden">${escapeHtml(S.morningsTitle)}</caption>` +
    `<thead><tr><th scope="col">${escapeHtml(S.colDay)}</th><th scope="col">${escapeHtml(S.colMoving)}</th><th scope="col">${escapeHtml(S.colWrote)}</th><th scope="col">${escapeHtml(S.colWould)}</th></tr></thead>` +
    '<tbody data-sn="mornings"></tbody></table></section>';
  root.removeAttribute('aria-busy');
  const mini = root.querySelector<HTMLElement>('.sn-mini')!;
  const wrote = root.querySelector<HTMLElement>('[data-sn="screen-wrote"]')!;
  const would = root.querySelector<HTMLElement>('[data-sn="screen-would"]')!;
  const capture = root.querySelector<HTMLElement>('[data-sn="screen-capture"]')!;
  const body = root.querySelector<HTMLElement>('[data-sn="mornings"]')!;

  let destroyed = false;
  let index: ScreenIndex | null = null;
  let board: BoardSeries | null = null;
  const runs = new Map<string, ScreenRun>();
  const pending = new Set<string>();
  /** Runs that did not load (after the cache's own retry): shown as between runs, never asked for again. */
  const failed = new Set<string>();
  let miniKey = '';
  let captureKey = '';
  const lineKeys = { wrote: '', would: '' };
  const voice = voiceData(ctx);

  const setMini = (key: string, view: string, html: string): void => {
    if (key === miniKey) return;
    miniKey = key;
    mini.dataset.view = view;
    mini.innerHTML = html;
    if (view === 'loading') mini.setAttribute('aria-busy', 'true');
    else mini.removeAttribute('aria-busy');
  };
  /** One of the two lines: its text, the skeleton while on its way (null), the muted look when it says "none". */
  const setLine = (which: 'wrote' | 'would', text: string | null, none: boolean): void => {
    const key = text === null ? '\u0000loading' : `${none ? '-' : '+'}${text}`;
    if (lineKeys[which] === key) return;
    lineKeys[which] = key;
    const el = which === 'wrote' ? wrote : would;
    if (text === null) { el.innerHTML = SKELETON_LINE; el.setAttribute('aria-busy', 'true'); return; }
    el.textContent = text;
    el.removeAttribute('aria-busy');
    if (none) el.dataset.state = 'none';
    else delete el.dataset.state;
  };

  const load = (run: IndexRun): void => {
    if (runs.has(run.id) || pending.has(run.id) || failed.has(run.id)) return;
    pending.add(run.id);
    ctx.data.get(run.file, decodeRun).then(
      (value) => { pending.delete(run.id); runs.set(run.id, value); if (!destroyed) { update(ctx.clock.now()); renderMornings(); } },
      () => { pending.delete(run.id); failed.add(run.id); if (!destroyed) { update(ctx.clock.now()); renderMornings(); } },
    );
  };

  const showRecord = (tSec: number): void => {
    const shown = runShownAt(index!, tSec);
    const run = shown && !failed.has(shown.id) ? shown : null;
    if (run) {
      const loaded = runs.get(run.id);
      if (!loaded) {
        load(run);
        setMini(`loading:${run.id}`, 'loading', '<span class="skeleton sn-mini-skeleton"></span>');
        setLine('wrote', null, false);
        return;
      }
      // Before the first reading (a run starting within RUN_LEAD_S) the first one shows, with its own time.
      const i = Math.max(0, readingIndexAt(loaded, tSec));
      const reading = loaded.readings[i];
      if (reading) {
        setMini(`run:${run.id}:${i}`, 'reading', readingHtml(loaded, reading));
        setLine('wrote', reading.sentence, false);
        return;
      }
    }
    const view = board ? boardAt(board, tSec) : null;
    if (view) setMini(`board:${view.at}:${view.next.map((d) => d[2]).join(',')}`, 'board', boardHtml(board!.name, view));
    else setMini('none', 'none', head(S.place, tSec, S.boardNote, null) + nearby([], S.boardNone));
    setLine('wrote', S.notRecorded, true);
  };

  const showWould = (tSec: number): void => {
    const at = voice.minuteAt(tSec);
    if (at === 'loading') { setLine('would', null, false); return; }
    const sentence = at ? voiceSentence(at.file, at.minute) : null;
    setLine('would', sentence ?? S.noReplayed, sentence === null);
  };

  const showCapture = (tSec: number): void => {
    const run = captureInRun(index!, tSec);
    const key = run ? run.id : 'none';
    if (key === captureKey) return;
    captureKey = key;
    capture.hidden = !run;
    capture.innerHTML = run && run.captures.kiosk ? captureHtml(ctx.data.url(run.captures.kiosk), run) : '';
  };

  const update = (tMs: number): void => {
    if (!index) return;
    const tSec = Math.floor(tMs / 1000);
    showRecord(tSec);
    showWould(tSec);
    showCapture(tSec);
    const next = nextRunAfter(index, tSec);
    if (next) load(next);
  };

  // ---- five mornings: the day, the fleet against the normal day, the record and today's sentence ----
  let slots: MorningSlot[] = [];
  let morningsWanted = false;
  let morningsKey = '';
  /** The voice index could not be had: every morning says it has no computed sentence. */
  let voiceFailed = false;
  const wroteCell = (slot: MorningSlot): string => {
    const run = slot.run;
    if (!run || failed.has(run.id)) return `<span class="sn-screen-none">${escapeHtml(S.notRecorded)}</span>`;
    const loaded = runs.get(run.id);
    if (!loaded) return SKELETON_LINE;
    const sentence = morningSentence(loaded, slot.atSec);
    const photo = run.captures.kiosk ? captureLink(ctx.data.url(run.captures.kiosk), run) : '';
    return (sentence ? escapeHtml(sentence) : `<span class="sn-screen-none">${escapeHtml(S.notRecorded)}</span>`) + photo;
  };
  const wouldCell = (slot: MorningSlot): string => {
    if (voice.index() === null && !voiceFailed) return SKELETON_LINE;
    const day = voice.dayAt(slot.atSec);
    const file = day ? voice.file(day.day) : null;
    if (file === undefined) return SKELETON_LINE;
    const minute = file ? file.minutes[Math.floor((slot.atSec - file.t0) / file.step)] ?? null : null;
    const sentence = file && minute ? voiceSentence(file, minute) : null;
    return sentence ? escapeHtml(sentence) : `<span class="sn-screen-none">${escapeHtml(S.noReplayed)}</span>`;
  };
  const renderMornings = (): void => {
    if (!slots.length) return;
    const html = slots.map((slot) =>
      `<tr data-day="${slot.key}">` +
      `<th scope="row"><span class="sn-screen-day">${escapeHtml(zagrebDay(slot.atSec * 1000))}</span><span class="sn-screen-caption">${escapeHtml(S.mornings[slot.key])}</span></th>` +
      `<td class="sn-screen-moving" data-label="${escapeHtml(S.colMoving)}">${escapeHtml(movingText(ctx, slot.atSec))}</td>` +
      `<td data-label="${escapeHtml(S.colWrote)}" data-sn="morning-wrote">${wroteCell(slot)}</td>` +
      `<td data-label="${escapeHtml(S.colWould)}" data-sn="morning-would">${wouldCell(slot)}</td></tr>`).join('');
    if (html === morningsKey) return;
    morningsKey = html;
    body.innerHTML = html;
  };
  // The mornings' sentences are up to five run files and five day files: they load when the table comes near the
  // view (at once without an observer).
  let observer: IntersectionObserver | null = null;
  const loadMornings = (): void => {
    observer?.disconnect();
    observer = null;
    if (morningsWanted) return;
    morningsWanted = true;
    for (const slot of slots) if (slot.run) load(slot.run);
    void voice.loadIndex().then((ix) => {
      if (destroyed) return;
      voiceFailed = ix === null;
      const days = new Set(slots.map((slot) => voice.dayAt(slot.atSec)?.day).filter((d): d is string => Boolean(d)));
      for (const day of days) void voice.load(day);
      renderMornings();
    });
  };
  const watchMornings = (): void => {
    const IO = (globalThis as { IntersectionObserver?: typeof IntersectionObserver }).IntersectionObserver;
    if (!IO) { loadMornings(); return; }
    observer = new IO((entries) => { if (entries.some((e) => e.isIntersecting)) loadMornings(); }, { rootMargin: '600px 0px' });
    observer.observe(body);
  };
  const offVoice = voice.onLoad(() => {
    if (destroyed) return;
    renderMornings();
    update(ctx.clock.now());
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
      slots = mornings(ix, ctx.manifest.window.fromSec, ctx.manifest.window.toSec);
      renderMornings();
      watchMornings();
      update(ctx.clock.now());
    },
    () => {
      if (destroyed) return;
      onIndex(null);
      setMini('error', 'error', `<p class="state" data-kind="down">${escapeHtml(SN.error.load)}</p>`);
      setLine('wrote', S.notRecorded, true);
      setLine('would', S.noReplayed, true);
      body.innerHTML = '';
    },
  );

  const off = ctx.frames.subscribe(update);
  return () => {
    destroyed = true;
    observer?.disconnect();
    offVoice();
    off();
  };
}
