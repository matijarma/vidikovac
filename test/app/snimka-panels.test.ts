// The panel deck (app/src/snimka/panels.ts, V3-15): three faces in one
// column, one panel open at a time, never reordered and never dimmed, the
// others still ticking; one "Zatvori"; the opened panel scrolled into view; the view store is the truth (an address
// or a director opens a panel the same way a click does); focus moves to the
// face (the open face is the header) and back to it from the depth; Escape closes; a rebuild of the
// list's shells keeps the very face and depth nodes (data-persist-for), and
// the stage's map host survives a reconcile (data-persist); the panel key
// round-trips through the address.
// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { readAddress, writeAddress } from '../../app/src/snimka/address';
import { createViewStore, type SnimkaContext } from '../../app/src/snimka/context';
import type { PanelId, PanelSpec } from '../../app/src/snimka/contracts';
import { createPanelDeck, escapeClosesPanel, SPOT_MS } from '../../app/src/snimka/panels';
import { reconcile } from '../../app/src/ui/dom/reconcile';

const IDS: PanelId[] = ['vozila', 'mreza', 'bicikli'];

function setup(o: { panel?: PanelId | null; reducedMotion?: boolean } = {}) {
  const view = createViewStore({ panel: o.panel ?? null });
  const ctx = { view, doc: document, reducedMotion: o.reducedMotion ?? false } as unknown as SnimkaContext;
  const ticks: Record<string, number> = {};
  const depths: Record<string, { built: number; torn: number }> = {};
  const specs: PanelSpec[] = IDS.map((id) => ({
    id,
    title: id.toUpperCase(),
    mountFace: (face) => {
      const fig = document.createElement('span');
      fig.className = 'fig';
      fig.textContent = id;
      face.append(fig);
      return () => { ticks[id] = (ticks[id] ?? 0) + 1; };
    },
    mountDepth: (el) => {
      const d = (depths[id] ??= { built: 0, torn: 0 });
      d.built += 1;
      el.append(Object.assign(document.createElement('p'), { textContent: `${id} depth` }));
      return () => { d.torn += 1; };
    },
    spotTarget: () => document.querySelector<HTMLElement>(`[data-sn-face="${id}"] .fig`),
  }));
  const host = document.createElement('div');
  document.body.replaceChildren(host);
  const onExpand = vi.fn();
  const timers: (() => void)[] = [];
  const deck = createPanelDeck(host, { ctx, specs, onExpand, setTimeout: (fn) => { timers.push(fn); return 0; } });
  return { deck, view, host, ticks, depths, onExpand, timers };
}

const face = (id: PanelId) => document.querySelector<HTMLButtonElement>(`[data-sn-face="${id}"]`)!;
const item = (id: PanelId) => document.querySelector<HTMLElement>(`.sn-deck-item[data-key="${id}"]`)!;

