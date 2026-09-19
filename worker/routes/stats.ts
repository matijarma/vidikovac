// /stats: the operator surface over MetricsDO. TWO GATES, both required, as in
// psdlat's stats.ts: Cloudflare Access in front of the route, and Area B's
// verifyAccess re-checking the injected JWT in full inside the Worker. Every
// failure mode (verifier says no, non-GET, unknown path, storage error) is the
// same `404 {"error":"not-found"}`, so an unauthenticated caller cannot learn
// that the route exists.
import type { Env } from '../env';
import type { TwinTables } from '../do/twin-do';
import { twinStub } from '../do/twin-do';
import { METRICS_DO_NAME, type MetricsDO, type MetricsDailyRow } from '../metrics-do';
import { zagrebDay } from '../open/time';
import { verifyAccess } from '../pairing/access';
import { STATS_SECURITY_HEADERS, withSecurityHeaders } from '../security-headers';
import { cityCsv, rawCsv } from '../stats/export';
import { DAY_MS, DEFAULT_DAYS, MAX_DAYS, renderStatsPage } from '../stats/page';

export const STATS_PATHS = ['/stats', '/stats/data.json', '/stats/export.csv', '/stats/grad.csv'] as const;
type StatsPath = (typeof STATS_PATHS)[number];

export interface StatsDeps {
  /** Test seam; production uses worker/pairing/access.ts. */
  verify?: (env: Env, request: Request) => Promise<boolean>;
  /** Test seam; production queries the MetricsDO singleton. */
  loadRows?: (env: Env, sinceDay: string) => Promise<MetricsDailyRow[]>;
  /** Test seam; production asks the twin for its live dwell and junction
   *  tables (F11). A twin that cannot answer leaves the tables empty rather
   *  than failing the page: /stats is where an operator goes when something
   *  is wrong with the twin. */
  loadTwin?: (env: Env) => Promise<TwinTables | null>;
  now?: () => Date;
}

const NO_STORE = { 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } as const;

function notFound(): Response {
  return new Response(JSON.stringify({ error: 'not-found' }), {
    status: 404,
    headers: { 'content-type': 'application/json; charset=utf-8', ...NO_STORE },
  });
}

function clampDays(raw: string | null): number {
  const parsed = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(parsed)) return DEFAULT_DAYS;
  return Math.min(MAX_DAYS, Math.max(1, parsed));
}

async function defaultLoadTwin(env: Env): Promise<TwinTables | null> {
  try {
    return await twinStub(env).tables();
  } catch (error) {
    console.error(`[vidikovac] stats-twin-tables-failed ${error instanceof Error ? `${error.name}: ${error.message}` : 'unknown-error'}`);
    return null;
  }
}

async function defaultLoadRows(env: Env, sinceDay: string): Promise<MetricsDailyRow[]> {
  const namespace = env.METRICS_DO as unknown as DurableObjectNamespace<MetricsDO>;
  const stub = namespace.get(namespace.idFromName(METRICS_DO_NAME));
  return await stub.query(sinceDay);
}

function isStatsPath(path: string): path is StatsPath {
  return (STATS_PATHS as readonly string[]).includes(path);
}

function csv(body: string, filename: string): Response {
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
      ...NO_STORE,
    },
  });
}

async function handleStatsInner(
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
  url: URL,
  deps: StatsDeps = {},
): Promise<Response | null> {
  if (url.pathname !== '/stats' && !url.pathname.startsWith('/stats/')) return null;

  const verify = deps.verify ?? verifyAccess;
  if (!(await verify(env, request))) return notFound();
  if (request.method !== 'GET') return notFound();
  if (!isStatsPath(url.pathname)) return notFound();

  const now = (deps.now ?? (() => new Date()))();
  const days = clampDays(url.searchParams.get('days'));
  const today = zagrebDay(now);
  const since = zagrebDay(new Date(now.getTime() - (days - 1) * DAY_MS));

  try {
    const rows = await (deps.loadRows ?? defaultLoadRows)(env, since);
    // Only the HTML page renders the twin's live tables; the CSV and JSON
    // exports stay exactly what they were, a dump of the counter rows.
    const twin = url.pathname === '/stats' ? await (deps.loadTwin ?? defaultLoadTwin)(env) : null;
    switch (url.pathname) {
      case '/stats':
        return new Response(renderStatsPage({ days, since, today, rows, twin }), {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8', 'content-language': 'hr', ...NO_STORE },
        });
      case '/stats/data.json':
        return new Response(JSON.stringify({ days, since, today, timeZone: 'Europe/Zagreb', rows }), {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8', ...NO_STORE },
        });
      case '/stats/export.csv':
        return csv(rawCsv(rows), `vidikovac-brojaci-${since}-${today}.csv`);
      case '/stats/grad.csv':
        return csv(cityCsv(rows), `vidikovac-grad-${since}-${today}.csv`);
    }
  } catch (error) {
    console.error(
      `[vidikovac] stats-render-failed ${error instanceof Error ? `${error.name}: ${error.message}` : 'unknown-error'}`,
    );
  }
  return notFound();
}

/** Every response under /stats, the fail-closed 404 included, carries STATS_SECURITY_HEADERS. */
export async function handleStats(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  url: URL,
  deps: StatsDeps = {},
): Promise<Response | null> {
  const response = await handleStatsInner(request, env, ctx, url, deps);
  return response === null ? null : withSecurityHeaders(response, STATS_SECURITY_HEADERS);
}
