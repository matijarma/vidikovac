// The mobile gates' rule engine: the phone shell's geometry, the type floor and
// the target minimum, evaluated in one pass inside the page and returned as
// plain sentences: an empty list is the proof, a non-empty one names the
// elements and the pixels so a red gate reads like a finding, not like a stack
// trace. A target element that is missing is reported the same way (the rule
// cannot hold without it), never thrown, so a spec running against an older
// DOM still fails on the intended check.
//
// One source. The thresholds and the rules are written down here and nowhere
// else: e2e/mobile.spec.ts (the Playwright gate) imports them, and
// scripts/audit-production.mjs (the same rules against production) loads this
// module through a throwaway Vite loader, so a threshold or an edge case moves
// once and both verdicts move with it. test/e2e/geometry.test.ts holds the
// numbers and keeps the two consumers from growing a copy.
//
// Written for the phone shell, where the header and the tab bar have boxes
// (at the desk the header is display: contents and the tab bar is hidden).
//
// Geometry rules (plan, "Test updates", new test 3):
//   header:        the header's bottom edge is at or above the top of the
//                  first visible child of main (or of the first banner, when
//                  the banners row has one), so nothing scrolls under it.
//   overlay:       no banner and no notice rect intersects any direct child of
//                  main: banners live in flow, they never float over content.
//   tabbar:        the tab bar's bottom edge equals innerHeight within 1 px.
//   header-height: the header is at most `maxHeaderPx` tall.
//   overflow:      the document is no wider than the viewport (plus 1 px).
// Type floor (new test 6, WCAG 2.2 AA as the constraints state it):
//   type-floor:    no visible text run computes a font-size below the floor,
//                  except inside the attribution lines (TYPE_FLOOR_EXEMPT).
// Targets (new test 6 and the production audit):
//   target:        a control is at least the minimum in both dimensions; a
//                  link in running text, whose width is its word's, is
//                  measured by height (plan, "Spacing": provenance links are
//                  inline-block with vertical padding to a 44 px box).
import type { Page } from '@playwright/test';

// --- thresholds, the one place they are written down ---------------------------
/** No visible text below this on a phone, except attribution lines. */
export const TYPE_FLOOR_PX = 13;
/** Every target at least this in CSS px. */
export const TARGET_MIN_PX = 44;
/** The sticky header: 48 px plus a safe-area inset at most. */
export const HEADER_MAX_PX = 56;
/** Allowance for edges the layout reports in whole pixels (the tab bar's bottom edge, the document's width). */
export const EDGE_TOLERANCE_PX = 1;
/** Allowance for sub-pixel layout: a 43.6 px box is a 44 px target, a 55.5 px header a 56 px one. */
const ROUNDING_PX = 0.5;
/** The one exception to the type floor. */
export const TYPE_FLOOR_EXEMPT = '.provenance, .panel-attr, .source-line, .src, .maplibregl-ctrl-attrib';
/** Links in a source line: inline text, so height is the target dimension. */
export const SOURCE_LINKS = '.provenance a, .source a, .maplibregl-ctrl-attrib a';
/** Everything else a finger presses: a box in both dimensions. */
export const CONTROLS = `a[href]:not(${SOURCE_LINKS}), button, input, select, textarea, summary, [role=button], [role=tab], [tabindex]:not([tabindex="-1"])`;

// --- rule options ------------------------------------------------------------------
export type GeometryRule = 'header' | 'overlay' | 'tabbar' | 'header-height' | 'overflow';
export type RuleId = GeometryRule | 'type-floor' | 'target';

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

/** The phone shell's geometry targets: 48 px sticky header (56 with a safe-area inset at most), fixed tab bar, banners in flow. */
export const PHONE_SHELL: GeometryOptions = { header: '.ki-head', tabbar: '.ki-tabbar', main: '[data-testid=dash-view]', banners: '[data-testid=banners]', maxHeaderPx: HEADER_MAX_PX };

export interface TypeFloorOptions {
  /** The floor in CSS px. */
  floorPx: number;
  /** Selector list of the subtrees the floor does not apply to. */
  exempt: string;
}

/** The type floor a phone-class width is held to. */
export const PHONE_TYPE_FLOOR: TypeFloorOptions = { floorPx: TYPE_FLOOR_PX, exempt: TYPE_FLOOR_EXEMPT };

