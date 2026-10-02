// The heatmap "Sve linije, svaki sat": one rect per route and hour (plan
// section 3.6). Lane V3 owns this file; V0 ships a stub that draws nothing.
import type { SnimkaContext } from './context';

export function mountHeatmap(_ctx: SnimkaContext, root: HTMLElement): () => void {
  root.dataset.snHeatmap = 'stub';
  return () => { delete root.dataset.snHeatmap; };
}
