import { describe, expect, it, vi } from 'vitest';
import { createLoop, nextPollDelay, POLL_FALLBACK_MS } from '../../app/src/motion/loop';

/**
 * A raf/cancel double the loop can be driven by hand: `fire()` invokes
 * whatever callback the loop most recently scheduled, and `hasScheduled()`
 * says whether the loop asked for another frame (the way a test tells
 * "parked" from "still running" without a real browser).
 */
function fakeRaf() {
  let cb: ((t: number) => void) | null = null;
  let handle = 0;
  const raf = vi.fn((fn: (t: number) => void) => {
    cb = fn;
    return ++handle;
  });
  const cancel = vi.fn();
  const fire = (t = 0) => {
    const fn = cb;
    cb = null;
    fn?.(t);
  };
  return { raf, cancel, fire, hasScheduled: () => cb !== null };
}

describe('createLoop', () => {
  it('parks after eight unchanged frames and stops requesting new ones', () => {
    const { raf, cancel, fire, hasScheduled } = fakeRaf();
    const draw = vi.fn(() => false);
    const loop = createLoop(draw, { raf, cancel, now: () => 0 });

    loop.start();
    for (let i = 0; i < 8; i++) fire();

    expect(draw).toHaveBeenCalledTimes(8);
    expect(hasScheduled()).toBe(false); // parked: no further frame requested
  });

  it('does not park early: a changed frame resets the unchanged streak', () => {
    const { raf, cancel, fire, hasScheduled } = fakeRaf();
    let toggle = true;
    const draw = vi.fn(() => {
      toggle = !toggle;
      return toggle; // changed, unchanged, changed, unchanged, ... never seven in a row
    });
    const loop = createLoop(draw, { raf, cancel, now: () => 0 });

    loop.start();
    for (let i = 0; i < 20; i++) fire();

    expect(hasScheduled()).toBe(true); // still running, never parked
  });

  it('wakes a parked loop on nudge, and nudge is a no-op while still running', () => {
    const { raf, cancel, fire, hasScheduled } = fakeRaf();
    const draw = vi.fn(() => false);
    const loop = createLoop(draw, { raf, cancel, now: () => 0 });

    loop.start();
    loop.nudge(); // running, not parked: no-op, no extra schedule beyond the normal chain
    for (let i = 0; i < 8; i++) fire();
    expect(hasScheduled()).toBe(false); // parked

    loop.nudge(); // the caller's signal: a new snapshot, or a resize
    expect(hasScheduled()).toBe(true);

    fire();
    expect(draw).toHaveBeenCalledTimes(9);
  });

  it('halves its rate after three frames over the 12ms budget, and recovers one step at a time', () => {
    const { raf, cancel, fire } = fakeRaf();
    let t = 0;
    let frameCost = 20; // > 12ms budget
    // Each draw call "spends" frameCost ms on the fake clock, so the loop's
    // own before/after now() reads see exactly the duration this test drives.
    const draw = vi.fn(() => {
      t += frameCost;
      return true; // keep frames "changed" so parking never interferes here
    });
    const loop = createLoop(draw, { raf, cancel, now: () => t });
    loop.start();

    // Ticks 1-3: slow. The third over-budget frame halves the rate.
    fire();
    fire();
    fire();
    expect(draw).toHaveBeenCalledTimes(3);

    // Tick 4 is even, so it draws under either divisor (1 or 2) -- still slow.
    fire();
    expect(draw).toHaveBeenCalledTimes(4);

    // Tick 5 is odd: with the rate halved, this one is skipped outright.
    frameCost = 1; // frames are healthy again, but this tick never reaches draw()
    fire();
    expect(draw).toHaveBeenCalledTimes(4);

    // Tick 6: divisor lets it through; a healthy frame recovers the rate.
    fire();
    expect(draw).toHaveBeenCalledTimes(5);

    // Tick 7: fully recovered -- every tick draws again.
    fire();
    expect(draw).toHaveBeenCalledTimes(6);
  });

  it('calls draw once a second under reducedMotion, with no interpolation', () => {
    const { raf, cancel, fire } = fakeRaf();
    let t = 0;
    const draw = vi.fn(() => true);
    const loop = createLoop(draw, { raf, cancel, now: () => t, reducedMotion: true });
    loop.start();

    fire(); // first tick ever: draws immediately
    expect(draw).toHaveBeenCalledTimes(1);

    t = 400;
    fire(); // under a second since the last draw
    expect(draw).toHaveBeenCalledTimes(1);

    t = 999;
    fire(); // still under a second
    expect(draw).toHaveBeenCalledTimes(1);

    t = 1000;
    fire(); // a full second has now elapsed
    expect(draw).toHaveBeenCalledTimes(2);

    t = 1500;
    fire(); // only 500ms since the last draw
    expect(draw).toHaveBeenCalledTimes(2);

    t = 2000;
    fire(); // a full second since the last draw
    expect(draw).toHaveBeenCalledTimes(3);
  });

  it('calls draw once a second under lightweight too, the same honest reading', () => {
    const { raf, cancel, fire } = fakeRaf();
    let t = 0;
    const draw = vi.fn(() => true);
    const loop = createLoop(draw, { raf, cancel, now: () => t, lightweight: true });
    loop.start();

    fire();
    expect(draw).toHaveBeenCalledTimes(1);
    t = 500;
    fire();
    expect(draw).toHaveBeenCalledTimes(1);
    t = 1000;
    fire();
    expect(draw).toHaveBeenCalledTimes(2);
  });

  it('frames() counts every actual draw call, for the e2e proof to assert against', () => {
    const { raf, cancel, fire } = fakeRaf();
    const draw = vi.fn(() => true);
    const loop = createLoop(draw, { raf, cancel, now: () => 0 });

    expect(loop.frames()).toBe(0);
    loop.start();
    fire();
    fire();
    expect(loop.frames()).toBe(2);
  });

  it('stop() cancels the pending frame and a stray late callback is a no-op', () => {
    const { raf, cancel, fire, hasScheduled } = fakeRaf();
    const draw = vi.fn(() => true);
    const loop = createLoop(draw, { raf, cancel, now: () => 0 });

    loop.start();
    expect(hasScheduled()).toBe(true);
    loop.stop();
    expect(cancel).toHaveBeenCalledTimes(1);

    fire(); // simulate a raf callback that was already in flight when stop() ran
    expect(draw).not.toHaveBeenCalled();
  });
});

describe('nextPollDelay', () => {
  it('aligns to the feed tick plus the cushion when sourceUpdatedAt is known', () => {
    const sourceUpdatedAt = new Date(1_000_000).toISOString();
    const now = 1_000_000 + 5_000; // 5s after the source's own timestamp
    // target = sourceUpdatedAt + 30s tick + 2s cushion = 1_032_000
    expect(nextPollDelay(sourceUpdatedAt, now)).toBe(27_000);
  });

  it('never returns a negative delay when the aligned target has already passed', () => {
    const sourceUpdatedAt = new Date(0).toISOString();
    expect(nextPollDelay(sourceUpdatedAt, 1_000_000)).toBe(0);
  });

  it('falls back to the fixed cadence when sourceUpdatedAt is missing', () => {
    expect(nextPollDelay(undefined, 0)).toBe(POLL_FALLBACK_MS);
  });

  it('falls back to the fixed cadence when sourceUpdatedAt cannot be parsed', () => {
    expect(nextPollDelay('not-a-date', 0)).toBe(POLL_FALLBACK_MS);
  });
});
