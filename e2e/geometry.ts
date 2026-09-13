// The phone shell's geometry rules, evaluated in one pass inside the page and
// returned as plain sentences: an empty list is the proof, a non-empty one
// names the elements and the pixels so a red gate reads like a finding, not
// like a stack trace. A target element that is missing is reported the same
// way (the rule cannot hold without it), never thrown, so a spec running
// against an older DOM still fails on the intended check.
//
// Written for the phone shell, where the header and the tab bar have boxes
// (at the desk the header is display: contents and the tab bar is hidden).
//
// Rules (plan, "Test updates", new test 3):
//   header:        the header's bottom edge is at or above the top of the
//                  first visible child of main (or of the first banner, when
//                  the banners row has one), so nothing scrolls under it.
//   overlay:       no banner and no notice rect intersects any direct child of
//                  main: banners live in flow, they never float over content.
//   tabbar:        the tab bar's bottom edge equals innerHeight within 1 px.
//   header-height: the header is at most `maxHeaderPx` tall.
//   overflow:      the document is no wider than the viewport (plus 1 px).
import type { Page } from '@playwright/test';

export type GeometryRule = 'header' | 'overlay' | 'tabbar' | 'header-height' | 'overflow';

export interface GeometryOptions {
  /** Selector of the sticky header (`.ki-head`). */
  header: string;
  /** Selector of the fixed tab bar (`.ki-tabbar`). */
  tabbar: string;
  /** Selector of the scrolling main (`[data-testid=dash-view]`). */
  main: string;
  /** Selector of the banners row (`[data-testid=banners]`). */
  banners: string;
  /** The header's height ceiling in CSS px (48 px plus a safe-area inset at most). */
  maxHeaderPx: number;
  /** Evaluate only these rules; every rule when omitted. */
  rules?: readonly GeometryRule[];
}

export const ALL_GEOMETRY_RULES: readonly GeometryRule[] = ['header', 'overlay', 'tabbar', 'header-height', 'overflow'];

/** Every geometry rule in one page-side pass; `[]` means the shell holds. */
export function geometryIssues(page: Page, opts: GeometryOptions): Promise<string[]> {
  const rules = opts.rules ?? ALL_GEOMETRY_RULES;
  return page.evaluate(
    ({ header, tabbar, main, banners, maxHeaderPx, active }) => {
      const out: string[] = [];
      const on = (rule: string): boolean => active.includes(rule);
      const px = (n: number): string => `${Math.round(n * 10) / 10} px`;
      const name = (el: Element): string => {
        const h = el as HTMLElement;
        const cls = typeof h.className === 'string' && h.className.trim() ? `.${h.className.trim().split(/\s+/)[0]}` : '';
        const testid = h.dataset?.testid ? `[data-testid=${h.dataset.testid}]` : '';
        const key = h.dataset?.key ? `[data-key=${h.dataset.key}]` : '';
        return `${el.tagName.toLowerCase()}${h.id ? `#${h.id}` : ''}${cls}${testid}${key}`;
      };
      const box = (el: Element): string => {
        const r = el.getBoundingClientRect();
        return `top ${px(r.top)}, bottom ${px(r.bottom)}, left ${px(r.left)}, right ${px(r.right)}`;
      };
      const shown = (el: Element): boolean => {
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return false;
        const cs = getComputedStyle(el);
        return cs.visibility !== 'hidden' && cs.display !== 'none';
      };
      const intersects = (a: DOMRect, b: DOMRect): boolean => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;

      const headerEl = document.querySelector(header);
      const tabbarEl = document.querySelector(tabbar);
      const mainEl = document.querySelector(main);
      const bannersEl = document.querySelector(banners);
      const mainChildren = mainEl ? [...mainEl.children].filter(shown) : [];
      const bannerNodes = [
        ...(bannersEl ? [...bannersEl.children] : []),
        ...document.querySelectorAll('[data-testid=notice]'),
      ].filter((el, i, all) => all.indexOf(el) === i && shown(el));

      if (on('header') || on('header-height')) {
        if (!headerEl || !shown(headerEl)) {
          out.push(`the sticky header ${header} is missing or hidden, so nothing pins the session pill and the safety control to the top`);
        } else {
          const h = headerEl.getBoundingClientRect();
          if (on('header')) {
            const reference = bannerNodes[0] ?? mainChildren[0];
            if (reference) {
              const top = reference.getBoundingClientRect().top;
              if (h.bottom > top + 0.5) out.push(`the header ${name(headerEl)} ends at ${px(h.bottom)} but ${name(reference)} starts at ${px(top)}: the header overlays ${px(h.bottom - top)} of content`);
            }
          }
          if (on('header-height') && h.height > maxHeaderPx + 0.5) out.push(`the header ${name(headerEl)} is ${px(h.height)} tall, above the ${maxHeaderPx} px ceiling`);
        }
      }

      if (on('overlay')) {
        for (const banner of bannerNodes) {
          const b = banner.getBoundingClientRect();
          for (const child of mainChildren) {
            const c = child.getBoundingClientRect();
            if (intersects(b, c)) out.push(`the banner ${name(banner)} (${box(banner)}) overlaps ${name(child)} (${box(child)}): banners must sit in flow above the content, never over it`);
          }
        }
      }

      if (on('tabbar')) {
        if (!tabbarEl || !shown(tabbarEl)) {
          out.push(`the tab bar ${tabbar} is missing or hidden`);
        } else {
          const t = tabbarEl.getBoundingClientRect();
          if (Math.abs(t.bottom - innerHeight) > 1) out.push(`the tab bar ${name(tabbarEl)} ends at ${px(t.bottom)} while the viewport ends at ${innerHeight} px: it must sit flush with the bottom edge`);
        }
      }

      if (on('overflow')) {
        const width = document.documentElement.scrollWidth;
        if (width > innerWidth + 1) out.push(`the document is ${width} px wide in a ${innerWidth} px viewport: ${width - innerWidth} px of horizontal overflow`);
      }
      return out;
    },
    { header: opts.header, tabbar: opts.tabbar, main: opts.main, banners: opts.banners, maxHeaderPx: opts.maxHeaderPx, active: rules as string[] },
  );
}
