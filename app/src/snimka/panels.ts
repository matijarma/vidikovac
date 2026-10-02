// The panel deck: faces that expand in place into their depth, one at a
// time (plan section 3.2). Each panel is one list item keyed by its id: a
// face (one real button with aria-expanded and aria-controls, at least
// 44 px) and a depth (a labelled region, built lazily when it first opens
// and torn down when it closes). The view store (ctx.view.panel) is the
// source of truth: expand() writes it, the deck follows it, so the address,
// the director and a feed item open a panel the same way a click does.
// Per-frame values go through the faces' updaters by textContent only; a
// structural change (expand, collapse) rebuilds the list's shells and
// reconciles them into the live list (app/src/ui/dom/reconcile.ts), the
// faces and depths moved into place by data-persist-for, never rebuilt.
import { reconcile } from '../ui/dom/reconcile';
import type { SnimkaContext } from './context';
import type { PanelDeck, PanelId, PanelSpec, ViewReason } from './contracts';
import { SN, fill } from './strings';

/** How long the director's pulse marks a datum (data-spot). */
export const SPOT_MS = 600;

/** Where each depth's "Više u odjeljku" leads: the dossier section that carries the panel's full story. */
export const DEEPER: Record<PanelId, string> = {
  vozila: '#tijek',
  mreza: '#tijek',
  bicikli: '#pokazuje',
};
/** The section a DEEPER link names in "Više u odjeljku „{section}”". */
const DEEPER_NAME: Record<string, string> = { '#tijek': SN.nav.strip, '#pokazuje': SN.nav.pokazuje };

type Attrs = Record<string, string | boolean | undefined>;

/** A small element factory shared by the shell's modules. */
export function el<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, attrs: Attrs = {}, ...children: (Node | string | null | undefined)[]): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (key === 'class') node.className = String(value);
    else if (key === 'text') node.textContent = String(value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children) if (child !== null && child !== undefined) node.append(child);
  return node;
}

export interface PanelDeckDeps {
  ctx: SnimkaContext;
  specs: PanelSpec[];
  /** After a panel opened or closed (the stage marks data-sn-expanded and resizes the map). */
  onExpand?: (id: PanelId | null, reason: ViewReason | undefined) => void;
  /** The real clock for the spot timer (tests inject one). */
  setTimeout?: (fn: () => void, ms: number) => unknown;
}

export interface PanelDeckHandle extends PanelDeck {
  /** Every face's per-frame updater. */
  update(t: number): void;
  /** The deck's list (for the stage's layout and the tests). */
  readonly root: HTMLElement;
}

interface Panel {
  spec: PanelSpec;
  item: HTMLLIElement;
  face: HTMLButtonElement;
  depth: HTMLElement;
  body: HTMLElement;
  heading: HTMLHeadingElement;
  update: (t: number) => void;
  teardown: (() => void) | null;
  /** Bumped on every open, so a depth that resolves after its panel closed tears itself down. */
  generation: number;
}

