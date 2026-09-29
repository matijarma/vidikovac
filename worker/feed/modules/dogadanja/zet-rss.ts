import { XMLValidator } from 'fast-xml-parser';
import type { FetchContext, SourceAvailability } from '../../schema';
import { parseXml, xmlArray, xmlText } from '../../xml';
import { isoOrUndefined } from '../../time';
import type { Precision } from '../../hr-date';

// ZET (zet.hr) publishes two RSS 2.0 feeds under the Otvorena dozvola:
// rss_novosti.aspx (general news) and rss_promet.aspx (traffic-disruption
// notices). Both share one shape -- CDATA title/description, a link, a
// pubDate, a guid -- confirmed live in
// test/fixtures/dogadanja/{zet-rss-novosti,zet-rss-promet}.xml and their
// sources.json notes. www.zet.hr/robots.txt does not exist (404), so nothing
// on this host is disallowed.
//
// This began as the thinnest sub-fetcher in the directory (headline, link and,
// since ruling R-E1, the item's own publish time) and kept <description>
// untouched under R-P6: its first sentence is routinely Croatian date prose
// exactly like Kulturpunkt's excerpt (sources.json's own note: "u subotu, 12.
// rujna, od 9 do 19 sati"), and parsing a date out of prose is what R-P6
// forbids. The brief of October 2026 (docs/upgrade-2026-10.md section 4, U1)
// reverses R-P6 for ZET's notices only: the start of the description is shown
// as ZET's own words, under the words "ZET javlja" and with a link back to the
// notice (F11: the diversion of lines 5 and 13 for the CRO Race was in the feed
// for three days and shown nowhere). `summary` is that start: whole sentences
// up to 240 characters, nothing cut inside one (noticeSummary below). No date
// is ever parsed out of it: when a notice ends is told by its <pubDate> and
// the weekday word in its title (shared/city/notices.ts), never by its prose.
// <pubDate> stays a machine field read into `at` (precision 'time') by R-E1;
// an item whose <pubDate> is missing or doesn't parse keeps no `at`, the same
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

export interface ZetRssEvent {
  id: string;
  title: string;
  link: string;
  /** From <pubDate> (R-E1); absent when it's missing or doesn't parse. */
  at?: string;
  /** The start of <description> as whole sentences up to 240 characters (noticeSummary); absent when none fits. */
  summary?: string;
  dateBasis: 'published' | 'unknown';
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
  description?: unknown;
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

// --- the summary --------------------------------------------------------------------

/** The longest summary: whole sentences, so that 22 of the 27 traffic notices of 24 to 29 Sep keep one (180 keeps 8). */
export const SUMMARY_MAX = 240;
/** A piece shorter than this is a heading ("Noćna linija 31:"), not a sentence. */
const PIECE_MIN = 20;
/** A piece that ends in a colon is a lead-in to a list unless it says something by itself. */
const COLON_PIECE_MIN = 40;

const LINE_BREAK = /<\/?(?:br|p|div|li)\b[^>]*>/gi;
/** Stands for a line break from markup while raw whitespace, which is only the source's own wrapping, collapses. */
const BREAK = '\u0001';
const TAG = /<[^>]*>/g;
const ENTITY = /&(#x[0-9a-f]+|#[0-9]+|[a-z][a-z0-9]*);/gi;
const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  nbsp: ' ', amp: '&', quot: '"', apos: "'", lt: '<', gt: '>',
  bdquo: '„', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', ndash: '–', mdash: '—', hellip: '…', bull: '•', euro: '€',
};
/** A sentence ends at . ! ? or : and the next one starts with a capital letter or an opening quote. */
const SENTENCE_END = /(?<=[.!?:])\s+(?=[\p{Lu}„“"'(])/u;
/** "D. Mandića": a full stop after a single capital letter is an initial, not the end of a sentence. */
const INITIAL = /(?:^|[^\p{L}])\p{Lu}\.$/u;
/** A sentence opens with a letter, a digit, a quote or a bracket. */
const SENTENCE_START = /^[\p{L}\p{N}„“"'‘(]/u;
const COURTESY = /^Korisnike (?:ljubazno )?molimo/;

function decodeEntities(text: string): string {
  return text.replace(ENTITY, (whole, name: string) => {
    if (name.startsWith('#')) {
      const code = name[1] === 'x' || name[1] === 'X' ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10);
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[name.toLowerCase()] ?? whole;
  });
}

/** Sentences of one line, each with its full stop, split where the next begins with a capital or a quote. */
function sentencesOf(line: string): string[] {
  const out: string[] = [];
  for (const part of line.split(SENTENCE_END)) {
    const previous = out[out.length - 1];
    // The split fell after an initial: the two halves are one sentence.
    if (previous !== undefined && INITIAL.test(previous)) out[out.length - 1] = `${previous} ${part}`;
    else out.push(part);
  }
  return out;
}

/**
 * The start of a notice's <description> (raw HTML in CDATA) as whole sentences, at most SUMMARY_MAX characters, or
 * undefined when the first sentence alone is longer. Rules, in order: tags come out, with <br>, <p>, <div> and <li>
 * (and their closings) as line breaks; entities are decoded; whitespace collapses and " ," / " ." close up; the text
 * splits at line breaks and after . ! ? or : before a capital letter or an opening quote, except after an initial;
 * a piece that opens with a mark other than a letter, digit, quote or bracket (a footnote, a bullet) ends the summary;
 * pieces under 20 characters (headings such as "Noćna linija 31:") and colon pieces under 40 are skipped; the courtesy
 * sentence ("Korisnike ljubazno molimo ...") is dropped; the pieces join with one space while the total stays within
 * the limit; a piece that ends in a colon ends the summary, its colon turned into a full stop. A piece is never cut,
 * and a piece still holding markup or an undecoded entity ends the summary before it.
 */
export function noticeSummary(html: string): string | undefined {
  const flat = decodeEntities(html.replace(LINE_BREAK, BREAK).replace(TAG, ''))
    .replace(/\s+/g, ' ')
    .replace(/ +([,.])/g, '$1');
  let summary = '';
  for (const line of flat.split(BREAK)) {
    for (const raw of sentencesOf(line.trim())) {
      const piece = raw.trim();
      if (piece === '') continue;
      // A footnote mark or a bullet ("* Objavljeno u ponedjeljak, 7. rujna") opens something that is not the notice.
      if (!SENTENCE_START.test(piece)) return summary || undefined;
      if (COURTESY.test(piece)) continue;
      const colon = piece.endsWith(':');
      if (piece.length < PIECE_MIN || (colon && piece.length < COLON_PIECE_MIN)) continue;
      if (/[<>]|&\S*;/.test(piece)) return summary || undefined;
      const text = colon ? `${piece.slice(0, -1)}.` : piece;
      const joined = summary === '' ? text : `${summary} ${text}`;
      if (joined.length > SUMMARY_MAX) return summary || undefined;
      summary = joined;
      if (colon) return summary;
    }
  }
  return summary || undefined;
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
    const summary = noticeSummary(xmlText(entry.description));
    items.push({
      id: `${source}:${idFromLink(link)}`,
      title,
      link,
      ...(at ? { at } : {}),
      ...(summary ? { summary } : {}),
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
  return { items: ok.flat(), sources };
}
