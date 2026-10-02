// The timeline bar (plan section 3.1; v3 decision V3-18): play and pause,
// the previous and the next chapter (the target chapter in the tooltip), the
// speed (a segmented control of equal widths, a native select on a phone),
// the "Poglavlja" popover with the agenda, the fullscreen icon. Under them
// the fleet lane IS the track: the native range lies over the compressed
// fleet (the timetable's silhouette tinted by the service state, the seen
// line on top, a dashed edge where the state was computed afterwards), so a
// drag on the silhouette scrubs. Under the lane a 6 px rug where ZET sent no
// vehicles or its data stood still, then one marker row: the chapters as
// numbered pins (buttons that seek) and what ZET and the court said as dots
// (the feed is their accessible form), then the day labels; on a desktop the
// line "Sljedeće: {time} · {title}" under the bar. A phone keeps play, the
// scrubber over the fleet and the speed select in 64 px. Scrubbing pauses and
// seeks. The keyboard map of v1 (Space, J and L, comma and full stop, 1 to 4)
// is bindKeys, bound by the stage on its root.
import { SPEEDS, type SeriesFile, type Speed } from '../../../shared/snimka';
import { mountAgendaList, chaptersOf, type AgendaList } from './agenda';
import type { TickReason } from './clock';
import type { SnimkaContext } from './context';
import type { SeriesLike, TimelineMarker } from './contracts';
import { formatZagrebLocal, zagrebClock, zagrebDateTime, zagrebDay, zagrebMidnight } from './format';
import { el } from './panels';
import { SN, fill } from './strings';
import { areaPath, linePath, PLOT_H, runsOf, stateClass, type Run, type StateClass } from './strip';
import { buildVoices, feedMarkers, foldPress, stateBand } from './voices';

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
const SVG_NS = 'http://www.w3.org/2000/svg';
/** The fleet lane is drawn from every fifth minute: 1,344 points carry the shape of 6,720 at a lane 2 rem tall. */
export const LANE_STEP_MIN = 5;

/** The marker row from the feed's own list (voices.ts feedMarkers): chapter pins and ZET/court dots, in time order.
 *  v2 called feedMarkers with the context, which threw and fell back to raw ticks (R3); this is the fixed call. */
export function markersFor(ctx: Pick<SnimkaContext, 'events' | 'notices' | 'news'>): TimelineMarker[] {
  return feedMarkers(foldPress(buildVoices(ctx)));
}

/** The state runs in series minutes (voices.ts stateBand answers epoch seconds; turned back into minute indices). */
export function bandRuns(series: SeriesLike): Run<StateClass>[] {
  try {
    const minute = (sec: number): number => Math.round((sec - series.t0) / series.step);
    return stateBand(series).map((r) => ({ from: minute(r.from), to: minute(r.to), cls: r.cls }));
  } catch {
    return runsOf<StateClass>(series.n, (m) => stateClass(series as SeriesFile, m));
  }
}

/** The rug's runs in series minutes: ZET sent no vehicles (entities 0) or its data stood still (frozen). */
export function rugRuns(series: Pick<SeriesFile, 'n' | 'feed'>): Run<'rug'>[] {
  return runsOf<'rug'>(series.n, (m) => (series.feed.frozen[m] === 1 || series.feed.entities[m] === 0 ? 'rug' : null));
}

/** The chapter a press on ← reaches (the clock's prevChapter rule: one just reached is skipped), and on →. */
export function chapterTargets(chapters: readonly { at: number; title: string }[], t: number, backMs = 2000): { prev: string | null; next: string | null } {
  let prev: string | null = null;
  for (const ch of chapters) if (ch.at < t - backMs) prev = ch.title;
  const next = chapters.find((ch) => ch.at > t)?.title ?? null;
  return { prev, next };
}

