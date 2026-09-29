import type { FetchContext } from '../../schema';
import type { FeedPayload, ItemInput } from '../../payload';
import { capSource } from '../dogadanja';
import { kgzPageUrl, parseKgzPage, type KgzPage } from './kgz';

// The libraries' programme (Knjižnice grada Zagreba): the first two pages of the listing, which run from today
// over the next days, twenty listings each. A page or two is all that is asked of the site; the pager runs to
// page 15 and the module says so in its coverage (limited). At most 40 events, as every dogadanja source.

export const KGZ_PAGES = [1, 2] as const;

export function mergePages(pages: readonly KgzPage[], now: Date): FeedPayload {
  const seen = new Set<string>();
  const items: ItemInput[] = [];
  for (const item of pages.flatMap((page) => page.items)) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    items.push(item);
  }
  const shown = capSource(items, now);
  const results = pages.map((page) => page.results).find((value) => value !== undefined);
  return {
    items: shown,
    coverage: { shown: shown.length, ...(results !== undefined ? { total: results } : {}), limited: true },
  };
}

export async function fetchProgrami(ctx: FetchContext): Promise<FeedPayload> {
  const now = ctx.now();
  // Both pages must answer: half a listing is not shown as the listing.
  const pages = await Promise.all(KGZ_PAGES.map(async (page) => parseKgzPage(await (await ctx.fetch(kgzPageUrl(page))).text(), now)));
  return mergePages(pages, now);
}
