import type { FetchContext } from '../../schema';
import { decodeEntities, stripTags } from '../../html';
import { parseHrDate, type Precision } from '../../hr-date';
import { pageTotal } from '../../payload';
import { eventLocation } from '../../../city/event-location';

// Kulturpunkt (kulturpunkt.hr), WordPress REST, custom post type
// kp_22_announcement, CC BY-SA 3.0 HR -- this is the reason the whole
// dogadanja module is session tier rather than republished at /open (see the
// area E preamble). Confirmed live in test/fixtures/dogadanja/kulturpunkt.json
// and its sources.json note: the response carries no `acf` and no `meta` --
// no source field ever names a date, a venue or an organiser. The date exists
// only as Croatian prose inside excerpt.rendered, so every item's `at`/`until`
// comes from worker/feed/hr-date.ts over that text, never from the REST
// response's own `date` (that field names when the WordPress post was
// published, not when the announced event happens, and is not read here).
// An announcement whose excerpt carries no readable date is dropped, never
// guessed -- see droppedCount below.
//
// R-P6 forbids copying description text into an item: only the parsed date
// and the category (from class_list) leave this file, never excerpt prose.
// The same REST response also carries no venue or organiser field to copy in
// the first place, so this source never states them and this module never
// invents them.

export const KULTURPUNKT_URL =
  'https://kulturpunkt.hr/wp-json/wp/v2/kp_22_announcement?_fields=id,link,title,excerpt,class_list,date&per_page=40&orderby=date&order=desc';

const CATEGORY_PREFIX = 'kp_22_announcement_cat-';

// The full set of category tags seen across the live fixture (40 recent
// announcements, test/fixtures/dogadanja/sources.json). Closed on purpose --
// see schema.ts's DATA_KEYS docstring for why an open-ended source string
// isn't allowed to reach a panel unbounded. A tag this project has not seen
// yet falls back to 'ostalo' rather than passing an arbitrary WordPress slug
// straight through.
const KNOWN_CATEGORIES = [
  'izvedba',
  'koncert',
  'izlozba',
  'film',
  'radionica',
  'predavanje',
  'razgovor',
  'festival',
  'sajam',
  'predstavljanje',
  'program',
  'diskurzivno',
  'muzika',
] as const;

export type KulturpunktCategory = (typeof KNOWN_CATEGORIES)[number] | 'ostalo';

/**
 * class_list carries zero or more `kp_22_announcement_cat-*` tags (real
 * fixture items carry two for e.g. a musical workshop). This reads the first
 * one this module recognises, in the order WordPress lists them -- a single,
 * deterministic rule rather than guessing which of two tags is "primary".
 */
export function categoryFromClassList(classList: string[]): KulturpunktCategory {
  for (const entry of classList) {
    if (!entry.startsWith(CATEGORY_PREFIX)) continue;
    const slug = entry.slice(CATEGORY_PREFIX.length);
    if ((KNOWN_CATEGORIES as readonly string[]).includes(slug)) return slug as KulturpunktCategory;
  }
  return 'ostalo';
}

interface KulturpunktApiItem {
  id: number;
  link: string;
  title: { rendered: string };
  excerpt: { rendered: string };
  class_list: string[];
}

/**
 * One Kulturpunkt announcement, already reduced to headline-level metadata
 * (R-P6): no description field exists on this type at all, so there is
 * nothing for a future edit to accidentally copy prose into.
 */
export interface KulturpunktEvent {
  id: string;
  title: string;
  link: string;
  /** ISO 8601, Europe/Zagreb, from parseHrDate over the excerpt. */
  at: string;
  dateBasis: 'event';
  until?: string;
  data: {
    source: 'kulturpunkt';
    category: KulturpunktCategory;
    precision: Precision;
    venueHint?: string;
    venueTags?: string;
    city?: string;
  };
}

export interface KulturpunktResult {
  items: KulturpunktEvent[];
  /** Announcements whose excerpt carried no readable date -- dropped, not guessed. */
  droppedCount: number;
  totalItems?: number;
}

export async function fetchKulturpunkt(ctx: FetchContext): Promise<KulturpunktResult> {
  const response = await ctx.fetch(KULTURPUNKT_URL);
  if (!response.ok) throw new Error(`kulturpunkt: HTTP ${response.status}`);
  const rows: unknown = await response.json();
  if (!Array.isArray(rows)) throw new Error('kulturpunkt: unexpected response shape');

  const items: KulturpunktEvent[] = [];
  let droppedCount = 0;
  const now = ctx.now();

  for (const row of rows as KulturpunktApiItem[]) {
    const excerptText = decodeEntities(stripTags(row.excerpt?.rendered ?? ''));
    const parsed = parseHrDate(excerptText, now);
    if (!parsed) {
      droppedCount += 1;
      continue;
    }
    items.push({
      id: `kulturpunkt:${row.id}`,
      title: decodeEntities(stripTags(row.title?.rendered ?? '')),
      link: row.link,
      at: parsed.startIso,
      dateBasis: 'event',
      ...(parsed.endIso ? { until: parsed.endIso } : {}),
      data: {
        source: 'kulturpunkt',
        category: categoryFromClassList(row.class_list ?? []),
        precision: parsed.precision,
        ...eventLocation(excerptText, row.class_list ?? []),
      },
    });
  }

  return { items, droppedCount, totalItems: pageTotal(response, rows.length, 40) === rows.length ? items.length : undefined };
}
