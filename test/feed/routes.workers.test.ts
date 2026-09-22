import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../../worker/env';
import type { ModuleId, ModuleSnapshot } from '../../worker/feed/schema';
import { MODULES } from '../../worker/feed/registry';
import { TEASER_CACHE_CONTROL, handleFeed, readDataToken } from '../../worker/routes/feed';
import { handleKiosk, SENTENCE_BODY_MAX_BYTES } from '../../worker/routes/kiosk';
import worker from '../../worker/index';

const testEnv = env as unknown as Env;
const NOW = new Date('2026-09-11T10:00:00.000Z');

describe('POST /api/kiosk/sentences', () => {
  const payload = () => ({ locale: 'hr', budget: 80, facts: [
    { id: 'closure:ilica', kind: 'radovi', text: 'Ilica je zatvorena do 18:00.', validUntil: Date.now() + 600_000 },
  ] });
  async function sentenceCall(body: unknown = payload(), init: RequestInit = {}, overrides: Partial<Env> = {}) {
    const url = new URL('https://vidikovac.test/api/kiosk/sentences');
    const ctx = createExecutionContext();
    const response = await handleKiosk(new Request(url, {
      method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' }, ...init,
    }), { ...testEnv, ...overrides }, ctx, url);
    await waitOnExecutionContext(ctx);
    if (!response) throw new Error('sentence route declined');
    return response;
  }
  it('answers 405 for GET and is wired into the Worker dispatcher', async () => {
    const ctx = createExecutionContext();
    const response = await worker.fetch(new Request('https://vidikovac.test/api/kiosk/sentences'), testEnv, ctx);
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST');
  });
  it('returns private, no-store 200 with zero AI calls under APP_ENV=test', async () => {
    const run = vi.fn(async () => { throw new Error('must never bill AI'); });
    const response = await sentenceCall(payload(), {}, { AI: { run } as unknown as Ai });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toEqual({ generatedAt: expect.any(String), sentences: [] });
    expect(run).not.toHaveBeenCalled();
  });
  it('enforces same-origin, but accepts requests with no Origin', async () => {
    expect((await sentenceCall(payload(), { headers: { origin: 'https://other.test' } })).status).toBe(403);
    expect((await sentenceCall()).status).toBe(200);
    expect((await sentenceCall(payload(), { headers: { origin: 'https://vidikovac.test' } })).status).toBe(200);
  });
  it('validates count, locale, budget, fact shape, unique IDs, text and finite expiry', async () => {
    const good = payload();
    for (const body of [
      null, [], {}, { ...good, locale: 'fr' }, { ...good, budget: 39 }, { ...good, budget: 81 }, { ...good, budget: 64.5 },
      { ...good, facts: Array.from({ length: 17 }, (_, n) => ({ ...good.facts[0], id: String(n) })) },
      { ...good, facts: [...good.facts, ...good.facts] }, { ...good, facts: [null] },
      { ...good, facts: [{ ...good.facts[0], kind: 'other' }] },
      { ...good, facts: [{ ...good.facts[0], text: 'x'.repeat(161) }] },
      { ...good, facts: [{ ...good.facts[0], validUntil: 'tomorrow' }] },
      { ...good, facts: [{ ...good.facts[0], id: 'bad|id' }] },
      { ...good, facts: [{ ...good.facts[0], text: 'Ilica\nu 18:00.' }] },
    ]) expect((await sentenceCall(body)).status, JSON.stringify(body)).toBe(400);
  });
  it('caps both declared and streamed UTF-8 bodies and rejects malformed JSON', async () => {
    expect((await sentenceCall(payload(), { body: '{' })).status).toBe(400);
    expect((await sentenceCall(payload(), { headers: { 'content-length': String(SENTENCE_BODY_MAX_BYTES + 1) } })).status).toBe(400);
    expect((await sentenceCall(payload(), { body: 'š'.repeat(SENTENCE_BODY_MAX_BYTES / 2 + 1) })).status).toBe(400);
  });
  it('limits paid inference by client IP and fails closed when the limiter fails', async () => {
    const limit = vi.fn(async () => ({ success: false }));
    const response = await sentenceCall(payload(), { headers: { 'cf-connecting-ip': '192.0.2.1' } }, { RL_OPEN: { limit } });
    expect(response.status).toBe(429);
    expect(limit).toHaveBeenCalledWith({ key: 'kiosk-sentences:192.0.2.1' });
    expect((await sentenceCall(payload(), {}, { RL_OPEN: { limit: async () => { throw new Error('limiter down'); } } })).status).toBe(429);
  });
});

