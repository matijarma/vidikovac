// Wall-clock code rotation shared by the kiosk and the phone's share dialog.
// The server sends a batch with its own `serverNow`; we keep the offset to the
// device clock and pick the slot by server time, so a phone whose clock is
// minutes off still shows the code the Worker will accept.
import { CODE_GRACE_MS, type CodeSlot } from '../../worker/protocol';

export function currentSlot(batch: readonly CodeSlot[], serverNow: number): CodeSlot | null {
  return batch.find((s) => s.slotStart <= serverNow && serverNow < s.slotEnd) ?? null;
}
export function slotsRemaining(batch: readonly CodeSlot[], serverNow: number): number {
  return batch.filter((s) => s.slotEnd > serverNow).length;
}
export function shouldRequestMore(batch: readonly CodeSlot[], serverNow: number, threshold = 3): boolean {
  return slotsRemaining(batch, serverNow) <= threshold;
}
export function slotProgress(slot: CodeSlot, serverNow: number): number {
  const span = slot.slotEnd - slot.slotStart;
  if (span <= 0) return 1;
  return Math.min(1, Math.max(0, (serverNow - slot.slotStart) / span));
}

export interface RotationDeps {
  now: () => number;
  onSlot: (slot: CodeSlot | null) => void;
  onMore: () => void;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (handle: unknown) => void;
  tickMs?: number;
  moreThreshold?: number;
}
export interface Rotation {
  setBatch(batch: CodeSlot[], serverNow: number): void;
  serverNow(): number;
  current(): CodeSlot | null;
  stop(): void;
}

export function createRotation(deps: RotationDeps): Rotation {
  const setTimer = deps.setInterval ?? ((fn, ms) => globalThis.setInterval(fn, ms));
  const clearTimer = deps.clearInterval ?? ((h) => globalThis.clearInterval(h as never));
  let batch: CodeSlot[] = [];
  let offset = 0;
  let lastCode: string | null = null;
  let moreRequested = false;
  let timer: unknown = null;

  const serverNow = (): number => deps.now() + offset;

  function tick(): void {
    const now = serverNow();
    const slot = currentSlot(batch, now);
    const code = slot?.code ?? null;
    if (code !== lastCode) { lastCode = code; deps.onSlot(slot); }
    if (!moreRequested && shouldRequestMore(batch, now, deps.moreThreshold)) { moreRequested = true; deps.onMore(); }
  }

  return {
    setBatch(next, sNow) {
      offset = sNow - deps.now();
      // Merge, never replace (R-51). The server already sends the union of its
      // still-valid codes, but a client that threw its own batch away on every
      // frame would blank the screen for a minute after each 'more' and for up
      // to ten minutes after a reconnect if a future server ever sent only the
      // new slots. Keeping whatever is still redeemable is the defensive half
      // of the same fix.
      const merged = new Map<string, CodeSlot>();
      for (const slot of batch) if (slot.slotEnd + CODE_GRACE_MS > sNow) merged.set(slot.code, slot);
      for (const slot of next) merged.set(slot.code, slot);
      batch = [...merged.values()].sort((a, b) => a.slotStart - b.slotStart);
      moreRequested = false;
      lastCode = null;
      tick();
      if (timer === null) timer = setTimer(tick, deps.tickMs ?? 250);
    },
    serverNow,
    current: () => currentSlot(batch, serverNow()),
    stop() { if (timer !== null) { clearTimer(timer); timer = null; } },
  };
}
