// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import type { ModuleSnapshot } from '../../worker/feed/schema';
import { createDefaultI18n } from '../../app/src/i18n/create-default-i18n';
import {
  createLayerSection,
  createPanel,
  dataNumber,
  dataText,
  freshnessFor,
  listMarkup,
  statusText,
} from '../../app/src/panels/panel';

const NOW = Date.parse('2026-09-11T12:32:00Z'); // 14:32 in Zagreb
const ATTR = {
  text: 'Izvor: DHMZ, Otvorena dozvola, 14:00',
  url: 'https://meteo.hr/proizvodi.php?section=podaci&param=xml_korisnici',
  licence: 'Otvorena dozvola (NN 67/17)',
};
const snap = (over: Partial<ModuleSnapshot> = {}): ModuleSnapshot => ({
  module: 'dhmz-now',
  tier: 'open',
  status: 'live',
  fetchedAt: new Date(NOW - 60_000).toISOString(),
  attribution: ATTR,
  items: [],
  ...over,
});

describe('freshness and status', () => {
  it('is Živo under five minutes, Danas beyond, Referenca for reference modules', () => {
    expect(freshnessFor(snap(), NOW)).toBe('zivo');
    expect(freshnessFor(snap({ fetchedAt: new Date(NOW - 6 * 60_000).toISOString() }), NOW)).toBe('danas');
    expect(freshnessFor(snap({ module: 'glasnik' }), NOW)).toBe('referenca');
    expect(freshnessFor(snap({ status: 'down' }), NOW)).toBe('danas');
  });
  it('states the data time in Croatian, and says so when the source is silent', () => {
    const i18n = createDefaultI18n('hr');
    expect(statusText(snap(), i18n, NOW)).toBe('podaci od 14:31');
    expect(statusText(snap({ status: 'stale' }), i18n, NOW)).toBe('podaci od 14:31 · izvor trenutačno ne odgovara');
    expect(statusText(snap({ status: 'down' }), i18n, NOW)).toBe('izvor nedostupan');
  });
});

describe('item data helpers', () => {
  const item = { id: '1', module: 'dhmz-now', kind: 'observation', tier: 'open', title: 'Maksimir', data: { temp: 21.4, weather: 'vedro', flag: true } } as const;
  it('reads numbers and text defensively', () => {
    expect(dataNumber(item, 'temp')).toBe(21.4);
    expect(dataNumber(item, 'weather')).toBeNull();
    expect(dataNumber(undefined, 'temp')).toBeNull();
    expect(dataText(item, 'weather')).toBe('vedro');
    expect(dataText(item, 'nema')).toBe('');
  });
  it('listMarkup falls back to the empty sentence', () => {
    expect(listMarkup([], 'Trenutačno nema stavki.')).toContain('Trenutačno nema stavki.');
    expect(listMarkup(['<span>a</span>'], 'x')).toBe('<ul class="panel-list"><li><span>a</span></li></ul>');
  });
});

describe('createPanel', () => {
  const i18n = createDefaultI18n('hr');
  it('renders title, freshness word plus shape, status, attribution, licence and source link', () => {
    const panel = createPanel({ i18n, now: NOW, id: 'p1', title: 'Maksimir sada', snapshot: snap(), body: '<p>21 °C</p>' });
    expect(panel.element.querySelector('.panel-title')?.textContent).toBe('Maksimir sada');
    expect(panel.element.getAttribute('data-freshness')).toBe('zivo');
    expect(panel.element.querySelector('[data-testid=panel-freshness]')?.textContent).toBe('Živo');
    expect(panel.element.querySelector('.fresh-shape')?.getAttribute('aria-hidden')).toBe('true');
    expect(panel.element.querySelector('[data-testid=panel-status]')?.textContent).toBe('podaci od 14:31');
    const attr = panel.element.querySelector('[data-testid=panel-attr]')!;
    expect(attr.textContent).toContain('Izvor: DHMZ, Otvorena dozvola, 14:00');
    expect(attr.textContent).toContain('Licenca: Otvorena dozvola (NN 67/17)');
    expect(attr.querySelector('a')?.getAttribute('href')).toBe(ATTR.url);
    expect(attr.querySelector('a')?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(panel.body.innerHTML).toBe('<p>21 °C</p>');
  });
  it('accepts an element body and a heading level', () => {
    const body = document.createElement('div');
    body.textContent = 'karta';
    const panel = createPanel({ i18n, now: NOW, id: 'p2', title: 'Karta', body, headingLevel: 2 });
    expect(panel.element.querySelector('h2')).not.toBeNull();
    expect(panel.body.textContent).toBe('karta');
    expect(panel.element.querySelector('[data-testid=panel-status]')).toBeNull();
  });
  it('renders copy and share actions only when a handler is given, and passes the attribution on', () => {
    const onCopy = vi.fn();
    const onShare = vi.fn();
    const plain = createPanel({ i18n, now: NOW, id: 'p3', title: 'Bez akcija', snapshot: snap(), body: '' });
    expect(plain.element.querySelectorAll('[data-testid=panel-actions] button')).toHaveLength(0);
    const panel = createPanel({
      i18n, now: NOW, id: 'p4', title: 'Maksimir sada', snapshot: snap(), body: '',
      copyText: '21 °C, Maksimir', onCopy, shareUrl: 'https://zagreb.aningfilm.hr/', onShare,
      extraActions: [{ id: 'print', label: 'Ispiši', run: () => {} }],
    });
    const buttons = [...panel.element.querySelectorAll<HTMLButtonElement>('[data-testid=panel-actions] button')];
    expect(buttons.map((b) => b.textContent)).toEqual(['Kopiraj', 'Podijeli', 'Ispiši']);
    expect(buttons[0]!.id).toBe('p4-copy');
    buttons[0]!.click();
    expect(onCopy).toHaveBeenCalledWith('21 °C, Maksimir', ATTR);
    buttons[1]!.click();
    expect(onShare).toHaveBeenCalledWith('https://zagreb.aningfilm.hr/', 'Maksimir sada');
  });
  it('escapes every interpolated value', () => {
    const panel = createPanel({
      i18n, now: NOW, id: 'p5', title: '<img src=x onerror=alert(1)>',
      snapshot: snap({ attribution: { ...ATTR, text: 'a"b<c' } }), body: '',
    });
    expect(panel.element.querySelector('.panel-title')?.innerHTML).toBe('&lt;img src=x onerror=alert(1)&gt;');
    expect(panel.element.querySelector('[data-testid=panel-attr]')?.textContent).toContain('a"b<c');
    expect(panel.element.querySelector('img')).toBeNull();
  });
});

describe('createLayerSection', () => {
  it('gives the layer a focusable heading and a panel container', () => {
    const { section, heading, panels } = createLayerSection('u-pokretu', 'U pokretu');
    expect(section.id).toBe('layer-u-pokretu');
    expect(section.getAttribute('aria-labelledby')).toBe('layer-title-u-pokretu');
    expect(heading.tagName).toBe('H2');
    expect(heading.getAttribute('tabindex')).toBe('-1');
    expect(heading.textContent).toBe('U pokretu');
    expect(panels.className).toBe('layer-panels');
  });
});
