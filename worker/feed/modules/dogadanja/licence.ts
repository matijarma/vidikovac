// The licence predicate of the dogadanja module, for /open/*.json alone.
//
// Kulturpunkt is CC BY-SA 3.0 HR and the Etnografski muzej states no reuse
// licence, so neither may be republished machine-readably under the Otvorena
// dozvola at /open. That is the whole reach of this predicate. Every source
// the app fetches is shown on every screen, public or paired, with its own
// credit (owner, 16 Sept 2026): a row on a wall with its source named is
// display with attribution, not republication.
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
