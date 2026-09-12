import { describe, expect, it } from 'vitest';
import { expireStaleSources, recoverPartialSources } from '../../worker/feed/source-recovery';
import type { ModuleSnapshot } from '../../worker/feed/schema';

const now = Date.parse('2026-09-12T12:00:00Z');
const previous: ModuleSnapshot = {
  module: 'hrt-news', tier: 'session', status: 'live', fetchedAt: '2026-09-12T11:00:00Z',
  attribution: { text: 'HRT', url: 'https://hrt.hr', licence: 'HRT' },
  items: [{ id: 'old', module: 'hrt-news', tier: 'session', kind: 'news', title: 'Saved title', at: '2026-09-11T08:00:00Z', data: { source: 'Radio Sljeme' } }],
  sources: { 'Radio Sljeme': { status: 'live', itemCount: 1, totalItems: 1, fetchedAt: '2026-09-12T11:00:00Z' } },
};
const fresh: ModuleSnapshot = {
  ...previous, status: 'stale', fetchedAt: '2026-09-12T12:00:00Z', items: [],
  sources: { 'Radio Sljeme': { status: 'down', itemCount: 0 }, 'HRT vijesti': { status: 'live', itemCount: 0, totalItems: 0, fetchedAt: '2026-09-12T12:00:00Z' } },
};

describe('independent source resilience', () => {
  it('recovers last-good rows without moving their publication or fetch date', () => {
    const recovered = recoverPartialSources(fresh, previous, now, 7200);
    expect(recovered.items).toEqual(previous.items);
    expect(recovered.sources?.['Radio Sljeme']).toMatchObject({ status: 'stale', fetchedAt: '2026-09-12T11:00:00Z' });
    expect(recovered.sources?.['HRT vijesti'].status).toBe('live');
    expect(recovered.coverage?.limited).toBe(true);
  });
  it('never treats a successful empty source as failed', () => {
    const empty = { ...fresh, sources: { 'Radio Sljeme': { status: 'live' as const, itemCount: 0, totalItems: 0 } } };
    expect(recoverPartialSources(empty, previous, now, 7200).items).toEqual([]);
  });
  it('expires recovered rows independently of the composite fetch timestamp', () => {
    const recovered = recoverPartialSources(fresh, previous, now, 7200);
    const expired = expireStaleSources({ ...recovered, fetchedAt: new Date(now + 7200_000).toISOString() }, now + 7200_000, 7200);
    expect(expired.items).toEqual([]);
    expect(expired.sources?.['Radio Sljeme']).toEqual({ status: 'down', itemCount: 0 });
    expect(expired.sources?.['HRT vijesti'].status).toBe('live');
  });
});
