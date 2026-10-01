// The three voices beside the map, each the latest thing said at or before
// the replay instant: ZET's notice (kept until the next one), the curated
// headline (three hours of life, then the card says there is none) and the
// event marker (one hour). Pure functions over the dataset's lists, sorted
// here once per call so the order of the files never matters.
import type { NewsFile, NoticesFile, SnimkaEvent } from '../../../shared/snimka';

export type NewsItem = NewsFile['items'][number];
export type Notice = NoticesFile['items'][number];

/** A headline is current for three hours after it was published. */
export const ARTICLE_WINDOW_S = 3 * 3600;
/** An event is the "Događaj" card for an hour. */
export const MARKER_WINDOW_S = 3600;

/** The latest item published at or before `atSec`, or null. */
function latestBefore<T>(items: readonly T[], atSec: number, time: (item: T) => number, windowSec = Infinity): T | null {
  let best: T | null = null;
  let bestAt = -Infinity;
  for (const item of items) {
    const t = time(item);
    if (!Number.isFinite(t) || t > atSec || t < atSec - windowSec) continue;
    if (t > bestAt) { best = item; bestAt = t; }
  }
  return best;
}

/** The curated headline to show: the latest within `windowSec` before the instant, with its outlet's name. */
export function currentArticle(news: Pick<NewsFile, 'items' | 'outlets'>, atSec: number, windowSec = ARTICLE_WINDOW_S): { item: NewsItem; outlet: string } | null {
  const item = latestBefore(news.items, atSec, (i) => i.pubSec, windowSec);
  if (!item) return null;
  return { item, outlet: news.outlets[item.outlet]?.name ?? item.outlet };
}

/** ZET's latest notice at or before the instant; a notice stays until the next one. */
export function currentNotice(notices: Pick<NoticesFile, 'items'>, atSec: number): Notice | null {
  return latestBefore(notices.items, atSec, (i) => i.pubSec);
}

/** The latest event within `windowSec` before the instant (chapters and plain events alike). */
export function currentMarker(events: readonly SnimkaEvent[], atSec: number, windowSec = MARKER_WINDOW_S): SnimkaEvent | null {
  return latestBefore(events, atSec, (e) => e.atSec, windowSec);
}
