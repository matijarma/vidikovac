// The simulated 1920 x 1080 wall layout the fitter tests measure with (the seed replay of U0 step 7,
// review.local/upgrade/fixtures-work/check.test.ts, and test/app/kiosk-timeline.test.ts WALL_1920): a title line holds
// `titleChars` characters, a sub line `subChars` (whole words, wrapped); a row is 44 px a title line, 32 px a sub line
// and 8 px of padding, never below the row budget. An event title stops at EVENT_TITLE_MAX_LINES, as the wall's
// line-clamp (app/src/ui/kiosk-city.css) stops it.
import { EVENT_TITLE_MAX_LINES, type TimelineMeasure } from '../../app/src/kiosk/timeline';

export interface Layout { boxPx: number; titleChars: number; subChars: number }
export const WALL_1920: Layout = { boxPx: 486, titleChars: 17, subChars: 26 };

/** How many lines `textIn` takes at `perLine` characters, whole words wrapped. */
export function wrapLines(textIn: string, perLine: number): number {
  if (!textIn) return 0;
  let lines = 1;
  let used = 0;
  for (const word of textIn.split(' ')) {
    const need = used === 0 ? word.length : used + 1 + word.length;
    if (need <= perLine) used = need;
    else { lines += 1; used = word.length; }
  }
  return lines;
}

/** The measure over `layout`; `section` is the timeline's section, whose --k-nearby-row is the row budget. */
export function simulated(section: () => HTMLElement, layout: Layout): TimelineMeasure & { rowHeight(li: Element): number; sum(list: Element): number } {
  const lines = (el: Element): number => {
    const title = el.classList.contains('nearby-title');
    const wrapped = wrapLines(el.textContent ?? '', title ? layout.titleChars : layout.subChars);
    const event = title && el.closest<HTMLElement>('li.nearby-row')?.dataset.kind === 'event';
    return event ? Math.min(EVENT_TITLE_MAX_LINES, wrapped) : wrapped;
  };
  const rowPx = (): number => Number.parseFloat(section().style.getPropertyValue('--k-nearby-row')) || 64;
  const rowHeight = (li: Element): number => Math.max(rowPx(), 44 * lines(li.querySelector('.nearby-title')!) + 32 * lines(li.querySelector('.nearby-sub')!) + 8);
  const sum = (list: Element): number => [...list.children].reduce((acc, li) => acc + rowHeight(li), 0);
  // The measuring list carries the box it is fitted in as its own height (timeline.ts fit), as the DOM measure reads it.
  const heightOf = (list: Element): number => Number.parseFloat((list as HTMLElement).style?.height ?? '') || layout.boxPx;
  return {
    box: (list) => ({ height: heightOf(list), width: layout.titleChars, overflow: sum(list) > heightOf(list) }),
    lines,
    rowHeight,
    sum,
  };
}
