import type { FetchContext } from '../../schema';
import { decodeEntities, stripTags } from '../../html';
import { zagrebOffsetMinutes, zagrebIso } from '../../time';
import type { Precision } from '../../hr-date';

// aktivnosti.zagreb.hr's "Kvartovske novosti" listing (mjesna samouprava
// hyperlocal news: the city's neighbourhood councils and boards) publishes
// neither a per-item date nor a district for any item -- confirmed live in
// test/fixtures/dogadanja/kvartovske-novosti.html and its sources.json note.
// There is no RSS or JSON alternative on this host. Every item is one
// <h4 class='pt-20'> title wrapped in its own <a href>, repeated three times
// on the page (thumbnail, title, "VIŠE" link) -- only the title anchor is
// read here, once per item.
//
// startIso would be the publication time if this page ever stated one for an
// item; it doesn't, anywhere in the saved fixture, so every item falls back
// to one calendar day per position in the list (position 0 = today), which
// keeps the page's own newest-first display order as the sort order a later
// merge (E6) can rely on -- real ids in the fixture fall monotonically as
// position increases, confirming the page really is newest-first. `district`
// is not a key in DATA_KEYS.event at all: it is never invented.

export const KVARTOVSKE_URL = 'https://aktivnosti.zagreb.hr/kvartovske-novosti/134585';
const KVARTOVSKE_BASE_URL = 'https://aktivnosti.zagreb.hr';

export interface KvartovskeEvent {
  id: string;
  title: string;
  link: string;
  /** ISO 8601, Europe/Zagreb midnight -- day precision only (see file header). */
  at: string;
  data: {
    source: 'kvartovske';
    precision: Precision;
  };
}

export interface KvartovskeResult {
  items: KvartovskeEvent[];
}

// One item: <a href='URL'><h4 class='pt-20'>Title</h4></a>. Attributes are
// captured loosely ([^>]*) on both tags so a class-before-href reorder, extra
// attributes, or inserted whitespace/newlines (a CMS reflow) still match --
// only the literal `pt-20` class token inside the <h4> is load-bearing.
const ITEM_PATTERN =
  /<a\b([^>]*)>\s*<h4\b[^>]*\bclass=(["'])[^"']*\bpt-20\b[^"']*\2[^>]*>([^<]*)<\/h4>\s*<\/a>/gi;
const HREF_PATTERN = /href=(["'])([^"']*)\1/i;

const MS_PER_DAY = 86_400_000;

/** Zagreb calendar date of (`now` minus `daysAgo` whole days), independent of DST at either end. */
function zagrebDayAtOffset(now: Date, daysAgo: number): { year: number; month: number; day: number } {
  const shifted = new Date(now.getTime() - daysAgo * MS_PER_DAY);
  const offsetMinutes = zagrebOffsetMinutes(shifted);
  const local = new Date(shifted.getTime() + offsetMinutes * 60_000);
  return { year: local.getUTCFullYear(), month: local.getUTCMonth() + 1, day: local.getUTCDate() };
}

function idFromHref(href: string): string {
  const match = /\/(\d+)\/?$/.exec(href);
  return match ? match[1] : href;
}

export async function fetchKvartovske(ctx: FetchContext): Promise<KvartovskeResult> {
  const response = await ctx.fetch(KVARTOVSKE_URL);
  const html = await response.text();
  const now = ctx.now();

  const items: KvartovskeEvent[] = [];
  let position = 0;
  for (const match of html.matchAll(ITEM_PATTERN)) {
    const hrefMatch = HREF_PATTERN.exec(match[1]);
    const title = decodeEntities(stripTags(match[3])).trim();
    if (!hrefMatch || !title) continue;

    const day = zagrebDayAtOffset(now, position);
    items.push({
      id: `kvartovske:${idFromHref(hrefMatch[2])}`,
      title,
      link: new URL(hrefMatch[2], KVARTOVSKE_BASE_URL).toString(),
      at: zagrebIso(day.year, day.month, day.day, 0, 0),
      data: {
        source: 'kvartovske',
        precision: 'day',
      },
    });
    position += 1;
  }

  return { items };
}
