// Which ten-minute motion chunks are in memory, and when they are fetched.
// The replay reads two segments: the window on network 396 and the
// comparison day on network 395 (the frozen artefacts the manifest names,
// never /data/zet-network.json). A chunk the index lacks is `missing`, a
// recording gap the page shows as "Bez snimke" and never as an empty
// fleet; a chunk that fails to load is tried once more and is then missing
// too. The policy follows the speed: the faster the replay, the more chunks
// are held and fetched ahead, in idle time; at one hour per second nothing
// is fetched while playing (no vehicle is drawn) and only the current chunk
// when paused. A scrub asks for a new current chunk many times a second,
// so that request waits SCRUB_DEBOUNCE_MS for the hand to settle.
import { decodeNetwork, type GraphNetwork } from '../../../shared/motion/network';
import { MOTION_CHUNK_S, type HashedRef, type MotionChunk, type MotionIndex, type SnimkaManifest, type Speed } from '../../../shared/snimka';
import { chunkStart } from '../../../shared/snimka-codec';
import type { RefCache } from './data';

export type SegmentNet = '395' | '396';

export interface ChunkPolicy { hold: number; prefetch: number }
/** Chunks kept and chunks fetched ahead of the current one, by replay speed (the brief's policy). */
export const CHUNK_POLICY: Readonly<Record<Speed, ChunkPolicy>> = Object.freeze({
  1: { hold: 3, prefetch: 1 },
  60: { hold: 4, prefetch: 2 },
  600: { hold: 8, prefetch: 5 },
  3600: { hold: 1, prefetch: 0 },
});
export const SCRUB_DEBOUNCE_MS = 120;
/** At this speed nothing is fetched while the replay plays; paused, the current chunk alone. */
const NO_FETCH_WHILE_PLAYING: Speed = 3600;

export type ChunkState = 'idle' | 'loading' | 'ready' | 'missing';
export interface ChunkPair { current: MotionChunk | null; next: MotionChunk | null }

export interface ChunkStoreDeps {
  index: MotionIndex;
  /** Loads and validates one chunk (ctx.data.get(ref, decodeMotionChunk)). Rejects on failure. */
  load(ref: HashedRef): Promise<MotionChunk>;
  /** Runs `fn` in idle time and returns its cancel; requestIdleCallback or a short timer by default. */
  idle?: (fn: () => void) => () => void;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  now?: () => number;
  /** A chunk became ready or missing: a paused map redraws, the badge re-reads the state. */
  onChange?: () => void;
}

export interface ChunkStore {
  /** What the stage shows right now; once per frame, cheap. Starts and schedules the fetches the policy asks for. */
  want(net: SegmentNet, atSec: number, speed: Speed, playing: boolean): void;
  /** The chunk holding the instant with the one after it (null while that one is not in memory), or null while
   *  the current chunk is loading, idle or missing; state() says which. */
  at(net: SegmentNet, atSec: number): ChunkPair | null;
  state(net: SegmentNet, atSec: number): ChunkState;
  /** How many chunks are in memory (tests and the budget of a long session). */
  held(): number;
  destroy(): void;
}

interface Entry { state: 'loading' | 'ready' | 'missing'; chunk: MotionChunk | null; lastUsed: number }

const defaultIdle = (fn: () => void): (() => void) => {
  const w = globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (h: number) => void };
  if (typeof w.requestIdleCallback === 'function') {
    const h = w.requestIdleCallback(fn, { timeout: 500 });
    return () => w.cancelIdleCallback?.(h);
  }
  const h = setTimeout(fn, 50);
  return () => clearTimeout(h);
};

