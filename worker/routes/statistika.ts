// /statistika/ and /api/statistika: the public report over the counters.
//
// The page is a static Vite entry (app/statistika/index.html) served from the
// asset store; it passes through here only so it can be the one page another
// page of this site may frame (/prijava/ opens it in a dialog): its CSP says
// `frame-ancestors 'self'` and X-Frame-Options SAMEORIGIN, where every other
// page says 'none' and DENY.
//
// The JSON is public, rate-limited per IP on RL_OPEN like the other open
// routes, and edge-cached for five minutes per window, so a busy day costs the
// two singleton objects (MetricsDO, TwinDO) one read per colo per window per
// five minutes. What it may contain is decided in worker/stats/public.ts; the
// raw operator view stays on /stats behind Access.
import type { Env } from '../env';
import type { LiveTables } from '../../shared/statistika';
import { statistikaWindow } from '../../shared/statistika';
import { twinStub } from '../do/twin-do';
import { json } from '../http';
import { logError } from '../log';
import { metricsStub } from '../metrics';
import type { MetricsDailyRow, MetricsTotalRow } from '../metrics-do';
import { cacheControl, edgeCached, openRateLimited } from '../open/http';
import { zagrebDay } from '../open/time';
import { DATA_SECURITY_HEADERS, withSecurityHeaders } from '../security-headers';
import { PUBLIC_SYSTEM_EVENTS, PUBLIC_USAGE_EVENTS, buildPublicStats } from '../stats/public';

export const STATISTIKA_API = '/api/statistika';
export const STATISTIKA_TTL_SECONDS = 300;
const DAY_MS = 24 * 60 * 60 * 1000;

const CORS = { 'access-control-allow-origin': '*' } as const;

export interface StatistikaDeps {
  /** Test seams; production reads the MetricsDO singleton and the twin. */
  loadUsage?: (env: Env, sinceDay: string) => Promise<MetricsDailyRow[]>;
  loadSystem?: (env: Env, sinceDay: string) => Promise<{ totals: MetricsTotalRow[]; tickDaily: MetricsTotalRow[] }>;
  loadLive?: (env: Env) => Promise<LiveTables | null>;
  now?: () => Date;
}

async function defaultLoadUsage(env: Env, sinceDay: string): Promise<MetricsDailyRow[]> {
  return await metricsStub(env).queryEvents(sinceDay, PUBLIC_USAGE_EVENTS);
}

async function defaultLoadSystem(env: Env, sinceDay: string): Promise<{ totals: MetricsTotalRow[]; tickDaily: MetricsTotalRow[] }> {
  const stub = metricsStub(env);
  const [totals, tickDaily] = await Promise.all([stub.totals(sinceDay, PUBLIC_SYSTEM_EVENTS, false), stub.totals(sinceDay, ['twin_tick'], true)]);
  return { totals, tickDaily };
}

/** A twin that cannot answer leaves the live tables out; the rest of the report stands. */
async function defaultLoadLive(env: Env): Promise<LiveTables | null> {
  try {
    return await twinStub(env).publicLive();
  } catch (error) {
    logError('statistika-live-failed', error);
    return null;
  }
}

/** The one page this site lets itself frame: CSP frame-ancestors 'self', X-Frame-Options SAMEORIGIN. */
export function allowSameOriginFrame(response: Response): Response {
  const out = new Response(response.body, response);
  const csp = out.headers.get('content-security-policy');
  if (csp !== null) out.headers.set('content-security-policy', csp.replace("frame-ancestors 'none'", "frame-ancestors 'self'"));
  out.headers.set('x-frame-options', 'SAMEORIGIN');
  return out;
}

async function page(request: Request, env: Env): Promise<Response> {
  const response = await env.ASSETS.fetch(request);
  if (!(response.headers.get('content-type') ?? '').startsWith('text/html')) return response;
  return allowSameOriginFrame(response);
}

async function produce(env: Env, url: URL, deps: StatistikaDeps): Promise<Response> {
  const days = statistikaWindow(url.searchParams.get('dani'));
  const now = (deps.now ?? (() => new Date()))();
  const today = zagrebDay(now);
  const since = zagrebDay(new Date(now.getTime() - (days - 1) * DAY_MS));
  try {
    const [usageRows, system, live] = await Promise.all([
      (deps.loadUsage ?? defaultLoadUsage)(env, since),
      (deps.loadSystem ?? defaultLoadSystem)(env, since),
      (deps.loadLive ?? defaultLoadLive)(env),
    ]);
    const body = buildPublicStats({ days, since, today, now, usageRows, systemTotals: system.totals, tickDaily: system.tickDaily, live });
    return json(body, 200, { 'cache-control': cacheControl(STATISTIKA_TTL_SECONDS), ...CORS });
  } catch (error) {
    logError('statistika-failed', error);
    return json({ error: 'unavailable' }, 503, { 'retry-after': '60', ...CORS });
  }
}

async function api(request: Request, env: Env, ctx: ExecutionContext, url: URL, deps: StatistikaDeps): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return json({ error: 'method-not-allowed' }, 405, { allow: 'GET, HEAD', ...CORS });
  }
  if (await openRateLimited(env, 'statistika', request)) {
    return json({ error: 'rate-limited', message: 'Previše zahtjeva. Pokušaj ponovno za minutu.' }, 429, { 'retry-after': '60', ...CORS });
  }
  // One cache entry per window: `dani=abc`, `dani=31` and no `dani` all share the default's.
  const days = statistikaWindow(url.searchParams.get('dani'));
  const key = new Request(`${url.origin}${STATISTIKA_API}?dani=${days}`, { method: 'GET' });
  const { response } = await edgeCached(ctx, key, () => produce(env, url, deps));
  return request.method === 'HEAD' ? new Response(null, response) : response;
}

export async function handleStatistika(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  url: URL,
  deps: StatistikaDeps = {},
): Promise<Response | null> {
  if (url.pathname === '/statistika' || url.pathname === '/statistika/') return await page(request, env);
  if (url.pathname !== STATISTIKA_API) return null;
  return withSecurityHeaders(await api(request, env, ctx, url, deps), DATA_SECURITY_HEADERS);
}
