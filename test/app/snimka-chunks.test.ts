// The chunk store: a chunk the index lacks is missing and never fetched; the
// current chunk's fetch waits 120 ms for a scrub to settle and the latest
// request wins; prefetch and hold follow the speed; a failed load is tried
// once more and then missing; destroy cancels (app/src/snimka/chunks.ts).
import { describe, expect, it, vi } from 'vitest';
import { MOTION_CHUNK_S, SPEEDS, type HashedRef, type MotionChunk, type MotionIndex, type Speed } from '../../shared/snimka';
import { CHUNK_POLICY, createChunkStore, SCRUB_DEBOUNCE_MS, type ChunkRef } from '../../app/src/snimka/chunks';

const T0 = 1790568000; // Mon 28 Sep 07:40 Zagreb, a chunk start
const sha = (i: number): string => i.toString(16).padStart(64, '0');

function index(t0s: number[], net: '396' | '395' = '396'): MotionIndex {
  return { v: 2, step: 10, chunkSec: 600, chunks: t0s.map((t0, i) => ({ path: `motion/${net}/${t0}.${sha(i).slice(0, 16)}.json`, bytes: 100, net, t0, vehicles: 1 })) };
}
const chunkFor = (ref: ChunkRef): MotionChunk => ({ v: 1, net: '396', t0: Number(ref.path.split('/')[2]!.split('.')[0]), step: 10, n: 60, vehicles: [] });

/** Injected timers and idle queue the test drives by hand. */
function harness(idx: MotionIndex, loadImpl?: (ref: ChunkRef) => Promise<MotionChunk>) {
  let clock = 1000;
  const timers = new Map<number, { fn: () => void; at: number }>();
  let timerId = 0;
  const idle: (() => void)[] = [];
  const load = vi.fn(loadImpl ?? (async (ref: ChunkRef) => chunkFor(ref)));
  const store = createChunkStore({
    index: idx,
    load,
    idle: (fn) => { idle.push(fn); return () => { const i = idle.indexOf(fn); if (i >= 0) idle.splice(i, 1); }; },
    setTimer: (fn, ms) => { timerId++; timers.set(timerId, { fn, at: clock + ms }); return timerId; },
    clearTimer: (h) => { timers.delete(h as number); },
    now: () => clock,
  });
  const advance = (ms: number): void => {
    clock += ms;
    for (const [id, t] of [...timers]) if (t.at <= clock) { timers.delete(id); t.fn(); }
  };
  const runIdle = (): void => { while (idle.length) idle.shift()!(); };
  const settle = async (): Promise<void> => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
  return { store, load, advance, runIdle, settle, idle, timers };
}

describe('missing chunks', () => {
  it('a chunk the index lacks is missing at once, never fetched, and at() has nothing', () => {
    const h = harness(index([T0 + 3 * MOTION_CHUNK_S]));
    expect(h.store.state('396', T0 + 100)).toBe('missing');
    h.store.want('396', T0 + 100, 1, true); // prefetch 1: the next chunk, which the index lacks too
    h.advance(1000);
    h.runIdle();
    expect(h.load).not.toHaveBeenCalled();
    expect(h.store.state('396', T0 + 100)).toBe('missing');
    expect(h.store.at('396', T0 + 100)).toBeNull();
  });

  it('a prefetch target the index lacks gets no entry, so the badge judges the current chunk alone', async () => {
    const h = harness(index([T0]));
    h.store.want('396', T0 + 100, 600, true);
    h.advance(SCRUB_DEBOUNCE_MS);
    await h.settle();
    expect(h.store.state('396', T0 + 100)).toBe('ready');
    expect(h.store.at('396', T0 + 100)).toEqual({ current: expect.objectContaining({ t0: T0 }), next: null });
    expect(h.load).toHaveBeenCalledTimes(1);
  });
});

describe('the scrub debounce', () => {
  it('fetches the current chunk only after 120 ms, and the latest request wins over the ones before it', async () => {
    const t0s = Array.from({ length: 12 }, (_, i) => T0 + i * MOTION_CHUNK_S);
    const h = harness(index(t0s));
    h.store.want('396', t0s[2]! + 5, 1, false);
    expect(h.store.state('396', t0s[2]!)).toBe('loading');
    h.advance(SCRUB_DEBOUNCE_MS - 1);
    expect(h.load).not.toHaveBeenCalled();
    // The hand moves on before the timer fires: the earlier chunk is forgotten, the new one waits its own 120 ms.
    h.store.want('396', t0s[7]! + 5, 1, false);
    expect(h.store.state('396', t0s[2]!)).toBe('idle');
    h.advance(SCRUB_DEBOUNCE_MS - 1);
    expect(h.load).not.toHaveBeenCalled();
    h.advance(1);
    expect(h.load).toHaveBeenCalledTimes(1);
    expect(h.load.mock.calls[0]![0].path).toContain(String(t0s[7]));
    await h.settle();
    expect(h.store.state('396', t0s[7]!)).toBe('ready');
  });

  it('a chunk already in memory is answered without any wait', async () => {
    const h = harness(index([T0]));
    h.store.want('396', T0, 60, true);
    h.advance(SCRUB_DEBOUNCE_MS);
    await h.settle();
    h.store.want('396', T0 + 300, 60, true);
    expect(h.store.at('396', T0 + 300)?.current?.t0).toBe(T0);
    expect(h.load).toHaveBeenCalledTimes(1);
  });
});

