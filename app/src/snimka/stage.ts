// The stage of /snimka/: the composition root of the instrument (plan
// sections 3.1 to 3.8). Five slots in DOM order (STAGE_SLOTS: map, deck,
// voices, subtitle, timeline), laid out by snimka-stage.css: on a desktop
// the grid "deck map voices" over "timeline timeline timeline", the subtitle
// at the map's foot, the whole stage as tall as the viewport under the
// sticky section bar; on a phone the map at 56vh, the subtitle under it,
// the deck and the voices as one horizontal swipe row and the timeline bar
// sticky at the bottom. The map slot holds the clock plate (day, time, the
// chapter), the layer chips in their two groups and the legend words.
//
// Mount order: the map (one dynamic import, never on the entry graph), the
// subtitle, the feed, the deck, the timeline, the director once the map is
// there. One frame subscription drives the plate, the deck's faces, the
// subtitle and the timeline. The map host carries data-persist and every
// panel data-key, so a rebuild through reconcile() never touches the map.
// Probes: data-sn-stage, data-sn-expanded, data-sn-presenting, data-sn-idle.
import { agendaPanel } from './agenda';
import { bindDirector } from './director';
import { comparisonFor, type Layers, type LoadedComparison, type Mount } from './context';
import { STAGE_SLOTS, type PanelId, type StageMap, type StageSlot, type Subject } from './contracts';
import { formatZagrebLocal, zagrebClock, zagrebDay } from './format';
import { mountPanelDepth } from './panel-depths';
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

type ChipKey = keyof Layers;
/** V2's director announces its hold on the document (director.ts DIRECTOR_STATE_EVENT, detail { held }) and listens for a resume. */
export const DIRECTOR_STATE_EVENT = 'sn-director-state';
export const DIRECTOR_RESUME_EVENT = 'sn-director-resume';
const SOURCE_CHIPS: [ChipKey, string][] = [['vehicles', SN.layers.vehicles], ['bikes', SN.layers.bikes], ['closures', SN.layers.closures], ['compare', SN.layers.compare]];
const DERIVED_CHIPS: [ChipKey, string][] = [['live', SN.layers.live], ['follow', SN.layers.follow]];

