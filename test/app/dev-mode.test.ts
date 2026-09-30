// @vitest-environment happy-dom
// DEV mode in the browser (app/src/core/dev-mode.ts, shared/dev-chip.ts, app/src/experience/dev-chip.ts;
// worker/routes/dev.ts describes DEV): the flag and where the tab keeps it, the URLs that carry it, the
// × that leaves nothing of DEV behind, and the mark with its five surfaces, which joins the header's
// wordmark where the header leaves it a place and floats where none does.
import { describe, expect, it } from 'vitest';
import en from '../../app/src/i18n/en.json';
import hr from '../../app/src/i18n/hr.json';
import { BEACON_STORAGE_KEY } from '../../app/src/beacon';
import { codeFromScan, codeUrl } from '../../app/src/code';
import {
  DEV_BEACON_KEY, DEV_MARK_ID, DEV_STORAGE_KEY, devMarkSlot, devScopedStorage, hasDevFlag, markDev, readDevMode, showDev, turnDevOff, withDevFlag, withoutDevFlag,
} from '../../app/src/core/dev-mode';
import { SCREEN_LABEL_KEY } from '../../app/src/core/screen-label';
import { mountDevChip } from '../../app/src/experience/dev-chip';
import { createDefaultI18n } from '../../app/src/i18n/create-default-i18n';
import { DATA_TOKEN_KEY, RESUME_KEY } from '../../app/src/session';
import { reconcileChildren } from '../../app/src/ui/dom/reconcile';
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

  it('marks <html data-dev="1">, and data-dev-chip only where the mark shows; a framed page draws no scrollbar', () => {
    const root = document.createElement('html');
    markDev(root, true);
    expect(root.dataset).toMatchObject({ dev: '1', devChip: '1' });
    expect(root.style.getPropertyValue('scrollbar-width')).toBe('');
    markDev(root, false);
    expect(root.dataset.dev).toBe('1');
    expect(root.dataset.devChip).toBeUndefined();
    expect(root.style.getPropertyValue('scrollbar-width')).toBe('none');
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
    const links = [...box.querySelectorAll<HTMLAnchorElement>('[data-testid=dev-menu] a[data-dev-surface]')];
    expect(links.map((a) => a.textContent)).toEqual(['Zaslon', 'Telefon', 'Računalo', 'Hitno', 'Sve zajedno']);
    expect(links.map((a) => a.getAttribute('aria-current'))).toEqual([null, 'page', null, null, null]);
    expect(links[1]!.dataset.devWindow).toBe('390x844');
    // The suffix is the lowercase word, so the header reads "Kaj ima?dev".
    expect(box.querySelector('[data-testid=dev-chip]')!.textContent).toBe('dev');
    expect(box.querySelector('[data-testid=dev-off]')!.getAttribute('href')).toBe('/d/');
    expect(box.querySelector('nav')!.getAttribute('aria-label')).toBe('Razvojni način rada');
    expect(box.querySelector('nav')!.id).toBe(DEV_MARK_ID);
    // The menu's last row is the same way out, for a header too narrow for the × (the CSS shows it only there).
    const out = box.querySelector<HTMLAnchorElement>('[data-testid=dev-menu] > li:last-child > a')!;
    expect([out.dataset.testid, out.getAttribute('href'), out.textContent, out.hasAttribute('data-dev-off')]).toEqual(['dev-off-menu', '/d/', 'Isključi razvojni način rada', true]);
    expect(box.querySelector('[data-testid=dev-off]')!.hasAttribute('data-dev-off')).toBe(true);
  });

  it('says the same in English, and escapes what it is given', () => {
    const html = devChipMarkup(en.dev, { current: null, offHref: '/d/?a="b"' });
    expect(html).toContain('>Screen<');
    expect(html).toContain('aria-label="Turn developer mode off"');
    expect(html).toContain('href="/d/?a=&quot;b&quot;"');
  });

  it('floats at the top of a page with no place for it, with its style, and closes its menu on Escape', () => {
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

  it('a header leaves no place for it until the page shows the mark, then one right after the wordmark', async () => {
    expect(devMarkSlot()).toBe('');
    document.body.innerHTML = '';
    const shown = showDev(createDefaultI18n('hr'), 'phone');
    expect(devMarkSlot()).toBe(`<span data-persist-for="${DEV_MARK_ID}" hidden></span>`);
    (await shown)!.destroy();
  });

  it('takes the place after the wordmark, now or once the header is drawn, and the reconciled header keeps it there', async () => {
    const slot = `<span data-persist-for="${DEV_MARK_ID}" hidden></span>`;
    document.body.innerHTML = `<header class="k-head"><div class="k-head-brand"><button class="k-brand">Kaj ima?</button>${slot}<p class="k-context"></p></div></header>`;
    const wall = mountDevChip({ i18n: createDefaultI18n('hr'), current: 'screen', offHref: '/kiosk/' });
    expect(wall.element.previousElementSibling!.className).toBe('k-brand');
    expect(wall.element.nextElementSibling!.className).toBe('k-context');
    expect(document.querySelector('[data-persist-for]')).toBeNull();
    wall.destroy();

    // The header arrives after the mark (the wall's screen, the dashboard's session): the mark floats, then moves in.
    document.body.innerHTML = '<main></main>';
    const late = mountDevChip({ i18n: createDefaultI18n('hr'), current: 'phone', offHref: '/d/' });
    expect(late.element.parentElement).toBe(document.body);
    const header = document.createElement('header');
    header.className = 'ki-head';
    header.innerHTML = `<a class="ki-wordmark" data-key="wordmark" href="#"></a>${slot}<button data-key="share"></button>`;
    document.body.append(header);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(late.element.parentElement).toBe(header);
    expect(late.element.previousElementSibling!.className).toBe('ki-wordmark');
    // Every later paint of the status line carries the placeholder; the reconciler puts the same live mark there.
    const details = late.element.querySelector('details')!;
    details.open = true;
    const next = document.createElement('div');
    next.innerHTML = `<a class="ki-wordmark" data-key="wordmark" href="#"></a>${slot}<button data-key="screen"></button><button data-key="share"></button>`;
    reconcileChildren(header, next);
    expect(header.children[1]).toBe(late.element);
    expect(details.open).toBe(true);
    expect([...header.children].map((el) => el.getAttribute('data-key') ?? el.id)).toEqual(['wordmark', DEV_MARK_ID, 'screen', 'share']);
    late.destroy();
  });
});
