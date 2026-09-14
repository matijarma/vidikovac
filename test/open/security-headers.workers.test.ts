import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { Env } from '../../worker/env';
import type { ModuleSnapshot } from '../../worker/feed/schema';
import { handleOpen } from '../../worker/routes/open';
import { handleStats } from '../../worker/routes/stats';
import {
  DATA_SECURITY_HEADERS,
  PAGE_SECURITY_HEADERS,
  STATS_SECURITY_HEADERS,
} from '../../worker/security-headers';

const testEnv = { ...(env as unknown as Env), RL_OPEN: { limit: async () => ({ success: true }) } } as Env;

const CAP: ModuleSnapshot = {
  module: 'dhmz-cap',
  tier: 'open',
  status: 'live',
  fetchedAt: new Date().toISOString(),
  attribution: { text: 'Izvor: DHMZ', url: 'https://meteo.hr', licence: 'Otvorena dozvola' },
  items: [],
};
const getModules = async () => [CAP];

async function open(host: string, path: string) {
  const request = new Request(`https://${host}${path}`);
  const ctx = createExecutionContext();
  const response = await handleOpen(request, testEnv, ctx, new URL(request.url), { getModules });
  await waitOnExecutionContext(ctx);
  return response!;
}

function expectHeaders(response: Response, set: Readonly<Record<string, string>>): void {
  for (const [name, value] of Object.entries(set)) expect(response.headers.get(name), name).toBe(value);
}

describe('security headers on Worker responses', () => {
  it('/hitno carries the page set and keeps its own cache-control', async () => {
    const response = await open('sec-hitno.test', '/hitno');
    expect(response.status).toBe(200);
    expectHeaders(response, PAGE_SECURITY_HEADERS);
    expect(response.headers.get('cache-control')).toBe('public, max-age=0, s-maxage=60');
  });

  it('/open/*.json carries the data set and keeps CORS', async () => {
    const response = await open('sec-data.test', '/open/dhmz-cap.json');
    expect(response.status).toBe(200);
    expectHeaders(response, DATA_SECURITY_HEADERS);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('/open 404s carry the data set too', async () => {
    const response = await open('sec-404.test', '/open/nepoznato.json');
    expect(response.status).toBe(404);
    expectHeaders(response, DATA_SECURITY_HEADERS);
  });

  it('/stats carries the stats set on the fail-closed 404 and on the page', async () => {
    const denied = new Request('https://zagreb.aningfilm.hr/stats');
    const r404 = await handleStats(denied, testEnv, createExecutionContext(), new URL(denied.url), { verify: async () => false });
    expect(r404!.status).toBe(404);
    expectHeaders(r404!, STATS_SECURITY_HEADERS);

    const allowed = new Request('https://zagreb.aningfilm.hr/stats?days=7');
    const r200 = await handleStats(allowed, testEnv, createExecutionContext(), new URL(allowed.url), {
      verify: async () => true,
      loadRows: async () => [],
    });
    expect(r200!.status).toBe(200);
    expectHeaders(r200!, STATS_SECURITY_HEADERS);
    expect(r200!.headers.get('set-cookie')).toBeNull();
  });
});
