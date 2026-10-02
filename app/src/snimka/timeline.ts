// The timeline bar: play, chapters, speed, the scrubber, the compressed
// fleet lane with the state band and three tick lanes (plan section 3.1).
// Lane V3 owns this file; V0 keeps the v1 controls inside stage.ts and
// ships a stub here.
import type { SnimkaContext } from './context';
import type { TimelineMarker } from './contracts';

export function mountTimeline(_ctx: SnimkaContext, root: HTMLElement, _markers: readonly TimelineMarker[]): () => void {
  root.dataset.snTimeline = 'stub';
  return () => { delete root.dataset.snTimeline; };
}