describe('createPanelDeck', () => {
  it('renders three faces as buttons that control their depths, all closed', () => {
    setup();
    const faces = [...document.querySelectorAll<HTMLButtonElement>('.sn-panel-face')];
    expect(faces.map((f) => f.dataset.snFace)).toEqual(IDS);
    for (const f of faces) {
      expect(f.tagName).toBe('BUTTON');
      expect(f.getAttribute('aria-expanded')).toBe('false');
      const depth = document.getElementById(f.getAttribute('aria-controls')!)!;
      expect(depth.getAttribute('role')).toBe('region');
      expect(depth.getAttribute('aria-labelledby')).toBe(depth.querySelector('h3')!.id);
      expect(depth.querySelector('h3')!.classList.contains('visually-hidden')).toBe(true);
      expect([...depth.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Zatvori']);
      expect(depth.querySelector('a.sn-panel-deeper')!.textContent).toMatch(/^Više u odjeljku „(Tijek|Što snimka pokazuje)”$/);
      expect(depth.hidden).toBe(true);
    }
    expect(document.querySelectorAll('.sn-deck-item[data-key]')).toHaveLength(3);
  });
  it('opens one panel at a time in place: no reorder, no dimming, the others keep ticking; the view store holds the panel', () => {
    const { deck, view, ticks, depths, onExpand } = setup();
    face('mreza').click();
    expect(view.get().panel).toBe('mreza');
    expect(deck.expanded()).toBe('mreza');
    expect(item('mreza').hasAttribute('data-expanded')).toBe(true);
    expect(document.querySelectorAll('[data-dim]')).toHaveLength(0);
    expect([...document.querySelectorAll<HTMLElement>('.sn-deck-item')].map((li) => li.dataset.key)).toEqual(IDS);
    expect(depths.mreza).toEqual({ built: 1, torn: 0 });
    face('vozila').click();
    expect(deck.expanded()).toBe('vozila');
    expect(depths.mreza).toEqual({ built: 1, torn: 1 });
    expect(document.querySelectorAll('.sn-deck-item[data-expanded]')).toHaveLength(1);
    expect(document.querySelector<HTMLElement>('#sn-depth-mreza')!.hidden).toBe(true);
    deck.update(1000);
    expect(Object.keys(ticks).sort()).toEqual([...IDS].sort());
    expect(onExpand).toHaveBeenLastCalledWith('vozila', 'user');
    // A click on the open face closes it.
    face('vozila').click();
    expect(deck.expanded()).toBeNull();
    expect([...document.querySelectorAll<HTMLElement>('.sn-deck-item')].map((li) => li.dataset.key)).toEqual(IDS);
  });
  it('the focus stays on the open face (the header), moves into the depth, and Zatvori or Escape give it back to the face', () => {
    setup();
    face('mreza').focus();
    face('mreza').click();
    expect(document.activeElement).toBe(face('mreza'));
    expect(face('mreza').getAttribute('aria-expanded')).toBe('true');
    const close = document.querySelector<HTMLButtonElement>('[data-sn-back="mreza"]')!;
    close.focus();
    close.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.activeElement).toBe(face('mreza'));
    expect(face('mreza').getAttribute('aria-expanded')).toBe('false');
    face('mreza').click();
    close.focus();
    close.click();
    expect(document.activeElement).toBe(face('mreza'));
    expect(document.querySelector<HTMLElement>('#sn-depth-mreza')!.hidden).toBe(true);
  });
  it('scrolls the opened panel into view (nearest) when a reader opens it, never from the address', () => {
    const calls: { id: string; opts: unknown }[] = [];
    const proto = HTMLElement.prototype as unknown as { scrollIntoView: (o?: unknown) => void };
    const original = proto.scrollIntoView;
    proto.scrollIntoView = function (this: HTMLElement, opts?: unknown) { calls.push({ id: this.dataset.key ?? '', opts }); };
    try {
      setup({ panel: 'bicikli' });
      expect(calls).toEqual([]);
      face('vozila').click();
      expect(calls).toEqual([{ id: 'vozila', opts: { block: 'nearest', inline: 'nearest', behavior: 'smooth' } }]);
    } finally { proto.scrollIntoView = original; }
  });
  it('the swipe row on a phone starts at its first card after mount (scrollLeft 0)', () => {
    const view = createViewStore();
    const ctx = { view, doc: document, reducedMotion: false } as unknown as SnimkaContext;
    const row = document.createElement('div');
    row.className = 'sn-deck-row';
    const host = document.createElement('div');
    row.append(host, Object.assign(document.createElement('div'), { className: 'feed' }));
    document.body.replaceChildren(row);
    Object.defineProperty(row, 'scrollWidth', { configurable: true, value: 2400 });
    Object.defineProperty(row, 'clientWidth', { configurable: true, value: 390 });
    row.scrollLeft = 2373;
    createPanelDeck(host, { ctx, specs: IDS.map((id) => ({ id, title: id, mountFace: () => () => {}, mountDepth: () => () => {} })) });
    expect(row.scrollLeft).toBe(0);
  });
  it('follows the view store without pulling focus: an address or a director opens a panel too', () => {
    const { deck, view } = setup({ panel: 'bicikli' });
    expect(deck.expanded()).toBe('bicikli');
    expect(document.activeElement).toBe(document.body);
    view.set({ panel: 'vozila' }, 'director');
    expect(deck.expanded()).toBe('vozila');
    expect(document.activeElement).not.toBe(document.getElementById('sn-depth-h-vozila'));
    const stage = document.createElement('div');
    const ev = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
    stage.dispatchEvent(ev);
    expect(escapeClosesPanel(deck, ev)).toBe(true);
    expect(deck.expanded()).toBeNull();
    expect(escapeClosesPanel(deck, new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }))).toBe(false);
  });
  it('a rebuild keeps the very face and depth nodes, and a stage reconcile keeps the persisted map host', () => {
    setup();
    const faces = IDS.map((id) => face(id));
    const depthNodes = IDS.map((id) => document.getElementById(`sn-depth-${id}`));
    face('mreza').click();
    face('vozila').click();
    face('vozila').click();
    expect(IDS.map((id) => face(id))).toEqual(faces);
    expect(IDS.map((id) => document.getElementById(`sn-depth-${id}`))).toEqual(depthNodes);
    // The stage: a map host marked data-persist is moved into place by reconcile, never rebuilt.
    const live = document.createElement('div');
    const map = Object.assign(document.createElement('div'), { id: 'sn-map' });
    map.setAttribute('data-persist', '');
    live.append(map);
    document.body.append(live);
    const next = document.createElement('div');
    const placeholder = document.createElement('div');
    placeholder.setAttribute('data-persist-for', 'sn-map');
    next.append(Object.assign(document.createElement('p'), { textContent: 'plate' }), placeholder);
    reconcile(live, next);
    expect(live.querySelector('#sn-map')).toBe(map);
    expect(live.firstElementChild!.tagName).toBe('P');
  });
  it('spot marks the datum for 600 ms, and not at all under reduced motion', () => {
    const { deck, timers } = setup();
    deck.spot('vozila');
    const fig = document.querySelector<HTMLElement>('[data-sn-face="vozila"] .fig')!;
    expect(fig.hasAttribute('data-spot')).toBe(true);
    expect(SPOT_MS).toBe(600);
    timers.shift()!();
    expect(fig.hasAttribute('data-spot')).toBe(false);
    const quiet = setup({ reducedMotion: true });
    quiet.deck.spot('vozila');
    expect(document.querySelector('[data-sn-face="vozila"] .fig')!.hasAttribute('data-spot')).toBe(false);
  });
  it('a spec that leaves its face empty still gets a name; destroy tears an open depth down', () => {
    const view = createViewStore();
    const torn = vi.fn();
    const ctx = { view, doc: document, reducedMotion: false } as unknown as SnimkaContext;
    const host = document.createElement('div');
    document.body.replaceChildren(host);
    const deck = createPanelDeck(host, { ctx, specs: [{ id: 'mreza', title: 'Mreža', mountFace: () => () => {}, mountDepth: () => torn }] });
    expect(face('mreza').textContent).toBe('Mreža');
    deck.expand('mreza');
    deck.destroy();
    expect(torn).toHaveBeenCalledTimes(1);
    expect(host.querySelector('.sn-deck')).toBeNull();
  });
});

describe('the panel key in the address', () => {
  it('round-trips every panel and writes nothing for a closed deck', () => {
    for (const panel of IDS) {
      const url = writeAddress({ t: Date.UTC(2026, 8, 28, 5, 45), speed: 600, compare: true, panel, subject: null, following: true }, () => {}, { pathname: '/snimka/', search: '', hash: '' });
      expect(url).toContain(`panel=${panel}`);
      expect(readAddress(url.slice(url.indexOf('?'))).panel).toBe(panel);
    }
    const closed = writeAddress({ t: Date.UTC(2026, 8, 28, 5, 45), speed: 600, compare: true, panel: null, subject: null, following: true }, () => {}, { pathname: '/snimka/', search: '', hash: '' });
    expect(closed).not.toContain('panel=');
    expect(readAddress('?panel=nepoznato').panel).toBeNull();
  });
});
