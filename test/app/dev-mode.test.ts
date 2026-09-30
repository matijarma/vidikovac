// @vitest-environment happy-dom
// DEV mode in the browser (app/src/core/dev-mode.ts, shared/dev-chip.ts, app/src/experience/dev-chip.ts;
// worker/routes/dev.ts describes DEV): the flag and where the tab keeps it, the URLs that carry it, the
// × that leaves nothing of DEV behind, and the chip with its five surfaces.
import { describe, expect, it } from 'vitest';
import en from '../../app/src/i18n/en.json';
import hr from '../../app/src/i18n/hr.json';
import { BEACON_STORAGE_KEY } from '../../app/src/beacon';
import { codeFromScan, codeUrl } from '../../app/src/code';
import {
  DEV_BEACON_KEY, DEV_STORAGE_KEY, devScopedStorage, hasDevFlag, markDev, readDevMode, turnDevOff, withDevFlag, withoutDevFlag,
} from '../../app/src/core/dev-mode';
import { SCREEN_LABEL_KEY } from '../../app/src/core/screen-label';
import { mountDevChip } from '../../app/src/experience/dev-chip';
import { createDefaultI18n } from '../../app/src/i18n/create-default-i18n';
import { DATA_TOKEN_KEY, RESUME_KEY } from '../../app/src/session';
import { DEV_SURFACES, devChipMarkup } from '../../shared/dev-chip';

function memory(): Storage {
  const map = new Map<string, string>();
  return {
    get length() { return map.size; },
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, String(v)); },
    removeItem: (k: string) => { map.delete(k); },
  };
}

describe('the flag', () => {
  it('is the bare key DEV, whatever its value, and case-sensitive', () => {
    for (const search of ['?DEV', '?lagano=1&DEV', '?DEV=1', '?DEV=', '?x=1&DEV=0']) expect(hasDevFlag(search), search).toBe(true);
    for (const search of ['', '?', '?dev', '?Dev', '?DEVX', '?x=DEV']) expect(hasDevFlag(search), search).toBe(false);
  });

  it('is kept for the tab, so a page reached without it stays in DEV', () => {
    const session = memory();
    expect(readDevMode('', session)).toBe(false);
    expect(readDevMode('?DEV', session)).toBe(true);
    expect(session.getItem(DEV_STORAGE_KEY)).toBe('1');
    expect(readDevMode('', session)).toBe(true);
    expect(readDevMode('', null)).toBe(false);
  });

  it('the × forgets DEV, the DEV session and the DEV screen, and keeps every preference', () => {
    const session = memory();
    const local = memory();
    for (const key of [DEV_STORAGE_KEY, RESUME_KEY, DATA_TOKEN_KEY, SCREEN_LABEL_KEY, 'vidikovac.layer']) session.setItem(key, 'x');
    for (const key of [DEV_BEACON_KEY, BEACON_STORAGE_KEY, 'kajima:theme']) local.setItem(key, 'x');
    turnDevOff(session, local);
    expect([DEV_STORAGE_KEY, RESUME_KEY, DATA_TOKEN_KEY, SCREEN_LABEL_KEY].map((key) => session.getItem(key))).toEqual([null, null, null, null]);
    expect(session.getItem('vidikovac.layer')).toBe('x');
    expect(local.getItem(DEV_BEACON_KEY)).toBeNull();
    expect(local.getItem(BEACON_STORAGE_KEY)).toBe('x');
    expect(readDevMode('', session)).toBe(false);
  });

  it('marks <html data-dev="1">, and data-dev-chip only where the chip shows', () => {
    const root = document.createElement('html');
    markDev(root, true);
    expect(root.dataset).toMatchObject({ dev: '1', devChip: '1' });
    markDev(root, false);
    expect(root.dataset.dev).toBe('1');
    expect(root.dataset.devChip).toBeUndefined();
  });
});

