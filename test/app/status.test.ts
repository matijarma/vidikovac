// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import type { ModuleSnapshot } from '../../worker/feed/schema';
import { createDefaultI18n } from '../../app/src/i18n/create-default-i18n';
import { coverageText, listState, statusBadge, statusLine } from '../../app/src/experience/status';

const NOW = Date.parse('2026-09-11T12:32:00Z');
const attr = { text: 'Izvor: DHMZ, Otvorena dozvola, {vrijeme}', url: 'https://example.test/', licence: 'Otvorena dozvola (NN 67/17)' };
const snap = (over: Partial<ModuleSnapshot> = {}): ModuleSnapshot =>
  ({ module: 'dhmz-now', tier: 'open', status: 'live', fetchedAt: new Date(NOW - 60_000).toISOString(), attribution: attr, items: [], ...over });
const hr = createDefaultI18n('hr');
const text = (html: string): string => { const el = document.createElement('div'); el.innerHTML = html; return (el.textContent ?? '').replace(/\s+/g, ' ').trim(); };

describe('statusBadge', () => {
  it('shows no pill for a live source: a successful fetch is neither freshness nor an observation time', () => {
    expect(statusBadge(hr, snap({ sourceUpdatedAt: '2026-09-11T10:00:00Z' }))).toBe('');
  });
  it('names reference material as such instead of calling a gazette live', () => {
    expect(text(statusBadge(hr, snap({ module: 'glasnik' })))).toBe('Referenca');
    expect(text(statusBadge(hr, snap({ module: 'ckan-geo' })))).toBe('Referenca');
  });
  it('names the moment a stale copy stopped being confirmed, and says unavailable when down', () => {
    expect(text(statusBadge(hr, snap({ status: 'stale', staleSince: '2026-09-11T12:00:00Z' })))).toBe('zastarjelo od 14:00');
    expect(text(statusBadge(hr, snap({ status: 'down' })))).toBe('izvor nedostupan');
    expect(text(statusBadge(hr, undefined))).toBe('učitavanje podataka');
    expect(text(statusBadge(hr, undefined, 'request-failed'))).toBe('izvor nedostupan');
  });
});

describe('statusLine', () => {
  it('uses the source’s own time when it has one and says fetched otherwise', () => {
    expect(statusLine(hr, snap({ sourceUpdatedAt: '2026-09-11T12:30:00Z' }))).toBe('podaci od 14:30');
    expect(statusLine(hr, snap())).toBe('dohvaćeno 14:31');
    expect(statusLine(hr, snap({ status: 'stale', sourceUpdatedAt: '2026-09-11T12:30:00Z', sources: { 'HRT vijesti': { status: 'down', itemCount: 0 } } }))).toBe('podaci od 14:30 · izvor trenutačno ne odgovara · Ne odgovara: HRT vijesti');
  });
});

describe('listState and coverage', () => {
  it('distinguishes loading, unavailable with retry, a stale empty list, and a confirmed empty list', () => {
    expect(text(listState(hr, undefined, 'emsc', 0, 'Nema.'))).toBe('učitavanje podataka');
    expect(listState(hr, undefined, 'emsc', 0, 'Nema.', 'boom')).toContain('data-action="retry"');
    expect(listState(hr, snap({ status: 'stale' }), 'emsc', 0, 'Nema.')).toContain('Stanje nije potvrđeno');
    expect(text(listState(hr, snap(), 'emsc', 0, 'Nema.'))).toBe('Nema. Potvrđeno 14:31.');
    expect(listState(hr, snap(), 'emsc', 3, 'Nema.')).toBe('');
  });
  it('states coverage only when the shown set is a limited part of the dataset', () => {
    expect(coverageText(hr, snap())).toBe('');
    expect(coverageText(hr, snap({ coverage: { shown: 40, total: 700, limited: true } }))).toBe('prikazano 40 od 700');
    expect(coverageText(hr, snap({ coverage: { shown: 40, limited: true } }))).toBe('prikazano 40');
  });
});
