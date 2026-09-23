// The 3-metre legibility rule: the standards of references.md T1–T6 turned
// into pixels for the wall's display, and one page-side pass that measures
// every visible text run against the tier it belongs to. The wall spec asserts
// `legibilityViolations(page, WALL_1920)` is empty in every scene and writes the
// full report (warnings, symbol sizes) for the owner's P3 decisions.
//
// Sources (review.local/companion/references.md, "Typographic and legibility
// rules for reading at 3 metres"):
//   T1  DIN 1450: x-height = distance ÷ 250 → 12 mm at 3 m, +10 % light on dark.
//   T2  Legge & Bigelow critical print size 0.2° → 10.5 mm x-height at 3 m: the floor.
//   T5  DfT Inclusive Mobility: symbols 40 mm for 3–6 m.
//   Display: 43″ 16:9 at 1920×1080 ≈ 0.50 mm/px; 55″ 16:9 at 3840×2160 ≈ 0.32 mm/px.
//   Font: Manrope, OS/2 sxHeight 1080 and sCapHeight 1440 over unitsPerEm 2000 in every
//   shipped weight (app/public/fonts/manrope/*.woff2; test/app/font-metrics.test.ts
//   re-reads them, so a font swap cannot move the floors silently).
//
// Tiers (brief §15.2, fixed in lane S): the read tier (place, sentence, row
// title and time, code, verdict, pharmacy) is read from 3 m and held to the
// x-height floor; the walk-up tier (row sub-line, date, legend, kicker, the QR
// card's lead, hint and typed address) is read by someone who walks up and is
// held to 28 px; every other visible text is held to 28 px too, except the map
// attribution. A text run belongs to the tier of its nearest ancestor that a
// tier selector matches (the sentence's kicker is walk-up although the
// sentence is read); an element both tiers match is read tier.
//
// Symbols are measured by diameter and reported, not asserted (P3 is the owner's
// call). The kiosk map draws its BAJS discs and vehicle pills on one canvas, so
// they have no element to measure: the pass reads the census WP2-E writes on the
// map's container (data-markers, data-unlabelled, data-bajs, data-overlaps,
// data-pills) into the report, and a map with neither a [data-symbol] mark nor
// that census is a violation, so an unmeasured map can never pass as "no symbols".
//
// One source: these selectors are the only place the tiers live, and the
// page-side pass receives them in its argument (the rule of e2e/geometry.ts).
import type { Page } from '@playwright/test';

/** Page access the check needs; Playwright's Page satisfies it. */
export type LegibilityPage = Pick<Page, 'evaluate'>;

// --- constants, each with its source ---------------------------------------------------------
/** Manrope x-height over the em: OS/2 sxHeight 1080 / unitsPerEm 2000 (all weights). */
export const MANROPE_X_HEIGHT_RATIO = 0.54;
/** Manrope cap height over the em: OS/2 sCapHeight 1440 / unitsPerEm 2000. */
export const MANROPE_CAP_HEIGHT_RATIO = 0.72;
/** 43″ 16:9 panel at 1920×1080 (references.md). */
export const DISPLAY_43IN_1080P_MM_PER_PX = 0.5;
/** 55″ 16:9 panel at 3840×2160 (references.md). */
export const DISPLAY_55IN_4K_MM_PER_PX = 0.32;
/** T2: the x-height below which reading slows at 3 m. */
export const X_HEIGHT_FLOOR_MM = 10.5;
/** T1: DIN 1450's comfortable x-height at 3 m. */
export const X_HEIGHT_COMFORT_MM = 12;
/** T1: light text on a dark ground is set 10 % larger (the solar dark palette). */
export const DARK_FACTOR = 1.1;
/** The walk-up tier and every other text: at least this font-size in CSS px. */
export const WALKUP_MIN_PX = 28;
/** T5: symbols read at 3–6 m (reported, not asserted: P3 is the owner's decision). */
export const SYMBOL_MM = 40;

/** Font-size in CSS px whose x-height measures `xHeightMm` on a display of `mmPerPx`. */
export function fontPxFor(xHeightMm: number, mmPerPx: number, ratio: number = MANROPE_X_HEIGHT_RATIO): number {
  return xHeightMm / (ratio * mmPerPx);
}
/** The x-height in mm of a font-size in CSS px. */
export function xHeightMm(fontPx: number, mmPerPx: number, ratio: number = MANROPE_X_HEIGHT_RATIO): number {
  return fontPx * ratio * mmPerPx;
}

