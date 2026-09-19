import { describe, expect, it, vi } from 'vitest';
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
  const impl = vi.fn((url: string, init?: { signal?: AbortSignal }): Promise<Response> => {
    calls.push(url);
    return new Promise((resolve, reject) => {
      pending.set(url, (r) => {
        if (r.fail) reject(new Error('network'));
        else resolve({ ok: r.ok, json: async () => r.body, signal: init?.signal } as unknown as Response);
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

  it('gives every request a timeout signal, the caller\'s or the default', () => {
    const f = fakeFetch();
    createBoardCache({ fetchImpl: f.impl as unknown as typeof fetch, now: () => NOW, timeoutMs: 5_000 }).ensure('zet', ['100_1']);
    const init = f.impl.mock.calls[0][1]!;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});
