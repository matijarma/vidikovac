// The stage of /snimka/: the composition root of the instrument (plan
// sections 3.1 to 3.8; v3 decisions V3-11, V3-12, V3-15 to V3-18). Five slots
// (STAGE_SLOTS), laid out by snimka-stage.css: on a desktop the grid "deck map
// voices" over "timeline timeline timeline"; on a phone the map, one swipe row
// (the deck, then Objave) and the 64 px bar, sticky only once the stage's top
// reaches the viewport's. The map slot holds the map box (the map, the clock
// plate, the subtitle slot over its bottom edge), then ONE row of three
// toggle chips that double as the legend ("● Vozila 2", "● Običan dan 394",
// "◐ Bicikli"), then one foot line only when something applies (the
// comparison has no record, Sunday has none, bikes are missing, 1 h/s draws
// bikes only). The plate's chapter line shows for three replay hours after a
// chapter starts and never for a recording-internal one.
//
// Mount order: the map (one dynamic import, never on the entry graph), the
// subtitle, the feed, the deck, the timeline, the director once the map is
// there. One frame subscription drives the plate, the chips' counts, the foot
// line, the deck's faces, the subtitle and the timeline. Autoplay: the entry
// decides; the stage holds a playing clock until the map box is at least half
// in view (startWhenVisible). Probes: data-sn-stage, data-sn-expanded,
// data-sn-presenting, data-sn-idle, data-sn-bar-stuck, data-sn-foot.
import { ZAGREB_OFFSET_S, type Focus, type SnimkaEvent } from '../../../shared/snimka';
import { bindDirector } from './director';
import { comparisonFor, comparisonMinute, type Layers, type LoadedComparison, type Mount, type SnimkaContext } from './context';
import { STAGE_SLOTS, type PanelId, type PanelSpec, type StageMap, type StageSlot, type Subject } from './contracts';
import { seriesMinute } from './facts';
import { formatZagrebLocal, num, zagrebClock, zagrebDay } from './format';
import * as depths from './panel-depths';
import { createPanelDeck, el, escapeClosesPanel, SPOT_MS } from './panels';
import { bindPresentation } from './presentation';
import { readoutSpecs } from './readouts';
import { SN, fill } from './strings';
import { mountSubtitle } from './subtitle';
import { bindKeys, mountTimeline } from './timeline';
import { mountVoicesFeed } from './voices-feed';

const WEEKDAY_WORD: Record<number, string> = { 1: 'ponedjeljak', 4: 'četvrtak' };
const MONTH_GENITIVE: Record<number, string> = { 9: 'rujna', 10: 'listopada' };

/** "četvrtak 24. rujna": the normal day the overlay shows, for SN.layers.compareWhich. */
export function comparisonWords(c: Pick<LoadedComparison, 'day' | 'weekday'>): string {
  const [, m, d] = c.day.split('-').map(Number) as [number, number, number];
  return `${WEEKDAY_WORD[c.weekday] ?? ''} ${d}. ${MONTH_GENITIVE[m] ?? `${m}.`}`.trim();
}

/** The height of the page's sticky chrome above the stage (the section bar), in px; 0 where there is none. */
export function chromeHeight(doc: Document): number {
  const nav = doc.querySelector<HTMLElement>('.st-nav');
  if (!nav) return 0;
  const style = doc.defaultView?.getComputedStyle(nav);
  if (style && style.position !== 'sticky' && style.position !== 'fixed') return 0;
  return Math.round(nav.getBoundingClientRect().height);
}

/** V2's director announces its hold on the document (director.ts DIRECTOR_STATE_EVENT, detail { held }) and listens for a resume. */
export const DIRECTOR_STATE_EVENT = 'sn-director-state';
export const DIRECTOR_RESUME_EVENT = 'sn-director-resume';

// ---- the map lane's v3 names (W1), read through a typed boundary ------------------------------------------
//
// W1's map-layer.ts exports legendCounts(), chapterTitleAt(events, atSec) and mapInView(host) in the same pass. The
// stage reads them off the dynamically imported module when they are there and keeps its own rules otherwise (the
// lightweight mode has no map module at all), so the plate and the chips never wait for the map.

