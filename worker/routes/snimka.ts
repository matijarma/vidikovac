// /api/snimka/v1/ and /api/snimka/v2/: the public replay dataset of the ZET strike of 28 to 30 September 2026.
//
// GET and HEAD map to R2 bucket vidikovac-feed (binding RECORDINGS) under one
// prefix per version, `archive/strike-2026-09/public/v1/` and `.../v2/`. Both
// are outside the seven-day lifecycle rule on the bucket, and a route that maps
// only them can never reach the raw frames (`zet-rt/`, `frames/`): O-73 stays
// mechanically true for raw GTFS-RT. What lives under them is derived data
// written by scripts/snimka/ (docs/snimka-2026-10.md sections 5 and 14) and
// served unchanged. v1 is served for a grace week beside v2; a v3 declines.
//
// The path rule is strict (snimkaObjectPath): lowercase segments, `.json`,
// `.webp`, `.csv` or `.geojson`, no `..`, so a request cannot name anything the
// pipeline did not write. Every object but manifest.json is content-named and
// immutable; the manifest is cached for a minute in the browser and five at the
// edge, so the deploy order (objects, then manifest, then push) is also the
// visibility order.
//
// v2 only: the stable alias `exports/latest/<name>.<ext>` answers 302 to the
// hashed path the manifest lists for that export, so the open-data catalogue
// can link addresses that survive a rebuild.
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

export const SNIMKA_R2_PREFIX_V1 = 'archive/strike-2026-09/public/v1/';
/** The current dataset (SNIMKA_API); the default of snimkaObjectPath. */
export const SNIMKA_R2_PREFIX = 'archive/strike-2026-09/public/v2/';
const PREFIXES = { 1: SNIMKA_R2_PREFIX_V1, 2: SNIMKA_R2_PREFIX } as const;
type Version = keyof typeof PREFIXES;
const API_PATH = /^\/api\/snimka\/v([12])\//;
/** The v2 alias: `exports/latest/<name>.<ext>`. */
const ALIAS = /^exports\/latest\/([a-z0-9-]+)\.(csv|json|geojson)$/;
export const SNIMKA_MANIFEST = 'manifest.json';

const IMMUTABLE = 'public, max-age=31536000, immutable';
const MANIFEST_CACHE = 'public, max-age=60, s-maxage=300';
const MAX_REST = 160;
const MAX_SEGMENTS = 4;
const SEGMENT = /^[a-z0-9][a-z0-9._-]*$/;
/** `<name>.<sha256 first 16 hex>.<ext>`, as shared/snimka-codec.ts contentName writes it. */
const HASHED = /\.[0-9a-f]{16}\.(?:json|webp|csv|geojson)$/;
const EXTENSIONS = ['.json', '.webp', '.csv', '.geojson'] as const;
const CONTENT_TYPES: Record<string, string> = {
  json: 'application/json; charset=utf-8',
  webp: 'image/webp',
  csv: 'text/csv; charset=utf-8',
  geojson: 'application/geo+json; charset=utf-8',
};

const CORS = { 'access-control-allow-origin': '*' } as const;

export interface SnimkaDeps {
  /** Test seam; production reads the RECORDINGS binding. */
  bucket?: (env: Env) => R2Bucket | undefined;
}

/**
 * The R2 key for the part of the URL after `/api/snimka/v<n>/`, or null when the
 * path is not one the dataset can hold: one to four segments of
 * `[a-z0-9][a-z0-9._-]*`, the last ending in `.json`, `.webp`, `.csv` or
 * `.geojson`, no `..` anywhere, at most 160 characters. The prefix of the
 * version (2 unless given) is added here and nowhere else.
 */
export function snimkaObjectPath(rest: string, version: Version = 2): string | null {
  if (rest.length === 0 || rest.length > MAX_REST || rest.includes('..')) return null;
  const segments = rest.split('/');
  if (segments.length > MAX_SEGMENTS || !segments.every((segment) => SEGMENT.test(segment))) return null;
  if (!EXTENSIONS.some((extension) => rest.endsWith(extension))) return null;
  return PREFIXES[version] + rest;
}

function notFound(): Response {
  return json({ error: 'not-found' }, 404, CORS);
}

function headersFor(key: string, object: R2Object): Headers {
  const manifest = key === PREFIXES[1] + SNIMKA_MANIFEST || key === PREFIXES[2] + SNIMKA_MANIFEST;
  const extension = key.slice(key.lastIndexOf('.') + 1);
  const headers = new Headers(CORS);
  headers.set('content-type', CONTENT_TYPES[extension] ?? CONTENT_TYPES.json!);
  if (extension === 'csv' || extension === 'geojson') {
    headers.set('content-disposition', `inline; filename="${key.slice(key.lastIndexOf('/') + 1)}"`);
  }
  headers.set('cache-control', !manifest && HASHED.test(key) ? IMMUTABLE : MANIFEST_CACHE);
  headers.set('etag', object.httpEtag);
  return headers;
}

