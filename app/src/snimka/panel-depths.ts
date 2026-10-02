// The depths of the deck: the state band with the thresholds in words, the
// seen vs expected plots, the heatmap, the minimaps, the station list, the
// temperature line (plan section 3.2). Lane V3 owns this file; V0 ships a
// stub that mounts nothing.
import type { SnimkaContext } from './context';
import type { PanelId } from './contracts';

export function mountPanelDepth(_ctx: SnimkaContext, _id: PanelId, _el: HTMLElement): () => void {
  return () => {};
}
