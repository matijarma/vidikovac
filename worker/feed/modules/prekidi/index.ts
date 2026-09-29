import type { FetchContext, SourceAvailability } from '../../schema';
import { sourceCoverage, type FeedPayload, type ItemInput } from '../../payload';
import { fetchHepOds } from './hep';
import type { CutsResult } from './common';
import { fetchVio } from './vio';

// Planned power and water cuts on a street, two publishers read independently (the shape of
// dogadanja/index.ts): HEP ODS Elektra Zagreb (electricity, with hours) and Vodoopskrba i odvodnja
// (water, whole days). Each has its own 6 s race; one that fails leaves the other live, reports itself
// 'down' in `sources`, and the cache layer serves its last good rows beside the fresh ones
// (worker/feed/source-recovery.ts reads `data.source`, which is the key of `sources` here).
// Both are unofficial views of a page that states no terms ("neslužbeni prikaz").

export const PREKIDI_SOURCE_TIMEOUT_MS = 6000;

export type PrekidiSourceId = 'hep-ods' | 'vio';

interface SourceJob {
  id: PrekidiSourceId;
  run: (ctx: FetchContext) => Promise<CutsResult>;
}

const SOURCES: readonly SourceJob[] = [
  { id: 'hep-ods', run: fetchHepOds },
  { id: 'vio', run: fetchVio },
];

/** Bounds a source's whole run, not just each request of it. */
function raceTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const signal = AbortSignal.timeout(ms);
    const onTimeout = () => reject(new Error(`prekidi: ${label} exceeded ${ms}ms`));
    signal.addEventListener('abort', onTimeout, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onTimeout);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onTimeout);
        reject(error);
      },
    );
  });
}

export async function fetchPrekidi(ctx: FetchContext): Promise<FeedPayload> {
  const fetchedAt = ctx.now().toISOString();
  const settled = await Promise.allSettled(SOURCES.map((source) => raceTimeout(source.run(ctx), PREKIDI_SOURCE_TIMEOUT_MS, source.id)));
  if (settled.every((result) => result.status === 'rejected')) throw new Error('prekidi: both sources failed');
  const sources: Record<string, SourceAvailability> = {};
  const items: ItemInput[] = [];
  settled.forEach((result, index) => {
    const { id } = SOURCES[index]!;
    if (result.status === 'rejected') {
      sources[id] = { status: 'down', itemCount: 0 };
      return;
    }
    items.push(...result.value.items);
    // `totalItems` is every street the source named for the days read: what the street index could not place is
    // the difference, and it makes the coverage honest about not being the whole list.
    sources[id] = { status: 'live', itemCount: result.value.items.length, fetchedAt, totalItems: result.value.total };
  });
  items.sort((a, b) => Date.parse(a.at!) - Date.parse(b.at!) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { items, sources, coverage: sourceCoverage(sources) };
}