export const mountStage: Mount = (ctx, root) => {
  const { clock, frames, doc, layers, view } = ctx;
  let disposed = false;
  const teardowns: (() => void)[] = [];

  // ---- the five slots ----------------------------------------------------------------------------
  const stage = el(doc, 'div', { class: 'sn-stage-root', 'data-sn-stage': '', 'data-sn-expanded': 'none', 'data-sn-lagano': ctx.lagano ? '1' : '0' });
  const slots = {} as Record<StageSlot, HTMLDivElement>;
  for (const name of STAGE_SLOTS) slots[name] = el(doc, 'div', { class: `sn-slot sn-slot-${name}`, 'data-sn-slot': name, id: `sn-slot-${name}` });
  // The deck and the voices share one row: on a phone it is the swipe row, on a desktop it dissolves into the grid.
  const row = el(doc, 'div', { class: 'sn-deck-row' }, slots.deck, slots.voices);
  stage.append(slots.map, row, slots.subtitle, slots.timeline);
  root.replaceChildren(stage);
  root.setAttribute('tabindex', '-1');

  const setChrome = (): void => { stage.style.setProperty('--sn-chrome-h', `${chromeHeight(doc)}px`); };
  setChrome();
  const win = doc.defaultView;
  win?.addEventListener('resize', setChrome);
  teardowns.push(() => win?.removeEventListener('resize', setChrome));

  // ---- the map slot: the host, the plate, the chips, the legend -----------------------------------
  const mapHost = el(doc, 'div', { class: 'sn-map', id: 'sn-map', 'data-sn': 'map', 'data-persist': '', role: 'region', 'aria-label': SN.stage.mapLabel });
  const plateDay = el(doc, 'span', { class: 'sn-plate-day' });
  const plateTime = el(doc, 'time', { class: 'sn-plate-time' });
  const plateChapter = el(doc, 'span', { class: 'sn-plate-chapter', 'data-sn': 'plate-chapter' });
  const plate = el(doc, 'div', { class: 'sn-plate' }, plateDay, plateTime, plateChapter);
  const mapBox = el(doc, 'div', { class: 'sn-map-box', 'data-sn-spot-target': 'map' });
  if (ctx.lagano) mapBox.append(el(doc, 'p', { class: 'st-note sn-lagano-note', 'data-sn': 'lagano', text: SN.stage.laganoNote }), plate);
  else mapBox.append(mapHost, plate);

  const chips = new Map<ChipKey, HTMLButtonElement>();
  let directorHeld = false;
  const onDirectorState = (event: Event): void => {
    directorHeld = Boolean((event as CustomEvent<{ held?: boolean }>).detail?.held);
    renderChips();
  };
  doc.addEventListener(DIRECTOR_STATE_EVENT, onDirectorState);
  teardowns.push(() => doc.removeEventListener(DIRECTOR_STATE_EVENT, onDirectorState));
  const chipGroup = (label: string, list: [ChipKey, string][], id: string): HTMLElement => {
    const group = el(doc, 'div', { class: 'sn-chip-group', role: 'group', 'aria-labelledby': id }, el(doc, 'span', { class: 'sn-chip-label', id, text: label }));
    for (const [key, text] of list) {
      const chip = el(doc, 'button', { type: 'button', class: 'chip sn-chip', 'data-layer': key, 'aria-pressed': 'false', text });
      chip.addEventListener('click', () => {
        if (key === 'follow') {
          // A held director (the reader moved the map) resumes at once; otherwise the chip switches the following.
          if (layers.get().follow && directorHeld) doc.dispatchEvent(new CustomEvent(DIRECTOR_RESUME_EVENT));
          else {
            // A deliberate switch goes into the address (prati=0); a hold never does.
            const next = !layers.get().follow;
            layers.set({ follow: next });
            view.set({ following: next }, 'user');
          }
        } else layers.set({ [key]: !layers.get()[key] });
      });
      chips.set(key, chip);
      group.append(chip);
    }
    return group;
  };
  const liveNote = el(doc, 'span', { class: 'visually-hidden', id: 'sn-live-note', text: SN.layers.liveNote });
  const followNote = el(doc, 'span', { class: 'visually-hidden', id: 'sn-follow-note', text: SN.director.note });
  const sources = chipGroup(SN.layers.sources, SOURCE_CHIPS, 'sn-chips-sources');
  const derived = chipGroup(SN.layers.derived, DERIVED_CHIPS, 'sn-chips-derived');
  chips.get('live')?.setAttribute('aria-describedby', liveNote.id);
  chips.get('follow')?.setAttribute('aria-describedby', followNote.id);
  const legendItem = (cls: string, text: string, series?: string): HTMLLIElement =>
    el(doc, 'li', { 'data-series': series }, el(doc, 'span', { class: `sn-legend-mark ${cls}`, 'aria-hidden': 'true' }), text);
  const ghostItem = legendItem('sn-legend-ghost', SN.legend.ghost, 'compare');
  const legend = el(doc, 'ul', { class: 'sn-legend-words', 'data-sn': 'legend' },
    legendItem('sn-legend-alive', SN.legend.alive, 'live'), legendItem('sn-legend-dead', SN.legend.dead, 'live'), legendItem('sn-legend-quiet', SN.legend.quiet, 'live'), ghostItem);
  const compareNote = el(doc, 'li', { class: 'sn-layer-note', 'data-sn': 'compare-note', hidden: true });
  const speedNote = el(doc, 'li', { class: 'sn-layer-note', 'data-sn': 'speed-note', text: SN.layers.noVehiclesAtSpeed, hidden: true });
  // The legend words and the two notes ride the map's foot; the chips stand under the map.
  legend.append(compareNote, speedNote);
  if (!ctx.lagano) mapBox.append(legend);
  const chipsRow = el(doc, 'div', { class: 'sn-chips-row', 'data-sn': 'layers' }, sources, derived, liveNote, followNote);
  slots.map.append(mapBox, chipsRow);

  // ---- the lane mounts, by their contract names --------------------------------------------------------
  let map: StageMap | null = null;
  const subtitle = mountSubtitle(ctx, slots.subtitle);
  teardowns.push(() => subtitle.destroy());
  teardowns.push(mountVoicesFeed(ctx, slots.voices));

  /** Poglavlja's open(chapterId): pause, seek, the chapter's focus as the subject or the camera, the instrument in view. */
  const openChapter = (chapterId: string): void => {
    const event = ctx.events.find((e) => e.id === chapterId);
    if (!event) return;
    clock.pause();
    clock.seek(event.atSec * 1000);
    const f = event.focus;
    if (f.kind === 'route' || f.kind === 'station' || f.kind === 'stop') view.set({ subject: { kind: f.kind, id: f.id } }, 'chapter');
    else if (f.kind !== 'none') map?.flyTo(f, { reason: 'chapter' });
    root.scrollIntoView?.({ block: 'start', behavior: ctx.reducedMotion ? 'auto' : 'smooth' });
  };

  const faceTeardowns: (() => void)[] = [];
  const deck = createPanelDeck(slots.deck, {
    ctx,
    specs: [...readoutSpecs(ctx, (id, host) => mountPanelDepth(ctx, id, host), faceTeardowns), agendaPanel(ctx, openChapter)],
    onExpand: (id) => {
      stage.dataset.snExpanded = id ?? 'none';
      // The deck column widens around an open panel: the map's canvas follows its box.
      map?.resize();
    },
  });
  stage.dataset.snExpanded = deck.expanded() ?? 'none';
  teardowns.push(() => { deck.destroy(); for (const off of faceTeardowns) off(); });

  const timeline = mountTimeline(ctx, slots.timeline);
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
  const panelFor = (s: Subject): PanelId | null => (s.kind === 'route' ? 'linije' : s.kind === 'station' ? 'bicikli' : null);
  const offView = view.onChange((state, prev, reason) => {
    renderChips();
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

  // ---- rendering ------------------------------------------------------------------------------------------
  let shownDay = '';
  let shownTime = '';
  let shownChapter = -2;
  let shownCompareDay = '';
  const renderPlate = (t: number): void => {
    const day = zagrebDay(t);
    const time = zagrebClock(t);
    if (day !== shownDay) { shownDay = day; plateDay.textContent = day; }
    if (time !== shownTime) {
      shownTime = time;
      plateTime.textContent = time;
      plateTime.setAttribute('datetime', `${formatZagrebLocal(t)}+02:00`);
      root.dataset.snAt = formatZagrebLocal(t);
      const i = clock.chapterIndex();
      if (i !== shownChapter) { shownChapter = i; plateChapter.textContent = i >= 0 ? (clock.chapters()[i]?.title ?? '') : ''; }
      if (ctx.comparisons.length) {
        const words = comparisonWords(comparisonFor(ctx, t / 1000));
        if (words !== shownCompareDay) { shownCompareDay = words; compareNote.textContent = fill(SN.layers.compareWhich, { day: words }); }
      }
    }
  };
  function renderChips(): void {
    const l = layers.get();
    for (const [key, chip] of chips) {
      const on = key === 'follow' ? l.follow && !directorHeld : l[key];
      chip.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    compareNote.hidden = !l.compare || !ctx.comparisons.length;
    ghostItem.hidden = !l.compare;
    for (const item of legend.querySelectorAll<HTMLElement>('[data-series="live"]')) item.hidden = !l.live;
    speedNote.hidden = ctx.lagano || clock.speed() !== 3600;
  }
  const offLayers = layers.onChange(() => renderChips());
  const offTick = clock.onTick(() => { speedNote.hidden = ctx.lagano || clock.speed() !== 3600; });
  teardowns.push(offLayers, offTick);

  const frame = (t: number): void => {
    if (disposed) return;
    renderPlate(t);
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
  if (!ctx.lagano) {
    void import('./map-layer').then(async ({ mountMapLayer }) => {
      if (disposed) return;
      const m = await mountMapLayer(ctx, mapHost);
      if (disposed) { m.destroy(); return; }
      map = m;
      const subject = view.get().subject;
      if (subject) m.select(subject, { fit: true });
      // The map lane binds a director of its own; this bind replaces it with the deck's spot (V2's report).
      const offDirector = bindDirector(ctx, m, { spot });
      teardowns.push(offDirector);
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
