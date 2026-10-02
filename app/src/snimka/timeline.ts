// The timeline bar (plan section 3.1): play and pause, the previous and the
// next chapter, the speed (a segmented control, a native select on a phone),
// the native range scrubber with aria-valuetext, and under it one compressed
// lane of the fleet with the timetable's silhouette, the state band and
// three tick lanes (chapters, ZET's notices and the court, the press: 1 px
// ticks with a title, aria-hidden; the feed and the Poglavlja panel are
// their accessible form), the day labels and the presentation button.
// Scrubbing pauses and seeks. The keyboard map of v1 (Space, J and L, comma
// and full stop, 1 to 4) is bindKeys, bound by the stage on its root.
import { SPEEDS, type SeriesFile, type Speed } from '../../../shared/snimka';
import type { TickReason } from './clock';
import type { SnimkaContext } from './context';
import type { SeriesLike, TimelineMarker } from './contracts';
import { formatZagrebLocal, zagrebClock, zagrebDay, zagrebMidnight } from './format';
import { el } from './panels';
import { SN, fill } from './strings';
import { areaPath, linePath, PLOT_H, runsOf, stateClass, type Run, type StateClass } from './strip';
import * as voices from './voices';

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
const SVG_NS = 'http://www.w3.org/2000/svg';
/** The fleet lane is drawn from every fifth minute: 1,344 points carry the shape of 6,720 at a lane 2 rem tall. */
export const LANE_STEP_MIN = 5;

export const LANES = ['chapter', 'notice', 'press'] as const;
export type Lane = (typeof LANES)[number];
const LANE_LABEL: Record<Lane, string> = { chapter: SN.timeline.chapters, notice: SN.timeline.notices, press: SN.timeline.press };

/** The marks of the three lanes from the dataset: chapters, ZET's notices with the court's events, the press; in time order. */
export function timelineMarkers(ctx: Pick<SnimkaContext, 'events' | 'notices' | 'news'>): TimelineMarker[] {
  const out: TimelineMarker[] = [];
  for (const e of ctx.events) {
    if (e.chapter) out.push({ atSec: e.atSec, lane: 'chapter', id: e.id, title: e.title });
    else if (e.kind === 'court') out.push({ atSec: e.atSec, lane: 'notice', id: e.id, title: e.title });
  }
  for (const n of ctx.notices.items) out.push({ atSec: n.pubSec, lane: 'notice', id: `zet-${n.id}`, title: n.title });
  for (const a of ctx.news.items) out.push({ atSec: a.pubSec, lane: 'press', id: a.id, title: a.title });
  return out.sort((a, b) => a.atSec - b.atSec || a.id.localeCompare(b.id));
}

/** V4's markers (voices.ts feedMarkers) when they land and answer, else the shell's own. */
export function markersFor(ctx: SnimkaContext): TimelineMarker[] {
  const own = (voices as Record<string, unknown>).feedMarkers;
  if (typeof own === 'function') {
    try {
      const got: unknown = (own as (c: SnimkaContext) => unknown)(ctx);
      if (Array.isArray(got) && got.every((m) => m && typeof m === 'object' && typeof (m as TimelineMarker).atSec === 'number' && LANES.includes((m as TimelineMarker).lane))) return got as TimelineMarker[];
    } catch { /* V4's function wants other arguments: the shell's markers stand */ }
  }
  return timelineMarkers(ctx);
}

/** The state band's runs: V4's stateBand when it answers in runs, else runsOf/stateClass over the series. */
export function bandRuns(series: SeriesLike): Run<StateClass>[] {
  const own = (voices as Record<string, unknown>).stateBand;
  if (typeof own === 'function') {
    try {
      const got: unknown = (own as (s: SeriesLike) => unknown)(series);
      if (Array.isArray(got) && got.every((r) => r && typeof r === 'object' && typeof (r as Run<string>).from === 'number' && typeof (r as Run<string>).to === 'number' && typeof (r as Run<string>).cls === 'string')) return got as Run<StateClass>[];
    } catch { /* fall back */ }
  }
  return runsOf<StateClass>(series.n, (m) => stateClass(series as SeriesFile, m));
}

