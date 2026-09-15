import { describe, expect, it } from 'vitest';
import { FLAGS, type Flag } from '../../app/src/core/flags';

// D7: no flag mechanism exists in the worker, so flags are one static,
// frozen object. A producer behind a flag that is off returns no tiles, and a
// feed is wired in the same commit that turns its flag on, so nothing is
// ever polled that does not exist.

describe('FLAGS', () => {
  it('names exactly the five flags the plan defines', () => {
    expect(Object.keys(FLAGS).sort()).toEqual(['FEED_BIKES', 'FEED_LASTRUN', 'FEED_PARKING', 'FEED_WASTE', 'PUSH']);
  });
  it('every flag is a boolean', () => {
    for (const [name, value] of Object.entries(FLAGS)) expect(typeof value, name).toBe('boolean');
  });
  it('FEED_LASTRUN is on since T3.1 shipped the GTFS script, the loader and the producer in one; the mobility and waste feeds wait for a confirmed source, PUSH for the notify sheet’s fallback', () => {
    expect(FLAGS.FEED_LASTRUN).toBe(true);
    expect(FLAGS.FEED_BIKES).toBe(false);
    expect(FLAGS.FEED_PARKING).toBe(false);
    expect(FLAGS.FEED_WASTE).toBe(false);
    expect(FLAGS.PUSH).toBe(false);
  });
  it('is frozen: a flag flips in a commit, never at runtime', () => {
    expect(Object.isFrozen(FLAGS)).toBe(true);
    const flag: Flag = 'FEED_BIKES';
    expect(() => { (FLAGS as Record<string, boolean>)[flag] = true; }).toThrow();
    expect(FLAGS.FEED_BIKES).toBe(false);
  });
});
