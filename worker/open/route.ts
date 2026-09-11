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
import { fillAttribution } from './attribution';
import { CATALOG_TTL_SECONDS, buildCatalog, findOpenDataset } from './catalog';
import type { OpenDeps } from './deps';
import { closuresToGeoJson } from './geojson';
import { cacheControl, edgeCached, openRateLimited } from './http';
import { renderOpenIndex } from './index-page';

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

  // Every branch below funnels through this one return so HEAD stripping
  // (RFC 9110 §9.3.2: same headers, no body) applies uniformly, including the
  // 404s for a path that never reaches the feed at all.
  const response = await resolveOpenData(env, ctx, url, deps);
  if (request.method === 'HEAD') return new Response(null, response);
  return response;
}

async function resolveOpenData(env: Env, ctx: ExecutionContext, url: URL, deps: OpenDeps): Promise<Response> {
  const load = deps.getModules ?? getModules;
  const now = deps.now ?? (() => new Date());
  const path = url.pathname;
  const cacheKey = new Request(`${url.origin}${path}`, { method: 'GET' });

  if (path === '/open' || path === '/open/') {
    // Both spellings serve the same page from the same cache entry, keyed on
    // the canonical trailing-slash form (run_worker_first lists both in
    // wrangler.jsonc: '/open/*' does not match the bare '/open').
    const indexKey = new Request(`${url.origin}/open/`, { method: 'GET' });
    const { response } = await edgeCached(ctx, indexKey, async () =>
      new Response(renderOpenIndex(url.origin, now()), {
        status: 200,
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'content-language': 'hr',
          'cache-control': cacheControl(CATALOG_TTL_SECONDS),
        },
      }),
    );
    return response;
  }

  if (path === '/open/catalog.json') {
    const { response } = await edgeCached(ctx, cacheKey, async () =>
      json(buildCatalog(url.origin, now()), 200, { 'cache-control': cacheControl(CATALOG_TTL_SECONDS), ...CORS }),
    );
    return response;
  }

  if (path === '/open/prometnice.geojson') {
    const dataset = findOpenDataset('prometnice');
    if (dataset === undefined) return notFound();
    const { response } = await edgeCached(ctx, cacheKey, async () => {
      const result = await loadOpenSnapshot(load, env, ctx, dataset.module);
      if (!result.ok) return result.response;
      return json(closuresToGeoJson(result.snapshot, url.origin), 200, {
        'cache-control': cacheControl(dataset.ttl),
        'content-type': 'application/geo+json; charset=utf-8',
        ...CORS,
      });
    });
    return response;
  }

  const match = MODULE_JSON.exec(path);
  if (match === null) return notFound();
  const dataset = findOpenDataset(match[1]);
  if (dataset === undefined) return notFound();
  const { response } = await edgeCached(ctx, cacheKey, async () => {
    const result = await loadOpenSnapshot(load, env, ctx, dataset.module);
    if (!result.ok) return result.response;
    // R-08's placeholders are filled from this same live snapshot before it
    // leaves the Worker (R-62); the static catalogue (buildCatalog above)
    // keeps its template verbatim, but this is a live reading, not a listing.
    const snapshot = {
      ...result.snapshot,
      attribution: {
        ...result.snapshot.attribution,
        text: fillAttribution(result.snapshot.attribution, result.snapshot, result.snapshot.items[0]),
      },
    };
    return json(snapshot, 200, { 'cache-control': cacheControl(dataset.ttl), ...CORS });
  });
  return response;
}
