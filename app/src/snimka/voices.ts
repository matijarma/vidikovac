// The three voices beside the map, each the latest thing said at or before
// the replay instant: ZET's notice (kept until the next one), the curated
// headline (three hours of life, then the card says there is none) and the
// event marker (one hour). Pure functions over the dataset's lists, sorted
// here once per call so the order of the files never matters.
import type { FactKey, Focus, Mentions, NewsFile, NoticesFile, SeriesFile, SnimkaEvent } from '../../../shared/snimka';
import type { SeriesLike, Subject, TimelineMarker } from './contracts';
import { runsOf, stateClass, type StateClass } from './strip';
import { SN } from './strings';

export type NewsItem = NewsFile['items'][number];
export type Notice = NoticesFile['items'][number];

/** A headline is current for three hours after it was published. */
export const ARTICLE_WINDOW_S = 3 * 3600;
/** An event is the "Događaj" card for an hour. */
export const MARKER_WINDOW_S = 3600;

/** The latest item published at or before `atSec`, or null. */
function latestBefore<T>(items: readonly T[], atSec: number, time: (item: T) => number, windowSec = Infinity): T | null {
  let best: T | null = null;
  let bestAt = -Infinity;
  for (const item of items) {
    const t = time(item);
    if (!Number.isFinite(t) || t > atSec || t < atSec - windowSec) continue;
    if (t > bestAt) { best = item; bestAt = t; }
  }
  return best;
}

/** The curated headline to show: the latest within `windowSec` before the instant, with its outlet's name. */
export function currentArticle(news: Pick<NewsFile, 'items' | 'outlets'>, atSec: number, windowSec = ARTICLE_WINDOW_S): { item: NewsItem; outlet: string } | null {
  const item = latestBefore(news.items, atSec, (i) => i.pubSec, windowSec);
  if (!item) return null;
  return { item, outlet: news.outlets[item.outlet]?.name ?? item.outlet };
}

/** ZET's latest notice at or before the instant; a notice stays until the next one. */
export function currentNotice(notices: Pick<NoticesFile, 'items'>, atSec: number): Notice | null {
  return latestBefore(notices.items, atSec, (i) => i.pubSec);
}

/** The latest event within `windowSec` before the instant (chapters and plain events alike). */
export function currentMarker(events: readonly SnimkaEvent[], atSec: number, windowSec = MARKER_WINDOW_S): SnimkaEvent | null {
  return latestBefore(events, atSec, (e) => e.atSec, windowSec);
}

// ---- the feed: Objave (v3, decision V3-16) ---------------------------------------------
//
// What ZET, the court and the press said, and the recording's chapters, as one
// time-ordered list. The app's own sentences are not here (the subtitle is the
// app's voice), nor the recording-internal events (the dossier tells those), nor
// the plain readings of the service (a state the app computed is not an
// announcement). An event that repeats a ZET notice speaks once: a chapter keeps
// its heading and takes the notice's link, any other event gives way to the
// notice. The feed (voices-feed.ts) shows the latest item as the current one over
// a compact log; the timeline draws feedMarkers() as one row.

export type VoiceKind = 'zet' | 'court' | 'press' | 'chapter';

export interface VoiceItem {
  id: string;
  atSec: number;
  kind: VoiceKind;
  /** Verbatim: a headline, a notice, an event's title. */
  title: string;
  text: string | null;
  /** The title's own link (a headline, a notice), opened outside the page. */
  link: string | null;
  /** Who said it: an outlet with its home for a headline, ZET for a notice, an event's first source. */
  source: { label: string; url: string | null } | null;
  focus: Focus;
  facts: FactKey[];
  mentions: Mentions;
  beat: string | null;
  /** The tone of the row's mark: ZET (transit) or the court; null for the press and the plain chapters. */
  tone: 'zet' | 'court' | null;
  /** Set by foldPress on the first headline of a beat: the later ones of the same three hours. */
  folded?: VoiceItem[];
}

const byTime = (a: VoiceItem, b: VoiceItem): number => a.atSec - b.atSec || a.id.localeCompare(b.id);
const sameWords = (a: string, b: string): boolean => a.trim().toLocaleLowerCase('hr') === b.trim().toLocaleLowerCase('hr');
/** An event without a noticeId repeats a notice when it falls this close to it and says the same words or links it. */
export const DUPLICATE_WITHIN_S = 3600;

