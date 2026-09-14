// Final check of Area D through the real dispatcher (worker/index.ts): the
// routes are reached, the headers are on, the 404s are uniform. /hitno is
// exercised through handleOpen with a fake feed (no fetchMock in this pool
// version) and through the dispatcher only for the method gate, which answers
// before any upstream call.
import { SELF, createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { Env } from '../../worker/env';
import type { ModuleSnapshot } from '../../worker/feed/schema';
import worker from '../../worker/index';
import { handleOpen } from '../../worker/routes/open';
import { DATA_SECURITY_HEADERS, PAGE_SECURITY_HEADERS, STATS_SECURITY_HEADERS } from '../../worker/security-headers';

const testEnv = env as unknown as Env;

const CAP: ModuleSnapshot = {
  module: 'dhmz-cap',
  tier: 'open',
  status: 'live',
  fetchedAt: new Date().toISOString(),
  attribution: { text: 'Izvor: DHMZ, Otvorena dozvola', url: 'https://meteo.hr/upozorenja/cap_hr_today.xml', licence: 'Otvorena dozvola' },
  items: [
    {
      id: 'w',
      module: 'dhmz-cap',
      kind: 'warning',
      tier: 'open',
      title: 'Crveno upozorenje za obilnu kišu',
      severity: 'extreme',
      at: new Date(Date.now() - 60_000).toISOString(),
      until: new Date(Date.now() + 3_600_000).toISOString(),
    },
  ],
};

describe('Area D through the Worker', () => {
  it('GET /hitno renders the warning in words with the page security set', async () => {
    const request = new Request('https://integ-hitno.test/hitno');
    const ctx = createExecutionContext();
    const response = await handleOpen(request, { ...testEnv, RL_OPEN: { limit: async () => ({ success: true }) } }, ctx, new URL(request.url), {
      getModules: async () => [CAP],
    });
    await waitOnExecutionContext(ctx);
    expect(response!.status).toBe(200);
    const html = await response!.text();
    expect(html).toContain('Crveno upozorenje za obilnu kišu');
    expect(html).toContain('<span class="sev sev-extreme">crveno upozorenje</span>');
    expect(html).toContain('href="tel:112"');
    for (const [k, v] of Object.entries(PAGE_SECURITY_HEADERS)) expect(response!.headers.get(k)).toBe(v);
  });

  it('the dispatcher routes /hitno to Area D (405 for POST arrives before any feed call)', async () => {
    const ctx = createExecutionContext();
    const response = await worker.fetch(new Request('https://zagreb.aningfilm.hr/hitno', { method: 'POST' }), testEnv, ctx);
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET, HEAD');
  });

  it('GET /open/catalog.json answers as specified through SELF', async () => {
    const response = await SELF.fetch('https://zagreb.aningfilm.hr/open/catalog.json');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    for (const [k, v] of Object.entries(DATA_SECURITY_HEADERS)) expect(response.headers.get(k)).toBe(v);
    const body = (await response.json()) as { '@type': string; 'dct:license': string; 'dcat:dataset': { 'dct:identifier': string }[] };
    expect(body['@type']).toBe('dcat:Catalog');
    expect(body['dct:license']).toBe('https://data.gov.hr/otvorena-dozvola');
    expect(body['dcat:dataset'].map((d) => d['dct:identifier'])).toEqual(['dhmz-cap', 'emsc', 'prometnice', 'ckan-geo']);
  });

  it('GET /hitno through the whole Worker carries no-transform, so the edge serves the page as rendered', async () => {
    const response = await SELF.fetch('https://zagreb.aningfilm.hr/hitno');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe('public, max-age=0, s-maxage=60, no-transform');
  });

  it('GET /open/ and GET /open serve the HTML index with the page set', async () => {
    for (const path of ['/open/', '/open']) {
      const response = await SELF.fetch(`https://zagreb.aningfilm.hr${path}`);
      expect(response.status, path).toBe(200);
      expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
      expect(response.headers.get('cache-control')).toBe('public, max-age=0, s-maxage=3600, no-transform');
      for (const [k, v] of Object.entries(PAGE_SECURITY_HEADERS)) expect(response.headers.get(k)).toBe(v);
      const html = await response.text();
      expect(html).toContain('Ponuda Gradu Zagrebu');
      expect(html).toContain('href="/open/prometnice.geojson"');
    }
  });

  it('GET /open/<unknown>.json is a uniform JSON 404 without any upstream call', async () => {
    const response = await SELF.fetch('https://zagreb.aningfilm.hr/open/nepoznato.json');
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'not-found' });
  });

  it('GET /stats without Access is the uniform 404 with the stats set', async () => {
    for (const path of ['/stats', '/stats/data.json', '/stats/export.csv', '/stats/grad.csv', '/stats/x']) {
      const response = await SELF.fetch(`https://zagreb.aningfilm.hr${path}`);
      expect(response.status, path).toBe(404);
      await expect(response.json()).resolves.toEqual({ error: 'not-found' });
      for (const [k, v] of Object.entries(STATS_SECURITY_HEADERS)) expect(response.headers.get(k), `${path} ${k}`).toBe(v);
    }
  });

  it('/api/health is untouched by Area D headers', async () => {
    const response = await SELF.fetch('https://zagreb.aningfilm.hr/api/health');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-security-policy')).toBeNull();
  });
});
