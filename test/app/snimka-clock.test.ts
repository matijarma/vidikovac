// The replay clock is exact for an injected real clock at every speed,
// keeps its instant across a speed change, clamps a seek, pauses with 'end'
// at the end, stands still while suspended, and walks chapters with the
// two-second rule (app/src/snimka/clock.ts).
import { describe, expect, it } from 'vitest';
import { SNIMKA_WINDOW, SPEEDS } from '../../shared/snimka';
import { CHAPTER_BACK_MS, createReplayClock, type Chapter, type TickReason } from '../../app/src/snimka/clock';

const START = SNIMKA_WINDOW.fromSec * 1000;
const END = SNIMKA_WINDOW.toSec * 1000;
const MONDAY_0745 = Date.UTC(2026, 8, 28, 5, 45);

function realClock(at = 1_000_000): { now: () => number; advance: (ms: number) => void } {
  let t = at;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

function recorder(clock: { onTick: (fn: (t: number, reason: TickReason) => void) => () => void }): { ticks: [number, TickReason][]; reasons: () => TickReason[] } {
  const ticks: [number, TickReason][] = [];
  clock.onTick((t, reason) => ticks.push([t, reason]));
  return { ticks, reasons: () => ticks.map(([, r]) => r) };
}

describe('createReplayClock', () => {
  it.each(SPEEDS)('advances exactly real elapsed times %d while playing', (speed) => {
    const real = realClock();
    const clock = createReplayClock({ start: START, end: END, at: MONDAY_0745, speed, playing: true, now: real.now });
    expect(clock.now()).toBe(MONDAY_0745);
    real.advance(250);
    expect(clock.now()).toBe(MONDAY_0745 + 250 * speed);
    real.advance(1750);
    expect(clock.now()).toBe(MONDAY_0745 + 2000 * speed);
    expect(clock.playing()).toBe(true);
    expect(clock.speed()).toBe(speed);
  });

  it('opens paused at its instant when not asked to play, and the default speed is 600', () => {
    const real = realClock();
    const clock = createReplayClock({ start: START, end: END, at: MONDAY_0745, now: real.now });
    expect(clock.playing()).toBe(false);
    expect(clock.speed()).toBe(600);
    real.advance(10_000);
    expect(clock.now()).toBe(MONDAY_0745);
    expect(clock.start).toBe(START);
    expect(clock.end).toBe(END);
  });

  it('setSpeed keeps the instant and continues at the new rate', () => {
    const real = realClock();
    const clock = createReplayClock({ start: START, end: END, at: MONDAY_0745, speed: 600, playing: true, now: real.now });
    const rec = recorder(clock);
    real.advance(500);
    const before = clock.now();
    expect(before).toBe(MONDAY_0745 + 500 * 600);
    clock.setSpeed(60);
    expect(clock.now()).toBe(before);
    real.advance(500);
    expect(clock.now()).toBe(before + 500 * 60);
    expect(rec.ticks).toEqual([[before, 'speed']]);
    clock.setSpeed(60);
    expect(rec.ticks).toHaveLength(1);
    expect(() => clock.setSpeed(7 as never)).toThrow();
  });

  it('seek clamps into the window and keeps the playing state', () => {
    const real = realClock();
    const clock = createReplayClock({ start: START, end: END, at: MONDAY_0745, speed: 60, playing: true, now: real.now });
    const rec = recorder(clock);
    clock.seek(START - 5_000_000);
    expect(clock.now()).toBe(START);
    expect(clock.playing()).toBe(true);
    clock.seek(MONDAY_0745 + 1234);
    expect(clock.now()).toBe(MONDAY_0745 + 1234);
    clock.seek(Number.NaN);
    expect(clock.now()).toBe(MONDAY_0745 + 1234);
    clock.step(-1234);
    expect(clock.now()).toBe(MONDAY_0745);
    expect(rec.reasons()).toEqual(['seek', 'seek', 'seek']);
    clock.pause();
    clock.seek(END + 1);
    expect(clock.now()).toBe(END);
    expect(clock.playing()).toBe(false);
    expect(rec.reasons().at(-1)).toBe('seek');
  });

  it('reaching the end while playing pauses and fires end once; play at the end is a no-op', () => {
    const real = realClock();
    const clock = createReplayClock({ start: START, end: END, at: END - 600 * 1000, speed: 600, playing: true, now: real.now });
    const rec = recorder(clock);
    real.advance(999);
    expect(clock.now()).toBe(END - 600);
    expect(clock.playing()).toBe(true);
    real.advance(2000);
    expect(clock.now()).toBe(END);
    expect(clock.playing()).toBe(false);
    expect(rec.ticks).toEqual([[END, 'end']]);
    real.advance(5000);
    expect(clock.now()).toBe(END);
    clock.play();
    expect(clock.playing()).toBe(false);
    expect(rec.ticks).toHaveLength(1);
    // A playing seek onto the end also ends.
    clock.seek(START);
    clock.play();
    clock.seek(END);
    expect(clock.playing()).toBe(false);
    expect(rec.reasons().slice(-3)).toEqual(['play', 'seek', 'end']);
    // A clock asked to open playing at the end opens paused.
    expect(createReplayClock({ start: START, end: END, at: END, playing: true, now: real.now }).playing()).toBe(false);
  });

  it('play, pause and toggle re-anchor and tick once each; now() never ticks', () => {
    const real = realClock();
    const clock = createReplayClock({ start: START, end: END, at: MONDAY_0745, speed: 3600, now: real.now });
    const rec = recorder(clock);
    for (let i = 0; i < 5; i++) { real.advance(100); clock.now(); }
    expect(rec.ticks).toEqual([]);
    clock.play();
    real.advance(1000);
    clock.pause();
    expect(clock.now()).toBe(MONDAY_0745 + 3_600_000);
    real.advance(1000);
    expect(clock.now()).toBe(MONDAY_0745 + 3_600_000);
    clock.toggle();
    expect(clock.playing()).toBe(true);
    clock.toggle();
    expect(clock.playing()).toBe(false);
    clock.pause();
    expect(rec.reasons()).toEqual(['play', 'pause', 'play', 'pause']);
  });

  it('suspend freezes a playing clock and resume continues from the frozen instant', () => {
    const real = realClock();
    const clock = createReplayClock({ start: START, end: END, at: MONDAY_0745, speed: 600, playing: true, now: real.now });
    const rec = recorder(clock);
    real.advance(1000);
    clock.suspend();
    expect(clock.suspended()).toBe(true);
    const frozen = clock.now();
    expect(frozen).toBe(MONDAY_0745 + 600_000);
    real.advance(60_000);
    expect(clock.now()).toBe(frozen);
    expect(clock.playing()).toBe(true);
    clock.suspend();
    clock.resume();
    expect(clock.suspended()).toBe(false);
    real.advance(1000);
    expect(clock.now()).toBe(frozen + 600_000);
    clock.resume();
    expect(rec.reasons()).toEqual(['suspend', 'resume']);
    // Suspended and paused: nothing moves either way.
    clock.pause();
    clock.suspend();
    real.advance(1000);
    clock.play();
    real.advance(1000);
    expect(clock.now()).toBe(frozen + 600_000);
    clock.resume();
    real.advance(1000);
    expect(clock.now()).toBe(frozen + 1_200_000);
  });

  it('chapters: index, next, and previous with the two-second rule', () => {
    const real = realClock();
    const chapters: Chapter[] = [
      { at: START, title: 'Večer prije', id: 'a' },
      { at: MONDAY_0745, title: 'Prvo jutro', id: 'c' },
      { at: START + 4 * 3_600_000, title: 'Spremišta', id: 'b' },
      { at: END - 15 * 60_000, title: 'Kraj', id: 'd' },
    ];
    const clock = createReplayClock({ start: START, end: END, at: MONDAY_0745 + 1000, speed: 600, chapters, now: real.now });
    expect(clock.chapters().map((c) => c.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(clock.chapterIndex()).toBe(2);
    // One second into a chapter, "previous" is the chapter before it, not the one just reached.
    expect(clock.prevChapter()?.id).toBe('b');
    expect(clock.now()).toBe(START + 4 * 3_600_000);
    clock.seek(MONDAY_0745 + CHAPTER_BACK_MS);
    expect(clock.prevChapter()?.id).toBe('b');
    clock.seek(MONDAY_0745 + CHAPTER_BACK_MS + 1);
    expect(clock.prevChapter()?.id).toBe('c');
    expect(clock.now()).toBe(MONDAY_0745);
    expect(clock.nextChapter()?.id).toBe('d');
    expect(clock.nextChapter()).toBeNull();
    expect(clock.now()).toBe(END - 15 * 60_000);
    clock.seek(START + 500);
    expect(clock.prevChapter()).toBeNull();
    expect(clock.now()).toBe(START + 500);
    expect(clock.chapterIndex()).toBe(0);
    clock.seek(START - 1);
    expect(clock.chapterIndex()).toBe(0);
    const bare = createReplayClock({ start: START, end: END, now: real.now });
    expect(bare.chapterIndex()).toBe(-1);
    expect(bare.nextChapter()).toBeNull();
  });

  it('onTick unsubscribes and destroy silences the clock', () => {
    const real = realClock();
    const clock = createReplayClock({ start: START, end: END, at: MONDAY_0745, now: real.now });
    const seen: TickReason[] = [];
    const off = clock.onTick((_, r) => seen.push(r));
    clock.play();
    off();
    clock.pause();
    expect(seen).toEqual(['play']);
    clock.onTick((_, r) => seen.push(r));
    clock.destroy();
    clock.play();
    expect(clock.playing()).toBe(false);
    expect(seen).toEqual(['play']);
    expect(() => createReplayClock({ start: END, end: START })).toThrow();
  });
});