export function createPanelDeck(root: HTMLElement, deps: PanelDeckDeps): PanelDeckHandle {
  const { ctx } = deps;
  const doc = ctx.doc;
  const later = deps.setTimeout ?? ((fn: () => void, ms: number) => globalThis.setTimeout(fn, ms));
  const list = el(doc, 'ul', { class: 'sn-deck', role: 'list', 'aria-label': SN.panel.deckLabel, 'data-sn-deck': '' });
  const panels = new Map<PanelId, Panel>();
  let current: PanelId | null = null;
  let destroyed = false;

  for (const spec of deps.specs) {
    const id = spec.id;
    const face = el(doc, 'button', {
      type: 'button', class: 'sn-panel-face', id: `sn-face-${id}`, 'data-sn-face': id,
      'aria-expanded': 'false', 'aria-controls': `sn-depth-${id}`,
    });
    const heading = el(doc, 'h3', { class: 'sn-panel-heading', id: `sn-depth-h-${id}`, tabindex: '-1', text: spec.title });
    const back = el(doc, 'button', { type: 'button', class: 'btn-ghost sn-panel-back', 'data-sn-back': id, text: SN.panel.back });
    const body = el(doc, 'div', { class: 'sn-panel-body' });
    const deeper = el(doc, 'a', { class: 'sn-panel-deeper', href: DEEPER[id], text: fill(SN.panel.deeper, { section: DEEPER_NAME[DEEPER[id]] ?? SN.nav.strip }) });
    const depth = el(doc, 'section', { class: 'sn-panel-depth', id: `sn-depth-${id}`, role: 'region', 'aria-labelledby': heading.id, hidden: true },
      el(doc, 'div', { class: 'sn-panel-bar' }, heading, back), body, el(doc, 'p', { class: 'sn-panel-foot' }, deeper));
    const item = el(doc, 'li', { class: 'sn-deck-item', 'data-key': id, 'data-panel': id }, face, depth);
    const update = spec.mountFace(face);
    // A face its spec left without words still has a name: the panel's title.
    if (!face.textContent?.trim()) face.append(el(doc, 'span', { class: 'sn-panel-name', text: spec.title }));
    face.addEventListener('click', () => { deck.expand(current === id ? null : id, 'user'); });
    back.addEventListener('click', () => { deck.expand(null, 'user'); });
    panels.set(id, { spec, item, face, depth, body, heading, update, teardown: null, generation: 0 });
    list.append(item);
  }
  root.replaceChildren(list);

  /** The list's shells for a state: attributes on the items, the faces and depths as placeholders the reconciler fills. */
  function shells(open: PanelId | null): HTMLElement {
    const next = el(doc, 'ul', { class: 'sn-deck', role: 'list', 'aria-label': SN.panel.deckLabel, 'data-sn-deck': '', 'data-open': open ?? undefined });
    for (const [id] of panels) {
      next.append(el(doc, 'li', {
        class: 'sn-deck-item', 'data-key': id, 'data-panel': id,
        'data-expanded': open === id ? '' : undefined, 'data-dim': open !== null && open !== id ? '' : undefined,
      }, el(doc, 'div', { 'data-persist-for': `sn-face-${id}` }), el(doc, 'div', { 'data-persist-for': `sn-depth-${id}` })));
    }
    return next;
  }

  function close(p: Panel): void {
    p.generation += 1;
    p.face.setAttribute('aria-expanded', 'false');
    p.depth.hidden = true;
    p.teardown?.();
    p.teardown = null;
    p.body.replaceChildren();
  }

  function open(p: Panel): void {
    const generation = ++p.generation;
    p.face.setAttribute('aria-expanded', 'true');
    p.depth.hidden = false;
    let built: Promise<() => void> | (() => void);
    try { built = p.spec.mountDepth(p.body); } catch { built = () => {}; }
    if (typeof built === 'function') { p.teardown = built; return; }
    void built.then((off) => {
      if (generation !== p.generation || destroyed) off();
      else p.teardown = off;
    }, () => {});
  }

  function apply(next: PanelId | null, reason: ViewReason | undefined): void {
    if (next !== null && !panels.has(next)) next = null;
    if (next === current) return;
    const prev = current ? panels.get(current)! : null;
    const focusWasInside = prev ? prev.depth.contains(doc.activeElement) : false;
    if (prev) close(prev);
    current = next;
    const p = next ? panels.get(next)! : null;
    if (p) open(p);
    reconcile(list, shells(current));
    // Focus follows a reader who is in the deck; a subject set from the map or the dossier opens the panel without pulling focus.
    const inDeck = list.contains(doc.activeElement) || doc.activeElement === doc.body || doc.activeElement === null;
    if (p && reason === 'user' && inDeck) p.heading.focus();
    else if (!p && prev && (reason === 'user' || focusWasInside)) prev.face.focus();
    deps.onExpand?.(current, reason);
  }

  const onKey = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || current === null || event.defaultPrevented) return;
    event.preventDefault();
    event.stopPropagation();
    deck.expand(null, 'user');
  };
  list.addEventListener('keydown', onKey);

  const offView = ctx.view.onChange((state, _prev, reason) => { apply(state.panel, reason); });

  const deck: PanelDeckHandle = {
    root: list,
    expand(id, reason = 'user') {
      ctx.view.set({ panel: id }, reason);
      // A store that already held the value fires nothing; the deck still follows it.
      apply(ctx.view.get().panel, reason);
    },
    expanded: () => current,
    spot(id) {
      if (ctx.reducedMotion) return;
      const p = panels.get(id);
      if (!p) return;
      const target = p.spec.spotTarget?.() ?? p.face;
      target.dataset.spot = '';
      later(() => { delete target.dataset.spot; }, SPOT_MS);
    },
    update(t) {
      for (const p of panels.values()) p.update(t);
    },
    destroy() {
      destroyed = true;
      offView();
      list.removeEventListener('keydown', onKey);
      for (const p of panels.values()) if (p.teardown) { p.teardown(); p.teardown = null; }
      list.remove();
    },
  };

  apply(ctx.view.get().panel, 'address');
  return deck;
}

/** The Escape order of the stage: the first Escape anywhere in the stage closes an open panel; with none open it does nothing here. */
export function escapeClosesPanel(deck: Pick<PanelDeck, 'expanded' | 'expand'>, event: KeyboardEvent): boolean {
  if (event.key !== 'Escape' || deck.expanded() === null || event.defaultPrevented) return false;
  event.preventDefault();
  deck.expand(null, 'user');
  return true;
}
