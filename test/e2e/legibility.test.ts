// The 3-metre legibility rule has one source (e2e/legibility.ts). This file
// holds its arithmetic (references.md T1–T6 converted for a 43″ 1080p panel
// and Manrope's measured x-height), the tiers fixed in lane S, and proves the
// page-side pass can be shipped into a browser and measures by tier.
// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import {
  DARK_FACTOR, DISPLAY_43IN_1080P_MM_PER_PX, DISPLAY_55IN_4K_MM_PER_PX, LEGIBILITY_IN_PAGE, MANROPE_CAP_HEIGHT_RATIO,
  MANROPE_X_HEIGHT_RATIO, SYMBOL_MM, WALKUP_MIN_PX, WALL_1920, X_HEIGHT_COMFORT_MM, X_HEIGHT_FLOOR_MM, fontPxFor,
  legibilityReport, legibilityViolations, pageSpec, xHeightMm, type LegibilityPage, type LegibilityReport,
} from '../../e2e/legibility';

const round = (n: number, d = 1): number => Math.round(n * 10 ** d) / 10 ** d;

function recorder(answer: LegibilityReport): { page: LegibilityPage; shipped: () => { fn: string; arg: unknown } } {
  let last: { fn: string; arg: unknown } | null = null;
  const page = { evaluate: (fn: unknown, arg: unknown) => { last = { fn: String(fn), arg }; return Promise.resolve(answer); } } as unknown as LegibilityPage;
  return { page, shipped: () => { if (!last) throw new Error('evaluate was not called'); return last; } };
}

describe('the numbers, each with its source', () => {
  it('Manrope 0.54 / 0.72, displays 0.50 and 0.32 mm/px, floors 10.5 and 12 mm, dark +10 %, walk-up 28 px, symbols 40 mm', () => {
    expect(MANROPE_X_HEIGHT_RATIO).toBe(0.54);
    expect(MANROPE_CAP_HEIGHT_RATIO).toBe(0.72);
    expect(DISPLAY_43IN_1080P_MM_PER_PX).toBe(0.5);
    expect(DISPLAY_55IN_4K_MM_PER_PX).toBe(0.32);
    expect(X_HEIGHT_FLOOR_MM).toBe(10.5);
    expect(X_HEIGHT_COMFORT_MM).toBe(12);
    expect(DARK_FACTOR).toBe(1.1);
    expect(WALKUP_MIN_PX).toBe(28);
    expect(SYMBOL_MM).toBe(40);
  });

  it('converts x-heights to font sizes at 43″ 1080p: floor 38.9 px, comfortable 44.4 px, comfortable in the dark 48.9 px, floor in the dark 42.8 px', () => {
    const mm = DISPLAY_43IN_1080P_MM_PER_PX;
    expect(round(fontPxFor(X_HEIGHT_FLOOR_MM, mm))).toBe(38.9);
    expect(round(fontPxFor(X_HEIGHT_COMFORT_MM, mm))).toBe(44.4);
    expect(round(fontPxFor(X_HEIGHT_COMFORT_MM * DARK_FACTOR, mm))).toBe(48.9);
    expect(round(fontPxFor(X_HEIGHT_FLOOR_MM * DARK_FACTOR, mm))).toBe(42.8);
    // At 55″ 4K the same floor is 60.8 px; the cap height of the floor font is 14 mm.
    expect(round(fontPxFor(X_HEIGHT_FLOOR_MM, DISPLAY_55IN_4K_MM_PER_PX))).toBe(60.8);
    expect(round(fontPxFor(X_HEIGHT_FLOOR_MM, mm) * MANROPE_CAP_HEIGHT_RATIO * mm)).toBe(14);
  });

  it('today\'s wall tokens: --k-main-size 40 px is 10.8 mm (at the floor, under it in the dark), --k-sup-size 28 px is 7.6 mm', () => {
    expect(round(xHeightMm(40, DISPLAY_43IN_1080P_MM_PER_PX))).toBe(10.8);
    expect(xHeightMm(40, DISPLAY_43IN_1080P_MM_PER_PX)).toBeGreaterThanOrEqual(X_HEIGHT_FLOOR_MM);
    expect(xHeightMm(40, DISPLAY_43IN_1080P_MM_PER_PX)).toBeLessThan(X_HEIGHT_FLOOR_MM * DARK_FACTOR);
    expect(round(xHeightMm(28, DISPLAY_43IN_1080P_MM_PER_PX))).toBe(7.6);
  });
});

