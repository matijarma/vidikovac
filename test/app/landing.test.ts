// @vitest-environment happy-dom
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ModuleSnapshot } from '../../worker/feed/schema';
import hr from '../../app/src/i18n/hr.json';
import en from '../../app/src/i18n/en.json';
import { createDefaultI18n } from '../../app/src/i18n/create-default-i18n';
import { LIVE_INTERVAL_MS, liveStripTexts, mergeLiveSources, mountLandingLive, sourceFreshness } from '../../app/src/landing/live';
import { chapterAtLine } from '../../app/src/landing/story';
import { syncCaptureImages, watchCaptureErrors } from '../../app/src/landing/images';

const NOW = Date.parse('2026-09-16T12:00:00Z');
const root = join(import.meta.dirname, '../..');
const snapshot = (module: ModuleSnapshot['module'], items: ModuleSnapshot['items'] = [], overrides: Partial<ModuleSnapshot> = {}): ModuleSnapshot => ({
  module, tier: 'open', status: 'live', fetchedAt: new Date(NOW).toISOString(),
  attribution: { text: 'Source', url: 'https://example.test', licence: 'Open' },
  items, ...overrides,
});
const observation = snapshot('dhmz-now', [{ id: 'weather', module: 'dhmz-now', tier: 'open', kind: 'observation', title: 'Maksimir', at: '2026-09-16T11:00:00Z', data: { temp: 21.4 } }]);
const transit = snapshot('zet-rt', [{ id: 'vozila', module: 'zet-rt', tier: 'open', kind: 'vehicle', title: '', data: { vehicles: 12 } }], { sourceUpdatedAt: '2026-09-16T11:59:00Z' });
const cap = snapshot('dhmz-cap');
const warning = snapshot('dhmz-cap', [{ id: 'wind', module: 'dhmz-cap', kind: 'warning', tier: 'open', title: 'Vjetar', at: '2026-09-16T10:00:00Z', until: '2026-09-16T20:00:00Z', severity: 'moderate' }]);
const modules = [observation, transit, cap];
const i18n = createDefaultI18n('hr');

afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ''; });

