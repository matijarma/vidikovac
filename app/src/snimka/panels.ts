// The panel deck: faces that expand in place into their depth, one at a
// time (plan section 3.2). Lane V3 owns this file; V0 ships a stub deck that
// renders nothing.
import type { SnimkaContext } from './context';
import type { PanelDeck, PanelSpec } from './contracts';

export interface PanelDeckDeps { ctx: SnimkaContext; specs: PanelSpec[] }

export function createPanelDeck(root: HTMLElement, _deps: PanelDeckDeps): PanelDeck {
  root.dataset.snDeck = 'stub';
  return {
    expand() {},
    expanded: () => null,
    spot() {},
    destroy() { delete root.dataset.snDeck; },
  };
}
