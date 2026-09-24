import type { Env } from '../env';
import { json } from '../http';
import { CITY_PREFIX, readManifest } from '../city/catalogue';
import { cachedAirDetail, loadCityLive } from '../city/live';
import { departuresFrom, stopShard, type SchedulePart } from '../city/schedules';
const IMMUTABLE = 'public, max-age=31536000, immutable';
/** One city budget per IP (RL_OPEN, 120 per 60 s). A 429 says when to come back. */
const RATE_LIMITED = () => json({ error: 'rate-limited' }, 429, { 'retry-after': '60' });
async function chunk(env: Env, hash: string): Promise<Response | null> {
  const key = `${CITY_PREFIX}chunks/${hash}.json`;
  const stored = await env.MAPS?.get(key);
  if (stored) return new Response(stored.body, { headers: { 'content-type': 'application/json', 'cache-control': IMMUTABLE } });
  const response = await env.ASSETS.fetch(new Request(`https://catalogue.internal/data/city/chunks/${hash}.json`));
  if (!response.ok) return null;
  const headers = new Headers(response.headers);
  headers.set('cache-control', IMMUTABLE);
  return new Response(response.body, { status: 200, headers });
}
/** Content-hashed chunks are immutable: a known hash is served from the colo's
 * cache or storage without touching the per-IP budget (a wall, a phone and a
 * desktop behind one household IP load ~80 of them each on a cold start).
 * Only an unknown hash is charged, so guessing hashes stays bounded. */
async function chunkRoute(request: Request, env: Env, ctx: ExecutionContext, hash: string): Promise<Response> {
  const cache = typeof caches === 'undefined' ? null : caches.default;
  const cacheKey = new Request(new URL(request.url).origin + `/api/city/chunks/${hash}.json`);
  const hit = await cache?.match(cacheKey).catch(() => undefined);
  if (hit) return hit;
  const response = await chunk(env, hash);
  if (response) {
    if (cache) ctx.waitUntil(cache.put(cacheKey, response.clone()).catch(() => undefined));
    return response;
  }
  if (!(await cityAllowed(env, request))) return RATE_LIMITED();
  return json({ error: 'not-found' }, 404);
}
async function cityAllowed(env: Env, request: Request): Promise<boolean> {
  return (await env.RL_OPEN.limit({ key: 'city:' + (request.headers.get('CF-Connecting-IP') ?? 'local') })).success;
}
export async function handleCity(request: Request, env: Env, ctx: ExecutionContext, url: URL): Promise<Response | null> {
  if (!url.pathname.startsWith('/api/city/')) return null;
  if (request.method !== 'GET') return json({ error: 'method-not-allowed' }, 405, { allow: 'GET' });
  if (url.pathname.startsWith('/api/city/chunks/')) {
    const hash = url.pathname.slice('/api/city/chunks/'.length).replace(/\.json$/, '');
    if (!/^[a-f0-9]{64}$/.test(hash)) return json({ error: 'not-found' }, 404);
    return chunkRoute(request, env, ctx, hash);
  }
  if (!(await cityAllowed(env, request))) return RATE_LIMITED();
  if (url.pathname === '/api/city/manifest') return json(await readManifest(env), 200, { 'cache-control': 'public, max-age=60' });
  if (url.pathname === '/api/city/live') return json(await loadCityLive(env), 200, { 'cache-control': 'public, max-age=30' });
  if (url.pathname === '/api/city/air') {
    const id = url.searchParams.get('station') ?? '';
    if (!/^\d{1,5}$/.test(id)) return json({ error: 'invalid-station' }, 400);
    try { return json({ pollutants: await cachedAirDetail(env,id) }, 200, { 'cache-control': 'public, max-age=600' }); }
    catch { return json({ error: 'unavailable' }, 503); }
  }
  if (url.pathname === '/api/city/departures') {
    const operator = url.searchParams.get('operator'), stopId = url.searchParams.get('stop') ?? '';
    if ((operator !== 'hz' && operator !== 'zet') || !/^[a-zA-Z0-9_-]{1,64}$/.test(stopId)) return json({ error: 'invalid-stop' }, 400);
    const manifest = await readManifest(env);
    const source = manifest.sources.find(s => s.id === `${operator}-schedule`);
    const hash = source?.chunks.find(c => c.part === stopShard(stopId))?.hash;
    const response = hash ? await chunk(env, hash) : null;
    const part = response ? await response.json() as SchedulePart : null;
    const board = departuresFrom(part, operator, stopId, Date.now());
    if (source?.status === 'stale' && board.status === 'live') board.status = 'stale';
    return json(board, 200, { 'cache-control': 'public, max-age=30' });
  }
  return json({ error: 'not-found' }, 404);
}
