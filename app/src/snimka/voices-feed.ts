// Objave (decision V3-16): what ZET, the court and the press said, and the
// recording's chapters, beside the map on the one clock. Two levels: the
// current item (the latest at or before the instant: its kicker, its time,
// the title at 16 px, a headline's title as its link, at most two chips and
// only on ZET, court and chapter items, the folded headlines of its beat)
// over a compact log (13 px rows: time · kicker · title, newest first, under
// day headings, the chapters as heading rows). No cap: the log scrolls. A
// click on a row or on the current item's time pauses the replay, moves it to
// that minute, makes the item's line, station or stop the subject and, for a
// headline, moves the map to its place (the director no longer follows the
// press). With a subject one 44 px line says "Samo linija 228 · skriveno 39"
// with "Prikaži sve". Passive play adds items at most every 400 ms of wall
// time and slides the new current item in only without reduced motion; a
// seek redraws at once. Probes: data-sn-feed-count, data-sn-feed-current,
// data-sn-feed-subject.
import type { Focus } from '../../../shared/snimka';
import type { Subject } from './contracts';
import type { SnimkaContext } from './context';
import { chipsLabel, factChips, onStationData, stationData, type FactChip } from './facts';
import { formatZagrebLocal, plural, zagrebClock, zagrebDateTime, zagrebDay } from './format';
import { SN, fill } from './strings';
import { buildVoices, chipKeys, feedAt, focusSubject, foldPress, foldedUpTo, kickerOf, type VoiceItem } from './voices';

/** Passive play adds new items at most this often (wall milliseconds). */
export const FEED_CADENCE_MS = 400;

export interface FeedOptions {
  /** The map's flyTo, once the map is there (a headline's click moves the camera). */
  flyTo?: (focus: Focus) => void;
}

/** The subject's name in the feed: "Linija 228", "Stanica BAJS-a Trg žrtava fašizma", "Stajalište Glavni kolodvor". */
export function subjectLabel(ctx: Pick<SnimkaContext, 'routes' | 'places' | 'manifest' | 'data'>, subject: Subject): string {
  if (subject.kind === 'route') {
    const route = ctx.routes.routes.find((r) => r.id === subject.id);
    return fill(SN.subject.line, { short: route?.shortName ?? subject.id });
  }
  if (subject.kind === 'station') {
    const name = stationData(ctx)?.stations.get(subject.id)?.name ?? subject.id;
    return fill(SN.subject.station, { name });
  }
  const place = ctx.places.places.find((p) => p.ref === subject.id);
  return fill(SN.subject.stop, { name: place?.name ?? subject.id });
}

/** "Samo linija 228 · skriveno 39": the subject's name in running text starts lower case. */
export function filterLine(label: string, hidden: number): string {
  return fill(SN.voices.filtered, { subject: label.charAt(0).toLocaleLowerCase('hr') + label.slice(1), n: hidden });
}

/** Whether a click on the item moves the map itself: a headline whose focus is a place, the city or a layer (a line,
 *  a station or a stop becomes the subject, which the stage fits). */
export function fliesTo(item: Pick<VoiceItem, 'kind' | 'focus'>): boolean {
  return item.kind === 'press' && item.focus.kind !== 'none' && focusSubject(item) === null;
}

const subjectKey = (s: Subject | null): string => (s ? `${s.kind}:${s.id}` : '');

/** The index of the first time strictly after `atSec` in an ascending list: how many items have spoken by then. */
function spokenBy(times: readonly number[], atSec: number): number {
  let lo = 0;
  let hi = times.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid]! <= atSec) lo = mid + 1; else hi = mid;
  }
  return lo;
}

let feedIds = 0;

