import type { Env } from '../env';
import { json } from '../http';
import { CITY_PREFIX, readManifest } from '../city/catalogue';
import { cachedAirDetail, loadCityLive } from '../city/live';
import { departuresFrom, stopShard, type SchedulePart } from '../city/schedules';
async function chunk(env: Env, hash: string): Promise<Response | null> {
  const key = `${CITY_PREFIX}chunks/${hash}.json`;
  const stored = await env.MAPS?.get(key);
  if (stored) return new Response(stored.body, { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=31536000, immutable' } });
  const response = await env.ASSETS.fetch(new Request(`https://catalogue.internal/data/city/chunks/${hash}.json`));
  return response.ok ? response : null;
}
export async function handleCity(request: Request, env: Env, _ctx: ExecutionContext, url: URL): Promise<Response | null> {
  if (!url.pathname.startsWith('/api/city/')) return null;
  if (request.method !== 'GET') return json({ error: 'method-not-allowed' }, 405, { allow: 'GET' });
  if (!(await env.RL_OPEN.limit({ key: 'city:' + (request.headers.get('CF-Connecting-IP') ?? 'local') })).success)
    return json({ error: 'rate-limited' }, 429);
  if (url.pathname === '/api/city/manifest') return json(await readManifest(env), 200, { 'cache-control': 'public, max-age=60' });
  if (url.pathname === '/api/city/live') return json(await loadCityLive(env), 200, { 'cache-control': 'public, max-age=30' });
  if (url.pathname.startsWith('/api/city/chunks/')) {
    const hash = url.pathname.slice('/api/city/chunks/'.length).replace(/\.json$/, '');
    if (!/^[a-f0-9]{64}$/.test(hash)) return json({ error: 'not-found' }, 404);
    return await chunk(env, hash) ?? json({ error: 'not-found' }, 404);
  }
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
