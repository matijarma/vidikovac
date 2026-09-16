import { describe, expect, it } from 'vitest';
import { expireStaleSources, recoverPartialSources } from '../../worker/feed/source-recovery';
import type { ModuleSnapshot } from '../../worker/feed/schema';

const now = Date.parse('2026-09-12T12:00:00Z');
const previous: ModuleSnapshot = {
  module: 'ckan-geo', tier: 'open', status: 'live', fetchedAt: '2026-09-12T11:00:00Z',
  attribution: { text: 'Grad Zagreb', url: 'https://data.zagreb.hr', licence: 'Otvorena dozvola' },
  items: [{ id: 'old', module: 'ckan-geo', tier: 'open', kind: 'poi', title: 'Saved title', at: '2026-09-11T08:00:00Z', data: { layer: 'zborna-mjesta' } }],
  sources: { 'zborna-mjesta': { status: 'live', itemCount: 1, totalItems: 1, fetchedAt: '2026-09-12T11:00:00Z' } },
};
const fresh: ModuleSnapshot = {
  ...previous, status: 'stale', fetchedAt: '2026-09-12T12:00:00Z', items: [],
  sources: { 'zborna-mjesta': { status: 'down', itemCount: 0 }, 'gradske-cetvrti': { status: 'live', itemCount: 0, totalItems: 0, fetchedAt: '2026-09-12T12:00:00Z' } },
};

describe('independent source resilience', () => {
  it('recovers last-good rows without moving their publication or fetch date', () => {
    const recovered = recoverPartialSources(fresh, previous, now, 7200);
    expect(recovered.items).toEqual(previous.items);
    expect(recovered.sources?.['zborna-mjesta']).toMatchObject({ status: 'stale', fetchedAt: '2026-09-12T11:00:00Z' });
    expect(recovered.sources?.['gradske-cetvrti'].status).toBe('live');
    expect(recovered.coverage?.limited).toBe(true);
  });
  it('never treats a successful empty source as failed', () => {
    const empty = { ...fresh, sources: { 'zborna-mjesta': { status: 'live' as const, itemCount: 0, totalItems: 0 } } };
    expect(recoverPartialSources(empty, previous, now, 7200).items).toEqual([]);
  });
  it('expires recovered rows independently of the composite fetch timestamp', () => {
    const recovered = recoverPartialSources(fresh, previous, now, 7200);
    const expired = expireStaleSources({ ...recovered, fetchedAt: new Date(now + 7200_000).toISOString() }, now + 7200_000, 7200);
    expect(expired.items).toEqual([]);
    expect(expired.sources?.['zborna-mjesta']).toEqual({ status: 'down', itemCount: 0 });
    expect(expired.sources?.['gradske-cetvrti'].status).toBe('live');
  });
});
