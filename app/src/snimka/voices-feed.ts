// The voices feed (plan section 3.4): ZET, the court, the press, the chapters
// and the companion itself in one time-ordered panel, newest on top, filling
// as the clock passes. Each item is built once with the chips of its own
// minute; passive play adds new items at most every 400 ms of wall time
// (several due at once arrive together) and slides them in only without
// reduced motion; a seek redraws at once without motion. The press is folded
// one headline per beat per three hours; fourteen items show, the rest wait
// under "Starije". A click on an item pauses the replay, moves it to the
// item's minute and, when the item points at a line, a station or a stop,
// makes that the subject; the feed then shows only what speaks of it, says
// how many items it left out and offers "Sve teme".
import type { Subject } from './contracts';
import type { SnimkaContext } from './context';
import { chipsLabel, factChips, onStationData, stationData, type FactChip } from './facts';
import { formatZagrebLocal, plural, zagrebDateTime, type Forms } from './format';
import { SN, fill } from './strings';
import { voiceData } from './voice-data';
import { buildVoices, companionVoices, focusSubject, foldPress, foldedUpTo, voicesUpTo, type VoiceItem } from './voices';
import type { MountPanel } from './contracts';

export const FEED_MAX_VISIBLE = 14;
/** Passive play adds new items at most this often (wall milliseconds). */
export const FEED_CADENCE_MS = 400;

// New for the read-through (Appendix B has the plural form only; Croatian needs the singular and the paucal):
export const FEED_COPY = {
  hidden: ['{count} stavka bez te teme', '{count} stavke bez te teme', SN.voices.hidden] as Forms,
  more: ['{count} naslov iste teme', SN.voices.more, SN.voices.more] as Forms,
} as const;

/** The subject's name in the feed's header: "Linija 228", "Stanica Trg žrtava fašizma", "Stajalište Glavni kolodvor". */
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
const KIND_WORD = SN.voices.kind;
const BEAT_WORD = SN.voices.beat as Record<string, string | undefined>;

