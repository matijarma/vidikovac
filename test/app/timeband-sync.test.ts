// @vitest-environment happy-dom
// The phone's two ways of choosing a column stay one choice (plan A.4, A.8):
// a segment tap scrolls the lane row to that lane; a swipe that settles on a
// lane presses its segment through the view store. Delegated from the shell
// root so the lane row the reconciler replaces on a re-render needs no
// re-attachment, and guarded so a DOM without layout (happy-dom, a desk where
// the segments are hidden) scrolls nothing and selects nothing.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { attachTimebandSync, SCROLL_SETTLE_MS } from '../../app/src/experience/timeband-sync';

const COLS = ['sada', 'danas', 'veceras', 'sutra', 'tjedan'] as const;
const WIDTH = 390;

function mount(selected: string = 'sada') {
  document.body.innerHTML = `<div id="root"><section class="ws">`
    + `<div class="tb-seg" role="group" data-key="tb-seg" data-col="${selected}">`
    + COLS.map((c) => `<button type="button" class="tb-seg-btn" data-action="filter" data-filter-key="tb-col" data-filter-value="${c}" aria-pressed="${c === selected}"><span>${c}</span></button>`).join('')
    + `</div><section class="tb" data-cols="5"><div class="tb-lanes" data-key="lanes" data-col="${selected}">`
    + COLS.map((c) => `<div class="tb-lane" data-col="${c}"></div>`).join('')
    + `</div></section></section></div>`;
  const root = document.getElementById('root')!;
  const lanes = root.querySelector<HTMLElement>('.tb-lanes')!;
  Object.defineProperty(lanes, 'clientWidth', { value: WIDTH, configurable: true });
  const scrollTo = vi.fn();
  lanes.scrollTo = scrollTo as never;
  const setFilter = vi.fn();
  return { root, lanes, scrollTo, setFilter };
}
const button = (root: HTMLElement, col: string): HTMLElement => root.querySelector<HTMLElement>(`.tb-seg-btn[data-filter-value="${col}"]`)!;
const swipeTo = (lanes: HTMLElement, left: number): void => {
  lanes.scrollLeft = left;
  lanes.dispatchEvent(new Event('scroll'));
};

describe('attachTimebandSync: a segment tap scrolls the lane row', () => {
  it('scrolls to index × clientWidth, smoothly by default', () => {
    const { root, scrollTo, setFilter } = mount();
    attachTimebandSync(root, setFilter);
    button(root, 'sutra').click();
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith({ left: 3 * WIDTH, behavior: 'smooth' });
    button(root, 'sada').click();
    expect(scrollTo).toHaveBeenLastCalledWith({ left: 0, behavior: 'smooth' });
    // The choice itself travels through the dashboard's own filter action, not through this controller.
    expect(setFilter).not.toHaveBeenCalled();
  });
  it('scrolls without animation under reduced motion and on the lightweight path', () => {
    for (const options of [{ reducedMotion: true }, { lightweight: true }, { reducedMotion: true, lightweight: true }]) {
      const { root, scrollTo, setFilter } = mount();
      attachTimebandSync(root, setFilter, options);
      button(root, 'veceras').click();
      expect(scrollTo, JSON.stringify(options)).toHaveBeenCalledWith({ left: 2 * WIDTH, behavior: 'auto' });
    }
  });
  it('scrolls nothing where the lane row has no width (no layout, or a desk that hides the segments), and ignores other clicks', () => {
    const { root, lanes, scrollTo, setFilter } = mount();
    Object.defineProperty(lanes, 'clientWidth', { value: 0, configurable: true });
    attachTimebandSync(root, setFilter);
    button(root, 'sutra').click();
    expect(scrollTo).not.toHaveBeenCalled();
    Object.defineProperty(lanes, 'clientWidth', { value: WIDTH, configurable: true });
    root.querySelector<HTMLElement>('.tb-lane')!.click();
    expect(scrollTo).not.toHaveBeenCalled();
  });
});

