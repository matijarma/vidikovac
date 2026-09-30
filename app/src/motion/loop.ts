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
// a fixed 20s offset (what both surfaces did before R-F6's fix wave) wastes
// roughly a third of every request against a snapshot that has not changed
// yet. Aligning to the feed's own tick, plus a cushion for jitter, halves
// that waste -- the same "redundant traffic" objection Matija has raised
// before. kiosk.ts's teaser poll and dashboard.ts's session poll both run
// on it as a one-shot chain re-armed after every fetch.
//
// One thing the loop does watch for itself is the page coming back (lane
// tab-return, 30 Sep): a hidden tab runs no animation frame and a locked
// phone runs nothing, so the first frame after a return would otherwise ease
// every mark from where it stood minutes ago, at catch-up speed, for about as
// long again as the page was away (the owner's "frozen trams"). A gap over
// RESYNC_GAP_MS between two frames, a return to view after that long, and a
// start() that long after the last drawn frame all hand `draw` its second
// argument, `resync`: this frame re-seeds the motion from the evidence
// instead of stepping it. Calm motion is a rule for steps within a live
// session; a gap is not a step.

import { watchPageReturn, type PageLifecycle } from '../core/page-return';

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
  /** The reduced-motion and lightweight path's clock tick (R-F6: those
   *  loops never touch requestAnimationFrame). Default to the globals; the
   *  same interval-shaped pair kiosk.ts and dashboard.ts inject fits, used
   *  as a one-shot re-armed after each tick. */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  reducedMotion?: boolean;
  lightweight?: boolean;
  /** Where the page's leaving and returning are heard (core/page-return.ts); the page's own document by default. */
  lifecycle?: PageLifecycle;
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
/** The other half of a frame's cost, which `draw` never sees: what the
 *  renderer does with what the frame pushed (MapLibre re-tiles the source
 *  and paints the whole scene, on a software GPU for the better part of a
 *  second). It shows as the gap before the next animation frame, so a frame
 *  that follows a drawn one later than this (three display frames at 60 Hz,
 *  times the rate divisor already in force) counts as a slow frame too,
 *  and the loop derates as for a slow draw (round 4 kiosk lane, handoff
 *  A2: the phone that scanned the wall, on a loaded main thread, drew a
 *  frame a second and answered a tap in six). */
export const SLOW_GAP_MS = 50;
/** One slow frame is jitter -- a GC pause, a stray layout. Three in a row is
 *  the device telling us it cannot sustain this rate. */
const SLOW_STREAK_TO_HALVE = 3;
/** Nothing has moved for this many frames straight: every vehicle is either
 *  evicted or already converged onto its target, and continuing to paint an
 *  unchanged frame would only burn battery on a screen nobody is watching
 *  right now. */
const PARK_AFTER_UNCHANGED = 8;
/** R-L1/R-L2's "honest reading": reduced motion and lightweight both mean
 *  *do not animate*, not *animate slower*. Once a second is a live clock
 *  tick, not a slow filmstrip -- and it is a *timer* tick: that path never
 *  asks the compositor for a frame at all (R-F6), so a lightweight kiosk
 *  is not woken sixty times a second to decide, fifty-nine times, to do
 *  nothing. */
export const REDUCED_MOTION_INTERVAL_MS = 1000;
/** A gap longer than this between two frames of a running loop is the page having been away (a hidden tab, a locked
 *  phone, a sleeping laptop), never a slow frame: the next drawn frame is a resync, and it is not counted against the
 *  frame rate either. Five times the reduced-motion tick and several times the slowest frame a loaded wall has been
 *  measured to draw (about a second, SLOW_GAP_MS above), so neither path ever resyncs by itself; and short enough
 *  that a mark left behind by the gap is still a glide's worth of metres, not a crawl. */
export const RESYNC_GAP_MS = 5_000;

