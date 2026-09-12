// The frame loop: draws at the screen's own refresh rate through a raf-like
// primitive, parking once nothing is changing and waking only on real news
// (a new snapshot's `nudge`, or a resize -- both are the caller's job to
// call `nudge` for; this module does not listen for either itself), and
// derating itself when a frame is too slow to keep pace. The point of area
// T (the rule this area exists to enforce: "a reported position is
// evidence, never output") is a *smooth* motion model -- and a model that
// computes smoothly means nothing if the loop painting it stutters, or
// burns a battery redrawing an unmoved city all night.
//
// Alongside it, `nextPollDelay` is the tick-aligned poller: the realtime
// feed updates on its own ~30s cadence (probe, 12 September), so polling on
// a fixed 20s offset (`dashboard.ts`'s current `POLL_MS`) wastes roughly a
// third of every request against a snapshot that has not changed yet.
// Aligning to the feed's own tick, plus a cushion for jitter, halves that
// waste -- the same "redundant traffic" objection Matija has raised before.

export interface LoopDeps {
  /** Defaults to `requestAnimationFrame`. */
  raf?: (cb: (t: number) => void) => number;
  /** Defaults to `cancelAnimationFrame`. */
  cancel?: (h: number) => void;
  /** Defaults to `Date.now`. The same epoch-ms clock `Fix.at` and
   *  `Model.step` already use -- never a raf callback's own high-res
   *  timestamp, which is relative to navigation start and means nothing to
   *  the motion model. */
  now?: () => number;
  reducedMotion?: boolean;
  lightweight?: boolean;
}

export interface Loop {
  start(): void;
  stop(): void;
  /** Wakes a parked loop: the caller calls this when a new snapshot lands,
   *  or the viewport resizes. A no-op while the loop is already running
   *  and not parked. */
  nudge(): void;
  /** Total frames actually drawn since the last `start()`. Exported so
   *  T11's end-to-end proof can assert an advancing counter instead of
   *  diffing pixels. */
  frames(): number;
}

/** A drawn frame must fit comfortably inside a 60Hz budget (16.67ms), with
 *  room left for the browser's own paint and compositing after our JS
 *  returns; 12ms is that headroom, not the whole budget. */
const FRAME_BUDGET_MS = 12;
/** One slow frame is jitter -- a GC pause, a stray layout. Three in a row is
 *  the device telling us it cannot sustain this rate. */
const SLOW_STREAK_TO_HALVE = 3;
/** Nothing has moved for this many frames straight: every vehicle is either
 *  stale or already converged onto its target, and continuing to paint an
 *  unchanged frame would only burn battery on a screen nobody is watching
 *  right now. */
const PARK_AFTER_UNCHANGED = 8;
/** R-L1/R-L2's "honest reading": reduced motion and lightweight both mean
 *  *do not animate*, not *animate slower*. Once a second is a live clock
 *  tick, not a slow filmstrip. */
const REDUCED_MOTION_INTERVAL_MS = 1000;

