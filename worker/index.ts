import { withoutEdgeTransforms } from './security-headers';
import type { Env } from './env';
import { VERSION, networkCheck } from './config';
import { json } from './http';
import { handleFeed } from './routes/feed';
import { handlePairing } from './routes/pairing';
import { handleAdmin } from './routes/admin';
import { handleOpen } from './routes/open';
import { handleStats } from './routes/stats';
import { handleScreens } from './routes/screens';
import { handleMaps } from './routes/maps';
import { warmFeeds } from './feed/cache';
import { twinStub } from './do/twin-do';
import { staticWatchDeps, watchStaticFeed } from './feed/static-watch';
import { logError } from './log';

// Durable Object classes are re-exported from the entry module so the migration
// in wrangler.jsonc can bind them. Storage survives because the class names
// never change.
export { BeaconDO } from './do/beacon-do';
export { RoomDO } from './do/room-do';
export { IndexDO } from './do/index-do';
export { MetricsDO } from './metrics-do';
export { TwinDO } from './do/twin-do';
export { json } from './http';

export type RouteHandler = (
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  url: URL,
) => Promise<Response | null>;

// Order matters only for overlapping prefixes; each handler returns null when
// the path is not its own. Static assets answer everything the Worker declines.
const ROUTES: RouteHandler[] = [handleFeed, handlePairing, handleAdmin, handleScreens, handleMaps, handleOpen, handleStats];

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/api/health') {
      return json({
        ok: true,
        version: VERSION,
        networkCheck: networkCheck(env),
        time: new Date().toISOString(),
      });
    }
    for (const handler of ROUTES) {
      const response = await handler(request, env, ctx, url);
      if (response) return withoutEdgeTransforms(response);
    }
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/ws/')) {
      return json({ error: 'not-found' }, 404);
    }
    return withoutEdgeTransforms(await env.ASSETS.fetch(request));
  },
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    // The twin's alarm chain is self-rearming; the five-minute cron is only
    // its watchdog, restarting a chain an isolate reset may have dropped.
    await Promise.all([
      warmFeeds(env, ctx),
      twinStub(env).ensureRunning().catch((error) => logError('twin_watchdog_failed', error)),
      // Once an hour (its own clock in KV): has ZET published a static GTFS newer than our artefacts?
      watchStaticFeed(staticWatchDeps(env)).catch((error) => logError('static_watch_failed', error)),
    ]);
  },
} satisfies ExportedHandler<Env>;
