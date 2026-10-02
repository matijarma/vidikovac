// Stage `news` (lane S1): the RSS of Jutarnji list, Večernji list and N1 as
// recorded on every change from Sunday 27 September (strike/context/<outlet>/),
// distinct by link, through the pure filter (news-filter.ts). Writes the
// candidates for the owner's read-through (work/news-candidates.json), the
// relevant press items per Zagreb hour for the strip (work/news-pulse.json),
// and the published headline list from the committed curation
// (scripts/snimka/news-curated.json): titles verbatim as first recorded, the
// link and the time, never the article text. A curated link that the
// recordings do not hold fails the stage (acceptance SN-5).

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { XMLParser } from 'fast-xml-parser';
import { SNIMKA_WINDOW, ZAGREB_OFFSET_S, type HashedRef, type NewsFile } from '../../shared/snimka';
import { filterNews, zagrebHour, type Candidate, type NewsItem, type Outlet } from './news-filter';
import { stampSec } from './stage-bajs';
import { readWork, writeJsonObject, writeWork, type Paths } from './paths';
import { beatDefaults, resolvePointers, withDefaults, type Known, type Pointers } from './focus-defaults';

export const OUTLETS: NewsFile['outlets'] = {
  jutarnji: { name: 'Jutarnji list', home: 'https://www.jutarnji.hr/' },
  vecernji: { name: 'Večernji list', home: 'https://www.vecernji.hr/' },
  n1: { name: 'N1', home: 'https://n1info.hr/' },
};

export interface RssItem { title: string; link: string; pubSec: number | null; categories: string[]; description: string }

const parser = new XMLParser({ ignoreAttributes: true, processEntities: true, htmlEntities: true, trimValues: true, isArray: (name) => name === 'item' || name === 'category', parseTagValue: false });

const text = (x: unknown): string => {
  if (typeof x === 'string') return x;
  if (typeof x === 'number') return String(x);
  if (x && typeof x === 'object' && '#text' in (x as Record<string, unknown>)) return String((x as Record<string, unknown>)['#text']);
  return '';
};

/** The items of one RSS 2.0 document. */
export function parseRss(xml: string): RssItem[] {
  const doc = parser.parse(xml) as { rss?: { channel?: { item?: Record<string, unknown>[] } } };
  const items = doc.rss?.channel?.item ?? [];
  return items.map((item) => {
    const pub = text(item['pubDate']);
    const ms = pub ? Date.parse(pub) : NaN;
    return {
      title: text(item['title']).replace(/\s+/g, ' ').trim(),
      link: text(item['link']).trim(),
      pubSec: Number.isFinite(ms) ? Math.floor(ms / 1000) : null,
      categories: ((item['category'] as unknown[]) ?? []).map(text).filter(Boolean),
      description: text(item['description']),
    };
  });
}

export interface CuratedEntry extends Partial<Pick<Pointers, 'focus' | 'facts' | 'mentions'>> { link: string; beat?: string | null; title?: string; outlet?: Outlet; at?: string; note?: string }
export interface NewsWorkItem { outlet: Outlet; title: string; link: string; pubSec: number; categories: string[]; firstSeenSec: number }
export interface NewsRefs { news: HashedRef; items: number; perOutlet: Record<Outlet, number> }

const DAYS = ['ned', 'pon', 'uto', 'sri', 'čet', 'pet', 'sub'];
export function zagrebLabel(sec: number): string {
  const d = new Date((sec + ZAGREB_OFFSET_S) * 1000);
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()}. ${d.getUTCMonth() + 1}. ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

/** Every distinct item (by link) the three outlets' recorded feeds carried, with its first recorded title. */
export function readPress(paths: Paths, log: (line: string) => void): { items: NewsItem[]; work: NewsWorkItem[] } {
  const byLink = new Map<string, NewsItem & { firstSeenSec: number }>();
  for (const outlet of Object.keys(OUTLETS) as Outlet[]) {
    const dir = join(paths.inputs, 'strike', 'context', outlet);
    for (const name of readdirSync(dir).filter((f) => f.endsWith('.xml')).sort()) {
      const seen = stampSec(name);
      if (seen === null) continue;
      let parsed: RssItem[];
      try {
        parsed = parseRss(readFileSync(join(dir, name), 'utf8'));
      } catch {
        log(`news: ${outlet}/${name} unreadable, skipped`);
        continue;
      }
      for (const item of parsed) {
        if (!item.link || !item.title || byLink.has(item.link)) continue;
        byLink.set(item.link, { outlet, title: item.title, link: item.link, pubSec: item.pubSec ?? seen, categories: item.categories, text: item.description, firstSeenSec: seen });
      }
    }
  }
  const all = [...byLink.values()].sort((a, b) => a.pubSec - b.pubSec || a.link.localeCompare(b.link));
  return {
    items: all.map(({ firstSeenSec: _f, ...rest }) => rest),
    work: all.map(({ text: _t, ...rest }) => rest),
  };
}

