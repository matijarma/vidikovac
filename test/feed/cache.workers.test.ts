import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
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
  await reset('emsc', 'prometnice', 'zet-rt', 'dhmz-cap');
});

describe('getModule', () => {
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
      ['ckan-geo', 'dhmz-cap', 'dhmz-forecast', 'dhmz-now', 'glasnik', 'hrt-news'].sort(),
    );
    expect(touched).not.toContain('zet-rt');
    expect(touched).not.toContain('prometnice');
    expect(touched).not.toContain('emsc');
  });
});
