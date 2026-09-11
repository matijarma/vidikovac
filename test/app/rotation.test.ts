import { describe, expect, it, vi } from 'vitest';
import type { CodeSlot } from '../../worker/protocol';
import { createRotation, currentSlot, shouldRequestMore, slotProgress, slotsRemaining } from '../../app/src/rotation';

function batch(start: number, count = 20, len = 30_000): CodeSlot[] {
  return Array.from({ length: count }, (_, i) => ({ code: `C${String(i).padStart(7, '0')}`, slotStart: start + i * len, slotEnd: start + (i + 1) * len }));
}

describe('slot arithmetic', () => {
  const b = batch(1_000_000);
  it('picks the slot containing serverNow, none before or after the batch', () => {
    expect(currentSlot(b, 999_999)).toBeNull();
    expect(currentSlot(b, 1_000_000)?.code).toBe('C0000000');
    expect(currentSlot(b, 1_029_999)?.code).toBe('C0000000');
    expect(currentSlot(b, 1_030_000)?.code).toBe('C0000001');
    expect(currentSlot(b, 1_000_000 + 20 * 30_000)).toBeNull();
  });
  it('counts remaining slots and asks for more at three', () => {
    expect(slotsRemaining(b, 1_000_000)).toBe(20);
    expect(shouldRequestMore(b, 1_000_000 + 16 * 30_000)).toBe(false);
    expect(shouldRequestMore(b, 1_000_000 + 17 * 30_000)).toBe(true);
    expect(shouldRequestMore([], 0)).toBe(true);
  });
  it('reports progress through a slot in [0, 1]', () => {
    expect(slotProgress(b[0]!, 1_000_000)).toBe(0);
    expect(slotProgress(b[0]!, 1_015_000)).toBeCloseTo(0.5);
    expect(slotProgress(b[0]!, 1_040_000)).toBe(1);
  });
});

describe('createRotation', () => {
  it('rotates on wall-clock boundaries using the serverNow offset and requests more once per batch', () => {
    let fn: (() => void) | null = null;
    let local = 500; // device clock is far from the server clock on purpose
    const onSlot = vi.fn(); const onMore = vi.fn();
    const r = createRotation({ now: () => local, onSlot, onMore, setInterval: (f) => { fn = f; return 1; }, clearInterval: () => { fn = null; } });
    r.setBatch(batch(1_000_000), 1_000_000); // offset = 999_500
    expect(onSlot).toHaveBeenLastCalledWith(expect.objectContaining({ code: 'C0000000' }));
    local += 29_999; fn?.();
    expect(onSlot).toHaveBeenCalledTimes(1);
    local += 1; fn?.();
    expect(onSlot).toHaveBeenLastCalledWith(expect.objectContaining({ code: 'C0000001' }));
    local += 16 * 30_000; fn?.(); fn?.();
    expect(onMore).toHaveBeenCalledTimes(1);
    r.setBatch(batch(1_000_000 + 20 * 30_000), 1_000_000 + 17 * 30_000 + 1);
    local += 3 * 30_000; fn?.();
    expect(onSlot).toHaveBeenLastCalledWith(expect.objectContaining({ code: 'C0000000' }));
    r.stop();
    expect(fn).toBeNull();
  });
  it('reports null when the batch has run out', () => {
    let fn: (() => void) | null = null;
    let local = 0;
    const onSlot = vi.fn();
    createRotation({ now: () => local, onSlot, onMore: () => {}, setInterval: (f) => { fn = f; return 1; }, clearInterval: () => {} }).setBatch(batch(0, 1), 0);
    local = 30_000; fn?.();
    expect(onSlot).toHaveBeenLastCalledWith(null);
  });
});
