import type { Env } from '../env';
import { handleHitno } from '../hitno/route';
import type { OpenDeps } from '../open/deps';
import { handleOpenData } from '../open/route';
import { HITNO_SECURITY_HEADERS, PAGE_SECURITY_HEADERS, securityHeadersFor, withSecurityHeaders } from '../security-headers';

/**
 * Open-tier dispatcher: /hitno and /open/* (Task D2). Returns null for any
 * other path so worker/index.ts moves on to the next handler and finally to
 * the asset store. Every response leaving here carries the page or data
 * security set (worker/security-headers.ts). The optional fifth argument is a
 * test seam only; the dispatcher calls it with four.
 */
export async function handleOpen(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  url: URL,
  deps: OpenDeps = {},
): Promise<Response | null> {
  let response: Response | null = null;
  const hitno = url.pathname === '/hitno' || url.pathname === '/hitno/';
  if (hitno) {
    response = await handleHitno(request, env, ctx, url, deps);
  } else if (url.pathname === '/open' || url.pathname.startsWith('/open/')) {
    response = await handleOpenData(request, env, ctx, url, deps);
  }
  if (response === null) return null;
  const set = securityHeadersFor(response);
  // The /hitno page is one of the four the /dev/ grid frames (worker/routes/dev.ts).
  return withSecurityHeaders(response, hitno && set === PAGE_SECURITY_HEADERS ? HITNO_SECURITY_HEADERS : set);
}
