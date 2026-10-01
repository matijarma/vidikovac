// /api/snimka/v1/: the public replay dataset of the ZET strike of 28 to 30 September 2026.
//
// GET and HEAD map to R2 bucket vidikovac-feed (binding RECORDINGS) under one
// prefix, `archive/strike-2026-09/public/v1/`. That prefix is outside the
// seven-day lifecycle rule on the bucket, and a route that maps only it can
// never reach the raw frames (`zet-rt/`, `frames/`): O-73 stays mechanically
// true for raw GTFS-RT. What lives under it is derived data written by
// scripts/snimka/ (docs/snimka-2026-10.md section 5) and served unchanged.
//
// The path rule is strict (snimkaObjectPath): lowercase segments, `.json` or
// `.webp`, no `..`, so a request cannot name anything the pipeline did not
// write. Every object but manifest.json is content-named and immutable; the
// manifest is cached for a minute in the browser and five at the edge, so the
// deploy order (objects, then manifest, then push) is also the visibility order.
//
// Cost model: the Cache API first, so a hit spends no rate-limit budget (a page
// opens a manifest, a series and a dozen motion chunks per visit, all behind
// one household IP); a miss is charged to RL_OPEN and answers 429 when the IP
// is over the line. A missing object is a 404 that is never cached; there is no
// assets fallback, so without a manifest the page shows its unavailable state.
import type { Env } from '../env';
import { SNIMKA_API } from '../../shared/snimka';
import { json } from '../http';
import { logError } from '../log';
import { openRateLimited } from '../open/http';
import { DATA_SECURITY_HEADERS, withSecurityHeaders } from '../security-headers';

export const SNIMKA_R2_PREFIX = 'archive/strike-2026-09/public/v1/';
export const SNIMKA_MANIFEST = 'manifest.json';

const IMMUTABLE = 'public, max-age=31536000, immutable';
const MANIFEST_CACHE = 'public, max-age=60, s-maxage=300';
const MAX_REST = 160;
const MAX_SEGMENTS = 4;
const SEGMENT = /^[a-z0-9][a-z0-9._-]*$/;
/** `<name>.<sha256 first 16 hex>.<ext>`, as shared/snimka-codec.ts contentName writes it. */
const HASHED = /\.[0-9a-f]{16}\.(?:json|webp)$/;

const CORS = { 'access-control-allow-origin': '*' } as const;

export interface SnimkaDeps {
  /** Test seam; production reads the RECORDINGS binding. */
  bucket?: (env: Env) => R2Bucket | undefined;
}

/**
 * The R2 key for the part of the URL after `/api/snimka/v1/`, or null when the
 * path is not one the dataset can hold: one to four segments of
 * `[a-z0-9][a-z0-9._-]*`, the last ending in `.json` or `.webp`, no `..`
 * anywhere, at most 160 characters. The prefix is added here and nowhere else.
 */
export function snimkaObjectPath(rest: string): string | null {
  if (rest.length === 0 || rest.length > MAX_REST || rest.includes('..')) return null;
  const segments = rest.split('/');
  if (segments.length > MAX_SEGMENTS || !segments.every((segment) => SEGMENT.test(segment))) return null;
  if (!rest.endsWith('.json') && !rest.endsWith('.webp')) return null;
  return SNIMKA_R2_PREFIX + rest;
}

function notFound(): Response {
  return json({ error: 'not-found' }, 404, CORS);
}

function headersFor(key: string, object: R2Object): Headers {
  const manifest = key === SNIMKA_R2_PREFIX + SNIMKA_MANIFEST;
  const headers = new Headers(CORS);
  headers.set('content-type', key.endsWith('.webp') ? 'image/webp' : 'application/json; charset=utf-8');
  headers.set('cache-control', !manifest && HASHED.test(key) ? IMMUTABLE : MANIFEST_CACHE);
  headers.set('etag', object.httpEtag);
  return headers;
}

async function api(request: Request, env: Env, ctx: ExecutionContext, url: URL, deps: SnimkaDeps): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return json({ error: 'method-not-allowed' }, 405, { allow: 'GET, HEAD', ...CORS });
  }
  const key = snimkaObjectPath(url.pathname.slice(SNIMKA_API.length));
  if (key === null) return notFound();
  const head = request.method === 'HEAD';

  // One cache entry per path: a query string never makes a second copy.
  const cache = typeof caches === 'undefined' ? null : caches.default;
  const cacheKey = new Request(`${url.origin}${url.pathname}`, { method: 'GET' });
  const hit = await cache?.match(cacheKey).catch(() => undefined);
  if (hit) return hit;

  if (await openRateLimited(env, 'snimka', request)) {
    return json({ error: 'rate-limited' }, 429, { 'retry-after': '60', ...CORS });
  }
  const bucket = (deps.bucket ?? ((e: Env) => e.RECORDINGS))(env);
  if (!bucket) return json({ error: 'unavailable' }, 503, { 'retry-after': '60', ...CORS });

  try {
    if (head) {
      const meta = await bucket.head(key);
      if (!meta) return notFound();
      const headers = headersFor(key, meta);
      headers.set('content-length', String(meta.size));
      return new Response(null, { status: 200, headers });
    }
    const object = await bucket.get(key);
    if (!object) return notFound();
    const response = new Response(object.body, { status: 200, headers: headersFor(key, object) });
    if (cache) ctx.waitUntil(cache.put(cacheKey, response.clone()).catch(() => undefined));
    return response;
  } catch (error) {
    logError('snimka-r2-failed', error);
    return json({ error: 'unavailable' }, 503, { 'retry-after': '60', ...CORS });
  }
}

export async function handleSnimka(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  url: URL,
  deps: SnimkaDeps = {},
): Promise<Response | null> {
  if (!url.pathname.startsWith(SNIMKA_API)) return null;
  const response = withSecurityHeaders(await api(request, env, ctx, url, deps), DATA_SECURITY_HEADERS);
  // HEAD gets the headers of the GET and never a body, whatever the status (a 404 or 429 carries a JSON body otherwise).
  return request.method === 'HEAD' && response.body !== null ? new Response(null, response) : response;
}
