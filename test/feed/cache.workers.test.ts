import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../../worker/env';
import type { ServerEvent } from '../../worker/protocol';
import type { ModuleId, ModuleSnapshot } from '../../worker/feed/schema';
import { cacheKey, getModule, getModules, kvKey, warmFeeds } from '../../worker/feed/cache';
import { MODULES, clearFetcherOverrides, setFetcherForTest } from '../../worker/feed/registry';

const testEnv = env as unknown as Env;
const NOW = new Date('2026-09-11T10:00:00.000Z');
const now = () => NOW;

let events: string[][] = [];
const sink = (_env: Env, event: ServerEvent, dim1?: string, dim2?: string) => {
  events.push([event, dim1 ?? '', dim2 ?? '']);
};
const deps = { now, recordMetric: sink };

function goodSnapshot(id: ModuleId, fetchedAt: string): Omit<ModuleSnapshot, 'status' | 'staleSince'> {
  const spec = MODULES[id];
  return {
    module: id,
    tier: spec.tier,
    fetchedAt,
    sourceUpdatedAt: fetchedAt,
    attribution: spec.attribution,
    items: [{ id: 'x1', module: id, kind: 'poi', tier: spec.tier, title: 'Jedna stavka' }],
  };
}

async function reset(...ids: ModuleId[]): Promise<void> {
  for (const id of ids) {
    await caches.default.delete(new Request(cacheKey(id)));
    await testEnv.FEED.delete(kvKey(id));
  }
}

beforeEach(async () => {
  events = [];
  clearFetcherOverrides();
  await reset('emsc', 'prometnice', 'zet-rt', 'dhmz-cap', 'dogadanja', 'hrt-news', 'ckan-geo');
});

