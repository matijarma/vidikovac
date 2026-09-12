import { describe, expect, it, vi } from 'vitest';
import { createFeedStore } from '../../app/src/core/feed-store';
import { createViewStore } from '../../app/src/core/view-store';
import { parseSelection, publicItemKey, selectionParams } from '../../worker/public-selection';
import type { ModuleSnapshot } from '../../worker/feed/schema';

const weather: ModuleSnapshot = {
  module: 'dhmz-now', tier: 'session', status: 'live', fetchedAt: '2026-09-12T12:00:00Z',
  attribution: { text: 'DHMZ', url: 'https://meteo.hr', licence: 'OD' }, items: [],
};

describe('public selection', () => {
  it('bounds arbitrary source ids without embedding their URL or search text', () => {
    const key = publicItemKey('hrt-news', 'https://example.org/news/123');
    expect(key).toMatch(/^[a-f0-9]{16}$/);
    expect(key).toBe(publicItemKey('hrt-news', 'https://example.org/news/123'));
    expect(key).not.toBe(publicItemKey('dogadanja', 'https://example.org/news/123'));
    const selection = { kind: 'item' as const, module: 'hrt-news' as const, id: key };
    expect(parseSelection(selectionParams(selection))).toEqual(selection);
  });
  it('rejects private and unknown params', () => {
    expect(parseSelection({ kind: 'stop', id: '106_1' })).toEqual({ kind: 'stop', id: '106_1' });
    expect(parseSelection({ kind: 'route', id: '6', lat: '45.8' })).toBeNull();
    expect(parseSelection({ kind: 'route', id: 'https://bad' })).toBeNull();
    expect(parseSelection({ kind: 'item', id: '0000000000000000', module: 'unknown' })).toBeNull();
  });
});

describe('feed store', () => {
  it('keeps last-good data but makes failures explicit and clears them on recovery', async () => {
    const fetchData = vi.fn().mockResolvedValueOnce(weather).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(weather);
    const store = createFeedStore({ fetchData, token: () => 'test', now: () => 1 });
    store.setModules(['dhmz-now']);
    await store.refresh();
    expect(store.snapshot().snapshots['dhmz-now']?.status).toBe('live');
    await store.refresh();
    expect(store.snapshot().snapshots['dhmz-now']?.status).toBe('stale');
    expect(store.snapshot().errors['dhmz-now']).toBe('offline');
    await store.refresh();
    expect(store.snapshot().errors['dhmz-now']).toBeUndefined();
    expect(store.snapshot().snapshots['dhmz-now']?.status).toBe('live');
  });
  it('does not repaint a paused or expired view with a late response', async () => {
    let resolve!: (v: ModuleSnapshot) => void;
    const store = createFeedStore({ token: () => 'test', fetchData: () => new Promise((r) => { resolve = r; }) });
    const request = store.refresh(['dhmz-now']);
    store.pause(true);
    resolve(weather);
    await request;
    expect(store.snapshot().snapshots['dhmz-now']).toBeUndefined();
  });
});

describe('view store', () => {
  it('retains per-layer filters, excludes private searches from history and strips tickets', () => {
    const history = { pushState: vi.fn(), replaceState: vi.fn() };
    const store = createViewStore({ history, location: { pathname: '/d/', search: '', hash: '#room=R&ticket=secret' } });
    store.setFilter('search', 'my private address');
    store.navigate('kultura');
    store.navigate('grad-sada', { kind: 'route', id: '6' });
    expect(store.snapshot().filters.search).toBe('my private address');
    const url = history.pushState.mock.calls.at(-1)?.[2];
    expect(url).toContain('room=R');
    expect(url).toContain('kind=route');
    expect(url).not.toContain('secret');
    expect(url).not.toContain('private');
  });
});
