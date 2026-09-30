// The simulated 1920 x 1080 wall layout the fitter tests measure with (the seed replay of U0 step 7,
// review.local/upgrade/fixtures-work/check.test.ts, and test/app/kiosk-timeline.test.ts WALL_1920): a title line holds
// `titleChars` characters, a sub line `subChars` (whole words, wrapped); a row is 44 px a title line, 32 px a sub line
// and 8 px of padding, never below the row budget. An event title stops at EVENT_TITLE_MAX_LINES, as the wall's
// line-clamp (app/src/ui/kiosk-city.css) stops it.
//
// The departures line (R1, docs/reveal-2026-10-plan/R1.md §0.2(e)): a cell's destination line holds `cellHeadChars`
// characters at 28 px weight 500 (about 13 px a character), its time `cellTimeChars` at 44 px weight 700 (about 20);
// a stacked cell (the landscape walls) is the badge line (44 px, or the destination's lines at 32 px where taller)
// over the time (44 px); an inline cell (the totem) is the badge and the time (44 px) over the destination (32 px a
// line, none where it prints none); 8 px of padding, never below the row budget.
import { EVENT_TITLE_MAX_LINES, type TimelineMeasure } from '../../app/src/kiosk/timeline';

export interface Layout { boxPx: number; titleChars: number; subChars: number; cellHeadChars?: number; cellTimeChars?: number; line?: 'stacked' | 'inline' }
/** The line's cells at the three compositions (§0.2(e): 203, 180 and 328 px). */
export const LINE_1920 = { cellHeadChars: 9, cellTimeChars: 10, line: 'stacked' } as const;
export const LINE_1366 = { cellHeadChars: 7, cellTimeChars: 9, line: 'stacked' } as const;
export const LINE_PORTRAIT = { cellHeadChars: 25, cellTimeChars: 12, line: 'inline' } as const;
export const WALL_1920: Layout = { boxPx: 486, titleChars: 17, subChars: 26, ...LINE_1920 };

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

const cellHead = (layout: Layout): number => layout.cellHeadChars ?? 9;
const cellTime = (layout: Layout): number => layout.cellTimeChars ?? 10;

/** A departures cell's destination lines (0 where it prints none), or null for any other element. */
export function cellLines(el: Element, layout: Layout): number | null {
  if (!el.classList.contains('k-dep-headsign')) return null;
  return wrapLines(el.textContent ?? '', cellHead(layout));
}

/** A departures cell or destination running past its box (a time longer than the cell holds, a word longer than its
 *  line), or null for any other element. */
export function cellOverflow(el: Element, layout: Layout): boolean | null {
  if (el.classList.contains('k-dep-cell')) return (el.querySelector('.nearby-when')?.textContent ?? '').length > cellTime(layout);
  if (el.classList.contains('k-dep-headsign')) return (el.textContent ?? '').split(' ').some((word) => word.length > cellHead(layout));
  return null;
}

/** The departures line's height, or null for any other row. */
export function lineHeight(li: Element, layout: Layout, rowPx: number): number | null {
  if ((li as HTMLElement).dataset?.kind !== 'departures') return null;
  const cells = [...li.querySelectorAll('.k-dep-cell')];
  const heads = cells.map((cell) => (cell.getAttribute('data-headsign') === '0' ? 0 : cellLines(cell.querySelector('.k-dep-headsign')!, layout) ?? 0));
  if ((layout.line ?? 'stacked') === 'inline') return Math.max(rowPx, 44 + 32 * Math.max(0, ...heads) + 8);
  return Math.max(rowPx, Math.max(44, 32 * Math.max(0, ...heads)) + 44 + 8);
}

/** The measure over `layout`; `section` is the timeline's section, whose --k-nearby-row is the row budget. */
export function simulated(section: () => HTMLElement, layout: Layout): TimelineMeasure & { rowHeight(li: Element): number; sum(list: Element): number } {
  const lines = (el: Element): number => {
    const cell = cellLines(el, layout);
    if (cell !== null) return cell;
    const title = el.classList.contains('nearby-title');
    const wrapped = wrapLines(el.textContent ?? '', title ? layout.titleChars : layout.subChars);
    const event = title && el.closest<HTMLElement>('li.nearby-row')?.dataset.kind === 'event';
    return event ? Math.min(EVENT_TITLE_MAX_LINES, wrapped) : wrapped;
  };
  const rowPx = (): number => Number.parseFloat(section().style.getPropertyValue('--k-nearby-row')) || 64;
  const rowHeight = (li: Element): number => lineHeight(li, layout, rowPx())
    ?? Math.max(rowPx(), 44 * lines(li.querySelector('.nearby-title')!) + 32 * lines(li.querySelector('.nearby-sub')!) + 8);
  const sum = (list: Element): number => [...list.children].reduce((acc, li) => acc + rowHeight(li), 0);
  // The measuring list carries the box it is fitted in as its own height (timeline.ts fit), as the DOM measure reads it.
  const heightOf = (list: Element): number => Number.parseFloat((list as HTMLElement).style?.height ?? '') || layout.boxPx;
  return {
    box: (el) => {
      const cell = cellOverflow(el, layout);
      if (cell !== null) return { height: 0, width: 0, overflow: cell };
      return { height: heightOf(el), width: layout.titleChars, overflow: sum(el) > heightOf(el) };
    },
    lines,
    rowHeight,
    sum,
  };
}
