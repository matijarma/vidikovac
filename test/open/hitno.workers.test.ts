import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { Env } from '../../worker/env';
import type { ModuleId, ModuleSnapshot } from '../../worker/feed/schema';
import { HITNO_TTL_SECONDS } from '../../worker/hitno/route';
import { handleOpen } from '../../worker/routes/open';

const baseEnv = env as unknown as Env;
const admitAll: Env['RL_OPEN'] = { limit: async () => ({ success: true }) };
const denyAll: Env['RL_OPEN'] = { limit: async () => ({ success: false }) };

function capSnapshot(title: string): ModuleSnapshot {
  return {
    module: 'dhmz-cap',
    tier: 'open',
    status: 'live',
    fetchedAt: new Date().toISOString(),
    attribution: { text: 'Izvor: DHMZ, Otvorena dozvola', url: 'https://meteo.hr/upozorenja/cap_hr_today.xml', licence: 'Otvorena dozvola' },
    items: [
      {
        id: 'w1',
        module: 'dhmz-cap',
        kind: 'warning',
        tier: 'open',
        title,
        severity: 'severe',
        at: new Date(Date.now() - 3_600_000).toISOString(),
        until: new Date(Date.now() + 3_600_000).toISOString(),
      },
    ],
  };
}

function fakeGetModules(snapshots: ModuleSnapshot[]) {
  const calls: ModuleId[][] = [];
  const fn = async (_env: Env, _ctx: ExecutionContext, ids: ModuleId[]): Promise<ModuleSnapshot[]> => {
    calls.push(ids);
    return snapshots;
  };
  return { fn, calls };
}

async function get(host: string, path: string, init: RequestInit = {}) {
  const request = new Request(`https://${host}${path}`, init);
  return { request, url: new URL(request.url) };
}

describe('GET /hitno', () => {
  it('renders the warning from the snapshot, edge-cacheable for 60 s', async () => {
    const { fn } = fakeGetModules([capSnapshot('Narančasto upozorenje za olujni vjetar')]);
    const ctx = createExecutionContext();
    const { request, url } = await get('hitno-a.test', '/hitno');
    const response = await handleOpen(request, { ...baseEnv, RL_OPEN: admitAll }, ctx, url, { getModules: fn });
    await waitOnExecutionContext(ctx);

    expect(response).not.toBeNull();
    expect(response!.status).toBe(200);
    expect(response!.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(response!.headers.get('cache-control')).toBe(`public, max-age=0, s-maxage=${HITNO_TTL_SECONDS}`);
    expect(response!.headers.get('content-language')).toBe('hr');
    const html = await response!.text();
    expect(html).toContain('Narančasto upozorenje za olujni vjetar');
    expect(html).toContain('<span class="sev sev-severe">narančasto upozorenje</span>');
    expect(html).toContain('Izvor: DHMZ, Otvorena dozvola');
    expect(html).not.toContain('<script');
  });

  it('serves the second request of the same minute from the edge cache without calling the feed', async () => {
    const first = fakeGetModules([capSnapshot('Prvo upozorenje')]);
    const ctx1 = createExecutionContext();
    const a = await get('hitno-cache.test', '/hitno');
    await handleOpen(a.request, { ...baseEnv, RL_OPEN: admitAll }, ctx1, a.url, { getModules: first.fn });
    await waitOnExecutionContext(ctx1);

    const second = fakeGetModules([capSnapshot('Drugo upozorenje')]);
    const ctx2 = createExecutionContext();
    const b = await get('hitno-cache.test', '/hitno?x=1');
    const response = await handleOpen(b.request, { ...baseEnv, RL_OPEN: admitAll }, ctx2, b.url, { getModules: second.fn });
    await waitOnExecutionContext(ctx2);

    expect(second.calls).toHaveLength(0);
    expect(await response!.text()).toContain('Prvo upozorenje');
  });

  it('answers 429 in Croatian when RL_OPEN denies the IP, and does not touch the feed', async () => {
    const { fn, calls } = fakeGetModules([]);
    const ctx = createExecutionContext();
    const { request, url } = await get('hitno-429.test', '/hitno', { headers: { 'cf-connecting-ip': '203.0.113.9' } });
    const response = await handleOpen(request, { ...baseEnv, RL_OPEN: denyAll }, ctx, url, { getModules: fn });
    expect(response!.status).toBe(429);
    expect(response!.headers.get('retry-after')).toBe('60');
    expect(response!.headers.get('cache-control')).toBe('no-store');
    expect(await response!.text()).toContain('Previše zahtjeva');
    expect(calls).toHaveLength(0);
  });

  it('rejects methods other than GET and HEAD with 405', async () => {
    const { fn, calls } = fakeGetModules([]);
    const ctx = createExecutionContext();
    const { request, url } = await get('hitno-405.test', '/hitno', { method: 'POST' });
    const response = await handleOpen(request, { ...baseEnv, RL_OPEN: admitAll }, ctx, url, { getModules: fn });
    expect(response!.status).toBe(405);
    expect(response!.headers.get('allow')).toBe('GET, HEAD');
    expect(calls).toHaveLength(0);
  });

  it('renders every panel as unavailable, uncached, when the feed layer throws', async () => {
    const ctx = createExecutionContext();
    const { request, url } = await get('hitno-down.test', '/hitno');
    const response = await handleOpen(request, { ...baseEnv, RL_OPEN: admitAll }, ctx, url, {
      getModules: async () => {
        throw new Error('kv-unavailable');
      },
    });
    await waitOnExecutionContext(ctx);
    expect(response!.status).toBe(200);
    expect(response!.headers.get('cache-control')).toBe('no-store');
    const html = await response!.text();
    expect(html).toContain('Izvor trenutačno nedostupan');
    expect(html).toContain('href="tel:112"');
  });

  it('ignores paths that are not /hitno or /open', async () => {
    const ctx = createExecutionContext();
    const { request, url } = await get('hitno-null.test', '/nesto-drugo');
    expect(await handleOpen(request, baseEnv, ctx, url)).toBeNull();
  });
});