/** What the chips show as their counts: vehicles drawn, ghosts of the normal day drawn, bikes there or missing. */
export interface LegendCounts { vehicles: number | null; ghosts: number | null; bikes: 'ok' | 'missing' }
export interface MapLayerV3 {
  legendCounts?: () => LegendCounts | null;
  chapterTitleAt?: (events: readonly SnimkaEvent[], atSec: number) => string | null;
  mapInView?: (host: HTMLElement) => Promise<void>;
}

/** The plate shows a chapter's title for this long (replay seconds) after it starts (V3-12). */
export const PLATE_CHAPTER_S = 3 * 3600;

/** The plate's chapter line: the latest chapter at or before the instant within three replay hours, never a
 *  recording-internal one; null otherwise. */
export function plateChapterAt(events: readonly Pick<SnimkaEvent, 'atSec' | 'chapter' | 'internal' | 'title'>[], atSec: number): string | null {
  let best: Pick<SnimkaEvent, 'atSec' | 'title'> | null = null;
  for (const e of events) if (e.chapter && !e.internal && e.atSec <= atSec && (!best || e.atSec >= best.atSec)) best = e;
  return best && atSec - best.atSec <= PLATE_CHAPTER_S ? best.title : null;
}

const zagrebWeekday = (atSec: number): number => new Date((atSec + ZAGREB_OFFSET_S) * 1000).getUTCDay();

/** The chips' counts from the series alone (the map's own counts replace them once W1's legendCounts answers). */
export function legendCountsAt(ctx: Pick<SnimkaContext, 'series' | 'comparisons'>, atSec: number): LegendCounts {
  const m = seriesMinute(ctx.series, atSec);
  const vehicles = m >= 0 ? (ctx.series.seen.all[m] ?? null) : null;
  let ghosts: number | null = null;
  if (ctx.comparisons.length && zagrebWeekday(atSec) !== 0) {
    const cm = comparisonMinute(ctx, atSec);
    ghosts = cm === null ? null : (comparisonFor(ctx, atSec).series.seen.all[cm] ?? null);
  }
  const bikes = m >= 0 && ctx.series.bikes?.total[m] !== null && ctx.series.bikes?.total[m] !== undefined ? 'ok' : 'missing';
  return { vehicles, ghosts, bikes };
}

export type FootKey = 'speed' | 'sunday' | 'gap' | 'bikes';
/** The one line under the map, only when it applies, in this order: 1 h/s draws bikes only; Sunday has no comparison;
 *  the comparison day has no record for the minute; bikes are missing. Null when nothing applies. */
export function footLine(o: { atSec: number; speed: number; layers: Pick<Layers, 'compare' | 'bikes'>; counts: LegendCounts; hasComparison: boolean }): { key: FootKey; text: string } | null {
  if (o.speed === 3600) return { key: 'speed', text: SN.layers.noVehiclesAtSpeed };
  if (o.layers.compare && o.hasComparison) {
    if (zagrebWeekday(o.atSec) === 0) return { key: 'sunday', text: SN.layers.compareSunday };
    if (o.counts.ghosts === null) return { key: 'gap', text: SN.layers.compareGap };
  }
  if (o.layers.bikes && o.counts.bikes === 'missing') return { key: 'bikes', text: SN.layers.bikesMissing };
  return null;
}

/** A chip's count: the number, or "bez podatka" (missing is never 0). */
export const chipCount = (n: number | null): string => (n === null ? SN.facts.none : num(n));

/** W2's deckSpecs(ctx) when it is there, else the v2 registration (W2 lands it in parallel). */
function specsFor(ctx: SnimkaContext, faceTeardowns: (() => void)[]): PanelSpec[] {
  const own = (depths as { deckSpecs?: (c: SnimkaContext) => PanelSpec[] }).deckSpecs;
  if (typeof own === 'function') return own(ctx);
  return readoutSpecs(ctx, (id, host) => depths.mountPanelDepth(ctx, id, host), faceTeardowns);
}