function snapshot(module: ModuleId): ModuleSnapshot {
  const spec = MODULES[module];
  return {
    module,
    tier: spec.tier,
    status: 'live',
    fetchedAt: NOW.toISOString(),
    attribution: spec.attribution,
    items:
      module === 'zet-rt'
        ? [
            { id: 'vehicle:1', module, kind: 'vehicle', tier: spec.tier, title: 'Linija 12', geo: { type: 'Point', coordinates: [15.98, 45.81] } },
            { id: 'route:12', module, kind: 'vehicle', tier: spec.tier, title: 'Linija 12', data: { routeId: '12', routeShortName: '12', medianDelaySeconds: 0, vehicles: 1 } },
          ]
        : [{ id: `${module}-1`, module, kind: 'poi', tier: spec.tier, title: 'Stavka' }],
  };
}

function deps(over: Partial<Parameters<typeof handleFeed>[4]> = {}) {
  return {
    now: () => NOW,
    getModules: async (_e: Env, _c: ExecutionContext, ids: ModuleId[]) => ids.map(snapshot),
    verifyDataToken: async (_e: Env, token: string) =>
      token === 'dobar-token' ? { roomId: 'soba', expiresAt: NOW.getTime() + 600_000 } : null,
    ...over,
  };
}

async function call(path: string, init: RequestInit = {}, over = {}): Promise<Response> {
  const url = new URL(`https://vidikovac.test${path}`);
  const request = new Request(url, init);
  const ctx = createExecutionContext();
  const response = await handleFeed(request, testEnv, ctx, url, deps(over));
  await waitOnExecutionContext(ctx);
  if (!response) throw new Error(`handleFeed declined ${path}`);
  return response;
}

describe('readDataToken', () => {
  it('accepts a query parameter and a bearer header', () => {
    const url = new URL('https://vidikovac.test/api/data?token=abc');
    expect(readDataToken(new Request(url), url)).toBe('abc');
    const plain = new URL('https://vidikovac.test/api/data');
    expect(readDataToken(new Request(plain, { headers: { authorization: 'Bearer xyz' } }), plain)).toBe('xyz');
    expect(readDataToken(new Request(plain), plain)).toBe('');
  });
});

describe('GET /api/teaser', () => {
  it('serves every module the app fetches to the public screen, only zet-rt and emsc reduced in size, cacheable for 5 s', async () => {
    const response = await call('/api/teaser');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe(TEASER_CACHE_CONTROL);
    const body = (await response.json()) as { generatedAt: string; modules: ModuleSnapshot[] };
    expect(body.generatedAt).toBe(NOW.toISOString());
    expect(body.modules.map((m) => m.module)).toEqual([
      'prometnice',
      'dhmz-cap',
      'emsc',
      'ckan-geo',
      'dhmz-now',
      'zet-rt',
      'dogadanja',
      'dhmz-forecast',
      'glasnik',
    ]);
    const zet = body.modules.find((m) => m.module === 'zet-rt');
    // R-P1: the fleet count, then the pins inside the default screen's box
    // (this fixture's one pin sits 250 m east of Trg bana Jelačića, geo and
    // all, so the locked kiosk's motion model has evidence), then the
    // per-route delay rows, which carry no geo.
    expect(zet?.items.map((item) => item.id)).toEqual(['vozila', 'vehicle:1', 'route:12']);
    expect(zet?.items.find((item) => item.id === 'vehicle:1')?.geo).toEqual({ type: 'Point', coordinates: [15.98, 45.81] });
    expect(zet?.items.filter((item) => item.id !== 'vehicle:1').some((item) => item.geo)).toBe(false);
    expect(body.modules.find((m) => m.module === 'emsc')?.items).toHaveLength(1);
  });

  it('needs no token at all', async () => {
    const response = await call('/api/teaser', { headers: { authorization: 'Bearer lose' } });
    expect(response.status).toBe(200);
  });

  it('cuts emsc to its ten newest quakes even though it is an open module', async () => {
    const quakes = Array.from({ length: 25 }, (_, n) => ({
      id: `q${n}`,
      module: 'emsc' as const,
      kind: 'quake' as const,
      tier: 'open' as const,
      title: 'Potres',
      at: new Date(NOW.getTime() - n * 60_000).toISOString(),
    }));
    const response = await call('/api/teaser', {}, {
      getModules: async (_e: Env, _c: ExecutionContext, ids: ModuleId[]) =>
        ids.map((id) => (id === 'emsc' ? { ...snapshot(id), items: quakes } : snapshot(id))),
    });
    const body = (await response.json()) as { modules: ModuleSnapshot[] };
    const emsc = body.modules.find((m) => m.module === 'emsc');
    expect(emsc?.items).toHaveLength(10);
    expect(emsc?.items.map((item) => item.id)).toEqual(Array.from({ length: 10 }, (_, n) => `q${n}`));
  });
});

