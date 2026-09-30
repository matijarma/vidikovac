// Lane tab-return (30 Sep): the page coming back into view. The helper that hears it (core/page-return.ts), the city
// store asking for the live stations at once on a return, and the BAJS counts standing while that answer is on its way
// (city/discovery.ts dynamicPlaces) -- the owner's "when i return to tab they all show as white and empty".
import { afterEach, describe, expect, it, vi } from 'vitest';
import { watchPageReturn } from '../../app/src/core/page-return';
import { createCityStore } from '../../app/src/core/city-store';
import { BIKE_COUNT_TTL_MS, dynamicPlaces } from '../../app/src/city/discovery';
import type { CityLive } from '../../shared/city/types';

const NOW = Date.parse('2026-09-30T12:00:00Z');

/** A document and a window whose visibility a test flips; `hidden` is what the store's own interval reads. */
function fakePage(now: () => number = Date.now) {
  const docListeners = new Set<() => void>();
  const winListeners = new Set<(event: { persisted?: boolean }) => void>();
  const doc = {
    visibilityState: 'visible',
    get hidden() { return this.visibilityState === 'hidden'; },
    addEventListener: (_type: string, fn: () => void) => { docListeners.add(fn); },
    removeEventListener: (_type: string, fn: () => void) => { docListeners.delete(fn); },
  };
  const win = {
    addEventListener: (_type: string, fn: (event: { persisted?: boolean }) => void) => { winListeners.add(fn); },
    removeEventListener: (_type: string, fn: (event: { persisted?: boolean }) => void) => { winListeners.delete(fn); },
  };
  const flip = (state: string) => { doc.visibilityState = state; for (const fn of [...docListeners]) fn(); };
  return {
    doc, win, lifecycle: { doc, win, now },
    leave: () => flip('hidden'), come: () => flip('visible'),
    pageshow: (persisted: boolean) => { for (const fn of [...winListeners]) fn({ persisted }); },
    listening: () => docListeners.size + winListeners.size,
  };
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('watchPageReturn', () => {
  it('says how long the page was away, once per return, and a bfcache restore as an unknown (infinite) away', () => {
    let t = 0;
    const page = fakePage(() => t);
    const shows: number[] = [];
    const hides: number[] = [];
    const stop = watchPageReturn({ hide: () => hides.push(t), show: (away) => shows.push(away) }, page.lifecycle);
    page.come(); // visible without having been hidden: nothing came back
    page.leave();
    t = 42_000;
    page.leave(); // a second hidden event is the same absence
    page.come();
    page.pageshow(false); // an ordinary load
    page.pageshow(true);
    expect(hides).toEqual([0]);
    expect(shows).toEqual([42_000, Infinity]);
    stop();
    expect(page.listening()).toBe(0);
  });

  it('listens to nothing without a document or a window', () => {
    const show = vi.fn();
    const stop = watchPageReturn({ show }, { doc: null, win: null });
    stop();
    expect(show).not.toHaveBeenCalled();
  });
});

describe('the BAJS counts across a return (city store and dynamicPlaces)', () => {
  const station = { id: 'trg', name: 'BAJS Trg', lon: 15.978, lat: 45.814, bikes: 4, docks: 0, capacity: 4, installed: true, renting: true, returning: true };
  const liveAt = (at: number, bikes = 4): CityLive => ({
    schema: 1, generatedAt: new Date(at).toISOString(), bikes: [{ ...station, bikes, observedAt: new Date(at).toISOString() }], air: [], consultations: [],
    sources: [{ id: 'bajs', name: 'BAJS', url: 'https://example.test', licence: 'test', status: 'live', count: 1, fetchedAt: new Date(at).toISOString() }],
  });
  /** The store with a scripted /api/city/live: `hold()` keeps the next answer on its way until `release()` (or `fail()`). */
  function scripted() {
    const liveCalls: number[] = [];
    let gate: { resolve: (r: Response) => void; reject: (e: Error) => void } | null = null;
    let holdNext = false;
    let bikes = 4;
    const fetcher = vi.fn(async (url: RequestInfo | URL) => {
      const path = String(url);
      if (path.endsWith('/manifest')) return Response.json({ schema: 1, version: 'test', generatedAt: new Date(NOW).toISOString(), sources: [] });
      if (!path.endsWith('/live')) return Response.json({});
      liveCalls.push(Date.now());
      if (!holdNext) return Response.json(liveAt(Date.now(), bikes));
      holdNext = false;
      return new Promise<Response>((resolve, reject) => { gate = { resolve, reject }; });
    });
    return {
      fetcher, liveCalls,
      hold: () => { holdNext = true; },
      release: (count: number) => { bikes = count; gate?.resolve(Response.json(liveAt(Date.now(), count))); gate = null; },
      fail: () => { gate?.reject(new Error('offline')); gate = null; },
    };
  }
  const count = (store: ReturnType<typeof createCityStore>) => dynamicPlaces(store.snapshot(), Date.now()).find((p) => p.sourceId === 'bajs')!.facts!.bikes;

  it('asks at once when the page is seen again, keeps the count in hand while that answer is on its way, and beats the minute from it', async () => {
    vi.useFakeTimers({ now: NOW });
    const page = fakePage();
    vi.stubGlobal('document', page.doc); // what the store's own interval reads
    const live = scripted();
    const store = createCityStore(live.fetcher as typeof fetch, page.lifecycle);
    await store.start();
    expect(live.liveCalls).toHaveLength(1);
    expect(count(store)).toBe(4);
    page.leave();
    await vi.advanceTimersByTimeAsync(5 * 60_000); // five minutes in another tab: the minute's poll asks nothing
    expect(live.liveCalls).toHaveLength(1);
    expect(store.snapshot().liveAwaited).toBe(true);
    expect(count(store)).toBe(4); // the reading stands while the page is away: it asks again on its return
    live.hold();
    page.come();
    expect(live.liveCalls).toHaveLength(2); // at once, not on the next tick up to a minute later
    expect(store.snapshot().liveAwaited).toBe(true);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(count(store)).toBe(4); // five minutes old, and the answer that replaces it is on its way: never blank
    live.release(7);
    await vi.advanceTimersByTimeAsync(0);
    expect(store.snapshot().liveAwaited).toBe(false);
    expect(count(store)).toBe(7);
    // The minute is counted from the return's answer, not from the old interval's phase.
    await vi.advanceTimersByTimeAsync(57_000);
    expect(live.liveCalls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(live.liveCalls).toHaveLength(3);
    store.destroy();
    expect(page.listening()).toBe(0);
  });

  it('keeps unknown for the genuinely unknown: an old count with nothing awaited, and a five-minute-old count once the return\'s request failed', async () => {
    vi.useFakeTimers({ now: NOW });
    const page = fakePage();
    vi.stubGlobal('document', page.doc);
    const live = scripted();
    const store = createCityStore(live.fetcher as typeof fetch, page.lifecycle);
    await store.start();
    // Visible, nothing in flight, the reading past its three minutes (a source gone quiet): unknown.
    const aged = { ...store.snapshot(), liveAwaited: false };
    expect(dynamicPlaces(aged, NOW + BIKE_COUNT_TTL_MS + 1_000).find((p) => p.sourceId === 'bajs')!.facts!.bikes).toBe('?');
    page.leave();
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    live.hold();
    page.come();
    live.fail();
    await vi.advanceTimersByTimeAsync(0);
    expect(store.snapshot().liveAwaited).toBe(false);
    expect(count(store)).toBe('?');
    store.destroy();
  });

  it('a failed poll blanks nothing at once: the counts in hand stand until their own reading is three minutes old', async () => {
    vi.useFakeTimers({ now: NOW });
    const page = fakePage();
    vi.stubGlobal('document', page.doc);
    const live = scripted();
    const store = createCityStore(live.fetcher as typeof fetch, page.lifecycle);
    await store.start();
    expect(count(store)).toBe(4);
    await vi.advanceTimersByTimeAsync(59_000);
    live.hold();
    await vi.advanceTimersByTimeAsync(1_000); // the minute's poll goes out
    live.fail(); // and fails: the network dropped, the Worker did not answer
    await vi.advanceTimersByTimeAsync(0);
    expect(store.snapshot().errors).toContain('live');
    expect(store.snapshot().live!.sources.find((s) => s.id === 'bajs')!.status).toBe('stale'); // said as it is
    expect(count(store)).toBe(4); // the last reading, a minute old, still stands
    // Only its own three minutes blank it: the reading was taken at NOW.
    const at = (t: number) => dynamicPlaces(store.snapshot(), t).find((p) => p.sourceId === 'bajs')!.facts!.bikes;
    expect(at(NOW + BIKE_COUNT_TTL_MS)).toBe(4);
    expect(at(NOW + BIKE_COUNT_TTL_MS + 1)).toBe('?');
    store.destroy();
  });

  it('costs no request for a glance at another tab, and none while paused', async () => {
    vi.useFakeTimers({ now: NOW });
    const page = fakePage();
    vi.stubGlobal('document', page.doc);
    const live = scripted();
    const store = createCityStore(live.fetcher as typeof fetch, page.lifecycle);
    await store.start();
    page.leave();
    await vi.advanceTimersByTimeAsync(4_000);
    page.come();
    expect(live.liveCalls).toHaveLength(1);
    expect(store.snapshot().liveAwaited).toBe(false);
    store.pause();
    page.leave();
    await vi.advanceTimersByTimeAsync(120_000);
    page.come();
    expect(live.liveCalls).toHaveLength(1);
    store.destroy();
  });
});