describe('the tiers fixed in lane S (brief §15.2)', () => {
  it('read tier: place, sentence, row title and time, code, verdict, pharmacy', () => {
    expect(WALL_1920.mmPerPx).toBe(DISPLAY_43IN_1080P_MM_PER_PX);
    expect(WALL_1920.readTier).toEqual([
      '[data-testid=kiosk-context]', '[data-testid=kiosk-sentence]', '.nearby-row .nearby-title', '.nearby-row .nearby-when',
      '.nearby-row time', '[data-testid=kiosk-code]', '[data-testid=pair-code]', '[data-testid=strip-verdict]', '[data-testid=strip-pharmacy]',
    ]);
  });
  it('walk-up tier: sub-line, date, legend, kicker, the QR card\'s lead, hint and typed address; the map attribution is exempt', () => {
    expect(WALL_1920.walkUpTier).toEqual([
      '.nearby-row .nearby-sub', '[data-testid=kiosk-date]', '.k-map-legend', '[data-testid=kiosk-sentence-kicker]', '.k-lead', '.k-hint', '.k-hint-host',
    ]);
    expect(WALL_1920.exempt).toBe('.maplibregl-ctrl-attrib');
    expect(WALL_1920.symbols).toContain('[data-testid=kiosk-map] [data-symbol=bajs]');
  });
});

