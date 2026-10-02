// The voices feed: ZET, the court, the press, the chapters and the companion
// itself, in time order, filling as the clock passes (plan section 3.4).
// Lane V4 owns this file; V0 ships a stub that renders nothing.
import type { MountPanel } from './contracts';

export const mountVoicesFeed: MountPanel = (_ctx, root) => {
  root.dataset.snFeed = 'stub';
  return () => { delete root.dataset.snFeed; };
};