/** The ZET notice an event repeats: by its noticeId, else within an hour with the same title or the notice's link among
 *  the event's sources; null when it repeats none. */
export function repeatedNotice(e: Pick<SnimkaEvent, 'atSec' | 'title' | 'sources' | 'noticeId'>, notices: readonly Notice[]): Notice | null {
  if (e.noticeId !== undefined) return notices.find((n) => n.id === e.noticeId) ?? null;
  return notices.find((n) => Math.abs(n.pubSec - e.atSec) <= DUPLICATE_WITHIN_S
    && (sameWords(n.title, e.title) || (n.link !== null && e.sources.some((s) => s.url === n.link)))) ?? null;
}

/** Whether an event belongs in Objave: never a recording-internal one; a chapter always; otherwise only what ZET or the
 *  court said (a plain reading of the service is the app's own and stays out). */
export function speaksInFeed(e: Pick<SnimkaEvent, 'chapter' | 'kind' | 'internal'>): boolean {
  if (e.internal) return false;
  return e.chapter || e.kind === 'zet' || e.kind === 'court';
}

/** The feed's items from the context's lists, sorted by time. */
export function buildVoices(files: { notices: Pick<NoticesFile, 'items'>; news: Pick<NewsFile, 'items' | 'outlets'>; events: readonly SnimkaEvent[] }): VoiceItem[] {
  const out: VoiceItem[] = [];
  const absorbed = new Set<number>();
  const chapters: { item: VoiceItem; notice: Notice }[] = [];
  for (const e of files.events) {
    if (!speaksInFeed(e)) continue;
    const notice = repeatedNotice(e, files.notices.items);
    if (notice && !e.chapter) continue;
    const first = e.sources[0];
    const item: VoiceItem = {
      id: `event:${e.id}`, atSec: e.atSec, kind: e.chapter ? 'chapter' : e.kind === 'court' ? 'court' : 'zet', title: e.title, text: e.text, link: null,
      source: first ? { label: first.label, url: first.url } : null, focus: e.focus, facts: e.facts, mentions: e.mentions, beat: null,
      tone: e.kind === 'court' ? 'court' : e.kind === 'zet' ? 'zet' : null,
    };
    if (notice) { absorbed.add(notice.id); chapters.push({ item, notice }); }
    out.push(item);
  }
  // A chapter that repeats a notice keeps its heading and carries the notice's link and words.
  for (const { item, notice } of chapters) {
    item.link = notice.link;
    item.text = item.text ?? notice.text;
    item.tone = 'zet';
  }
  for (const n of files.notices.items) {
    if (absorbed.has(n.id)) continue;
    out.push({
      id: `notice:${n.id}`, atSec: n.pubSec, kind: 'zet', title: n.title, text: n.text, link: n.link,
      source: { label: SN.voices.kind.zet, url: n.link }, focus: n.focus, facts: n.facts, mentions: n.mentions, beat: null, tone: 'zet',
    });
  }
  for (const a of files.news.items) {
    const outlet = files.news.outlets[a.outlet];
    out.push({
      id: `news:${a.id}`, atSec: a.pubSec, kind: 'press', title: a.title, text: null, link: a.link,
      source: { label: outlet?.name ?? a.outlet, url: outlet?.home ?? null }, focus: a.focus, facts: a.facts, mentions: a.mentions, beat: a.beat, tone: null,
    });
  }
  return out.sort(byTime);
}

/** The row's kicker: the outlet of a headline, "ZET", "Sud", "Poglavlje". */
export function kickerOf(item: Pick<VoiceItem, 'kind' | 'source'>): string {
  if (item.kind === 'press') return item.source?.label ?? SN.voices.kind.press;
  return SN.voices.kind[item.kind];
}

/** At most two chips, and only on what ZET, the court or a chapter said (a headline's chips were noise, R3). */
export const MAX_CHIPS = 2;
export function chipKeys(item: Pick<VoiceItem, 'kind' | 'facts'>): FactKey[] {
  return item.kind === 'press' ? [] : item.facts.slice(0, MAX_CHIPS);
}

