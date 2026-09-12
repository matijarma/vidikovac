import type { Attribution, FetchContext, ModuleSnapshot } from '../../schema';
import type { ItemInput } from '../../payload';
import { fetchEtnografski } from './etnografski';
import type { EtnografskiEvent } from './etnografski';
import { fetchKomunalne } from './komunalne';
import type { KomunalneEvent } from './komunalne';
import { KULTURPUNKT_URL, fetchKulturpunkt } from './kulturpunkt';
import type { KulturpunktEvent } from './kulturpunkt';
import { fetchKvartovske } from './kvartovske';
import type { KvartovskeEvent } from './kvartovske';
import { fetchSkupstina } from './skupstina';
import type { SkupstinaEvent } from './skupstina';
import { fetchZetRss } from './zet-rss';
import type { ZetRssEvent } from './zet-rss';

// The dogadanja module: six independent sub-fetchers (E2-E5), assembled here
// into the one `ModuleId 'dogadanja'` snapshot every panel and the kiosk
// teaser eventually read (E7-E9, wave 2). Session tier, ttl 900 s, maxStale
// 86400 s -- a licence decision, not taste: Kulturpunkt is CC BY-SA 3.0 HR,
// and republishing it at the open tier would misstate that licence (area E
// preamble). Every item's nine-key `data` vocabulary is schema.ts's
// `DATA_KEYS.event`, added in this same commit alongside this file.
//
// THE RESILIENCE CONTRACT (the brief's own words): "All six sub-fetchers run
// behind one Promise.allSettled ... A rejected source contributes nothing ...
// it never throws the module down." Concretely: `fetchDogadanja` NEVER
// throws, regardless of how many (even all six) of its sources reject --
// unlike every other module in this project, whose fetcher "must throw on any
// upstream failure" (schema.ts) so `worker/feed/cache.ts` can fall back to a
// KV last-good copy and mark the snapshot 'stale'/'down'. `cache.ts` stamps
// `status: 'live'` onto ANY snapshot its fetcher call didn't throw for
// (`{ ...fresh, status: 'live' }`, unconditionally) -- there is no way for a
// module's own fetcher to ask for 'stale' through that field, and `cache.ts`
// is neither owned by area E nor in this task's file list to change. So the
// brief's "lowers the snapshot's status to stale" is implemented the one way
// this task's own files can express it: `sourceCounts` on the snapshot (an
// extra property beyond `ModuleSnapshot`'s own declared shape -- schema.ts's
// edit here is pinned to `ModuleId`/`ItemKind`/`DATA_KEYS.event` only, R-O3,
// so this can't be a new field on that interface either). A source that
// contributed 0 items this cycle -- because it rejected, or because it
// genuinely had nothing -- reads as exactly that in `sourceCounts`, which is
// the actual, useful "did a source go quiet" signal `/stats` and the panel
// need; a literal `status:'stale'` enum flip was never reachable from here.
// See the task report's Rulings for the fuller reasoning.
//
// THE PER-SOURCE CAP: none of these six sources is rate-limited by anything
// this module controls, and one of them, komunalne (E4), fetches its whole
// current register with no page size at all -- 510 valid rows in the real
// fixture (test/fixtures/dogadanja/sources.json), dwarfing every other
// source's few dozen. `capSource` below sorts each source's OWN items by
// start time (newest/soonest first -- see byStartTimeDesc) and keeps only the
// most recent `DOGADANJA_SOURCE_CAP` of them, per source, before merging --
// not one single cap on the final merged list. A single global cap applied
// only after merging would let komunalne's hundreds of old, already-settled
// works entries crowd out every other source's few, dated items entirely
// under an ascending sort, or (under the descending sort this file actually
// uses) would still leave the *dateless* ZET notices structurally
// disadvantaged, since they always sort last and would be the first thing a
// single shared cap discarded. Capping per source first guarantees every one
// of the six always gets its own reserved share of the snapshot, regardless
// of how the other five behave that cycle.
//
// THE SORT: descending by `at` -- most imminent/most recently touched first,
// the same direction `hrt-news.ts` already merges its own two feeds by. Two
// consequences worth naming: (1) a source with no `at` at all (ZET's two
// notice feeds, E5 -- "headline and link only", never a date) sorts after
// every dated item, via `-Infinity`; (2) this is what makes a purely
// date-driven sort safe against komunalne's inherently past-only `at` (its
// last-change date can never be in the future): any genuinely upcoming
// Kulturpunkt/Skupština/Etnografski item, whose `at` is either today or in
// the future, automatically outranks every komunalne row, with no
// source-aware special-casing needed.