export interface LegibilitySpec {
  /** Millimetres per CSS px on the display the wall is judged for. */
  mmPerPx: number;
  /** Held to the x-height floor (×1.1 in the dark theme). */
  readTier: readonly string[];
  /** Held to WALKUP_MIN_PX. */
  walkUpTier: readonly string[];
  /** Never measured (attribution). */
  exempt: string;
  /** Measured by diameter and reported; the text inside them is part of the symbol. */
  symbols: readonly string[];
  /**
   * A map that draws its marks on one canvas (WP2-E): no `[data-symbol]` child exists there, so the pass reads
   * the census the render probe writes on the container (`data-<name>` for each name) and fails loudly when the
   * map is missing, or has neither a `[data-symbol]` mark nor the whole census, instead of measuring nothing.
   */
  map?: { selector: string; census: readonly string[] };
}

/** The wall at 1920×1080 on a 43″ panel. */
export const WALL_1920: LegibilitySpec = Object.freeze({
  mmPerPx: DISPLAY_43IN_1080P_MM_PER_PX,
  readTier: Object.freeze([
    '[data-testid=kiosk-context]',
    '[data-testid=kiosk-sentence]',
    '.nearby-row .nearby-title',
    '.nearby-row .nearby-when',
    '.nearby-row time',
    '[data-testid=kiosk-code]',
    '[data-testid=pair-code]',
    '[data-testid=strip-verdict]',
    '[data-testid=strip-pharmacy]',
  ]),
  walkUpTier: Object.freeze([
    '.nearby-row .nearby-sub',
    '[data-testid=kiosk-date]',
    '.k-map-legend',
    '[data-testid=kiosk-sentence-kicker]',
    '.k-lead',
    '.k-hint',
    '.k-hint-host',
  ]),
  exempt: '.maplibregl-ctrl-attrib',
  symbols: Object.freeze([
    '[data-testid=kiosk-map] [data-symbol=bajs]',
    '[data-testid=kiosk-map] [data-symbol=pill]',
    '[data-testid=strip-pharmacy] [data-symbol=pharmacy]',
  ]),
  /** WP2-E's census: data-markers, data-unlabelled, data-bajs="counted:N;zero:N;blank:N;far:N", data-overlaps="discs:N;names:N", data-pills. */
  map: Object.freeze({ selector: '[data-testid=kiosk-map]', census: Object.freeze(['markers', 'unlabelled', 'bajs', 'overlaps', 'pills']) }),
});

/** `symbol`: a map whose marks could not be measured at all (no `[data-symbol]` mark, no census). */
export type LegibilityTier = 'read' | 'walk-up' | 'other' | 'symbol';
export interface LegibilityFinding {
  tier: LegibilityTier;
  /** The tier selector the text fell under ('' for other text). */
  selector: string;
  /** The measured element, `tag.class[data-testid]`. */
  element: string;
  text: string;
  px: number;
  mm: number;
  /** The floor it was held to: mm for the read tier, the px floor's x-height for the others. */
  floorMm: number;
  /** One sentence naming the element, the size and the floor. */
  detail: string;
}
export interface SymbolReading { selector: string; element: string; diameterPx: number; mm: number }
/** The canvas map's census as its container carries it; null counts where an attribute is missing. */
export interface MapCensus {
  selector: string;
  element: string;
  /** `[data-symbol]` elements inside the map (0 on the canvas map). */
  domSymbols: number;
  /** Census names whose `data-<name>` attribute is not on the container. */
  missing: string[];
  markers: number | null;
  unlabelled: number | null;
  /** data-bajs: counted, zero, blank and far discs. */
  bajs: Record<string, number> | null;
  /** data-overlaps: BAJS discs and stop or place names under a vehicle pill. */
  overlaps: Record<string, number> | null;
  /** Labels in data-pills. */
  pills: number | null;
}
export interface LegibilityReport {
  /** Read tier under the floor, walk-up tier under 28 px. */
  violations: LegibilityFinding[];
  /** Read tier between the floor and the comfortable size (T2 ≤ x < T1). */
  warnings: LegibilityFinding[];
  symbols: SymbolReading[];
  /** Visible text outside every tier and the exemption, under 28 px. */
  otherSmall: LegibilityFinding[];
  /** The theme the floors were taken for. */
  dark: boolean;
  /** The canvas map's census; null when the spec names no map or the map is missing (then a `symbol` violation says so). */
  map: MapCensus | null;
}

/** What the browser receives: the spec plus every number, so the page-side pass needs nothing from module scope. */
export interface PageLegibilitySpec {
  mmPerPx: number;
  readTier: string[];
  walkUpTier: string[];
  exempt: string;
  symbols: string[];
  map: { selector: string; census: string[] } | null;
  symbolMm: number;
  ratio: number;
  floorMm: number;
  comfortMm: number;
  darkFactor: number;
  walkUpMinPx: number;
}

