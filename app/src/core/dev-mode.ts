// DEV mode (owner, 30 Sep 2026): the flag, where the tab keeps it, and the two requests that open
// the product without pairing. worker/routes/dev.ts describes the whole of DEV; nothing links to it
// and nothing documents it, and this file hides nothing either.
//
// The flag is the bare query key DEV on /kiosk/, /d/, /s/ and /hitno (`?DEV`, `&DEV`, `?DEV=1`;
// case-sensitive), and /dev/ turns it on by itself. The tab keeps it in sessionStorage under
// `kajima:dev`, so in-app navigation keeps it; the chip's × clears it (and the DEV session and
// screen this tab held) and loads the page again without it. <html data-dev="1"> while it is on.
import type { CreateBeaconResponse, ScanOk } from '../../../worker/protocol';
import type { DevSurface } from '../../../shared/dev-chip';
import type { DevChipHandle } from '../experience/dev-chip';
import type { I18n } from '../i18n/i18n';
import { DATA_TOKEN_KEY, RESUME_KEY } from '../session';
import { SCREEN_LABEL_KEY } from './screen-label';

export const DEV_FLAG = 'DEV';
/** sessionStorage: '1' while this tab is in DEV. */
export const DEV_STORAGE_KEY = 'kajima:dev';
/** localStorage: the DEV screen a wall in DEV runs on, kept apart from the wall's own screen (beacon.ts BEACON_STORAGE_KEY). */
export const DEV_BEACON_KEY = 'kajima:dev-beacon';

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Whether the query names DEV: the key alone decides, whatever its value. */
export function hasDevFlag(search: string): boolean {
  return new URLSearchParams(search).has(DEV_FLAG);
}

/** DEV for this page: the flag in the query (remembered for the tab), or the tab's remembered flag. */
export function readDevMode(search: string, storage: StorageLike | null | undefined): boolean {
  if (hasDevFlag(search)) {
    turnDevOn(storage);
    return true;
  }
  try { return storage?.getItem(DEV_STORAGE_KEY) === '1'; } catch { return false; }
}

/** Remembers DEV for the tab (/dev/ calls this itself). */
export function turnDevOn(storage: StorageLike | null | undefined): void {
  try { storage?.setItem(DEV_STORAGE_KEY, '1'); } catch { /* the query still carries it */ }
}

/**
 * The × : the tab forgets DEV and the DEV session it held (the room's resume and data tokens and
 * the screen label, all of which the dashboard keeps in sessionStorage), and a wall forgets its
 * DEV screen. A preference (theme, language, the last layer) stays.
 */
export function turnDevOff(session: StorageLike | null | undefined, local: StorageLike | null | undefined): void {
  for (const key of [DEV_STORAGE_KEY, RESUME_KEY, DATA_TOKEN_KEY, SCREEN_LABEL_KEY]) {
    try { session?.removeItem(key); } catch { /* storage disabled */ }
  }
  try { local?.removeItem(DEV_BEACON_KEY); } catch { /* storage disabled */ }
}

function split(url: string): { base: string; query: string; hash: string } {
  const at = url.indexOf('#');
  const head = at === -1 ? url : url.slice(0, at);
  const hash = at === -1 ? '' : url.slice(at);
  const q = head.indexOf('?');
  return { base: q === -1 ? head : head.slice(0, q), query: q === -1 ? '' : head.slice(q + 1), hash };
}

function isDevPair(pair: string): boolean {
  const key = pair.split('=')[0] ?? '';
  try { return decodeURIComponent(key) === DEV_FLAG; } catch { return key === DEV_FLAG; }
}

/** The same URL with the bare DEV key in its query (once), the fragment left where it was. */
export function withDevFlag(url: string): string {
  const { base, query, hash } = split(url);
  const pairs = query ? query.split('&').filter(Boolean) : [];
  if (pairs.some(isDevPair)) return url;
  return `${base}?${[...pairs, DEV_FLAG].join('&')}${hash}`;
}