export interface TargetOptions {
  /** Which elements are targets. */
  selector: string;
  /** The minimum in CSS px. */
  minPx: number;
  /** `both` for a control (width and height); `height` for a link in running text, whose width is its word's. */
  axes: 'both' | 'height';
}

/** Every link in a source line is a tall enough target (plan, "Test updates", new test 6). */
export const SOURCE_LINK_TARGETS: TargetOptions = { selector: SOURCE_LINKS, minPx: TARGET_MIN_PX, axes: 'height' };
/** Every other control is a box in both dimensions (the production audit's target rule). */
export const CONTROL_TARGETS: TargetOptions = { selector: CONTROLS, minPx: TARGET_MIN_PX, axes: 'both' };

export interface RuleSpec {
  geometry?: GeometryOptions;
  typeFloor?: TypeFloorOptions;
  targets?: readonly TargetOptions[];
  /** Open every `details.provenance` before measuring: a closed disclosure renders no links to measure. Test 6 does; the audit measures the page as rendered. */
  openDetails?: boolean;
}

export interface RuleViolation {
  rule: RuleId;
  detail: string;
}

/** What the browser receives: every threshold and selector, so the page-side function needs nothing from module scope. */
export interface PageRuleSpec {
  geometry: (Omit<GeometryOptions, 'rules'> & { active: string[] }) | null;
  typeFloor: TypeFloorOptions | null;
  targets: TargetOptions[];
  openDetails: boolean;
  edge: number;
  rounding: number;
}

// --- the page-side pass ---------------------------------------------------------------
/**
 * Runs inside the browser through `page.evaluate`, so it may reference nothing but
 * its argument and the DOM; exported so the unit tier can run it in a DOM of its own.
 */
