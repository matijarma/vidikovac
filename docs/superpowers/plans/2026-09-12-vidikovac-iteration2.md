# Vidikovac, iteration 2 — implementation plan (12 September 2026)

Built on `main` at tag `sdd-final`. Three areas run as subagent-driven loops in their own worktrees: M (Modrotisak restyle), T (smooth ZET motion), E (Tier-1 events). Wave 1 is M1 to M9, T1 to T6 and E1 to E6 in parallel; wave 2 is T7 to T11 and E7 to E9 after M merges.



---

# Controller rulings, Vidikovac iteration 2 (12 September 2026)

Binding on every implementer and reviewer. They override the task text they name. The approved plan is `C:\Users\MatijaRadeljak\.claude\plans\lets-work-on-this-ethereal-beacon.md`; the design spec is `design.md`; the layout reference is `Vidikovac.dc.html`.

## Lightweight mode (from Matija's own commit 9e0702e, section 1.10 of the proposal)

The filed proposal commits the project to a measurable lightweight mode: `?lagano=1` plus automatic weak-device detection, with **no map, no WebGL, no canvas animation, no container queries and nothing newer than 2017**, the layout breakpoint computed in JavaScript rather than in CSS, a separate ES2017 build beside the modern one, `/hitno` working without JavaScript and without styles, and published measurements of under 200 kB transferred per screen load, under 300 MB of memory, running on a 1 GB device. Everything below follows from that document, which is the authority.

R-L1 Two paths for every new visual capability, decided once at each entry and passed down as a dependency exactly as `reducedMotion` already is. `lightweight` is true when the URL carries `?lagano=1`, or when `navigator.deviceMemory <= 1`, or when a WebGL context cannot be created, or when `matchMedia('(prefers-reduced-data: reduce)')` matches. The flag is written to `document.documentElement.dataset.lagano` so CSS can answer too, and it is remembered in `localStorage` under `vidikovac-lagano` once auto-detected, so the detection runs once per device.

R-L2 What each capability degrades to, with no apology in the copy:
- Panorama: no canvas. The legend text stands alone in mono under the header (it already carries the vehicle count and the time), and the band becomes a 2 px ink rule. The page still says what the panorama would have said.
- Meander: no canvas. A `div` with a background width in percent, stepped in ten quantised steps, inside the same figure with the same legend. No transition.
- Schematic map: no canvas. The same data as a list: the nearest stops with the lines calling at them, tram rows first, each with the route label and the route's median delay in words. It is the honest lightweight face of seeing the trams around you.
- Full MapLibre map: hidden entirely; its button is not rendered.

