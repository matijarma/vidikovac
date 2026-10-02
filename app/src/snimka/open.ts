// Otvoreni podaci iz snimke: the signals table, the downloads from
// manifest.files.exports, the catalogue line, reproducibility (plan section
// 4). Lane V5 owns this file; V0 ships a stub that clears the mount's busy mark.
import type { Mount } from './context';

export const mountOpen: Mount = (_ctx, root) => {
  root.dataset.snOpen = 'stub';
  root.removeAttribute('aria-busy');
  return () => { delete root.dataset.snOpen; };
};
