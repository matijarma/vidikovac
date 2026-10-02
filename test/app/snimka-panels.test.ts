// The panel deck (app/src/snimka/panels.ts): one panel open at a time, the
// others dimmed and still ticking; the view store is the truth (an address
// or a director opens a panel the same way a click does); focus moves to the
// depth's heading and back to the face; Escape closes; a rebuild of the
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

const IDS: PanelId[] = ['stanje', 'vozila', 'linije', 'mreza', 'bicikli', 'vrijeme', 'poglavlja'];

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
  it('renders seven faces as buttons that control their depths, all closed', () => {
    setup();
    const faces = [...document.querySelectorAll<HTMLButtonElement>('.sn-panel-face')];
    expect(faces.map((f) => f.dataset.snFace)).toEqual(IDS);
    for (const f of faces) {
      expect(f.tagName).toBe('BUTTON');
      expect(f.getAttribute('aria-expanded')).toBe('false');
      const depth = document.getElementById(f.getAttribute('aria-controls')!)!;
      expect(depth.getAttribute('role')).toBe('region');
      expect(depth.getAttribute('aria-labelledby')).toBe(depth.querySelector('h3')!.id);
      expect(depth.hidden).toBe(true);
    }
    expect(document.querySelectorAll('.sn-deck-item[data-key]')).toHaveLength(7);
  });
  it('opens one panel at a time; the others dim and keep ticking; the view store holds the panel', () => {
    const { deck, view, ticks, depths, onExpand } = setup();
    face('stanje').click();
    expect(view.get().panel).toBe('stanje');
    expect(deck.expanded()).toBe('stanje');
    expect(item('stanje').hasAttribute('data-expanded')).toBe(true);
    expect(document.querySelectorAll('.sn-deck-item[data-dim]')).toHaveLength(6);
    expect(depths.stanje).toEqual({ built: 1, torn: 0 });
    face('vozila').click();
    expect(deck.expanded()).toBe('vozila');
    expect(depths.stanje).toEqual({ built: 1, torn: 1 });
    expect(document.querySelectorAll('.sn-deck-item[data-expanded]')).toHaveLength(1);
    expect(document.querySelector<HTMLElement>('#sn-depth-stanje')!.hidden).toBe(true);
    deck.update(1000);
    expect(Object.keys(ticks).sort()).toEqual([...IDS].sort());
    expect(onExpand).toHaveBeenLastCalledWith('vozila', 'user');
    // A click on the open face closes it.
    face('vozila').click();
    expect(deck.expanded()).toBeNull();
    expect(document.querySelectorAll('.sn-deck-item[data-dim]')).toHaveLength(0);
  });
  it('moves the focus to the depth heading and back to the face on close; Escape closes', () => {
    setup();
    face('linije').focus();
    face('linije').click();
    expect(document.activeElement).toBe(document.getElementById('sn-depth-h-linije'));
    document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.activeElement).toBe(face('linije'));
    expect(face('linije').getAttribute('aria-expanded')).toBe('false');
    face('linije').click();
    document.querySelector<HTMLButtonElement>('[data-sn-back="linije"]')!.click();
    expect(document.activeElement).toBe(face('linije'));
  });
  it('follows the view store without pulling focus: an address or a director opens a panel too', () => {
    const { deck, view } = setup({ panel: 'bicikli' });
    expect(deck.expanded()).toBe('bicikli');
    expect(document.activeElement).toBe(document.body);
    view.set({ panel: 'vrijeme' }, 'director');
    expect(deck.expanded()).toBe('vrijeme');
    expect(document.activeElement).not.toBe(document.getElementById('sn-depth-h-vrijeme'));
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
    face('stanje').click();
    face('stanje').click();
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
    const deck = createPanelDeck(host, { ctx, specs: [{ id: 'poglavlja', title: 'Poglavlja', mountFace: () => () => {}, mountDepth: () => torn }] });
    expect(face('poglavlja').textContent).toBe('Poglavlja');
    deck.expand('poglavlja');
    deck.destroy();
    expect(torn).toHaveBeenCalledTimes(1);
    expect(host.querySelector('.sn-deck')).toBeNull();
  });
});

describe('the panel key in the address', () => {
  it('round-trips every panel and writes nothing for a closed deck', () => {
    for (const panel of IDS) {
      const url = writeAddress({ t: Date.UTC(2026, 8, 28, 5, 45), speed: 600, compare: true, panel, subject: null, live: true, following: true }, () => {}, { pathname: '/snimka/', search: '', hash: '' });
      expect(url).toContain(`panel=${panel}`);
      expect(readAddress(url.slice(url.indexOf('?'))).panel).toBe(panel);
    }
    const closed = writeAddress({ t: Date.UTC(2026, 8, 28, 5, 45), speed: 600, compare: true, panel: null, subject: null, live: true, following: true }, () => {}, { pathname: '/snimka/', search: '', hash: '' });
    expect(closed).not.toContain('panel=');
    expect(readAddress('?panel=nepoznato').panel).toBeNull();
  });
});