/** Every fifth minute of a column, keeping a null where the five minutes hold none (a gap stays a gap). */
export function thin(col: readonly (number | null)[], step = LANE_STEP_MIN): (number | null)[] {
  const out: (number | null)[] = [];
  for (let i = 0; i < col.length; i += step) {
    let best: number | null = null;
    for (let k = i; k < Math.min(col.length, i + step); k++) { const v = col[k]; if (v !== null && v !== undefined && (best === null || v > best)) best = v; }
    out.push(best);
  }
  return out;
}

/** The day labels under the lanes: every Zagreb midnight inside, as fractions, and the window's first day at 0 when it has six hours or more (Sunday's four would collide with Monday). */
export function dayMarks(startMs: number, endMs: number): { x: number; label: string }[] {
  const span = endMs - startMs;
  const firstMidnight = zagrebMidnight(startMs) + DAY_MS;
  const out = firstMidnight - startMs >= 6 * 3_600_000 ? [{ x: 0, label: zagrebDay(startMs) }] : [];
  for (let d = zagrebMidnight(startMs) + DAY_MS; d < endMs; d += DAY_MS) out.push({ x: (d - startMs) / span, label: zagrebDay(d) });
  return out;
}

const SPEED_KEYS: Record<string, Speed> = { Digit1: 1, Digit2: 60, Digit3: 600, Digit4: 3600, Numpad1: 1, Numpad2: 60, Numpad3: 600, Numpad4: 3600 };

/** The keyboard map (v1 brief section 8) on a root: Space plays, J and L walk the chapters, comma and full stop step a minute (ten with Shift), 1 to 4 pick the speed. */
export function bindKeys(ctx: Pick<SnimkaContext, 'clock'>, root: HTMLElement): () => void {
  const { clock } = ctx;
  const onKey = (event: KeyboardEvent): void => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.defaultPrevented) return;
    const target = event.target as HTMLElement | null;
    const tag = target?.tagName ?? '';
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || target?.isContentEditable) return;
    switch (event.code) {
      case 'Space':
        if (tag === 'BUTTON' || tag === 'A' || tag === 'SUMMARY') return;
        if (!clock.playing() && clock.now() >= clock.end) clock.seek(clock.start);
        clock.toggle();
        break;
      case 'KeyJ': clock.prevChapter(); break;
      case 'KeyL': clock.nextChapter(); break;
      case 'Comma': clock.step(-(event.shiftKey ? 10 : 1) * MINUTE_MS); break;
      case 'Period': clock.step((event.shiftKey ? 10 : 1) * MINUTE_MS); break;
      default: {
        const speed = SPEED_KEYS[event.code];
        if (speed === undefined || event.shiftKey) return;
        clock.setSpeed(speed);
      }
    }
    event.preventDefault();
  };
  root.addEventListener('keydown', onKey);
  return () => root.removeEventListener('keydown', onKey);
}

export interface TimelineHandle {
  /** The presentation button, for presentation.ts. */
  readonly present: HTMLButtonElement;
  /** The controls' box (the idle hide never hides it while focus is inside). */
  readonly root: HTMLElement;
  update(t: number): void;
  destroy(): void;
}

