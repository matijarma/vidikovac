// GET /open/*: catalog.json, <module>.json for open-tier modules,
// prometnice.geojson, and (Task D5) the /open/ index page. Same discipline as
// /hitno: method gate, RL_OPEN by IP, edge cache keyed on the path, then work.
//
// deps, edgeCached/cacheControl/openRateLimited (worker/open/http.ts) and json
// (worker/http.ts) are the controller-owned seams (R-03, R-04); this module
// holds no HTTP plumbing of its own.
import type { Env } from '../env';
import { getModules } from '../feed/cache';
import type { ModuleId, ModuleSnapshot } from '../feed/schema';
import { json } from '../http';
import { CATALOG_TTL_SECONDS, buildCatalog, findOpenDataset } from './catalog';
import type { OpenDeps } from './deps';
import { closuresToGeoJson } from './geojson';
import { cacheControl, edgeCached, openRateLimited } from './http';

const MODULE_JSON = /^\/open\/([a-z][a-z0-9-]*)\.json$/;

const CORS = { 'access-control-allow-origin': '*' } as const;

function notFound(): Response {
  return json({ error: 'not-found' }, 404, CORS);
}

/**
 * The feed layer (worker/feed/cache.ts) promises never to throw; if it does
 * anyway, the open tier degrades honestly (503, Retry-After) instead of an
 * unhandled 500 (R-05).
 */
function feedUnavailable(): Response {
  return json({ error: 'feed-unavailable' }, 503, { 'retry-after': '60', ...CORS });
}

type SnapshotResult = { ok: true; snapshot: ModuleSnapshot } | { ok: false; response: Response };

async function loadOpenSnapshot(
  load: NonNullable<OpenDeps['getModules']>,
  env: Env,
  ctx: ExecutionContext,
  id: ModuleId,
): Promise<SnapshotResult> {
  try {
    const [snapshot] = await load(env, ctx, [id]);
    if (snapshot === undefined || snapshot.tier !== 'open') return { ok: false, response: notFound() };
    return { ok: true, snapshot };
  } catch (error) {
    console.error(
      `[vidikovac] open-feed-failed ${error instanceof Error ? `${error.name}: ${error.message}` : 'unknown-error'}`,
    );
    return { ok: false, response: feedUnavailable() };
  }
}

export async function handleOpenData(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  url: URL,
  deps: OpenDeps = {},
): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return json({ error: 'method-not-allowed' }, 405, { allow: 'GET, HEAD', ...CORS });
  }
  if (await openRateLimited(env, 'open', request)) {
    return json(
      { error: 'rate-limited', message: 'Previše zahtjeva. Pokušaj ponovno za minutu.' },
      429,
      { 'retry-after': '60', ...CORS },
    );
  }

  const load = deps.getModules ?? getModules;
  const now = deps.now ?? (() => new Date());
  const path = url.pathname;
  const cacheKey = new Request(`${url.origin}${path}`, { method: 'GET' });

  let produced: { response: Response } | null = null;

  if (path === '/open/catalog.json') {
    produced = await edgeCached(ctx, cacheKey, async () =>
      json(buildCatalog(url.origin, now()), 200, { 'cache-control': cacheControl(CATALOG_TTL_SECONDS), ...CORS }),
    );
  } else if (path === '/open/prometnice.geojson') {
    const dataset = findOpenDataset('prometnice');
    if (dataset === undefined) return notFound();
    produced = await edgeCached(ctx, cacheKey, async () => {
      const result = await loadOpenSnapshot(load, env, ctx, dataset.module);
      if (!result.ok) return result.response;
      return json(closuresToGeoJson(result.snapshot, url.origin), 200, {
        'cache-control': cacheControl(dataset.ttl),
        'content-type': 'application/geo+json; charset=utf-8',
        ...CORS,
      });
    });
  } else {
    const match = MODULE_JSON.exec(path);
    if (match !== null) {
      const dataset = findOpenDataset(match[1]);
      if (dataset === undefined) return notFound();
      produced = await edgeCached(ctx, cacheKey, async () => {
        const result = await loadOpenSnapshot(load, env, ctx, dataset.module);
        if (!result.ok) return result.response;
        return json(result.snapshot, 200, { 'cache-control': cacheControl(dataset.ttl), ...CORS });
      });
    }
  }

  if (produced === null) return notFound();
  if (request.method === 'HEAD') return new Response(null, produced.response);
  return produced.response;
}
