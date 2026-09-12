import type { Attribution, FetchContext, ModuleSnapshot, SourceAvailability } from '../../schema';
import { sourceCoverage, type ItemInput } from '../../payload';
import { fetchEtnografski } from './etnografski';
import { fetchKomunalne } from './komunalne';
import { KULTURPUNKT_URL, fetchKulturpunkt } from './kulturpunkt';
import { fetchKvartovske } from './kvartovske';
import { fetchSkupstina } from './skupstina';
import { fetchZetRss } from './zet-rss';

// Six publishers, eight independently fetched endpoints. Counts alone cannot
// distinguish an empty response from an outage; sources carries that evidence.
// Each publisher's eligible rows are capped before merging.
export const DOGADANJA_SOURCE_TIMEOUT_MS = 6000;
export const DOGADANJA_SOURCE_CAP = 40;

export const DOGADANJA_ATTRIBUTION: Attribution = {
  text:
    'Šest izvora zagrebačkih događanja: Kulturpunkt (CC BY-SA 3.0 HR), Skupština Grada Zagreba, kvartovske novosti, ' +
    'plan komunalnih aktivnosti i ZET (Otvorena dozvola), Etnografski muzej; licenca i poveznica navedeni uz svaku stavku prema polju "source"',
  url: KULTURPUNKT_URL,
  licence: 'Više licenci, vidi izvor uz svaku stavku',
};

export type DogadanjaSourceId = 'kulturpunkt' | 'skupstina' | 'kvartovske' | 'komunalne' | 'zet-rss' | 'etnografski';

export interface DogadanjaSnapshot extends Omit<ModuleSnapshot, 'status' | 'staleSince'> {
  /** Legacy capped counts. Use sources, never these counts, to infer availability. */
  sourceCounts: Record<DogadanjaSourceId, number>;
}

function atMs(item: ItemInput): number | undefined {
  if (item.dateBasis === 'unknown' || !item.at) return undefined;
  const time = Date.parse(item.at);
  return Number.isFinite(time) ? time : undefined;
}

const zagrebDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Zagreb' });

/**
 * Current/upcoming events first, soonest start first; then dated updates/news
 * and past events, newest first; undated notices last in source order.
 * Returning 0 for undated ties deliberately preserves the publisher's order.
 */
export function compareDogadanja(a: ItemInput, b: ItemInput, now: Date): number {
  const aTime = atMs(a);
  const bTime = atMs(b);
  const rank = (item: ItemInput, at: number | undefined): number => {
    if (at === undefined) return 2;
    if (item.dateBasis !== 'event') return 1;
    const end = item.until ? Date.parse(item.until) : at;
    // Day-precision events remain today's events after their midnight start.
    const coarse = item.data?.precision === 'day' || item.data?.precision === 'range';
    const sameDay = coarse && (
      zagrebDay.format(new Date(at)) === zagrebDay.format(now) ||
      (Number.isFinite(end) && zagrebDay.format(new Date(end)) === zagrebDay.format(now))
    );
    return (Number.isFinite(end) && Math.max(at, end) >= now.getTime()) || sameDay ? 0 : 1;
  };
  const aRank = rank(a, aTime);
  const bRank = rank(b, bTime);
  if (aRank !== bRank) return aRank - bRank;
  if (aRank === 2) return 0;
  return aRank === 0 ? aTime! - bTime! : bTime! - aTime!;
}

export function capSource(items: ItemInput[], now: Date = new Date()): ItemInput[] {
  return [...items].sort((a, b) => compareDogadanja(a, b, now)).slice(0, DOGADANJA_SOURCE_CAP);
}

/** Bound the entire multi-request source, not just each individual request. */
export function raceTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const signal = AbortSignal.timeout(ms);
    const onTimeout = () => reject(new Error(`dogadanja: ${label} exceeded ${ms}ms`));
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

interface SourceResult {
  items: Omit<ItemInput, 'kind'>[];
  totalItems?: number;
  sources?: Record<string, SourceAvailability>;
}
interface SourceJob {
  id: DogadanjaSourceId;
  keys: readonly string[];
  run: (ctx: FetchContext) => Promise<SourceResult>;
}

// Explicit publisher precedence for undated rows, followed by their original
// listing order. No synthetic date or new data-vocabulary key encodes order.
const SOURCES: readonly SourceJob[] = [
  { id: 'kulturpunkt', keys: ['kulturpunkt'], run: fetchKulturpunkt },
  { id: 'skupstina', keys: ['skupstina'], run: fetchSkupstina },
  { id: 'kvartovske', keys: ['kvartovske'], run: fetchKvartovske },
  { id: 'komunalne', keys: ['komunalne'], run: fetchKomunalne },
  { id: 'zet-rss', keys: ['zet-novosti', 'zet-promet'], run: fetchZetRss },
  { id: 'etnografski', keys: ['etnografski-dogadjanja', 'etnografski-izlozbe'], run: fetchEtnografski },
];

export const DOGADANJA_AVAILABILITY_IDS = SOURCES.flatMap((source) => source.keys);

/** Map the museum's shared publisher identifier to its independently fetched endpoint. */
function availabilityKey(item: ItemInput): string {
  if (item.data?.source === 'etnografski') {
    return item.data.category === 'izlozba' ? 'etnografski-izlozbe' : 'etnografski-dogadjanja';
  }
  return String(item.data?.source ?? '');
}

export async function fetchDogadanja(ctx: FetchContext): Promise<DogadanjaSnapshot> {
  const now = ctx.now();
  const fetchedAt = now.toISOString();
  const settled = await Promise.allSettled(
    SOURCES.map((source) => raceTimeout(source.run(ctx), DOGADANJA_SOURCE_TIMEOUT_MS, source.id)),
  );
  if (settled.every((result) => result.status === 'rejected')) {
    throw new Error('dogadanja: all six sources failed');
  }

  const sourceCounts = {} as Record<DogadanjaSourceId, number>;
  const sources: Record<string, SourceAvailability> = {};
  const merged: ItemInput[] = [];
  settled.forEach((result, index) => {
    const { id, keys } = SOURCES[index];
    if (result.status === 'rejected') {
      sourceCounts[id] = 0;
      for (const key of keys) sources[key] = { status: 'down', itemCount: 0 };
      return;
    }

    const raw = result.value;
    const capped = capSource(raw.items.map((item) => ({ ...item, kind: 'event' })), now);
    sourceCounts[id] = capped.length;
    merged.push(...capped);
    const availability = raw.sources ?? {
      [id]: {
        status: 'live' as const, itemCount: raw.items.length, fetchedAt,
        ...(raw.totalItems !== undefined ? { totalItems: raw.totalItems } : {}),
      },
    };
    for (const key of keys) {
      sources[key] = {
        ...availability[key],
        itemCount: capped.filter((item) => availabilityKey(item) === key).length,
      };
    }
  });

  merged.sort((a, b) => compareDogadanja(a, b, now));
  return {
    module: 'dogadanja',
    tier: 'session',
    fetchedAt,
    attribution: DOGADANJA_ATTRIBUTION,
    items: merged.map((item) => ({ ...item, module: 'dogadanja', tier: 'session' })),
    sourceCounts,
    sources,
    coverage: sourceCoverage(sources),
  };
}