/** "Sljedeće: 18:42 · Vozila se vraćaju" (the day joins the time when the next chapter is on another day), or null. */
export function nextLine(chapters: readonly { atSec: number; title: string }[], atSec: number): string | null {
  const next = chapters.find((c) => c.atSec > atSec);
  if (!next) return null;
  const sameDay = zagrebDay(next.atSec * 1000) === zagrebDay(atSec * 1000);
  return fill(SN.timeline.next, { time: sameDay ? zagrebClock(next.atSec * 1000) : zagrebDateTime(next.atSec * 1000), title: next.title });
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

export interface TimelineOptions {
  /** Opens a chapter (a pin, the Poglavlja list): the shell pauses, seeks and sets the subject. Default: pause and seek. */
  openChapter?: (chapterId: string) => void;
}

/** Builds the bar into `root`; the frame loop moves its scrubber through update(t). */
export function mountTimeline(ctx: SnimkaContext, root: HTMLElement, markers: readonly TimelineMarker[] = markersFor(ctx), o: TimelineOptions = {}): TimelineHandle {
  const { clock, doc, series } = ctx;
  const start = clock.start;
  const end = clock.end;
  const minutes = Math.round((end - start) / MINUTE_MS);
  const chapters = chaptersOf(ctx.events);
  const openChapter = o.openChapter ?? ((id: string): void => {
    const c = chapters.find((x) => x.id === id);
    if (!c) return;
    clock.pause();
    clock.seek(c.atSec * 1000);
  });
  let scrubbing = false;
  const teardowns: (() => void)[] = [];

  // ---- the controls ----
  const playWord = el(doc, 'span', { class: 'sn-tl-play-word' });
  const play = el(doc, 'button', { type: 'button', class: 'btn sn-tl-play', 'data-sn': 'play' }, playWord);
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
  const prev = chapterButton('prev', '←');
  const next = chapterButton('next', '→');
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
    const nextSpeed = SPEEDS.find((s) => String(s) === select.value);
    if (nextSpeed) clock.setSpeed(nextSpeed);
  });
  // Fullscreen is an icon; its name is the aria-label (presentation.ts swaps it).
  const present = el(doc, 'button', { type: 'button', class: 'btn-ghost sn-tl-present', 'data-sn': 'present', 'aria-pressed': 'false', 'aria-label': SN.present.enter, title: SN.present.enter },
    el(doc, 'span', { class: 'sn-tl-present-glyph', 'aria-hidden': 'true', text: '⛶' }));

  // ---- the Poglavlja popover ----
  const popId = `sn-tl-pop-${Math.floor(start / 1000)}`;
  const agendaButton = el(doc, 'button', { type: 'button', class: 'btn-ghost sn-tl-agenda', 'data-sn': 'agenda', 'aria-expanded': 'false', 'aria-controls': popId, text: SN.timeline.chapters });
  const keysId = `${popId}-keys`;
  const pop = el(doc, 'div', { class: 'sn-tl-pop', id: popId, role: 'dialog', 'aria-label': SN.agenda.title, 'data-sn': 'agenda-pop', hidden: true },
    el(doc, 'p', { class: 'sn-tl-pop-lede', text: SN.agenda.lede }), el(doc, 'p', { class: 'sn-tl-pop-keys', id: keysId, text: SN.agenda.keys }));
  let agenda: AgendaList | null = null;
  const closePop = (focusButton: boolean): void => {
    if (pop.hidden) return;
    pop.hidden = true;
    agendaButton.setAttribute('aria-expanded', 'false');
    agenda?.destroy();
    agenda = null;
    if (focusButton) agendaButton.focus();
  };
  const openPop = (): void => {
    pop.hidden = false;
    agendaButton.setAttribute('aria-expanded', 'true');
    agenda = mountAgendaList(ctx, pop, (id) => { closePop(true); openChapter(id); }, { describedBy: keysId });
    agenda.focusCurrent();
  };
  agendaButton.addEventListener('click', () => { if (pop.hidden) openPop(); else closePop(false); });
  pop.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePop(true); } });
  const onDocPointer = (e: Event): void => {
    const target = e.target as Node | null;
    if (!pop.hidden && target && !pop.contains(target) && !agendaButton.contains(target)) closePop(false);
  };
  doc.addEventListener('pointerdown', onDocPointer);
  teardowns.push(() => { doc.removeEventListener('pointerdown', onDocPointer); agenda?.destroy(); });

  const controls = el(doc, 'div', { class: 'sn-tl-controls' },
    play, el(doc, 'div', { class: 'sn-tl-chapters', role: 'group', 'aria-label': SN.controls.chapters }, prev, next),
    speedGroup, el(doc, 'div', { class: 'sn-tl-pick' }, select), el(doc, 'div', { class: 'sn-tl-tools' }, agendaButton, present));

  // ---- the track: the fleet lane with the range over it ----
  const range = el(doc, 'input', { type: 'range', class: 'sn-tl-range', min: '0', max: String(minutes), step: '1', 'aria-label': SN.stage.scrubber, 'data-sn': 'scrubber' });
  range.addEventListener('input', () => {
    scrubbing = true;
    clock.pause();
    clock.seek(start + Number(range.value) * MINUTE_MS);
  });
  range.addEventListener('change', () => { scrubbing = false; });
  range.addEventListener('blur', () => { scrubbing = false; });

  const frac = (sec: number): number => (sec * 1000 - start) / (end - start);
  const pct = (sec: number): string => (frac(sec) * 100).toFixed(3);
  const seen = thin(series.seen.all);
  const expected = thin(series.expected.all);
  let max = 0;
  for (const v of [...seen, ...expected]) if (v !== null && v > max) max = v;
  const lanes = seen.length;
  const x = (minute: number): number => minute / LANE_STEP_MIN - 0.5;
  const clipId = `sn-tl-clip-${Math.floor(start / 1000)}`;
  const tint = bandRuns(series)
    .filter((r) => r.cls !== 'none')
    .map((r) => `<rect class="sn-tl-tint sn-tl-tint-${r.cls}" x="${x(r.from).toFixed(2)}" y="0" width="${((r.to - r.from) / LANE_STEP_MIN).toFixed(2)}" height="${PLOT_H}"/>`).join('');
  const area = areaPath(expected, max);
  // Before the app published its own state (Tue 23:18), the state was computed afterwards: the silhouette's edge is dashed.
  const liveMin = Math.max(0, Math.min(series.n, Math.round((ctx.manifest.serviceLiveFromSec - series.t0) / 60)));
  const liveX = x(liveMin);
  const svg = doc.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'sn-tl-svg');
  svg.setAttribute('viewBox', `-0.5 0 ${lanes} ${PLOT_H}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.dataset.sn = 'fleet-lane';
  svg.innerHTML = `<defs><clipPath id="${clipId}"><path d="${area}"/></clipPath><clipPath id="${clipId}-retro"><rect x="-0.5" y="0" width="${(liveX + 0.5).toFixed(2)}" height="${PLOT_H}"/></clipPath></defs>`
    + `<path class="sn-tl-expected" d="${area}"/><g clip-path="url(#${clipId})">${tint}</g>`
    + `<path class="sn-tl-retro-edge" clip-path="url(#${clipId}-retro)" d="${linePath(expected, max)}"/>`
    + `<line class="sn-tl-live-edge" x1="${liveX.toFixed(2)}" x2="${liveX.toFixed(2)}" y1="0" y2="${PLOT_H}"/>`
    + `<path class="sn-tl-seen" d="${linePath(seen, max)}"/>`;
  const dayLines = el(doc, 'div', { class: 'sn-tl-daylines', 'aria-hidden': 'true' });
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
  const retro = el(doc, 'span', { class: 'sn-tl-retro', 'aria-hidden': 'true', text: SN.timeline.retro, title: SN.timeline.retro });
  retro.style.setProperty('--w', `${((liveMin / series.n) * 100).toFixed(3)}%`);
  const lane = el(doc, 'div', { class: 'sn-tl-lane' }, svg, dayLines, retro);
  const track = el(doc, 'div', { class: 'sn-tl-track', 'data-sn': 'track' }, lane, range);

  // The rug: where ZET sent nothing or its data stood still.
  const rug = el(doc, 'div', { class: 'sn-tl-rug', 'aria-hidden': 'true', title: SN.timeline.rug, 'data-sn': 'rug' });
  for (const r of rugRuns(series)) {
    const seg = el(doc, 'span', { class: 'sn-tl-rug-run' });
    seg.style.setProperty('--x', ((r.from / series.n) * 100).toFixed(3) + '%');
    seg.style.setProperty('--w', (((r.to - r.from) / series.n) * 100).toFixed(3) + '%');
    rug.append(seg);
  }

  // One marker row: numbered chapter pins (buttons) and ZET/court dots (pointer shortcuts; the feed is their keyboard form).
  const marks = el(doc, 'div', { class: 'sn-tl-marks', role: 'group', 'aria-label': SN.timeline.chapters, 'data-sn': 'marks' });
  const chapterIds = new Map(chapters.map((c, i) => [`event:${c.id}`, i]));
  const seekSec = (sec: number): void => { clock.pause(); clock.seek(sec * 1000); };
  for (const m of markers) {
    if (m.atSec * 1000 < start || m.atSec * 1000 > end) continue;
    const when = `${zagrebDay(m.atSec * 1000)} ${zagrebClock(m.atSec * 1000)}`;
    if (m.lane === 'chapter') {
      const k = chapterIds.get(m.id);
      const pin = el(doc, 'button', { type: 'button', class: 'sn-tl-pin', 'data-sn': 'pin', 'data-id': m.id, 'aria-label': fill(SN.timeline.goTo, { title: m.title }), title: `${when} · ${m.title}`, text: String((k ?? 0) + 1) });
      pin.style.setProperty('--x', `${pct(m.atSec)}%`);
      pin.addEventListener('click', () => { const c = chapters[k ?? -1]; if (c) openChapter(c.id); else seekSec(m.atSec); });
      marks.append(pin);
    } else if (m.lane === 'notice') {
      const dot = el(doc, 'span', { class: 'sn-tl-dot', 'aria-hidden': 'true', 'data-id': m.id, 'data-tone': m.id.startsWith('event:') && ctx.events.find((e) => `event:${e.id}` === m.id)?.kind === 'court' ? 'court' : 'zet', title: `${when} · ${m.title}` });
      dot.style.setProperty('--x', `${pct(m.atSec)}%`);
      dot.addEventListener('click', () => seekSec(m.atSec));
      marks.append(dot);
    }
  }
  const scrub = el(doc, 'div', { class: 'sn-tl-scrub' }, track, rug, marks, el(doc, 'div', { class: 'sn-tl-dayrow', 'aria-hidden': 'true' }, days));

  const nextText = el(doc, 'p', { class: 'sn-tl-next', 'data-sn': 'next' });
  const status = el(doc, 'p', { class: 'sn-tl-status', role: 'status', 'aria-live': 'polite', 'data-sn': 'status' });
  const bar = el(doc, 'div', { class: 'sn-tl', role: 'group', 'aria-label': SN.timeline.label, 'data-sn-timeline': '' }, controls, scrub, nextText, status, pop);
  if (ctx.reducedMotion) bar.append(el(doc, 'p', { class: 'st-note sn-tl-reduced', text: SN.stage.reducedNote }));
  root.replaceChildren(bar);

  // ---- rendering ----
  let shownMinute = -1;
  let shownNext: string | null = '\u0000';
  let shownTargets = '';
  const clockChapters = (): readonly { at: number; title: string }[] => clock.chapters();
  const renderTargets = (t: number): void => {
    const { prev: p, next: n } = chapterTargets(clockChapters(), t);
    const key = `${p}\u0000${n}`;
    if (key === shownTargets) return;
    shownTargets = key;
    prev.title = p ? fill(SN.timeline.goTo, { title: p }) : SN.controls.prev;
    next.title = n ? fill(SN.timeline.goTo, { title: n }) : SN.controls.next;
  };
  const update = (t: number): void => {
    const minute = Math.max(0, Math.min(minutes, Math.floor((t - start) / MINUTE_MS)));
    if (minute === shownMinute) return;
    shownMinute = minute;
    const atMs = start + minute * MINUTE_MS;
    if (!scrubbing) range.value = String(minute);
    range.setAttribute('aria-valuetext', fill(SN.stage.valueText, { day: zagrebDay(atMs), time: zagrebClock(atMs) }));
    track.style.setProperty('--sn-tl-at', (minute / minutes).toFixed(5));
    const line = nextLine(chapters, Math.floor(atMs / 1000));
    if (line !== shownNext) { shownNext = line; nextText.textContent = line ?? ''; nextText.hidden = line === null; }
    renderTargets(atMs);
  };
  const renderControls = (): void => {
    const playing = clock.playing();
    const word = playing ? SN.controls.pause : SN.controls.play;
    if (playWord.textContent !== word) playWord.textContent = word;
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
      for (const off of teardowns) off();
      bar.remove();
    },
  };
}
