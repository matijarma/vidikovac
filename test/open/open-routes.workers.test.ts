import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { Env } from '../../worker/env';
import type { ModuleId, ModuleSnapshot } from '../../worker/feed/schema';
import { handleOpen } from '../../worker/routes/open';

const baseEnv = env as unknown as Env;
const admitAll: Env['RL_OPEN'] = { limit: async () => ({ success: true }) };
const denyAll: Env['RL_OPEN'] = { limit: async () => ({ success: false }) };

function snapshot(module: ModuleId, tier: ModuleSnapshot['tier'] = 'open'): ModuleSnapshot {
  return {
    module,
    tier,
    status: 'live',
    fetchedAt: '2026-09-11T08:00:00Z',
    attribution: { text: `Izvor: ${module}`, url: `https://example.test/${module}`, licence: 'Otvorena dozvola' },
    items:
      module === 'prometnice'
        ? [
            {
              id: 'c1',
              module,
              kind: 'closure',
              tier,
              title: 'Ilica',
              geo: { type: 'LineString', coordinates: [[15.97, 45.81], [15.96, 45.81]] },
            },
          ]
        : [],
  };
}

function fake(...snapshots: ModuleSnapshot[]) {
  const calls: ModuleId[][] = [];
  const getModules = async (_e: Env, _c: ExecutionContext, ids: ModuleId[]) => {
    calls.push(ids);
    return snapshots.filter((s) => ids.includes(s.module));
  };
  return { getModules, calls };
}

async function call(host: string, path: string, deps: Parameters<typeof handleOpen>[4], rl = admitAll, init: RequestInit = {}) {
  const request = new Request(`https://${host}${path}`, init);
  const ctx = createExecutionContext();
  const response = await handleOpen(request, { ...baseEnv, RL_OPEN: rl }, ctx, new URL(request.url), deps);
  await waitOnExecutionContext(ctx);
  return response!;
}

describe('/open/*', () => {
  it('serves catalog.json as JSON-LD with CORS and an hour at the edge', async () => {
    const { getModules, calls } = fake();
    const response = await call('open-cat.test', '/open/catalog.json', { getModules });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe('public, max-age=0, s-maxage=3600');
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    const body = (await response.json()) as { '@type': string; '@id': string; 'dcat:dataset': unknown[] };
    expect(body['@type']).toBe('dcat:Catalog');
    expect(body['@id']).toBe('https://open-cat.test/open/catalog.json');
    expect(body['dcat:dataset']).toHaveLength(4);
    expect(calls).toHaveLength(0);
  });

  it('serves an open-tier module snapshot with s-maxage equal to its ttl', async () => {
    const { getModules, calls } = fake(snapshot('dhmz-cap'));
    const response = await call('open-cap.test', '/open/dhmz-cap.json', { getModules });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('public, max-age=0, s-maxage=300');
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    const body = (await response.json()) as ModuleSnapshot;
    expect(body.module).toBe('dhmz-cap');
    expect(body.attribution.text).toBe('Izvor: dhmz-cap');
    expect(calls).toEqual([['dhmz-cap']]);
  });

  it('404s a module that is not in the catalogue without touching the feed', async () => {
    const { getModules, calls } = fake(snapshot('zet-rt', 'session'));
    const response = await call('open-zet.test', '/open/zet-rt.json', { getModules });
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'not-found' });
    expect(calls).toHaveLength(0);
  });

  it('404s when the registry says the module is session-tier after all', async () => {
    const { getModules } = fake(snapshot('emsc', 'session'));
    const response = await call('open-tier.test', '/open/emsc.json', { getModules });
    expect(response.status).toBe(404);
  });

  it('serves closures as GeoJSON with the prometnice ttl', async () => {
    const { getModules } = fake(snapshot('prometnice'));
    const response = await call('open-geo.test', '/open/prometnice.geojson', { getModules });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/geo+json; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe('public, max-age=0, s-maxage=180');
    const body = (await response.json()) as { type: string; features: unknown[]; adapted: boolean };
    expect(body.type).toBe('FeatureCollection');
    expect(body.features).toHaveLength(1);
    expect(body.adapted).toBe(true);
  });

  it('caches a module snapshot at the edge for the ttl', async () => {
    const first = fake(snapshot('emsc'));
    await call('open-cache.test', '/open/emsc.json', { getModules: first.getModules });
    const second = fake(snapshot('emsc'));
    const response = await call('open-cache.test', '/open/emsc.json', { getModules: second.getModules });
    expect(response.status).toBe(200);
    expect(second.calls).toHaveLength(0);
  });

  it('rate-limits by IP with a JSON 429', async () => {
    const { getModules, calls } = fake(snapshot('emsc'));
    const response = await call('open-429.test', '/open/emsc.json', { getModules }, denyAll);
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('60');
    await expect(response.json()).resolves.toEqual({
      error: 'rate-limited',
      message: 'Previše zahtjeva. Pokušaj ponovno za minutu.',
    });
    expect(calls).toHaveLength(0);
  });

  it('serves a 503 with Retry-After when the feed layer throws', async () => {
    const getModules = async () => {
      throw new Error('kv down');
    };
    const response = await call('open-503.test', '/open/emsc.json', { getModules });
    expect(response.status).toBe(503);
    expect(response.headers.get('retry-after')).toBe('60');
    await expect(response.json()).resolves.toEqual({ error: 'feed-unavailable' });
  });

  it('404s unknown paths under /open/ and 405s non-GET', async () => {
    const { getModules } = fake();
    expect((await call('open-404.test', '/open/nesto', { getModules })).status).toBe(404);
    // R-09: the plan's literal path-traversal case (/open/../etc) normalises
    // away at URL-construction time before it ever reaches the dispatcher;
    // an unknown but well-formed module path is the real 404 case to prove.
    expect((await call('open-404.test', '/open/unknown.json', { getModules })).status).toBe(404);
    const post = await call('open-405.test', '/open/catalog.json', { getModules }, admitAll, { method: 'POST' });
    expect(post.status).toBe(405);
    expect(post.headers.get('allow')).toBe('GET, HEAD');
  });

  it('strips the body from a HEAD request, including a HEAD 404', async () => {
    const { getModules } = fake(snapshot('emsc'));
    const okHead = await call('open-head.test', '/open/emsc.json', { getModules }, admitAll, { method: 'HEAD' });
    expect(okHead.status).toBe(200);
    expect(await okHead.text()).toBe('');
    const notFoundHead = await call('open-head.test', '/open/unknown.json', { getModules }, admitAll, {
      method: 'HEAD',
    });
    expect(notFoundHead.status).toBe(404);
    expect(await notFoundHead.text()).toBe('');
  });
});
