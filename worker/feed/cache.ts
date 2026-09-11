import type { Env } from '../env';
import type { ModuleId, ModuleSnapshot } from './schema';

// Area A replaces this stub with the Cache API + KV last-good layer.
// Signatures are the cross-area contract consumed by Area D (/hitno, /open).

export async function getModule(_env: Env, _ctx: ExecutionContext, _id: ModuleId): Promise<ModuleSnapshot> {
  throw new Error('feed layer not implemented');
}

export async function getModules(
  _env: Env,
  _ctx: ExecutionContext,
  _ids: ModuleId[],
): Promise<ModuleSnapshot[]> {
  throw new Error('feed layer not implemented');
}

export async function warmFeeds(_env: Env, _ctx: ExecutionContext): Promise<void> {}
