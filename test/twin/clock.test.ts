import { describe, expect, it } from 'vitest';
import { FEED_STALL_MS, FEED_TICK_MS, TICK_CUSHION_MS, TICK_MAX_DELAY_MS, TICK_MIN_DELAY_MS, nextTickAt } from '../../worker/twin/clock';

// The twin's alarm rides ZET's own 10 s republish: one tick plus a cushion
// after the header it last saw, never sooner than a floor (a retried or late
// alarm must not hammer the feed), never later than a ceiling (a skewed
// header must not stall the loop), and a plain tick when the feed has
// stopped talking or has not spoken yet.
describe('nextTickAt', () => {
  it('rides the header: one tick plus the cushion, floored, capped, plain when stalled or unknown', () => {
    const T = 1_789_514_335; // a real header timestamp from the sample, seconds
    const now = T * 1000 + 2_000;
    expect(nextTickAt(T, now)).toBe(T * 1000 + FEED_TICK_MS + TICK_CUSHION_MS);
    expect(nextTickAt(T, T * 1000 + 9_800)).toBe(T * 1000 + 9_800 + TICK_MIN_DELAY_MS); // late: the floor, not "now"
    expect(nextTickAt(T + 60, now)).toBe(now + TICK_MAX_DELAY_MS); // a header from the future: the ceiling
    expect(nextTickAt(T, T * 1000 + FEED_STALL_MS + 1)).toBe(T * 1000 + FEED_STALL_MS + 1 + FEED_TICK_MS); // stalled feed
    expect(nextTickAt(null, now)).toBe(now + FEED_TICK_MS); // nothing seen yet
  });
});
