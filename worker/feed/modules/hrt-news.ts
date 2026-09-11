import type { FetchContext } from '../schema';
import type { FeedPayload, ItemInput } from '../payload';
import { parseXml, xmlArray, xmlText } from '../xml';
import { isoOrUndefined } from '../time';

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
  const channel = parseXml<RssDocument>(xml, { arrayPaths: ARRAY_PATHS }).rss?.channel;
  const items: ItemInput[] = [];

  for (const entry of xmlArray(channel?.item)) {
    const link = xmlText(entry.link) || xmlText(entry.guid);
    const title = xmlText(entry.title);
    if (!link || !title) continue;
    const summary = xmlText(entry.description);
    items.push({
      id: link,
      kind: 'news',
      title,
      ...(summary ? { summary } : {}),
      ...(isoOrUndefined(xmlText(entry.pubDate)) ? { at: isoOrUndefined(xmlText(entry.pubDate)) } : {}),
      link,
      data: { source },
    });
    if (items.length === HRT_ITEMS_PER_FEED) break;
  }

  return items;
}

export function rssBuildDate(xml: string): string | undefined {
  const channel = parseXml<RssDocument>(xml, { arrayPaths: ARRAY_PATHS }).rss?.channel;
  return isoOrUndefined(xmlText(channel?.lastBuildDate));
}

export async function fetchHrtNews(ctx: FetchContext): Promise<FeedPayload> {
  const results = await Promise.allSettled(
    HRT_FEEDS.map(async (feed) => {
      const response = await ctx.fetch(feed.url);
      const xml = await response.text();
      return { items: parseHrtRss(xml, feed.source), buildDate: rssBuildDate(xml) };
    }),
  );

  const ok = results.filter((result) => result.status === 'fulfilled').map((result) => result.value);
  if (ok.length === 0) throw new Error('hrt-news: both feeds failed');

  const items = ok.flatMap((result) => result.items).sort((a, b) => Date.parse(b.at ?? '') - Date.parse(a.at ?? ''));
  // The merged payload is only as fresh as its stalest live feed: report the
  // earliest build date, not the latest, so "updated at" never overstates how
  // recently every included headline was actually confirmed current.
  const sourceUpdatedAt = ok
    .map((result) => result.buildDate)
    .filter((value): value is string => Boolean(value))
    .sort()
    .shift();

  return { items, ...(sourceUpdatedAt ? { sourceUpdatedAt } : {}) };
}
