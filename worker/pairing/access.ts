import type { Env } from '../env';

// Area B replaces this stub with fail-closed Cloudflare Access JWT verification
// (team domain and AUD from env) plus the E2E_ADMIN_BYPASS honoured only when
// networkCheck(env) === 'off'. Consumed by Area D (/stats) and the admin routes.
export async function verifyAccess(_env: Env, _request: Request): Promise<boolean> {
  return false;
}
