import type { FeedItem } from './schema';

// What a module fetcher actually produces. The registry stamps module, tier,
// fetchedAt and attribution on top, so a module file can never disagree with
// the registry about which tier its items belong to.

export type ItemInput = Omit<FeedItem, 'module' | 'tier'>;

export interface FeedPayload {
  items: ItemInput[];
  /** The source's own publication timestamp, ISO 8601, when it publishes one. */
  sourceUpdatedAt?: string;
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
