import type { Env } from '../env';
import { handleHitno } from '../hitno/route';
import type { OpenDeps } from '../open/deps';

/**
 * Open-tier dispatcher: /hitno now, /open/* in Task D2. Returns null for any
 * other path so worker/index.ts moves on to the next handler and finally to
 * the asset store. The optional fifth argument is a test seam only; the
 * dispatcher calls it with four.
 */
export async function handleOpen(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  url: URL,
  deps: OpenDeps = {},
): Promise<Response | null> {
  if (url.pathname === '/hitno' || url.pathname === '/hitno/') {
    return handleHitno(request, env, ctx, url, deps);
  }
  return null;
}
