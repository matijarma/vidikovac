import type { Env } from './env';
import { VERSION, networkCheck } from './config';

// Durable Object classes are exported from the entry module so the migration in
// wrangler.jsonc can bind them. The real implementations replace these stubs
// task by task; storage survives because the class names never change.
export class BeaconDO implements DurableObject {
  constructor(_state: DurableObjectState, _env: Env) {}
  async fetch(): Promise<Response> {
    return json({ error: 'not-implemented' }, 501);
  }
}
export class RoomDO extends BeaconDO {}
export class IndexDO extends BeaconDO {}
export class MetricsDO extends BeaconDO {}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/api/health') {
      return json({
        ok: true,
        version: VERSION,
        networkCheck: networkCheck(env),
        time: new Date().toISOString(),
      });
    }
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/ws/')) {
      return json({ error: 'not-found' }, 404);
    }
    // Server-rendered routes (/hitno, /open, /stats) arrive in later tasks; until
    // then the asset store answers with its 404 page.
    return env.ASSETS.fetch(request);
  },
  async scheduled(): Promise<void> {
    // Feed warming arrives with the feed layer.
  },
} satisfies ExportedHandler<Env>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
