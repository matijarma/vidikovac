// When the twin's alarm fires next. ZET republishes its GTFS-Realtime file
// every 10 s (measured 16 Sept 2026 over 80 s: the header timestamp stepped
// +10 each time and the new file was visible within about a second of its
// own timestamp), so the twin rides that cadence instead of imposing one:
// one tick plus a cushion after the header it last saw. Pure, so the unit
// project can pin every branch; the Durable Object only calls nextTickAt.

/** ZET's own republish period. */
export const FEED_TICK_MS = 10_000;

/** How long after the expected publish the twin fetches: the file appears
 *  within about a second of its header time, and the alarm itself can run a
 *  few hundred milliseconds late, so 1.5 s catches the new frame on the
 *  first try nearly always; a miss costs one 304 and a retry at the floor. */
export const TICK_CUSHION_MS = 1_500;

/** Never two fetches closer than this: a retried alarm (they are at-least-
 *  once) or a frame that landed late must not turn into a burst against a
 *  feed whose terms are still under query (docs/izvori.md, M2 letter). */
export const TICK_MIN_DELAY_MS = 3_000;

/** Never wait longer than this: a header with a skewed clock, or one lost
 *  to a bad decode, must not push the loop out; the ceiling is one tick
 *  plus a cushion with 500 ms to spare. */
export const TICK_MAX_DELAY_MS = 12_000;

/** Past three missed republishes the feed has stalled: the header time no
 *  longer says anything about the next publish, so the twin falls back to
 *  its own plain 10 s cadence until a fresh header arrives. */
export const FEED_STALL_MS = 30_000;

/**
 * Epoch ms of the next tick, given the last header time (seconds, or null
 * before the first frame) and the wall clock now.
 */
export function nextTickAt(headerTs: number | null, nowMs: number): number {
  if (headerTs === null) return nowMs + FEED_TICK_MS;
  const headerMs = headerTs * 1000;
  if (nowMs - headerMs > FEED_STALL_MS) return nowMs + FEED_TICK_MS;
  const target = headerMs + FEED_TICK_MS + TICK_CUSHION_MS;
  return Math.min(nowMs + TICK_MAX_DELAY_MS, Math.max(nowMs + TICK_MIN_DELAY_MS, target));
}
