import type { FetchContext, SourceAvailability } from '../../schema';
import { pageTotal } from '../../payload';
import { decodeEntities, stripTags } from '../../html';
import type { Precision } from '../../hr-date';

// Etnografski muzej (emz.hr) is the single real event API the research sweep
// found among the institutions the City finances: WordPress REST, two custom
// post types (dogadjanja -- events/workshops, izlozbe -- exhibitions), each
// carrying genuine `webmz_event_date_start`/`webmz_event_date_end` (Unix
// seconds) and `webmz_event_place` meta. Confirmed live in
// test/fixtures/dogadanja/{etnografski-dogadjanja,etnografski-izlozbe}.json
// and their sources.json notes. Because these are real machine timestamps,
// not Croatian sentence prose, they are read directly -- `parseHrDate` (built
// for Kulturpunkt's and Skupština's prose) is never called here.
// emz.hr/robots.txt disallows only /wp-admin/; the wp-json path fetched is
// unaffected.
//
// Both endpoints are sorted by post publish date, not by event date, so this
// list is really "recently posted", and several of its real rows already
// concluded weeks or months before the moment they were fetched (sources.json
// names id 22339/22334 explicitly: end 2026-08-16, well before the live
// fetch). Showing an already-finished event on a live "what's happening in
// Zagreb" feed would misrepresent it as current, so an item whose event
// window has fully passed by `now` is dropped, never guessed into looking
// current -- the same "never invent, never mislead" principle R-P6 applies to
// borrowed prose, applied here to elapsed time instead. This is a call the
// brief only spells out for "an exhibition" (izlozbe); it is applied
// uniformly to both post types, since both share the identical meta shape and
// the same live-feed purpose, and one real dogadjanja row (a "ciklus" of
// workshops, id 22598) needs exactly this rule to correctly stay current
// while its 19 older siblings correctly drop out.
//
// R-P6 headline-level metadata only: title, the parsed instant, venue and a
// category derived from which endpoint the row came from. This API has no
// organiser field and no "is this streamed" signal, so neither is invented.

export const ETNOGRAFSKI_DOGADJANJA_URL =
  'https://emz.hr/wp-json/wp/v2/dogadjanja?_fields=id,link,title,type,meta,class_list,date&per_page=20&orderby=date&order=desc';
export const ETNOGRAFSKI_IZLOZBE_URL =
  'https://emz.hr/wp-json/wp/v2/izlozbe?_fields=id,link,title,type,meta,class_list,date&per_page=20&orderby=date&order=desc';

// Category is assigned from which endpoint a row was fetched from, not read
// back off the row's own `type` field: the two are the same in every real
// row, but this way a row can never mislabel itself even if that field were
// ever missing or wrong.
const ETNOGRAFSKI_FEEDS = [
  { url: ETNOGRAFSKI_DOGADJANJA_URL, category: 'dogadjanje', source: 'etnografski-dogadjanja' },
  { url: ETNOGRAFSKI_IZLOZBE_URL, category: 'izlozba', source: 'etnografski-izlozbe' },
] as const;

export type EtnografskiCategory = (typeof ETNOGRAFSKI_FEEDS)[number]['category'];

export interface EtnografskiEvent {
  id: string;
  title: string;
  link: string;
  /** ISO 8601, straight from webmz_event_date_start (Unix seconds) -- never parseHrDate. */
  at: string;
  dateBasis: 'event';
  /** ISO 8601, straight from webmz_event_date_end. Always present in the real fixture; required here since an event with no known end can never be judged "still current" below. */
  until: string;
  data: {
    source: 'etnografski';
    category: EtnografskiCategory;
    venue: string;
    precision: Precision;
  };
}

export interface EtnografskiResult {
  items: EtnografskiEvent[];
  /** Rows with no readable start/end meta, plus any row whose event window has already fully passed -- dropped, never guessed or shown as if still current. */
  droppedCount: number;
  sources: Record<string, SourceAvailability>;
}

interface EtnografskiApiItem {
  id: number;
  link: string;
  title?: { rendered?: string };
  meta?: {
    webmz_event_date_start?: number;
    webmz_event_date_end?: number;
    webmz_event_place?: string;
  };
}

/** Unix seconds -> ISO 8601 instant, or null when the field is missing or not a finite number. */
function isoFromUnixSeconds(value: number | undefined): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const date = new Date(value * 1000);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function parseEtnografskiFeed(rows: EtnografskiApiItem[], category: EtnografskiCategory, nowMs: number): { items: EtnografskiEvent[]; droppedCount: number } {
  const items: EtnografskiEvent[] = [];
  let droppedCount = 0;

  for (const row of rows) {
    const at = isoFromUnixSeconds(row.meta?.webmz_event_date_start);
    const until = isoFromUnixSeconds(row.meta?.webmz_event_date_end);
    const venue = decodeEntities(stripTags(row.meta?.webmz_event_place ?? ''));
    const title = decodeEntities(stripTags(row.title?.rendered ?? ''));
    if (!at || !until || !venue || !title) {
      droppedCount += 1;
      continue;
    }
    // A real row (id 22186) even has until before at -- taking the later of
    // the two as "when this event is actually over" reads that reversal
    // safely rather than letting a swapped end date make a still-relevant
    // event look prematurely finished.
    const endMs = Math.max(Date.parse(at), Date.parse(until));
    if (endMs < nowMs) {
      droppedCount += 1;
      continue;
    }

    items.push({
      id: `etnografski:${row.id}`,
      title,
      link: row.link,
      at,
      dateBasis: 'event',
      until,
      data: { source: 'etnografski', category, venue, precision: 'time' },
    });
  }

  return { items, droppedCount };
}

export async function fetchEtnografski(ctx: FetchContext): Promise<EtnografskiResult> {
  const nowMs = ctx.now().getTime();
  const results = await Promise.allSettled(
    ETNOGRAFSKI_FEEDS.map(async (feed) => {
      const response = await ctx.fetch(feed.url);
      if (!response.ok) throw new Error(`etnografski: HTTP ${response.status}`);
      const rows: unknown = await response.json();
      if (!Array.isArray(rows)) throw new Error(`etnografski: unexpected response shape from ${feed.url}`);
      const parsed = parseEtnografskiFeed(rows as EtnografskiApiItem[], feed.category, nowMs);
      // Further pages may contain current events. Their eligible count is unknown.
      return { ...parsed, totalItems: pageTotal(response, rows.length, 20) === rows.length ? parsed.items.length : undefined };
    }),
  );

  const ok = results.filter((result) => result.status === 'fulfilled').map((result) => result.value);
  if (ok.length === 0) throw new Error('etnografski: both endpoints failed');

  const sources: Record<string, SourceAvailability> = {};
  results.forEach((result, index) => {
    sources[ETNOGRAFSKI_FEEDS[index].source] = result.status === 'fulfilled'
      ? {
          status: 'live', itemCount: result.value.items.length, fetchedAt: ctx.now().toISOString(),
          ...(result.value.totalItems !== undefined ? { totalItems: result.value.totalItems } : {}),
        }
      : { status: 'down', itemCount: 0 };
  });
  return {
    items: ok.flatMap((result) => result.items),
    droppedCount: ok.reduce((sum, result) => sum + result.droppedCount, 0),
    sources,
  };
}
