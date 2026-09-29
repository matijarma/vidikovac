import type { FetchContext } from '../schema';
import type { FeedPayload, ItemInput } from '../payload';
import { compactData } from '../payload';
import { zagrebDate, zagrebIso } from '../time';
import { districtOf } from '../geo/districts';

// Guru za kulturu (kultura.zagreb.hr), the City of Zagreb's culture programme: one JSON list of the
// programme's occurrences with a coordinate for every one, the events of the City's own funding.
// The route is the site's internal one (its chatbot list), so a change on their side arrives here as a
// shape the check below refuses, and the last good copy serves for three days while Kulturpunkt goes on.
//
// The domain's robots.txt says `Disallow: /api/`. This is the one path the project reads against it, under
// the owner's ruling O-70 of 22 September 2026: the City's domain and the City's programme, the terms
// (kultura.zagreb.hr/pravila-koristenja) allow reuse with the source named and a link to Guru za kulturu,
// one identified read an hour (ttl 3600, the product's User-Agent), disclosed on the source page
// (docs/izvori.md, /izvori). test/feed/robots.test.ts holds this URL as the only exception.
//
// Only the fields read are typed: the source also serves descriptions and organisations' contact addresses,
// which never leave this file. There is no per-event slug, only the occurrence's; the link is the
// occurrence's page.

export const KULTURA_ZG_URL = 'https://kultura.zagreb.hr/api/chatbot/events';
export const KULTURA_ZG_LINK = 'https://kultura.zagreb.hr/dogadanja/';
/** The server's own cap: a list this long may be cut, and the coverage says so. */
export const KULTURA_ZG_SERVER_CAP = 1000;
/** Occurrences kept: those not over before today began and starting within this many days. */
export const KULTURA_ZG_DAYS = 8;
export const KULTURA_ZG_MAX_ITEMS = 300;
/** A listing of at least this long is a day's programme, not an hour on the clock. */
const WINDOW_AS_DAY_MS = 6 * 3_600_000;

/** One occurrence as served: the fields this module reads, local times without a zone. */
interface KulturaRow {
  event_name?: unknown;
  type?: unknown;
  kids?: unknown;
  occurrence_id: string;
  occurrence_start: string;
  occurrence_end?: unknown;
  occurrence_slug?: unknown;
  organisation_name?: unknown;
  address_name?: unknown;
  latitude: number;
  longitude: number;
}

const CATEGORY_BY_TYPE: Record<string, string> = {
  'Izložba': 'izlozba',
  Predstava: 'izvedba',
  Kino: 'film',
  Radionica: 'radionica',
  Koncert: 'koncert',
  Festival: 'festival',
};

const LOCAL_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/;

/** "2026-09-29T18:00:00" (Zagreb local, no zone) to the instant it names, or undefined. */
function localIso(value: unknown): string | undefined {
  const match = typeof value === 'string' ? LOCAL_TIME.exec(value) : null;
  if (!match) return undefined;
  const [year, month, day, hour, minute] = match.slice(1).map(Number) as [number, number, number, number, number];
  return zagrebIso(year, month, day, hour, minute);
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** The shape check: a list of occurrences that each carry an id, a start and a point. Anything else is not this source. */
function checkRows(body: unknown): KulturaRow[] {
  const events = (body as { events?: unknown } | null)?.events;
  if (!Array.isArray(events)) throw new Error('kultura-zg: unexpected response shape (no events list)');
  for (const row of events as Record<string, unknown>[]) {
    const ok =
      row !== null && typeof row === 'object' &&
      typeof row.occurrence_id === 'string' && row.occurrence_id !== '' &&
      localIso(row.occurrence_start) !== undefined &&
      typeof row.latitude === 'number' && Number.isFinite(row.latitude) &&
      typeof row.longitude === 'number' && Number.isFinite(row.longitude);
    if (!ok) throw new Error('kultura-zg: unexpected response shape (an occurrence without id, start or point)');
  }
  return events as KulturaRow[];
}

/** One occurrence as a feed item, or null when it has no name to show. */
function toItem(row: KulturaRow): ItemInput | null {
  const title = text(row.event_name);
  if (!title) return null;
  const at = localIso(row.occurrence_start)!;
  const end = localIso(row.occurrence_end);
  const until = end !== undefined && Date.parse(end) > Date.parse(at) ? end : undefined;
  const type = text(row.type);
  const day =
    type === 'Izložba' ||
    (until !== undefined && Date.parse(until) - Date.parse(at) >= WINDOW_AS_DAY_MS);
  const slug = text(row.occurrence_slug);
  return {
    id: `kultura-zg:${row.occurrence_id}`,
    kind: 'event',
    title,
    at,
    dateBasis: 'event',
    ...(until ? { until } : {}),
    geo: { type: 'Point', coordinates: [row.longitude, row.latitude] },
    ...(/^[\w-]+$/.test(slug) ? { link: `${KULTURA_ZG_LINK}${slug}` } : {}),
    data: compactData({
      source: 'kultura-zagreb',
      category: CATEGORY_BY_TYPE[type] ?? 'ostalo',
      venue: text(row.address_name) || undefined,
      organiser: text(row.organisation_name) || undefined,
      precision: day ? 'day' : 'time',
      district: districtOf(row.longitude, row.latitude) ?? undefined,
      kids: typeof row.kids === 'boolean' ? row.kids : undefined,
    }),
  };
}

export function parseKulturaZg(body: unknown, now: Date): FeedPayload {
  const rows = checkRows(body);
  const today = zagrebDate(now);
  const from = Date.parse(zagrebIso(today.year, today.month, today.day));
  const to = Date.parse(zagrebIso(today.year, today.month, today.day + KULTURA_ZG_DAYS));
  const items: ItemInput[] = [];
  for (const row of rows) {
    const start = Date.parse(localIso(row.occurrence_start)!);
    const end = Date.parse(localIso(row.occurrence_end) ?? '') || start;
    if (end < from || start >= to) continue;
    const item = toItem(row);
    if (item) items.push(item);
  }
  items.sort((a, b) => Date.parse(a.at!) - Date.parse(b.at!) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const shown = items.slice(0, KULTURA_ZG_MAX_ITEMS);
  return {
    items: shown,
    coverage: { shown: shown.length, total: rows.length, limited: rows.length >= KULTURA_ZG_SERVER_CAP },
  };
}

export async function fetchKulturaZg(ctx: FetchContext): Promise<FeedPayload> {
  const response = await ctx.fetch(KULTURA_ZG_URL);
  return parseKulturaZg(await response.json(), ctx.now());
}