export const mountVoicesFeed = (ctx: SnimkaContext, root: HTMLElement, opts: FeedOptions = {}): (() => void) => {
  const doc = ctx.doc ?? root.ownerDocument;
  const V = SN.voices;
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
    const node = doc.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  // ---- the frame ----------------------------------------------------------------------------
  const panel = el('section', 'sn-feed');
  const headingId = `sn-feed-h-${++feedIds}`;
  panel.setAttribute('aria-labelledby', headingId);
  const heading = el('h3', 'sn-feed-title', V.title);
  heading.id = headingId;
  const filter = el('p', 'sn-feed-filter');
  filter.hidden = true;
  const filterText = el('span', 'sn-feed-filter-text');
  const clear = el('button', 'sn-feed-clear', V.clear);
  clear.type = 'button';
  clear.dataset.sn = 'feed-clear';
  clear.addEventListener('click', () => ctx.view.set({ subject: null }, 'feed'));
  filter.append(filterText, clear);
  const empty = el('p', 'sn-feed-empty', V.empty);
  const current = el('article', 'sn-feed-current');
  current.dataset.sn = 'feed-current';
  current.hidden = true;
  const log = el('ol', 'sn-feed-log');
  panel.append(heading, filter, empty, current, log);
  root.replaceChildren(panel);
  root.dataset.snFeedCount = '0';
  root.dataset.snFeedCurrent = '';
  root.dataset.snFeedSubject = '';

  // ---- the items ------------------------------------------------------------------------------
  const items: VoiceItem[] = foldPress(buildVoices(ctx));
  const times: number[] = items.map((i) => i.atSec);

  const chipsInto = (host: HTMLElement, chips: FactChip[]): void => {
    host.replaceChildren(...chips.map((c) => {
      const chip = el('span', 'sn-fact-chip', c.text);
      if (c.missing) chip.dataset.missing = 'true';
      if (c.retro) {
        chip.dataset.retro = 'true';
        chip.title = SN.badge.retroShort;
      }
      return chip;
    }));
  };

  const seekTo = (item: VoiceItem): void => {
    ctx.clock.pause();
    ctx.clock.seek(item.atSec * 1000);
    const subject = focusSubject(item);
    if (subject) ctx.view.set({ subject }, 'feed');
    if (fliesTo(item)) opts.flyTo?.(item.focus);
  };

  const linkTo = (href: string, text: string, cls = 'sn-feed-link'): HTMLAnchorElement => {
    const a = el('a', cls, text);
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.append(el('span', 'visually-hidden', ` ${SN.news.newTab}`));
    return a;
  };

  const foldText = (n: number): string => fill(plural(n, V.moreForms), { count: `+${n}` });

  // ---- the current item ------------------------------------------------------------------------
  let currentId = '';
  let currentFold = -1;
  let currentChips: { item: VoiceItem; host: HTMLElement; pending: boolean } | null = null;
  const renderCurrent = (item: VoiceItem | null, atSec: number, animate: boolean): void => {
    if (!item) {
      current.hidden = true;
      current.replaceChildren();
      currentId = '';
      currentChips = null;
      return;
    }
    if (item.id === currentId) { renderCurrentFold(item, atSec); return; }
    currentId = item.id;
    currentFold = -1;
    current.hidden = false;
    current.dataset.id = item.id;
    current.dataset.kind = item.kind;
    current.dataset.at = String(item.atSec);
    if (item.tone) current.dataset.tone = item.tone; else delete current.dataset.tone;
    const when = zagrebDateTime(item.atSec * 1000);
    const meta = el('p', 'sn-feed-meta');
    const seek = el('button', 'sn-feed-seek');
    seek.type = 'button';
    seek.setAttribute('aria-label', fill(V.seek, { time: when }));
    const time = el('time', 'sn-feed-time', when);
    time.dateTime = `${formatZagrebLocal(item.atSec * 1000)}+02:00`;
    seek.append(time);
    seek.addEventListener('click', () => seekTo(item));
    meta.append(el('span', 'sn-feed-kind', kickerOf(item)), seek);
    const title = el('p', 'sn-feed-headline');
    if (item.link) title.append(linkTo(item.link, item.title));
    else title.textContent = item.title;
    const parts: HTMLElement[] = [meta, title];
    currentChips = null;
    const keys = chipKeys(item);
    if (keys.length) {
      const values = factChips(keys, ctx, item.atSec);
      if (values.length) {
        const chips = el('p', 'sn-feed-chips');
        chips.setAttribute('aria-label', chipsLabel());
        chipsInto(chips, values);
        currentChips = { item, host: chips, pending: values.some((c) => c.pending) };
        parts.push(chips);
      }
    }
    if (item.folded?.length) {
      const fold = el('details', 'sn-feed-fold');
      fold.append(el('summary', 'sn-feed-fold-summary'), el('ul', 'sn-feed-fold-list'));
      fold.hidden = true;
      parts.push(fold);
    }
    current.replaceChildren(...parts);
    renderCurrentFold(item, atSec);
    current.classList.remove('sn-feed-in');
    if (animate) {
      void current.offsetWidth;
      current.classList.add('sn-feed-in');
    }
  };
  const renderCurrentFold = (item: VoiceItem, atSec: number): void => {
    const fold = current.querySelector<HTMLDetailsElement>('.sn-feed-fold');
    if (!fold) return;
    const shown = foldedUpTo(item, atSec);
    if (shown.length === currentFold) return;
    currentFold = shown.length;
    fold.hidden = shown.length === 0;
    fold.querySelector('summary')!.textContent = foldText(shown.length);
    fold.querySelector('ul')!.replaceChildren(...shown.map((f) => {
      const li = el('li', 'sn-feed-fold-item');
      li.append(linkTo(f.link ?? '#', f.title), ' ', el('span', 'sn-feed-fold-meta', `${f.source?.label ?? ''} · ${zagrebClock(f.atSec * 1000)}`.replace(/^ · /, '')));
      return li;
    }));
  };

  // ---- the log ---------------------------------------------------------------------------------
  interface Row { li: HTMLLIElement; fold: HTMLElement | null; foldShown: number }
  const rows = new Map<string, Row>();
  const days = new Map<string, HTMLLIElement>();

  const rowOf = (item: VoiceItem): Row => {
    let row = rows.get(item.id);
    if (row) return row;
    const li = el('li', 'sn-feed-row');
    li.dataset.id = item.id;
    li.dataset.kind = item.kind;
    li.dataset.at = String(item.atSec);
    if (item.tone) li.dataset.tone = item.tone;
    const button = el('button', item.kind === 'chapter' ? 'sn-feed-row-btn sn-feed-chapter-btn' : 'sn-feed-row-btn');
    button.type = 'button';
    const time = el('time', 'sn-feed-row-time', zagrebClock(item.atSec * 1000));
    time.dateTime = `${formatZagrebLocal(item.atSec * 1000)}+02:00`;
    button.append(time, el('span', 'sn-feed-row-kind', kickerOf(item)), el('span', 'sn-feed-row-title', item.title));
    let fold: HTMLElement | null = null;
    if (item.folded?.length) {
      fold = el('span', 'sn-feed-row-fold');
      fold.hidden = true;
      button.append(fold);
    }
    button.addEventListener('click', () => seekTo(item));
    if (item.kind === 'chapter') {
      // A chapter is a heading of the log; its button seeks like any row.
      const h = el('h4', 'sn-feed-chapter');
      h.append(button);
      li.append(h);
    } else li.append(button);
    row = { li, fold, foldShown: -1 };
    rows.set(item.id, row);
    return row;
  };
  const dayOf = (key: string, label: string): HTMLLIElement => {
    let li = days.get(key);
    if (!li) {
      li = el('li', 'sn-feed-day', label);
      li.dataset.day = key;
      days.set(key, li);
    }
    return li;
  };

  /** Puts `wanted` into `host` in order, moving only what is out of place. */
  const place = (host: HTMLElement, wanted: readonly HTMLElement[]): void => {
    wanted.forEach((node, i) => {
      if (host.children[i] !== node) host.insertBefore(node, host.children[i] ?? null);
    });
    while (host.children.length > wanted.length) host.lastElementChild!.remove();
  };

  // ---- rendering ----------------------------------------------------------------------------------
  let shownCount = -1;
  let shownSubject = '\u0000';
  let lastRender = -Infinity;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let jumped = true;
  let latest = 0;
  let destroyed = false;
  const wall = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  const render = (atSec: number): void => {
    const subject = ctx.view.get().subject;
    const key = subjectKey(subject);
    const at = feedAt(items, atSec, subject);
    const animate = !jumped && !ctx.reducedMotion && shownCount >= 0 && at.current?.id !== currentId;
    renderCurrent(at.current, atSec, animate);
    const wanted: HTMLElement[] = [];
    let day = '';
    for (const item of at.log) {
      const label = zagrebDay(item.atSec * 1000);
      if (label !== day) { day = label; wanted.push(dayOf(formatZagrebLocal(item.atSec * 1000).slice(0, 10), label)); }
      const row = rowOf(item);
      if (row.fold) {
        const n = foldedUpTo(item, atSec).length;
        if (n !== row.foldShown) { row.foldShown = n; row.fold.hidden = n === 0; row.fold.textContent = n ? foldText(n) : ''; }
      }
      wanted.push(row.li);
    }
    place(log, wanted);
    empty.hidden = at.count > 0;
    filter.hidden = subject === null;
    if (subject) filterText.textContent = filterLine(subjectLabel(ctx, subject), at.hiddenCount);
    root.dataset.snFeedCount = String(at.count);
    root.dataset.snFeedCurrent = at.current?.id ?? '';
    root.dataset.snFeedSubject = key;
    shownCount = spokenBy(times, atSec);
    shownSubject = key;
    lastRender = wall();
    jumped = false;
  };

  const tick = (t: number): void => {
    if (destroyed) return;
    const atSec = Math.floor(t / 1000);
    const count = spokenBy(times, atSec);
    const key = subjectKey(ctx.view.get().subject);
    if (count === shownCount && key === shownSubject && !jumped) return;
    // A forward step of passive play waits for the cadence; anything else (a seek, the subject) draws now.
    const passive = !jumped && key === shownSubject && count > shownCount;
    if (passive && wall() - lastRender < FEED_CADENCE_MS) {
      latest = atSec;
      if (timer === null) {
        timer = setTimeout(() => {
          timer = null;
          if (!destroyed) render(latest);
        }, FEED_CADENCE_MS - (wall() - lastRender));
      }
      return;
    }
    if (timer !== null) { clearTimeout(timer); timer = null; }
    render(atSec);
  };

  // A station chip drawn before the stations arrived is drawn once more.
  const offStations = onStationData(ctx, () => {
    if (!currentChips?.pending) return;
    const values = factChips(chipKeys(currentChips.item), ctx, currentChips.item.atSec);
    chipsInto(currentChips.host, values);
    currentChips.pending = values.some((c) => c.pending);
  });

  const offTick = ctx.clock.onTick((_, reason) => {
    if (reason === 'seek' || reason === 'speed') jumped = true;
  });
  const offView = ctx.view.onChange(() => tick(ctx.clock.now()));
  const offFrames = ctx.frames.subscribe(tick);
  tick(ctx.clock.now());

  return () => {
    destroyed = true;
    if (timer !== null) clearTimeout(timer);
    offFrames();
    offView();
    offTick();
    offStations();
    delete root.dataset.snFeedCount;
    delete root.dataset.snFeedCurrent;
    delete root.dataset.snFeedSubject;
  };
};
