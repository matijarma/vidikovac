// The licence boundary of the dogadanja module, in one place.
//
// The module is session tier as a whole because one of its six sources,
// Kulturpunkt, is CC BY-SA 3.0 HR, and another, the Etnografski muzej, states
// no reuse licence at all; republishing either at /open, or showing it on a
// public screen that is itself the open tier, would misstate a licence in a
// filed grant application (area E preamble; docs/izvori.md). The other five
// `data.source` values are the City's own rows and ZET's, all under the
// Otvorena dozvola, and those alone may leave the session:
// registry.teaserSubset cuts the /api/teaser copy of the module down to them,
// and the kiosk card (app/src/layers/grad-teaser.ts) filters by the same
// predicate again, so the boundary holds even if a payload were ever handed
// to the screen unreduced. test/integration/feed-to-layers.test.ts drives the
// real fixtures through both.
//
// `data.source` values, not sub-fetcher ids: ZET's one sub-fetcher tags its
// two feeds 'zet-novosti' and 'zet-promet' (zet-rss.ts), so the item-level
// vocabulary is what a filter over items has to speak.
import type { FeedItem } from '../../schema';

export const OPEN_LICENCE_EVENT_SOURCES = ['skupstina', 'kvartovske', 'komunalne', 'zet-novosti', 'zet-promet'] as const;
export type OpenLicenceEventSource = (typeof OPEN_LICENCE_EVENT_SOURCES)[number];

const OPEN_SET: ReadonlySet<string> = new Set<string>(OPEN_LICENCE_EVENT_SOURCES);

/** True only for an item whose `data.source` is one of the Otvorena dozvola sources; an item with no readable source fails closed. */
export function isOpenLicenceEvent(item: Pick<FeedItem, 'data'>): boolean {
  const source = item.data?.source;
  return typeof source === 'string' && OPEN_SET.has(source);
}

/** The Otvorena dozvola subset of a merged dogadanja list, in its original order. */
export function openLicenceEvents<T extends Pick<FeedItem, 'data'>>(items: readonly T[]): T[] {
  return items.filter(isOpenLicenceEvent);
}
