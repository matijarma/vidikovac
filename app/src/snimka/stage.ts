// The stage of /snimka/: the map, the clock plate, the controls, the scrubber
// and the side column. Lane S2 replaces this file; until then the mount only
// marks its root as ready so the page never stays busy.
import type { Mount } from './context';

export const mountStage: Mount = (_ctx, root) => {
  root.removeAttribute('aria-busy');
  return () => {};
};
