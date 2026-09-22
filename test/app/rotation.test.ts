import { describe, expect, it, vi } from 'vitest';
import type { CodeSlot } from '../../worker/protocol';
import { createRotation, currentSlot, shouldRequestMore, slotProgress, slotsRemaining } from '../../app/src/rotation';

function batch(start: number, count = 20, len = 30_000, prefix = 'C'): CodeSlot[] {
  return Array.from({ length: count }, (_, i) => ({
    code: `${prefix}${String(i).padStart(8 - prefix.length, '0')}`,
    slotStart: start + i * len,
    slotEnd: start + (i + 1) * len,
  }));
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
    let fn = null as (() => void) | null; // assigned inside setInterval below, so no narrowing to null
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
    r.setBatch(batch(1_000_000 + 20 * 30_000, 20, 30_000, 'D'), 1_000_000 + 17 * 30_000 + 1);
    local += 3 * 30_000; fn?.();
    expect(onSlot).toHaveBeenLastCalledWith(expect.objectContaining({ code: 'D0000000' }));
    r.stop();
    expect(fn).toBeNull();
  });
  // R-51: a 'more' batch starts where the old one ended, so replacing the batch
  // blanked the screen until the new slots opened; a reconnect replays codes the
  // screen is already showing, so replacing the batch there is a ten-minute gap.
  it('keeps the current code when a future batch arrives, and rotates into it', () => {
    let fn = null as (() => void) | null; // assigned inside setInterval below, so no narrowing to null
    let local = 1_000_000;
    const onSlot = vi.fn();
    const r = createRotation({ now: () => local, onSlot, onMore: () => {}, setInterval: (f) => { fn = f; return 1; }, clearInterval: () => {} });
    r.setBatch(batch(1_000_000), 1_000_000);
    local += 17 * 30_000; fn?.();
    expect(r.current()?.code).toBe('C0000017');

    // What the server sends on 'more': slots that all start in the future.
    r.setBatch(batch(1_000_000 + 20 * 30_000, 20, 30_000, 'D'), local);
    expect(r.current()?.code).toBe('C0000017');
    local += 30_000; fn?.();
    expect(r.current()?.code).toBe('C0000018');
    local += 2 * 30_000; fn?.();
    expect(r.current()?.code).toBe('D0000000');
    expect(onSlot).not.toHaveBeenLastCalledWith(null);
  });

  it('still has a current code when a reconnect replays a batch it already holds', () => {
    let fn = null as (() => void) | null; // assigned inside setInterval below, so no narrowing to null
    let local = 1_000_000;
    const onSlot = vi.fn();
    const r = createRotation({ now: () => local, onSlot, onMore: () => {}, setInterval: (f) => { fn = f; return 1; }, clearInterval: () => {} });
    r.setBatch(batch(1_000_000), 1_000_000);
    local += 5 * 30_000; fn?.();
    // The screen reconnects and the object answers with the same live slots.
    r.setBatch(batch(1_000_000).slice(5), local);
    expect(r.current()?.code).toBe('C0000005');
    expect(onSlot).toHaveBeenLastCalledWith(expect.objectContaining({ code: 'C0000005' }));
  });

  it('reports null when the batch has run out', () => {
    let fn = null as (() => void) | null; // assigned inside setInterval below, so no narrowing to null
    let local = 0;
    const onSlot = vi.fn();
    createRotation({ now: () => local, onSlot, onMore: () => {}, setInterval: (f) => { fn = f; return 1; }, clearInterval: () => {} }).setBatch(batch(0, 1), 0);
    local = 30_000; fn?.();
    expect(onSlot).toHaveBeenLastCalledWith(null);
  });
});