export function pageSpec(spec: LegibilitySpec): PageLegibilitySpec {
  return {
    mmPerPx: spec.mmPerPx,
    readTier: [...spec.readTier],
    walkUpTier: [...spec.walkUpTier],
    exempt: spec.exempt,
    symbols: [...spec.symbols],
    map: spec.map ? { selector: spec.map.selector, census: [...spec.map.census] } : null,
    symbolMm: SYMBOL_MM,
    ratio: MANROPE_X_HEIGHT_RATIO,
    floorMm: X_HEIGHT_FLOOR_MM,
    comfortMm: X_HEIGHT_COMFORT_MM,
    darkFactor: DARK_FACTOR,
    walkUpMinPx: WALKUP_MIN_PX,
  };
}

/**
 * Runs inside the browser through `page.evaluate`: every visible text run (a text node
 * with a box inside the viewport) measured against its tier. References nothing but its
 * argument and the DOM; exported so the unit tier can run it in a DOM of its own.
 */
export const LEGIBILITY_IN_PAGE = (spec: PageLegibilitySpec): LegibilityReport => {
  const dark = document.documentElement.dataset.themeResolved === 'dark';
  const factor = dark ? spec.darkFactor : 1;
  const floorMm = spec.floorMm * factor;
  const comfortMm = spec.comfortMm * factor;
  const round = (n: number, d = 1): number => Math.round(n * 10 ** d) / 10 ** d;
  const mmOf = (px: number): number => px * spec.ratio * spec.mmPerPx;
  const name = (el: Element): string => {
    const h = el as HTMLElement;
    const cls = typeof h.className === 'string' && h.className.trim() ? `.${h.className.trim().split(/\s+/).slice(0, 2).join('.')}` : '';
    const testid = h.dataset?.testid ? `[data-testid=${h.dataset.testid}]` : '';
    return `${el.tagName.toLowerCase()}${cls}${testid}`;
  };
  const tierOf = (el: Element): { tier: 'read' | 'walk-up' | 'other'; selector: string } => {
    for (let e: Element | null = el; e; e = e.parentElement) {
      const read = spec.readTier.find((s) => e!.matches(s));
      if (read) return { tier: 'read', selector: read };
      const walk = spec.walkUpTier.find((s) => e!.matches(s));
      if (walk) return { tier: 'walk-up', selector: walk };
    }
    return { tier: 'other', selector: '' };
  };
  const symbolSelector = spec.symbols.join(', ');
  const violations: LegibilityFinding[] = [];
  const warnings: LegibilityFinding[] = [];
  const otherSmall: LegibilityFinding[] = [];
  const seen = new Set<string>();

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
    const parent = node.parentElement;
    if (!text || !parent || parent.closest('script, style, noscript, template')) continue;
    if (spec.exempt && parent.closest(spec.exempt)) continue;
    if (symbolSelector && parent.closest(symbolSelector)) continue;
    if (parent.closest('[hidden]')) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    const r = range.getBoundingClientRect();
    if (r.width <= 1 || r.height <= 1 || r.bottom <= 0 || r.right <= 0 || r.top >= innerHeight || r.left >= innerWidth) continue;
    const cs = getComputedStyle(parent);
    if (cs.visibility === 'hidden' || cs.display === 'none' || (cs.opacity !== '' && Number(cs.opacity) === 0)) continue;
    // Text a clipping ancestor cuts away entirely is not on the wall: the visually-hidden pattern (a 1 px box with
    // overflow hidden and a clip, kept for screen readers, e.g. the typed address link) or a run scrolled out of its
    // box. The rule of e2e/wall.ts (a row counts only inside every box that clips it); a run partly inside is measured.
    let clippedAway = false;
    for (let a: Element | null = parent; a && a !== document.body && a !== document.documentElement; a = a.parentElement) {
      const acs = getComputedStyle(a);
      const clips = [acs.overflow, acs.overflowX, acs.overflowY].some((v) => v !== '' && v !== 'visible')
        || (acs.clip !== undefined && acs.clip !== '' && acs.clip !== 'auto');
      if (!clips) continue;
      const b = a.getBoundingClientRect();
      if (Math.min(r.right, b.right) - Math.max(r.left, b.left) <= 1 || Math.min(r.bottom, b.bottom) - Math.max(r.top, b.top) <= 1) {
        clippedAway = true;
        break;
      }
    }
    if (clippedAway) continue;
    const px = parseFloat(cs.fontSize);
    if (!Number.isFinite(px)) continue;
    const mm = mmOf(px);
    const { tier, selector } = tierOf(parent);
    const key = `${tier}|${name(parent)}|${text.slice(0, 40)}|${px}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const finding = (floor: number, detail: string): LegibilityFinding => ({ tier, selector, element: name(parent), text: text.slice(0, 60), px: round(px, 2), mm: round(mm, 2), floorMm: round(floor, 2), detail });
    if (tier === 'read') {
      if (mm < floorMm) violations.push(finding(floorMm, `read tier ${name(parent)} "${text.slice(0, 40)}" is ${round(px, 2)} px, an x-height of ${round(mm, 2)} mm, under the ${round(floorMm, 2)} mm floor at 3 m (${round(floorMm / (spec.ratio * spec.mmPerPx), 1)} px${dark ? ', dark theme +10 %' : ''})`));
      else if (mm < comfortMm) warnings.push(finding(comfortMm, `read tier ${name(parent)} "${text.slice(0, 40)}" is ${round(px, 2)} px, ${round(mm, 2)} mm: above the floor, under the comfortable ${round(comfortMm, 2)} mm`));
    } else if (px < spec.walkUpMinPx) {
      const target = tier === 'walk-up' ? violations : otherSmall;
      target.push(finding(mmOf(spec.walkUpMinPx), `${tier === 'walk-up' ? 'walk-up tier' : 'text outside the tiers'} ${name(parent)} "${text.slice(0, 40)}" is ${round(px, 2)} px, under the ${spec.walkUpMinPx} px floor`));
    }
  }

  const symbols: SymbolReading[] = [];
  for (const selector of spec.symbols) {
    for (const el of Array.from(document.querySelectorAll(selector))) {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      const diameterPx = Math.max(r.width, r.height);
      symbols.push({ selector, element: name(el), diameterPx: round(diameterPx), mm: round(diameterPx * spec.mmPerPx) });
    }
  }

  // The canvas map: its marks have no element, so their census is read from the container. A map with neither
  // a [data-symbol] mark nor the whole census is a violation, never a silent "no symbols".
  let map: MapCensus | null = null;
  if (spec.map) {
    const sel = spec.map.selector;
    const loud = (element: string, detail: string): LegibilityFinding => ({ tier: 'symbol', selector: sel, element, text: '', px: 0, mm: 0, floorMm: spec.symbolMm, detail });
    const host = document.querySelector(sel);
    if (!host) {
      violations.push(loud(sel, `the map ${sel} is missing: its BAJS discs and vehicle pills cannot be measured`));
    } else {
      const attr = (key: string): string | null => host.getAttribute(`data-${key}`);
      const count = (v: string | null): number | null => (v === null || v.trim() === '' || !Number.isFinite(Number(v)) ? null : Number(v));
      const pairs = (v: string | null): Record<string, number> | null => {
        if (v === null) return null;
        const out: Record<string, number> = {};
        for (const part of v.split(';')) {
          const [k, n] = part.split(':');
          if (k && k.trim() && n !== undefined && Number.isFinite(Number(n))) out[k.trim()] = Number(n);
        }
        return out;
      };
      const pills = attr('pills');
      map = {
        selector: sel,
        element: name(host),
        domSymbols: host.querySelectorAll('[data-symbol]').length,
        missing: spec.map.census.filter((key) => attr(key) === null),
        markers: count(attr('markers')),
        unlabelled: count(attr('unlabelled')),
        bajs: pairs(attr('bajs')),
        overlaps: pairs(attr('overlaps')),
        pills: pills === null ? null : pills.split('|').filter((label) => label.trim() !== '').length,
      };
      if (map.domSymbols === 0 && map.missing.length) {
        violations.push(loud(map.element, `the map ${sel} draws on one canvas with no [data-symbol] mark and no ${map.missing.map((key) => `data-${key}`).join(', ')}: its BAJS discs and vehicle pills would go unmeasured`));
      }
    }
  }
  return { violations, warnings, symbols, otherSmall, dark, map };
};

/** The full report (the wall spec writes it to test-results/accept/legibility-<scene>.json). */
export function legibilityReport(page: LegibilityPage, spec: LegibilitySpec): Promise<LegibilityReport> {
  return page.evaluate(LEGIBILITY_IN_PAGE, pageSpec(spec));
}

/** What fails the check: read or walk-up tier under its floor, and any other text under 28 px. `[]` means the wall is legible at 3 m. */
export async function legibilityViolations(page: LegibilityPage, spec: LegibilitySpec): Promise<LegibilityFinding[]> {
  const report = await legibilityReport(page, spec);
  return [...report.violations, ...report.otherSmall];
}
