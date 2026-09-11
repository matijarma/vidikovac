import type { Env } from '../env';

// Area B replaces this stub with the per-screen code-minting object.
export class BeaconDO implements DurableObject {
  constructor(_state: DurableObjectState, _env: Env) {}
  async fetch(): Promise<Response> {
    return new Response(JSON.stringify({ error: 'not-implemented' }), {
      status: 501,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  }
}