export function createChunkStore(deps: ChunkStoreDeps): ChunkStore {
  const setTimer = deps.setTimer ?? ((fn, ms): unknown => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((h): void => clearTimeout(h as ReturnType<typeof setTimeout>));
  const idle = deps.idle ?? defaultIdle;
  const now = deps.now ?? ((): number => Date.now());
  const refs = new Map<string, HashedRef>();
  for (const c of deps.index.chunks) refs.set(`${c.net}:${c.t0}`, { path: c.path, sha256: c.sha256, bytes: c.bytes });
  const entries = new Map<string, Entry>();
  const key = (net: SegmentNet, t0: number): string => `${net}:${t0}`;
  let destroyed = false;
  /** The debounced request for a current chunk: one at a time, the latest wins. */
  let pending: { key: string; timer: unknown } | null = null;
  const idleCancels = new Map<string, () => void>();
  /** What want() last asked for per net, so a load that lands after it is held to the same policy. */
  const lastWant = new Map<SegmentNet, { keep: ReadonlySet<string>; hold: number }>();

  function fetchChunk(k: string, attempt = 0): void {
    const ref = refs.get(k);
    const entry = entries.get(k);
    if (!ref || !entry || entry.state !== 'loading' || destroyed) return;
    deps.load(ref).then(
      (chunk) => {
        if (destroyed) return;
        const e = entries.get(k);
        if (e && e.state === 'loading') { e.state = 'ready'; e.chunk = chunk; }
        const net = k.split(':')[0] as SegmentNet;
        const want = lastWant.get(net);
        if (want) evict(net, want.keep, want.hold);
        deps.onChange?.();
      },
      () => {
        if (destroyed) return;
        if (attempt === 0) { fetchChunk(k, 1); return; }
        const e = entries.get(k);
        if (e && e.state === 'loading') { e.state = 'missing'; e.chunk = null; }
        deps.onChange?.();
      },
    );
  }

  /** The entry for a chunk, created as loading (and fetched by `how`) or as missing when the index lacks it. */
  function ensure(k: string, how: 'now' | 'debounced' | 'idle'): Entry {
    let entry = entries.get(k);
    if (entry) { entry.lastUsed = now(); return entry; }
    if (!refs.has(k)) {
      entry = { state: 'missing', chunk: null, lastUsed: now() };
      entries.set(k, entry);
      return entry;
    }
    entry = { state: 'loading', chunk: null, lastUsed: now() };
    entries.set(k, entry);
    if (how === 'now') fetchChunk(k);
    else if (how === 'debounced') {
      if (pending) clearTimer(pending.timer);
      pending = { key: k, timer: setTimer(() => { pending = null; fetchChunk(k); }, SCRUB_DEBOUNCE_MS) };
    } else {
      idleCancels.set(k, idle(() => { idleCancels.delete(k); fetchChunk(k); }));
    }
    return entry;
  }

  /** Drops ready chunks of the net beyond `hold`, least recently used first, never one the policy wants now. */
  function evict(net: SegmentNet, keep: ReadonlySet<string>, hold: number): void {
    const candidates: [string, Entry][] = [];
    for (const [k, e] of entries) if (k.startsWith(`${net}:`) && e.state === 'ready' && !keep.has(k)) candidates.push([k, e]);
    const kept = [...entries].filter(([k, e]) => k.startsWith(`${net}:`) && e.state === 'ready').length;
    if (kept <= hold) return;
    candidates.sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    for (const [k] of candidates.slice(0, kept - hold)) entries.delete(k);
  }

  return {
    want(net, atSec, speed, playing) {
      if (destroyed) return;
      const t0 = chunkStart(atSec);
      const policy = CHUNK_POLICY[speed];
      if (speed === NO_FETCH_WHILE_PLAYING && playing) return;
      const current = key(net, t0);
      const keep = new Set<string>([current]);
      const currentEntry = entries.get(current);
      // A request already pending for another chunk is a scrub still moving: the newest instant wins.
      if (!currentEntry && pending && pending.key !== current) { clearTimer(pending.timer); entries.delete(pending.key); pending = null; }
      ensure(current, 'debounced');
      for (let i = 1; i <= policy.prefetch; i++) {
        const k = key(net, t0 + i * MOTION_CHUNK_S);
        keep.add(k);
        if (!refs.has(k)) continue; // never an entry for a gap we are not standing in: the badge judges the current chunk alone
        ensure(k, 'idle');
      }
      lastWant.set(net, { keep, hold: policy.hold });
      evict(net, keep, policy.hold);
    },
    at(net, atSec) {
      const t0 = chunkStart(atSec);
      const entry = entries.get(key(net, t0));
      if (!entry || entry.state !== 'ready' || !entry.chunk) return null;
      entry.lastUsed = now();
      const following = entries.get(key(net, t0 + MOTION_CHUNK_S));
      if (following?.state === 'ready') following.lastUsed = now();
      return { current: entry.chunk, next: following?.state === 'ready' ? following.chunk : null };
    },
    state(net, atSec) {
      const entry = entries.get(key(net, chunkStart(atSec)));
      if (!entry) return refs.has(key(net, chunkStart(atSec))) ? 'idle' : 'missing';
      return entry.state;
    },
    held: () => [...entries.values()].filter((e) => e.state === 'ready').length,
    destroy() {
      destroyed = true;
      if (pending) clearTimer(pending.timer);
      pending = null;
      for (const cancel of idleCancels.values()) cancel();
      idleCancels.clear();
      entries.clear();
    },
  };
}

/** The two frozen network artefacts the manifest names, decoded once each through the ref cache. */
export async function loadReplayNetworks(data: RefCache, manifest: Pick<SnimkaManifest, 'networks'>): Promise<Record<SegmentNet, GraphNetwork>> {
  const [n396, n395] = await Promise.all([
    data.get(manifest.networks['396'], decodeNetwork),
    data.get(manifest.networks['395'], decodeNetwork),
  ]);
  return { '396': n396, '395': n395 };
}
