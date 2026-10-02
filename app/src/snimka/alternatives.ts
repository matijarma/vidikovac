// Zamjene: the BAJS stations that emptied first, the train in the screen's
// header, line 228 by the hour, what the press recorded (plan section 4).
// Lane V5 owns this file; V0 ships a stub that clears the mount's busy mark.
import type { Mount } from './context';

export const mountAlternatives: Mount = (_ctx, root) => {
  root.dataset.snAlternatives = 'stub';
  root.removeAttribute('aria-busy');
  return () => { delete root.dataset.snAlternatives; };
};
