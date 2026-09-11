import type { Env } from './env';

// Area B replaces this stub with the identifier-free counter store ported from psdlat.
export class MetricsDO implements DurableObject {
  constructor(_state: DurableObjectState, _env: Env) {}
  async fetch(): Promise<Response> {
    return new Response(JSON.stringify({ error: 'not-implemented' }), {
      status: 501,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  }
}