/** `resync` is true on the one frame after the page was away (RESYNC_GAP_MS): re-seed, do not step. */
export function createLoop(draw: (now: number, resync: boolean) => boolean, deps: LoopDeps = {}): Loop {
  const rafFn = deps.raf ?? ((cb: (t: number) => void) => requestAnimationFrame(cb));
  const cancelFn = deps.cancel ?? ((h: number) => cancelAnimationFrame(h));
  const clockNow = deps.now ?? (() => Date.now());
  const setTimer = deps.setTimer ?? ((fn: () => void, ms: number) => globalThis.setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((h: unknown) => globalThis.clearTimeout(h as never));
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
  /** When the last drawn frame began, on the loop's clock; null until one has, and again after a park. The
   *  first tick after it measures the gap (SLOW_GAP_MS) and then forgets it. */
  let lastDrawnAt: number | null = null;

  // Reduced-motion / lightweight path state: the armed tick, and when the
  // last tick actually drew (null before the first).
  let timer: unknown = null;
  let lastReducedDrawAt: number | null = null;

  // The return (RESYNC_GAP_MS). The last tick of a running, unparked loop (null after a park or a start: a parked
  // loop waits on purpose), the last drawn frame whatever came after it, and the resync the next drawn frame owes.
  let lastTickAt: number | null = null;
  let lastFrameAt: number | null = null;
  let resyncNext = false;
  let unwatch: (() => void) | null = null;

  /** Reads the gap since the last tick of a running loop; a long one owes the next drawn frame a resync. */
  function measureGap(at: number): boolean {
    const gap = lastTickAt !== null && at - lastTickAt > RESYNC_GAP_MS;
    lastTickAt = at;
    if (gap) resyncNext = true;
    return gap;
  }

  /** One call of `draw`, handing it the resync owed and settling that debt whatever `draw` does. */
  function drawFrame(at: number): boolean {
    const resync = resyncNext;
    resyncNext = false;
    lastFrameAt = at;
    return draw(at, resync);
  }

  function scheduleFull(): void {
    handle = rafFn(onFullFrame);
  }

  /** One slow or fast frame's verdict: three slow in a row halve the rate, a fast one undoes one halving. */
  function pace(slow: boolean): void {
    if (slow) {
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
  }

  function onFullFrame(): void {
    handle = null;
    if (!running || parked) return; // stop()/park raced a callback already in flight

    tick++;
    // A gap over RESYNC_GAP_MS is the page having been away: a resync, and no verdict on the device's pace.
    const away = measureGap(clockNow());
    // The gap after the last drawn frame is what that frame cost the device
    // beyond `draw` itself (SLOW_GAP_MS). Read once, on the first tick after
    // it, whether or not this tick draws, so a skipped tick measures too.
    let late = false;
    if (lastDrawnAt !== null) {
      late = !away && clockNow() - lastDrawnAt > SLOW_GAP_MS * rateDivisor;
      lastDrawnAt = null;
    }
    if (tick % rateDivisor !== 0) {
      if (late) pace(true);
      scheduleFull(); // this tick is deliberately skipped to relieve an overloaded device
      return;
    }

    const before = clockNow();
    lastDrawnAt = before;
    let changed = false;
    try {
      changed = drawFrame(before);
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
    // One verdict per drawn tick: slow when the draw ran over its budget or the frame came late after the
    // last drawn one, fast only when neither did, so the two readings never cancel each other.
    pace(late || elapsed > FRAME_BUDGET_MS);

    if (changed) {
      unchangedStreak = 0;
    } else {
      unchangedStreak++;
      if (unchangedStreak >= PARK_AFTER_UNCHANGED) {
        parked = true;
        lastDrawnAt = null; // the gap across a park is the park's, not the frame's
        lastTickAt = null; // and it is no page gone away either
        return; // no scheduleFull(): parked means no further frame is requested
      }
    }
    scheduleFull();
  }

  /** Arms the next once-a-second tick: a full interval after the last draw,
   *  or at once when nothing has been drawn yet (or the last draw is long
   *  past, as after a park). */
  function scheduleReduced(): void {
    const due = lastReducedDrawAt === null ? 0 : Math.max(0, lastReducedDrawAt + REDUCED_MOTION_INTERVAL_MS - clockNow());
    timer = setTimer(onReducedTick, due);
  }

  function onReducedTick(): void {
    if (timer !== null) {
      clearTimer(timer); // the injected pair is interval-shaped; this makes it a one-shot
      timer = null;
    }
    if (!running || parked) return; // stop()/park raced a tick already due
    const now = clockNow();
    lastReducedDrawAt = now;
    measureGap(now); // a timer held back by a hidden tab owes a resync too
    let changed = false;
    try {
      changed = drawFrame(now); // no interpolation: a plain jump to whatever `draw` computes for `now`
      frameCount++;
    } catch (err) {
      // Same reasoning as onFullFrame's catch: an uncaught throw here would
      // abort before scheduleReduced() runs, freezing the once-a-second
      // clock tick for good.
      console.error('[motion loop] draw() threw; treating this frame as unchanged', err);
    }
    // Parks exactly like the full loop: eight unchanged ticks (eight
    // seconds of nothing moving) and the timer is simply not re-armed,
    // until nudge() brings news.
    if (changed) {
      unchangedStreak = 0;
    } else {
      unchangedStreak++;
      if (unchangedStreak >= PARK_AFTER_UNCHANGED) {
        parked = true;
        lastTickAt = null;
        return;
      }
    }
    scheduleReduced();
  }

  const loop: Loop = {
    start() {
      if (running) return; // idempotent: already going
      running = true;
      parked = false;
      tick = 0;
      rateDivisor = 1;
      slowStreak = 0;
      unchangedStreak = 0;
      lastDrawnAt = null;
      lastReducedDrawAt = null;
      lastTickAt = null;
      // A loop stopped for longer than a gap (a paused map, a feed that was down) comes back to evidence that moved
      // on without it: its first frame re-seeds. A first start has nothing drawn to re-seed from.
      if (lastFrameAt !== null && clockNow() - lastFrameAt > RESYNC_GAP_MS) resyncNext = true;
      frameCount = 0; // frames() is documented as "since the last start()" -- a restart is a fresh count
      unwatch ??= watchPageReturn({
        show: (awayMs) => {
          if (awayMs <= RESYNC_GAP_MS) return;
          resyncNext = true;
          loop.nudge(); // a parked loop draws the resync at once; a running one on its next frame
        },
      }, { now: clockNow, ...deps.lifecycle });
      if (reduced) scheduleReduced();
      else scheduleFull();
    },

    stop() {
      running = false;
      parked = false;
      unwatch?.();
      unwatch = null;
      if (handle !== null) {
        cancelFn(handle);
        handle = null;
      }
      if (timer !== null) {
        clearTimer(timer);
        timer = null;
      }
    },

    nudge() {
      unchangedStreak = 0; // fresh evidence: give it a full run before parking again
      if (running && parked) {
        parked = false;
        lastDrawnAt = null;
        if (reduced) scheduleReduced();
        else scheduleFull();
      }
    },

    frames() {
      return frameCount;
    },
  };
  return loop;
}

// --- The tick-aligned poller ---

/** The realtime feed's own cadence (probe, 16 September 2026, 80 s sample):
 *  ZET republishes every 10 s, the header timestamp stepping +10 each time;
 *  the twin ticks on the same beat (worker/twin/clock.ts, R-TE4). */
const FEED_TICK_MS = 10_000;
/** What must have happened between the feed's header time and a poll that
 *  finds the new frame at the edge: the twin's own cushion (1.5 s), its
 *  alarm's jitter and fetch (about a second), and the Cache API turning over
 *  on the twin's validUntil (about a second). 3.5 s covers all three without
 *  catching the previous frame twice. */
const POLL_CUSHION_MS = 3_500;
/** After the snapshot's own validUntil (the twin's next tick, when it names
 *  one) the edge has the new frame within about a second; 1.5 s leaves room
 *  for the alarm to run a little late. */
const VALID_UNTIL_CUSHION_MS = 1_500;
/** The fallback for a snapshot that carries no `sourceUpdatedAt` yet -- a
 *  cold start, or a source that is down -- so a poll with no timestamp
 *  evidence to align to still retries at the feed's own rate instead of
 *  guessing at a tick it cannot see. */
export const POLL_FALLBACK_MS = 10_000;

/**
 * How long to wait before polling again, aligned to the feed's own tick
 * instead of a fixed offset: `sourceUpdatedAt` plus the tick plus the
 * cushion, minus `now`, or the snapshot's own `validUntil` plus a shorter
 * cushion when the producer names its next change. Given a working timestamp
 * this never polls a frame the twin has not yet published (the "redundant
 * traffic" objection Matija has raised); without one it falls back to the
 * feed's own rate. An aligned target already in the past (a slow poll,
 * a backgrounded tab, a feed that is late or down) means the *next* tick on
 * the feed's own phase, never "poll now": the poll is a self-rearming chain,
 * and "now" against a feed that has stopped ticking would be a tight loop
 * of requests. And never longer than one tick plus the cushion, whatever a
 * timestamp from the future might claim.
 */
export function nextPollDelay(sourceUpdatedAt: string | undefined, now: number, validUntil?: string): number {
  const cap = FEED_TICK_MS + POLL_CUSHION_MS;
  // The producer's own word on when it changes next beats any arithmetic on
  // the source time (R-TE4); one already behind us (the twin's alarm ran
  // late) falls through to the tick phase below.
  if (validUntil !== undefined) {
    const until = Date.parse(validUntil);
    if (Number.isFinite(until)) {
      const delay = until + VALID_UNTIL_CUSHION_MS - now;
      if (delay > 0) return Math.min(delay, cap);
    }
  }
  if (sourceUpdatedAt !== undefined) {
    const at = Date.parse(sourceUpdatedAt);
    if (Number.isFinite(at)) {
      const target = at + FEED_TICK_MS + POLL_CUSHION_MS;
      let delay = target - now;
      if (delay <= 0) delay = FEED_TICK_MS - ((now - target) % FEED_TICK_MS);
      return Math.min(delay, cap);
    }
  }
  return POLL_FALLBACK_MS;
}

/**
 * Re-arms a one-shot poll chain once `work` -- the poll's own handler -- has
 * settled, whichever way it settled. The fixed interval the chain replaced
 * retried every 20 s regardless of what the last handler did; a chain must
 * keep that promise. A handler that throws (a renderer choking on one bad
 * snapshot, an outage alert whose copy cannot be painted) must neither end
 * polling for the rest of a ten-minute session nor leave its rejection
 * unhandled: the next poll is armed *first*, then the failure is logged
 * under `label`, so even a reporter that throws cannot be what breaks the
 * chain.
 */
export function continuePoll(work: Promise<unknown>, arm: () => void, label: string): void {
  void work.then(arm, (error: unknown) => {
    arm();
    console.error(`[poll] ${label} threw; the next poll is still armed`, error);
  });
}
