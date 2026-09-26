// The scheduled departure boards a surface has in hand, memoised for a
// minute. Lifted out of the transport workspace's own `ensureBoard` so the
// phone sheet, the desktop board and the kiosk share one cache instead of
// keeping three of their own: a named stop has several platforms and every
// one of them is a fetch, and the arrivals list (shared/city/arrivals.ts)
// wants all of them at once.
//
// Fetching and remembering only. What the boards mean is arrivals.ts's job,
// and when to ask is the caller's: this module never polls by itself, and a
// caller that must go quiet (a frozen session, say) simply stops calling
// `ensure` -- the cache has no gate of its own.

import type { DepartureBoard } from '../../../shared/city/types';

export type BoardOperator = DepartureBoard['operator'];

export interface BoardCacheOptions {
  /** Defaults to the global fetch; a test or the kiosk passes its own. */
  fetchImpl?: typeof globalThis.fetch;
  now?: () => number;
  /** How long an answer counts as current. ZET's own board changes by the minute. */
  ttlMs?: number;
  /** After this a request is abandoned and the platform reads as down. */
  timeoutMs?: number;
}

export interface BoardCache {
  /** The board in hand for one platform, whatever its age; undefined before
   *  the first answer for it has landed. A board whose rows are still due
   *  outlives a later failure or an answer with nothing due (boardUseful),
   *  and reads `stale` from then until a useful answer replaces it. */
  get(operator: BoardOperator, stopId: string): DepartureBoard | undefined;
  /** Fetch every platform whose copy is missing or past the TTL. `onChange`
   *  fires once per platform that settled, so a surface can re-render. Every
   *  caller that asked for a platform is notified, not only the one whose
   *  call started the request. */
  ensure(operator: BoardOperator, stopIds: readonly string[], onChange?: () => void): void;
  destroy(): void;
}

const TTL_MS = 60_000;
const TIMEOUT_MS = 12_000;
/** A platform whose fetch failed is asked again this soon, not after the whole TTL: a timed-out first answer on a cold
 *  open left "Vozni red trenutacno nije dostupan." standing for over a minute while the trams ran (round 1, desktop F2). */
export const DOWN_RETRY_MS = 5_000;
/** A board still says something about the future while one of its departures is at most this long past (the
 *  grace shared/city/arrivals.ts and city/nearby.ts keep a departure listed after its time). */
export const BOARD_KEEP_GRACE_MS = 60_000;

/** Whether a board says anything about what leaves next: not a failure, and at least one departure that is
 *  still due (or inside the grace). An empty board, and one whose every row has passed, say nothing. */
export function boardUseful(board: DepartureBoard, atMs: number): boolean {
  if (board.status === 'down') return false;
  return board.departures.some((d) => {
    const at = Date.parse(d.at);
    return Number.isFinite(at) && at >= atMs - BOARD_KEEP_GRACE_MS;
  });
}

/** A platform whose fetch failed: the surface says "down" for that platform
 *  rather than showing nothing and asking again on every render. */
function downBoard(operator: BoardOperator, stopId: string, atMs: number): DepartureBoard {
  return { operator, stopId, stopName: stopId, status: 'down', generatedAt: new Date(atMs).toISOString(), departures: [] };
}

function isBoard(value: unknown): value is DepartureBoard {
  return typeof value === 'object' && value !== null && Array.isArray((value as DepartureBoard).departures);
}

export function createBoardCache(options: BoardCacheOptions = {}): BoardCache {
  const fetchImpl = options.fetchImpl ?? ((...args: Parameters<typeof globalThis.fetch>) => globalThis.fetch(...args));
  const now = options.now ?? Date.now;
  const ttlMs = options.ttlMs ?? TTL_MS;
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;

  const boards = new Map<string, DepartureBoard>();
  const times = new Map<string, number>();
  /** Per in-flight platform, everyone waiting to hear that it settled. One
   *  request serves every surface that asked for it, so one request has to
   *  answer all of them: keeping only the first caller's callback silently
   *  left the others un-rendered. */
  const waiting = new Map<string, Set<() => void>>();
  let disposed = false;

  const keyOf = (operator: BoardOperator, stopId: string): string => `${operator}:${stopId}`;

  function load(operator: BoardOperator, stopId: string, onChange?: () => void): void {
    const key = keyOf(operator, stopId);
    const listeners = waiting.get(key);
    if (listeners) {
      // Already in flight: join the answer rather than asking again.
      if (onChange) listeners.add(onChange);
      return;
    }
    if (disposed || now() - (times.get(key) ?? -Infinity) < ttlMs) return;
    waiting.set(key, new Set(onChange ? [onChange] : []));
    // An explicit controller rather than AbortSignal.timeout: the timer is
    // then ours to stop the moment the answer is in, instead of one per
    // request ticking on to twelve seconds after it is no longer wanted.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('schedule-timeout')), timeoutMs);
    // The board is the answer the page opens with: ahead of the feeds on a narrow link (the fetch priority hint).
    void fetchImpl(`/api/city/departures?operator=${operator}&stop=${encodeURIComponent(stopId)}`, { signal: controller.signal, priority: 'high' })
      .then(async (response) => {
        if (!response.ok) throw new Error('schedule-down');
        const body: unknown = await response.json();
        if (!isBoard(body)) throw new Error('schedule-malformed');
        return body;
      })
      // Every failure -- refused, unreachable, timed out, not a board -- is
      // the same answer to a reader: this platform is down.
      .catch(() => downBoard(operator, stopId, now()))
      .then((board) => {
        clearTimeout(timer);
        const heard = waiting.get(key) ?? new Set<() => void>();
        waiting.delete(key);
        if (disposed) return;
        // The board is stored BEFORE anyone is told about it. A listener that
        // throws used to land in the catch above and demote a good board to a
        // down placeholder, firing twice on the way; nothing a listener does
        // can reach the store from here. One surface's render fault is its
        // own to fix, and must not starve the next surface's callback.
        //
        // An answer that says nothing about what leaves next (a failure, an
        // empty board, a board whose every row has passed) never replaces a
        // board whose rows are still due: the D5.21 wall listed no departure
        // for 25 to 46 s at 22:23 when a failed fetch became the board in hand
        // and the rows it had shown ran out of their grace while the trams
        // still ran (observe-d521b, item 2). The board in hand stays, marked
        // stale (a copy nobody has confirmed), until its own rows pass or a
        // useful answer lands; the platform is asked again on the retry beat.
        const at = now();
        const held = boards.get(key);
        const useful = boardUseful(board, at);
        const kept = !useful && held !== undefined && boardUseful(held, at);
        if (kept) boards.set(key, held.status === 'stale' ? held : { ...held, status: 'stale' });
        else boards.set(key, board);
        // A down or refused answer counts as current only for DOWN_RETRY_MS; a stored one for the TTL.
        times.set(key, kept || board.status === 'down' ? at - ttlMs + Math.min(DOWN_RETRY_MS, ttlMs) : at);
        for (const listener of heard) { try { listener(); } catch { /* the surface's fault, not the cache's */ } }
      });
  }

  return {
    get: (operator, stopId) => boards.get(keyOf(operator, stopId)),
    ensure(operator, stopIds, onChange) {
      for (const stopId of stopIds) load(operator, stopId, onChange);
    },
    destroy() {
      disposed = true;
      boards.clear();
      times.clear();
      waiting.clear();
    },
  };
}
