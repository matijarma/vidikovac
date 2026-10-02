// Two SVG minimaps, now and the comparison day, drawn into an element the
// shell provides (plan section 3.3). Lane V2 owns this file; V0 ships a stub
// that draws nothing and returns a no-op teardown. Loaded beside map-layer.ts
// through a dynamic import, never on the entry graph.
import type { MountMinimaps } from './contracts';

export const mountMinimaps: MountMinimaps = (_ctx, host) => {
  host.dataset.snMinimaps = 'stub';
  return () => { delete host.dataset.snMinimaps; };
};
