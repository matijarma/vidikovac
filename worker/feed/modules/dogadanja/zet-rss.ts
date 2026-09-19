import { XMLValidator } from 'fast-xml-parser';
import type { FetchContext, SourceAvailability } from '../../schema';
import { parseXml, xmlArray, xmlText } from '../../xml';
import { isoOrUndefined } from '../../time';
import { briefRows } from '../../payload';
import type { Precision } from '../../hr-date';

// ZET (zet.hr) publishes two RSS 2.0 feeds under the Otvorena dozvola:
// rss_novosti.aspx (general news) and rss_promet.aspx (traffic-disruption
// notices). Both share one shape -- CDATA title/description, a link, a
// pubDate, a guid -- confirmed live in
// test/fixtures/dogadanja/{zet-rss-novosti,zet-rss-promet}.xml and their
// sources.json notes. www.zet.hr/robots.txt does not exist (404), so nothing
// on this host is disallowed.
//
// This is deliberately the thinnest sub-fetcher in the directory ("ZET
// notices", the task's own title, next to "the one real museum API"): the
// brief pins it to headline, link and -- since ruling R-E1 -- the item's own
// publish time. <description> carries the entire notice body as raw HTML,
// and its first sentence is routinely Croatian date prose exactly like
// Kulturpunkt's excerpt (sources.json's own note: "u subotu, 12. rujna, od 9
// do 19 sati") -- reading it, or parsing a date out of it, would be exactly
// the borrowed-prose R-P6 forbids, so it stays untouched. <pubDate> is
// different: a genuine machine field, not prose, so reading it into `at`
// (precision 'time') is a machine fact, not a borrowed sentence -- R-E1
// requires exactly this, because without it every ZET notice sorted to the
// very end of the merged list via the dateless fallback, behind
// communal-works rows last touched in July. An item whose <pubDate> is
// missing or doesn't parse simply keeps no `at`, the same
// `isoOrUndefined` (worker/feed/time.ts) contract every other RSS-backed
// module in this project already follows (see hrt-news.ts).

export const ZET_RSS_NOVOSTI_URL = 'https://www.zet.hr/rss_novosti.aspx';
export const ZET_RSS_PROMET_URL = 'https://www.zet.hr/rss_promet.aspx';

// One file, two feeds, each tagged with its own `source` value -- the same
// shape hrt-news.ts already uses for its two feeds -- rather than a `category`
// distinction: `source` is this directory's per-institution/per-feed
// identifier everywhere else (kulturpunkt, skupstina, komunalne, kvartovske),
// and ZET's own two feeds are different enough in kind (general news vs.
// traffic disruptions) to earn two source values instead of one shared
// 'zet' plus an invented category the brief never asks for.
const ZET_FEEDS = [
  { url: ZET_RSS_NOVOSTI_URL, source: 'zet-novosti' },
  { url: ZET_RSS_PROMET_URL, source: 'zet-promet' },
] as const;

export type ZetRssSource = (typeof ZET_FEEDS)[number]['source'];

/** How many of each feed's newest notices the kiosk ticker can show, and so how many are condensed (WP6). */
export const ZET_RSS_BRIEF_COUNT = 3;

export interface ZetRssEvent {
  id: string;
  title: string;
  link: string;
  /** From <pubDate> (R-E1); absent when it's missing or doesn't parse. */
  at?: string;
  dateBasis: 'published' | 'unknown';
  /** One-line machine-condensed reading of the headline (worker/feed/brief.ts, WP6). */
  brief?: string;
  data: {
    source: ZetRssSource;
    precision: Precision;
  };
}

export interface ZetRssResult {
  items: ZetRssEvent[];
  sources: Record<string, SourceAvailability>;
}

const ARRAY_PATHS = ['rss.channel.item'];

interface RssItem {
  title?: unknown;
  link?: unknown;
  guid?: unknown;
  pubDate?: unknown;
}
interface RssDocument {
  rss?: { channel?: { item?: RssItem | RssItem[] } };
}

/** "https://www.zet.hr/default.aspx?id=10123" -> "10123"; the full link when the query has no id (never seen live, but no item is ever dropped over it). */
function idFromLink(link: string): string {
  try {
    const id = new URL(link).searchParams.get('id');
    if (id) return id;
  } catch {
    // Not a parseable absolute URL -- fall through to the raw link below.
  }
  return link;
}

function parseZetRss(xml: string, source: ZetRssSource): ZetRssEvent[] {
  if (XMLValidator.validate(xml.trim()) !== true) throw new Error('zet-rss: invalid XML');
  const channel = parseXml<RssDocument>(xml, { arrayPaths: ARRAY_PATHS }).rss?.channel;
  if (channel === undefined || channel === null) throw new Error('zet-rss: expected RSS channel');
  const items: ZetRssEvent[] = [];

  for (const entry of xmlArray(channel?.item)) {
    if (!entry || typeof entry !== 'object') continue;
    const link = xmlText(entry.link) || xmlText(entry.guid);
    const title = xmlText(entry.title);
    if (!link || !title) continue;
    const at = isoOrUndefined(xmlText(entry.pubDate));
    items.push({
      id: `${source}:${idFromLink(link)}`,
      title,
      link,
      ...(at ? { at } : {}),
      dateBasis: at ? 'published' : 'unknown',
      data: { source, precision: 'time' },
    });
  }

  return items;
}

export async function fetchZetRss(ctx: FetchContext): Promise<ZetRssResult> {
  const results = await Promise.allSettled(
    ZET_FEEDS.map(async (feed) => {
      const response = await ctx.fetch(feed.url);
      if (!response.ok) throw new Error(`zet-rss: HTTP ${response.status}`);
      const xml = await response.text();
      return parseZetRss(xml, feed.source);
    }),
  );

  const ok = results.filter((result) => result.status === 'fulfilled').map((result) => result.value);
  if (ok.length === 0) throw new Error('zet-rss: both feeds failed');

  const fetchedAt = ctx.now().toISOString();
  const sources: Record<string, SourceAvailability> = {};
  results.forEach((result, index) => {
    sources[ZET_FEEDS[index].source] = result.status === 'fulfilled'
      ? { status: 'live', itemCount: result.value.length, totalItems: result.value.length, fetchedAt }
      : { status: 'down', itemCount: 0 };
  });
  // Both feeds list newest first, so the ticker's candidates are the head of
  // each; a notice with no brief still shows its own headline (WP6). After
  // fetchedAt, which stamps the fetch and not the condensing that follows it.
  await briefRows(ctx, ok.flatMap((items) => items.slice(0, ZET_RSS_BRIEF_COUNT)), (item) => item.title, 'obavijest');
  return { items: ok.flat(), sources };
}
