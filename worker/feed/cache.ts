import type { Env } from '../env';
import type { TwinDO } from '../do/twin-do';
import type { ServerEvent } from '../protocol';
import type { FeedPayload } from './payload';
import type { ModuleId, ModuleSnapshot, ModuleSpec } from './schema';
import { TWIN_DO_NAME } from '../twin/twin-name';
import { MODULES, WARM_MODULES, moduleSpec } from './registry';
import { makeFetchContext } from './http';
import { briefAll } from './brief';
import { recordMetric } from '../metrics';
import { DOGADANJA_AVAILABILITY_IDS } from './modules/dogadanja';
import { CETVRTI_DATASET, ZBORNA_MJESTA_LAYER } from './modules/ckan-geo';
import { expireStaleSources, recoverPartialSources } from './source-recovery';

// Three states, never blank. A module is live while the Cache API holds a copy
// younger than its ttl; stale while the KV last-good copy is younger than
// maxStale; down otherwise, with an empty item list and its attribution intact.

/** The Cache API keys on a URL and these snapshots have none, so they get a synthetic one. */
export const CACHE_ORIGIN = 'https://feed.vidikovac.internal';
export const KV_PREFIX = 'feed:';
/** How long a degraded answer is cached, so a dead source is not called per request. */
export const DEGRADED_CACHE_SECONDS = 60;
/** The longest a producer's own `validUntil` may hold a Cache API entry: the
 *  twin's next tick is at most 12 s away (clock.ts), so anything past a
 *  minute is a skewed clock, and a colo must not sit on one frame for long. */
export const VALID_UNTIL_CAP_SECONDS = 60;

export function cacheKey(id: ModuleId): string {
  return `${CACHE_ORIGIN}/${id}`;
}

export function kvKey(id: ModuleId): string {
  return `${KV_PREFIX}${id}`;
}

function sourceKeys(id: ModuleId): readonly string[] {
  return id === 'dogadanja' ? DOGADANJA_AVAILABILITY_IDS
    : id === 'ckan-geo' ? [CETVRTI_DATASET, ZBORNA_MJESTA_LAYER] : [];
}

/** Old last-good copies must not reintroduce the retired positional calendar. */
function withoutSyntheticNoticeDates(snapshot: ModuleSnapshot): ModuleSnapshot {
  if (snapshot.module !== 'dogadanja') return snapshot;
  return {
    ...snapshot,
    items: snapshot.items.map((item) => {
      if (item.data?.source !== 'kvartovske') return item;
      const { at: _at, until: _until, ...notice } = item;
      const { precision: _precision, ...data } = item.data;
      return { ...notice, dateBasis: 'unknown', data };
    }),
  };
}

/** The twin's payload, for the module it feeds (R-TE8). A type-only import
 *  of the class keeps 'cloudflare:workers' out of this module's graph. */
function twinPublish(env: Env): () => Promise<FeedPayload> {
  return () => {
    const namespace = env.TWIN_DO as DurableObjectNamespace<TwinDO>;
    // The RPC stub's inferred return type widens the wire's tuples (HistoryFix,
    // PathKnot) to plain arrays; the payload the twin builds is a FeedPayload
    // and is serialised as one, so the cast restores what serialisation kept.
    return namespace.get(namespace.idFromName(TWIN_DO_NAME)).publish() as unknown as Promise<FeedPayload>;
  };
}

/** Seconds a live snapshot stays in the Cache API: until the producer's own
 *  `validUntil` when it names one (R-TE4), capped, else the module's ttl. */
function liveCacheSeconds(spec: ModuleSpec, snapshot: ModuleSnapshot, nowMs: number): number {
  const until = snapshot.validUntil ? Date.parse(snapshot.validUntil) : Number.NaN;
  if (!Number.isFinite(until)) return spec.ttl;
  return Math.min(VALID_UNTIL_CAP_SECONDS, Math.max(1, Math.ceil((until - nowMs) / 1000)));
}

export interface FeedCacheDeps {
  /** Counter sink; defaults to worker/metrics.ts. */
  recordMetric?: (env: Env, event: ServerEvent, dim1?: string, dim2?: string) => void;
  /** Clock; defaults to the system clock. */
  now?: () => Date;
}

export async function getModule(
  env: Env,
  ctx: ExecutionContext,
  id: ModuleId,
  deps: FeedCacheDeps = {},
): Promise<ModuleSnapshot> {
  const spec = moduleSpec(id);
  const cached = await caches.default.match(new Request(cacheKey(id)));
  if (cached) {
    const snapshot = (await cached.json()) as ModuleSnapshot;
    // Older composite caches have no independent availability evidence.
    // Refresh them once; on failure KV remains available through the normal path.
    if (snapshot.status !== 'live' || sourceKeys(id).every((key) => snapshot.sources?.[key])) {
      return expireStaleSources(withoutSyntheticNoticeDates(snapshot), (deps.now ?? (() => new Date()))().getTime(), spec.maxStale);
    }
  }
  return refresh(env, ctx, spec, deps);
}

