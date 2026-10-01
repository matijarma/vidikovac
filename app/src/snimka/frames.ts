// One requestAnimationFrame loop for the whole page. It runs while the clock
// plays, hands every subscriber clock.now() once per frame (under reduced
// motion at most once a second), runs exactly one frame after every clock
// mutation (so a paused scrub still redraws) and stops when the clock pauses.
import type { ReplayClock } from './clock';

export interface FrameLoop {
  subscribe(fn: (t: number) => void): () => void;
  /** One frame soon, whatever the clock does; the loop calls it on every tick. */
  kick(): void;
  destroy(): void;
}

export interface FrameLoopOptions {
  raf?: (cb: (ts: number) => void) => number;
  cancel?: (handle: number) => void;
  reducedMotion: boolean;
}

export const REDUCED_MOTION_GAP_MS = 1000;

export function createFrameLoop(clock: ReplayClock, o: FrameLoopOptions): FrameLoop {
  const raf = o.raf ?? ((cb): number => requestAnimationFrame(cb));
  const cancel = o.cancel ?? ((h): void => cancelAnimationFrame(h));
  const subscribers = new Set<(t: number) => void>();
  let handle: number | null = null;
  let forced = false;
  let lastEmit = -Infinity;
  let destroyed = false;

  const frame = (ts: number): void => {
    handle = null;
    if (destroyed) return;
    // now() may end the replay, whose 'end' tick kicks: then a frame is already booked below.
    const t = clock.now();
    const due = forced || !o.reducedMotion || ts - lastEmit >= REDUCED_MOTION_GAP_MS;
    forced = false;
    if (due) {
      lastEmit = ts;
      for (const fn of [...subscribers]) fn(t);
    }
    if (handle === null && clock.playing() && !clock.suspended()) handle = raf(frame);
  };
  const kick = (): void => {
    if (destroyed) return;
    forced = true;
    if (handle === null) handle = raf(frame);
  };
  const offTick = clock.onTick(kick);
  if (clock.playing()) kick();

  return {
    subscribe(fn) {
      subscribers.add(fn);
      return () => { subscribers.delete(fn); };
    },
    kick,
    destroy() {
      destroyed = true;
      offTick();
      if (handle !== null) cancel(handle);
      handle = null;
      subscribers.clear();
    },
  };
}
