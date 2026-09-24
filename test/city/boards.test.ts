import { afterEach, describe, expect, it, vi } from 'vitest';
import { BOARD_KEEP_GRACE_MS, boardUseful, createBoardCache, DOWN_RETRY_MS } from '../../app/src/city/boards';
import type { DepartureBoard } from '../../shared/city/types';

const NOW = Date.parse('2026-09-19T10:00:00Z');

const board = (stopId: string): DepartureBoard => ({
  operator: 'zet', stopId, stopName: `Stop ${stopId}`, status: 'live', generatedAt: new Date(NOW).toISOString(),
  departures: [{ operator: 'zet', tripId: `T-${stopId}`, routeId: '6', routeName: '6', headsign: 'Sopot', at: new Date(NOW + 180_000).toISOString() }],
});

/** A fetch stand-in whose answers are resolved by hand, one deferred promise per URL. */
function fakeFetch() {
  const calls: string[] = [];
  const pending = new Map<string, (r: { ok: boolean; body?: unknown; fail?: boolean }) => void>();
  const impl = vi.fn((url: string, init: { signal: AbortSignal }): Promise<Response> => {
    calls.push(url);
    return new Promise((resolve, reject) => {
      pending.set(url, (r) => {
        if (r.fail) reject(new Error('network'));
        else resolve({ ok: r.ok, json: async () => r.body } as unknown as Response);
      });
    });
  });
  const settle = async (url: string, r: { ok: boolean; body?: unknown; fail?: boolean }): Promise<void> => {
    pending.get(url)!(r);
    pending.delete(url);
    for (let i = 0; i < 8; i++) await Promise.resolve();
  };
  return { impl, calls, settle };
}

const url = (stopId: string): string => `/api/city/departures?operator=zet&stop=${stopId}`;

afterEach(() => { vi.useRealTimers(); });

// The 60 s board memo, lifted out of the transport workspace so the phone
// sheet, the desktop board and the kiosk share one cache instead of three.
describe('a failed platform is asked again soon (round 1, desktop F2)', () => {
  it('a timed-out or failed board counts as current for DOWN_RETRY_MS, a good one for the whole TTL', async () => {
    const f = fakeFetch();
    let clock = NOW;
    const cache = createBoardCache({ fetchImpl: f.impl as unknown as typeof fetch, now: () => clock });
    cache.ensure('zet', ['1']);
    await f.settle(url('1'), { ok: false });
    expect(cache.get('zet', '1')?.status).toBe('down');
    clock += DOWN_RETRY_MS - 1;
    cache.ensure('zet', ['1']);
    expect(f.calls).toHaveLength(1);
    clock += 2;
    cache.ensure('zet', ['1']);
    expect(f.calls).toHaveLength(2);
    await f.settle(url('1'), { ok: true, body: board('1') });
    expect(cache.get('zet', '1')?.status).toBe('live');
    clock += DOWN_RETRY_MS + 1_000;
    cache.ensure('zet', ['1']);
    expect(f.calls).toHaveLength(2); // a good board keeps the TTL
  });
});

