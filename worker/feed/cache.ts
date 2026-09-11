import type { Env } from '../env';
import type { ServerEvent } from '../protocol';
import type { ModuleId, ModuleSnapshot, ModuleSpec } from './schema';
import { MODULES, WARM_MODULES, moduleSpec } from './registry';
import { makeFetchContext } from './http';
import { recordMetric } from '../metrics';

// Three states, never blank. A module is live while the Cache API holds a copy
// younger than its ttl; stale while the KV last-good copy is younger than
// maxStale; down otherwise, with an empty item list and its attribution intact.

/** The Cache API keys on a URL and these snapshots have none, so they get a synthetic one. */
export const CACHE_ORIGIN = 'https://feed.vidikovac.internal';
export const KV_PREFIX = 'feed:';
/** How long a degraded answer is cached, so a dead source is not called per request. */
export const DEGRADED_CACHE_SECONDS = 60;

export function cacheKey(id: ModuleId): string {
  return `${CACHE_ORIGIN}/${id}`;
}

export function kvKey(id: ModuleId): string {
  return `${KV_PREFIX}${id}`;
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
  if (cached) return (await cached.json()) as ModuleSnapshot;
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
    const fresh = await spec.fetcher(makeFetchContext(clock));
    const snapshot: ModuleSnapshot = { ...fresh, status: 'live' };
    const body = JSON.stringify(snapshot);
    ctx.waitUntil(store(spec.id, body, spec.ttl));
    ctx.waitUntil(env.FEED.put(kvKey(spec.id), body, { expirationTtl: Math.max(60, spec.maxStale) }));
    metric(env, 'source_fetch', spec.id, 'ok');
    return snapshot;
  } catch {
    const lastGood = await env.FEED.get<ModuleSnapshot>(kvKey(spec.id), 'json').catch(() => null);
    const fetchedAt = lastGood ? Date.parse(lastGood.fetchedAt) : Number.NaN;
    // maxStale is measured from the last good fetch, not from the first failure:
    // data nobody could refresh for an hour is useless even if it failed a second ago.
    if (lastGood && Number.isFinite(fetchedAt) && now.getTime() - fetchedAt <= spec.maxStale * 1000) {
      const snapshot: ModuleSnapshot = {
        ...lastGood,
        status: 'stale',
        staleSince: new Date(fetchedAt).toISOString(),
      };
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
  return {
    module: spec.id,
    tier: spec.tier,
    status: 'down',
    fetchedAt: now.toISOString(),
    attribution: spec.attribution,
    items: [],
  };
}