export const RULES_IN_PAGE = (spec: PageRuleSpec): RuleViolation[] => {
  const out: RuleViolation[] = [];
  const push = (rule: RuleId, detail: string): void => { out.push({ rule, detail }); };
  const px = (n: number): string => `${Math.round(n * 10) / 10} px`;
  const name = (el: Element): string => {
    const h = el as HTMLElement;
    const cls = typeof h.className === 'string' && h.className.trim() ? `.${h.className.trim().split(/\s+/).slice(0, 2).join('.')}` : '';
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
  const words = (el: Element): string => (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40);

  if (spec.openDetails) for (const details of document.querySelectorAll<HTMLDetailsElement>('details.provenance')) details.open = true;

  if (spec.geometry) {
    const { header, tabbar, main, banners, maxHeaderPx, active } = spec.geometry;
    const on = (rule: string): boolean => active.includes(rule);
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
        push('header', `the sticky header ${header} is missing or hidden, so nothing pins the session pill and the safety control to the top`);
      } else {
        const h = headerEl.getBoundingClientRect();
        if (on('header')) {
          const reference = bannerNodes[0] ?? mainChildren[0];
          if (reference) {
            // Document coordinates: the header is pinned at the top of the document, so the first
            // content must start below its height whatever the page has scrolled to.
            const top = reference.getBoundingClientRect().top + window.scrollY;
            if (h.height > top + spec.rounding) push('header', `the header ${name(headerEl)} is ${px(h.height)} tall but ${name(reference)} starts at ${px(top)} from the top of the document: the header overlays ${px(h.height - top)} of content`);
          }
        }
        // The ceiling is set at 100% text; a zoomed root scales it (3rem is 96 px at 200%).
        const scale = (parseFloat(getComputedStyle(document.documentElement).fontSize) || 16) / 16;
        const ceiling = maxHeaderPx * scale;
        if (on('header-height') && h.height > ceiling + spec.rounding) push('header-height', `the header ${name(headerEl)} is ${px(h.height)} tall, above the ${px(ceiling)} ceiling${scale !== 1 ? ` (${maxHeaderPx} px at 100% text)` : ''}`);
      }
    }

    if (on('overlay')) {
      for (const banner of bannerNodes) {
        const b = banner.getBoundingClientRect();
        for (const child of mainChildren) {
          const c = child.getBoundingClientRect();
          if (intersects(b, c)) push('overlay', `the banner ${name(banner)} (${box(banner)}) overlaps ${name(child)} (${box(child)}): banners must sit in flow above the content, never over it`);
        }
      }
    }

    if (on('tabbar')) {
      if (!tabbarEl || !shown(tabbarEl)) {
        push('tabbar', `the tab bar ${tabbar} is missing or hidden`);
      } else {
        const t = tabbarEl.getBoundingClientRect();
        if (Math.abs(t.bottom - innerHeight) > spec.edge) push('tabbar', `the tab bar ${name(tabbarEl)} ends at ${px(t.bottom)} while the viewport ends at ${innerHeight} px: it must sit flush with the bottom edge`);
      }
    }

    if (on('overflow')) {
      const width = document.documentElement.scrollWidth;
      if (width > innerWidth + spec.edge) push('overflow', `the document is ${width} px wide in a ${innerWidth} px viewport: ${width - innerWidth} px of horizontal overflow`);
    }
  }

  if (spec.typeFloor) {
    const { floorPx, exempt } = spec.typeFloor;
    const seen = new Set<string>();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = (node.textContent ?? '').trim();
      const parent = node.parentElement;
      if (!text || !parent || parent.closest('script, style, noscript, template') || parent.closest(exempt)) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const r = range.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      const cs = getComputedStyle(parent);
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      const size = parseFloat(cs.fontSize);
      if (!(size < floorPx)) continue;
      const detail = `${name(parent)} "${text.slice(0, 40)}" is set at ${Math.round(size * 100) / 100} px, under the ${floorPx} px floor`;
      if (!seen.has(detail)) {
        seen.add(detail);
        push('type-floor', detail);
      }
    }
  }

  // A control drawn 1 px square is the visually hidden half of a label pair
  // (a radio or checkbox styled through its label): the label is what a finger
  // hits, so the label's box is the target and the input is measured there.
  const labelFor = (el: Element): Element | null => {
    const id = el.getAttribute('id');
    const explicit = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : null;
    return explicit ?? el.closest('label');
  };
  for (const target of spec.targets) {
    for (const el of document.querySelectorAll(target.selector)) {
      if (!shown(el)) continue;
      let measured = el;
      const box = el.getBoundingClientRect();
      if (box.width <= 1.5 && box.height <= 1.5) {
        const label = labelFor(el);
        if (!label || !shown(label)) continue;
        measured = label;
      }
      const r = measured.getBoundingClientRect();
      const shortHeight = r.height < target.minPx - spec.rounding;
      const shortWidth = target.axes === 'both' && r.width < target.minPx - spec.rounding;
      if (!shortHeight && !shortWidth) continue;
      const size = target.axes === 'both' ? `${px(r.width)} by ${px(r.height)}` : `${px(r.height)} tall`;
      push('target', `${name(measured)} "${words(measured)}" is ${size}, under the ${target.minPx} px target`);
    }
  }

  return out;
};

// --- the Playwright face ------------------------------------------------------------------
/** Every requested rule in one page-side pass, each violation tagged by rule; `[]` means they all hold. */
export function ruleViolations(page: Page, spec: RuleSpec): Promise<RuleViolation[]> {
  const g = spec.geometry;
  const shipped: PageRuleSpec = {
    geometry: g ? { header: g.header, tabbar: g.tabbar, main: g.main, banners: g.banners, maxHeaderPx: g.maxHeaderPx, active: [...(g.rules ?? ALL_GEOMETRY_RULES)] } : null,
    typeFloor: spec.typeFloor ? { floorPx: spec.typeFloor.floorPx, exempt: spec.typeFloor.exempt } : null,
    targets: (spec.targets ?? []).map((t) => ({ selector: t.selector, minPx: t.minPx, axes: t.axes })),
    openDetails: Boolean(spec.openDetails),
    edge: EDGE_TOLERANCE_PX,
    rounding: ROUNDING_PX,
  };
  return page.evaluate(RULES_IN_PAGE, shipped);
}

/** The geometry rules alone, as sentences; `[]` means the shell holds. */
export async function geometryIssues(page: Page, opts: GeometryOptions): Promise<string[]> {
  return (await ruleViolations(page, { geometry: opts })).map((v) => v.detail);
}
