import type { FeedItem, ModuleSnapshot, SourceAvailability } from './schema';

// What a module fetcher actually produces. The registry stamps module, tier,
// fetchedAt and attribution on top, so a module file can never disagree with
// the registry about which tier its items belong to.

export type ItemInput = Omit<FeedItem, 'module' | 'tier'>;

export interface FeedPayload {
  items: ItemInput[];
  /** The source's own publication timestamp, ISO 8601, when it publishes one. */
  sourceUpdatedAt?: string;
  sources?: Record<string, SourceAvailability>;
  coverage?: ModuleSnapshot['coverage'];
  /** When the producer knows the next change (the twin's next tick, R-TE4):
   *  the cache layer keeps the snapshot until then instead of a fixed ttl,
   *  so every colo turns over on the same beat. ISO 8601. */
  validUntil?: string;
}

/** A total is known only when every requested source supplied one. */
export function sourceCoverage(sources: Record<string, SourceAvailability>): NonNullable<ModuleSnapshot['coverage']> {
  const entries = Object.values(sources);
  const shown = entries.reduce((sum, source) => sum + source.itemCount, 0);
  const complete = entries.every((source) => source.status === 'live' && source.totalItems !== undefined);
  const total = complete ? entries.reduce((sum, source) => sum + source.totalItems!, 0) : undefined;
  return { shown, ...(total !== undefined ? { total } : {}), limited: total === undefined || total > shown };
}

/** WordPress totals describe all posts, not just the valid events on this page. */
export function pageTotal(response: Response, rowCount: number, pageSize: number): number | undefined {
  const header = response.headers.get('x-wp-total');
  if (header !== null && /^\d+$/.test(header)) {
    const total = Number(header);
    if (Number.isSafeInteger(total) && total >= rowCount) return total;
  }
  // A full page without a total may have further pages; do not claim completeness.
  return rowCount < pageSize ? rowCount : undefined;
}

/** FeedItem.data holds no undefined values; this drops the keys a source omitted. */
export function compactData(
  data: Record<string, string | number | boolean | undefined>,
): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}