/** Resolves once at least half of `host` is in the viewport (at once without IntersectionObserver). */
export function inViewHalf(host: HTMLElement): Promise<void> {
  const win = host.ownerDocument.defaultView as (Window & typeof globalThis) | null;
  if (!win || typeof win.IntersectionObserver !== 'function') return Promise.resolve();
  return new Promise((resolve) => {
    const io = new win.IntersectionObserver((entries) => {
      if (entries.some((e) => e.intersectionRatio >= 0.5)) { io.disconnect(); resolve(); }
    }, { threshold: [0.5] });
    io.observe(host);
  });
}

/** Autoplay's gate (V3-18): a clock the entry set playing waits, paused, until the map box is at least half in view;
 *  a reader's own play, pause or seek in the meantime cancels the wait. Returns the cancel. */
export function startWhenVisible(ctx: Pick<SnimkaContext, 'clock'>, host: HTMLElement, inView: (h: HTMLElement) => Promise<void> = inViewHalf): () => void {
  const { clock } = ctx;
  if (!clock.playing()) return () => {};
  const r = host.getBoundingClientRect();
  const vh = host.ownerDocument.defaultView?.innerHeight ?? 0;
  const visible = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
  if (r.height === 0 || vh === 0 || visible >= r.height / 2) return () => {};
  let waiting = true;
  let own = true;
  const off = clock.onTick((_, reason) => {
    if (own) return;
    if (reason === 'play' || reason === 'pause' || reason === 'seek') { waiting = false; off(); }
  });
  clock.pause();
  own = false;
  void inView(host).then(() => {
    if (!waiting) return;
    waiting = false;
    off();
    clock.play();
  });
  return () => { waiting = false; off(); };
}

type ChipKey = 'vehicles' | 'compare' | 'bikes';
const CHIPS: { key: ChipKey; name: string; glyph: string }[] = [
  { key: 'vehicles', name: SN.layers.vehicles, glyph: '●' },
  { key: 'compare', name: SN.layers.compare, glyph: '●' },
  { key: 'bikes', name: SN.layers.bikes, glyph: '◐' },
];

