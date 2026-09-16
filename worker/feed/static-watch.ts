// The static-feed drift watch (R-TE18). The twin joins realtime trip ids
// against a static GTFS cut at build time (scripts/gtfs-trips.mjs and
// scripts/gtfs-shapes.mjs, one feed version between them, R-TE16). When ZET
// publishes a new static feed the realtime trip ids may move with it and the
// join goes dark trip by trip. The twin itself counts unknown trips
// (twin_tick stale_index); this watch tells the cause a day earlier: once an
// hour, from the five-minute cron, one HEAD of the static archive, and its
// Last-Modified compared with the build time of the artefacts. The runbook
// when it says "newer": `npm run build:network && npm run build:trips`,
// commit, push. Nothing here downloads the archive: the Worker never does.

import { BUILT_AT } from '../../app/src/motion/network-meta';
import type { Env } from '../env';
import { logError } from '../log';
import { recordMetric } from '../metrics';
import { upstreamFetch } from './http';

export const STATIC_GTFS_URL = 'https://www.zet.hr/gtfs-scheduled/latest';

/** Once an hour: ZET publishes a static feed a few times a month, so an
 *  hourly HEAD (24 requests a day) learns of it the same morning at no
 *  cost to anyone; the cron runs every five minutes, so the check keeps
 *  its own clock in KV. */
export const WATCH_INTERVAL_MS = 60 * 60 * 1000;

export const WATCH_KEY = 'static-watch:checked-at';

export type WatchOutcome = 'current' | 'newer' | 'unknown' | 'error';

export interface StaticWatchDeps {
  /** A HEAD of the archive, identified and time-boxed (worker/feed/http.ts). */
  head: (url: string) => Promise<Response>;
  now: () => number;
  /** The remembered epoch ms of the last check, as a string, or null. */
  load: () => Promise<string | null>;
  save: (value: string) => Promise<void>;
  record: (outcome: WatchOutcome) => void;
  /** ISO build time of the artefacts (network-meta.ts BUILT_AT). */
  builtAt: string;
}

/** Newer when the archive changed after the artefacts were built; unknown
 *  when the header is missing or unreadable, never a guess. */
export function judgeStaticFeed(lastModified: string | null, builtAt: string): WatchOutcome {
  if (lastModified === null) return 'unknown';
  const modified = Date.parse(lastModified);
  const built = Date.parse(builtAt);
  if (!Number.isFinite(modified) || !Number.isFinite(built)) return 'unknown';
  return modified > built ? 'newer' : 'current';
}

export async function watchStaticFeed(deps: StaticWatchDeps): Promise<WatchOutcome | 'skipped'> {
  const now = deps.now();
  const last = Number(await deps.load());
  if (Number.isFinite(last) && last > 0 && now - last < WATCH_INTERVAL_MS) return 'skipped';
  // Remembered before the request, so a dead host is asked hourly, not every
  // five minutes.
  await deps.save(String(now));
  let outcome: WatchOutcome;
  try {
    const response = await deps.head(STATIC_GTFS_URL);
    outcome = judgeStaticFeed(response.headers.get('last-modified'), deps.builtAt);
  } catch (error) {
    logError('static_watch_failed', error);
    outcome = 'error';
  }
  deps.record(outcome);
  return outcome;
}

/** Production wiring: the KV namespace the feed modules already use keeps
 *  the clock, the shared upstream helper does the HEAD, MetricsDO counts. */
export function staticWatchDeps(env: Env): StaticWatchDeps {
  return {
    head: (url) => upstreamFetch(url, { method: 'HEAD' }),
    now: () => Date.now(),
    load: () => env.FEED.get(WATCH_KEY),
    save: (value) => env.FEED.put(WATCH_KEY, value),
    record: (outcome) => recordMetric(env, 'static_watch', outcome),
    builtAt: BUILT_AT,
  };
}