// The D5.21 wall (observe-d521b, item 2): at 22:22 a failed fetch became the board in hand, the rows it had shown
// ran out of their grace and for 25 to 46 s the wall listed no departure while trams still ran. A board whose rows
// are still due now outlives any answer that says nothing about what leaves next.
describe('an answer with nothing due never replaces a board with rows still due (observe-d521b, item 2)', () => {
  const rows = (stopId: string, minutes: readonly number[], status: DepartureBoard['status'] = 'live'): DepartureBoard => ({
    operator: 'zet', stopId, stopName: `Stop ${stopId}`, status, generatedAt: new Date(NOW).toISOString(),
    departures: minutes.map((m, i) => ({ operator: 'zet', tripId: `T-${stopId}-${i}`, routeId: '6', routeName: '6', headsign: 'Sopot', at: new Date(NOW + m * 60_000).toISOString() })),
  });

  it('boardUseful: a failure, an empty board and a board whose every row has passed say nothing; one row inside the grace still does', () => {
    expect(boardUseful(rows('1', [3, 8]), NOW)).toBe(true);
    expect(boardUseful(rows('1', [-0.5]), NOW)).toBe(true); // 30 s past: inside the grace the surfaces keep it listed
    expect(boardUseful(rows('1', [-2]), NOW)).toBe(false);
    expect(boardUseful(rows('1', []), NOW)).toBe(false);
    expect(boardUseful(rows('1', [3], 'down'), NOW)).toBe(false);
    expect(boardUseful(rows('1', [3], 'stale'), NOW)).toBe(true);
    expect(boardUseful(rows('1', [-BOARD_KEEP_GRACE_MS / 60_000 + 0.01]), NOW)).toBe(true);
  });

  it('keeps the good board through a failed refresh, marked stale, asks again after DOWN_RETRY_MS, and lets a useful answer replace it', async () => {
    const f = fakeFetch();
    let clock = NOW;
    const cache = createBoardCache({ fetchImpl: f.impl as unknown as typeof fetch, now: () => clock });
    const changed = vi.fn();
    cache.ensure('zet', ['1'], changed);
    await f.settle(url('1'), { ok: true, body: rows('1', [3, 8]) });
    expect(cache.get('zet', '1')).toMatchObject({ status: 'live' });
    // A minute on, the refresh fails: the rows stay, the copy is one nobody has confirmed.
    clock = NOW + 61_000;
    cache.ensure('zet', ['1'], changed);
    await f.settle(url('1'), { ok: false });
    expect(cache.get('zet', '1')).toMatchObject({ status: 'stale', departures: [expect.objectContaining({ tripId: 'T-1-0' }), expect.objectContaining({ tripId: 'T-1-1' })] });
    expect(changed).toHaveBeenCalledTimes(2);
    // The platform is asked again on the retry beat, not after the whole TTL; a timeout or a network failure keeps the same rows.
    clock += DOWN_RETRY_MS - 1;
    cache.ensure('zet', ['1'], changed);
    expect(f.calls).toHaveLength(2);
    clock += 2;
    cache.ensure('zet', ['1'], changed);
    expect(f.calls).toHaveLength(3);
    await f.settle(url('1'), { ok: true, fail: true });
    expect(cache.get('zet', '1')).toMatchObject({ status: 'stale', generatedAt: new Date(NOW).toISOString() });
    expect(cache.get('zet', '1')!.departures).toHaveLength(2);
    // A useful answer replaces it and counts for the whole TTL again.
    clock += DOWN_RETRY_MS + 1;
    cache.ensure('zet', ['1'], changed);
    await f.settle(url('1'), { ok: true, body: rows('1', [1, 5, 9]) });
    expect(cache.get('zet', '1')).toMatchObject({ status: 'live' });
    expect(cache.get('zet', '1')!.departures).toHaveLength(3);
    clock += DOWN_RETRY_MS + 1_000;
    cache.ensure('zet', ['1'], changed);
    expect(f.calls).toHaveLength(4);
  });

  it('refuses an empty answer, a down answer the Worker itself sent, and one whose rows have all passed, while rows are still due', async () => {
    const f = fakeFetch();
    let clock = NOW;
    const cache = createBoardCache({ fetchImpl: f.impl as unknown as typeof fetch, now: () => clock });
    cache.ensure('zet', ['1']);
    await f.settle(url('1'), { ok: true, body: rows('1', [3, 8]) });
    for (const answer of [rows('1', []), rows('1', [3], 'down'), rows('1', [-2, -5]), rows('1', [], 'stale')]) {
      clock += 61_000 > DOWN_RETRY_MS ? DOWN_RETRY_MS + 1 : 61_000;
      // Past the first refusal the retry beat is enough; the first refresh waits the TTL.
      if (f.calls.length === 1) clock = NOW + 61_000;
      cache.ensure('zet', ['1']);
      await f.settle(url('1'), { ok: true, body: answer });
      expect(cache.get('zet', '1'), JSON.stringify(answer.status) + answer.departures.length).toMatchObject({ status: 'stale' });
      expect(cache.get('zet', '1')!.departures.map((d) => d.tripId)).toEqual(['T-1-0', 'T-1-1']);
    }
  });

  it('lets a failure land once the kept rows have all passed, and before any good answer', async () => {
    const f = fakeFetch();
    let clock = NOW;
    const cache = createBoardCache({ fetchImpl: f.impl as unknown as typeof fetch, now: () => clock });
    cache.ensure('zet', ['1', '2']);
    await f.settle(url('1'), { ok: true, body: rows('1', [3]) });
    // Platform 2 has never answered: its failure is the down placeholder, as always.
    await f.settle(url('2'), { ok: false });
    expect(cache.get('zet', '2')).toMatchObject({ status: 'down', departures: [] });
    // Platform 1's one row is four minutes past: nothing to keep, the failure is what is known.
    clock = NOW + 4 * 60_000 + BOARD_KEEP_GRACE_MS;
    cache.ensure('zet', ['1']);
    await f.settle(url('1'), { ok: false });
    expect(cache.get('zet', '1')).toMatchObject({ status: 'down', departures: [] });
    // An empty answer with nothing to keep counts for the whole TTL (a stop with nothing due is not asked twelve times a minute).
    clock += DOWN_RETRY_MS + 1;
    cache.ensure('zet', ['1']);
    await f.settle(url('1'), { ok: true, body: rows('1', []) });
    expect(cache.get('zet', '1')).toMatchObject({ status: 'live', departures: [] });
    clock += DOWN_RETRY_MS + 1_000;
    cache.ensure('zet', ['1']);
    expect(f.calls.filter((u) => u === url('1'))).toHaveLength(3);
  });
});

