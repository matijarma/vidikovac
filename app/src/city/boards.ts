// The scheduled departure boards a surface has in hand, memoised for a
// minute. Lifted out of the transport workspace's own `ensureBoard` so the
// phone sheet, the desktop board and the kiosk share one cache instead of
// keeping three of their own: a named stop has several platforms and every
// one of them is a fetch, and the arrivals list (shared/city/arrivals.ts)
// wants all of them at once.
//
// Fetching and remembering only. What the boards mean is arrivals.ts's job,
// and when to ask is the caller's: this module never polls by itself.

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
   *  the first answer for it has landed. */
  get(operator: BoardOperator, stopId: string): DepartureBoard | undefined;
  /** Fetch every platform whose copy is missing or past the TTL. `onChange`
   *  fires once per platform that settled, so a surface can re-render. */
  ensure(operator: BoardOperator, stopIds: readonly string[], onChange?: () => void): void;
  destroy(): void;
}

const TTL_MS = 60_000;
const TIMEOUT_MS = 12_000;

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
  const pending = new Set<string>();
  let disposed = false;

  const keyOf = (operator: BoardOperator, stopId: string): string => `${operator}:${stopId}`;

  function load(operator: BoardOperator, stopId: string, onChange?: () => void): void {
    const key = keyOf(operator, stopId);
    if (disposed || pending.has(key) || now() - (times.get(key) ?? -Infinity) < ttlMs) return;
    pending.add(key);
    const settle = (board: DepartureBoard): void => {
      if (disposed) return;
      boards.set(key, board);
      times.set(key, now());
      onChange?.();
    };
    void fetchImpl(`/api/city/departures?operator=${operator}&stop=${encodeURIComponent(stopId)}`, { signal: AbortSignal.timeout(timeoutMs) })
      .then(async (response) => {
        if (!response.ok) throw new Error('schedule-down');
        const body: unknown = await response.json();
        if (!isBoard(body)) throw new Error('schedule-malformed');
        settle(body);
      })
      .catch(() => { settle(downBoard(operator, stopId, now())); })
      .finally(() => pending.delete(key));
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
      pending.clear();
    },
  };
}
