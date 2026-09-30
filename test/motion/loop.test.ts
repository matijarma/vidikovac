import { describe, expect, it, vi } from 'vitest';
import { continuePoll, createLoop, nextPollDelay, POLL_FALLBACK_MS, RESYNC_GAP_MS } from '../../app/src/motion/loop';

/**
 * A raf/cancel double the loop can be driven by hand: `fire()` invokes
 * whatever callback the loop most recently scheduled, and `hasScheduled()`
 * says whether the loop asked for another frame (the way a test tells
 * "parked" from "still running" without a real browser).
 */
/** A setTimeout/clearTimeout double for the reduced-motion path: `advance()`
 *  moves the caller's clock and runs every armed timer that has come due. */
function fakeTimers() {
  const timers: { fn: () => void; at: number; cleared: boolean }[] = [];
  let now = 0;
  const setTimer = vi.fn((fn: () => void, ms: number) => { const t = { fn, at: now + ms, cleared: false }; timers.push(t); return t; });
  const clearTimer = vi.fn((h: unknown) => { (h as { cleared: boolean }).cleared = true; });
  const advance = (t: number): void => {
    now = t;
    for (const timer of [...timers].sort((a, b) => a.at - b.at)) {
      if (!timer.cleared && timer.at <= now) { timer.cleared = true; timer.fn(); }
    }
  };
  const pending = () => timers.filter((t) => !t.cleared).length;
  return { setTimer, clearTimer, advance, pending, clock: () => now };
}

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

  // Round 4 kiosk lane, handoff A2: what a frame costs the device beyond draw() (MapLibre re-tiling and painting
  // what the frame pushed, on a software GPU the better part of a second) shows as the gap before the next
  // animation frame. A late frame after a drawn one counts as a slow frame; three in a row halve the rate.
  it('halves its rate when the frame after a drawn one comes late (the renderer\u2019s cost), whether or not that tick draws, and recovers once the frames come on time', () => {
    const { raf, cancel, fire } = fakeRaf();
    let t = 0;
    const draw = vi.fn(() => true); // the draw itself is instant: the cost is in the gap
    const loop = createLoop(draw, { raf, cancel, now: () => t });
    loop.start();
    // Three drawn frames, each followed by a 300 ms gap: the third late frame halves the rate.
    fire(); t += 300;
    fire(); t += 300;
    fire(); t += 300;
    fire(); // tick 4: the late gap after tick 3 makes three; the divisor is 2 now, tick 4 is even and draws
    expect(draw).toHaveBeenCalledTimes(4);
    t += 300;
    fire(); // tick 5, odd: skipped -- but it still reads the late gap after tick 4 (the streak counts on)
    expect(draw).toHaveBeenCalledTimes(4);
    t += 16;
    fire(); // tick 6, even: draws, on time after the skipped tick: a fast frame, one halving undone
    expect(draw).toHaveBeenCalledTimes(5);
    // Healthy frames from here: the gap after a drawn frame is one display frame, and each fast drawn frame undoes one halving.
    for (let i = 0; i < 12; i++) { t += 16; fire(); }
    const drawnBefore = draw.mock.calls.length;
    for (let i = 0; i < 4; i++) { t += 16; fire(); }
    expect(draw.mock.calls.length - drawnBefore).toBe(4); // back at full rate: every tick draws
  });

  it('calls draw once a second under reducedMotion on the timer path, never asking for an animation frame (R-F6)', () => {
    const { raf, cancel } = fakeRaf();
    const { setTimer, clearTimer, advance, clock } = fakeTimers();
    const draw = vi.fn(() => true);
    const loop = createLoop(draw, { raf, cancel, now: clock, setTimer, clearTimer, reducedMotion: true });
    loop.start();

    advance(0); // the first tick draws at once
    expect(draw).toHaveBeenCalledTimes(1);
    advance(400);
    advance(999);
    expect(draw).toHaveBeenCalledTimes(1); // under a second since the last draw
    advance(1000);
    expect(draw).toHaveBeenCalledTimes(2);
    advance(1500);
    expect(draw).toHaveBeenCalledTimes(2);
    advance(2000);
    expect(draw).toHaveBeenCalledTimes(3);
    for (let t = 3000; t <= 10_000; t += 1000) advance(t);
    expect(draw).toHaveBeenCalledTimes(11); // once a second for ten simulated seconds
    expect(raf).not.toHaveBeenCalled(); // and not one requestAnimationFrame in all of it
  });

  it('calls draw once a second under lightweight too, with zero requestAnimationFrame calls in ten simulated seconds', () => {
    const { raf, cancel } = fakeRaf();
    const { setTimer, clearTimer, advance, clock } = fakeTimers();
    const draw = vi.fn(() => true);
    const loop = createLoop(draw, { raf, cancel, now: clock, setTimer, clearTimer, lightweight: true });
    loop.start();
    for (let t = 0; t <= 10_000; t += 500) advance(t);
    expect(draw).toHaveBeenCalledTimes(11);
    expect(raf).not.toHaveBeenCalled();
  });

  it('parks the reduced-motion loop after eight unchanged ticks, exactly like the full loop, and nudge wakes it', () => {
    const { raf, cancel } = fakeRaf();
    const { setTimer, clearTimer, advance, pending, clock } = fakeTimers();
    const draw = vi.fn(() => false);
    const loop = createLoop(draw, { raf, cancel, now: clock, setTimer, clearTimer, reducedMotion: true });
    loop.start();
    for (let t = 0; t <= 7000; t += 1000) advance(t);
    expect(draw).toHaveBeenCalledTimes(8);
    expect(pending()).toBe(0); // parked: no timer armed, nothing will ever fire again on its own
    advance(20_000);
    expect(draw).toHaveBeenCalledTimes(8);

    loop.nudge(); // a new snapshot
    expect(pending()).toBe(1);
    advance(20_000);
    expect(draw).toHaveBeenCalledTimes(9);
    expect(raf).not.toHaveBeenCalled();
  });

  it('stop() clears the reduced-motion timer so no tick is left pending', () => {
    const { raf, cancel } = fakeRaf();
    const { setTimer, clearTimer, advance, pending, clock } = fakeTimers();
    const draw = vi.fn(() => true);
    const loop = createLoop(draw, { raf, cancel, now: clock, setTimer, clearTimer, lightweight: true });
    loop.start();
    advance(0);
    expect(pending()).toBe(1);
    loop.stop();
    expect(pending()).toBe(0);
    advance(5000);
    expect(draw).toHaveBeenCalledTimes(1);
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

  it('start() resets frames() to 0, matching its own "since the last start()" contract', () => {
    const { raf, cancel, fire } = fakeRaf();
    const draw = vi.fn(() => true);
    const loop = createLoop(draw, { raf, cancel, now: () => 0 });

    loop.start();
    fire();
    fire();
    expect(loop.frames()).toBe(2);

    loop.stop();
    loop.start();
    expect(loop.frames()).toBe(0); // a restart is a fresh count, not a continuation

    fire();
    expect(loop.frames()).toBe(1);
  });

  it('does not freeze when draw throws: it logs and keeps scheduling instead of dying silently', () => {
    const { raf, cancel, fire, hasScheduled } = fakeRaf();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const draw = vi.fn(() => {
      throw new Error('boom');
    });
    const loop = createLoop(draw, { raf, cancel, now: () => 0 });

    loop.start();
    expect(() => fire()).not.toThrow(); // the raf callback itself must never throw
    expect(draw).toHaveBeenCalledTimes(1);
    expect(hasScheduled()).toBe(true); // still scheduling -- not stuck in limbo
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(loop.frames()).toBe(0); // a thrown call is never counted as an actually-drawn frame

    errorSpy.mockRestore();
  });

  it('eventually parks on repeated draw throws, same as repeated unchanged frames -- and nudge recovers it', () => {
    const { raf, cancel, fire, hasScheduled } = fakeRaf();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const draw = vi.fn(() => {
      throw new Error('boom');
    });
    const loop = createLoop(draw, { raf, cancel, now: () => 0 });

    loop.start();
    for (let i = 0; i < 8; i++) fire();
    expect(hasScheduled()).toBe(false); // parked: a thrown frame counts as unchanged

    loop.nudge(); // recoverable exactly like an ordinary park -- this is the point of the fix
    expect(hasScheduled()).toBe(true);

    errorSpy.mockRestore();
  });

  it('does not freeze when draw throws under reducedMotion either', () => {
    const { raf, cancel } = fakeRaf();
    const { setTimer, clearTimer, advance, pending, clock } = fakeTimers();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const draw = vi.fn(() => {
      throw new Error('boom');
    });
    const loop = createLoop(draw, { raf, cancel, now: clock, setTimer, clearTimer, reducedMotion: true });

    loop.start();
    expect(() => advance(0)).not.toThrow();
    expect(draw).toHaveBeenCalledTimes(1);
    expect(pending()).toBe(1); // still ticking once a second, not stuck
    expect(errorSpy).toHaveBeenCalledTimes(1);

    errorSpy.mockRestore();
  });
});

