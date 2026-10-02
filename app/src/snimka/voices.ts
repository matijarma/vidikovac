// The three voices beside the map, each the latest thing said at or before
// the replay instant: ZET's notice (kept until the next one), the curated
// headline (three hours of life, then the card says there is none) and the
// event marker (one hour). Pure functions over the dataset's lists, sorted
// here once per call so the order of the files never matters.
import type { FactKey, Focus, Mentions, NewsFile, NoticesFile, SeriesFile, SnimkaEvent, VoiceFile } from '../../../shared/snimka';
import type { SeriesLike, Subject, TimelineMarker } from './contracts';
import { runsOf, stateClass, type StateClass } from './strip';
import { SN } from './strings';
import { factFamily, leadFact, voiceSentence } from './voice-data';

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

// ---- the feed (v2, plan section 3.4) -------------------------------------------------
//
// Every voice of the recording as one time-ordered list: ZET's notices, the
// court, the press, the chapters and markers, and the companion itself. Pure:
// the feed (voices-feed.ts) builds the list once and asks what is visible at
// the clock; the timeline (V3) draws feedMarkers(); the state band is here
// because it is the same reading of the series the chips make.

export type VoiceKind = 'zet' | 'court' | 'press' | 'event' | 'companion';

export interface VoiceItem {
  id: string;
  atSec: number;
  kind: VoiceKind;
  /** Verbatim: a headline, a notice, an event's title, the companion's sentence. */
  title: string;
  text: string | null;
  /** The title's own link (a headline, a notice), opened outside the page. */
  link: string | null;
  /** The source line: an outlet with its home, ZET's notice, an event's first source. */
  source: { label: string; url: string | null } | null;
  focus: Focus;
  facts: FactKey[];
  mentions: Mentions;
  beat: string | null;
  /** Set by foldPress on the first headline of a beat: the later ones of the same three hours. */
  folded?: VoiceItem[];
}

const byTime = (a: VoiceItem, b: VoiceItem): number => a.atSec - b.atSec || a.id.localeCompare(b.id);
const sameWords = (a: string, b: string): boolean => a.trim().toLocaleLowerCase('hr') === b.trim().toLocaleLowerCase('hr');
/** An event that repeats a notice's title within this long is the notice's own chapter: the notice speaks once. */
export const DUPLICATE_WITHIN_S = 3600;