describe('prefetch and hold by speed', () => {
  const t0s = Array.from({ length: 20 }, (_, i) => T0 + i * MOTION_CHUNK_S);

  it.each(SPEEDS.filter((s) => s !== 3600) as Speed[])('at %dx the policy prefetches ahead in idle time', (speed) => {
    const h = harness(index(t0s));
    h.store.want('396', T0 + 1, speed, true);
    expect(h.idle).toHaveLength(CHUNK_POLICY[speed].prefetch);
    h.advance(SCRUB_DEBOUNCE_MS);
    expect(h.load).toHaveBeenCalledTimes(1);
    h.runIdle();
    expect(h.load).toHaveBeenCalledTimes(1 + CHUNK_POLICY[speed].prefetch);
    const asked = h.load.mock.calls.map((c) => Number(c[0].path.split('/')[2]!.split('.')[0])).sort((a, b) => a - b);
    expect(asked).toEqual(t0s.slice(0, 1 + CHUNK_POLICY[speed].prefetch));
  });

  it('at 3600x nothing is fetched while playing, and only the current chunk when paused', async () => {
    const h = harness(index(t0s));
    h.store.want('396', T0 + 1, 3600, true);
    h.advance(1000);
    h.runIdle();
    expect(h.load).not.toHaveBeenCalled();
    expect(h.store.state('396', T0)).toBe('idle');
    h.store.want('396', T0 + 1, 3600, false);
    expect(h.idle).toHaveLength(0);
    h.advance(SCRUB_DEBOUNCE_MS);
    await h.settle();
    expect(h.load).toHaveBeenCalledTimes(1);
    expect(h.store.state('396', T0)).toBe('ready');
  });

  it('holds no more than the policy says, dropping the least recently used, never the current or the next', async () => {
    const h = harness(index(t0s));
    for (let i = 0; i < 8; i++) {
      h.store.want('396', t0s[i]! + 1, 1, true); // hold 3, prefetch 1
      h.advance(SCRUB_DEBOUNCE_MS);
      h.runIdle();
      await h.settle();
      expect(h.store.held()).toBeLessThanOrEqual(CHUNK_POLICY[1].hold);
      expect(h.store.at('396', t0s[i]!)?.current?.t0).toBe(t0s[i]);
      expect(h.store.at('396', t0s[i]!)?.next?.t0).toBe(t0s[i + 1]);
    }
    expect(h.store.state('396', t0s[0]!)).toBe('idle');
  });

  it('the hold grows with the speed: 8 chunks stay at 600x', async () => {
    const h = harness(index(t0s));
    for (let i = 0; i < 10; i++) {
      h.store.want('396', t0s[i]! + 1, 600, true);
      h.advance(SCRUB_DEBOUNCE_MS);
      h.runIdle();
      await h.settle();
    }
    expect(h.store.held()).toBe(CHUNK_POLICY[600].hold);
    expect(h.store.at('396', t0s[9]!)?.next?.t0).toBe(t0s[10]);
  });
});

describe('failures', () => {
  it('a load that fails once is tried again and lands; one that fails twice is missing', async () => {
    let failures = 1;
    const h = harness(index([T0, T0 + MOTION_CHUNK_S]), async (ref) => {
      if (ref.path.includes(String(T0 + MOTION_CHUNK_S))) throw new Error('down');
      if (failures-- > 0) throw new Error('flaky');
      return chunkFor(ref);
    });
    h.store.want('396', T0, 60, true);
    h.advance(SCRUB_DEBOUNCE_MS);
    h.runIdle();
    await h.settle();
    await h.settle();
    expect(h.store.state('396', T0)).toBe('ready');
    expect(h.store.state('396', T0 + MOTION_CHUNK_S)).toBe('missing');
    expect(h.store.at('396', T0)).toEqual({ current: expect.objectContaining({ t0: T0 }), next: null });
    const calls = h.load.mock.calls.map((c) => c[0].path);
    expect(calls.filter((p) => p.includes(String(T0)) && !p.includes(String(T0 + MOTION_CHUNK_S)))).toHaveLength(2);
    expect(calls.filter((p) => p.includes(String(T0 + MOTION_CHUNK_S)))).toHaveLength(2);
  });
});

describe('both segments and destroy', () => {
  it('keeps the two networks apart and forgets everything on destroy', async () => {
    const idx: MotionIndex = { ...index([T0]), chunks: [...index([T0]).chunks, ...index([1790200800 + 27_600], '395').chunks] };
    const h = harness(idx);
    h.store.want('396', T0, 60, true);
    h.store.want('395', 1790200800 + 27_650, 60, true);
    // Two different current chunks on two nets: the second request does not cancel the first (different net).
    h.advance(SCRUB_DEBOUNCE_MS);
    await h.settle();
    expect(h.store.state('395', 1790200800 + 27_650)).toBe('ready');
    expect(h.store.state('396', T0)).toBe('idle');
    h.store.want('396', T0, 60, true);
    h.advance(SCRUB_DEBOUNCE_MS);
    await h.settle();
    expect(h.store.state('396', T0)).toBe('ready');
    expect(h.store.held()).toBe(2);
    h.store.destroy();
    expect(h.store.held()).toBe(0);
    expect(h.timers.size).toBe(0);
    expect(h.idle).toHaveLength(0);
  });
});
