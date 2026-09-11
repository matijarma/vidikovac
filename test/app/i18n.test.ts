// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import en from '../../app/src/i18n/en.json';
import hr from '../../app/src/i18n/hr.json';
import { createDefaultI18n, DEFAULT_LOCALE, LOCALE_STORAGE_KEY, resolveInitialLocale, SUPPORTED_LOCALES } from '../../app/src/i18n/create-default-i18n';
import { createLanguageToggle } from '../../app/src/i18n/toggle';

function leafKeys(node: unknown, prefix = ''): string[] {
  if (typeof node === 'string') return [prefix];
  if (node && typeof node === 'object') {
    return Object.entries(node as Record<string, unknown>).flatMap(([k, v]) => leafKeys(v, prefix ? `${prefix}.${k}` : k));
  }
  return [];
}
const PLURAL = ['_zero', '_one', '_two', '_few', '_many', '_other'];
const base = (k: string): string => { const s = PLURAL.find((p) => k.endsWith(p)); return s ? k.slice(0, -s.length) : k; };

describe('catalogs', () => {
  it('hr and en have identical key sets (plural forms compared on base names)', () => {
    expect([...new Set(leafKeys(hr).map(base))].sort()).toEqual([...new Set(leafKeys(en).map(base))].sort());
  });
  it('no leaf is empty and hr never addresses the reader as Vi', () => {
    for (const k of leafKeys(hr)) expect(k.length).toBeGreaterThan(0);
    const all = JSON.stringify(hr);
    expect(all).not.toMatch(/\bVi\b|\bVaš|\bVam\b|Skenirajte|Kopirajte|Podijelite|Plaćate/);
  });
  it('carries the approved copy verbatim', () => {
    expect(hr.kiosk.invitation).toBe('Skeniraj za 10 minuta pogleda na Zagreb. Plaćaš pažnjom, ne novcem.');
    expect(hr.session.unlocked).toBe('Otključano · {label} · do {time}');
    expect(hr.session.expiring60).toBe('Još minuta. Ono što gledaš ostaje na zaslonu i nakon isteka.');
    expect(hr.session.expired).toBe('Sesija je završila. Prikaz je zamrznut. Zaslon u blizini otključava novih deset minuta.');
    expect(hr.scan.errors['same-network']).toBe('Ovaj zaslon i tvoj telefon dijele istu mrežu. Isključi Wi-Fi i skeniraj mobilnim podacima.');
  });
});

describe('createDefaultI18n', () => {
  it('defaults to hr, interpolates, and falls back to hr for a missing en key', () => {
    const i18n = createDefaultI18n();
    expect(DEFAULT_LOCALE).toBe('hr');
    expect(SUPPORTED_LOCALES).toEqual(['hr', 'en']);
    expect(i18n.t('session.unlocked', { label: 'kafić', time: '14:32' })).toBe('Otključano · kafić · do 14:32');
    expect(i18n.setLocale('en')).toBe('en');
    expect(i18n.t('common.copy')).toBe('Copy');
    expect(i18n.t('nonexistent.key')).toBe('nonexistent.key');
  });
  it('uses Croatian plural categories', () => {
    const i18n = createDefaultI18n('hr');
    expect(i18n.t('common.minutes', { count: 1 })).toBe('1 minuta');
    expect(i18n.t('common.minutes', { count: 3 })).toBe('3 minute');
    expect(i18n.t('common.minutes', { count: 10 })).toBe('10 minuta');
  });
  it('resolveInitialLocale prefers a stored choice, then the browser list, then undefined', () => {
    expect(resolveInitialLocale('en', ['hr'])).toBe('en');
    expect(resolveInitialLocale(null, ['de-DE', 'en-GB'])).toBe('en');
    expect(resolveInitialLocale(null, ['de'])).toBeUndefined();
  });
});

describe('createLanguageToggle', () => {
  it('shows the other language, switches, stores under vidikovac-locale and translates the page', () => {
    document.body.innerHTML = '<h1 data-i18n="scan.title"></h1>';
    const i18n = createDefaultI18n('hr');
    const stored: Record<string, string> = {};
    const seen: string[] = [];
    const btn = createLanguageToggle(i18n, { storage: { setItem: (k, v) => { stored[k] = v; } }, onChange: (l) => seen.push(l) });
    expect(btn.textContent).toBe('English');
    expect(btn.getAttribute('lang')).toBe('en');
    btn.click();
    expect(i18n.getLocale()).toBe('en');
    expect(btn.textContent).toBe('Hrvatski');
    expect(stored[LOCALE_STORAGE_KEY]).toBe('en');
    expect(document.documentElement.lang).toBe('en');
    expect(document.querySelector('h1')?.textContent).toBe(en.scan.title);
    expect(seen).toEqual(['en']);
  });
});
