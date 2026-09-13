// @vitest-environment happy-dom
// The landing page's entry: the live strip from the open teaser and the
// Worker health line. Every dependency is injected; nothing here touches the
// network, and a missing source reads as unavailable, never as zero.
import { describe, expect, it, vi } from 'vitest';
import type { ModuleSnapshot } from '../../worker/feed/schema';
import { liveStripTexts, paintHealth, paintLiveStrip } from '../../app/src/entries/landing';

const NOW = Date.parse('2026-09-12T17:32:00Z'); // 19:32 in Zagreb
const attr = { text: 'Izvor', url: 'https://example.test/', licence: 'Otvorena dozvola (NN 67/17)' };
const snap = (module: ModuleSnapshot['module'], items: ModuleSnapshot['items'], over: Partial<ModuleSnapshot> = {}): ModuleSnapshot =>
  ({ module, tier: 'open', status: 'live', fetchedAt: new Date(NOW).toISOString(), attribution: attr, items, ...over });
const observation = (data: Record<string, string | number>) => snap('dhmz-now', [{ id: 'o', module: 'dhmz-now', kind: 'observation', tier: 'open', title: 'Zagreb-Maksimir', at: '2026-09-12T17:00:00Z', data }]);
const vehicles = snap('zet-rt', [{ id: 'vozila', module: 'zet-rt', kind: 'vehicle', tier: 'open', title: '214 vozila', data: { vehicles: 214 } }], { sourceUpdatedAt: '2026-09-12T17:31:00Z' });

describe('liveStripTexts', () => {
  it('reads the measured temperature and condition with the observation time, and drops a dash condition', () => {
    const { weather } = liveStripTexts([observation({ temp: 21.4, weather: 'vedro' })], NOW);
    expect(weather).toEqual({ text: '21,4 °C, vedro · izmjereno 19:00', state: 'live' });
    expect(liveStripTexts([observation({ temp: 18, weather: '-' })], NOW).weather.text).toBe('18 °C · izmjereno 19:00');
  });
  it('is unavailable, never zero, when a source is missing or down', () => {
    const texts = liveStripTexts([], NOW);
    expect(texts.weather.state).toBe('unknown');
    expect(texts.transit.state).toBe('unknown');
    expect(texts.safety.state).toBe('unknown');
    expect(liveStripTexts([snap('zet-rt', [], { status: 'down' })], NOW).transit.state).toBe('unknown');
  });
  it('claims no warnings only from a live CAP source, and counts open closures beside it', () => {
    const cap = snap('dhmz-cap', []);
    const roads = snap('prometnice', [{ id: 'c', module: 'prometnice', kind: 'closure', tier: 'open', title: 'Ilica' }]);
    expect(liveStripTexts([cap, roads], NOW).safety).toEqual({ text: 'Nema upozorenja DHMZ-a, 1 zatvorena prometnica', state: 'live' });
    const stale = snap('dhmz-cap', [], { status: 'stale' });
    expect(liveStripTexts([stale, roads], NOW).safety.state).toBe('unknown');
    const active = snap('dhmz-cap', [{ id: 'w', module: 'dhmz-cap', kind: 'warning', tier: 'open', title: 'Vjetar', severity: 'moderate', at: '2026-09-12T06:00:00Z', until: '2026-09-12T22:00:00Z' }]);
    expect(liveStripTexts([active], NOW).safety).toEqual({ text: '1 upozorenje DHMZ-a na snazi', state: 'urgent' });
  });
  it('counts vehicles moving with the feed time', () => {
    expect(liveStripTexts([vehicles], NOW).transit).toEqual({ text: '214 vozila u pokretu · 19:31', state: 'live' });
  });
});

describe('paintLiveStrip and paintHealth', () => {
  it('writes each line and its state into the strip, and unavailable on a failed fetch', async () => {
    document.body.innerHTML = '<ul><li><span data-live="weather">…</span></li><li><span data-live="safety">…</span></li><li><span data-live="transit">…</span></li></ul>';
    await paintLiveStrip({ root: document, fetchTeaser: async () => ({ modules: [observation({ temp: 21.4, weather: 'vedro' }), vehicles] }), now: () => NOW });
    expect(document.querySelector('[data-live=weather]')?.textContent).toBe('21,4 °C, vedro · izmjereno 19:00');
    expect(document.querySelector<HTMLElement>('[data-live=transit]')?.dataset.state).toBe('live');
    expect(document.querySelector<HTMLElement>('[data-live=safety]')?.dataset.state).toBe('unknown');
    await paintLiveStrip({ root: document, fetchTeaser: async () => { throw new Error('down'); }, now: () => NOW });
    expect(document.querySelector('[data-live=weather]')?.textContent).toBe('trenutačno nedostupno');
  });
  it('shows the worker version and time, greška on a non-ok body, nedostupno when the fetch throws', async () => {
    const el = document.createElement('code');
    await paintHealth({ el, fetchImpl: (async () => ({ json: async () => ({ ok: true, version: '1.2.3', time: '2026-09-12T17:32:00.000Z' }) })) as unknown as typeof fetch, now: () => NOW });
    expect(el.textContent).toBe('worker 1.2.3 · 19:32');
    await paintHealth({ el, fetchImpl: (async () => ({ json: async () => ({ ok: false }) })) as unknown as typeof fetch, now: () => NOW });
    expect(el.textContent).toBe('greška');
    await paintHealth({ el, fetchImpl: (async () => { throw new Error('down'); }) as unknown as typeof fetch, now: () => NOW });
    expect(el.textContent).toBe('nedostupno');
    const none = vi.fn();
    await paintHealth({ el: null, fetchImpl: none as unknown as typeof fetch, now: () => NOW });
    expect(none).not.toHaveBeenCalled();
  });
});
