// R-08's attribution strings are templates ("{vrijeme}", "{datum}", "{naziv}",
// "{naslov}", "{broj}", "{godina}", "{id}"); this fills them from a live
// snapshot at the point something is rendered, so no brace ever reaches
// /hitno, a per-module /open/*.json body or the GeoJSON export (R-62).
//
// The static /open catalogue (catalog.ts's DCAT `dct:provenance`, and
// index-page.ts's human /open/ listing, which renders the same static
// OPEN_DATASETS) is deliberately excluded: it lists what every module WOULD
// say about itself, not a live reading, so R-08 keeps its template verbatim
// there. Everywhere else that shows a *live* snapshot's attribution — the
// human-readable line, not the static description — gets filled.
//
// Same algorithm as app/src/attribution.ts (the browser copy); the two stay
// separate files the way worker/open/time.ts and app/src/format.ts are two
// copies of the same Zagreb formatting, so neither side reaches across the
// build boundary. test/open/attribution.test.ts and test/app/attribution.test.ts
// share a fixture (test/fixtures/attribution-cases.ts) so both copies are
// proven identical, not just individually plausible.
import type { Attribution, FeedItem, ModuleSnapshot } from '../feed/schema';
import { findOpenDataset } from './catalog';
import { formatZagrebDateTimeWithYear } from './time';

function dataString(item: FeedItem | undefined, key: string): string | undefined {
  const value = item?.data?.[key];
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return undefined;
}

/** {vrijeme}: the source's own update time, or the fetch time labelled as
 *  such when the source publishes none (R-25). */
function timeValue(snapshot: Pick<ModuleSnapshot, 'sourceUpdatedAt' | 'fetchedAt'>): string | undefined {
  if (snapshot.sourceUpdatedAt) return formatZagrebDateTimeWithYear(new Date(snapshot.sourceUpdatedAt));
  if (snapshot.fetchedAt) return `dohvaćeno ${formatZagrebDateTimeWithYear(new Date(snapshot.fetchedAt))}`;
  return undefined;
}

/** {datum}: the publisher's own change date (sourceUpdatedAt) or nothing.
 *  It follows "posljednja izmjena", so our fetch time never stands in for it
 *  (PRODUCT.md principle 4; T3 of the companion brief). */
function dateValue(snapshot: Pick<ModuleSnapshot, 'sourceUpdatedAt' | 'fetchedAt'>): string | undefined {
  return snapshot.sourceUpdatedAt ? formatZagrebDateTimeWithYear(new Date(snapshot.sourceUpdatedAt)) : undefined;
}

/** {naziv}'s last resort when neither the item nor its category names a
 *  dataset: the /open catalogue's own title for the module. */
function moduleDatasetName(module: string): string | undefined {
  return findOpenDataset(module)?.title;
}

function datasetName(item: FeedItem | undefined): string | undefined {
  if (!item) return undefined;
  return dataString(item, 'dataset') ?? dataString(item, 'category') ?? moduleDatasetName(item.module);
}

type PlaceholderResolver = (
  snapshot: Pick<ModuleSnapshot, 'sourceUpdatedAt' | 'fetchedAt'>,
  item: FeedItem | undefined,
) => string | undefined;

const PLACEHOLDERS: Record<string, PlaceholderResolver> = {
  vrijeme: (snapshot) => timeValue(snapshot),
  datum: (snapshot) => dateValue(snapshot),
  naslov: (_snapshot, item) => item?.title,
  naziv: (_snapshot, item) => datasetName(item),
  broj: (_snapshot, item) => dataString(item, 'broj'),
  godina: (_snapshot, item) => dataString(item, 'godina'),
  id: (_snapshot, item) => item?.id,
};

/**
 * Fills every R-08 placeholder in `attribution.text` from the snapshot (and,
 * where the template needs one, a representative item): {vrijeme} from
 * sourceUpdatedAt or fetchedAt, {datum} from sourceUpdatedAt only, {naslov}
 * from item.title, {naziv} from item.data.dataset, else its category, else
 * the module's own dataset name, {broj}/{godina}/{id} from the act fields.
 * Whatever it cannot fill is removed together with its label (the plain
 * words between the preceding ", " and the placeholder, so ", posljednja
 * izmjena {datum}" goes whole when there is no source date) or else its
 * preceding separator (" "), and the result is trimmed — the function never
 * returns a string containing "{" or "}" or a label left without its value.
 */
export function fillAttribution(
  attribution: Attribution,
  snapshot: Pick<ModuleSnapshot, 'sourceUpdatedAt' | 'fetchedAt'>,
  item?: FeedItem,
): string {
  return attribution.text
    .replace(/(,\s[\p{L} ]*|\s)?\{(\w+)\}/gu, (_whole: string, sep: string | undefined, key: string) => {
      const value = PLACEHOLDERS[key]?.(snapshot, item);
      return value === undefined ? '' : `${sep ?? ''}${value}`;
    })
    .trim();
}
