// The subtitle band at the map's foot: the observed reading where a run
// covers the minute, else the replayed sentence, held 1,200 ms (plan section
// 3.4). Lane V4 owns this file; V0 ships a stub that shows nothing.
import type { MountSubtitle } from './contracts';

export const mountSubtitle: MountSubtitle = (_ctx, root) => {
  root.dataset.snSubtitle = 'stub';
  return {
    update() {},
    destroy() { delete root.dataset.snSubtitle; },
  };
};
