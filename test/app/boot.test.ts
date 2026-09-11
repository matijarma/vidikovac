// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../../app/src/i18n/en.json';
import { LOCALE_STORAGE_KEY } from '../../app/src/i18n/create-default-i18n';
import { THEME_STORAGE_KEY } from '../../app/src/ui/theme';
import { bootPage } from '../../app/src/boot';
import { stubLocalStorage, stubNavigatorLanguage, text } from './helpers';

// See stubLocalStorage's and stubNavigatorLanguage's doc comments: Node's own
// `localStorage` global shadows happy-dom's real one under this vitest
// version, and happy-dom's default navigator would otherwise outvote the
// Croatian default — both need pinning once before any test runs.
stubLocalStorage();
stubNavigatorLanguage();

/** A fresh page: no theme attributes, a theme-color meta, the given body. */
function page(body: string): void {
  for (const attribute of ['data-theme', 'data-theme-resolved', 'data-page', 'lang']) {
    document.documentElement.removeAttribute(attribute);
  }
  document.head.innerHTML = '<meta name="theme-color" content="">';
  document.body.innerHTML = body;
}

beforeEach(() => {
  localStorage.clear();
  page('');
});

describe('bootPage', () => {
  it('boots Croatian, marks the page and resolves a theme for the tokens to switch on', () => {
    const { i18n, theme, toasts } = bootPage({ page: 'scan' });
    expect(i18n.getLocale()).toBe('hr');
    expect(document.documentElement.lang).toBe('hr');
    expect(document.documentElement.getAttribute('data-page')).toBe('scan');
    expect(theme.getPreference()).toBe('auto');
    expect(['light', 'dark']).toContain(document.documentElement.getAttribute('data-theme-resolved'));
    expect(toasts.size).toBe(0);
  });

  it('honours the stored locale and the stored theme preference', () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'en');
    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    const { i18n, theme } = bootPage({ page: 'scan' });
    expect(i18n.getLocale()).toBe('en');
    expect(document.documentElement.lang).toBe('en');
    expect(theme.getPreference()).toBe('light');
    expect(document.documentElement.getAttribute('data-theme-resolved')).toBe('light');
  });

  it('translates every data-i18n node and mounts the icon sprite once', () => {
    page('<h1 data-i18n="scan.title"></h1>');
    bootPage({ page: 'scan' });
    bootPage({ page: 'scan' });
    expect(text(document.querySelector('h1'))).toBe('Otključaj pogled na Zagreb');
    expect(document.querySelectorAll('#vidikovac-icon-sprite')).toHaveLength(1);
    expect(document.querySelector('#icon-qr-code')).not.toBeNull();
  });

  it('fills the language slot, and the toggle switches, stores and re-translates', () => {
    page('<span data-lang-toggle></span><h1 data-i18n="scan.title"></h1>');
    const seen: string[] = [];
    bootPage({ page: 'scan', onLocaleChange: (locale) => seen.push(locale) });
    const toggle = document.querySelector<HTMLButtonElement>('[data-testid=lang-toggle]')!;
    expect(toggle.textContent).toBe('English');
    expect(toggle.getAttribute('lang')).toBe('en');
    toggle.click();
    expect(document.documentElement.lang).toBe('en');
    expect(text(document.querySelector('h1'))).toBe(en.scan.title);
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('en');
    expect(seen).toEqual(['en']);
    expect(document.querySelectorAll('[data-testid=lang-toggle]')).toHaveLength(1);
  });

  it('leaves a slot that already carries a toggle alone (C8 fills its own)', () => {
    page('<span data-lang-toggle><button type="button" data-testid="lang-toggle">English</button></span>');
    bootPage({ page: 'static' });
    expect(document.querySelectorAll('[data-testid=lang-toggle]')).toHaveLength(1);
  });

  it('puts toasts in the container the page hands it', () => {
    page('<div id="toasts"></div>');
    const container = document.querySelector<HTMLElement>('#toasts')!;
    const { toasts } = bootPage({ page: 'scan', toastContainer: container });
    toasts.push({ message: 'Kopirano s navodom izvora.', variant: 'success', dismissLabel: 'Ukloni obavijest' });
    expect(container.querySelectorAll('.toast')).toHaveLength(1);
    expect(toasts.size).toBe(1);
    toasts.clear();
    expect(toasts.size).toBe(0);
  });
});

describe('entries/theme-init', () => {
  it('applies the stored theme as soon as <head> loads it', async () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    vi.resetModules();
    await import('../../app/src/entries/theme-init');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(document.documentElement.getAttribute('data-theme-resolved')).toBe('light');
  });
});