export function createLoop(draw: (now: number) => boolean, deps: LoopDeps = {}): Loop {
  const rafFn = deps.raf ?? ((cb: (t: number) => void) => requestAnimationFrame(cb));
  const cancelFn = deps.cancel ?? ((h: number) => cancelAnimationFrame(h));
  const clockNow = deps.now ?? (() => Date.now());
  const reduced = Boolean(deps.reducedMotion || deps.lightweight);

  let running = false;
  let parked = false;
  let handle: number | null = null;
  let frameCount = 0;

  // Full-rate (animated) path state.
  let tick = 0;
  let rateDivisor = 1; // 1 = every tick draws; 2 = every other tick, etc.
  let slowStreak = 0;
  let unchangedStreak = 0;

  // Reduced-motion / lightweight path state.
  let lastReducedDrawAt: number | null = null;

  function scheduleFull(): void {
    handle = rafFn(onFullFrame);
  }

  function onFullFrame(): void {
    handle = null;
    if (!running || parked) return; // stop()/park raced a callback already in flight

    tick++;
    if (tick % rateDivisor !== 0) {
      scheduleFull(); // this tick is deliberately skipped to relieve an overloaded device
      return;
    }

    const before = clockNow();
    let changed = false;
    try {
      changed = draw(before);
      frameCount++;
    } catch (err) {
      // A throwing `draw` (a bug reacting to a malformed snapshot, say) must
      // never unwind past this point: on a kiosk meant to run unattended for
      // hours (R-P1), letting the exception escape would abort before
      // scheduleFull() is reached, leaving the loop neither drawing nor
      // properly parked (parked never became true either) -- a state
      // nothing, not even nudge(), can recover from. Treating the throw as
      // an unchanged frame keeps it inside the loop's own recovery paths:
      // it either draws again next tick, or parks after the usual streak,
      // from which nudge() already knows how to wake it.
      console.error('[motion loop] draw() threw; treating this frame as unchanged', err);
    }
    const elapsed = clockNow() - before;

    if (elapsed > FRAME_BUDGET_MS) {
      slowStreak++;
      if (slowStreak >= SLOW_STREAK_TO_HALVE) {
        rateDivisor *= 2;
        slowStreak = 0;
      }
    } else {
      slowStreak = 0;
      // Recovery is one step at a time (a halving undone), never a jump
      // straight back to full rate -- see decision 3's reasoning for the
      // model's own constants; the loop follows the same discipline.
      if (rateDivisor > 1) rateDivisor = Math.floor(rateDivisor / 2) || 1;
    }

    if (changed) {
      unchangedStreak = 0;
    } else {
      unchangedStreak++;
      if (unchangedStreak >= PARK_AFTER_UNCHANGED) {
        parked = true;
        return; // no scheduleFull(): parked means no further frame is requested
      }
    }
    scheduleFull();
  }

  function scheduleReduced(): void {
    handle = rafFn(onReducedFrame);
  }

  function onReducedFrame(): void {
    handle = null;
    if (!running) return;
    const now = clockNow();
    if (lastReducedDrawAt === null || now - lastReducedDrawAt >= REDUCED_MOTION_INTERVAL_MS) {
      lastReducedDrawAt = now;
      try {
        draw(now); // no interpolation: a plain jump to whatever `draw` computes for `now`
        frameCount++;
      } catch (err) {
        // Same reasoning as onFullFrame's catch: an uncaught throw here would
        // abort before scheduleReduced() runs, freezing the once-a-second
        // clock tick for good.
        console.error('[motion loop] draw() threw; treating this frame as unchanged', err);
      }
    }
    scheduleReduced();
  }

  return {
    start() {
      if (running) return; // idempotent: already going
      running = true;
      parked = false;
      tick = 0;
      rateDivisor = 1;
      slowStreak = 0;
      unchangedStreak = 0;
      lastReducedDrawAt = null;
      frameCount = 0; // frames() is documented as "since the last start()" -- a restart is a fresh count
      if (reduced) scheduleReduced();
      else scheduleFull();
    },

    stop() {
      running = false;
      parked = false;
      if (handle !== null) {
        cancelFn(handle);
        handle = null;
      }
    },

    nudge() {
      unchangedStreak = 0; // fresh evidence: give it a full run before parking again
      if (running && parked) {
        parked = false;
        scheduleFull(); // reduced-motion mode never parks, so this only ever applies here
      }
    },

    frames() {
      return frameCount;
    },
  };
}

// --- The tick-aligned poller ---

/** The realtime feed's own cadence (probe, 12 September): a `VehiclePosition`
 *  ticks about every 30s. */
const FEED_TICK_MS = 30_000;
/** Absorbs ordinary network and processing jitter around that tick without
 *  polling early enough to catch the same still-stale snapshot twice. */
const POLL_CUSHION_MS = 2_000;
/** The previous fixed cadence (`dashboard.ts`'s `POLL_MS`), kept as the
 *  fallback for a snapshot that carries no `sourceUpdatedAt` yet -- a cold
 *  start, or a source that is down -- so a poll with no timestamp evidence
 *  to align to still retries at a sane rate instead of guessing at a tick
 *  it cannot see. */
export const POLL_FALLBACK_MS = 20_000;

/**
 * How long to wait before polling again, aligned to the feed's own tick
 * instead of a fixed offset: `sourceUpdatedAt` plus the tick plus the
 * cushion, minus `now`. Given a working timestamp this halves wasted
 * requests against a feed that changes twice a minute (the "redundant
 * traffic" objection Matija has raised); without one it falls back to the
 * previous fixed delay. Never returns a negative delay -- an aligned target
 * already in the past (a slow poll, a backgrounded tab) means "poll now",
 * not "poll less often than before".
 */
export function nextPollDelay(sourceUpdatedAt: string | undefined, now: number): number {
  if (sourceUpdatedAt !== undefined) {
    const at = Date.parse(sourceUpdatedAt);
    if (Number.isFinite(at)) {
      return Math.max(0, at + FEED_TICK_MS + POLL_CUSHION_MS - now);
    }
  }
  return POLL_FALLBACK_MS;
}
