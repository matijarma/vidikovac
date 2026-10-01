// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultI18n } from '../../app/src/i18n/create-default-i18n';
import { createLazySessionSheet, type SessionSheetLoader } from '../../app/src/experience/lazy-session-sheet';
import * as renderer from '../../app/src/experience/session-sheet';
import type { SessionSheet, SessionSheetDeps, SheetState } from '../../app/src/experience/session-sheet';

const now = Date.parse('2026-10-01T10:00:00Z');
const i18n = createDefaultI18n('hr');
let handle: SessionSheet | null = null;
let state: SheetState;
let opener: HTMLButtonElement;
beforeEach(() => {
  document.body.innerHTML = '<button>Session</button>';
  opener = document.querySelector('button')!;
  opener.focus();
  state = { session: { phase: 'live', role: 'scanner', expiresAt: now + 600_000, dataToken: 'test',
    participants: 2, secondsLeft: 600 }, frozen: false, paused: false, canShare: true, label: 'Kavana' };
});
afterEach(() => { handle?.destroy(); handle = null; });
const flush = async (): Promise<void> => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const mount = (load: SessionSheetLoader): SessionSheet => {
  const deps: SessionSheetDeps = { i18n, now: () => now, state: () => state, onAction: vi.fn() };
  return handle = createLazySessionSheet(deps, load);
};

describe('DR3 lazy session sheet', () => {
  it('loads only on request, coalesces opens and renders current state on arrival', async () => {
    let deliver!: (module: typeof renderer) => void;
    const load = vi.fn(() => new Promise<typeof renderer>((resolve) => { deliver = resolve; }));
    const sheet = mount(load);
    sheet.refresh();
    expect(load).not.toHaveBeenCalled();
    expect(document.querySelector('dialog')).toBeNull();
    sheet.open();
    sheet.open();
    expect(load).toHaveBeenCalledTimes(1);
    expect(sheet.isOpen()).toBe(true);
    expect(document.querySelector('[data-testid=session-sheet-loading]')?.getAttribute('aria-labelledby')).toBe('session-loading-title');
    state = { ...state, label: 'Knjižnica' };
    deliver(renderer);
    await flush();
    expect(document.querySelector('[data-testid=session-sheet-loading]')).toBeNull();
    expect(document.querySelector('[data-testid=session-sheet]')?.textContent).toContain('Knjižnica');
    sheet.close();
    await flush();
    expect(document.activeElement).toBe(opener);
    sheet.open();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it.each(['close', 'dismiss', 'destroy'] as const)('does not resurrect a sheet after %s while its renderer is loading', async (end) => {
    let deliver!: (module: typeof renderer) => void;
    const create = vi.fn(renderer.createSessionSheet);
    const sheet = mount(() => new Promise<typeof renderer>((resolve) => { deliver = resolve; }));
    sheet.open();
    if (end === 'dismiss') document.querySelector<HTMLDialogElement>('dialog')!.close();
    else sheet[end]();
    deliver({ ...renderer, createSessionSheet: create });
    await flush();
    expect(create).not.toHaveBeenCalled();
    expect(sheet.isOpen()).toBe(false);
    expect(document.querySelector('[data-testid=session-sheet]')).toBeNull();
    if (end !== 'destroy') {
      sheet.open();
      expect(create).toHaveBeenCalledTimes(1);
      expect(sheet.isOpen()).toBe(true);
    }
  });

  it.each(['reject', 'throw'] as const)('shows a %s failure and retries on the next request', async (kind) => {
    let calls = 0;
    const load = vi.fn(() => {
      if (++calls > 1) return Promise.resolve(renderer);
      if (kind === 'throw') throw new Error('offline');
      return Promise.reject(new Error('offline'));
    });
    const sheet = mount(load);
    sheet.open();
    await flush();
    expect(document.querySelector('.dialog-title')?.textContent).toBe(i18n.t('common.unavailable'));
    sheet.refresh();
    expect(load).toHaveBeenCalledTimes(1);
    sheet.close();
    sheet.open();
    await flush();
    expect(load).toHaveBeenCalledTimes(2);
    expect(document.querySelector('[data-testid=session-sheet]')).not.toBeNull();
  });
});
