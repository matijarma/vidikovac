// The phone form of the time band (newdesignsystem.md §4.2, plan A.4): the
// segmented control and the lane row are two views of one choice, the
// selected column in the view store. A tap on a segment goes through the
// dashboard's own `filter` action and re-renders the band; this controller
// adds the motion that render cannot, scrolling the lane row to the chosen
// lane, and the reverse: a swipe that settles on a lane presses its segment
// by setting the same filter. Both listeners sit on the shell root, so the
// lane row the reconciler replaces on a re-render needs no re-attachment:
// `scroll` does not bubble, but a capturing listener on an ancestor hears it.
// No intersection observer: a settle timer on the scroll event is the whole
// mechanism, and a DOM without layout (happy-dom, a desk where the segments
// are hidden and the row is a grid) has no width to divide by and does
// nothing. `scroll-behavior` is a decision made here, from the reader's motion
// preference and the lightweight path, never in CSS.
import { FILTER_KEY } from './timeband';

export interface TimebandSyncOptions {
  reducedMotion?: boolean;
  lightweight?: boolean;
}

export type FilterSetter = (key: string, value: string) => void;

/** Quiet time after the last scroll event before the lane under the finger is read as the choice. */
export const SCROLL_SETTLE_MS = 150;

const LANES = '.tb-lanes';
const SEGMENT = '.tb-seg-btn[data-filter-value]';

/** Attaches the controller to the shell root; the returned function removes every listener and drops a pending settle. */
export function attachTimebandSync(root: HTMLElement, setFilter: FilterSetter, options: TimebandSyncOptions = {}): () => void {
  const behavior: ScrollBehavior = options.reducedMotion || options.lightweight ? 'auto' : 'smooth';
  let settle: ReturnType<typeof setTimeout> | null = null;

  const laneIndex = (lanes: HTMLElement, col: string): number => Array.prototype.findIndex.call(lanes.children, (lane: Element) => lane.getAttribute('data-col') === col);

  const onClick = (event: Event): void => {
    const button = (event.target as Element | null)?.closest<HTMLElement>(SEGMENT);
    if (!button || !root.contains(button)) return;
    const lanes = root.querySelector<HTMLElement>(LANES);
    if (!lanes) return;
    const width = lanes.clientWidth;
    const index = laneIndex(lanes, button.dataset.filterValue ?? '');
    if (width <= 0 || index < 0) return;
    const left = index * width;
    if (typeof lanes.scrollTo === 'function') lanes.scrollTo({ left, behavior });
    else lanes.scrollLeft = left;
  };

  const settled = (lanes: HTMLElement): void => {
    const width = lanes.clientWidth;
    if (width <= 0) return;
    const col = lanes.children[Math.round(lanes.scrollLeft / width)]?.getAttribute('data-col');
    if (!col || col === lanes.getAttribute('data-col')) return;
    setFilter(FILTER_KEY, col);
  };

  const onScroll = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof Element) || !target.matches(LANES)) return;
    if (settle !== null) clearTimeout(settle);
    settle = setTimeout(() => {
      settle = null;
      settled(target as HTMLElement);
    }, SCROLL_SETTLE_MS);
  };

  root.addEventListener('click', onClick);
  root.addEventListener('scroll', onScroll, true);
  return () => {
    root.removeEventListener('click', onClick);
    root.removeEventListener('scroll', onScroll, true);
    if (settle !== null) {
      clearTimeout(settle);
      settle = null;
    }
  };
}
