import { SELF, createExecutionContext, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { Env } from '../../worker/env';
import type { MetricsDailyRow } from '../../worker/metrics-do';
import { handleStats } from '../../worker/routes/stats';

const testEnv = env as unknown as Env;
const NOW = () => new Date('2026-09-11T10:00:00Z');

const ROWS: MetricsDailyRow[] = [
  { day: '2026-09-10', hour: 10, event: 'session_start', dim1: 'kiosk', dim2: 'donji-grad', count: 23 },
  { day: '2026-09-10', hour: 10, event: 'session_start', dim1: 'phone', dim2: '', count: 3 },
  { day: '2026-09-10', hour: 12, event: 'over_cap', dim1: '', dim2: '', count: 1 },
];

const allow = async () => true;
const deny = async () => false;
const loadRows = async (_env: Env, since: string) => ROWS.filter((r) => r.day >= since);

async function call(path: string, deps: Parameters<typeof handleStats>[4], init: RequestInit = {}) {
  const request = new Request(`https://zagreb.aningfilm.hr${path}`, init);
  return handleStats(request, testEnv, createExecutionContext(), new URL(request.url), deps);
}

async function expectNotFound(response: Response | null): Promise<void> {
  expect(response).not.toBeNull();
  expect(response!.status).toBe(404);
  expect(response!.headers.get('cache-control')).toBe('no-store');
  expect(response!.headers.get('x-robots-tag')).toBe('noindex');
  await expect(response!.json()).resolves.toEqual({ error: 'not-found' });
}

describe('/stats access control', () => {
  it('404s every /stats path when the verifier says no', async () => {
    for (const path of ['/stats', '/stats/data.json', '/stats/export.csv', '/stats/grad.csv', '/stats/anything']) {
      await expectNotFound(await call(path, { verify: deny, loadRows, now: NOW }));
    }
  });

  it('404s unknown paths and non-GET even when verified', async () => {
    await expectNotFound(await call('/stats/admin', { verify: allow, loadRows, now: NOW }));
    await expectNotFound(await call('/stats', { verify: allow, loadRows, now: NOW }, { method: 'POST' }));
  });

  it('404s when the row loader throws (an ops problem is not information for the caller)', async () => {
    await expectNotFound(
      await call('/stats', {
        verify: allow,
        now: NOW,
        loadRows: async () => {
          throw new Error('do-unavailable');
        },
      }),
    );
  });

  it('404s through the real Worker with no Access vars set', async () => {
    const response = await SELF.fetch('https://zagreb.aningfilm.hr/stats');
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'not-found' });
  });

  it('returns null for paths outside /stats so the dispatcher moves on', async () => {
    expect(await call('/hitno', { verify: allow, loadRows, now: NOW })).toBeNull();
  });
});

describe('/stats with a verified caller', () => {
  it('renders the page with raw counts and a 7-day window in Zagreb days', async () => {
    const response = await call('/stats?days=7', { verify: allow, loadRows, now: NOW });
    expect(response!.status).toBe(200);
    expect(response!.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(response!.headers.get('cache-control')).toBe('no-store');
    const html = await response!.text();
    expect(html).toContain('7 dana do 2026-09-11 · od 2026-09-05');
    expect(html).toContain('>23<');
    expect(html).not.toContain('<script');
  });

  it('clamps ?days= to 1..365 and defaults to 30', async () => {
    const big = await (await call('/stats?days=9999', { verify: allow, loadRows, now: NOW }))!.text();
    expect(big).toContain('365 dana');
    const bad = await (await call('/stats?days=abc', { verify: allow, loadRows, now: NOW }))!.text();
    expect(bad).toContain('30 dana');
    const zero = await (await call('/stats?days=0', { verify: allow, loadRows, now: NOW }))!.text();
    expect(zero).toContain('1 dana');
  });

  it('serves data.json with the window and the raw rows', async () => {
    const response = await call('/stats/data.json?days=30', { verify: allow, loadRows, now: NOW });
    expect(response!.status).toBe(200);
    expect(response!.headers.get('content-type')).toBe('application/json; charset=utf-8');
    const body = (await response!.json()) as { days: number; since: string; today: string; timeZone: string; rows: MetricsDailyRow[] };
    expect(body).toMatchObject({ days: 30, since: '2026-08-13', today: '2026-09-11', timeZone: 'Europe/Zagreb' });
    expect(body.rows).toEqual(ROWS);
  });

  it('serves export.csv raw and grad.csv folded, both as attachments', async () => {
    const raw = await call('/stats/export.csv?days=30', { verify: allow, loadRows, now: NOW });
    expect(raw!.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(raw!.headers.get('content-disposition')).toBe('attachment; filename="vidikovac-brojaci-2026-08-13-2026-09-11.csv"');
    const rawText = await raw!.text();
    expect(rawText).toContain('2026-09-10,10,session_start,kiosk,donji-grad,23\r\n');
    expect(rawText).toContain('over_cap');

    const city = await call('/stats/grad.csv?days=30', { verify: allow, loadRows, now: NOW });
    expect(city!.headers.get('content-disposition')).toBe('attachment; filename="vidikovac-grad-2026-08-13-2026-09-11.csv"');
    const cityText = await city!.text();
    expect(cityText).toContain('2026-09,2026-09-10,10,session_start,kiosk,donji-grad,25\r\n');
    expect(cityText).not.toContain(',23');
    expect(cityText).not.toContain('over_cap');
    expect(cityText).not.toContain('phone');
  });
});
