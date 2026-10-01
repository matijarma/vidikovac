import type { Env } from '../env';
import type { FetchContext, ModuleId, ModuleSnapshot } from '../feed/schema';
import { json } from '../http';
import { CACHE_ORIGIN, getModules } from '../feed/cache';
import { makeFetchContext } from '../feed/http';
import { RADAR_IMAGE_PATH, RADAR_MAX_AGE_MS, radarCrop, radarTimestamp } from '../feed/modules/dhmz-radar';
import { MODULES, MODULE_IDS, OPEN_MODULES, TEASER_MODULES, isModuleId, teaserSubset } from '../feed/registry';
import { verifyDataToken } from '../pairing/tokens';
import { screenStop } from '../pairing/stops';

// Three endpoints, one rule: the open tier is readable by anyone and cacheable
// at the edge; everything else needs a data token minted by the room, is counted
// against RL_DATA by that token, and is never cached anywhere.

export interface FeedResponse {
  generatedAt: string;
  modules: ModuleSnapshot[];
}

export interface FeedDeps {
  getModules?: typeof getModules;
  verifyDataToken?: typeof verifyDataToken;
  now?: () => Date;
  /** The radar route's upstream context; the feed's own (User-Agent, 6 s) by default. */
  radarContext?: () => FetchContext;
}

/** DHMZ's composite around Zagreb, the 120-pixel crop (R3). */
export const RADAR_PATH = RADAR_IMAGE_PATH;
/** The edge copy of the crop, under the feed's synthetic origin (worker/feed/cache.ts). */
export const RADAR_CACHE_KEY = `${CACHE_ORIGIN}/radar/zagreb.png`;
export const RADAR_CACHE_CONTROL = 'public, max-age=300';

/**
 * GET /api/radar/zagreb.png: the crop of DHMZ's latest composite around Zagreb, cached five minutes at the edge and in
 * the browser, credited in a header. Any failure (no composite, an old one, one of another size, a decode error) is a
 * 503 that nothing caches: no image is served from an old composite (R3 D-C). The `?v=` query only keys the copies.
 */
export async function handleRadar(request: Request, ctx: ExecutionContext, deps: FeedDeps = {}): Promise<Response> {
  if (request.method !== 'GET') return json({ error: 'method-not-allowed' }, 405, { allow: 'GET' });
  const cache = (globalThis as unknown as { caches?: { default?: Cache } }).caches?.default;
  const key = new Request(RADAR_CACHE_KEY);
  try {
    const now = deps.now ?? (() => new Date());
    const cached = cache ? await cache.match(key) : undefined;
    if (cached) {
      try {
        const at = radarTimestamp(cached.headers.get('last-modified') ?? '', now());
        const headers = new Headers(cached.headers);
        headers.set('cache-control', `public, max-age=${Math.max(0, Math.min(300, Math.floor((at + RADAR_MAX_AGE_MS - now().getTime()) / 1000)))}`);
        return new Response(cached.body, { status: cached.status, headers });
      } catch { await cache?.delete(key); }
    }
    const context = deps.radarContext?.() ?? makeFetchContext(now);
    const { png, lastModified } = await radarCrop(context);
    const at = radarTimestamp(lastModified, now());
    const maxAge = Math.max(0, Math.min(300, Math.floor((at + RADAR_MAX_AGE_MS - now().getTime()) / 1000)));
    const response = new Response(png, {
      headers: {
        'content-type': 'image/png',
        'cache-control': maxAge === 300 ? RADAR_CACHE_CONTROL : `public, max-age=${maxAge}`,
        'x-attribution': 'Izvor: DHMZ',
        'last-modified': lastModified,
      },
    });
    if (cache && maxAge > 0) ctx.waitUntil(cache.put(key, response.clone()));
    return response;
  } catch {
    return json({ error: 'radar-unavailable' }, 503, { 'cache-control': 'no-store' });
  }
}

/** The teaser carries zet-rt, which turns over every 10 s (R-TE4): five
 *  seconds at the edge keeps a kiosk within one tick of the twin without
 *  costing more than one origin render per colo per tick. */
export const TEASER_CACHE_CONTROL = 'public, s-maxage=5';

export function readDataToken(request: Request, url: URL): string {
  const query = url.searchParams.get('token');
  if (query) return query;
  const authorization = request.headers.get('authorization') ?? '';
  return authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length).trim() : '';
}

export async function handleFeed(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  url: URL,
  deps: FeedDeps = {},
): Promise<Response | null> {
  const path = url.pathname;
  if (path === RADAR_PATH) return handleRadar(request, ctx, deps);
  const isSingle = path.startsWith('/api/data/');
  if (path !== '/api/teaser' && path !== '/api/data' && !isSingle) return null;
  if (request.method !== 'GET') return json({ error: 'method-not-allowed' }, 405, { allow: 'GET' });

  const load = deps.getModules ?? getModules;
  const verify = deps.verifyDataToken ?? verifyDataToken;
  const now = deps.now ?? (() => new Date());

  if (path === '/api/teaser') {
    const requestedStop = url.searchParams.get('stop');
    const stop = requestedStop ? screenStop(requestedStop) : null;
    if (requestedStop && !stop) return json({ error: 'unknown-stop' }, 400);
    const ids = [...OPEN_MODULES, ...TEASER_MODULES];
    const snapshots = await load(env, ctx, ids);
    // teaserSubset already knows, per module, whether and how to reduce a
    // snapshot (a no-op for most); applying it to every module here, not just
    // the session ones in TEASER_MODULES, is what also caps an open module
    // such as emsc down to its teaser size.
    const modules = snapshots.map((snapshot) => teaserSubset(snapshot, stop ?? undefined, now().getTime()));
    return json({ generatedAt: now().toISOString(), modules } satisfies FeedResponse, 200, {
      'cache-control': TEASER_CACHE_CONTROL,
    });
  }

  if (isSingle) {
    const id = path.slice('/api/data/'.length);
    if (!isModuleId(id)) return json({ error: 'not-found' }, 404);
    if (MODULES[id].tier !== 'open') {
      const denied = await requireToken(request, env, url, verify);
      if (denied) return denied;
    }
    const [snapshot] = await load(env, ctx, [id as ModuleId]);
    return json(snapshot);
  }

  const denied = await requireToken(request, env, url, verify);
  if (denied) return denied;
  const modules = await load(env, ctx, MODULE_IDS);
  return json({ generatedAt: now().toISOString(), modules } satisfies FeedResponse);
}

/** Returns the refusal, or null when the caller may proceed. */
async function requireToken(
  request: Request,
  env: Env,
  url: URL,
  verify: typeof verifyDataToken,
): Promise<Response | null> {
  const token = readDataToken(request, url);
  if (!token) return json({ error: 'unauthorized' }, 401);
  const claims = await verify(env, token);
  if (!claims) return json({ error: 'unauthorized' }, 401);
  // Keyed by the token, not by IP: one session is one budget, and no address is read.
  const { success } = await env.RL_DATA.limit({ key: token });
  if (!success) return json({ error: 'rate-limited' }, 429);
  return null;
}