export const mountStage: Mount = (ctx, root) => {
  const { clock, frames, doc, layers, view } = ctx;
  let disposed = false;
  const teardowns: (() => void)[] = [];

  // ---- the five slots ----------------------------------------------------------------------------
  const stage = el(doc, 'div', { class: 'sn-stage-root', 'data-sn-stage': '', 'data-sn-expanded': 'none', 'data-sn-lagano': ctx.lagano ? '1' : '0' });
  const slots = {} as Record<StageSlot, HTMLDivElement>;
  for (const name of STAGE_SLOTS) slots[name] = el(doc, 'div', { class: `sn-slot sn-slot-${name}`, 'data-sn-slot': name, id: `sn-slot-${name}` });
  // The deck before Objave in the DOM: on a phone they are one swipe row, on a desktop the row dissolves into the grid.
  const row = el(doc, 'div', { class: 'sn-deck-row' }, slots.deck, slots.voices);
  stage.append(slots.map, row, slots.timeline);
  root.replaceChildren(stage);
  root.setAttribute('tabindex', '-1');

  const setChrome = (): void => { stage.style.setProperty('--sn-chrome-h', `${chromeHeight(doc)}px`); };
  setChrome();
  const win = doc.defaultView;
  win?.addEventListener('resize', setChrome);
  teardowns.push(() => win?.removeEventListener('resize', setChrome));

  // ---- the map slot: the box (map, plate, subtitle), the chips, the foot line ---------------------------------
  const mapHost = el(doc, 'div', { class: 'sn-map', id: 'sn-map', 'data-sn': 'map', 'data-persist': '', role: 'region', 'aria-label': SN.stage.mapLabel });
  const plateDay = el(doc, 'span', { class: 'sn-plate-day' });
  const plateSep = el(doc, 'span', { class: 'sn-plate-sep', 'aria-hidden': 'true', text: '·' });
  const plateTime = el(doc, 'time', { class: 'sn-plate-time' });
  const plateChapter = el(doc, 'span', { class: 'sn-plate-chapter', 'data-sn': 'plate-chapter' });
  const plate = el(doc, 'div', { class: 'sn-plate' }, plateDay, plateSep, plateTime, plateChapter);
  const mapBox = el(doc, 'div', { class: 'sn-map-box', 'data-sn-spot-target': 'map' });
  if (ctx.lagano) mapBox.append(el(doc, 'p', { class: 'st-note sn-lagano-note', 'data-sn': 'lagano', text: SN.stage.laganoNote }), plate);
  else mapBox.append(mapHost, plate);
  // The subtitle rides the map's bottom edge.
  mapBox.append(slots.subtitle);

  const chips = new Map<ChipKey, { button: HTMLButtonElement; count: HTMLElement | null }>();
  const compareNoteId = 'sn-compare-note';
  const compareNote = el(doc, 'span', { class: 'visually-hidden', id: compareNoteId, 'data-sn': 'compare-note' });
  const chipsRow = el(doc, 'div', { class: 'sn-chips-row', role: 'group', 'aria-label': SN.layers.label, 'data-sn': 'layers' });
  for (const c of CHIPS) {
    const count = c.key === 'bikes' ? null : el(doc, 'span', { class: 'sn-chip-count', 'data-sn': `count-${c.key}` });
    const button = el(doc, 'button', { type: 'button', class: 'chip sn-chip', 'data-layer': c.key, 'aria-pressed': 'false' },
      el(doc, 'span', { class: `sn-chip-dot sn-chip-dot-${c.key}`, 'aria-hidden': 'true', text: c.glyph }), el(doc, 'span', { class: 'sn-chip-name', text: c.name }), count);
    if (c.key === 'compare') { button.setAttribute('aria-describedby', compareNoteId); button.title = SN.layers.compareAria; }
    if (c.key === 'bikes') button.title = SN.layers.bikesLegend;
    button.addEventListener('click', () => layers.set({ [c.key]: !layers.get()[c.key] }));
    chips.set(c.key, { button, count });
    chipsRow.append(button);
  }
  chipsRow.append(compareNote);
  const foot = el(doc, 'p', { class: 'sn-stage-foot', 'data-sn': 'foot', hidden: true });
  slots.map.append(mapBox, chipsRow, foot);

  // ---- the lane mounts, by their contract names --------------------------------------------------------
  let map: StageMap | null = null;
  let mapModule: MapLayerV3 | null = null;
  const subtitle = mountSubtitle(ctx, slots.subtitle);
  teardowns.push(() => subtitle.destroy());
  teardowns.push(mountVoicesFeed(ctx, slots.voices, { flyTo: (focus: Focus) => map?.flyTo(focus, { reason: 'feed' }) }));

  /** A chapter opened from a pin or the Poglavlja list: pause, seek, the chapter's focus as the subject or the camera. */
  const openChapter = (chapterId: string, scroll = false): void => {
    const event = ctx.events.find((e) => e.id === chapterId);
    if (!event) return;
    clock.pause();
    clock.seek(event.atSec * 1000);
    const f = event.focus;
    if (f.kind === 'route' || f.kind === 'station' || f.kind === 'stop') view.set({ subject: { kind: f.kind, id: f.id } }, 'chapter');
    else if (f.kind !== 'none') map?.flyTo(f, { reason: 'chapter' });
    if (scroll) stage.scrollIntoView?.({ block: 'start', behavior: ctx.reducedMotion ? 'auto' : 'smooth' });
  };

  const faceTeardowns: (() => void)[] = [];
  const deck = createPanelDeck(slots.deck, {
    ctx,
    specs: specsFor(ctx, faceTeardowns),
    onExpand: (id) => {
      stage.dataset.snExpanded = id ?? 'none';
      // The deck column widens around an open panel: the map's canvas follows its box.
      map?.resize();
    },
  });
  stage.dataset.snExpanded = deck.expanded() ?? 'none';
  teardowns.push(() => { deck.destroy(); for (const off of faceTeardowns) off(); });

  const timeline = mountTimeline(ctx, slots.timeline, undefined, { openChapter: (id) => openChapter(id) });
  teardowns.push(() => timeline.destroy());
  const presentHint = el(doc, 'span', { class: 'visually-hidden', id: 'sn-present-hint', text: SN.present.hint });
  timeline.present.setAttribute('aria-describedby', presentHint.id);
  timeline.present.after(presentHint);
  teardowns.push(bindPresentation(stage, timeline.present, {
    reducedMotion: ctx.reducedMotion,
    controls: () => [slots.timeline, chipsRow, slots.deck],
    onChange: () => { map?.resize(); },
  }));
  teardowns.push(bindKeys(ctx, root));

  // The first Escape anywhere in the stage closes an open panel; the map's own Escape (V2) clears the subject after.
  const onEscape = (event: KeyboardEvent): void => { escapeClosesPanel(deck, event); };
  root.addEventListener('keydown', onEscape);
  teardowns.push(() => root.removeEventListener('keydown', onEscape));

  // ---- the subject: the map selects it, the panel that tells its story opens ----------------------------------
  const panelFor = (s: Subject): PanelId | null => (s.kind === 'route' ? 'mreza' : s.kind === 'station' ? 'bicikli' : null);
  const offView = view.onChange((state, prev, reason) => {
    const s = state.subject;
    const p = prev.subject;
    if (s === p || (s && p && s.kind === p.kind && s.id === p.id)) return;
    if (reason !== 'map') map?.select(s, { fit: true });
    const panel = s ? panelFor(s) : null;
    if (panel && deck.expanded() !== panel) deck.expand(panel, reason === 'user' ? 'feed' : reason);
  });
  teardowns.push(offView);
  const initialSubject = view.get().subject;
  if (initialSubject && !view.get().panel) {
    const panel = panelFor(initialSubject);
    if (panel) deck.expand(panel, 'address');
  }

  // ---- the phone bar sticks only once the stage's top reaches the viewport's ---------------------------------
  let stuck = false;
  const onScroll = (): void => {
    const top = stage.getBoundingClientRect().top;
    const next = top <= chromeHeight(doc) + 1;
    if (next === stuck) return;
    stuck = next;
    if (stuck) stage.dataset.snBarStuck = ''; else delete stage.dataset.snBarStuck;
  };
  win?.addEventListener('scroll', onScroll, { passive: true });
  teardowns.push(() => win?.removeEventListener('scroll', onScroll));
  onScroll();

  // ---- rendering ------------------------------------------------------------------------------------------
  let shownDay = '';
  let shownTime = '';
  let shownChapter: string | null = '\u0000';
  let shownCompareDay = '';
  let shownCounts = '';
  let shownFoot = '\u0000';
  const chapterTitle = (atSec: number): string | null => mapModule?.chapterTitleAt?.(ctx.events, atSec) ?? plateChapterAt(ctx.events, atSec);
  const counts = (atSec: number): LegendCounts => {
    const fromMap = map ? ((map as StageMap & { legendCounts?: () => LegendCounts | null }).legendCounts?.() ?? mapModule?.legendCounts?.() ?? null) : null;
    return fromMap ?? legendCountsAt(ctx, atSec);
  };
  const renderPlate = (t: number): void => {
    const day = zagrebDay(t);
    const time = zagrebClock(t);
    if (day !== shownDay) { shownDay = day; plateDay.textContent = day; }
    if (time === shownTime) return;
    shownTime = time;
    plateTime.textContent = time;
    plateTime.setAttribute('datetime', `${formatZagrebLocal(t)}+02:00`);
    root.dataset.snAt = formatZagrebLocal(t);
    const atSec = Math.floor(t / 1000);
    const chapter = chapterTitle(atSec);
    if (chapter !== shownChapter) { shownChapter = chapter; plateChapter.textContent = chapter ?? ''; }
    if (ctx.comparisons.length) {
      const words = comparisonWords(comparisonFor(ctx, atSec));
      if (words !== shownCompareDay) { shownCompareDay = words; compareNote.textContent = `${SN.layers.compareAria}. ${fill(SN.layers.compareWhich, { day: words })}`; }
    }
  };
  const renderLegend = (t: number, force = false): void => {
    const atSec = Math.floor(t / 1000);
    const c = counts(atSec);
    const key = `${c.vehicles}|${c.ghosts}|${c.bikes}`;
    if (key !== shownCounts || force) {
      shownCounts = key;
      const v = chips.get('vehicles')!.count!;
      const g = chips.get('compare')!.count!;
      const vt = chipCount(c.vehicles);
      const gt = chipCount(c.ghosts);
      if (v.textContent !== vt) v.textContent = vt;
      if (g.textContent !== gt) g.textContent = gt;
    }
    const line = ctx.lagano ? null : footLine({ atSec, speed: clock.speed(), layers: layers.get(), counts: c, hasComparison: ctx.comparisons.length > 0 });
    const fk = line ? `${line.key}` : '';
    if (fk !== shownFoot) {
      shownFoot = fk;
      foot.hidden = !line;
      foot.textContent = line?.text ?? '';
      if (line) foot.dataset.snFoot = line.key; else delete foot.dataset.snFoot;
    }
  };
  function renderChips(): void {
    const l = layers.get();
    for (const [key, chip] of chips) chip.button.setAttribute('aria-pressed', l[key] ? 'true' : 'false');
    renderLegend(clock.now(), true);
  }
  const offLayers = layers.onChange(() => renderChips());
  const offTick = clock.onTick(() => renderLegend(clock.now()));
  teardowns.push(offLayers, offTick);

  const frame = (t: number): void => {
    if (disposed) return;
    renderPlate(t);
    renderLegend(t);
    deck.update(t);
    subtitle.update(t);
    timeline.update(t);
  };
  teardowns.push(frames.subscribe(frame));

  // ---- the map, then the director ----------------------------------------------------------------------------
  const spot = (id: PanelId | 'zaslon'): void => {
    if (id !== 'zaslon') { deck.spot(id); return; }
    if (ctx.reducedMotion) return;
    slots.subtitle.dataset.spot = '';
    globalThis.setTimeout(() => { delete slots.subtitle.dataset.spot; }, SPOT_MS);
  };
  // Autoplay waits for the map box to be half in view (a phone opens on the hero; a desktop below the fold).
  let cancelStart: (() => void) | null = null;
  const gate = (inView?: (h: HTMLElement) => Promise<void>): void => { cancelStart?.(); cancelStart = startWhenVisible(ctx, mapBox, inView); };
  gate();
  teardowns.push(() => cancelStart?.());
  if (!ctx.lagano) {
    void import('./map-layer').then(async (mod) => {
      if (disposed) return;
      mapModule = mod as MapLayerV3;
      const m = await mod.mountMapLayer(ctx, mapHost);
      if (disposed) { m.destroy(); return; }
      map = m;
      const subject = view.get().subject;
      if (subject) m.select(subject, { fit: true });
      // The map lane binds a director of its own; this bind replaces it with the deck's spot (V2's report).
      const offDirector = bindDirector(ctx, m, { spot });
      teardowns.push(offDirector);
      renderLegend(clock.now(), true);
    }).catch(() => {
      // The map library did not load (an old browser, a blocked chunk): the stage keeps its clock and its panels.
      mapHost.dataset.mapStatus = 'unavailable';
    });
  }

  renderChips();
  frame(clock.now());
  root.removeAttribute('aria-busy');

  return () => {
    disposed = true;
    for (const off of teardowns.reverse()) off();
    map?.destroy();
    map = null;
  };
};