export async function getModules(
  env: Env,
  ctx: ExecutionContext,
  ids: ModuleId[],
  deps: FeedCacheDeps = {},
): Promise<ModuleSnapshot[]> {
  const clock = deps.now ?? (() => new Date());
  const settled = await Promise.allSettled(ids.map((id) => getModule(env, ctx, id, deps)));
  return settled.map((result, index) => {
    if (result.status === 'fulfilled') return result.value;
    const spec = MODULES[ids[index]];
    if (!spec) throw result.reason;
    return down(spec, clock());
  });
}

/** Cron target: pull every module the five-minute schedule can stay ahead of into cache and KV. */
export async function warmFeeds(env: Env, ctx: ExecutionContext, deps: FeedCacheDeps = {}): Promise<void> {
  await Promise.allSettled(WARM_MODULES.map((id) => getModule(env, ctx, id, deps)));
}

async function refresh(
  env: Env,
  ctx: ExecutionContext,
  spec: ModuleSpec,
  deps: FeedCacheDeps,
): Promise<ModuleSnapshot> {
  const clock = deps.now ?? (() => new Date());
  const metric = deps.recordMetric ?? recordMetric;
  const now = clock();

  try {
    const fresh = await spec.fetcher(makeFetchContext(
      clock,
      spec.twin ? twinPublish(env) : undefined,
      // briefAll itself decides whether a brief is possible (binding, test
      // environment) and never rejects, so a module always sees the seam. Its
      // KV writes ride the same ExecutionContext as this module's own, so
      // remembering a brief never delays the fetch that produced it.
      (texts, kind) => briefAll(env, texts, kind, (promise) => ctx.waitUntil(promise)),
    ));
    // A composite module is stale when one of its sources is; the twin's module
    // is not (R-TE5): its status is the twin's, its source's silence its own.
    const partial = spec.degradeOnSources !== false && Object.values(fresh.sources ?? {}).some((source) => source.status !== 'live');
    let snapshot: ModuleSnapshot = {
      ...fresh,
      status: partial ? 'stale' : 'live',
      ...(partial ? { staleSince: now.toISOString() } : {}),
    };
    if (partial) {
      const previous = await env.FEED.get<ModuleSnapshot>(kvKey(spec.id), 'json').catch(() => null);
      snapshot = recoverPartialSources(snapshot, previous ? withoutSyntheticNoticeDates(previous) : null, now.getTime(), spec.maxStale);
    }
    const body = JSON.stringify(snapshot);
    ctx.waitUntil(store(spec.id, body, partial ? Math.min(DEGRADED_CACHE_SECONDS, spec.ttl) : liveCacheSeconds(spec, snapshot, now.getTime())));
    ctx.waitUntil(env.FEED.put(kvKey(spec.id), body, { expirationTtl: Math.max(60, spec.maxStale) }));
    metric(env, 'source_fetch', spec.id, partial ? 'partial' : 'ok');
    return snapshot;
  } catch {
    const saved = await env.FEED.get<ModuleSnapshot>(kvKey(spec.id), 'json').catch(() => null);
    const lastGood = saved ? withoutSyntheticNoticeDates(saved) : null;
    const fetchedAt = lastGood ? Date.parse(lastGood.fetchedAt) : Number.NaN;
    // maxStale is measured from the last good fetch, not from the first failure:
    // data nobody could refresh for an hour is useless even if it failed a second ago.
    if (lastGood && Number.isFinite(fetchedAt) && now.getTime() - fetchedAt <= spec.maxStale * 1000) {
      const snapshot: ModuleSnapshot = expireStaleSources({
        ...lastGood,
        status: 'stale',
        staleSince: new Date(fetchedAt).toISOString(),
        // A source from the old copy is no longer live merely because another
        // source happened to work during that old fetch. Keep previous downs.
        ...(lastGood.sources ? {
          sources: Object.fromEntries(Object.entries(lastGood.sources).map(([key, source]) => [
            key, { ...source, status: source.status === 'down' ? 'down' : 'stale' },
          ])),
        } : {}),
        ...(lastGood.coverage ? { coverage: { ...lastGood.coverage, limited: true } } : {}),
      }, now.getTime(), spec.maxStale);
      ctx.waitUntil(store(spec.id, JSON.stringify(snapshot), DEGRADED_CACHE_SECONDS));
      metric(env, 'source_fetch', spec.id, 'stale');
      return snapshot;
    }
    const snapshot = down(spec, now);
    ctx.waitUntil(store(spec.id, JSON.stringify(snapshot), DEGRADED_CACHE_SECONDS));
    metric(env, 'source_fetch', spec.id, 'error');
    return snapshot;
  }
}

async function store(id: ModuleId, body: string, seconds: number): Promise<void> {
  await caches.default.put(
    new Request(cacheKey(id)),
    new Response(body, {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': `s-maxage=${seconds}`,
      },
    }),
  );
}

function down(spec: ModuleSpec, now: Date): ModuleSnapshot {
  const keys = sourceKeys(spec.id);
  return {
    module: spec.id,
    tier: spec.tier,
    status: 'down',
    fetchedAt: now.toISOString(),
    attribution: spec.attribution,
    items: [],
    ...(keys.length ? {
      sources: Object.fromEntries(keys.map((key) => [key, { status: 'down' as const, itemCount: 0 }])),
      coverage: { shown: 0, limited: true },
    } : {}),
  };
}