describe('createBoardCache', () => {
  it('fetches each platform once, answers from memory inside the TTL and refetches after it', async () => {
    const f = fakeFetch();
    let clock = NOW;
    const cache = createBoardCache({ fetchImpl: f.impl as unknown as typeof fetch, now: () => clock });
    const changed = vi.fn();

    cache.ensure('zet', ['100_1', '100_2'], changed);
    expect(f.calls).toEqual([url('100_1'), url('100_2')]);
    expect(cache.get('zet', '100_1')).toBeUndefined();

    await f.settle(url('100_1'), { ok: true, body: board('100_1') });
    expect(cache.get('zet', '100_1')).toMatchObject({ stopId: '100_1', status: 'live' });
    expect(changed).toHaveBeenCalledTimes(1);
    await f.settle(url('100_2'), { ok: true, body: board('100_2') });
    expect(changed).toHaveBeenCalledTimes(2);

    // Inside the TTL nothing is asked again.
    clock = NOW + 59_000;
    cache.ensure('zet', ['100_1', '100_2'], changed);
    expect(f.calls).toHaveLength(2);

    // Past it, both are refreshed, and the stale copy answers until the new one lands.
    clock = NOW + 61_000;
    cache.ensure('zet', ['100_1'], changed);
    expect(f.calls).toEqual([url('100_1'), url('100_2'), url('100_1')]);
    expect(cache.get('zet', '100_1')).toMatchObject({ stopId: '100_1' });
  });

  it('asks once while a request is in flight, however often ensure is called', async () => {
    const f = fakeFetch();
    const cache = createBoardCache({ fetchImpl: f.impl as unknown as typeof fetch, now: () => NOW });
    cache.ensure('zet', ['100_1']);
    cache.ensure('zet', ['100_1']);
    cache.ensure('zet', ['100_1', '100_1']);
    expect(f.calls).toEqual([url('100_1')]);
    await f.settle(url('100_1'), { ok: true, body: board('100_1') });
    expect(f.calls).toHaveLength(1);
  });

  it('puts a down placeholder up for a refusal, a network failure and a body that is not a board', async () => {
    const f = fakeFetch();
    const cache = createBoardCache({ fetchImpl: f.impl as unknown as typeof fetch, now: () => NOW });
    const changed = vi.fn();
    cache.ensure('zet', ['a', 'b', 'c'], changed);
    await f.settle(url('a'), { ok: false });
    await f.settle(url('b'), { ok: true, fail: true });
    await f.settle(url('c'), { ok: true, body: { stopId: 'c' } });
    for (const id of ['a', 'b', 'c']) {
      expect(cache.get('zet', id)).toEqual({
        operator: 'zet', stopId: id, stopName: id, status: 'down', generatedAt: new Date(NOW).toISOString(), departures: [],
      });
    }
    expect(changed).toHaveBeenCalledTimes(3);
  });

  it('keeps its stops apart by operator', async () => {
    const f = fakeFetch();
    const cache = createBoardCache({ fetchImpl: f.impl as unknown as typeof fetch, now: () => NOW });
    cache.ensure('zet', ['100_1']);
    cache.ensure('hz', ['100_1']);
    expect(f.calls).toEqual([url('100_1'), '/api/city/departures?operator=hz&stop=100_1']);
    await f.settle(url('100_1'), { ok: true, body: board('100_1') });
    expect(cache.get('zet', '100_1')).toBeDefined();
    expect(cache.get('hz', '100_1')).toBeUndefined();
  });

  it('escapes a stop id that is not URL-safe', () => {
    const f = fakeFetch();
    createBoardCache({ fetchImpl: f.impl as unknown as typeof fetch, now: () => NOW }).ensure('zet', ['Trg b/2']);
    expect(f.calls).toEqual(['/api/city/departures?operator=zet&stop=Trg%20b%2F2']);
  });

  it('stops dead once destroyed: no new request, and an answer already in flight is dropped', async () => {
    const f = fakeFetch();
    const cache = createBoardCache({ fetchImpl: f.impl as unknown as typeof fetch, now: () => NOW });
    const changed = vi.fn();
    cache.ensure('zet', ['100_1'], changed);
    cache.destroy();
    cache.ensure('zet', ['100_2'], changed);
    expect(f.calls).toEqual([url('100_1')]);
    await f.settle(url('100_1'), { ok: true, body: board('100_1') });
    expect(cache.get('zet', '100_1')).toBeUndefined();
    expect(changed).not.toHaveBeenCalled();
  });

  it('notifies every caller that asked for a platform, not just the first', async () => {
    const f = fakeFetch();
    const cache = createBoardCache({ fetchImpl: f.impl as unknown as typeof fetch, now: () => NOW });
    const sheet = vi.fn();
    const kiosk = vi.fn();
    // Two surfaces want the same platform while one request is in flight.
    cache.ensure('zet', ['100_1'], sheet);
    cache.ensure('zet', ['100_1'], kiosk);
    expect(f.calls).toEqual([url('100_1')]);
    await f.settle(url('100_1'), { ok: true, body: board('100_1') });
    expect(sheet).toHaveBeenCalledTimes(1);
    expect(kiosk).toHaveBeenCalledTimes(1);

    // The listeners are spent with the request: the next one notifies only who asks again.
    const later = createBoardCache({ fetchImpl: f.impl as unknown as typeof fetch, now: () => NOW });
    later.ensure('zet', ['100_2'], sheet);
    await f.settle(url('100_2'), { ok: true, body: board('100_2') });
    expect(sheet).toHaveBeenCalledTimes(2);
    expect(kiosk).toHaveBeenCalledTimes(1);
  });

  it('keeps the board it fetched when a listener throws, and does not fire twice', async () => {
    const f = fakeFetch();
    const cache = createBoardCache({ fetchImpl: f.impl as unknown as typeof fetch, now: () => NOW });
    const broken = vi.fn(() => { throw new Error('render blew up'); });
    const fine = vi.fn();
    cache.ensure('zet', ['100_1'], broken);
    cache.ensure('zet', ['100_1'], fine);
    await f.settle(url('100_1'), { ok: true, body: board('100_1') });
    // The good board stands: a render fault must never demote it to a placeholder.
    expect(cache.get('zet', '100_1')).toMatchObject({ stopId: '100_1', status: 'live' });
    expect(broken).toHaveBeenCalledTimes(1);
    // One surface's fault does not starve the other's callback.
    expect(fine).toHaveBeenCalledTimes(1);
    expect(f.calls).toHaveLength(1);
  });

  it('abandons a request at the timeout: the default one, and the one the caller set', () => {
    vi.useFakeTimers();
    const f = fakeFetch();
    createBoardCache({ fetchImpl: f.impl as unknown as typeof fetch, now: () => NOW }).ensure('zet', ['100_1']);
    const slow = f.impl.mock.calls[0][1].signal;
    expect(slow.aborted).toBe(false);
    vi.advanceTimersByTime(11_999);
    expect(slow.aborted).toBe(false);
    vi.advanceTimersByTime(1);
    expect(slow.aborted).toBe(true);

    createBoardCache({ fetchImpl: f.impl as unknown as typeof fetch, now: () => NOW, timeoutMs: 1_000 }).ensure('zet', ['100_2']);
    const quick = f.impl.mock.calls[1][1].signal;
    vi.advanceTimersByTime(999);
    expect(quick.aborted).toBe(false);
    vi.advanceTimersByTime(1);
    expect(quick.aborted).toBe(true);
  });

  it('stops the timeout clock once the answer is in, so a settled request leaves no timer behind', async () => {
    vi.useFakeTimers();
    const f = fakeFetch();
    const cache = createBoardCache({ fetchImpl: f.impl as unknown as typeof fetch, now: () => NOW });
    cache.ensure('zet', ['100_1']);
    const signal = f.impl.mock.calls[0][1].signal;
    await f.settle(url('100_1'), { ok: true, body: board('100_1') });
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(60_000);
    expect(signal.aborted).toBe(false);
  });

});