describe('getModule', () => {
  it('refreshes legacy composite caches and strips retired Kvartovske dates even from a KV fallback', async () => {
    const old = {
      ...goodSnapshot('dogadanja', NOW.toISOString()), status: 'live',
      items: [{
        id: 'kvartovske:136727', module: 'dogadanja', tier: 'session', kind: 'event',
        title: 'Hop-in kino na Jarunu', at: '2026-09-11T22:00:00Z',
        data: { source: 'kvartovske', precision: 'day' },
      }],
    };
    await caches.default.put(new Request(cacheKey('dogadanja')), new Response(JSON.stringify(old), {
      headers: { 'cache-control': 's-maxage=900' },
    }));
    await testEnv.FEED.put(kvKey('dogadanja'), JSON.stringify(old));
    let calls = 0;
    setFetcherForTest('dogadanja', async () => { calls += 1; throw new Error('unreachable'); });
    const ctx = createExecutionContext();
    const result = await getModule(testEnv, ctx, 'dogadanja', deps);
    await waitOnExecutionContext(ctx);
    expect(calls).toBe(1);
    expect(result.status).toBe('stale');
    expect(result.items[0]).toMatchObject({ id: 'kvartovske:136727', dateBasis: 'unknown', data: { source: 'kvartovske' } });
    expect(result.items[0]).not.toHaveProperty('at');
    expect(result.items[0].data).not.toHaveProperty('precision');
    const retry = createExecutionContext();
    expect((await getModule(testEnv, retry, 'dogadanja', deps)).items).toEqual(result.items);
    await waitOnExecutionContext(retry);
    expect(calls).toBe(1); // the legacy fallback still gets the normal short retry cache
  });

  it('preserves partial subsource metadata, uses a short retry cache, and marks old surviving sources stale on total failure', async () => {
    const sources = {
      'HRT vijesti': { status: 'live' as const, itemCount: 1, totalItems: 25, fetchedAt: NOW.toISOString(), sourceUpdatedAt: '2026-09-11T09:00:00Z' },
      'Radio Sljeme': { status: 'down' as const, itemCount: 0, fetchedAt: NOW.toISOString() },
    };
    const coverage = { shown: 1, limited: true };
    setFetcherForTest('hrt-news', async () => ({ ...goodSnapshot('hrt-news', NOW.toISOString()), sources, coverage }));
    const ctx1 = createExecutionContext();
    const partial = await getModule(testEnv, ctx1, 'hrt-news', deps);
    await waitOnExecutionContext(ctx1);
    expect(partial.status).toBe('stale');
    expect(partial.sources).toEqual(sources);
    expect(partial.coverage).toEqual(coverage);
    expect(events).toEqual([['source_fetch', 'hrt-news', 'partial']]);
    const stored = await caches.default.match(new Request(cacheKey('hrt-news')));
    expect(stored?.headers.get('cache-control')).toBe('s-maxage=60');

    await caches.default.delete(new Request(cacheKey('hrt-news')));
    setFetcherForTest('hrt-news', async () => { throw new Error('all feeds unreachable'); });
    const ctx2 = createExecutionContext();
    const fallback = await getModule(testEnv, ctx2, 'hrt-news', {
      ...deps, now: () => new Date(NOW.getTime() + 120_000),
    });
    await waitOnExecutionContext(ctx2);
    expect(fallback.status).toBe('stale');
    expect(fallback.items).toEqual(partial.items);
    expect(fallback.sources?.['HRT vijesti']).toEqual({ ...sources['HRT vijesti'], status: 'stale' });
    expect(fallback.sources?.['Radio Sljeme'].status).toBe('down');
    expect(fallback.fetchedAt).toBe(NOW.toISOString());
    expect(fallback.coverage).toEqual(coverage);
    // The last successful partial response is not overwritten by a failed fetch.
    const kv = await testEnv.FEED.get<ModuleSnapshot>(kvKey('hrt-news'), 'json');
    expect(kv?.sources?.['HRT vijesti'].status).toBe('live');
  });

  it('allows a verified all-empty composite response to replace old data without calling it down', async () => {
    const sources = {
      'gradske-cetvrti': { status: 'live' as const, itemCount: 0, totalItems: 0 },
      'zborna-mjesta': { status: 'live' as const, itemCount: 0, totalItems: 0 },
    };
    setFetcherForTest('ckan-geo', async () => ({
      ...goodSnapshot('ckan-geo', NOW.toISOString()), items: [], sources, coverage: { shown: 0, total: 0, limited: false },
    }));
    const ctx = createExecutionContext();
    const result = await getModule(testEnv, ctx, 'ckan-geo', deps);
    await waitOnExecutionContext(ctx);
    expect(result.status).toBe('live');
    expect(result.coverage).toEqual({ shown: 0, total: 0, limited: false });
    expect(result.sources).toEqual(sources);
    expect((await testEnv.FEED.get<ModuleSnapshot>(kvKey('ckan-geo'), 'json'))?.items).toEqual([]);
  });

  it('reports every composite endpoint down when no last-good copy exists', async () => {
    for (const id of ['ckan-geo', 'hrt-news', 'dogadanja'] as const) {
      setFetcherForTest(id, async () => { throw new Error('unavailable'); });
      const ctx = createExecutionContext();
      const result = await getModule(testEnv, ctx, id, deps);
      await waitOnExecutionContext(ctx);
      expect(result.status).toBe('down');
      expect(result.coverage).toEqual({ shown: 0, limited: true });
      expect(Object.values(result.sources!).every((source) => source.status === 'down' && source.itemCount === 0)).toBe(true);
      expect(Object.keys(result.sources!).length).toBe(id === 'dogadanja' ? 8 : 2);
    }
  });

  it('fetches live, serves the next call from the Cache API and writes the KV last good', async () => {
    let calls = 0;
    setFetcherForTest('emsc', async (ctx) => {
      calls += 1;
      return goodSnapshot('emsc', ctx.now().toISOString());
    });

    const ctx1 = createExecutionContext();
    const first = await getModule(testEnv, ctx1, 'emsc', deps);
    await waitOnExecutionContext(ctx1);

    expect(first.status).toBe('live');
    expect(first.fetchedAt).toBe('2026-09-11T10:00:00.000Z');
    expect(first.items).toHaveLength(1);
    expect(calls).toBe(1);

    const stored = await caches.default.match(new Request(cacheKey('emsc')));
    expect(stored?.headers.get('cache-control')).toBe('s-maxage=60');

    const lastGood = await testEnv.FEED.get<ModuleSnapshot>(kvKey('emsc'), 'json');
    expect(lastGood?.status).toBe('live');
    expect(lastGood?.fetchedAt).toBe('2026-09-11T10:00:00.000Z');

    const ctx2 = createExecutionContext();
    const second = await getModule(testEnv, ctx2, 'emsc', deps);
    await waitOnExecutionContext(ctx2);
    expect(calls).toBe(1);
    expect(second.status).toBe('live');
    expect(events).toEqual([['source_fetch', 'emsc', 'ok']]);
  });

  it('serves the KV copy as stale inside maxStale and does not refetch on every call', async () => {
    const fetchedAt = new Date(NOW.getTime() - 600_000).toISOString(); // 10 min old, maxStale 1800 s
    await testEnv.FEED.put(kvKey('prometnice'), JSON.stringify({ ...goodSnapshot('prometnice', fetchedAt), status: 'live' }));
    let calls = 0;
    setFetcherForTest('prometnice', async () => {
      calls += 1;
      throw new Error('upstream 503');
    });

    const ctx1 = createExecutionContext();
    const stale = await getModule(testEnv, ctx1, 'prometnice', deps);
    await waitOnExecutionContext(ctx1);

    expect(stale.status).toBe('stale');
    expect(stale.staleSince).toBe(fetchedAt);
    expect(stale.fetchedAt).toBe(fetchedAt);
    expect(stale.items).toHaveLength(1);
    expect(events).toEqual([['source_fetch', 'prometnice', 'stale']]);

    // The degraded answer is cached briefly, so a dead source is not hammered.
    const stored = await caches.default.match(new Request(cacheKey('prometnice')));
    expect(stored?.headers.get('cache-control')).toBe('s-maxage=60');
    const ctx2 = createExecutionContext();
    await getModule(testEnv, ctx2, 'prometnice', deps);
    await waitOnExecutionContext(ctx2);
    expect(calls).toBe(1);
  });

  it('goes down with no items when the KV copy is older than maxStale', async () => {
    const fetchedAt = new Date(NOW.getTime() - 4000_000).toISOString(); // > 1800 s
    await testEnv.FEED.put(kvKey('prometnice'), JSON.stringify({ ...goodSnapshot('prometnice', fetchedAt), status: 'live' }));
    setFetcherForTest('prometnice', async () => {
      throw new Error('upstream 503');
    });

    const ctx = createExecutionContext();
    const down = await getModule(testEnv, ctx, 'prometnice', deps);
    await waitOnExecutionContext(ctx);

    expect(down.status).toBe('down');
    expect(down.items).toEqual([]);
    expect(down.fetchedAt).toBe(NOW.toISOString());
    expect(down.attribution).toEqual(MODULES.prometnice.attribution);
    expect(events).toEqual([['source_fetch', 'prometnice', 'error']]);
  });

  it('goes down when nothing was ever cached', async () => {
    setFetcherForTest('dhmz-cap', async () => {
      throw new Error('upstream 500');
    });
    const ctx = createExecutionContext();
    const down = await getModule(testEnv, ctx, 'dhmz-cap', deps);
    await waitOnExecutionContext(ctx);
    expect(down.status).toBe('down');
    expect(down.tier).toBe('open');
    expect(events).toEqual([['source_fetch', 'dhmz-cap', 'error']]);
  });
});

