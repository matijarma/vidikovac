// Keyed DOM reconciliation. A workspace renderer returns a fresh tree; this
// morphs the live tree towards it and keeps every live node that still
// matches, so focus, typed input, scroll position, an open <details> and a
// live map container survive a poll. Nodes marked `data-persist` belong to a
// controller elsewhere (MapLibre, the schematic host) and are moved into
// place, never diffed. Nodes marked `data-replace` are swapped wholesale when
// their `data-sig` changes (SVG graphics), and otherwise left alone.
const PERSIST = 'data-persist';
const REPLACE = 'data-replace';
const SIG = 'data-sig';
const KEY = 'data-key';
const PERSIST_FOR = 'data-persist-for';

function keyOf(node: Node): string | null {
  if (!(node instanceof Element)) return null;
  return node.getAttribute(KEY) ?? (node.id ? `#${node.id}` : null);
}

function sameKind(a: Node, b: Node): boolean {
  if (a.nodeType !== b.nodeType) return false;
  if (!(a instanceof Element) || !(b instanceof Element)) return true;
  return a.tagName === b.tagName && a.namespaceURI === b.namespaceURI;
}

type FormControl = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

function formControl(el: Element): FormControl | null {
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement ? el : null;
}

/** Attributes that carry user state the renderer does not own. */
function isUserState(el: Element, name: string): boolean {
  if (name === 'open' && el.tagName === 'DETAILS') return true;
  if (formControl(el) && (name === 'value' || name === 'checked')) return el === el.ownerDocument.activeElement;
  return false;
}

export function syncAttributes(from: Element, to: Element): void {
  for (const attr of [...from.attributes]) {
    if (!to.hasAttribute(attr.name) && !isUserState(from, attr.name)) from.removeAttribute(attr.name);
  }
  for (const attr of [...to.attributes]) {
    if (isUserState(from, attr.name)) continue;
    if (from.getAttribute(attr.name) !== attr.value) from.setAttribute(attr.name, attr.value);
  }
  const fromControl = formControl(from);
  const toControl = formControl(to);
  if (fromControl && toControl && from !== from.ownerDocument.activeElement) {
    if (fromControl.value !== toControl.value) fromControl.value = toControl.value;
    if (fromControl instanceof HTMLInputElement && toControl instanceof HTMLInputElement && fromControl.checked !== toControl.checked) fromControl.checked = toControl.checked;
  }
}

/** Morphs `from` into the shape of `to`; `to` is consumed and must not be reused. */
export function morph(from: Element, to: Element): Element {
  if (from === to) return from;
  if (!sameKind(from, to) || to.hasAttribute(PERSIST)) {
    from.replaceWith(to);
    return to;
  }
  if (to.hasAttribute(REPLACE)) {
    if (from.getAttribute(SIG) === to.getAttribute(SIG) && from.hasAttribute(REPLACE)) {
      syncAttributes(from, to);
      return from;
    }
    from.replaceWith(to);
    return to;
  }
  syncAttributes(from, to);
  reconcileChildren(from, to);
  return from;
}

/**
 * Puts `node` before `before`. When `node` holds the focused element it stays
 * where it is (moving it would blur it in a real browser) and the nodes in
 * the way are moved behind it instead, which yields the same order.
 */
function place(parent: Element, node: Node, before: Node | null): void {
  const active = parent.ownerDocument.activeElement;
  if (!active || !node.contains(active) || node === active && node === before) {
    parent.insertBefore(node, before);
    return;
  }
  const after = node.nextSibling;
  let cursor: Node | null = before;
  while (cursor && cursor !== node) {
    const following: Node | null = cursor.nextSibling;
    parent.insertBefore(cursor, after);
    cursor = following;
  }
}

/** Reconciles the children of `from` against the children of `to`, in place. */
export function reconcileChildren(from: Element, to: Element): void {
  const keyed = new Map<string, Element>();
  for (const child of from.children) {
    const key = keyOf(child);
    if (key !== null && !keyed.has(key)) keyed.set(key, child);
  }
  const wanted = [...to.childNodes];
  for (let index = 0; index < wanted.length; index += 1) {
    const next = wanted[index]!;
    const current = from.childNodes[index] ?? null;
    if (next instanceof Element && next.hasAttribute(PERSIST)) {
      if (current !== next) place(from, next, current);
      continue;
    }
    if (next instanceof Element && next.hasAttribute(PERSIST_FOR)) {
      // A placeholder for a live node the renderer never detached (a map).
      const live = from.ownerDocument.getElementById(next.getAttribute(PERSIST_FOR)!);
      if (live) {
        if (live !== current) place(from, live, current);
        continue;
      }
    }
    const key = keyOf(next);
    if (key !== null) {
      const match = keyed.get(key);
      if (match && sameKind(match, next as Element)) {
        keyed.delete(key);
        if (match !== current) place(from, match, current);
        morph(match, next as Element);
        continue;
      }
      from.insertBefore(next, current);
      continue;
    }
    if (current && sameKind(current, next) && keyOf(current) === null) {
      if (current instanceof Element) morph(current, next as Element);
      else if (current.nodeValue !== next.nodeValue) current.nodeValue = next.nodeValue;
      continue;
    }
    from.insertBefore(next, current);
  }
  while (from.childNodes.length > wanted.length) from.removeChild(from.lastChild!);
}

/**
 * Renders `next` into `live` by reconciliation and returns whether the
 * previously focused element is still in the document.
 */
export function reconcile(live: Element, next: Element): boolean {
  const doc = live.ownerDocument;
  const focused = doc.activeElement;
  const focusId = focused instanceof HTMLElement ? focused.id : '';
  reconcileChildren(live, next);
  if (focused && !doc.contains(focused) && focusId) {
    doc.getElementById(focusId)?.focus();
    return false;
  }
  return true;
}