describe('landing facts: freshness is not severity', () => {
  it('renders a finite measurement with its observation time, not the fetch time', () => {
    const weather = liveStripTexts(modules, NOW, i18n).weather;
    expect(weather.text).toBe('21,4 °C');
    expect(weather.detail).toContain('Izmjereno');
    expect(weather.detail).toContain('13:00');
    expect(weather.detail).not.toContain('14:00');
    expect(weather.freshness).toBe('live');
  });
  it('uses fetch wording, never observation wording, when the source has no observation timestamp', () => {
    const noTime = { ...observation, items: observation.items.map((item) => ({ ...item, at: undefined })) };
    const weather = liveStripTexts([noTime], NOW, i18n).weather;
    expect(weather.detail).toContain('Dohvaćeno');
    expect(weather.detail).not.toContain('Izmjereno');
  });
  it('rejects non-finite weather values and never substitutes zero for unavailable data', () => {
    const bad = { ...observation, items: observation.items.map((item) => ({ ...item, data: { temp: NaN } })) };
    expect(liveStripTexts([bad], NOW, i18n).weather.freshness).toBe('down');
    for (const line of Object.values(liveStripTexts([], NOW, i18n))) {
      expect(line.freshness).toBe('down');
      expect(line.text).not.toMatch(/^0/);
    }
    expect(liveStripTexts([], NOW, i18n).safety.text).toBe('Stanje nije potvrđeno');
  });
  it('counts the vehicles in the public view without claiming a citywide total or arrivals', () => {
    const line = liveStripTexts(modules, NOW, i18n).transit;
    expect(line.text).toBe('12 vozila u prikazu');
    expect(line.detail).toContain('13:59');
    expect(line.detail).toContain('Podatak od');
  });
  it('marks a responding twin with a stale upstream as stale', () => {
    const stale = { ...transit, sources: { zet: { status: 'stale' as const, itemCount: 12 } } };
    expect(sourceFreshness(stale)).toBe('stale');
    expect(liveStripTexts([stale], NOW, i18n).transit.freshness).toBe('stale');
  });
  it('permits no-active-warning wording only from a live source', () => {
    expect(liveStripTexts([cap], NOW, i18n).safety.text).toBe('Nema aktivnih upozorenja');
    expect(liveStripTexts([{ ...cap, status: 'stale' }], NOW, i18n).safety.text).toBe('Stanje nije potvrđeno');
    expect(liveStripTexts([{ ...cap, status: 'down' }], NOW, i18n).safety.text).toBe('Stanje nije potvrđeno');
  });
  it('keeps active warning severity separate from freshness, with explicit stale wording', () => {
    expect(liveStripTexts([warning], NOW, i18n).safety).toMatchObject({ text: '1 aktivno upozorenje', severity: 'warning', freshness: 'live' });
    expect(liveStripTexts([{ ...warning, status: 'stale' }], NOW, i18n).safety).toMatchObject({ text: '1 upozorenje u posljednjem podatku', severity: 'warning', freshness: 'stale' });
  });
  it('handles future, expired and invalid warning dates without a false all-clear', () => {
    const future = { ...warning, items: warning.items.map((item) => ({ ...item, at: '2026-09-17T00:00:00Z' })) };
    const invalid = { ...warning, items: warning.items.map((item) => ({ ...item, until: 'not-a-date' })) };
    expect(liveStripTexts([future], NOW, i18n).safety.text).toBe('Nema aktivnih upozorenja');
    expect(liveStripTexts([warning], NOW + 86_400_000, i18n).safety.text).toBe('Nema aktivnih upozorenja');
    expect(liveStripTexts([invalid], NOW, i18n).safety).toMatchObject({ text: 'Stanje nije potvrđeno', freshness: 'stale' });
  });
  it('localizes all generated values, statuses and plural forms', () => {
    const english = liveStripTexts([observation, transit, warning], NOW, createDefaultI18n('en'));
    expect(english.weather.text).toBe('21.4 °C');
    expect(english.weather.detail).toContain('Measured');
    expect(english.transit.text).toBe('12 vehicles in this view');
    expect(english.safety.text).toBe('1 active warning');
  });
  it('holds last-good data on failed or omitted sources, and recovers independently', () => {
    const lost = mergeLiveSources(modules, [{ ...cap, status: 'down' }], NOW + 1000);
    expect(lost).toHaveLength(3);
    expect(lost.every((s) => s.status === 'stale')).toBe(true);
    expect(liveStripTexts(lost, NOW, i18n).weather.text).toBe('21,4 °C');
    expect(liveStripTexts(lost, NOW, i18n).safety.text).toBe('Stanje nije potvrđeno');
    const restored = mergeLiveSources(lost, [observation], NOW + 2000);
    expect(restored.find((s) => s.module === 'dhmz-now')?.status).toBe('live');
    expect(restored.find((s) => s.module === 'zet-rt')?.status).toBe('stale');
  });
});

function liveHarness() {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  document.body.innerHTML = `<section>${['weather', 'transit', 'safety'].map((key) =>
    `<strong data-live="${key}"></strong><span data-live-detail="${key}"></span><span data-live-state="${key}"></span>`).join('')}
    <button data-live-refresh hidden></button><p id="health"></p></section>`;
  const lang = createDefaultI18n('hr');
  const fetchTeaser = vi.fn(async () => ({ modules }));
  const fetchHealth = vi.fn(async () => ({ ok: true, time: new Date(NOW).toISOString() }));
  const handle = mountLandingLive({ root: document, i18n: lang, fetchTeaser, fetchHealth });
  return { handle, lang, fetchTeaser, fetchHealth };
}

