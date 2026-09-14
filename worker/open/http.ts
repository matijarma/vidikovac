// HTTP plumbing shared by the open routes (/hitno, /open/*): IP-keyed rate
// limiting on RL_OPEN, bot detection for the hitno_view counter, and the
// Cache API wrapper that makes "edge-cached, s-maxage 60" true. A Worker
// response is NOT cached by Cloudflare's CDN on its own; putting it into
// caches.default with an s-maxage is what turns one render into one render
// per colo per minute.
//
// clientIp, json and html live in the controller-owned ../http (R-03); this
// module keeps only what is specific to the open tier.
import type { Env } from '../env';
import { clientIp } from '../http';

/** Same list psdlat's metrics endpoint uses. The UA string is tested and dropped, never stored. */
export const BOT_UA_RE = /bot|spider|crawl|headless|lighthouse|preview/i;

export function isBot(request: Request): boolean {
  return BOT_UA_RE.test(request.headers.get('user-agent') ?? '');
}

/**
 * True when RL_OPEN (120 requests per 60 s, wrangler.jsonc) says this IP is
 * over the line. A failing binding admits the request: the safety tier must
 * never go dark because a limiter hiccuped. The IP is used as a key inside
 * the binding call and never logged or stored.
 */
export async function openRateLimited(env: Env, bucket: string, request: Request): Promise<boolean> {
  try {
    const { success } = await env.RL_OPEN.limit({ key: `${bucket}:${clientIp(request)}` });
    return !success;
  } catch (error) {
    console.error(
      `[vidikovac] open-ratelimit-failed ${error instanceof Error ? `${error.name}: ${error.message}` : 'unknown-error'}`,
    );
    return false;
  }
}

export function cacheControl(seconds: number): string {
  // no-transform: the edge serves the page as rendered (no beacon injection into the no-JS pages).
  return `public, max-age=0, s-maxage=${seconds}, no-transform`;
}

/**
 * Serve from caches.default when present, otherwise produce and store. Only
 * 2xx responses that carry an s-maxage are stored; a 429 or a no-store page
 * is never cached.
 */
export async function edgeCached(
  ctx: ExecutionContext,
  cacheKey: Request,
  produce: () => Promise<Response>,
): Promise<{ response: Response; hit: boolean }> {
  const cache = caches.default;
  const hit = await cache.match(cacheKey);
  if (hit) return { response: hit, hit: true };
  const response = await produce();
  const cc = response.headers.get('cache-control') ?? '';
  if (response.ok && cc.includes('s-maxage')) {
    ctx.waitUntil(cache.put(cacheKey, response.clone()));
  }
  return { response, hit: false };
}