/** The subject an item points at (a line, a station, a stop), or null for the city, a place, a layer or nothing. */
export function focusSubject(item: Pick<VoiceItem, 'focus'>): Subject | null {
  const f = item.focus;
  return f.kind === 'route' || f.kind === 'station' || f.kind === 'stop' ? { kind: f.kind, id: f.id } : null;
}

/** Whether an item speaks of the subject: its focus is the subject, or its mentions name it. */
export function mentionsSubject(item: Pick<VoiceItem, 'focus' | 'mentions'>, subject: Subject): boolean {
  const f = item.focus;
  if ((f.kind === 'route' || f.kind === 'station' || f.kind === 'stop') && f.kind === subject.kind && f.id === subject.id) return true;
  if (subject.kind === 'route') return item.mentions.routes?.includes(subject.id) ?? false;
  if (subject.kind === 'station') return item.mentions.stations?.includes(subject.id) ?? false;
  return false;
}

/** One headline per beat per three hours stays in the feed; the later ones of the same beat within three hours of it
 *  fold under it (item.folded, read "+2 slična naslova"). Headlines without a beat, and every other kind, pass as they
 *  are. A new list; the input is not changed. */
export function foldPress(items: readonly VoiceItem[], windowS = ARTICLE_WINDOW_S): VoiceItem[] {
  const out: VoiceItem[] = [];
  const heads = new Map<string, VoiceItem>();
  for (const item of [...items].sort(byTime)) {
    if (item.kind !== 'press' || item.beat === null) { out.push(item); continue; }
    const head = heads.get(item.beat);
    if (head && item.atSec < head.atSec + windowS) { head.folded!.push(item); continue; }
    const copy: VoiceItem = { ...item, folded: [] };
    heads.set(item.beat, copy);
    out.push(copy);
  }
  return out;
}

export interface FeedAt {
  /** The latest item at or before the instant that the subject keeps: the one on top. */
  current: VoiceItem | null;
  /** Every other such item, newest first: the log. */
  log: VoiceItem[];
  /** Items at or before the instant that the subject left out. */
  hiddenCount: number;
  /** current + log. */
  count: number;
}

/** What Objave shows at `atSec`: the items at or before it (a folded headline counts once, as its head), the subject's
 *  filter applied; the newest is the current item, the rest the log, newest first. No cap: the log scrolls. */
export function feedAt(items: readonly VoiceItem[], atSec: number, subject: Subject | null = null): FeedAt {
  const shown: VoiceItem[] = [];
  let hiddenCount = 0;
  for (const item of items) {
    if (item.atSec > atSec) continue;
    if (subject && !mentionsSubject(item, subject)) { hiddenCount += 1; continue; }
    shown.push(item);
  }
  shown.sort((a, b) => byTime(b, a));
  const [current = null, ...log] = shown;
  return { current, log, hiddenCount, count: shown.length };
}

/** The folded headlines of an item published at or before the instant. */
export function foldedUpTo(item: VoiceItem, atSec: number): VoiceItem[] {
  return (item.folded ?? []).filter((f) => f.atSec <= atSec);
}

// ---- the timeline's marker row and the state tint ------------------------------------------

/** The timeline's one marker row: the chapters as numbered pins and what ZET and the court said as dots. The press has no
 *  marks (73 unthinned ticks said nothing, R3); the feed is the row's accessible form. */
export function feedMarkers(items: readonly VoiceItem[]): TimelineMarker[] {
  const out: TimelineMarker[] = [];
  for (const item of [...items].sort(byTime)) {
    if (item.kind === 'chapter') out.push({ atSec: item.atSec, lane: 'chapter', id: item.id, title: item.title });
    else if (item.kind === 'zet' || item.kind === 'court') out.push({ atSec: item.atSec, lane: 'notice', id: item.id, title: item.title });
  }
  return out;
}

export interface StateBandRun { from: number; to: number; cls: StateClass; since: number | null }

/** The service state as runs over the series (epoch seconds, [from, to)), each with the machine's `since` at its first
 *  minute; "none" where the machine held its judgement or had no minute. */
export function stateBand(series: SeriesLike): StateBandRun[] {
  const s = series as SeriesFile;
  return runsOf(series.n, (m) => stateClass(s, m)).map((run) => ({
    from: series.t0 + run.from * series.step,
    to: series.t0 + run.to * series.step,
    cls: run.cls,
    since: series.service.since[run.from] ?? null,
  }));
}