describe('the page-side pass', () => {
  const empty: LegibilityReport = { violations: [], warnings: [], symbols: [], otherSmall: [], dark: false, map: null };

  it('ships the spec and every number in its argument; the source names no module identifier', async () => {
    const { page, shipped } = recorder(empty);
    await legibilityReport(page, WALL_1920);
    const { fn, arg } = shipped();
    expect(fn).toBe(String(LEGIBILITY_IN_PAGE));
    expect(arg).toEqual(pageSpec(WALL_1920));
    expect(arg).toMatchObject({ ratio: 0.54, floorMm: 10.5, comfortMm: 12, darkFactor: 1.1, walkUpMinPx: 28, mmPerPx: 0.5 });
    expect(fn).not.toMatch(/\b(MANROPE_X_HEIGHT_RATIO|X_HEIGHT_FLOOR_MM|X_HEIGHT_COMFORT_MM|DARK_FACTOR|WALKUP_MIN_PX|WALL_1920|DISPLAY_43IN_1080P_MM_PER_PX|fontPxFor|xHeightMm|pageSpec)\b/);
  });

  it('legibilityViolations fails on violations and other small text, and only reports warnings and symbols', async () => {
    const finding = (tier: 'read' | 'walk-up' | 'other', detail: string) => ({ tier, selector: '', element: 'p', text: 't', px: 20, mm: 5.4, floorMm: 10.5, detail });
    const report: LegibilityReport = { violations: [finding('read', 'v')], warnings: [finding('read', 'w')], symbols: [{ selector: 's', element: 'span', diameterPx: 40, mm: 20 }], otherSmall: [finding('other', 'o')], dark: false, map: null };
    const { page } = recorder(report);
    expect((await legibilityViolations(page, WALL_1920)).map((f) => f.detail)).toEqual(['v', 'o']);
  });

  it('measures each text run against its nearest tier, in a DOM of its own, run from its text alone', () => {
    const shippedFn = new Function(`return (${String(LEGIBILITY_IN_PAGE)});`)() as typeof LEGIBILITY_IN_PAGE;
    document.documentElement.dataset.themeResolved = 'light';
    document.body.innerHTML = `
      <header class="k-head"><p data-testid="kiosk-context" style="font-size: 40px">Kvaternikov trg</p>
        <p data-testid="kiosk-sentence" style="font-size: 38px"><span data-testid="kiosk-sentence-kicker" style="font-size: 28px">Promet</span><span data-testid="kiosk-sentence-text">Tramvaj 6 kreće za dvije minute.</span></p></header>
      <ol><li class="nearby-row"><span class="nearby-title" style="font-size: 46px">Sopot</span><span class="nearby-sub" style="font-size: 24px">Trg bana Jelačića</span></li></ol>
      <p class="k-note" style="font-size: 22px">Napomena</p>
      <p class="maplibregl-ctrl-attrib" style="font-size: 12px">OpenStreetMap</p>
      <div data-testid="kiosk-map"><span data-symbol="bajs" style="font-size: 16px">4</span></div>`;
    const rect = (w: number, h: number) => ({ x: 0, y: 0, left: 0, top: 0, right: w, bottom: h, width: w, height: h, toJSON: () => ({}) }) as DOMRect;
    const realRange = Range.prototype.getBoundingClientRect;
    Range.prototype.getBoundingClientRect = () => rect(120, 30);
    const bajs = document.querySelector<HTMLElement>('[data-symbol=bajs]')!;
    bajs.getBoundingClientRect = () => rect(48, 48);
    try {
      const light = shippedFn(pageSpec(WALL_1920));
      // Place 40 px = 10.8 mm: above the floor, under the comfortable 12 mm (a warning).
      expect(light.warnings.map((f) => f.text)).toEqual(['Kvaternikov trg']);
      // The sentence text inherits 38 px from the read-tier sentence: 10.26 mm, under 10.5 mm.
      expect(light.violations.map((f) => [f.tier, f.text])).toEqual([['read', 'Tramvaj 6 kreće za dvije minute.'], ['walk-up', 'Trg bana Jelačića']]);
      expect(light.violations[0].detail).toContain('under the 10.5 mm floor at 3 m (38.9 px)');
      // The kicker is walk-up (its nearest tier), 28 px: no finding; the title at 46 px is comfortable.
      expect(light.otherSmall.map((f) => f.text)).toEqual(['Napomena']);
      expect(light.symbols).toEqual([{ selector: '[data-testid=kiosk-map] [data-symbol=bajs]', element: 'span', diameterPx: 48, mm: 24 }]);
      expect(light.dark).toBe(false);

      document.documentElement.dataset.themeResolved = 'dark';
      const dark = shippedFn(pageSpec(WALL_1920));
      // In the dark the floor is 11.55 mm (42.8 px): the 40 px place falls under it.
      expect(dark.violations.map((f) => f.text)).toContain('Kvaternikov trg');
      expect(dark.violations.find((f) => f.text === 'Kvaternikov trg')!.floorMm).toBe(11.55);
      expect(dark.dark).toBe(true);
    } finally {
      Range.prototype.getBoundingClientRect = realRange;
      delete document.documentElement.dataset.themeResolved;
    }
  });

  it('skips text a clipping ancestor cuts away (the visually-hidden typed-address link), and measures a run that is partly inside', () => {
    const shippedFn = new Function(`return (${String(LEGIBILITY_IN_PAGE)});`)() as typeof LEGIBILITY_IN_PAGE;
    document.documentElement.dataset.themeResolved = 'light';
    document.body.innerHTML = `
      <p class="k-hint" style="font-size: 30px">ili upiši kod na <a class="k-visually-hidden" data-testid="pair-url" href="https://example.test/s/#ABCD-EFGH"
        style="position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); font-size: 16px">https://example.test/s/#ABCD-EFGH</a></p>
      <div class="k-scroll" style="overflow: hidden; height: 40px"><p class="k-note" style="font-size: 22px">Napomena</p></div>`;
    const rect = (x: number, y: number, w: number, h: number) => ({ x, y, left: x, top: y, right: x + w, bottom: y + h, width: w, height: h, toJSON: () => ({}) }) as DOMRect;
    const realRange = Range.prototype.getBoundingClientRect;
    // Every text run measures 300 × 30 at (100, 100): a range's box ignores the clip, as in a browser.
    Range.prototype.getBoundingClientRect = () => rect(100, 100, 300, 30);
    const link = document.querySelector<HTMLElement>('[data-testid=pair-url]')!;
    const scroll = document.querySelector<HTMLElement>('.k-scroll')!;
    try {
      link.getBoundingClientRect = () => rect(100, 100, 1, 1);
      scroll.getBoundingClientRect = () => rect(0, 90, 1920, 40);
      const report = shippedFn(pageSpec(WALL_1920));
      const texts = [...report.violations, ...report.otherSmall, ...report.warnings].map((f) => f.text);
      expect(texts, 'the 1 px clipped link is not on the wall').not.toContain('https://example.test/s/#ABCD-EFGH');
      // The note's run shares 20 px of height with its clipping box: on the wall, so measured (22 px < 28 px).
      expect(report.otherSmall.map((f) => f.text)).toEqual(['Napomena']);

      // The same note scrolled wholly out of its box is not on the wall either.
      scroll.getBoundingClientRect = () => rect(0, 400, 1920, 40);
      expect(shippedFn(pageSpec(WALL_1920)).otherSmall).toEqual([]);

      // Without the clip the 16 px link text is measured and fails the walk-up floor of its hint, as before.
      link.removeAttribute('style');
      link.style.fontSize = '16px';
      link.getBoundingClientRect = () => rect(100, 100, 300, 30);
      expect(shippedFn(pageSpec(WALL_1920)).violations.map((f) => [f.tier, f.text])).toContainEqual(['walk-up', 'https://example.test/s/#ABCD-EFGH']);
    } finally {
      Range.prototype.getBoundingClientRect = realRange;
      delete document.documentElement.dataset.themeResolved;
    }
  });

  // The kiosk map draws BAJS discs and vehicle pills on one canvas (WP2-E): no [data-symbol] child exists,
  // so the pass reads the container's census, and says so loudly when there is none to read.
  describe('the canvas map', () => {
    const shippedFn = new Function(`return (${String(LEGIBILITY_IN_PAGE)});`)() as typeof LEGIBILITY_IN_PAGE;
    const run = (markup: string): LegibilityReport => {
      document.body.innerHTML = markup;
      try { return shippedFn(pageSpec(WALL_1920)); } finally { document.body.innerHTML = ''; }
    };

    it('names the container and the census attributes it reads', () => {
      expect(WALL_1920.map).toEqual({ selector: '[data-testid=kiosk-map]', census: ['markers', 'unlabelled', 'bajs', 'overlaps', 'pills'] });
      expect(pageSpec(WALL_1920)).toMatchObject({ map: { selector: '[data-testid=kiosk-map]', census: ['markers', 'unlabelled', 'bajs', 'overlaps', 'pills'] }, symbolMm: SYMBOL_MM });
    });

    it('reads data-markers, data-unlabelled, data-bajs, data-overlaps and data-pills from the container of a canvas map', () => {
      const report = run('<div data-testid="kiosk-map" data-markers="3" data-unlabelled="0" data-bajs="counted:1;zero:1;blank:1;far:0" data-overlaps="discs:2;names:17" data-pills="6|11|12|17"><canvas></canvas></div>');
      expect(report.violations).toEqual([]);
      expect(report.map).toEqual({
        selector: '[data-testid=kiosk-map]', element: 'div[data-testid=kiosk-map]', domSymbols: 0, missing: [],
        markers: 3, unlabelled: 0, bajs: { counted: 1, zero: 1, blank: 1, far: 0 }, overlaps: { discs: 2, names: 17 }, pills: 4,
      });
    });

    it('fails loudly when the map has neither [data-symbol] marks nor its census, instead of measuring nothing', () => {
      const bare = run('<div data-testid="kiosk-map" data-pills="6|11"><canvas></canvas></div>');
      expect(bare.map).toMatchObject({ domSymbols: 0, missing: ['markers', 'unlabelled', 'bajs', 'overlaps'], pills: 2 });
      expect(bare.violations.map((f) => [f.tier, f.selector])).toEqual([['symbol', '[data-testid=kiosk-map]']]);
      expect(bare.violations[0].detail).toContain('no [data-symbol] mark and no data-markers, data-unlabelled, data-bajs, data-overlaps');
      const gone = run('<main></main>');
      expect(gone.map).toBeNull();
      expect(gone.violations.map((f) => f.detail)).toEqual(['the map [data-testid=kiosk-map] is missing: its BAJS discs and vehicle pills cannot be measured']);
    });

    it('legibilityViolations carries the loud failure, so the wall spec and the observer both fail on it', async () => {
      const page = { evaluate: (fn: typeof LEGIBILITY_IN_PAGE, arg: ReturnType<typeof pageSpec>) => { document.body.innerHTML = '<div data-testid="kiosk-map"><canvas></canvas></div>'; try { return Promise.resolve(shippedFn(arg)); } finally { document.body.innerHTML = ''; } } } as unknown as LegibilityPage;
      expect((await legibilityViolations(page, WALL_1920)).map((f) => f.tier)).toEqual(['symbol']);
    });
  });
});