export const DOGADANJA_SOURCE_TIMEOUT_MS = 6000;
export const DOGADANJA_SOURCE_CAP = 40;

// Kulturpunkt's own wp-json endpoint stands in for the module's single
// required Attribution.url: no one URL represents all six sources (they sit
// under two different licences -- CC BY-SA 3.0 HR for Kulturpunkt, Otvorena
// dozvola for the other five), so, like `hrt-news`'s own two-feed module
// before it, this points at one real, already-fetched, already-robots-checked
// endpoint rather than an invented "portal" URL. Per-item attribution is a
// lookup keyed by each item's own `data.source` (E2's report names this
// explicitly); that lookup, and this module's one row in docs/izvori.md, is
// E7's and E9's job.
export const DOGADANJA_ATTRIBUTION: Attribution = {
  text:
    'Šest izvora zagrebačkih događanja: Kulturpunkt (CC BY-SA 3.0 HR), Skupština Grada Zagreba, kvartovske novosti, ' +
    'plan komunalnih aktivnosti i ZET (Otvorena dozvola), Etnografski muzej; licenca i poveznica navedeni uz svaku stavku prema polju "source"',
  url: KULTURPUNKT_URL,
  licence: 'Više licenci, vidi izvor uz svaku stavku',
};

export type DogadanjaSourceId = 'kulturpunkt' | 'skupstina' | 'kvartovske' | 'komunalne' | 'zet-rss' | 'etnografski';

/**
 * `ModuleSnapshot` minus the two fields only `worker/feed/cache.ts` may set,
 * plus `sourceCounts` -- an ordinary extra property, not part of that
 * interface (see this file's header). A `DogadanjaSnapshot` is always a
 * valid value wherever `Omit<ModuleSnapshot, 'status' | 'staleSince'>` is
 * expected (TypeScript's structural typing, return-type covariance): this is
 * what lets `registry.ts` register `fetchDogadanja` as this module's
 * `ModuleSpec['fetcher']` directly, bypassing the generic `defineModule`
 * helper the other nine modules share (that helper builds its own object
 * literal from a plain `FeedPayload` and would silently drop `sourceCounts`).
 */
export interface DogadanjaSnapshot extends Omit<ModuleSnapshot, 'status' | 'staleSince'> {
  sourceCounts: Record<DogadanjaSourceId, number>;
}

/** Milliseconds since the epoch to sort by; `-Infinity` for a dateless item, so it always sorts last. */
function atMs(item: ItemInput): number {
  if (!item.at) return -Infinity;
  const parsed = Date.parse(item.at);
  return Number.isFinite(parsed) ? parsed : -Infinity;
}

function byStartTimeDesc(a: ItemInput, b: ItemInput): number {
  return atMs(b) - atMs(a);
}

/** Sorts one source's own items newest/soonest first, then keeps only the top `DOGADANJA_SOURCE_CAP`. Exported for its own direct test. */
export function capSource(items: ItemInput[]): ItemInput[] {
  return [...items].sort(byStartTimeDesc).slice(0, DOGADANJA_SOURCE_CAP);
}

/**
 * Races `promise` against a `ms`-long `AbortSignal.timeout`, so one source
 * that issues several of its own sequential requests (skupstina.ts fetches
 * the rokovnik page and then every dated row's own session page, one at a
 * time) can never hold up the whole `Promise.allSettled` past `ms`, even
 * though `worker/feed/http.ts` already time-boxes each *individual* upstream
 * request to 6 s on its own -- that per-request ceiling doesn't bound a
 * multi-request sub-fetcher's *total* wall time. Exported for its own direct,
 * fast test (a real 6 s wait has no place in this suite).
 */
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

function fromKulturpunkt(events: readonly KulturpunktEvent[]): ItemInput[] {
  return events.map((event) => ({
    id: event.id,
    kind: 'event',
    title: event.title,
    link: event.link,
    at: event.at,
    ...(event.until ? { until: event.until } : {}),
    data: { source: event.data.source, category: event.data.category, precision: event.data.precision },
  }));
}

