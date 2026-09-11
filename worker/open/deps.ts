// One dependency-injection seam for every open-tier route: /hitno (Task D1),
// /open/* (Task D2) and /stats (Task D3) all take the same optional `deps`
// shape rather than each route defining its own (controller ruling R-04:
// HitnoDeps and OpenRouteDeps are not created). A route that does not need a
// field simply never reads it.
import type { Env } from '../env';
import type { ModuleId, ModuleSnapshot } from '../feed/schema';

export interface OpenDeps {
  /** Test seam; production uses worker/feed/cache.ts getModules. */
  getModules?: (env: Env, ctx: ExecutionContext, ids: ModuleId[]) => Promise<ModuleSnapshot[]>;
  now?: () => Date;
}