/** The feed's items from the context's lists (and the companion's own voices), sorted by time. */
export function buildVoices(
  files: { notices: Pick<NoticesFile, 'items'>; news: Pick<NewsFile, 'items' | 'outlets'>; events: readonly SnimkaEvent[] },
  companion: readonly VoiceItem[] = [],
): VoiceItem[] {
  const out: VoiceItem[] = [];
  for (const n of files.notices.items) {
    out.push({
      id: `notice:${n.id}`, atSec: n.pubSec, kind: 'zet', title: n.title, text: n.text, link: n.link,
      source: { label: SN.voices.kind.zet, url: n.link }, focus: n.focus, facts: n.facts, mentions: n.mentions, beat: null,
    });
  }
  for (const a of files.news.items) {
    const outlet = files.news.outlets[a.outlet];
    out.push({
      id: `news:${a.id}`, atSec: a.pubSec, kind: 'press', title: a.title, text: null, link: a.link,
      source: { label: outlet?.name ?? a.outlet, url: outlet?.home ?? null }, focus: a.focus, facts: a.facts, mentions: a.mentions, beat: a.beat,
    });
  }
  for (const e of files.events) {
    const duplicate = files.notices.items.some((n) => Math.abs(n.pubSec - e.atSec) <= DUPLICATE_WITHIN_S && sameWords(n.title, e.title));
    if (duplicate) continue;
    const first = e.sources[0];
    out.push({
      id: `event:${e.id}`, atSec: e.atSec, kind: e.kind === 'court' ? 'court' : 'event', title: e.title, text: e.text, link: null,
      source: first ? { label: first.label, url: first.url } : null, focus: e.focus, facts: e.facts, mentions: e.mentions, beat: null,
    });
  }
  out.push(...companion);
  return out.sort(byTime);
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
 *  fold under it (item.folded). Headlines without a beat, and every other kind, pass as they are. A new list; the
 *  input is not changed. */
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

export interface VoicesAt {
  /** Newest first, at most maxVisible. */
  visible: VoiceItem[];
  /** The rest at or before the instant, newest first ("Starije"). */
  older: VoiceItem[];
  /** Items at or before the instant that the subject left out. */
  hiddenCount: number;
  olderCount: number;
}

/** What the feed shows at `atSec`: the items at or before it (a folded headline counts once, as its head), the
 *  subject's filter applied, newest first, cut at maxVisible. */
export function voicesUpTo(items: readonly VoiceItem[], atSec: number, o: { subject?: Subject | null; maxVisible?: number } = {}): VoicesAt {
  const max = o.maxVisible ?? 14;
  const shown: VoiceItem[] = [];
  let hiddenCount = 0;
  for (const item of items) {
    if (item.atSec > atSec) continue;
    if (o.subject && !mentionsSubject(item, o.subject)) { hiddenCount += 1; continue; }
    shown.push(item);
  }
  shown.sort((a, b) => byTime(b, a));
  const visible = shown.slice(0, max);
  const older = shown.slice(max);
  return { visible, older, hiddenCount, olderCount: older.length };
}

/** The folded headlines of an item published at or before the instant. */
export function foldedUpTo(item: VoiceItem, atSec: number): VoiceItem[] {
  return (item.folded ?? []).filter((f) => f.atSec <= atSec);
}

// ---- the companion's own voice -----------------------------------------------------------

/** A family of the lead fact must have been silent this long to be news. */
export const COMPANION_QUIET_S = 2 * 3600;
/** At most one companion voice per replay hour. */
export const COMPANION_GAP_S = 3600;

/** The moments the companion's voice changed its subject: the lead fact's family (its kind, a departure split by its
 *  wording) changes to one not heard for two hours, at most one per replay hour. Minutes in time order over the
 *  given day files (any order, gaps allowed). */
export function companionVoices(days: readonly VoiceFile[], o: { quietS?: number; gapS?: number } = {}): VoiceItem[] {
  const quiet = o.quietS ?? COMPANION_QUIET_S;
  const gap = o.gapS ?? COMPANION_GAP_S;
  const out: VoiceItem[] = [];
  const heard = new Map<string, number>();
  let previous: string | null = null;
  let lastOut = -Infinity;
  for (const file of [...days].sort((a, b) => a.t0 - b.t0)) {
    for (const minute of file.minutes) {
      if (!minute) continue;
      const fact = leadFact(file, minute);
      const sentence = voiceSentence(file, minute);
      if (!fact || !sentence) continue;
      const family = factFamily(fact);
      const last = heard.get(family);
      const isNew = family !== previous && (last === undefined || minute.at - last >= quiet);
      if (isNew && minute.at - lastOut >= gap) {
        out.push({
          id: `companion:${minute.at}`, atSec: minute.at, kind: 'companion', title: sentence, text: null, link: null, source: null,
          focus: { kind: 'none' }, facts: ['seen', 'expected', 'state'], mentions: {}, beat: null,
        });
        lastOut = minute.at;
      }
      heard.set(family, minute.at);
      previous = family;
    }
  }
  return out;
}

// ---- the timeline's lanes and the state band ----------------------------------------------

/** The tick lanes of the timeline: chapters; ZET's notices, the court and ZET's own markers; the press, thinned to the
 *  first headline of each beat. The companion has no lane (the feed is its accessible form). */
export function feedMarkers(items: readonly VoiceItem[], events: readonly Pick<SnimkaEvent, 'id' | 'chapter' | 'kind'>[] = []): TimelineMarker[] {
  const chapters = new Set(events.filter((e) => e.chapter).map((e) => `event:${e.id}`));
  const zetEvents = new Set(events.filter((e) => !e.chapter && e.kind === 'zet').map((e) => `event:${e.id}`));
  const beats = new Set<string>();
  const out: TimelineMarker[] = [];
  for (const item of [...items].sort(byTime)) {
    if (item.kind === 'press') {
      if (item.beat !== null) {
        if (beats.has(item.beat)) continue;
        beats.add(item.beat);
      }
      out.push({ atSec: item.atSec, lane: 'press', id: item.id, title: item.title });
    } else if (item.kind === 'zet' || item.kind === 'court' || zetEvents.has(item.id)) {
      out.push({ atSec: item.atSec, lane: 'notice', id: item.id, title: item.title });
    } else if (item.kind === 'event' && (chapters.size === 0 || chapters.has(item.id))) {
      out.push({ atSec: item.atSec, lane: 'chapter', id: item.id, title: item.title });
    }
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