describe('URLs with and without the flag', () => {
  it('adds the bare key once, before the fragment, to relative and absolute URLs alike', () => {
    expect(withDevFlag('/d/')).toBe('/d/?DEV');
    expect(withDevFlag('/d/?lagano=1#room=R&ticket=T')).toBe('/d/?lagano=1&DEV#room=R&ticket=T');
    expect(withDevFlag('/d/?DEV#room=R')).toBe('/d/?DEV#room=R');
    expect(withDevFlag('/kiosk/?DEV=1')).toBe('/kiosk/?DEV=1');
    expect(withDevFlag('https://zagreb.aningfilm.hr/s/#ABCD-EFGH')).toBe('https://zagreb.aningfilm.hr/s/?DEV#ABCD-EFGH');
  });

  it('takes the key out and leaves the rest as written', () => {
    expect(withoutDevFlag('/kiosk/?DEV')).toBe('/kiosk/');
    expect(withoutDevFlag('/d/?lagano=1&DEV=1')).toBe('/d/?lagano=1');
    expect(withoutDevFlag('/d/?DEV&prikaz=shema#room=R')).toBe('/d/?prikaz=shema#room=R');
    expect(withoutDevFlag('/hitno')).toBe('/hitno');
  });

  it('a DEV wall\'s QR still reads as our code, in the camera app and in the page\'s own scanner', () => {
    const payload = withDevFlag(codeUrl('ABCDEFGH'));
    expect(payload).toBe('https://zagreb.aningfilm.hr/s/?DEV#ABCD-EFGH');
    expect(codeFromScan(payload)).toBe('ABCDEFGH');
  });

  it('a wall in DEV keeps its DEV screen under a key of its own, never over its own screen', () => {
    const local = memory();
    local.setItem(BEACON_STORAGE_KEY, 'the wall\'s own');
    const scoped = devScopedStorage(local, BEACON_STORAGE_KEY);
    expect(scoped.getItem(BEACON_STORAGE_KEY)).toBeNull();
    scoped.setItem(BEACON_STORAGE_KEY, 'dev');
    scoped.setItem('kajima:kiosk-rhythm', '20');
    expect(local.getItem(BEACON_STORAGE_KEY)).toBe('the wall\'s own');
    expect(local.getItem(DEV_BEACON_KEY)).toBe('dev');
    expect(local.getItem('kajima:kiosk-rhythm')).toBe('20');
  });
});

describe('the chip', () => {
  it('lists the five surfaces in the owner\'s order, each with ?DEV, the page\'s own marked', () => {
    expect(DEV_SURFACES.map((s) => [s.id, s.href])).toEqual([
      ['screen', '/kiosk/?DEV'], ['phone', '/d/?DEV'], ['desktop', '/d/?DEV'], ['hitno', '/hitno?DEV'], ['all', '/dev/?DEV'],
    ]);
    const html = devChipMarkup(hr.dev, { current: 'phone', offHref: '/d/' });
    const box = document.createElement('div');
    box.innerHTML = html;
    const links = [...box.querySelectorAll<HTMLAnchorElement>('[data-testid=dev-menu] a')];
    expect(links.map((a) => a.textContent)).toEqual(['Zaslon', 'Telefon', 'Računalo', 'Hitno', 'Sve zajedno']);
    expect(links.map((a) => a.getAttribute('aria-current'))).toEqual([null, 'page', null, null, null]);
    expect(links[1]!.dataset.devWindow).toBe('390x844');
    expect(box.querySelector('[data-testid=dev-chip]')!.textContent).toBe('DEV');
    expect(box.querySelector('[data-testid=dev-off]')!.getAttribute('href')).toBe('/d/');
    expect(box.querySelector('nav')!.getAttribute('aria-label')).toBe('Razvojni način rada');
  });

  it('says the same in English, and escapes what it is given', () => {
    const html = devChipMarkup(en.dev, { current: null, offHref: '/d/?a="b"' });
    expect(html).toContain('>Screen<');
    expect(html).toContain('aria-label="Turn developer mode off"');
    expect(html).toContain('href="/d/?a=&quot;b&quot;"');
  });

  it('mounts once at the top of the page with its style, and closes its menu on Escape', () => {
    document.body.innerHTML = '<main id="page"></main>';
    const chip = mountDevChip({ i18n: createDefaultI18n('hr'), current: 'screen', offHref: '/kiosk/' });
    expect(document.body.firstElementChild).toBe(chip.element);
    expect(document.getElementById('dev-chip-style')).not.toBeNull();
    const details = chip.element.querySelector('details')!;
    details.open = true;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(details.open).toBe(false);
    chip.destroy();
    expect(document.querySelector('[data-testid=dev-chip]')).toBeNull();
  });
});
