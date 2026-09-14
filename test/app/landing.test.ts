// @vitest-environment happy-dom
// The landing page's entry: the live strip from the open teaser and the
// footer's source line. Every dependency is injected; nothing here touches the
// network, and a missing source reads as unavailable, never as zero.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { ModuleSnapshot } from '../../worker/feed/schema';
import hr from '../../app/src/i18n/hr.json';
import en from '../../app/src/i18n/en.json';
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

describe('paintLiveStrip', () => {
  it('writes each line and its state into the strip, and unavailable on a failed fetch', async () => {
    document.body.innerHTML = '<ul><li><span data-live="weather">…</span></li><li><span data-live="safety">…</span></li><li><span data-live="transit">…</span></li></ul>';
    await paintLiveStrip({ root: document, fetchTeaser: async () => ({ modules: [observation({ temp: 21.4, weather: 'vedro' }), vehicles] }), now: () => NOW });
    expect(document.querySelector('[data-live=weather]')?.textContent).toBe('21,4 °C, vedro · izmjereno 19:00');
    expect(document.querySelector<HTMLElement>('[data-live=transit]')?.dataset.state).toBe('live');
    expect(document.querySelector<HTMLElement>('[data-live=safety]')?.dataset.state).toBe('unknown');
    await paintLiveStrip({ root: document, fetchTeaser: async () => { throw new Error('down'); }, now: () => NOW });
    expect(document.querySelector('[data-live=weather]')?.textContent).toBe('trenutačno nedostupno');
  });
});

// The footer line (T4.4): "Izvori u redu · 14:42" is an all-clear about the
// sources, so it is said only when the Worker answers and the teaser the strip
// painted from marks no source down; otherwise the line counts what is not
// answering, in the same words the shell uses.
describe('paintHealth', () => {
  const health = (body: unknown) => (async () => ({ json: async () => body })) as unknown as typeof fetch;
  const ok = health({ ok: true, version: '1.2.3', time: '2026-09-12T17:32:00.000Z' });
  it('says the sources are fine with the Worker clock when every source in the teaser answers', async () => {
    const el = document.createElement('p');
    await paintHealth({ el, fetchImpl: ok, now: () => NOW, sources: async () => [observation({ temp: 21 }), vehicles] });
    expect(el.textContent).toBe('Izvori u redu · 19:32');
  });
  it('counts the sources that are down instead of claiming an all-clear', async () => {
    const el = document.createElement('p');
    const down = (module: ModuleSnapshot['module']) => snap(module, [], { status: 'down' });
    await paintHealth({ el, fetchImpl: ok, now: () => NOW, sources: async () => [observation({ temp: 21 }), down('zet-rt')] });
    expect(el.textContent).toBe('1 izvor ne odgovara · 19:32');
    await paintHealth({ el, fetchImpl: ok, now: () => NOW, sources: async () => [down('zet-rt'), down('dhmz-cap'), down('emsc')] });
    expect(el.textContent).toBe('3 izvora ne odgovaraju · 19:32');
    await paintHealth({ el, fetchImpl: ok, now: () => NOW, sources: async () => [down('zet-rt'), down('dhmz-cap'), down('emsc'), down('prometnice'), down('hrt-news')] });
    expect(el.textContent).toBe('5 izvora ne odgovara · 19:32');
  });
  it('says the sources are unavailable when the teaser itself failed, uses the page clock without a Worker time, and names a server error or an unreachable server', async () => {
    const el = document.createElement('p');
    await paintHealth({ el, fetchImpl: ok, now: () => NOW, sources: async () => { throw new Error('down'); } });
    expect(el.textContent).toBe('Izvori trenutačno nedostupni · 19:32');
    await paintHealth({ el, fetchImpl: health({ ok: true }), now: () => NOW, sources: async () => [] });
    expect(el.textContent).toBe('Izvori u redu · 19:32');
    await paintHealth({ el, fetchImpl: health({ ok: false }), now: () => NOW, sources: async () => [] });
    expect(el.textContent).toBe('Poslužitelj javlja grešku');
    await paintHealth({ el, fetchImpl: (async () => { throw new Error('down'); }) as unknown as typeof fetch, now: () => NOW, sources: async () => [] });
    expect(el.textContent).toBe('Poslužitelj nije dostupan');
    const none = vi.fn();
    await paintHealth({ el: null, fetchImpl: none as unknown as typeof fetch, now: () => NOW, sources: async () => [] });
    expect(none).not.toHaveBeenCalled();
  });
});

// bootPage's translatePage rewrites every [data-i18n] node from the catalogue
// on the first boot, so the Croatian the HTML carries literally must be the
// Croatian the catalogue carries, or the page would change under the reader;
// and every key must have its English twin (the catalogue parity test holds
// the key sets equal, this holds the keys the landing names to real strings).
describe('the landing markup and the catalogue agree', () => {
  const html = readFileSync(join(import.meta.dirname, '..', '..', 'app', 'index.html'), 'utf8');
  // happy-dom fetches a parsed document's <link> and <script src>; the markup is what is under test, so both are stripped first.
  const doc = new DOMParser().parseFromString(html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<link[^>]*>/g, ''), 'text/html');
  const lookup = (catalogue: unknown, key: string): unknown => key.split('.').reduce<unknown>((node, part) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined), catalogue);
  it('every data-i18n node carries the hr catalogue text literally, and en has a string for it', () => {
    const nodes = [...doc.querySelectorAll('[data-i18n]')];
    expect(nodes.length).toBeGreaterThan(10);
    for (const node of nodes) {
      const key = node.getAttribute('data-i18n')!;
      expect(lookup(hr, key), key).toBe(node.textContent);
      expect(typeof lookup(en, key), key).toBe('string');
    }
  });
  it('every data-i18n-aria-label node carries the hr catalogue label literally, and en has a string for it', () => {
    const nodes = [...doc.querySelectorAll('[data-i18n-aria-label]')];
    expect(nodes.length).toBeGreaterThan(0);
    for (const node of nodes) {
      const key = node.getAttribute('data-i18n-aria-label')!;
      expect(lookup(hr, key), key).toBe(node.getAttribute('aria-label'));
      expect(typeof lookup(en, key), key).toBe('string');
    }
  });
  it('every landing string is a whole sentence or label, never a fragment that opens with punctuation or a space', () => {
    const leaves = (node: unknown): string[] => (typeof node === 'string' ? [node] : Object.values(node as Record<string, unknown>).flatMap(leaves));
    for (const catalogue of [hr.landing, en.landing]) for (const s of leaves(catalogue)) expect(s, s).toMatch(/^[\p{L}\p{N}]/u);
  });
  it('the page names the primary action, the h1 and the lead from the landing namespace, and the wordmark label from the shell', () => {
    expect(doc.querySelector('[data-testid=cta-scan]')?.getAttribute('data-i18n')).toBe('landing.actions.scan');
    expect(doc.querySelector('h1')?.getAttribute('data-i18n')).toBe('landing.title');
    expect(doc.querySelector('.ld-lead')?.getAttribute('data-i18n')).toBe('landing.lead');
    expect(doc.querySelector('.ki-wordmark')?.getAttribute('data-i18n-aria-label')).toBe('shell.wordmarkLabel');
    expect(hr.landing.actions.scan).toBe('Skeniraj ili upiši kod');
    expect(hr.landing.actions.kiosk).toBe('Otvori gradski zaslon');
    expect(hr.landing.title).toBe('Deset minuta grada na tvom uređaju.');
  });
});
