import { SELF, createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { PublicStats } from '../../shared/statistika';
import type { Env } from '../../worker/env';
import type { MetricsDailyRow, MetricsTotalRow } from '../../worker/metrics-do';
import { STATISTIKA_TTL_SECONDS, allowSameOriginFrame, handleStatistika, type StatistikaDeps } from '../../worker/routes/statistika';
import { APP_SECURITY_HEADERS, DATA_SECURITY_HEADERS } from '../../worker/security-headers';

const allowAll = { limit: async () => ({ success: true }) };
const NOW = () => new Date('2026-09-24T10:00:00Z');

const USAGE: MetricsDailyRow[] = [
  { day: '2026-09-23', hour: 10, event: 'session_start', dim1: 'knjiznica', dim2: 'donji-grad', count: 23 },
  { day: '2026-09-23', hour: 11, event: 'session_start', dim1: 'kafic', dim2: 'trnje', count: 3 },
];

function deps(over: Partial<StatistikaDeps> = {}): StatistikaDeps & { calls: { usage: number } } {
  const calls = { usage: 0 };
  return {
    calls,
    now: NOW,
    loadUsage: async (_env, since) => {
      calls.usage += 1;
      return USAGE.filter((r) => r.day >= since);
    },
    loadSystem: async () => ({ totals: [] as MetricsTotalRow[], tickDaily: [] as MetricsTotalRow[] }),
    loadLive: async () => null,
    ...over,
  };
}

async function call(host: string, path: string, d: StatistikaDeps, init: RequestInit = {}, rl: Env['RL_OPEN'] = allowAll as unknown as Env['RL_OPEN']) {
  const testEnv = { ...(env as unknown as Env), RL_OPEN: rl } as Env;
  const request = new Request(`https://${host}${path}`, init);
  const ctx = createExecutionContext();
  const response = await handleStatistika(request, testEnv, ctx, new URL(request.url), d);
  await waitOnExecutionContext(ctx);
  return response;
}

describe('/api/statistika', () => {
  it('answers anyone, with the public report, edge-cacheable for five minutes', async () => {
    const response = (await call('st-a.test', '/api/statistika?dani=7', deps()))!;
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe(`public, max-age=0, s-maxage=${STATISTIKA_TTL_SECONDS}`);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    for (const [name, value] of Object.entries(DATA_SECURITY_HEADERS)) expect(response.headers.get(name), name).toBe(value);
    const body = (await response.json()) as PublicStats;
    expect(body.window).toEqual({ days: 7, since: '2026-09-18', today: '2026-09-24', timeZone: 'Europe/Zagreb' });
    expect(body.venue.session_start.total).toBe(25);
    expect(JSON.stringify(body)).not.toContain('"count":23');
  });

  it('reads any other dani as the 30-day window, from the same cache entry', async () => {
    const d = deps();
    const first = (await (await call('st-b.test', '/api/statistika?dani=31', d))!.json()) as PublicStats;
    const second = (await (await call('st-b.test', '/api/statistika', d))!.json()) as PublicStats;
    expect(first.window.days).toBe(30);
    expect(second.window.days).toBe(30);
    expect(d.calls.usage).toBe(1);
  });

  it('says 429 with Retry-After when the per-IP budget is spent, and never reads the counters', async () => {
    const d = deps();
    const response = (await call('st-c.test', '/api/statistika', d, {}, { limit: async () => ({ success: false }) } as unknown as Env['RL_OPEN']))!;
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('60');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(d.calls.usage).toBe(0);
  });

  it('answers HEAD without a body and refuses other methods', async () => {
    const head = (await call('st-d.test', '/api/statistika', deps(), { method: 'HEAD' }))!;
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
    const post = (await call('st-d.test', '/api/statistika', deps(), { method: 'POST' }))!;
    expect(post.status).toBe(405);
    expect(post.headers.get('allow')).toBe('GET, HEAD');
  });

  it('says 503 and caches nothing when the counters cannot be read', async () => {
    let fail = true;
    const d = deps({
      loadUsage: async () => {
        if (fail) throw new Error('storage down');
        return [];
      },
    });
    const down = (await call('st-e.test', '/api/statistika', d))!;
    expect(down.status).toBe(503);
    expect(down.headers.get('cache-control')).toBe('no-store');
    fail = false;
    expect((await call('st-e.test', '/api/statistika', d))!.status).toBe(200);
  });

  it('keeps the report standing when the twin cannot answer', async () => {
    const body = (await (await call('st-f.test', '/api/statistika', deps({ loadLive: async () => null })))!.json()) as PublicStats;
    expect(body.system.live).toBeNull();
  });

  it('is public through the whole Worker, with no Access header and real, empty counters', async () => {
    const response = await SELF.fetch('https://zagreb.aningfilm.hr/api/statistika?dani=7');
    expect(response.status).toBe(200);
    const body = (await response.json()) as PublicStats;
    expect(body.version).toBe(1);
    expect(body.days).toHaveLength(7);
  });

  it('leaves every other path to the next handler', async () => {
    expect(await call('st-g.test', '/api/statistika/x', deps())).toBeNull();
    expect(await call('st-g.test', '/stats', deps())).toBeNull();
  });
});

describe('/statistika/, the one page this site may frame', () => {
  it('turns the app policy frame-ancestors none into self, and DENY into SAMEORIGIN', () => {
    const asset = new Response('<!doctype html>', { headers: { 'content-type': 'text/html', ...APP_SECURITY_HEADERS } });
    const out = allowSameOriginFrame(asset);
    expect(out.headers.get('content-security-policy')).toBe(APP_SECURITY_HEADERS['Content-Security-Policy'].replace("frame-ancestors 'none'", "frame-ancestors 'self'"));
    expect(out.headers.get('content-security-policy')).not.toContain("frame-ancestors 'none'");
    expect(out.headers.get('x-frame-options')).toBe('SAMEORIGIN');
    expect(out.headers.get('strict-transport-security')).toBe(APP_SECURITY_HEADERS['Strict-Transport-Security']);
  });

  it('serves the asset through that rewrite, and leaves non-HTML answers alone', async () => {
    const html = new Response('<!doctype html>', { headers: { 'content-type': 'text/html; charset=utf-8', ...APP_SECURITY_HEADERS } });
    const assets = { fetch: async () => html.clone() } as unknown as Fetcher;
    const testEnv = { ...(env as unknown as Env), ASSETS: assets } as Env;
    const request = new Request('https://zagreb.aningfilm.hr/statistika/');
    const page = (await handleStatistika(request, testEnv, createExecutionContext(), new URL(request.url)))!;
    expect(page.headers.get('x-frame-options')).toBe('SAMEORIGIN');
    const redirect = { fetch: async () => new Response(null, { status: 307, headers: { location: '/statistika/', 'x-frame-options': 'DENY' } }) } as unknown as Fetcher;
    const bare = new Request('https://zagreb.aningfilm.hr/statistika');
    const moved = (await handleStatistika(bare, { ...testEnv, ASSETS: redirect } as Env, createExecutionContext(), new URL(bare.url)))!;
    expect(moved.status).toBe(307);
    expect(moved.headers.get('x-frame-options')).toBe('DENY');
  });
});
