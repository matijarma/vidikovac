// GET /hitno. Order of operations: method gate, RL_OPEN by IP, edge cache,
// render. The hitno_view counter is bumped for every human page load, cached
// or not, because the question it answers is "how often is the open tier
// read", not "how often did we render".
import type { Env } from '../env';
import { getModules } from '../feed/cache';
import { recordMetric } from '../metrics';
import type { OpenDeps } from '../open/deps';
import { cacheControl, edgeCached, isBot, openRateLimited } from '../open/http';
import { renderHitnoPage, renderTooManyRequests } from './render';
import { HITNO_MODULES, selectHitno } from './select';

export const HITNO_TTL_SECONDS = 60;

const HTML_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'content-language': 'hr',
} as const;

export async function handleHitno(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  url: URL,
  deps: OpenDeps = {},
): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Metoda nije dopuštena.', {
      status: 405,
      headers: { allow: 'GET, HEAD', 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
    });
  }
  if (await openRateLimited(env, 'hitno', request)) return renderTooManyRequests();

  const load = deps.getModules ?? getModules;
  const now = deps.now ?? (() => new Date());
  // One cache entry per origin regardless of query string.
  const cacheKey = new Request(`${url.origin}/hitno`, { method: 'GET' });

  const { response } = await edgeCached(ctx, cacheKey, async () => {
    try {
      const snapshots = await load(env, ctx, [...HITNO_MODULES]);
      const html = renderHitnoPage(selectHitno(snapshots, now()), now());
      return new Response(html, {
        status: 200,
        headers: { ...HTML_HEADERS, 'cache-control': cacheControl(HITNO_TTL_SECONDS) },
      });
    } catch (error) {
      // The feed layer promises never to throw; if it does, the page still
      // opens with every panel honestly "nedostupan" and is not cached.
      console.error(
        `[vidikovac] hitno-feed-failed ${error instanceof Error ? `${error.name}: ${error.message}` : 'unknown-error'}`,
      );
      const html = renderHitnoPage(selectHitno([], now()), now());
      return new Response(html, { status: 200, headers: { ...HTML_HEADERS, 'cache-control': 'no-store' } });
    }
  });

  if (!isBot(request)) recordMetric(env, 'hitno_view', 'page');
  if (request.method === 'HEAD') return new Response(null, response);
  return response;
}