R-L3 No container queries on a path lightweight mode uses. The kiosk sizes itself from a JavaScript-computed scale written once to a CSS custom property on the kiosk root (`--kiosk-scale`, from the element's own width), and every size is `calc(var(--kiosk-scale) * N)`. Modern browsers get the identical result; 2016 browsers get a working layout. `cqh` and `cqw` units are not used anywhere in kiosk.css.

R-L4 Budget: a lightweight screen load transfers under 200 kB, fonts included. `app/public/data/zet-network.json` is never fetched in lightweight mode, and in modern mode it is fetched after first paint, never as part of the entry chunk. A test sums the built lightweight entry chunk, its CSS and the fonts it references and fails over 200 kB.

R-L5 The separate ES2017 build target and the tested-device matrix in `docs/kiosk.md` are project commitments with their own tasks later in the grant period, not iteration-2 deliverables. What iteration 2 must guarantee is that no new code makes them impossible: no syntax newer than ES2017 in the app source, no CSS feature newer than 2017 on a lightweight path, and every new capability already has its lightweight twin. Implementers state in their report which of the two paths they exercised.

## Area ownership (three parallel loops, wave 1)

M (restyle): `app/src/ui/**`, `app/src/kiosk.ts`, `app/src/dashboard.ts`, `app/src/panels/**`, `app/src/scan.ts`, `app/index.html`, `app/s/index.html`, `app/src/entries/**`, `app/src/format.ts`, `worker/hitno/render.ts`, `worker/open/index-page.ts`, `worker/stats/page.ts`, `test/app/*` for the files it owns, `e2e/a11y.spec.ts`.

T (motion): `scripts/**`, `app/public/data/**`, `app/src/motion/**`, `app/src/map/**`, `app/src/layers/u-pokretu.ts`, `worker/feed/modules/zet-rt.ts`, `worker/feed/schema.ts` (the `vehicle` key list only), `test/motion/**`, `test/scripts/**`, `e2e/motion.spec.ts`.

E (events): `worker/feed/modules/dogadanja/**`, `worker/feed/html.ts`, `worker/feed/hr-date.ts`, `worker/feed/schema.ts` (the `ModuleId`, `ItemKind` and `event` additions only), `worker/feed/registry.ts`, `app/src/layers/kultura.ts`, `app/src/layers/uprava-i-pravo.ts`, `app/src/layers/index.ts`, `docs/izvori.md`, `app/src/data/izvori.json`, `test/feed/**`, `test/docs/**`.

R-O1 `app/src/map/city-map.ts` belongs to T alone. T applies the Modrotisak colours there (closures `#ff9d9d`, vehicles `#f2ead8`, stroke `#16226b`) as part of its own work; M does not touch the file.

R-O2 `app/src/format.ts` belongs to M alone. M adds **both** `zagrebWeekdayDate` (its own need) and `zagrebDayKey` (E's need) in the same task, and E imports them.

R-O3 `worker/feed/schema.ts` is edited by T and E on different lines (T removes two keys from `DATA_KEYS.vehicle`; E adds a `ModuleId`, an `ItemKind` and the `event` key list). Both keep their edits minimal so the merge is mechanical.

R-O4 `app/src/kiosk.ts` is the choke point: M restructures it (wave 1), then T adds the locked schematic and E adds the teaser card (wave 2, after M merges to main).

R-O5 Wave 1 runs M1 to M9, T1 to T6 and E1 to E6 in parallel worktrees. Wave 2 runs T7 to T11 and E7 to E9 after M is merged, on branches rebased onto that main.

R-O6 Line endings are LF (`.gitattributes`); after a merge, re-checkout with `git rm --cached -r . && git reset --hard` before running the suite, exactly as stage 1 did.

## Product rulings carried from the plan

R-P1 The locked kiosk is a public service. Its stage shows the live cropped tram map (trams only by default, about five to six stops around the screen's configured centre, default Trg bana Jelačića), the panorama shrinks to roughly a third of its drawn height directly under the header, and the invitation headline moves under the map above the catalogue row. `teaserSubset('zet-rt')` keeps the vehicles inside that box with their route type and the per-route delay rows instead of stripping them to a count. T9's sentence about the locked kiosk keeping only the panorama is overridden. The centre, radius and mode are beacon properties with a default, and the proposal offers per-screen configuration in the full version.

R-P2 Never display a reported position. Every vehicle is drawn where the motion model computes it: fixes snapped to the route geometry, speed from that vehicle's own fix times, animation at the screen's refresh rate, and gentle convergence onto a new fix instead of a jump. The panel says so in one sentence.

R-P3 The Worker stops publishing `bearing` and `speed`: ZET never sends them and the module was emitting a fabricated zero for every vehicle.

R-P4 Light `--tone-text-subtle` is `#575f7d`, not the spec's `#5d6890`, which fails the contrast gate on the light `surface-2`.

R-P5 Two sources named in the events brief are dropped for robots.txt reasons and the documents must say so: Guru za kulturu (its events come only from a disallowed `/api/` path) and the Skupstina YouTube Atom feed (`Disallow: /feeds/videos.xml`); the channel's live page is linked from plenary sessions, because linking is not crawling.

R-P6 Every source keeps headline-level metadata only: title, time, venue, organiser, link, category. Descriptions are never copied, with the single exception of the communal-works activity field, which is Otvorena dozvola data rather than a borrowed description.

## Core message and the kiosk's own usefulness (Matija, 12 September, two corrections)

R-P7 The gate unlocks the city **on your own device**, and never withholds it from the screen in front of you. A kiosk with a touchscreen therefore carries its own essentials view, reachable with one touch and no phone: the safety layer, the next departures at that screen's stop, the weather, the closures. It needs no session and runs no timer; after ninety seconds without a touch it returns to the invitation. This is not a concession to the mechanic, it is the same principle `/hitno` already follows, and the proposal can say so plainly. Implementation lives with area M (it edits kiosk.ts, which M owns in wave 1) as task M3b.

R-P8 The proposition is not "you pay with attention". It is: a premium view of the city, whose limits exist to push you back into it. You accept a short window and a scan that needs another screen or another person, and in exchange you get everything; the limits are the point, not the price. They raise real encounters between people, businesses, culture and institutions, and they cut screen time rather than farm it. The app is deliberately good enough to stand in for the infinite feed, and deliberately short enough to hand you back to the street. Every surface and the filed proposal must carry that reading; the phrase "Placas paznjom, ne novcem" is retired wherever it appears (kiosk invitation, landing page, `docs/prijava/prijedlog-projekta.md`, design.md).


---

# Area M — Modrotisak restyle (M1 to M9)

Spec: `design.md` (v2.0). Layout reference: `Vidikovac.dc.html` (kiosk 1080p and phone /d, night and day). Rulings: `.superpowers/sdd/2026-09-12-vidikovac-iteration2/rulings.md` — R-L1 to R-L5 (lightweight mode) and R-P4 bind every task here.

Decisions taken before the task list, each a fork the implementer would otherwise hit:

1. Light `--tone-text-subtle` is `#575f7d`, not the spec's `#5d6890`: the latter is 4.11:1 on light `surface-2` `#e9dfc6` and fails the generated contrast matrix. The replacement gives 5.25 / 5.78 / 4.74 on canvas / surface-1 / surface-2 and keeps the slate-indigo character. Every other value in the spec passes; the lowest passing pair in the suite is light `warning` on surface-2 at 4.55.
2. The contrast test needs one word changed, not a new pair table: the spec's list is a subset of the existing cross product, so only `'label'` joins `TEXTS`. Dark label 7.05, light label 5.74.
3. The panorama carries `role="img"` and the legend as `aria-label`; both meanders are `aria-hidden="true"`, because the countdown and the visible legend already say it in text and that keeps the existing `session-ring` assertion intact.
4. The teaser card survives as the headline slot: the mockup's two-line invitation is the teaser, so keeping `[data-testid=teaser-card]` there preserves the rotation test verbatim.
5. The /d header keeps the full sentence in `session-label` (an approved i18n string) and promotes the existing `[data-testid=countdown]` to the Space Grotesk headline with a new mono fine line beside it.
6. The safety strip follows the spec (surface-2 ground, `/hitno` as an action-brand pill that inverts between faces), not the mockup's fully indigo Dan footer.
7. Canvas modules are pure geometry plus a draw function over a narrow structural context, with one DOM wrapper that returns early when there is no box or no 2D context, so every happy-dom test mounts unchanged. No `Path2D` (absent in node and happy-dom): the meander replays a point list twice.
8. Per R-L1 and R-L2 every canvas has a lightweight twin; per R-L3 the kiosk sizes itself from a JS-computed `--kiosk-scale` and uses no container queries.

---

## Task M1: Repaint the palette layer

**Files:** Modify `app/src/ui/tokens.css`, `app/src/ui/base.css`, `app/src/ui/theme.ts`, `app/src/ui/qr.css`, `app/src/ui/kiosk.css`, `app/src/ui/panel.css`, `app/src/ui/layers.css`, `app/src/ui/page.css`, `app/s/index.html`. Test: `test/app/contrast.test.ts`, `test/app/theme.test.ts`.

**Interfaces.** Produces `--tone-label`, `--tone-qr-plate`, `--tone-qr-ink`, and `--palette-{dark,light}-label` (matching the test's `--palette-<theme>-<name>: #hex;` grep). Removes `--palette-dark-gradient`, `--palette-light-gradient`, `--gradient-canvas` (three assignments) and `--tone-surface-gradient`.

- [ ] Replace the two palette blocks, keeping every existing name, the block order, and hexes as the only literal colours:

```css
  /* Layer 1 palettes: modrotisak — indigo cloth, cream print. Two faces of one
     bolt: dark is indigo ground with cream ink, light is the same cloth turned
     over. `label` is the one permitted third shade. */
  --palette-dark-canvas: #16226b;
  --palette-dark-canvas-deep: #0b1440;
  --palette-dark-surface-1: #0f1a52;
  --palette-dark-surface-2: #0b1440;
  --palette-dark-surface-3: #1d2f8a;
  --palette-dark-text-primary: #f2ead8;
  --palette-dark-text-muted: #c3cdf5;
  --palette-dark-text-subtle: #a3aed8;
  --palette-dark-label: #9db4ff;
  --palette-dark-accent: #f2ead8;
  --palette-dark-accent-deep: #ffffff;
  --palette-dark-on-accent: #16226b;
  --palette-dark-warning: #f2c078;
  --palette-dark-danger: #ff9d9d;
  --palette-dark-success: #7fd6a8;
  --palette-dark-border: rgba(242, 234, 216, 0.22);
  --palette-dark-border-strong: rgba(242, 234, 216, 0.45);
  --palette-dark-glass: rgba(15, 26, 82, 0.78);
  --palette-dark-scrim: rgba(4, 8, 32, 0.62);
  --palette-dark-glow: rgba(157, 180, 255, 0.35);

  --palette-light-canvas: #f2ead8;
  --palette-light-canvas-deep: #e9dfc6;
  --palette-light-surface-1: #faf5e9;
  --palette-light-surface-2: #e9dfc6;
  --palette-light-surface-3: #ded2b2;
  --palette-light-text-primary: #16226b;
  --palette-light-text-muted: #4553a8;
  --palette-light-text-subtle: #575f7d;
  --palette-light-label: #3a49b0;
  --palette-light-accent: #16226b;
  --palette-light-accent-deep: #0b1440;
  --palette-light-on-accent: #f2ead8;
  --palette-light-warning: #8a5800;
  --palette-light-danger: #b3271e;
  --palette-light-success: #1e6f47;
  --palette-light-border: rgba(22, 34, 107, 0.24);
  --palette-light-border-strong: rgba(22, 34, 107, 0.5);
  --palette-light-glass: rgba(250, 245, 233, 0.78);
  --palette-light-scrim: rgba(22, 34, 107, 0.4);
  --palette-light-glow: rgba(22, 34, 107, 0.25);
```

Shadows keep their current values.

- [ ] Add `--color-label: var(--palette-<theme>-label);` to all three assignment blocks (`:root, :root[data-theme-resolved='dark']`, `:root[data-theme-resolved='light']`, and the `@media (prefers-color-scheme: light)` no-JS block). Delete `--gradient-canvas` from all three. Never write the string `[data-theme='dark']` anywhere, comments included: the contrast test greps for its absence.
- [ ] In layer 2 add, and delete `--tone-surface-gradient`:

```css
  /* Catalogue numbers, quiet caps labels, footer links. The only third shade. */
  --tone-label: var(--color-label);

  /* A QR is a printed object, not a themed surface: cream paper and indigo ink
     in both faces. Pinned to the palette so the pair can never be half
     overridden — see the note in qr.css. */
  --tone-qr-plate: var(--palette-light-canvas);
  --tone-qr-ink: var(--palette-dark-canvas);
```

- [ ] `base.css`: delete `background-image: var(--tone-surface-gradient);` and its `background-repeat`. The ground is flat cloth. Verify `grep -rn "surface-gradient\|gradient-canvas" app/src` returns nothing.
- [ ] `qr.css`: replace the pinned `#f8fafc` / `#0f172a` with `var(--tone-qr-plate)` / `var(--tone-qr-ink)` and extend the existing comment to say the pair now lives in one declaration so it still cannot be half overridden.
- [ ] Fix the three phantom tokens that silently fell back to `color-mix`: `--tone-muted` to `--tone-text-muted` (kiosk.css lines 9, 19, 36; panel.css 25; layers.css 2; page.css 9), `--tone-surface` to `--tone-surface-1` (panel.css 10), `--tone-warn` to `--tone-state-warning` (panel.css 30).
- [ ] `theme.ts`: `THEME_COLOR_FALLBACK = { light: '#f2ead8', dark: '#16226b' }`.
- [ ] `app/s/index.html`: `<meta name="theme-color" content="#16226b">`.
- [ ] Test edit, `test/app/contrast.test.ts`: `const TEXTS = ['text-primary', 'text-muted', 'text-subtle', 'accent', 'warning', 'danger', 'success', 'label'];`
- [ ] Test edit, `test/app/theme.test.ts`: the `'#0b1020'` expectation becomes `'#16226b'`.
- [ ] `npx vitest run --project unit` green: 48 contrast pairs plus the two on-accent pairs and the three structural assertions.

**Commit:** `Repaint the palette as modrotisak: indigo cloth, cream print, no sky`

---

## Task M2: canvas plumbing, panorama and meander, with their lightweight twins

**Files:** Create `app/src/ui/canvas.ts`, `app/src/ui/panorama.ts`, `app/src/ui/meander.ts`, `app/src/ui/lagano.ts`. Create `test/app/canvas.test.ts`, `test/app/panorama.test.ts`, `test/app/meander.test.ts`, `test/app/lagano.test.ts`. Modify `app/src/layers/shared.ts` (one exported helper).

**Interfaces:**

```ts
// app/src/ui/lagano.ts  (R-L1)
export const LAGANO_STORAGE_KEY = 'vidikovac-lagano';
export interface LaganoProbe {
  search?: string;
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
  navigator?: { deviceMemory?: number };
  matchMedia?: (q: string) => { matches: boolean };
  canWebgl?: () => boolean;
}
/** True when the device or the URL asks for the light path. Remembers an
 *  auto-detected answer so the probe runs once per device. */
export function detectLagano(probe?: LaganoProbe): boolean;
/** Writes documentElement.dataset.lagano so CSS can answer too. */
export function markLagano(root: HTMLElement, lagano: boolean): void;

// app/src/ui/canvas.ts
export const DENSITY = 2;
export interface SizedCanvas { ctx: CanvasRenderingContext2D; w: number; h: number }
export function prepareCanvas(canvas: HTMLCanvasElement, density?: number): SizedCanvas | null;
export function tone(el: Element, name: string, fallback: string): string;
export function repaintOn(
  theme: { onChange(l: () => void): () => void },
  view?: Pick<Window, 'addEventListener' | 'removeEventListener' | 'requestAnimationFrame'>,
): (listener: () => void) => () => void;
/** The JS-computed kiosk scale of R-L3: writes --kiosk-scale on the element. */
export function applyScale(el: HTMLElement, designWidth: number): number;

// app/src/ui/meander.ts
export const MEANDER_STEPS = 10;
export interface StrokeContext { /* save restore beginPath moveTo lineTo rect clip stroke + strokeStyle lineWidth lineJoin miterLimit */ }
export interface MeanderGeometry { lineWidth: number; points: readonly (readonly [number, number])[] }
export function meanderGeometry(w: number, h: number): MeanderGeometry;
export function quantise(pct: number, steps?: number): number;
export function drawMeander(ctx: StrokeContext, g: MeanderGeometry, o: { w: number; h: number; ink: string; fill: string; pct: number }): void;
export function paintMeander(canvas: HTMLCanvasElement, o: { ink: string; fill: string; pct: number }): void;
/** Lightweight twin: sets the width of the inner bar in quantised percent. */
export function paintMeanderBar(bar: HTMLElement, pct: number): void;

// app/src/ui/panorama.ts
export interface Rect { x: number; y: number; w: number; h: number }
export type Shape = ({ kind: 'rect' } & Rect) | { kind: 'poly'; points: readonly (readonly [number, number])[] };
export interface PanoramaGeometry {
  w: number; h: number;
  ridge: readonly (readonly [number, number])[];
  tower: { mast: Rect; pod: { cx: number; cy: number; rx: number; ry: number }; base: Rect };
  city: readonly Shape[];
  baseline: Rect;
  rail: { y: number; lineWidth: number };
  beads: { y: number; r: number; xs: readonly number[] };
}
export interface FillContext { /* beginPath moveTo lineTo closePath fill fillRect arc ellipse stroke + globalAlpha fillStyle strokeStyle lineWidth */ }
export function panoramaGeometry(w: number, h: number, count: number, seed?: number): PanoramaGeometry;
export function drawPanorama(ctx: FillContext, g: PanoramaGeometry, fg: string): void;
export function paintPanorama(canvas: HTMLCanvasElement, o: { fg: string; count: number }): void;

// app/src/layers/shared.ts
/** Vehicles moving now, from either shape of a zet-rt snapshot. */
export function vehicleCount(snapshot: ModuleSnapshot | undefined): number | null;
```

- [ ] `canvas.ts`, the only DOM-touching file:

```ts
export function prepareCanvas(canvas: HTMLCanvasElement, density = DENSITY): SizedCanvas | null {
  const rect = canvas.getBoundingClientRect?.();
  const cssW = rect?.width || canvas.clientWidth || 0;
  const cssH = rect?.height || canvas.clientHeight || 0;
  // happy-dom lays nothing out, so this is where every unit test leaves.
  if (cssW <= 0 || cssH <= 0) return null;
  const w = Math.round(cssW * density);
  const h = Math.round(cssH * density);
  canvas.width = w;
  canvas.height = h;
  let ctx: CanvasRenderingContext2D | null = null;
  try { ctx = canvas.getContext('2d'); } catch { ctx = null; }
  return ctx ? { ctx, w, h } : null;
}

export function tone(el: Element, name: string, fallback: string): string {
  try { return getComputedStyle(el).getPropertyValue(name).trim() || fallback; } catch { return fallback; }
}

export function repaintOn(theme, view = globalThis as unknown as Window) {
  return (listener: () => void) => {
    let queued = false;
    const run = (): void => { queued = false; listener(); };
    const schedule = (): void => { if (queued) return; queued = true; view.requestAnimationFrame(run); };
    const offTheme = theme.onChange(listener);   // fires once immediately: first paint
    view.addEventListener('resize', schedule);
    return () => { offTheme(); view.removeEventListener('resize', schedule); };
  };
}

/** R-L3: one number in JS instead of container queries, so a 2016 browser
 *  lays the kiosk out exactly like a 2026 one. */
export function applyScale(el: HTMLElement, designWidth: number): number {
  const width = el.getBoundingClientRect?.().width || el.clientWidth || designWidth;
  const scale = width / designWidth;
  el.style.setProperty('--kiosk-scale', String(Math.round(scale * 1000) / 1000));
  return scale;
}
```

- [ ] `lagano.ts`: `detectLagano` checks, in order, an explicit `?lagano=1` or `?lagano=0` in `search` (which also writes the storage answer), then the stored answer, then `deviceMemory <= 1`, then `prefers-reduced-data: reduce`, then `canWebgl() === false`; every input injected, every access in try/catch, default false.
- [ ] `meander.ts`: `meanderGeometry` builds the mockup's square wave as a point list, `quantise` floors to ten steps, `drawMeander` strokes the list twice (trace, then the remaining interval clipped to `w * pct`), `paintMeander` wraps it through `prepareCanvas`, `paintMeanderBar` is the lightweight twin that writes `style.width = (quantise(pct) * 100) + '%'`.
- [ ] `panorama.ts`: port the spec's geometry exactly, including the same linear-congruential sequence `(s * 1103515245 + 12345) >>> 0`, so the approved skyline is reproduced bit for bit. Draw order and alphas: ridge .30, tower .55 (mast rect, ellipse pod, base rect, never a horizontal bar), city and baseline 1, rail .28, beads .95, then reset to 1.
- [ ] `shared.ts`: `vehicleCount` reads the teaser summary item `id === 'vozila'` via `dataNumber(item, 'vehicles')`, else counts items whose id starts with `vehicle:`.
- [ ] Tests (node environment where there is no DOM): determinism for a fixed seed; the ridge has nine crests all above the baseline; `tower.base.h >= tower.base.w` and the base sits below the pod (the never-a-crossbar invariant); the city holds one cathedral group first crossing 0.36 of the width and one slim tower crossing 0.60; every city rect's bottom equals the baseline; `beads.xs.length === count`, strictly increasing, inside the box, all sharing one `y` (never a grid); `count === 0` draws the rail and no beads; a recording `FillContext` sees the alpha sequence `[0.3, 0.55, 1, 0.28, 0.95, 1]`. Meander: line width is 30 % of height, the point list alternates and never exceeds the width, `quantise(0.37) === 0.3`, `quantise(0.999) === 0.9`, `quantise(1) === 1`, `quantise(-2) === 0`, and a recording `StrokeContext` proves two passes with the second clipped to `rect(0, 0, w * pct, h)`. Canvas: `prepareCanvas` returns null under happy-dom without throwing; `tone` falls back; `repaintOn` fires once on subscribe, once per resize after a frame, and unsubscribes both. Lagano: each trigger in isolation, the stored answer winning over detection, `?lagano=0` forcing the modern path.
- [ ] `npx vitest run --project unit` green; nothing imports the new modules yet.

**Commit:** `Draw the panorama and the meander as geometry, with a light path for old screens`

---

## Task M3: the kiosk

**Files:** Modify `app/src/kiosk.ts`, `app/src/ui/kiosk.css`, `app/src/entries/kiosk.ts`, `app/src/format.ts`, `app/src/i18n/hr.json`, `app/src/i18n/en.json`, `docs/kiosk.md`. Test: `test/app/kiosk.test.ts`.

**Interfaces.** Produces `catalogueRows(modules, i18n): CatalogueEntry[]` and `MEANDER_TICK_MS = 1000`; removes `RING_SEGMENTS`. New `KioskDeps` members: `onRepaint?: (listener: () => void) => () => void` and `lightweight?: boolean`. Consumes `paintPanorama`, `paintMeander`, `paintMeanderBar`, `quantise`, `MEANDER_STEPS`, `tone`, `applyScale`, `vehicleCount`, `slotProgress`, and the two new formatters.

- [ ] `format.ts` gains, beside `zagrebDateTime`, both formatters (R-O2): `zagrebWeekdayDate(value)` returning `pet 11. 9. 2026.` and `zagrebDayKey(value)` returning `2026-09-12` (an `en-CA` formatter in `Europe/Zagreb`, the trick `worker/feed/time.ts` already uses).
- [ ] New i18n keys in both catalogues. Legends are stored already in capitals because Croatian genitive suffixes must stay lowercase (`ZET-a`), which a blanket `text-transform: uppercase` would destroy:

```jsonc
"kiosk": {
  "legendPanorama": "SL. 1 — ZAGREBAČKA PANORAMA: MEDVEDNICA I GRAD · NA PRUZI JEDNA TOČKA = JEDNO VOZILO ZET-a · {count} U POKRETU, {time}",
  "legendPanoramaLoading": "SL. 1 — ZAGREBAČKA PANORAMA · UČITAVANJE PODATAKA",
  "legendQr": "SL. 2 — OTISAK ZA KAMERU",
  "legendMeander": "SL. 3 — MEANDAR KODA · ISPRAZNI SE SVAKIH 30 s, PA SE IZDA NOVI KOD",
  "safetyLabel": "SIGURNOST — OTVORENO SVIMA",
  "catalogueWeather": "MAKSIMIR SADA",
  "catalogueVehicles": "ZET U POKRETU",
  "catalogueClosures": "PROMETNICE",
  "unitVehicles_one": "vozilo", "unitVehicles_few": "vozila", "unitVehicles_other": "vozila",
  "unitClosed_one": "zatvorena", "unitClosed_few": "zatvorene", "unitClosed_other": "zatvorenih"
}
```

- [ ] Rewrite the kiosk markup. Every existing test id keeps its name and its role; `code-ring` moves onto the canvas (or the bar in lightweight mode):

```html
<p class="kiosk-alert" role="alert" data-testid="kiosk-alert" hidden></p>
<header class="kiosk-head">
  <p class="kiosk-wordmark">Vidikovac <span class="kiosk-tagline">Zagreb, povezan.</span></p>
  <p class="kiosk-when"><span class="kiosk-date" data-testid="kiosk-date"></span>
    <time class="kiosk-clock" data-testid="kiosk-clock"></time></p>
</header>
<figure class="kiosk-fig kiosk-panorama">
  <canvas class="panorama" data-testid="panorama" role="img" aria-label=""></canvas>
  <figcaption class="legend" data-testid="panorama-legend"></figcaption>
</figure>
<section class="kiosk-stage" data-testid="kiosk-stage">
  <div class="kiosk-teaser">
    <div class="kiosk-live" data-testid="kiosk-live"></div>
    <article class="teaser-card" data-testid="teaser-card"></article>
    <figure class="kiosk-fig kiosk-meander">
      <canvas class="meander" data-testid="code-ring" data-motion="sweep" aria-hidden="true"></canvas>
      <figcaption class="legend"></figcaption>
    </figure>
    <div class="kiosk-catalogue" data-testid="kiosk-catalogue"></div>
  </div>
  <aside class="kiosk-code" aria-label="Kod">
    <div class="code-card">
      <div class="kiosk-qr" data-testid="kiosk-qr"></div>
      <p class="kiosk-code-value" data-testid="pair-code"><span data-testid="code-a"></span><span class="code-dash">-</span><span data-testid="code-b"></span></p>
      <p class="legend kiosk-code-hint"></p>
    </div>
    <a class="visually-hidden" data-testid="pair-url" href="" hidden></a>
  </aside>
  <div class="kiosk-layer" data-testid="kiosk-layer" hidden></div>
  <div class="corner-qr" data-testid="corner-qr" hidden></div>
</section>
<footer class="kiosk-safety" data-testid="safety-strip"></footer>
```

`.kiosk-live` is the empty stage slot area T fills in wave 2 with the cropped tram map (R-P1); until then it stays empty and the headline sits where the mockup has it. The `aside` keeps `kiosk.codeLabel` as its accessible name now that the visible label line is gone, and `kiosk.typeCode` moves into the hint line under the QR.

- [ ] Replace `paintRing` with a meander painter that chooses its path once: `lightweight ? paintMeanderBar(bar, pct) : paintMeander(canvas, { ink, fill, pct })`, with `pct` quantised under reduced motion or lightweight, `data-motion` set to `sweep` or `segments`, and `data-pct` written as a two-decimal string so happy-dom can assert it. Add `paintPanoramaFigure()` (count from the zet-rt teaser through `vehicleCount`, legend text into both the `figcaption` and the canvas `aria-label`, the loading variant when the count is null), `paintHeader()` (date and clock) and `paintCatalogue()`.
- [ ] In lightweight mode the panorama figure renders no canvas at all: the legend line stands alone and the band is a 2 px rule (R-L2).
- [ ] `catalogueRows(modules, i18n)` returns three entries: 01 Maksimir (temperature and the weather word), 02 ZET (vehicle count and the plural unit), 03 Prometnice (closure count and its plural). The `01` prefix comes from a CSS counter, never from the string.
- [ ] `paintStrip()` gains a leading label span (`kiosk.safetyLabel`, `--tone-label`) and a trailing `/hitno` pill anchor; the three existing spans keep their text so the current assertions pass.
- [ ] `kiosk.css`: delete `.code-ring`, `.ring-sweep`, `.ring-segment`, the keyframes and the segments rule. Add the new layout **without container queries** (R-L3), every size `calc(var(--kiosk-scale) * Npx)` against a 1920 design width: header with a 2 px bottom rule, wordmark 38, tagline and date 22, clock 38 mono, panorama band 264 (88 when a session is unlocked or when T's live map takes the stage), legend 19 mono with .04em tracking, stage as a two-column grid `1fr 560px` with 64 gap, teaser title 68 with the second line in `--tone-label`, meander 72, catalogue with a top rule and `counter-reset`, `.cat-label` 19 mono in label blue with `::before { content: counter(cat, decimal-leading-zero) ' · ' }`, `.cat-value` 48 display, code card with a 4 px ink border on `--tone-surface-1`, QR plate in `--tone-qr-plate`, code value 52 mono with .14em tracking, safety strip on `--tone-surface-2` with the `/hitno` pill in `--tone-action-brand` on `--tone-action-brand-fg`.
- [ ] `entries/kiosk.ts`: keep `theme` from `bootPage`, detect lightweight once, mark the root, and pass `onRepaint: repaintOn(theme)` and `lightweight`.
- [ ] Test edit (the one deliberate casualty): the six-segment assertion becomes the ten-step quantisation assertion, checking `code-ring` is a canvas in modern mode with `data-motion="sweep"` and `data-pct="1.00"` on a fresh slot, and `data-motion="segments"` with `data-pct="0.70"` for a slot seven seconds in under reduced motion. New tests: the header shows the time and the weekday date; the panorama's `aria-label` equals its caption and names the live count; the catalogue renders three rows with the fixture's values; in lightweight mode no `canvas` element exists anywhere in the kiosk and the meander bar carries the quantised width.
- [ ] `docs/kiosk.md`: the sentence about the rotating ring becomes the meander sentence.

**Commit:** `Rebuild the kiosk as a gallery sheet: header, panorama, meander, catalogue, code card`

---

## Task M4: the dashboard

**Files:** Modify `app/src/dashboard.ts`, `app/src/ui/dashboard.css`, `app/src/entries/dashboard.ts`, both i18n catalogues. Test: additions only to `test/app/dashboard.test.ts`.

**Interfaces.** New `DashboardDeps` members `onRepaint` and `lightweight`. Removes the private `RING_LENGTH` and the two ring circles. New i18n: `session.legendMeander` = `SL. 1 — MEANDAR SESIJE · ISPRAZNI SE DO {time}`, `session.remainingFine` = `· još {time}`, `session.panoramaAlt`.

- [ ] Header markup in this order, every test id preserved: a panorama figure above the header; `.dash-head-top` holding `session-label` and the `share-city` button; `.dash-clock` holding the promoted `countdown` and a new `countdown-fine`; a meander figure whose canvas keeps `data-testid="session-ring"` and `aria-hidden="true"`; then the toggles.
- [ ] `paintTimer()` keeps every existing line and replaces the `stroke-dashoffset` write with the fine line, the legend and the meander paint (canvas or bar), quantised under reduced motion or lightweight. A second injected timer at `MEANDER_TICK_MS` drives the one-second step, cleared in `freeze()` and `destroy()`.
- [ ] `toggle-countdown` hides all time pressure: the countdown, the fine line and the meander figure, via `element.dataset.countdown`.
- [ ] The panorama count comes from the `zet-rt` snapshot through `vehicleCount`, repainted at the end of `render()` and from `onRepaint`.
- [ ] `dashboard.css`: delete the ring rules; add the panorama band at 92, the mono label and share button, the display countdown at 2rem with the mono fine line in label blue, the meander at 32, and tabs as mono uppercase with a 3 px ink underline on the selected tab instead of pills.
- [ ] New tests only: the fine line reads `· još 10:00` after join; the legend names the expiry time; the panorama canvas carries `role="img"` and a non-empty label; in lightweight mode the dashboard renders no canvas.

**Commit:** `Give the session a meander instead of a ring, and tabs instead of pills`

---

## Task M5: panels become catalogue rows

**Files:** Modify `app/src/ui/panel.css`, `app/src/panels/panel.ts`, `app/src/ui/layers.css`. No test changes; `panel.test.ts` and `layers.test.ts` must stay green.

- [ ] `panel.ts`: insert `<span class="panel-index" aria-hidden="true"></span>` as the first child of `.panel-head`. The number is a CSS counter, so there is no numbering logic, no new i18n and nothing for a screen reader to read twice.
- [ ] `panel.css`: the panel stops being a card. `.layer-panels` becomes a block with `counter-reset: panel`; `.panel` becomes a two-column grid (index, content) with a hairline bottom rule, no background, no radius, no border; `.panel-title` becomes quiet (small, muted, body font) while `.big-number` becomes loud (display, 700, 1.8rem); the freshness pill becomes mono uppercase; the footer loses its top border and the attribution goes subtle.

**Commit:** `Turn the panels into catalogue rows: quiet label, loud figure, hairline rule`

---

## Task M6: the scan page

**Files:** Modify `app/src/scan.ts`, `app/src/ui/scan.css`, `app/s/index.html`, both i18n catalogues. No test changes.

- [ ] New key `scan.or` (`ili` / `or`). Split `.scan-actions` so the separator sits between the submit button and the camera button; both are found by test id, so the reorder is free.
- [ ] `scan.css`: title 2rem; the code input 3.25rem tall, 1.75rem mono, .14em tracking, a 2 px `--tone-stroke-strong` border on `--tone-surface-1`; the actions a grid with both controls at 3.25rem; the `ili` separator a flex row with hairlines either side; the confirm code in ink rather than an accent tint.
- [ ] `app/s/index.html`: the `/hitno` footer link becomes a card on `--tone-surface-1` with a hairline border; the other three links stay flat.

**Commit:** `Set the scan form in ink: one field, two actions, a card for hitno`

---

## Task M7: the landing page

**Files:** Create `app/src/entries/landing.ts`. Modify `app/index.html`. Verify `test/app/pages.test.ts`.

- [ ] Inline palette becomes indigo and cream in both schemes (dark `#16226b` / `#f2ead8` / `#c3cdf5` / `#9db4ff`; light the inverse with `#4553a8` and `#3a49b0`).
- [ ] Insert a panorama canvas plus its legend after the `h1`, sized `clamp(120px, 22vw, 180px)`.
- [ ] Add an external module script (never inline: the CSP and the page test both forbid it) that fetches `/api/teaser`, takes `vehicleCount`, paints and fills the legend; on failure it paints with no beads and keeps the loading legend; in lightweight mode it paints nothing and leaves the legend text.
- [ ] Do not write the string `Inter` anywhere in the file; keep `'Manrope'` in the stack.

**Commit:** `Put the panorama on the front door`

---

## Task M8: the server-rendered pages

**Files:** Modify `worker/hitno/render.ts` (both style blocks), `worker/open/index-page.ts`, `worker/stats/page.ts`. No test changes.

- [ ] Swap each `:root` block and its light twin to the modrotisak values, keeping every variable name so the rest of each stylesheet is untouched:

```css
:root{color-scheme:dark light;--bg:#16226b;--fg:#f2ead8;--muted:#c3cdf5;--accent:#9db4ff;
--line:rgba(242,234,216,.22);--card:#0f1a52;--amber:#f2c078;--red:#ff9d9d;--ok:#7fd6a8}
@media (prefers-color-scheme:light){:root{--bg:#f2ead8;--fg:#16226b;--muted:#4553a8;
--accent:#3a49b0;--line:rgba(22,34,107,.24);--card:#faf5e9;--amber:#8a5800;--red:#b3271e;--ok:#1e6f47}}
```

These pages stay zero-JS with one inline style block and no new request. `city-map.ts` is not touched here: it belongs to area T (R-O1).

**Commit:** `Re-ink the server-rendered pages`

---

## Task M9: the accessibility matrix

**Files:** Modify `e2e/a11y.spec.ts`.

- [ ] Extend the page table so every surface is checked at the two sizes the design was drawn for, in both schemes: `/` at 1920 and at 390, `/hitno` at 390, `/kiosk/` at 1920, `/s/` at 390, `/d/` at 390 and at 1920. Put the viewport width in the test title so the repeated paths do not collide.
- [ ] Run the full verification: both vitest projects, typecheck, build, the pairing spec, the axe sweep (fourteen runs), and screenshots of both faces at both sizes checked against the mockup (the 2 px header rule, one bead row, the tower never a cross, the 4 px code frame with its cream plate, the catalogue numbers in label blue, the `/hitno` pill inverting, the meander emptying from the right, the tab underline with no pills, and with reduced motion forced the meander stepping in ten visible jumps).

**Commit:** `Check every surface at both sizes in both faces`

---

## Task M3b: the essentials view — a screen that answers without a phone (ruling R-P7)

Insert this task between M3 and M4. It is the product half of the corrected core message: scanning unlocks the city **on your own device**, and never withholds it from the screen a person is standing in front of. A touch screen must answer the ordinary question without a phone, exactly as `/hitno` already does for the web.

**Files:** Modify `app/src/kiosk.ts`, `app/src/ui/kiosk.css`, both i18n catalogues, `docs/kiosk.md`. Test: `test/app/kiosk.test.ts`.

**Interfaces.** Produces `ESSENTIALS_IDLE_MS = 90_000` and `essentialsRows(modules, i18n, now): EssentialsRow[]` where `EssentialsRow = { id: string; label: string; value: string; detail?: string; attribution?: string }`. New `KioskDeps` members are not needed: reuse the injected `setTimeout`/`clearTimeout` the countdown already takes.

- [ ] New i18n keys in both catalogues, Croatian in singular imperative:

```jsonc
"kiosk": {
  "essentialsOpen": "Osnovno",
  "essentialsTitle": "Osnovno, bez skeniranja",
  "essentialsHint": "Ovaj zaslon odgovara i bez telefona. Skeniranje otključava cijeli grad na tvom uređaju.",
  "essentialsClose": "Natrag",
  "essentialsEmpty": "Izvor trenutačno ne odgovara. Sigurnosni sloj radi na /hitno."
}
```

- [ ] Add one button to the safety strip, before the `/hitno` pill: `<button type="button" class="kiosk-essentials-open" data-testid="kiosk-essentials-open">`. It is the only interactive control on a locked kiosk besides the pill, so it is big: at least 44 px of target at `--kiosk-scale` 1, and it never appears in an unlocked session (the driver's layer is already the full thing).
- [ ] Add the panel as a sibling of `.kiosk-stage`, hidden by default:

```html
<section class="kiosk-essentials" data-testid="kiosk-essentials" hidden aria-labelledby="ess-title">
  <header><h2 id="ess-title"></h2><p class="legend"></p>
    <button type="button" data-testid="kiosk-essentials-close"></button></header>
  <div class="ess-rows" data-testid="kiosk-essentials-rows"></div>
</section>
```

- [ ] `essentialsRows()` reads the same `ModuleSnapshot[]` the teaser cards already receive, so no new endpoint and no new fetch. Rows, in this order, each skipped when its module is down or empty: the CAP warning state in words; the closures count with the nearest street named; the next departures at the screen's configured stop (from the `zet-rt` route rows already in the teaser subset); the Maksimir observation; the nearest on-duty pharmacy. Each row carries its filled attribution through the existing `fillAttribution` helper, because an open screen is exactly where the Otvorena dozvola line has to appear. When every module is down, render one row with `essentialsEmpty`.
- [ ] Opening: unhide the panel, hide the stage, move focus to the `h2`, and arm a 90 s idle timer through the injected `setTimeout`. Any `pointerdown` or `keydown` inside the panel rearms it. Closing (the button, `Escape`, or the idle timer) restores the stage and returns focus to the open button. No session is created, no countdown runs, nothing is announced to a room, and no metric beyond the existing open-tier counter is recorded.
- [ ] Never render the panel when a session is live: a driver's layer already shows more than this.
- [ ] `kiosk.css`: the panel covers the stage area only, never the header or the strip, so the clock and the safety line stay visible while someone reads. Rows are the catalogue geometry from M3 at a larger step: label 24 mono in `--tone-label`, value 56 display, detail 24 body, attribution 17 subtle. Both buttons get a 2 px ink border and the `--tone-surface-1` ground.
- [ ] Tests: the button exists on a locked kiosk and not in a session; clicking it reveals the panel, hides the stage and focuses the heading; the rows carry the fixture's warning, closure count and temperature with no raw `{` in any attribution; `Escape` closes it; advancing the injected timer by 90 s closes it; a `pointerdown` at 80 s postpones the close past 90 s; with every module down exactly one row renders and it is the honest sentence.
- [ ] `docs/kiosk.md`: a new paragraph stating that a touch screen answers without a phone, what the button shows, and that the ninety-second return is deliberate so the next passer-by finds the invitation.

**Commit:** `Give the locked screen an essentials view: a kiosk must answer without a phone`

---

## Note for M3 (the invitation copy changed on main)

Commit `3d7b2e5` retired "Plaćaš pažnjom, ne novcem". The approved line is now `Skeniraj za 10 minuta grada. Manje ekrana, više Zagreba.` in `kiosk.invitation`, with `Scan for 10 minutes of the city. Less screen, more Zagreb.` as the English twin, and both assertions in `test/app/i18n.test.ts` and `test/app/kiosk.test.ts` already match. M3 renders the first sentence in ink and the second in `--tone-label`, exactly as the mockup does at `Vidikovac.dc.html:69`. Split on the first full stop; never hard-code either half.


---

# Area T — smooth ZET motion (T1 to T11)

Rulings: `.superpowers/sdd/2026-09-12-vidikovac-iteration2/rulings.md`. R-P1, R-P2, R-P3, R-O1, R-O3 and R-L1 to R-L5 bind every task here. Wave 1 is T1 to T6; wave 2 (T7 to T11) starts after area M merges to main.

## The rule this area exists to enforce

Matija, 12 September: *"we should rely on the sparse real-time data, in fact we should assume that with all the latencies and such it's wrong, and therefore we make it a rule that we never show or care about the reported location, but we have a good algorithm that takes all available data into consideration and calculates the speed of each tram and bus and makes their movement smooth around the coordinates reported."*

So: a reported position is evidence, never output. Every drawn vehicle sits where the model computes it from that vehicle's own fix history and the route geometry, and a new fix is something the model converges onto, never something it jumps to.

## Verified facts the tasks depend on (probes, 12 September 2026)

- The realtime feed ticks every 30 s (`FULL_DATASET`, version 1.0). A `VehiclePosition` carries `trip{tripId, routeId, startDate}`, `position{lat, lon}`, `vehicle{id}` and its own `timestamp`. **There is no bearing and no speed on the wire**; the current module reads them anyway and protobufjs returns 0, so every vehicle row claims to face due north and stand still.
- Per-vehicle cadence is about 30 s with skips. A few fixes are up to 20 minutes stale. A stationary vehicle repeats byte-identical coordinates. A moving one covers 100 to 620 m per 30 s.
- Static GTFS is a 14.7 MB zip. `shapes.txt` holds 77,357 points in 524 shapes and `shape_dist_traveled` is empty throughout. `trips.txt` holds 77,905 trips, 89.85 % with a shape. No shape is shared between routes. 151 of 154 routes have shapes (tram 1 and buses 114 and 275 have none). Median 3 shapes per route, maximum 17. Realtime `tripId` joins `trips.txt` 100 % of the time and yields a shape 96 % of the time. `stops.txt` holds 3,805 stops. `stop_times.txt` is 92 MB and is never shipped.
- Douglas-Peucker at 5 m keeps 33,881 of the 77,357 points. All shapes at 5 decimals are 660 KB raw and 97 KB gzipped; one route is about 0.8 KB gzipped.
- `scripts/gtfs-routes.mjs` already contains a zero-dependency zip reader; reuse it rather than adding a dependency.

## Decisions taken before the task list, with their reasons

1. **The client matches shapes; the Worker does not resolve `tripId` to `shapeId`.** The candidate set is tiny (median 3, worst 17), a Worker-side index would duplicate about 1.5 MB next to geometry the client already needs, the scheduled shape is not evidence of where a diverted vehicle actually is, and only client-side matching produces the residual that decides free-plane mode. `tripId` stays on the wire because a change of `tripId` for the same vehicle is the only reliable turn-around signal; without it every terminus ends in a snap.
2. **The network artefact is fetched, not imported.** `app/public/data/zet-network.json` is loaded after first paint. Importing it would put roughly 400 KB into the `/d` and `/kiosk` entry chunks and parse it at boot, and R-L4 forbids that outright.
3. **Every motion constant has a reason, and the reason goes in a comment.** Simplify shapes at 5 m, below the 1.1 m coordinate quantum at 5 decimals; the diagram at 120 m. Speed is the median of the last three intervals, clamped to 22 m/s, halved every 45 s after 90 s of silence, and dropped at 300 s, matching the module's own `maxStale`. Convergence is exponential with tau 1.5 s forward and 4 s backward, a 15 m dead zone, a catch-up cap of `max(4 m/s, speed)`, and a hard snap beyond 150 m, because past that the model is wrong rather than imprecise and sliding would be a smooth lie. Shape choice adds a 60 m direction penalty with 25 m hysteresis. Dead reckoning may never carry a vehicle past a stop nobody saw it pass, which also bounds a bad speed estimate at one stop spacing.
4. **Stationary detection is exact equality of the rounded coordinates**, because the feed repeats them byte-identically. A standing vehicle draws at speed 0 and never drifts.
5. **Direction at a standstill is undecidable and is shown as "smjer nepoznat"** until the evidence exceeds 0.3, rather than guessed.
6. **The lightweight twin of the schematic is a list, not a smaller canvas** (R-L2), and the full map is not rendered at all on that path.

---

## Task T1: the offline network artefact

**Files:** Create `scripts/gtfs-shapes.mjs`, `app/public/data/zet-network.json` (generated, committed), `app/src/motion/network-meta.ts` (generated constants). Modify `package.json` (one script entry). Test: `test/scripts/gtfs-shapes.test.ts`.

**Interfaces.** The artefact's shape, which every later task reads:

```jsonc
{
  "version": 1,
  "feedVersion": "<feed_info, or the zip's mtime>",
  "builtAt": "2026-09-12T…Z",
  "origin": [15.9, 45.75],          // lon, lat of the delta origin
  "scale": 1e-5,                    // delta unit in degrees
  "routes": [{ "id": "…", "short": "2", "type": 0, "rank": 3, "shapes": [0, 4] }],
  "shapes": [{ "id": "…", "route": "…", "d": [dx, dy, dx, dy, …], "len": 8241.3 }],
  "stops":  [{ "id": "…", "name": "…", "p": [dx, dy], "on": [[shapeIdx, frac], …] }],
  "diagram": { "lines": [{ "route": "…", "pts": [[x, y], …] }], "box": [w, h] }
}
```

- [ ] Read the zip with the existing reader from `scripts/gtfs-routes.mjs`. Never load `stop_times.txt` into memory: stream it line by line and keep only the first and last `stop_id` per trip, which is all the stop-transfer helper needs.
- [ ] Simplify each shape with Douglas-Peucker at 5 m in metres, projecting through the local equirectangular factor `cos(45.8°)` rather than adding a projection library.
- [ ] Compute each shape's arc length in metres and each stop's arc-fraction on every shape passing within 40 m of it. A stop near no shape keeps an empty `on`.
- [ ] Build the octilinear diagram: snap every simplified point to the nearest 45° direction from its predecessor, simplify again at 120 m, then scale the whole set into a unit box. Keep only routes at or above the rank cut (all tram routes, then bus routes by trip count) so the diagram carries the most important lines and stays legible, as Matija asked.
- [ ] Delta-encode coordinates as integers against `origin` at `scale`, which is what keeps the file inside its budget.
- [ ] Emit `app/src/motion/network-meta.ts` with the feed version, the build time, the route count and the byte size as plain exported constants, so the app can state its data age without parsing the artefact.
- [ ] `package.json` gains `"build:network": "node scripts/gtfs-shapes.mjs"`. It is a local step, exactly like `gtfs-routes`, never part of the Workers build.
- [ ] Tests run the script against a small synthetic zip built inside the test: the artefact validates against the shape above, every `d` array has even length, every stop fraction lies within 0 and 1, every diagram point is octilinear against its predecessor, and the real committed artefact is under 500 KB raw with a recorded gzip size under 130 KB. That size assertion is not housekeeping: R-L4 is a promise in a filed document.

**Commit:** `Build the ZET network artefact: simplified shapes, stop fractions, an octilinear diagram`

---

## Task T2: stop publishing a bearing and a speed that do not exist (R-P3)

**Files:** Modify `worker/feed/modules/zet-rt.ts`, `worker/feed/schema.ts`. Test: `test/feed/zet-rt.test.ts`, plus a new guard in `test/feed/schema.test.ts`.

- [ ] Remove `bearing` and `speed` from the emitted `data` object and from `DATA_KEYS.vehicle`. Leave a comment in the module saying ZET does not send them, so nobody restores them from the protobuf definition by reflex.
- [ ] Add the guard test: no module may emit a key outside `DATA_KEYS` for its kind, and `vehicle` rows may never carry `bearing` or `speed` again. Drive it from the fixtures already in `test/fixtures/`.
- [ ] Keep `tripId` on the wire. It is the turn-around signal (decision 1) and removing it would cost more than the bytes it saves.
- [ ] Check every reader: `app/src/layers/u-pokretu.ts`, `app/src/map/city-map.ts`, `app/src/export.ts` and the `/open` catalogue. Anything that displayed a bearing or a speed loses that line rather than showing a zero.

**Commit:** `Stop claiming a bearing and a speed ZET never sends`

---

## Task T3: plane geometry and polyline projection

**Files:** Create `app/src/motion/geo.ts`, `app/src/motion/polyline.ts`. Test: `test/motion/geo.test.ts`, `test/motion/polyline.test.ts`.

**Interfaces:**

```ts
export interface XY { x: number; y: number }                    // metres, local plane
export function toPlane(lon: number, lat: number): XY;          // equirectangular about 45.8 N
export function toLonLat(p: XY): [number, number];
export function dist(a: XY, b: XY): number;

export interface Projection { idx: number; t: number; s: number; d: number; p: XY }
/** Nearest point on the polyline: segment index, fraction along it, arc length s, distance d. */
export function project(points: readonly XY[], cum: readonly number[], q: XY, hint?: number): Projection;
/** The point at arc length s, clamped to both ends. */
export function at(points: readonly XY[], cum: readonly number[], s: number): XY;
/** Unit tangent at arc length s, for drawing a tram along its track. */
export function tangent(points: readonly XY[], cum: readonly number[], s: number): XY;
export function cumulative(points: readonly XY[]): number[];
```

- [ ] `project` takes an optional `hint` index and searches outward from it, because a vehicle's next projection is almost always within a few segments of its last one. Without the hint a 500-point shape costs a full scan every frame.
- [ ] Tests: a straight north-south line projects a point east of it at the right arc length and the right perpendicular distance; `at` and `cumulative` round-trip within a millimetre; `tangent` is continuous across a vertex; the hint changes only the work, never the answer, proven by asserting hinted and unhinted results are identical across a thousand random queries on a synthetic shape.

**Commit:** `Add the local plane, polyline projection and arc-length helpers`

---

## Task T4: decode the network artefact

**Files:** Create `app/src/motion/network.ts`. Test: `test/motion/network.test.ts`.

**Interfaces:**

```ts
export interface Shape { id: string; route: string; pts: XY[]; cum: number[]; len: number }
export interface Stop { id: string; name: string; p: XY; on: { shape: number; s: number }[] }
export interface Network {
  version: number; feedVersion: string;
  routes: Map<string, { short: string; type: number; rank: number; shapes: number[] }>;
  shapes: Shape[]; stops: Stop[];
  diagram: { lines: { route: string; pts: XY[] }[]; box: [number, number] };
  /** The stop a vehicle would next pass on this shape after arc length s. */
  nextStop(shapeIdx: number, s: number): { stop: Stop; s: number } | null;
}
export function decodeNetwork(raw: unknown): Network;
/** Fetches /data/zet-network.json once, after first paint, and never in lightweight mode. */
export function loadNetwork(fetchImpl?: typeof fetch, lightweight?: boolean): Promise<Network | null>;
```

- [ ] `decodeNetwork` undoes the delta encoding, converts to the plane once, and precomputes `cum` per shape. It validates the version and throws a typed error otherwise, because a stale cached artefact must fail loudly rather than draw nonsense.
- [ ] `nextStop` is a binary search over that shape's sorted stop fractions. It is the stop gate of decision 3.
- [ ] `loadNetwork` returns `null` in lightweight mode without issuing a request (R-L4), and `null` on any failure, so every caller has exactly one fallback path to write.
- [ ] Tests: a hand-built artefact decodes to the expected metre coordinates; a wrong version throws; `nextStop` returns the next stop and not the one just passed, and `null` past the last one; lightweight mode issues no fetch, proven with a fetch spy.

**Commit:** `Decode the network artefact into a plane-space network`

---

## Task T5: the motion model

**Files:** Create `app/src/motion/model.ts`. Test: `test/motion/model.test.ts`.

This is the heart of the area and the one task that earns Matija's rule.

**Interfaces:**

```ts
export interface Fix { id: string; lon: number; lat: number; at: number; tripId?: string; routeId?: string }
export interface Drawn {
  id: string; routeId?: string; short?: string; type: number;
  p: XY; heading: XY | null;      // null means "smjer nepoznat"
  speed: number;                  // m/s, the model's own estimate
  confidence: number;             // 0 to 1, drives alpha
  onShape: number | null;         // null means free-plane mode
  stale: boolean;
}
export interface Model {
  /** Fold in a snapshot's fixes. Cheap; called once per poll. */
  update(fixes: readonly Fix[], now: number): void;
  /** Advance to wall-clock `now` and return what to draw. Called once per frame. */
  step(now: number): Drawn[];
  size(): number;
}
export function createModel(net: Network | null): Model;
```

- [ ] Per vehicle the model keeps the last three fix intervals with their along-track distances, the chosen shape index with its hysteresis score, the current arc length, the current plane position, the target arc length from the last fix, and the last fix time.
- [ ] **Speed** is the median of the last three intervals' along-track speeds, clamped to 22 m/s. Under 90 s of silence it holds; after that it halves every 45 s; at 300 s the vehicle is marked stale and stops. Exact coordinate equality between consecutive fixes sets speed to 0 immediately (decision 4).
- [ ] **Convergence.** `step` moves the drawn arc length toward the target exponentially, tau 1.5 s when the target is ahead and 4 s when it is behind, because a vehicle that turns out to be further back has usually been stuck, and easing backward reads as a correction rather than a stutter. Inside a 15 m dead zone nothing moves. Catch-up is capped at `max(4, speed)` m/s. Beyond 150 m the model snaps, and records that it did.
- [ ] **Shape choice.** Among the route's candidate shapes, score each by projection distance plus a 60 m penalty when the implied direction of travel disagrees with the last two fixes. A new shape must beat the current one by 25 m to take over. On a `tripId` change, clear the hysteresis so a terminus turn-around is free.
- [ ] **The stop gate.** Dead reckoning may advance a vehicle at most to the next stop on its shape. Past that it holds, lowers confidence and waits for evidence. This is what stops a bad speed estimate from sending a tram three blocks up Ilica.
- [ ] **Free-plane mode.** When the residual projection distance exceeds 150 m on every candidate, or the route has no shape at all (tram 1, buses 114 and 275), the vehicle leaves the geometry and is interpolated straight between fixes with confidence capped at 0.5. It is still never drawn at its reported position: it is drawn where the interpolation says it is at this instant.
- [ ] **Heading** is the shape tangent when on a shape and the smoothed fix-to-fix direction otherwise, and it is `null` whenever the accumulated evidence is under 0.3 (decision 5).
- [ ] Tests use synthetic tracks, no fixtures: perfect 30 s fixes along a straight shape draw monotonically with no jump larger than one frame's travel; a 20-minute-stale fix does not teleport anything; repeated identical coordinates hold a vehicle exactly still at speed 0; a 200 m discrepancy snaps once and then runs smooth; a vehicle whose next stop is 40 m ahead and whose speed says 120 m stops at the stop; a `tripId` change at a terminus reverses direction within two fixes and never draws the reverse path; a routeless vehicle still moves; a vehicle silent for 310 s is stale and still. And the rule itself: **the drawn position at the instant a fix arrives is not that fix** — assert the model converges rather than jumps.

**Commit:** `Compute where each vehicle is, from its own history and the line's geometry`

---

## Task T6: the frame loop and the tick-aligned poller

**Files:** Create `app/src/motion/loop.ts`. Test: `test/motion/loop.test.ts`.

**Interfaces:**

```ts
export interface LoopDeps {
  raf?: (cb: (t: number) => void) => number; cancel?: (h: number) => void;
  now?: () => number; reducedMotion?: boolean; lightweight?: boolean;
}
export interface Loop { start(): void; stop(): void; nudge(): void; frames(): number }
export function createLoop(draw: (now: number) => boolean, deps?: LoopDeps): Loop;
```

- [ ] `draw` returns whether anything changed. After eight unchanged frames the loop parks, and only a `nudge` (a new snapshot) or a resize restarts it. After three frames over 12 ms it halves its rate, recovering one step at a time when frames come back under budget.
- [ ] Under `reducedMotion` or `lightweight` the loop does not animate at all: it calls `draw` once a second through a timer, with no interpolation, which is the honest reading of both settings.
- [ ] `frames()` is exported for the end-to-end proof in T11, so that test asserts an advancing counter rather than diffing pixels.
- [ ] The poller aligns to the feed's 30 s tick instead of a fixed 20 s offset: after a snapshot whose `sourceUpdatedAt` is known, schedule the next poll for that time plus 30 s plus a 2 s cushion, and fall back to 20 s when the timestamp is missing. This halves wasted requests against a feed that changes twice a minute, which is the same objection Matija has raised about redundant traffic.
- [ ] Tests drive an injected `raf` and clock: parking after eight, waking on `nudge`, halving under slow frames, one call per second under reduced motion, and the tick alignment with and without a source timestamp.

**Commit:** `Run the motion at the screen's refresh rate, and poll on the feed's own tick`

---

# Wave 2 — after area M merges to main

## Task T7: schematic layout and painting

**Files:** Create `app/src/motion/schematic.ts`. Test: `test/motion/schematic.test.ts`.

- [ ] Two canvases, routes under vehicles by construction, so the route layer repaints only on theme, resize or crop change while the vehicle layer repaints per frame.
- [ ] A bus is an 8 px square with no rotation. A tram is a 12 by 3.5 px rectangle rotated to the drawn tangent, visibly thinner, exactly as Matija asked: *"both bus and tram should be a blue square but tram visibly thinner. direction is visible from movement."* Both use the theme's ink; alpha carries confidence.
- [ ] The crop is a centre plus a radius in metres, defaulting to Trg bana Jelačića, with route lines clipped to it (R-P1).
- [ ] Geometry is pure and tested without a DOM; the painter takes the same narrow context interface area M introduced in `app/src/ui/canvas.ts`.

**Commit:** `Paint the schematic: lines under vehicles, trams thinner than buses`

## Task T8: the schematic view

**Files:** Create `app/src/motion/schematic-view.ts`, `app/src/ui/schematic.css`. Test: `test/motion/schematic-view.test.ts`.

- [ ] Mounts the two canvases, owns the model and the loop, and renders the legend `{drawn} od {tracked} vozila s položajem`.
- [ ] The lightweight twin renders no canvas at all (R-L2): the nearest stops with the lines calling at them, tram rows first, each with the route label and that route's median delay in words. Same data, same legend, no apology in the copy.

**Commit:** `Mount the schematic, with a list where a canvas cannot go`

## Task T9: wire it into U pokretu and onto the open screen

**Files:** Modify `app/src/layers/u-pokretu.ts`, `app/src/kiosk.ts` (the `.kiosk-live` slot area M left empty), both i18n catalogues.

- [ ] The dashboard module and the kiosk stage both mount the schematic. On a locked kiosk it is cropped to that screen's configured centre and trams only (R-P1); in a session it is the whole network.
- [ ] Tap or click a vehicle opens a card with the line, the headsign direction and that route's median delay. At a standstill the direction line reads `smjer nepoznat`.
- [ ] The honesty note, verbatim: `Položaj je izračunat iz vlastitih očitanja svakog vozila i geometrije linije; ZET ne objavljuje smjer ni brzinu.` It is the user-facing statement of R-P2 and it is not optional.

**Commit:** `Put the moving map on the dashboard and on the open screen`

## Task T10: the full map

**Files:** Modify `app/src/map/city-map.ts`, `app/src/ui/map.css`, `app/src/dashboard.ts`.

- [ ] Apply the Modrotisak colours here and nowhere else (R-O1): closures `#ff9d9d`, vehicles `#f2ead8`, stroke `#16226b`.
- [ ] Update the GeoJSON source at 12 Hz rather than per frame, and use SDF icon images so one image serves both faces and both vehicle shapes.
- [ ] Full-screen is a CSS view mode, never the Fullscreen API, so the session meander stays pinned above it by construction.
- [ ] In lightweight mode the map is not rendered and its button is not present (R-L2).

**Commit:** `Re-ink the full map and give it a ring-preserving full-screen mode`

## Task T11: prove it end to end

**Files:** Create `e2e/motion.spec.ts`. Modify `docs/izvori.md`, `docs/arhitektura.md`.

- [ ] The frame counter advances on the dashboard and on a locked kiosk, and stops advancing beyond one step a second under `prefers-reduced-motion`.
- [ ] A vehicle's drawn position changes between two frames 500 ms apart while the snapshot is unchanged. That is the observable form of the rule.
- [ ] The tap card opens with a line name; full-screen keeps the session meander visible; `?lagano=1` renders the list and no canvas anywhere on the page.
- [ ] Document the model in `docs/arhitektura.md` in Croatian, constants and reasons together, and add the artefact to `docs/izvori.md` as derived data with its feed version.

**Commit:** `Prove the motion end to end and write down why every constant is what it is`


---

# Area E — the Tier-1 events feed (E1 to E9)

Rulings: `.superpowers/sdd/2026-09-12-vidikovac-iteration2/rulings.md`. R-P5, R-P6, R-O2, R-O3 and R-L1 to R-L5 bind every task here. Wave 1 is E1 to E6; wave 2 (E7 to E9) starts after area M merges to main.

## What the research settled, and what it killed

Matija asked whether the portals carry event data and whether the institutions the City finances publish anything machine-readable. The answer, from four read-only sweeps on 12 September:

- **data.zagreb.hr and data.gov.hr hold no event dataset at all.** Searches for događanja, manifestacije, koncert, sajam and kalendar return nothing. Exactly one dataset is real-time (road closures, 3 minutes) and one more is daily (komunalne aktivnosti, the live register of neighbourhood public works agreed with the mjesni odbori). So the assumption was wrong, and the honest module is built from elsewhere.
- **Almost every city institution is HTML only.** One genuine event API exists (Etnografski muzej, WordPress REST with real start, end and place meta). One source carries an explicit open licence (Kulturpunkt, CC BY-SA 3.0 HR, 12,735 announcements). One forbids reuse outright (Kerempuh, excluded). The rest publish news RSS or nothing.
- **Two sources named in the earlier brief are dropped for robots.txt reasons and the documents must say why (R-P5):** Guru za kulturu, whose events come only from a disallowed `/api/` path, and the Skupština YouTube Atom feed, where `Disallow: /feeds/videos.xml` applies. The channel's live page is linked from plenary sessions, because linking is not crawling.

Live verification then changed four things in the brief, and each is a trap for an implementer who trusts the plan over the fixture:

1. **Kulturpunkt publishes no event-date field.** No `acf`, no `meta`. The date exists only as Croatian prose in the excerpt (*"od 22. do 29. rujna"*, *"u petak, 11. rujna od 19 do 20.30 sati"*) and the year is never written. An announcement whose date cannot be parsed is **dropped**, never guessed. Category comes free from `class_list`.
2. **The komunalne plan has its axes swapped.** It is already WGS84, but X is latitude and Y is longitude, verified across all 700 records.
3. **Its JSON strings carry HTML entities**, so an entity decoder is mandatory or the panel prints raw escapes at a person.
4. **Kvartovske novosti publish neither a date nor a district**, so neither is invented and the vocabulary carries no `district` key.

## Module shape

One module, `dogadanja`, **session tier**, `ttl` 900 s, `maxStale` 86400 s, six sub-fetchers behind one `Promise.allSettled` so a dead source never empties the panel.

Session tier is a licence decision, not taste. The open tier is republished at `/open` under the Otvorena dozvola, and Kulturpunkt is CC BY-SA 3.0 HR; republishing it there would misstate the licence. The kiosk teaser therefore carries only the Otvorena dozvola city rows (Skupština, mjesna samouprava, data.zagreb.hr, ZET), which is also exactly what the open-screen ruling asks for.

New `ItemKind` `'event'` with a pinned nine-key vocabulary: `source`, `category`, `venue`, `organiser`, `live`, `phase`, `status`, `amount`, `precision`. Headline-level metadata only: title, time, venue, organiser, link, category. Descriptions are never copied (R-P6), with the single exception of the communal-works activity field, which is Otvorena dozvola data rather than a borrowed description.

---

## Task E1: Croatian dates, HTML entities, and nine real fixtures saved before any parser

**Files:** Create `worker/feed/hr-date.ts`, `worker/feed/html.ts`, `test/fixtures/dogadanja/*.json|xml|html` (nine files). Test: `test/feed/hr-date.test.ts`, `test/feed/html.test.ts`.

**Interfaces:**

```ts
// worker/feed/hr-date.ts
export type Precision = 'time' | 'day' | 'range';
export interface HrDate { startIso: string; endIso?: string; precision: Precision }
/** Parses Croatian prose against a reference instant, in Europe/Zagreb.
 *  Returns null when the text does not carry a date. Never guesses a year. */
export function parseHrDate(text: string, now: Date): HrDate | null;

// worker/feed/html.ts
export function decodeEntities(s: string): string;
export function stripTags(s: string): string;
/** Text content of the first match, or null. A tiny, dependency-free reader. */
export function selectText(html: string, pattern: RegExp): string | null;
export function selectAll(html: string, pattern: RegExp): string[];
```

- [ ] **Save the fixtures first, from the live sources, before writing a single parser.** Kulturpunkt REST page, aktivnosti.zagreb.hr Kvartovske novosti, skupstina.zagreb.hr rokovnik, a Skupština session page, the komunalne aktivnosti JSON, both ZET RSS feeds, and the Etnografski muzej REST. Record each file's URL and fetch time in a sibling `sources.json`. A parser written against imagined markup is the single most likely way this area wastes a day.
- [ ] `parseHrDate` handles, at minimum: `u petak, 11. rujna od 19 do 20.30 sati`, `od 22. do 29. rujna`, `11.9.2026.`, `11. rujna 2026.`, `sutra u 18 sati`, and every Croatian month name in genitive. The year is inferred from `now` only when the text omits it and the resulting date is within six months either way; otherwise it returns `null`. All arithmetic goes through `Europe/Zagreb`, reusing the formatter trick already in `worker/feed/time.ts`.
- [ ] `decodeEntities` covers the numeric forms and the named entities that actually occur in the fixtures, Croatian diacritics included. Test it against the real komunalne strings, not invented ones.
- [ ] Tests are table-driven over every phrase found in the saved fixtures, plus the negative cases: a text with no date returns `null`, and a date more than six months out returns `null` rather than a guess.

**Commit:** `Read Croatian dates and HTML entities, with fixtures saved from the live sources first`

---

## Task E2: Kulturpunkt

**Files:** Create `worker/feed/modules/dogadanja/kulturpunkt.ts`. Test: `test/feed/dogadanja/kulturpunkt.test.ts`.

- [ ] WordPress REST, custom type `kp_22_announcement`. Request only the fields needed, with `_fields`, because the full payload is large and R-L4's spirit applies to the Worker too.
- [ ] The date comes from `parseHrDate` over the excerpt. **No date, no item.** Count the drops and expose the count, so the panel can be honest and so a future regression in the parser is visible rather than silent.
- [ ] Category from `class_list`, mapped to the closed vocabulary. Venue and organiser only when the API states them.
- [ ] Licence CC BY-SA 3.0 HR, attributed per item with a link to the original. This is the reason the whole module is session tier.
- [ ] Tests run against the saved fixture: the item count, three parsed dates with their precisions, the drop count for undated announcements, and the assertion that no description text survives into the item.

**Commit:** `Read Kulturpunkt announcements, dropping what has no readable date`

---

## Task E3: the two city HTML sources

**Files:** Create `worker/feed/modules/dogadanja/skupstina.ts`, `worker/feed/modules/dogadanja/kvartovske.ts`. Test: one test file each.

- [ ] **Skupština rokovnik:** date and body name from the schedule page, then the session page for time, venue and the materials link. No RSS exists. Sessions carry `live: 'youtube'` with the channel's live page as a link when the session page says it is streamed, and nothing else from YouTube (R-P5).
- [ ] **Kvartovske novosti:** hyperlocal items from aktivnosti.zagreb.hr. Neither a date nor a district is published, so `startIso` is the publication time if the page gives one and the item is otherwise dated `precision: 'day'` from its position in the list; no district field exists in the vocabulary at all.
- [ ] Both are Otvorena dozvola equivalents under the zagreb.hr reuse terms (*"Ponovna upotreba podataka dopuštena je uz uvjet navođenja izvora"*), so both may appear in the open tier and on the kiosk.
- [ ] Tests run against the saved HTML fixtures and assert the parse survives a whitespace and attribute-order change, because a CMS will reflow its markup eventually.

**Commit:** `Read the Assembly calendar and the neighbourhood news pages`

---

## Task E4: communal works, the register of what the city is actually doing

**Files:** Create `worker/feed/modules/dogadanja/komunalne.ts`. Test: `test/feed/dogadanja/komunalne.test.ts`.

- [ ] **Swap the axes.** X is latitude and Y is longitude in this dataset, verified across all 700 records. Emit `geo: Point [lon, lat]` at 5 decimals like every other module, and leave a comment naming the verification, because the next reader will assume the file is wrong rather than the source.
- [ ] Run every string through `decodeEntities`.
- [ ] Keep `phase` (`Ugovaranje`, `Radovi u tijeku`, …), `status` and `amount`, and the activity field, which is the one permitted description under R-P6 because it is Otvorena dozvola data rather than borrowed prose.
- [ ] Items are dated by their last change, `precision: 'day'`.
- [ ] Tests: the axis swap proven by asserting a known record lands inside Zagreb's bounding box; entities decoded; the closed vocabulary respected.

**Commit:** `Read the communal works register, axes swapped and entities decoded`

---

## Task E5: ZET notices and the one real museum API

**Files:** Create `worker/feed/modules/dogadanja/zet-rss.ts`, `worker/feed/modules/dogadanja/etnografski.ts`. Test: one test file each.

- [ ] ZET publishes `rss_novosti.aspx` and `rss_promet.aspx` under the Otvorena dozvola. Parse with the existing `worker/feed/xml.ts`; headline and link only.
- [ ] Etnografski muzej is the single institution with real event data: WordPress REST, custom post types `dogadjanja` and `izlozbe`, with genuine start, end and place meta. Use the meta directly; do not run it through `parseHrDate`.
- [ ] Tests against the saved fixtures, including an exhibition whose end date is in the past being excluded.

**Commit:** `Read the ZET notice feeds and the Etnografski muzej event API`

---

## Task E6: the module, the contract change, and the robots guarantee

**Files:** Create `worker/feed/modules/dogadanja/index.ts`. Modify `worker/feed/schema.ts`, `worker/feed/registry.ts`. Test: `test/feed/dogadanja/module.test.ts`, `test/feed/robots.test.ts`.

- [ ] `schema.ts` gains the `ModuleId` `'dogadanja'`, the `ItemKind` `'event'` and the nine-key `DATA_KEYS.event` list. Keep the edit to those lines: area T edits the same file elsewhere and the merge must stay mechanical (R-O3).
- [ ] `registry.ts` registers the module at session tier, `ttl` 900, `maxStale` 86400.
- [ ] All six sub-fetchers run behind one `Promise.allSettled` with a per-source 6 s `AbortSignal.timeout`. A rejected source contributes nothing and lowers the snapshot's status to `stale`; it never throws the module down. Sort merged items by start time, cap the list, and record per-source counts in the snapshot so the panel and `/stats` can show which source went quiet.
- [ ] **The robots guarantee.** A test records every URL the module requests, through an injected fetch, and fails on any prefix disallowed by the robots files we read: `kultura.zagreb.hr/api/`, `kultura.zagreb.hr/_next/`, `youtube.com/feeds/videos.xml`, and the Muzika.hr and InfoZagreb hosts entirely. This is what keeps R-P5 true after the next person edits the file.

**Commit:** `Assemble the events module, with a test that enforces every robots rule we read`

---

# Wave 2 — after area M merges to main

## Task E7: the panels

**Files:** Modify `app/src/layers/kultura.ts`, `app/src/layers/uprava-i-pravo.ts`, `app/src/layers/index.ts`, both i18n catalogues.

- [ ] `Događanja` in Kultura: culture and community rows, each a title, a time in words, a venue and a link, with its own per-source attribution.
- [ ] `Grad radi` in Uprava i pravo: Assembly sessions, consultations and communal works, with the phase and the amount where the register gives them.
- [ ] Both use the catalogue-row geometry area M established in M5, so nothing new is styled here.
- [ ] Times render through the formatters area M owns (R-O2): `zagrebWeekdayDate` and `zagrebDayKey` are imported from `app/src/format.ts`, never reimplemented.
- [ ] A day with no events says so plainly and names which sources answered.

**Commit:** `Show events in Kultura and city work in Uprava i pravo`

## Task E8: the kiosk card and the integration proof

**Files:** Modify `app/src/kiosk.ts`. Test: `test/integration/feed-to-layers.test.ts`.

- [ ] One teaser card, carrying **only** the Otvorena dozvola city rows, because the kiosk is the open tier and Kulturpunkt's licence does not reach it.
- [ ] The integration test drives fixtures through the module, the teaser subset and the panels, asserting no raw `{` survives into any rendered string and that no CC BY-SA row reaches the open tier.

**Commit:** `Put city events on the open screen, and prove the licence boundary holds`

## Task E9: documents, attribution parity, and the pre-filing link check

**Files:** Modify `docs/izvori.md`, `app/src/data/izvori.json`, `docs/prijava/prijedlog-projekta.md` (the data list in section 5). Test: `test/docs/izvori.test.ts`.

- [ ] Every new source appears in all three places with the same licence and the same URL. The test asserts the three-way parity, as it already does for the stage-1 sources.
- [ ] The two dropped sources are named in `docs/izvori.md` **with the reason**, so a reader of the filed application can see the robots.txt decision rather than wonder why the obvious source is missing (R-P5).
- [ ] Run `npm run check:izvori` and record the answer for every new URL.

**Commit:** `Document the event sources, including the two we chose not to take`