describe('GET /api/data', () => {
  it('refuses without a valid token', async () => {
    const missing = await call('/api/data');
    expect(missing.status).toBe(401);
    expect(await missing.json()).toEqual({ error: 'unauthorized' });
    const wrong = await call('/api/data?token=lose');
    expect(wrong.status).toBe(401);
  });

  it('serves all nine modules for a valid token and never caches them', async () => {
    const response = await call('/api/data?token=dobar-token');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = (await response.json()) as { modules: ModuleSnapshot[] };
    expect(body.modules).toHaveLength(9);
    expect(body.modules.find((m) => m.module === 'zet-rt')?.items).toHaveLength(2);
  });

  it('counts against RL_DATA keyed by the token', async () => {
    const keys: string[] = [];
    const limiter = { limit: async ({ key }: { key: string }) => (keys.push(key), { success: true }) };
    const url = new URL('https://vidikovac.test/api/data?token=dobar-token');
    const ctx = createExecutionContext();
    await handleFeed(new Request(url), { ...testEnv, RL_DATA: limiter }, ctx, url, deps());
    await waitOnExecutionContext(ctx);
    expect(keys).toEqual(['dobar-token']);
  });

  it('answers 429 when the limiter says no', async () => {
    const limiter = { limit: async () => ({ success: false }) };
    const url = new URL('https://vidikovac.test/api/data?token=dobar-token');
    const ctx = createExecutionContext();
    const response = await handleFeed(new Request(url), { ...testEnv, RL_DATA: limiter }, ctx, url, deps());
    await waitOnExecutionContext(ctx);
    expect(response?.status).toBe(429);
    expect(await response?.json()).toEqual({ error: 'rate-limited' });
  });
});

describe('GET /api/data/:module', () => {
  it('serves an open module without a token', async () => {
    const response = await call('/api/data/emsc');
    expect(response.status).toBe(200);
    const body = (await response.json()) as ModuleSnapshot;
    expect(body.module).toBe('emsc');
    expect(body.tier).toBe('open');
    expect(body.items).toHaveLength(1);
  });

  it('refuses a session module without a token and serves it with one', async () => {
    const denied = await call('/api/data/glasnik');
    expect(denied.status).toBe(401);
    const allowed = await call('/api/data/glasnik?token=dobar-token');
    expect(allowed.status).toBe(200);
    expect(((await allowed.json()) as ModuleSnapshot).module).toBe('glasnik');
  });

  it('404s an unknown module and declines paths that are not its own', async () => {
    const unknown = await call('/api/data/nepostojeci');
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual({ error: 'not-found' });

    const url = new URL('https://vidikovac.test/api/scan');
    const ctx = createExecutionContext();
    expect(await handleFeed(new Request(url), testEnv, ctx, url, deps())).toBeNull();
    await waitOnExecutionContext(ctx);
  });

  it('answers 405 for a write method', async () => {
    const response = await call('/api/teaser', { method: 'POST' });
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET');
  });

  it('does not fail when the feed layer is down: getModules already degrades', async () => {
    const response = await call('/api/data/emsc', {}, {
      getModules: async (_e: Env, _c: ExecutionContext, ids: ModuleId[]) =>
        ids.map((id) => ({ ...snapshot(id), status: 'down' as const, items: [] })),
    });
    expect(response.status).toBe(200);
    expect(((await response.json()) as ModuleSnapshot).status).toBe('down');
  });
});