describe('getModules and warmFeeds', () => {
  it('keeps the requested order and degrades one module without losing the others', async () => {
    setFetcherForTest('emsc', async (ctx) => goodSnapshot('emsc', ctx.now().toISOString()));
    setFetcherForTest('prometnice', async () => {
      throw new Error('upstream 503');
    });

    const ctx = createExecutionContext();
    const snapshots = await getModules(testEnv, ctx, ['prometnice', 'emsc'], deps);
    await waitOnExecutionContext(ctx);

    expect(snapshots.map((s) => s.module)).toEqual(['prometnice', 'emsc']);
    expect(snapshots.map((s) => s.status)).toEqual(['down', 'live']);
  });

  it('warms only the modules the five-minute cron can keep ahead of (ttl >= 300 s)', async () => {
    const touched: ModuleId[] = [];
    for (const id of Object.keys(MODULES) as ModuleId[]) {
      await reset(id);
      setFetcherForTest(id, async (ctx) => {
        touched.push(id);
        return goodSnapshot(id, ctx.now().toISOString());
      });
    }

    const ctx = createExecutionContext();
    await warmFeeds(testEnv, ctx, deps);
    await waitOnExecutionContext(ctx);

    expect([...touched].sort()).toEqual(
      ['ckan-geo', 'dhmz-cap', 'dhmz-forecast', 'dhmz-now', 'dogadanja', 'glasnik', 'hrt-news'].sort(),
    );
    expect(touched).not.toContain('zet-rt');
    expect(touched).not.toContain('prometnice');
    expect(touched).not.toContain('emsc');
  });
});