function fromSkupstina(events: readonly SkupstinaEvent[]): ItemInput[] {
  return events.map((event) => ({
    id: event.id,
    kind: 'event',
    title: event.title,
    link: event.link,
    at: event.at,
    ...(event.until ? { until: event.until } : {}),
    data: {
      source: event.data.source,
      organiser: event.data.organiser,
      category: event.data.category,
      precision: event.data.precision,
      ...(event.data.venue ? { venue: event.data.venue } : {}),
      ...(event.data.live ? { live: event.data.live } : {}),
    },
  }));
}

function fromKvartovske(events: readonly KvartovskeEvent[]): ItemInput[] {
  return events.map((event) => ({
    id: event.id,
    kind: 'event',
    title: event.title,
    link: event.link,
    at: event.at,
    data: { source: event.data.source, precision: event.data.precision },
  }));
}

function fromKomunalne(events: readonly KomunalneEvent[]): ItemInput[] {
  return events.map((event) => ({
    id: event.id,
    kind: 'event',
    title: event.title,
    summary: event.summary,
    at: event.at,
    ...(event.geo ? { geo: event.geo } : {}),
    data: {
      source: event.data.source,
      phase: event.data.phase,
      status: event.data.status,
      amount: event.data.amount,
      precision: event.data.precision,
    },
  }));
}

function fromZetRss(events: readonly ZetRssEvent[]): ItemInput[] {
  return events.map((event) => ({
    id: event.id,
    kind: 'event',
    title: event.title,
    link: event.link,
    data: { source: event.data.source },
  }));
}

function fromEtnografski(events: readonly EtnografskiEvent[]): ItemInput[] {
  return events.map((event) => ({
    id: event.id,
    kind: 'event',
    title: event.title,
    link: event.link,
    at: event.at,
    until: event.until,
    data: {
      source: event.data.source,
      category: event.data.category,
      venue: event.data.venue,
      precision: event.data.precision,
    },
  }));
}

interface SourceJob {
  id: DogadanjaSourceId;
  run: (ctx: FetchContext) => Promise<ItemInput[]>;
}

// Fixed order, so two items tied on `at` (JS's stable sort keeps ties in
// input order) always break the same deterministic way.
const SOURCES: readonly SourceJob[] = [
  { id: 'kulturpunkt', run: async (ctx) => fromKulturpunkt((await fetchKulturpunkt(ctx)).items) },
  { id: 'skupstina', run: async (ctx) => fromSkupstina((await fetchSkupstina(ctx)).items) },
  { id: 'kvartovske', run: async (ctx) => fromKvartovske((await fetchKvartovske(ctx)).items) },
  { id: 'komunalne', run: async (ctx) => fromKomunalne((await fetchKomunalne(ctx)).items) },
  { id: 'zet-rss', run: async (ctx) => fromZetRss((await fetchZetRss(ctx)).items) },
  { id: 'etnografski', run: async (ctx) => fromEtnografski((await fetchEtnografski(ctx)).items) },
];

export async function fetchDogadanja(ctx: FetchContext): Promise<DogadanjaSnapshot> {
  const settled = await Promise.allSettled(
    SOURCES.map((source) => raceTimeout(source.run(ctx), DOGADANJA_SOURCE_TIMEOUT_MS, source.id)),
  );

  const sourceCounts = {} as Record<DogadanjaSourceId, number>;
  const merged: ItemInput[] = [];
  settled.forEach((result, index) => {
    const { id } = SOURCES[index];
    if (result.status === 'fulfilled') {
      const capped = capSource(result.value);
      sourceCounts[id] = capped.length;
      merged.push(...capped);
    } else {
      // A rejected source (upstream failure, or this file's own per-source
      // timeout above) contributes nothing and is never retried inline here
      // -- it simply reads as 0 in sourceCounts, the "went quiet" signal the
      // brief asks for, rather than failing the whole module.
      sourceCounts[id] = 0;
    }
  });

  merged.sort(byStartTimeDesc);

  return {
    module: 'dogadanja',
    tier: 'session',
    fetchedAt: ctx.now().toISOString(),
    attribution: DOGADANJA_ATTRIBUTION,
    items: merged.map((item) => ({ ...item, module: 'dogadanja', tier: 'session' })),
    sourceCounts,
  };
}