describe('attachTimebandSync: a settled swipe selects the lane under the finger', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('reads the lane after 150 ms of quiet and sets the filter once, whatever the number of scroll events before it', () => {
    const { root, lanes, setFilter } = mount();
    attachTimebandSync(root, setFilter);
    swipeTo(lanes, 300);
    swipeTo(lanes, 600);
    vi.advanceTimersByTime(SCROLL_SETTLE_MS - 1);
    swipeTo(lanes, 2 * WIDTH);
    vi.advanceTimersByTime(SCROLL_SETTLE_MS - 1);
    expect(setFilter).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(setFilter).toHaveBeenCalledTimes(1);
    expect(setFilter).toHaveBeenCalledWith('tb-col', 'veceras');
    vi.advanceTimersByTime(1000);
    expect(setFilter).toHaveBeenCalledTimes(1);
  });
  it('rounds to the nearest lane, so a snap that lands a few pixels off still names the right column', () => {
    const { root, lanes, setFilter } = mount();
    attachTimebandSync(root, setFilter);
    swipeTo(lanes, 3 * WIDTH + 7);
    vi.advanceTimersByTime(SCROLL_SETTLE_MS);
    expect(setFilter).toHaveBeenCalledWith('tb-col', 'sutra');
  });
  it('sets nothing when the settled lane is the column already selected', () => {
    const { root, lanes, setFilter } = mount('veceras');
    attachTimebandSync(root, setFilter);
    swipeTo(lanes, 2 * WIDTH);
    vi.advanceTimersByTime(SCROLL_SETTLE_MS);
    expect(setFilter).not.toHaveBeenCalled();
  });
  it('sets nothing without a width to divide by, and nothing for a scroll elsewhere in the shell', () => {
    const { root, lanes, setFilter } = mount();
    attachTimebandSync(root, setFilter);
    Object.defineProperty(lanes, 'clientWidth', { value: 0, configurable: true });
    swipeTo(lanes, 780);
    vi.advanceTimersByTime(SCROLL_SETTLE_MS);
    expect(setFilter).not.toHaveBeenCalled();
    Object.defineProperty(lanes, 'clientWidth', { value: WIDTH, configurable: true });
    const other = root.querySelector<HTMLElement>('.tb-seg')!;
    other.scrollLeft = 780;
    other.dispatchEvent(new Event('scroll'));
    vi.advanceTimersByTime(SCROLL_SETTLE_MS);
    expect(setFilter).not.toHaveBeenCalled();
  });
  it('still hears a lane row the reconciler replaced after attach: the listener sits on the shell root, not on the row', () => {
    const { root, lanes, setFilter } = mount();
    attachTimebandSync(root, setFilter);
    const fresh = lanes.cloneNode(true) as HTMLElement;
    Object.defineProperty(fresh, 'clientWidth', { value: WIDTH, configurable: true });
    lanes.replaceWith(fresh);
    swipeTo(fresh, 4 * WIDTH);
    vi.advanceTimersByTime(SCROLL_SETTLE_MS);
    expect(setFilter).toHaveBeenCalledWith('tb-col', 'tjedan');
  });
  it('dispose removes both listeners and drops a pending settle', () => {
    const { root, lanes, scrollTo, setFilter } = mount();
    const dispose = attachTimebandSync(root, setFilter);
    swipeTo(lanes, 2 * WIDTH);
    dispose();
    vi.advanceTimersByTime(SCROLL_SETTLE_MS * 2);
    expect(setFilter).not.toHaveBeenCalled();
    button(root, 'sutra').click();
    expect(scrollTo).not.toHaveBeenCalled();
    swipeTo(lanes, 3 * WIDTH);
    vi.advanceTimersByTime(SCROLL_SETTLE_MS * 2);
    expect(setFilter).not.toHaveBeenCalled();
  });
});

describe('attachTimebandSync: what it is built from', () => {
  it('never references IntersectionObserver: the settle timer on the scroll event is the whole mechanism', () => {
    const source = readFileSync(join(import.meta.dirname, '..', '..', 'app', 'src', 'experience', 'timeband-sync.ts'), 'utf8');
    expect(source).not.toContain('IntersectionObserver');
    expect(source).toContain("addEventListener('scroll'");
  });
});
