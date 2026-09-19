import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBoardCache } from '../../app/src/city/boards';
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
