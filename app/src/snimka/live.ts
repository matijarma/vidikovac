// The card "I danas": the one live read of the page, fetch('/api/teaser')
// once when the card enters the viewport (decision S-10). Lane V5 owns this
// file; V0 ships a stub that reads nothing. This is the only file under
// app/src/snimka/ that may name /api/teaser (test/app/pages.test.ts).
import type { Mount } from './context';

export const mountLive: Mount = (_ctx, root) => {
  root.dataset.snLive = 'stub';
  root.removeAttribute('aria-busy');
  return () => { delete root.dataset.snLive; };
};
