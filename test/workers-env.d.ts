// `env` from cloudflare:test is typed as Cloudflare.Env; give it the worker's bindings.
import type { Env as WorkerEnv } from '../worker/env';

declare global {
  namespace Cloudflare {
    interface Env extends WorkerEnv {}
  }
}

export {};