/** A page's document and window the loop listens to: `leave()` and `come(back)` flip visibility and dispatch the event. */
function fakePage(now: () => number) {
  const docListeners = new Set<() => void>();
  const winListeners = new Set<(event: { persisted?: boolean }) => void>();
  const doc = {
    visibilityState: 'visible',
    addEventListener: (_type: string, fn: () => void) => { docListeners.add(fn); },
    removeEventListener: (_type: string, fn: () => void) => { docListeners.delete(fn); },
  };
  const win = {
    addEventListener: (_type: string, fn: (event: { persisted?: boolean }) => void) => { winListeners.add(fn); },
    removeEventListener: (_type: string, fn: (event: { persisted?: boolean }) => void) => { winListeners.delete(fn); },
  };
  const flip = (state: 'visible' | 'hidden') => { doc.visibilityState = state; for (const fn of [...docListeners]) fn(); };
  return {
    lifecycle: { doc, win, now },
    leave: () => flip('hidden'),
    come: () => flip('visible'),
    restore: () => { for (const fn of [...winListeners]) fn({ persisted: true }); },
    listening: () => docListeners.size + winListeners.size,
  };
}

describe('the page coming back (lane tab-return: a hidden tab, a locked phone)', () => {
  it('draws the first frame after a gap of five minutes as a resync, once, and does not count the gap against the pace', () => {
    const { raf, cancel, fire } = fakeRaf();
    let t = 0;
    const draw = vi.fn((_now: number, _resync: boolean) => true);
    const loop = createLoop(draw, { raf, cancel, now: () => t, lifecycle: { doc: null, win: null } });
    loop.start();
    for (let i = 0; i < 3; i++) { fire(); t += 16; }
    expect(draw.mock.calls.map((call) => call[1])).toEqual([false, false, false]);
    t += 5 * 60_000; // no frame at all while the tab was hidden
    fire();
    expect(draw.mock.calls.at(-1)).toEqual([t, true]);
    for (let i = 0; i < 4; i++) { t += 16; fire(); }
    // Once: the frames after it step again, and every one of them draws (the gap halved nothing).
    expect(draw.mock.calls.slice(-4).map((call) => call[1])).toEqual([false, false, false, false]);
    expect(draw).toHaveBeenCalledTimes(8);
  });

  it(`keeps a gap up to ${RESYNC_GAP_MS} ms a step: a slow frame is not a return`, () => {
    const { raf, cancel, fire } = fakeRaf();
    let t = 0;
    const draw = vi.fn((_now: number, _resync: boolean) => true);
    const loop = createLoop(draw, { raf, cancel, now: () => t, lifecycle: { doc: null, win: null } });
    loop.start();
    fire();
    t += RESYNC_GAP_MS;
    fire();
    expect(draw.mock.calls.map((call) => call[1])).toEqual([false, false]);
  });

  it('wakes a parked loop with a resync when the page is seen again after more than the gap, and not after a glance away', () => {
    const { raf, cancel, fire, hasScheduled } = fakeRaf();
    let t = 0;
    const page = fakePage(() => t);
    const draw = vi.fn((_now: number, _resync: boolean) => false);
    const loop = createLoop(draw, { raf, cancel, now: () => t, lifecycle: page.lifecycle });
    loop.start();
    for (let i = 0; i < 8; i++) { fire(); t += 16; }
    expect(hasScheduled()).toBe(false); // parked: nothing moved
    page.leave();
    t += 3_000;
    page.come(); // a glance at another tab: nothing to re-seed
    expect(hasScheduled()).toBe(false);
    page.leave();
    t += 90_000;
    page.come();
    expect(hasScheduled()).toBe(true); // the resync is drawn at once, parked or not
    fire();
    expect(draw.mock.calls.at(-1)?.[1]).toBe(true);
    page.restore(); // a page back from the back-forward cache was away for as long as nobody knows
    fire();
    expect(draw.mock.calls.at(-1)?.[1]).toBe(true);
  });

  it('stops listening for the page when stopped, and listens once however often it is started', () => {
    const { raf, cancel } = fakeRaf();
    const page = fakePage(() => 0);
    const loop = createLoop(() => true, { raf, cancel, now: () => 0, lifecycle: page.lifecycle });
    loop.start();
    loop.start();
    expect(page.listening()).toBe(2); // visibilitychange and pageshow
    loop.stop();
    expect(page.listening()).toBe(0);
  });

  it('never resyncs across a park: the frame after a nudge ten minutes on is a step (calm motion within a live session)', () => {
    const { raf, cancel, fire } = fakeRaf();
    let t = 0;
    const draw = vi.fn((_now: number, _resync: boolean) => false);
    const loop = createLoop(draw, { raf, cancel, now: () => t, lifecycle: { doc: null, win: null } });
    loop.start();
    for (let i = 0; i < 8; i++) { fire(); t += 16; }
    t += 600_000;
    loop.nudge(); // a new snapshot for a city that stood still
    fire();
    expect(draw.mock.calls.at(-1)).toEqual([t, false]);
  });

  it('resyncs the first frame of a start long after the last drawn frame (a paused map), never a first start', () => {
    const { raf, cancel, fire } = fakeRaf();
    let t = 0;
    const draw = vi.fn((_now: number, _resync: boolean) => true);
    const loop = createLoop(draw, { raf, cancel, now: () => t, lifecycle: { doc: null, win: null } });
    loop.start();
    fire();
    expect(draw.mock.calls.at(-1)?.[1]).toBe(false);
    loop.stop();
    t += 1_000;
    loop.start();
    fire();
    expect(draw.mock.calls.at(-1)?.[1]).toBe(false); // a second's pause is still the same session on screen
    loop.stop();
    t += 120_000;
    loop.start();
    fire();
    expect(draw.mock.calls.at(-1)?.[1]).toBe(true);
    t += 16;
    fire();
    expect(draw.mock.calls.at(-1)?.[1]).toBe(false);
  });

  it('resyncs the once-a-second tick a hidden tab held back, on the reduced-motion path too', () => {
    const { raf, cancel } = fakeRaf();
    const { setTimer, clearTimer, advance, clock } = fakeTimers();
    const draw = vi.fn((_now: number, _resync: boolean) => true);
    const loop = createLoop(draw, { raf, cancel, now: clock, setTimer, clearTimer, reducedMotion: true, lifecycle: { doc: null, win: null } });
    loop.start();
    advance(0);
    advance(1_000);
    advance(62_000); // an intensively throttled background tab: the tick came a minute late
    advance(63_000);
    expect(draw.mock.calls.map((call) => call[1])).toEqual([false, false, true, false]);
    expect(raf).not.toHaveBeenCalled();
  });
});

