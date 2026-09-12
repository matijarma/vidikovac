import type { Env } from '../env';
import type { ModuleId, ModuleSnapshot } from '../feed/schema';
import { json } from '../http';
import { getModules } from '../feed/cache';
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
}

export const TEASER_CACHE_CONTROL = 'public, s-maxage=30';

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
    const modules = snapshots.map((snapshot) => teaserSubset(snapshot, stop ?? undefined));
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