/** Builds the bar into `root`; the frame loop moves its cursor and its scrubber through update(t). */
export function mountTimeline(ctx: SnimkaContext, root: HTMLElement, markers: readonly TimelineMarker[] = markersFor(ctx)): TimelineHandle {
  const { clock, doc, series } = ctx;
  const start = clock.start;
  const end = clock.end;
  const minutes = Math.round((end - start) / MINUTE_MS);
  let scrubbing = false;

  // ---- the controls ----
  const play = el(doc, 'button', { type: 'button', class: 'btn sn-tl-play', 'data-sn': 'play' });
  play.addEventListener('click', () => {
    if (!clock.playing() && clock.now() >= end) clock.seek(start);
    clock.toggle();
  });
  const chapterButton = (dir: 'prev' | 'next', glyph: string): HTMLButtonElement => {
    const label = dir === 'prev' ? SN.controls.prev : SN.controls.next;
    const b = el(doc, 'button', { type: 'button', class: 'btn-ghost sn-tl-chapter', 'data-sn': dir, 'aria-label': label, title: label }, el(doc, 'span', { 'aria-hidden': 'true', text: glyph }));
    b.addEventListener('click', () => { if (dir === 'prev') clock.prevChapter(); else clock.nextChapter(); });
    return b;
  };
  const speedButtons = new Map<Speed, HTMLButtonElement>();
  const speedGroup = el(doc, 'div', { class: 'sn-tl-speed', role: 'group', 'aria-label': SN.controls.speed });
  for (const speed of SPEEDS) {
    const b = el(doc, 'button', { type: 'button', class: 'sn-tl-seg', 'data-speed': String(speed), 'aria-pressed': 'false' },
      el(doc, 'span', { text: SN.speed[speed] }), el(doc, 'span', { class: 'visually-hidden', text: `, ${SN.speedAria[speed]}` }));
    b.addEventListener('click', () => clock.setSpeed(speed));
    speedButtons.set(speed, b);
    speedGroup.append(b);
  }
  const select = el(doc, 'select', { class: 'sn-tl-select', 'aria-label': SN.controls.speed, 'data-sn': 'speed-select' });
  for (const speed of SPEEDS) select.append(el(doc, 'option', { value: String(speed), text: SN.speed[speed] }));
  select.addEventListener('change', () => {
    const next = SPEEDS.find((s) => String(s) === select.value);
    if (next) clock.setSpeed(next);
  });
  // The glyph stands alone on a phone; the words stay the button's name (presentation.ts swaps them).
  const present = el(doc, 'button', { type: 'button', class: 'btn-ghost sn-tl-present', 'data-sn': 'present', 'aria-pressed': 'false' },
    el(doc, 'span', { class: 'sn-tl-present-glyph', 'aria-hidden': 'true', text: '⛶' }), el(doc, 'span', { class: 'sn-tl-present-text', 'data-sn-present-text': '', text: SN.present.enter }));
  const controls = el(doc, 'div', { class: 'sn-tl-controls' },
    play, el(doc, 'div', { class: 'sn-tl-chapters', role: 'group', 'aria-label': SN.controls.chapters }, chapterButton('prev', '«'), chapterButton('next', '»')),
    speedGroup, el(doc, 'div', { class: 'sn-tl-pick' }, select));

  // ---- the scrubber and the lanes ----
  const range = el(doc, 'input', { type: 'range', class: 'sn-tl-range', min: '0', max: String(minutes), step: '1', 'aria-label': SN.stage.scrubber, 'data-sn': 'scrubber' });
  range.addEventListener('input', () => {
    scrubbing = true;
    clock.pause();
    clock.seek(start + Number(range.value) * MINUTE_MS);
  });
  range.addEventListener('change', () => { scrubbing = false; });
  range.addEventListener('blur', () => { scrubbing = false; });

  const pct = (sec: number): string => (((sec * 1000 - start) / (end - start)) * 100).toFixed(3);
  // The compressed fleet: the timetable's silhouette and the fleet's line on one scale.
  const seen = thin(series.seen.all);
  const expected = thin(series.expected.all);
  let max = 0;
  for (const v of [...seen, ...expected]) if (v !== null && v > max) max = v;
  const svg = doc.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'sn-tl-svg');
  svg.setAttribute('viewBox', `-0.5 0 ${seen.length} ${PLOT_H}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.innerHTML = `<path class="sn-tl-expected" d="${areaPath(expected, max)}"/><path class="sn-tl-seen" d="${linePath(seen, max)}"/>`;
  const fleet = el(doc, 'div', { class: 'sn-tl-fleet' });
  fleet.append(svg);
  const band = el(doc, 'div', { class: 'sn-tl-band' });
  for (const r of bandRuns(series)) {
    const seg = el(doc, 'span', { class: `sn-tl-seg-state sn-tl-state-${r.cls}` });
    seg.style.setProperty('--x', (r.from / series.n).toFixed(5));
    seg.style.setProperty('--w', ((r.to - r.from) / series.n).toFixed(5));
    band.append(seg);
  }
  const tickLanes = LANES.map((lane) => {
    const box = el(doc, 'div', { class: 'sn-tl-ticks', 'data-lane': lane, title: LANE_LABEL[lane] });
    for (const m of markers) {
      if (m.lane !== lane || m.atSec * 1000 < start || m.atSec * 1000 > end) continue;
      const tick = el(doc, 'span', { class: 'sn-tl-tick', title: `${zagrebDay(m.atSec * 1000)} ${zagrebClock(m.atSec * 1000)} · ${m.title}` });
      tick.style.setProperty('--x', `${pct(m.atSec)}%`);
      box.append(tick);
    }
    return box;
  });
  const dayLines = el(doc, 'div', { class: 'sn-tl-daylines' });
  const days = el(doc, 'div', { class: 'sn-tl-days' });
  for (const d of dayMarks(start, end)) {
    if (d.x > 0) {
      const line = el(doc, 'span', { class: 'sn-tl-dayline' });
      line.style.setProperty('--x', `${(d.x * 100).toFixed(3)}%`);
      dayLines.append(line);
    }
    const label = el(doc, 'span', { class: 'sn-tl-day', text: d.label, 'data-short': d.label.split(' ')[0] });
    label.style.setProperty('--x', `${(d.x * 100).toFixed(3)}%`);
    days.append(label);
  }
  const cursor = el(doc, 'span', { class: 'sn-tl-cursor' });
  const lanes = el(doc, 'div', { class: 'sn-tl-lanes', 'aria-hidden': 'true' }, fleet, band, ...tickLanes, dayLines, cursor);
  const scrub = el(doc, 'div', { class: 'sn-tl-scrub' }, range, lanes, el(doc, 'div', { class: 'sn-tl-dayrow', 'aria-hidden': 'true' }, days));

  const status = el(doc, 'p', { class: 'sn-tl-status', role: 'status', 'aria-live': 'polite', 'data-sn': 'status' });
  const tail = el(doc, 'div', { class: 'sn-tl-tail' }, present);
  const bar = el(doc, 'div', { class: 'sn-tl', role: 'group', 'aria-label': SN.timeline.label, 'data-sn-timeline': '' }, controls, scrub, tail, status);
  if (ctx.reducedMotion) bar.append(el(doc, 'p', { class: 'st-note sn-tl-reduced', text: SN.stage.reducedNote }));
  root.replaceChildren(bar);

  // ---- rendering ----
  let shownMinute = -1;
  const update = (t: number): void => {
    const minute = Math.max(0, Math.min(minutes, Math.floor((t - start) / MINUTE_MS)));
    if (minute === shownMinute) return;
    shownMinute = minute;
    const atMs = start + minute * MINUTE_MS;
    if (!scrubbing) range.value = String(minute);
    range.setAttribute('aria-valuetext', fill(SN.stage.valueText, { day: zagrebDay(atMs), time: zagrebClock(atMs) }));
    cursor.style.transform = `translateX(${((minute / minutes) * 100).toFixed(3)}%)`;
  };
  const renderControls = (): void => {
    const playing = clock.playing();
    const word = playing ? SN.controls.pause : SN.controls.play;
    if (play.textContent !== word) play.textContent = word;
    play.dataset.playing = playing ? '1' : '0';
    const speed = clock.speed();
    for (const [s, b] of speedButtons) b.setAttribute('aria-pressed', s === speed ? 'true' : 'false');
    if (select.value !== String(speed)) select.value = String(speed);
  };
  const renderStatus = (reason: TickReason | 'init'): void => {
    const t = clock.now();
    const where = { day: zagrebDay(t), time: zagrebClock(t) };
    let text: string;
    if (reason === 'end' || (!clock.playing() && t >= end && reason !== 'seek')) text = fill(SN.stage.end, where);
    else if (clock.playing()) text = fill(SN.stage.playing, { speed: SN.speedAria[clock.speed()] });
    else text = fill(SN.stage.paused, where);
    if (status.textContent !== text) status.textContent = text;
  };
  const offTick = clock.onTick((_, reason) => {
    renderControls();
    if (reason !== 'suspend' && reason !== 'resume') renderStatus(reason);
  });
  renderControls();
  renderStatus('init');
  update(clock.now());
  bar.dataset.at = formatZagrebLocal(clock.now());

  return {
    present,
    root: bar,
    update,
    destroy() {
      offTick();
      bar.remove();
    },
  };
}
