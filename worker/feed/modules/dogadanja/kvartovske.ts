import type { FetchContext } from '../../schema';
import { decodeEntities, stripTags } from '../../html';

// aktivnosti.zagreb.hr's "Kvartovske novosti" listing (mjesna samouprava
// hyperlocal news: the city's neighbourhood councils and boards) publishes
// neither a per-item date nor a district for any item -- confirmed live in
// test/fixtures/dogadanja/kvartovske-novosti.html and its sources.json note.
// There is no RSS or JSON alternative on this host. Every item is one
// <h4 class='pt-20'> title wrapped in its own <a href>, repeated three times
// on the page (thumbnail, title, "VIŠE" link) -- only the title anchor is
// read here, once per item.
//
// The list supplies ordering, not dates. Keep its sequence verbatim and never
// infer an event/publication date from position, the title, or the fetch clock.

export const KVARTOVSKE_URL = 'https://aktivnosti.zagreb.hr/kvartovske-novosti/134585';
const KVARTOVSKE_BASE_URL = 'https://aktivnosti.zagreb.hr';

export interface KvartovskeEvent {
  id: string;
  title: string;
  link: string;
  dateBasis: 'unknown';
  data: {
    source: 'kvartovske';
  };
}

export interface KvartovskeResult {
  items: KvartovskeEvent[];
  totalItems?: number;
}

// One item: <a href='URL'><h4 class='pt-20'>Title</h4></a>. Attributes are
// captured loosely ([^>]*) on both tags so a class-before-href reorder, extra
// attributes, or inserted whitespace/newlines (a CMS reflow) still match --
// only the literal `pt-20` class token inside the <h4> is load-bearing.
const ITEM_PATTERN =
  /<a\b([^>]*)>\s*<h4\b[^>]*\bclass=(["'])[^"']*\bpt-20\b[^"']*\2[^>]*>([^<]*)<\/h4>\s*<\/a>/gi;
const HREF_PATTERN = /href=(["'])([^"']*)\1/i;

function idFromHref(href: string): string {
  const match = /\/(\d+)\/?$/.exec(href);
  return match ? match[1] : href;
}

export async function fetchKvartovske(ctx: FetchContext): Promise<KvartovskeResult> {
  const response = await ctx.fetch(KVARTOVSKE_URL);
  if (!response.ok) throw new Error(`kvartovske: HTTP ${response.status}`);
  const html = await response.text();
  if (!/<h1\b[^>]*>\s*Kvartovske novosti\s*<\/h1>/i.test(html)) {
    throw new Error('kvartovske: expected notice listing');
  }

  const items: KvartovskeEvent[] = [];
  const seen = new Set<string>();
  for (const match of html.matchAll(ITEM_PATTERN)) {
    const hrefMatch = HREF_PATTERN.exec(match[1]);
    const title = decodeEntities(stripTags(match[3])).trim();
    if (!hrefMatch || !title) continue;

    const id = `kvartovske:${idFromHref(hrefMatch[2])}`;
    if (seen.has(id)) continue;
    seen.add(id);
    items.push({
      id,
      title,
      link: new URL(hrefMatch[2], KVARTOVSKE_BASE_URL).toString(),
      dateBasis: 'unknown',
      data: {
        source: 'kvartovske',
      },
    });
  }

  // This paginated listing does not publish an overall item total.
  return { items, ...(!/class=["'][^"']*pagination-table/i.test(html) ? { totalItems: items.length } : {}) };
}