describe('visibility-scoped polling', () => {
  it('does not fetch before the region is visible; then polls every minute', async () => {
    const h = liveHarness();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(h.fetchTeaser).not.toHaveBeenCalled();
    h.handle.setVisible(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.fetchTeaser).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[data-live=weather]')?.textContent).toBe('21,4 °C');
    await vi.advanceTimersByTimeAsync(LIVE_INTERVAL_MS);
    expect(h.fetchTeaser).toHaveBeenCalledTimes(2);
    h.handle.destroy();
  });
  it('pauses offscreen and in background tabs, then refreshes overdue data on return', async () => {
    const h = liveHarness();
    h.handle.setVisible(true);
    await vi.advanceTimersByTimeAsync(0);
    h.handle.setVisible(false);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(h.fetchTeaser).toHaveBeenCalledTimes(1);
    h.handle.setVisible(true);
    h.handle.setPageVisible(false);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(h.fetchTeaser).toHaveBeenCalledTimes(1);
    h.handle.setPageVisible(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.fetchTeaser).toHaveBeenCalledTimes(2);
    h.handle.destroy();
  });
  it('never overlaps requests and ignores late completion after destruction', async () => {
    const h = liveHarness();
    let resolve!: (data: { modules: ModuleSnapshot[] }) => void;
    h.fetchTeaser.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    h.handle.setVisible(true);
    await vi.advanceTimersByTimeAsync(0);
    await h.handle.refresh();
    h.handle.setVisible(true);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(h.fetchTeaser).toHaveBeenCalledTimes(1);
    h.handle.destroy();
    resolve({ modules });
    await vi.advanceTimersByTimeAsync(0);
    expect(document.querySelector('[data-live=weather]')?.textContent).toBe('Učitavanje podataka');
    expect(vi.getTimerCount()).toBe(0);
  });
  it('retains stale data on failure and translates it immediately without a request', async () => {
    const h = liveHarness();
    h.handle.setVisible(true);
    await vi.advanceTimersByTimeAsync(0);
    h.fetchTeaser.mockRejectedValueOnce(new Error('offline'));
    await h.handle.refresh();
    expect(document.querySelector('[data-live=weather]')?.getAttribute('data-freshness')).toBe('stale');
    expect(document.querySelector('[data-live=safety]')?.textContent).toBe('Stanje nije potvrđeno');
    h.lang.setLocale('en');
    h.handle.repaint();
    expect(document.querySelector('[data-live=weather]')?.textContent).toBe('21.4 °C');
    expect(document.querySelector('[data-live-state=weather]')?.textContent).toBe('Last known data');
    expect(document.querySelector('#health')?.textContent).toContain('Some displayed sources are not current');
    expect(h.fetchTeaser).toHaveBeenCalledTimes(2);
    h.handle.destroy();
  });
  it('does not claim healthy sources on an empty teaser or when health fails', async () => {
    const h = liveHarness();
    h.fetchTeaser.mockResolvedValueOnce({ modules: [] });
    h.handle.setVisible(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(document.querySelector('#health')?.textContent).not.toContain('Prikazani izvori odgovaraju');
    h.fetchHealth.mockRejectedValueOnce(new Error('down'));
    await h.handle.refresh();
    expect(document.querySelector('#health')?.textContent).toContain('Poslužitelj nije dostupan');
    h.handle.destroy();
  });
  it('treats malformed payloads as unavailable and does not leave refresh stuck', async () => {
    const h = liveHarness();
    h.fetchTeaser.mockResolvedValueOnce({ modules: [{ module: 'dhmz-cap', status: 'live', items: null }] as unknown as ModuleSnapshot[] });
    h.handle.setVisible(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(document.querySelector('[data-live=safety]')?.textContent).toBe('Stanje nije potvrđeno');
    expect(document.querySelector<HTMLButtonElement>('[data-live-refresh]')?.disabled).toBe(false);
    await h.handle.refresh();
    expect(document.querySelector('[data-live=safety]')?.textContent).toBe('Nema aktivnih upozorenja');
    h.handle.destroy();
  });
});

describe('static story and localized captures', () => {
  const html = readFileSync(join(root, 'app/index.html'), 'utf8');
  const doc = new DOMParser().parseFromString(html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<link[^>]*>/g, ''), 'text/html');
  const lookup = (catalogue: unknown, key: string): unknown => key.split('.').reduce<unknown>((node, part) => node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined, catalogue);
  it('ships every chapter and action as real HTML, with one h1 and no fake controls', () => {
    expect(doc.querySelectorAll('h1')).toHaveLength(1);
    expect(doc.querySelector('h1')?.textContent).toBe(hr.landing.title);
    expect(doc.querySelectorAll('.ld-chapter')).toHaveLength(4);
    expect(doc.querySelectorAll('.ld-chapter figure img')).toHaveLength(5);
    expect(doc.querySelector('[data-testid=cta-story]')?.getAttribute('href')).toBe('#kako-radi');
    expect(doc.querySelector('[data-testid=cta-try]')?.getAttribute('href')).toBe('#isprobaj');
    expect(doc.querySelector('iframe, video, canvas')).toBeNull();
  });
  it('has verbatim Croatian HTML and English equivalents for every translated node', () => {
    for (const node of doc.querySelectorAll('[data-i18n]')) {
      const key = node.getAttribute('data-i18n')!;
      expect(lookup(hr, key), key).toBe(node.textContent);
      expect(typeof lookup(en, key), key).toBe('string');
    }
    for (const node of doc.querySelectorAll('[data-i18n-aria-label]')) {
      const key = node.getAttribute('data-i18n-aria-label')!;
      expect(lookup(hr, key), key).toBe(node.getAttribute('aria-label'));
      expect(typeof lookup(en, key), key).toBe('string');
    }
  });
  it('routes trials through ordinary screens/code entry and labels new tabs', () => {
    for (const [id, href] of [['cta-kiosk', '/kiosk/'], ['cta-same-device', '/s/']]) {
      const link = doc.querySelector(`[data-testid=${id}]`)!;
      expect(link.getAttribute('href')).toBe(href);
      expect(link.getAttribute('target')).toBe('_blank');
      expect(link.getAttribute('rel')).toBe('noopener');
      expect(doc.getElementById(link.getAttribute('aria-describedby')!)).not.toBeNull();
    }
    expect(doc.querySelector('.ld-nav a[href="/s/"]')).not.toBeNull();
    expect(doc.querySelector('.ld-nav a[href="/hitno"]')).not.toBeNull();
    expect(doc.querySelector('a[href="/prijava/"]')).not.toBeNull();
  });
  it('reserves image geometry and keeps the largest first-viewport variant under 200 kB', () => {
    for (const image of doc.querySelectorAll('img')) {
      expect(Number(image.getAttribute('width'))).toBeGreaterThan(0);
      expect(Number(image.getAttribute('height'))).toBeGreaterThan(0);
      expect(image.hasAttribute('alt')).toBe(true);
      if (!image.closest('.ld-hero')) expect(image.getAttribute('loading')).toBe('lazy');
    }
    for (const locale of ['hr', 'en']) for (const theme of ['light', 'dark']) {
      const bytes = ['kiosk-' + locale + '-' + theme + '-1280.webp', 'phone-' + locale + '-' + theme + '-780.webp']
        .reduce((sum, file) => sum + statSync(join(root, 'app/public/landing', file)).size, 0);
      expect(bytes).toBeLessThan(200_000);
    }
  });
  it('selects locale/theme variants without changing sizes or image dimensions', () => {
    document.body.innerHTML = '<picture data-capture="phone"><source media="(prefers-color-scheme: dark)" srcset="/landing/phone-hr-dark-390.webp"><img src="/landing/phone-hr-light-390.webp" srcset="/landing/phone-hr-light-390.webp 390w, /landing/phone-hr-light-780.webp 780w" sizes="20vw" width="390" height="844" data-capture-alt="phone" alt=""></picture>';
    syncCaptureImages(document, createDefaultI18n('en'), 'dark');
    const img = document.querySelector('img')!;
    expect(img.getAttribute('src')).toBe('/landing/phone-en-dark-390.webp');
    expect(img.getAttribute('srcset')).toContain('/landing/phone-en-dark-780.webp 780w');
    expect(img.getAttribute('sizes')).toBe('20vw');
    expect(img.alt).toBe(en.landing.alt.phone);
    expect(img.width).toBe(390);
  });
  it('shows useful failure text and recovers when another image variant loads', () => {
    document.body.innerHTML = '<picture data-capture="phone"><img alt="Phone" src="/landing/phone-hr-light-390.webp"></picture>';
    const off = watchCaptureErrors(document, i18n);
    document.querySelector('img')!.dispatchEvent(new Event('error'));
    expect(document.querySelector('.ld-media-error')?.textContent).toBe(hr.landing.imageUnavailable);
    document.querySelector('img')!.dispatchEvent(new Event('load'));
    expect(document.querySelector('.ld-media-error')).toBeNull();
    off();
  });
});

describe('chapter selection', () => {
  const boxes = [{ top: -100, bottom: 400 }, { top: 400, bottom: 900 }, { top: 900, bottom: 1400 }, { top: 1400, bottom: 1900 }];
  it('follows the current position, including exact boundaries and jumps', () => {
    expect(chapterAtLine(boxes, 399)).toBe(0);
    expect(chapterAtLine(boxes, 400)).toBe(1);
    expect(chapterAtLine(boxes, 1700)).toBe(3);
    expect(chapterAtLine(boxes, -500)).toBe(0);
    expect(chapterAtLine(boxes, 2500)).toBe(3);
    expect(chapterAtLine([], 0)).toBe(0);
  });
});
