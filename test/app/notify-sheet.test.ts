// @vitest-environment happy-dom
// The bell sheet (plan B.5, D7): switch rows for the flag-gated key set,
// their checked state following the store, and the toggle callback.
import { describe, expect, it, vi } from 'vitest';
import { createDefaultI18n } from '../../app/src/i18n/create-default-i18n';
import { NOTIFY_KEYS, type NotifyFlags, type NotifyKey } from '../../app/src/core/notify-store';
import { createNotifySheet } from '../../app/src/experience/notify-sheet';
import { text } from './helpers';

const i18n = createDefaultI18n('hr');

function defaultFlags(): NotifyFlags {
  return { delays: false, works: false, waste: false, dhmz: false };
}

describe('createNotifySheet', () => {
  it('opens as the documented dialog, one 44 px switch row per key, unchecked to start', () => {
    const sheet = createNotifySheet({ i18n, state: () => ({ flags: defaultFlags(), keys: NOTIFY_KEYS }), onToggle: vi.fn() });
    sheet.open();
    expect(sheet.isOpen()).toBe(true);
    const dialog = document.querySelector('[data-testid=notify-sheet]')!;
    expect(dialog.querySelector('#notify-sheet-title')?.textContent).toBe('Isticanje u aplikaciji');
    const rows = dialog.querySelectorAll('[role=switch]');
    expect(rows).toHaveLength(4);
    for (const row of rows) expect(row.getAttribute('aria-checked')).toBe('false');
    expect([...rows].map((r) => (r as HTMLElement).dataset.testid)).toEqual(['notify-delays', 'notify-works', 'notify-waste', 'notify-dhmz']);
    sheet.destroy();
  });
  it('drops the waste row when the flag-gated key set excludes it', () => {
    const sheet = createNotifySheet({ i18n, state: () => ({ flags: defaultFlags(), keys: ['delays', 'works', 'dhmz'] }), onToggle: vi.fn() });
    sheet.open();
    const dialog = document.querySelector('[data-testid=notify-sheet]')!;
    expect(dialog.querySelectorAll('[role=switch]')).toHaveLength(3);
    expect(dialog.querySelector('[data-testid=notify-waste]')).toBeNull();
    sheet.destroy();
  });
  it('shows each switch’s own label text and the local-only note', () => {
    const sheet = createNotifySheet({ i18n, state: () => ({ flags: defaultFlags(), keys: NOTIFY_KEYS }), onToggle: vi.fn() });
    sheet.open();
    const dialog = document.querySelector('[data-testid=notify-sheet]')!;
    expect(text(dialog.querySelector('[data-testid=notify-delays]'))).toContain('Kašnjenja');
    expect(text(dialog.querySelector('.nt-note'))).toBe('Ništa se ne šalje: uključena obavijest samo ističe pločice u ovom pregledniku.');
    sheet.destroy();
  });
  it('a checked flag renders aria-checked true', () => {
    const sheet = createNotifySheet({ i18n, state: () => ({ flags: { ...defaultFlags(), works: true }, keys: NOTIFY_KEYS }), onToggle: vi.fn() });
    sheet.open();
    const dialog = document.querySelector('[data-testid=notify-sheet]')!;
    expect(dialog.querySelector('[data-testid=notify-works]')?.getAttribute('aria-checked')).toBe('true');
    expect(dialog.querySelector('[data-testid=notify-delays]')?.getAttribute('aria-checked')).toBe('false');
    sheet.destroy();
  });
  it('clicking a row toggles it through the store and reconciles the checked state in place', () => {
    let flags = defaultFlags();
    const onToggle = vi.fn((key: NotifyKey) => { flags = { ...flags, [key]: !flags[key] }; });
    const sheet = createNotifySheet({ i18n, state: () => ({ flags, keys: NOTIFY_KEYS }), onToggle });
    sheet.open();
    const dialog = document.querySelector('[data-testid=notify-sheet]')!;
    (dialog.querySelector('[data-testid=notify-dhmz]') as HTMLButtonElement).click();
    expect(onToggle).toHaveBeenCalledWith('dhmz');
    expect(dialog.querySelector('[data-testid=notify-dhmz]')?.getAttribute('aria-checked')).toBe('true');
    sheet.destroy();
  });
  it('refresh() reconciles the body against the latest state without reopening', () => {
    let flags = defaultFlags();
    const sheet = createNotifySheet({ i18n, state: () => ({ flags, keys: NOTIFY_KEYS }), onToggle: vi.fn() });
    sheet.open();
    flags = { ...flags, delays: true };
    sheet.refresh();
    const dialog = document.querySelector('[data-testid=notify-sheet]')!;
    expect(dialog.querySelector('[data-testid=notify-delays]')?.getAttribute('aria-checked')).toBe('true');
    sheet.destroy();
  });
  it('destroy() removes the dialog from the document', () => {
    const sheet = createNotifySheet({ i18n, state: () => ({ flags: defaultFlags(), keys: NOTIFY_KEYS }), onToggle: vi.fn() });
    sheet.open();
    sheet.destroy();
    expect(document.querySelector('[data-testid=notify-sheet]')).toBeNull();
    expect(sheet.isOpen()).toBe(false);
  });
});