/** Stage news: the distinct items, the candidates for curation and the hourly pulse. The published list is built by publishNews from the events stage, once the routes and places it points at exist. */
export async function stageNews(paths: Paths, log: (line: string) => void): Promise<boolean> {
  const { items, work } = readPress(paths, log);
  writeWork(paths, 'news-items.json', work);
  const inWindow = items.filter((i) => i.pubSec >= SNIMKA_WINDOW.fromSec && i.pubSec < SNIMKA_WINDOW.toSec);
  const { pool, candidates } = filterNews(inWindow);
  const hours = SNIMKA_WINDOW.minutes / 60;
  const pulse = new Array<number>(hours).fill(0);
  for (const c of pool) pulse[Math.floor((zagrebHour(c.pubSec) - SNIMKA_WINDOW.fromSec) / 3600)]++;
  writeWork(paths, 'news-pulse.json', { t0: SNIMKA_WINDOW.fromSec, n: hours, pulse });
  const grouped = new Map<number, Candidate[]>();
  for (const c of candidates) grouped.set(zagrebHour(c.pubSec), [...(grouped.get(zagrebHour(c.pubSec)) ?? []), c]);
  writeWork(paths, 'news-candidates.json', {
    note: 'Candidates for the owner\'s read-through: relevant, de-duplicated, beats marked, the hourly cap as `selected`. The page publishes only scripts/snimka/news-curated.json.',
    window: { distinct: inWindow.length, perOutlet: countBy(inWindow), pool: pool.length, selected: candidates.filter((c) => c.selected).length },
    hours: [...grouped].map(([hour, list]) => ({
      hour: zagrebLabel(hour),
      items: list.map((c) => ({ at: zagrebLabel(c.pubSec), outlet: c.outlet, title: c.title, link: c.link, beat: c.beat, score: c.score, first: c.firstOfBeat, selected: c.selected, merged: c.merged.length })),
    })),
  });
  log(`news: ${items.length} distinct items recorded, ${inWindow.length} in the window (${JSON.stringify(countBy(inWindow))}), ${pool.length} relevant after de-duplication, ${candidates.filter((c) => c.selected).length} under the hourly cap`);
  return true;
}

/** The published headline list from the committed curation, every pointer resolved against `known`. */
export function publishNews(paths: Paths, known: Known, log: (line: string) => void): NewsRefs {
  const items = readWork<NewsWorkItem[]>(paths, 'news-items.json');

  const curatedFile = join(paths.repo, 'scripts/snimka/news-curated.json');
  if (!existsSync(curatedFile)) throw new Error('news: scripts/snimka/news-curated.json is missing; curate from work/news-candidates.json');
  const curated = JSON.parse(readFileSync(curatedFile, 'utf8')) as { items: CuratedEntry[] };
  const byLink = new Map(items.map((i) => [i.link, i] as const));
  const missing = curated.items.filter((c) => !byLink.has(c.link));
  if (missing.length > 0) throw new Error(`news: ${missing.length} curated link(s) not in the recordings: ${missing.map((m) => m.link).join(', ')}`);
  const seenLinks = new Set<string>();
  const out: NewsFile = { v: 2, outlets: OUTLETS, items: [] };
  for (const entry of curated.items) {
    if (seenLinks.has(entry.link)) throw new Error(`news: curated link listed twice: ${entry.link}`);
    seenLinks.add(entry.link);
    const item = byLink.get(entry.link)!;
    if (entry.title !== undefined && entry.title !== item.title) throw new Error(`news: curated title differs from the recorded one for ${entry.link}: ${JSON.stringify(entry.title)} against ${JSON.stringify(item.title)}`);
    if (entry.outlet !== undefined && entry.outlet !== item.outlet) throw new Error(`news: curated outlet ${entry.outlet} is not ${item.outlet} for ${entry.link}`);
    const beat = entry.beat ?? null;
    const defaults = withDefaults(entry, beatDefaults(beat));
    const p = resolvePointers(`news ${entry.link}`, defaults, known);
    out.items.push({ id: `${item.outlet}-${createHash('sha256').update(item.link).digest('hex').slice(0, 10)}`, outlet: item.outlet, title: item.title, link: item.link, pubSec: item.pubSec, beat, focus: p.focus, facts: p.facts, mentions: p.mentions });
  }
  out.items.sort((a, b) => a.pubSec - b.pubSec);
  const ref = writeJsonObject(paths, 'news/window', out);
  const perOutlet = countBy(out.items);
  const refs: NewsRefs = { news: ref, items: out.items.length, perOutlet };
  writeWork(paths, 'news-refs.json', refs);
  writeWork(paths, 'news-window.json', out);
  log(`news: ${out.items.length} curated headlines, every link found in the recordings and every pointer resolved (${JSON.stringify(perOutlet)})`);
  return refs;
}

function countBy(items: readonly { outlet: Outlet }[]): Record<Outlet, number> {
  const out: Record<Outlet, number> = { jutarnji: 0, vecernji: 0, n1: 0 };
  for (const i of items) out[i.outlet]++;
  return out;
}