/** The same URL without DEV in its query. */
export function withoutDevFlag(url: string): string {
  const { base, query, hash } = split(url);
  const kept = (query ? query.split('&').filter(Boolean) : []).filter((pair) => !isDevPair(pair));
  return `${base}${kept.length ? `?${kept.join('&')}` : ''}${hash}`;
}

/** The id of the DEV mark once mounted: the reconciled status line keeps it in place by it (ui/dom/reconcile.ts data-persist-for). */
export const DEV_MARK_ID = 'dev-mark';

/** Set by showDev when this page draws the mark, so a header that carries the wordmark leaves the mark its place. */
let markSlot = false;

/**
 * Where a header puts the DEV mark: right after its wordmark, so the header reads "Kaj ima?dev". ''
 * unless this page shows the mark. A hidden placeholder that the mark replaces when it mounts
 * (experience/dev-chip.ts) and that the dashboard's reconciler fills with the live mark on every
 * later paint; a page without one gets the mark floating at the top instead.
 */
export function devMarkSlot(): string {
  return markSlot ? `<span data-persist-for="${DEV_MARK_ID}" hidden></span>` : '';
}

/** Whether this page is shown inside another page (the /dev/ grid): it is in DEV, but draws no chip of its own. */
export function isFramed(win: Window = window): boolean {
  try { return win.self !== win.top; } catch { return true; }
}

/**
 * <html data-dev="1">, and data-dev-chip while the page shows the chip. A page framed by /dev/ shows
 * none and draws no scrollbar either (it still scrolls), so the grid's cells show the page alone.
 */
export function markDev(root: HTMLElement, chip: boolean): void {
  root.dataset.dev = '1';
  if (chip) root.dataset.devChip = '1';
  else {
    delete root.dataset.devChip;
    root.style.setProperty('scrollbar-width', 'none');
  }
}

/**
 * A page in DEV: <html data-dev>, and the mark unless the page is framed by /dev/: after the
 * wordmark where the page's header leaves it a place (devMarkSlot), floating at the top where it
 * does not. The mark's code and style are a chunk of their own, loaded here and nowhere else.
 * `offHref` is where the × goes (by default the page itself without the flag). Resolves to the
 * mounted mark (null when framed); the pages keep it for their life.
 */
export function showDev(i18n: I18n, current: DevSurface | null, options: { doc?: Document; offHref?: string } = {}): Promise<DevChipHandle | null> {
  const doc = options.doc ?? document;
  const framed = isFramed(doc.defaultView ?? window);
  markDev(doc.documentElement, !framed);
  if (framed) return Promise.resolve(null);
  markSlot = true;
  return import('../experience/dev-chip').then(({ mountDevChip }) => mountDevChip({ i18n, current, doc, ...(options.offHref ? { offHref: options.offHref } : {}) }));
}

async function post<T>(path: string, fetchImpl: typeof fetch): Promise<T> {
  const response = await fetchImpl(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', cache: 'no-store' });
  const body = await response.json() as T & { error?: string };
  if (!response.ok || body.error) throw new Error(body.error ?? `dev-request-failed-${response.status}`);
  return body;
}

/** POST /api/dev/session: a session on this network's DEV screen, without a code (a ScanOk, as /api/scan answers). */
export function requestDevSession(fetchImpl: typeof fetch = fetch): Promise<ScanOk> {
  return post<ScanOk>('/api/dev/session', fetchImpl);
}

/** POST /api/dev/screen: this network's DEV screen for today, the same one on every call of the day. */
export function requestDevScreen(fetchImpl: typeof fetch = fetch): Promise<CreateBeaconResponse> {
  return post<CreateBeaconResponse>('/api/dev/screen', fetchImpl);
}

/** A localStorage view that keeps the wall's credentials under DEV_BEACON_KEY: a wall in DEV never overwrites its own screen. */
export function devScopedStorage(base: StorageLike, beaconKey: string): StorageLike {
  const key = (name: string): string => (name === beaconKey ? DEV_BEACON_KEY : name);
  return {
    getItem: (name) => base.getItem(key(name)),
    setItem: (name, value) => base.setItem(key(name), value),
    removeItem: (name) => base.removeItem(key(name)),
  };
}