export const mountVoicesFeed: MountPanel = (ctx, root) => {
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
  const header = el('header', 'sn-feed-head');
  const heading = el('h3', 'sn-feed-title', V.title);
  heading.id = headingId;
  const lede = el('p', 'sn-feed-lede', V.lede);
  const filter = el('p', 'sn-feed-filter');
  filter.hidden = true;
  const filterText = el('span', 'sn-feed-filter-text');
  const hiddenText = el('span', 'sn-feed-hidden');
  const clear = el('button', 'sn-feed-clear', V.clear);
  clear.type = 'button';
  clear.dataset.sn = 'feed-clear';
  clear.addEventListener('click', () => ctx.view.set({ subject: null }, 'feed'));
  filter.append(filterText, ' ', hiddenText, ' ', clear);
  header.append(heading, lede, filter);
  const empty = el('p', 'sn-feed-empty', V.empty);
  const list = el('ol', 'sn-feed-list');
  const older = el('details', 'sn-feed-older');
  const olderSummary = el('summary', 'sn-feed-older-summary');
  const olderList = el('ol', 'sn-feed-list sn-feed-older-list');
  older.append(olderSummary, olderList);
  older.hidden = true;
  panel.append(header, empty, list, older);
  root.replaceChildren(panel);
  root.dataset.snFeedCount = '0';
  root.dataset.snFeedSubject = '';

  // ---- the items ------------------------------------------------------------------------------
  const base = buildVoices(ctx);
  let items: VoiceItem[] = foldPress(base);
  let times: number[] = items.map((i) => i.atSec);
  const byId = new Map<string, VoiceItem>();
  const indexItems = (): void => {
    byId.clear();
    for (const i of items) byId.set(i.id, i);
  };
  indexItems();

  interface Node { li: HTMLLIElement; chips: HTMLElement | null; fold: HTMLDetailsElement | null; foldSummary: HTMLElement | null; foldList: HTMLUListElement | null; foldShown: number; pending: boolean }
  const nodes = new Map<string, Node>();

  const chipsHtml = (host: HTMLElement, chips: FactChip[]): void => {
    host.replaceChildren(...chips.map((c) => {
      const chip = el('span', 'sn-fact-chip', c.text);
      if (c.missing) chip.dataset.missing = 'true';
      if (c.retro) {
        chip.dataset.retro = 'true';
        const tag = el('span', 'sn-fact-retro', SN.badge.retroShort);
        chip.append(' ', tag);
      }
      return chip;
    }));
  };

  const seekTo = (item: VoiceItem): void => {
    ctx.clock.pause();
    ctx.clock.seek(item.atSec * 1000);
    const subject = focusSubject(item);
    if (subject) ctx.view.set({ subject }, 'feed');
  };

  const linkTo = (href: string, text: string): HTMLAnchorElement => {
    const a = el('a', 'sn-feed-link', text);
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.append(el('span', 'visually-hidden', ` ${SN.news.newTab}`));
    return a;
  };

  const build = (item: VoiceItem): Node => {
    const li = el('li', `sn-feed-item sn-feed-tone-${item.kind}`);
    li.dataset.kind = item.kind;
    li.dataset.id = item.id;
    li.dataset.at = String(item.atSec);
    const when = zagrebDateTime(item.atSec * 1000);
    const meta = el('p', 'sn-feed-meta');
    meta.append(el('span', 'sn-feed-kind', KIND_WORD[item.kind]));
    const beat = item.beat ? BEAT_WORD[item.beat] : undefined;
    if (beat) meta.append(' ', el('span', 'sn-feed-beat', beat));
    const seek = el('button', 'sn-feed-seek');
    seek.type = 'button';
    seek.setAttribute('aria-label', fill(V.seek, { time: when }));
    const time = el('time', 'sn-feed-time', when);
    time.dateTime = `${formatZagrebLocal(item.atSec * 1000)}+02:00`;
    seek.append(time);
    seek.addEventListener('click', (e) => { e.stopPropagation(); seekTo(item); });
    meta.append(' ', seek);
    const title = el('p', 'sn-feed-headline');
    if (item.link) title.append(linkTo(item.link, item.title));
    else title.textContent = item.title;
    li.append(meta, title);
    if (item.text) li.append(el('p', 'sn-feed-text', item.text));
    // The source line: the outlet of a headline, ZET for a notice (its title is the link), an event's first source as a
    // link, and for the companion the mark of the retroactive voice (S-15).
    const line = el('p', 'sn-feed-source');
    if (item.kind === 'companion') line.textContent = SN.subtitle.markReplayed;
    else if (item.kind === 'zet') line.textContent = SN.zet.source;
    else if (item.kind === 'press') line.textContent = item.source?.label ?? '';
    else if (item.source?.url) line.append(linkTo(item.source.url, item.source.label));
    if (line.textContent) li.append(line);
    let chips: HTMLElement | null = null;
    let pending = false;
    if (item.facts.length) {
      const values = factChips(item.facts, ctx, item.atSec, { atPublish: item.kind === 'press' });
      if (values.length) {
        chips = el('p', 'sn-feed-chips');
        chips.setAttribute('aria-label', chipsLabel({ atPublish: item.kind === 'press' }));
        chipsHtml(chips, values);
        pending = values.some((c) => c.pending);
        li.append(chips);
      }
    }
    let fold: HTMLDetailsElement | null = null;
    let foldSummary: HTMLElement | null = null;
    let foldList: HTMLUListElement | null = null;
    if (item.folded?.length) {
      fold = el('details', 'sn-feed-fold');
      foldSummary = el('summary', 'sn-feed-fold-summary');
      foldList = el('ul', 'sn-feed-fold-list');
      fold.append(foldSummary, foldList);
      fold.hidden = true;
      li.append(fold);
    }
    // The whole item is a target for the pointer; the time button is its keyboard form. Links and the fold keep theirs.
    li.addEventListener('click', (e) => {
      const target = e.target as Element | null;
      if (target?.closest('a, summary, details, button')) return;
      seekTo(item);
    });
    return { li, chips, fold, foldSummary, foldList, foldShown: -1, pending };
  };

  const nodeOf = (item: VoiceItem): Node => {
    let node = nodes.get(item.id);
    if (!node) {
      node = build(item);
      nodes.set(item.id, node);
    }
    return node;
  };

  const updateFold = (item: VoiceItem, node: Node, atSec: number): void => {
    if (!node.fold) return;
    const shown = foldedUpTo(item, atSec);
    if (shown.length === node.foldShown) return;
    node.foldShown = shown.length;
    node.fold.hidden = shown.length === 0;
    node.foldSummary!.textContent = fill(plural(shown.length, FEED_COPY.more), { count: `+${shown.length}` });
    node.foldList!.replaceChildren(...shown.map((f) => {
      const li = el('li', 'sn-feed-fold-item');
      li.append(linkTo(f.link ?? '#', f.title), ' ', el('span', 'sn-feed-fold-meta', `${f.source?.label ?? ''}, ${zagrebDateTime(f.atSec * 1000)}`.replace(/^, /, '')));
      return li;
    }));
  };

  /** Puts `wanted` into `host` in order, moving only what is out of place (moving a node restarts its animation). */
  const place = (host: HTMLElement, wanted: readonly HTMLElement[]): void => {
    wanted.forEach((node, i) => {
      if (host.children[i] !== node) host.insertBefore(node, host.children[i] ?? null);
    });
    while (host.children.length > wanted.length) host.lastElementChild!.remove();
  };

  // ---- rendering ----------------------------------------------------------------------------------
  let shownCount = -1;
  let shownSubject = '\u0000';
  let shownItems: VoiceItem[] = items;
  let lastRender = -Infinity;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let jumped = true;
  let destroyed = false;
  const wall = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  const render = (atSec: number): void => {
    const subject = ctx.view.get().subject;
    const key = subjectKey(subject);
    const at = voicesUpTo(items, atSec, { subject, maxVisible: FEED_MAX_VISIBLE });
    const animate = !jumped && !ctx.reducedMotion && shownCount >= 0;
    const wanted = at.visible.map((item) => {
      const isNew = !list.contains(nodes.get(item.id)?.li ?? null);
      const node = nodeOf(item);
      updateFold(item, node, atSec);
      if (isNew && animate) {
        node.li.classList.add('sn-feed-in');
        node.li.addEventListener('animationend', () => node.li.classList.remove('sn-feed-in'), { once: true });
      } else if (!animate) node.li.classList.remove('sn-feed-in');
      return node.li;
    });
    place(list, wanted);
    older.hidden = at.olderCount === 0;
    olderSummary.textContent = `${V.older} (${at.olderCount})`;
    if (older.open) place(olderList, at.older.map((item) => { const node = nodeOf(item); updateFold(item, node, atSec); return node.li; }));
    else olderList.replaceChildren();
    empty.hidden = at.visible.length > 0;
    filter.hidden = subject === null;
    if (subject) {
      filterText.textContent = fill(V.filtered, { subject: subjectLabel(ctx, subject) });
      hiddenText.textContent = at.hiddenCount ? fill(plural(at.hiddenCount, FEED_COPY.hidden), { count: at.hiddenCount }) : '';
    }
    root.dataset.snFeedCount = String(at.visible.length + at.olderCount);
    root.dataset.snFeedSubject = key;
    shownCount = spokenBy(times, atSec);
    shownSubject = key;
    shownItems = items;
    lastRender = wall();
    jumped = false;
  };

  const tick = (t: number): void => {
    if (destroyed) return;
    const atSec = Math.floor(t / 1000);
    const count = spokenBy(times, atSec);
    const key = subjectKey(ctx.view.get().subject);
    if (count === shownCount && key === shownSubject && items === shownItems && !jumped) return;
    // A forward step of passive play waits for the cadence; anything else (a seek, the subject, new data) draws now.
    const passive = !jumped && key === shownSubject && items === shownItems && count > shownCount;
    if (passive && wall() - lastRender < FEED_CADENCE_MS) {
      if (timer === null) {
        timer = setTimeout(() => {
          timer = null;
          if (!destroyed) render(Math.floor(ctx.clock.now() / 1000));
        }, FEED_CADENCE_MS - (wall() - lastRender));
      }
      return;
    }
    if (timer !== null) { clearTimeout(timer); timer = null; }
    render(atSec);
  };

  older.addEventListener('toggle', () => render(Math.floor(ctx.clock.now() / 1000)));

  // ---- the companion's voices, as the voice days arrive ----------------------------------------------
  const voice = voiceData(ctx);
  let companionCount = 0;
  const offVoice = voice.onLoad(() => {
    const index = voice.index();
    if (index) {
      // Every day up to the clock's, one at a time, so the older companion voices are there too.
      const nowSec = Math.floor(ctx.clock.now() / 1000);
      const due = index.days.find((d) => d.t0 <= nowSec && voice.file(d.day) === undefined);
      if (due) void voice.load(due.day);
    }
    const companion = companionVoices(voice.loaded());
    if (companion.length === companionCount) return;
    companionCount = companion.length;
    for (const id of [...nodes.keys()]) if (id.startsWith('companion:')) nodes.delete(id);
    items = foldPress(buildVoices(ctx, companion));
    times = items.map((i) => i.atSec);
    indexItems();
    tick(ctx.clock.now());
  });
  void voice.loadIndex();

  // A station chip drawn before the stations arrived is drawn once more.
  const offStations = onStationData(ctx, () => {
    for (const [id, node] of nodes) {
      if (!node.pending || !node.chips) continue;
      const item = byId.get(id);
      if (!item) continue;
      const values = factChips(item.facts, ctx, item.atSec, { atPublish: item.kind === 'press' });
      chipsHtml(node.chips, values);
      node.pending = values.some((c) => c.pending);
    }
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
    offVoice();
    offStations();
    delete root.dataset.snFeedCount;
    delete root.dataset.snFeedSubject;
  };
};
