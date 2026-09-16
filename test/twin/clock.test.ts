import { describe, expect, it } from 'vitest';
import {
  FEED_STALL_MS,
  FEED_TICK_MS,
  TICK_CUSHION_MS,
  TICK_MAX_DELAY_MS,
  TICK_MIN_DELAY_MS,
  nextTickAt,
} from '../../worker/twin/clock';

// The twin's alarm rides ZET's own 10 s republish (measured 16 Sept 2026: the
// header timestamp steps +10 and the new file appears within about a second
// of its own timestamp). The next tick lands one tick plus a cushion after
// the header it last saw, never sooner than a floor (a retried or late alarm
// must not hammer the feed) and never later than a ceiling (a lost header
// must not stall the loop).
describe('nextTickAt', () => {
  const T = 1_789_514_335; // a real header timestamp from the sample, seconds
  const nowMs = T * 1000 + 2_000; // the header is 2 s old when we plan the next tick

  it('lands one tick plus the cushion after a fresh header', () => {
    expect(nextTickAt(T, nowMs)).toBe(T * 1000 + FEED_TICK_MS + TICK_CUSHION_MS);
  });

  it('never fires sooner than the floor when the header is already old', () => {
    const late = T * 1000 + 9_800; // 200 ms before the natural target
    expect(nextTickAt(T, late)).toBe(late + TICK_MIN_DELAY_MS);
  });

  it('falls back to a plain tick when the feed has stalled', () => {
    const stalled = T * 1000 + FEED_STALL_MS + 1;
    expect(nextTickAt(T, stalled)).toBe(stalled + FEED_TICK_MS);
  });

  it('polls one tick from now when no header is known', () => {
    expect(nextTickAt(null, nowMs)).toBe(nowMs + FEED_TICK_MS);
  });

  it('never fires later than the ceiling', () => {
    // A header that is somehow in the future (clock skew at ZET) must not push
    // the alarm out indefinitely.
    const skewed = T + 60;
    expect(nextTickAt(skewed, nowMs)).toBe(nowMs + TICK_MAX_DELAY_MS);
  });

  it('keeps its constants in the order the reasoning needs', () => {
    expect(TICK_MIN_DELAY_MS).toBeLessThan(FEED_TICK_MS);
    expect(FEED_TICK_MS + TICK_CUSHION_MS).toBeLessThanOrEqual(TICK_MAX_DELAY_MS);
    expect(FEED_STALL_MS).toBeGreaterThan(2 * FEED_TICK_MS);
  });
});
