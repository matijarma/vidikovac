import { XMLValidator } from 'fast-xml-parser';
import type { FetchContext, SourceAvailability } from '../schema';
import type { FeedPayload, ItemInput } from '../payload';
import { sourceCoverage } from '../payload';
import { parseXml, xmlArray, xmlText } from '../xml';
import { isoOrUndefined } from '../time';
import { decodeEntities, stripTags } from '../html';

// HRT allows the text of a news item with the source named and a link back to
// the original; audio and video are forbidden without written permission. This
// module therefore reads title, link, pubDate and the RSS <description> lede,
// and never touches <content:encoded>, which carries the article body and media.

export const HRT_FEEDS = [
  { url: 'https://feed.hrt.hr/vijesti/page.xml', source: 'HRT vijesti' },
  { url: 'https://feed.hrt.hr/sljeme/latest.xml', source: 'Radio Sljeme' },
] as const;

/** A teaser and a panel need the top of the feed, not its archive. */
export const HRT_ITEMS_PER_FEED = 15;

interface RssItem {
  title?: unknown;
  link?: unknown;
  guid?: unknown;
  description?: unknown;
  pubDate?: unknown;
}
interface RssDocument {
  rss?: { channel?: { lastBuildDate?: unknown; item?: RssItem | RssItem[] } };
}

const ARRAY_PATHS = ['rss.channel.item'];

export function parseHrtRss(xml: string, source: string): ItemInput[] {
  return readHrtRss(xml, source).items;
}

function readHrtRss(xml: string, source: string): { items: ItemInput[]; totalItems: number } {
  if (XMLValidator.validate(xml.trim()) !== true) throw new Error('hrt-news: invalid XML');
  const channel = parseXml<RssDocument>(xml, { arrayPaths: ARRAY_PATHS }).rss?.channel;
  if (channel === undefined || channel === null) throw new Error('hrt-news: expected RSS channel');
  const items: ItemInput[] = [];

  for (const entry of xmlArray(channel?.item)) {
    if (!entry || typeof entry !== 'object') continue;
    const link = xmlText(entry.link) || xmlText(entry.guid);
    const title = xmlText(entry.title);
    if (!link || !title) continue;
    const summary = stripTags(decodeEntities(xmlText(entry.description)));
    const at = isoOrUndefined(xmlText(entry.pubDate));
    items.push({
      id: link,
      kind: 'news',
      title,
      ...(summary ? { summary } : {}),
      ...(at ? { at } : {}),
      dateBasis: at ? 'published' : 'unknown',
      link,
      data: { source },
    });
  }

  return { items: items.slice(0, HRT_ITEMS_PER_FEED), totalItems: items.length };
}

export function rssBuildDate(xml: string): string | undefined {
  const channel = parseXml<RssDocument>(xml, { arrayPaths: ARRAY_PATHS }).rss?.channel;
  return isoOrUndefined(xmlText(channel?.lastBuildDate));
}

export async function fetchHrtNews(ctx: FetchContext): Promise<FeedPayload> {
  const results = await Promise.allSettled(
    HRT_FEEDS.map(async (feed) => {
      const response = await ctx.fetch(feed.url);
      if (!response.ok) throw new Error(`hrt-news: HTTP ${response.status}`);
      const xml = await response.text();
      return { ...readHrtRss(xml, feed.source), buildDate: rssBuildDate(xml) };
    }),
  );

  const ok = results.filter((result) => result.status === 'fulfilled').map((result) => result.value);
  if (ok.length === 0) throw new Error('hrt-news: both feeds failed');

  const items = ok.flatMap((result) => result.items).sort((a, b) =>
    (b.at ? Date.parse(b.at) : -Infinity) - (a.at ? Date.parse(a.at) : -Infinity) || 0);
  const fetchedAt = ctx.now().toISOString();
  const sources: Record<string, SourceAvailability> = {};
  results.forEach((result, index) => {
    sources[HRT_FEEDS[index].source] = result.status === 'fulfilled'
      ? {
          status: 'live', itemCount: result.value.items.length, totalItems: result.value.totalItems, fetchedAt,
          ...(result.value.buildDate ? { sourceUpdatedAt: result.value.buildDate } : {}),
        }
      : { status: 'down', itemCount: 0 };
  });
  // The merged payload is only as fresh as its stalest live feed: report the
  // earliest build date, not the latest, so "updated at" never overstates how
  // recently every included headline was actually confirmed current.
  const sourceUpdatedAt = ok.every((result) => result.buildDate) ? ok
    .map((result) => result.buildDate)
    .filter((value): value is string => Boolean(value))
    .sort()
    .shift() : undefined;

  return { items, sources, coverage: sourceCoverage(sources), ...(sourceUpdatedAt ? { sourceUpdatedAt } : {}) };
}