describe('nextPollDelay', () => {
  // R-TE4: ZET republishes every 10 s and the twin publishes one tick plus
  // its cushion after each header; the client lands after both.
  it("rides the feed's 10 s phase with the cushion, waits for the next tick on that phase when the target has passed, never beyond one tick plus the cushion", () => {
    expect(nextPollDelay(new Date(1_000_000).toISOString(), 1_005_000)).toBe(8_500); // target = source + 10 s + 3.5 s
    const at0 = new Date(0).toISOString(); // targets at 13.5 s, 23.5 s, ...
    expect(nextPollDelay(at0, 14_000)).toBe(9_500);
    expect(nextPollDelay(at0, 1_000_000)).toBe(3_500);
    expect(nextPollDelay(at0, 1_003_500)).toBe(10_000);
    expect(nextPollDelay(new Date(10_000_000).toISOString(), 0)).toBe(13_500);
  });

  it("prefers the snapshot's own validUntil plus a short cushion while it is ahead, falls back to the phase once it has passed, never past the cap", () => {
    const sourceUpdatedAt = new Date(1_000_000).toISOString();
    const validUntil = new Date(1_011_500).toISOString();
    expect(nextPollDelay(sourceUpdatedAt, 1_002_000, validUntil)).toBe(11_000);
    expect(nextPollDelay(sourceUpdatedAt, 1_014_000, validUntil)).toBe(9_500);
    expect(nextPollDelay(sourceUpdatedAt, 1_002_000, new Date(9_000_000).toISOString())).toBe(13_500);
  });

  it('falls back to the feed rate without a usable sourceUpdatedAt', () => {
    expect(nextPollDelay(undefined, 0)).toBe(POLL_FALLBACK_MS);
    expect(nextPollDelay('not-a-date', 0)).toBe(POLL_FALLBACK_MS);
  });
});

describe('continuePoll', () => {
  it('re-arms the chain once the poll has settled, and does nothing else when it succeeded', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const arm = vi.fn();
    continuePoll(Promise.resolve('fetched'), arm, 'test poll');
    expect(arm).not.toHaveBeenCalled(); // never synchronously: the handler must have settled first
    await Promise.resolve();
    await Promise.resolve();
    expect(arm).toHaveBeenCalledTimes(1);
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('re-arms the chain when the poll threw, logs the failure with its label, and leaves no rejection unhandled', async () => {
    const order: string[] = [];
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => { order.push('log'); });
    const arm = vi.fn(() => { order.push('arm'); });
    const failure = new Error('renderer choked on one bad snapshot');
    continuePoll(Promise.reject(failure), arm, 'test poll');
    await Promise.resolve();
    await Promise.resolve();
    expect(arm).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0]![0]).toContain('test poll');
    expect(errorSpy.mock.calls[0]![1]).toBe(failure);
    // The next poll is armed before the failure is reported, so a reporter
    // that itself throws can never be what ends the chain.
    expect(order).toEqual(['arm', 'log']);
    errorSpy.mockRestore();
  });
});