const RATE_LIMITED = (): Response => json({ error: 'rate-limited' }, 429, { 'retry-after': '60', ...CORS });
const UNAVAILABLE = (): Response => json({ error: 'unavailable' }, 503, { 'retry-after': '60', ...CORS });

interface Alias {
  name: string;
  format: string;
}

/**
 * v2 alias: reads manifest.json through the same Cache API path as any object
 * (a miss spends rate-limit budget and fills the cache) and answers 302 to the
 * hashed path of the export the manifest lists under that name and format.
 * The redirect itself is never cached; the manifest is.
 */
async function alias(request: Request, env: Env, ctx: ExecutionContext, url: URL, deps: SnimkaDeps, wanted: Alias): Promise<Response> {
  const cache = typeof caches === 'undefined' ? null : caches.default;
  const manifestPath = `${url.origin}${SNIMKA_API}${SNIMKA_MANIFEST}`;
  const cacheKey = new Request(manifestPath, { method: 'GET' });
  let text: string | null = null;
  const hit = await cache?.match(cacheKey).catch(() => undefined);
  if (hit) {
    text = await hit.text().catch(() => null);
  } else {
    if (await openRateLimited(env, 'snimka', request)) return RATE_LIMITED();
    const bucket = (deps.bucket ?? ((e: Env) => e.RECORDINGS))(env);
    if (!bucket) return UNAVAILABLE();
    try {
      const object = await bucket.get(PREFIXES[2] + SNIMKA_MANIFEST);
      if (!object) return notFound();
      const response = new Response(object.body, { status: 200, headers: headersFor(PREFIXES[2] + SNIMKA_MANIFEST, object) });
      if (cache) ctx.waitUntil(cache.put(cacheKey, response.clone()).catch(() => undefined));
      text = await response.text();
    } catch (error) {
      logError('snimka-r2-failed', error);
      return UNAVAILABLE();
    }
  }
  const path = exportPath(text, wanted);
  if (path === null) return notFound();
  const headers = new Headers(CORS);
  headers.set('location', SNIMKA_API + path);
  headers.set('cache-control', MANIFEST_CACHE);
  return new Response(null, { status: 302, headers });
}

/** The manifest's hashed path for the export, or null when the manifest or the entry is unusable. */
function exportPath(text: string | null, wanted: Alias): string | null {
  if (text === null) return null;
  let manifest: unknown;
  try {
    manifest = JSON.parse(text);
  } catch {
    return null;
  }
  const exports = (manifest as { files?: { exports?: unknown } } | null)?.files?.exports;
  if (!Array.isArray(exports)) return null;
  for (const entry of exports as { name?: unknown; format?: unknown; path?: unknown }[]) {
    if (entry && entry.name === wanted.name && entry.format === wanted.format && typeof entry.path === 'string') {
      // The target must be a path the object rule would serve anyway.
      return snimkaObjectPath(entry.path, 2) === null ? null : entry.path;
    }
  }
  return null;
}

async function api(request: Request, env: Env, ctx: ExecutionContext, url: URL, version: Version, deps: SnimkaDeps): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return json({ error: 'method-not-allowed' }, 405, { allow: 'GET, HEAD', ...CORS });
  }
  const rest = url.pathname.slice(`/api/snimka/v${version}/`.length);
  const aliased = ALIAS.exec(rest);
  if (aliased) {
    if (version !== 2) return notFound();
    return alias(request, env, ctx, url, deps, { name: aliased[1]!, format: aliased[2]! });
  }
  const key = snimkaObjectPath(rest, version);
  if (key === null) return notFound();
  const head = request.method === 'HEAD';

  // One cache entry per path: a query string never makes a second copy.
  const cache = typeof caches === 'undefined' ? null : caches.default;
  const cacheKey = new Request(`${url.origin}${url.pathname}`, { method: 'GET' });
  const hit = await cache?.match(cacheKey).catch(() => undefined);
  if (hit) return hit;

  if (await openRateLimited(env, 'snimka', request)) return RATE_LIMITED();
  const bucket = (deps.bucket ?? ((e: Env) => e.RECORDINGS))(env);
  if (!bucket) return UNAVAILABLE();

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
    return UNAVAILABLE();
  }
}

export async function handleSnimka(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  url: URL,
  deps: SnimkaDeps = {},
): Promise<Response | null> {
  const matched = API_PATH.exec(url.pathname);
  if (!matched) return null;
  const version = Number(matched[1]) as Version;
  const response = withSecurityHeaders(await api(request, env, ctx, url, version, deps), DATA_SECURITY_HEADERS);
  // HEAD gets the headers of the GET and never a body, whatever the status (a 404 or 429 carries a JSON body otherwise).
  return request.method === 'HEAD' && response.body !== null ? new Response(null, response) : response;
}