// R-X1: this exercises `dogadanja`'s own real fetcher (no setFetcherForTest
// stand-in), with every one of its six sub-fetchers' real upstream calls
// failing, so the regression is caught at the layer a person would actually
// see it break: the cache falling back to the KV last-good copy instead of
// silently overwriting it with a zero-item 'live' snapshot.
describe('dogadanja honest failure (R-X1)', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('serves the KV last-good copy as stale, instead of overwriting it with a live empty snapshot, when every real source is down', async () => {
    const fetchedAt = new Date(NOW.getTime() - 600_000).toISOString(); // 10 min old, maxStale 86400 s
    await testEnv.FEED.put(
      kvKey('dogadanja'),
      JSON.stringify({ ...goodSnapshot('dogadanja', fetchedAt), status: 'live' }),
    );
    globalThis.fetch = (async () => {
      throw new Error('upstream unreachable');
    }) as unknown as typeof fetch;

    const ctx = createExecutionContext();
    const result = await getModule(testEnv, ctx, 'dogadanja', deps);
    await waitOnExecutionContext(ctx);

    expect(result.status).toBe('stale');
    expect(result.staleSince).toBe(fetchedAt);
    // The KV copy's real item survives -- not silently replaced by an empty,
    // 'live'-stamped snapshot, which is exactly the bug R-X1 describes.
    expect(result.items).toHaveLength(1);
    expect(events).toEqual([['source_fetch', 'dogadanja', 'stale']]);
  });

  it('goes down with no items when the KV copy is older than maxStale and every real source is down', async () => {
    const fetchedAt = new Date(NOW.getTime() - 90_000_000).toISOString(); // > 86400 s
    await testEnv.FEED.put(
      kvKey('dogadanja'),
      JSON.stringify({ ...goodSnapshot('dogadanja', fetchedAt), status: 'live' }),
    );
    globalThis.fetch = (async () => {
      throw new Error('upstream unreachable');
    }) as unknown as typeof fetch;

    const ctx = createExecutionContext();
    const result = await getModule(testEnv, ctx, 'dogadanja', deps);
    await waitOnExecutionContext(ctx);

    expect(result.status).toBe('down');
    expect(result.items).toEqual([]);
    expect(events).toEqual([['source_fetch', 'dogadanja', 'error']]);
  });
});
