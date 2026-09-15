import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The /d/ shell's grid and header, read as text: the phone shell is a sticky
// 48 px header, banners in flow and one workspace; the desktop dissolves the
// header into the rail grid. Literals pinned here are the ones the geometry
// gates and the sibling tasks (T1.2 tab bar, T1.3 Promet stage) build on.
const ui = (name: string): string => readFileSync(join(import.meta.dirname, '..', '..', 'app', 'src', 'ui', name), 'utf8');
const CSS = ui('dashboard.css');
const BASE_CSS = ui('base.css');
const LAYERS_CSS = ui('layers.css');
const TOAST_CSS = ui('toast.css');
const MAP_CSS = ui('map.css');
const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** The declarations of the first flat rule for `selector` inside `scope` (rules in this file never nest). */
const rule = (selector: string, scope: string = CSS): string =>
  new RegExp(`(?:^|\\n)\\s*${escape(selector)} \\{([^}]*)\\}`).exec(scope)?.[1] ?? '';
const DESKTOP = /@media \(min-width: 60rem\) \{([\s\S]*?)\n\}/.exec(CSS)?.[1] ?? '';
/** Selectors of every flat rule in `css` whose declarations carry `declaration`. */
const owners = (css: string, declaration: string): string[] =>
  [...css.matchAll(/(?:^|\n)\s*([^{}\n]+?) \{([^}]*)\}/g)].filter(([, , body]) => body.includes(declaration)).map(([, selector]) => selector);
/** Bodies of every top-level `prelude {…}` block in `css` (comments stripped), by brace depth: layers.css has several 60rem blocks. */
function mediaBlocks(css: string, prelude: string): string[] {
  const bodies: string[] = [];
  const plain = css.replace(/\/\*[\s\S]*?\*\//g, '');
  let depth = 0;
  let buf = '';
  let start = -1;
  for (let i = 0; i < plain.length; i += 1) {
    const ch = plain[i];
    if (ch === '{') {
      const last = buf.trim().split('\n').pop() ?? '';
      if (depth === 0 && last.trim() === prelude) start = i + 1;
      depth += 1;
      buf = '';
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0 && start !== -1) { bodies.push(plain.slice(start, i)); start = -1; }
      buf = '';
    } else {
      buf += ch;
    }
  }
  return bodies;
}

/**
 * Every `:hover` in a stylesheet must sit inside a block whose enclosing
 * @-rule chain includes `hover: hover` (T1.2's rule: no hover styles apply on
 * a touch device). A brace-depth walk, not a per-line regex, because some
 * hover rules are nested inside an existing viewport @media rather than
 * re-wrapped on their own — the enclosing chain still carries the condition.
 * Returns the ungated selector preludes found, empty when everything is gated.
 */
function ungatedHovers(css: string): string[] {
  const stack: string[] = [];
  const found: string[] = [];
  let buf = '';
  for (const ch of css) {
    if (ch === '{') {
      const prelude = buf.trim();
      if (prelude.includes(':hover') && !stack.some((p) => p.includes('hover: hover'))) found.push(prelude);
      stack.push(prelude);
      buf = '';
    } else if (ch === '}') {
      stack.pop();
      buf = '';
    } else {
      buf += ch;
    }
  }
  return found;
}

describe('dashboard.css phone shell', () => {
  it('lays the shell out as header, banners and main in flow, on a small-viewport height with the 2017 fallback line above it', () => {
    const ki = rule('.ki');
    expect(ki).toContain("grid-template-areas: 'top' 'banners' 'main'");
    expect(ki).toContain('grid-template-rows: auto auto 1fr');
    expect(ki).toMatch(/min-height: 100vh;\n\s*min-height: 100svh;/);
    expect(ki).toContain('--ki-top: calc(3rem + env(safe-area-inset-top, 0px));');
    expect(ki).toContain('--ki-tabs: calc(3.5rem + env(safe-area-inset-bottom, 0px));');
  });
  it('keeps the header sticky, 3rem plus the safe-area inset, on the chrome surface with the polling hairline along its bottom edge', () => {
    const head = rule('.ki-head');
    expect(head).toContain('grid-area: top');
    expect(head).toContain('position: sticky');
    expect(head).toContain('inset-block-start: 0');
    expect(head).toContain('z-index: var(--z-sticky)');
    expect(head).toContain('min-block-size: var(--ki-top)');
    expect(head).toContain('padding-block-start: env(safe-area-inset-top, 0px)');
    expect(head).toContain('background: var(--tone-surface-1)');
    expect(rule('.ki-head::after')).toContain('block-size: 2px');
    expect(rule(".ki[data-loading='true'] .ki-head::after")).toContain('opacity: 1');
  });
  it('places banners in flow between the header and main; only .ki-main takes the main area', () => {
    expect(rule('.ki-banners')).toContain('grid-area: banners');
    expect(rule('.ki-banners:empty')).toContain('display: none');
    expect([...new Set(owners(CSS, 'grid-area: main'))]).toEqual(['.ki-main']);
    expect(rule('.ki-main')).toContain('grid-area: main');
    expect(CSS).not.toContain('.ki-banners:not(:empty) + .ki-main');
  });
  it('flattens the rail wrapper, so the header and the sidebar are laid out by the shell grid directly', () => {
    expect(rule('.ki-rail')).toContain('display: contents');
  });
  it('makes the Promet stage the viewport with the dynamic-viewport unit and its fallback line', () => {
    const stage = rule(".ki[data-stage='map']");
    expect(stage).toContain('block-size: 100vh; block-size: 100dvh');
    // R-D5: the stage is the one rule in this file that may size by the dynamic viewport.
    expect([...new Set(owners(CSS, '100dvh'))]).toEqual([".ki[data-stage='map']"]);
    expect(stage).toContain('overflow: hidden');
    expect(rule(".ki[data-stage='map'] .ki-main")).toContain('padding: 0');
  });
  it('never sets display: none on the assertive live region, which .visually-hidden hides while readers still hear it', () => {
    expect(CSS).not.toMatch(/\.ki-alert[^{]*\{[^}]*display:\s*none/);
  });
  it('uses vh only as the fallback line directly before an svh or dvh twin, and no !important', () => {
    const fallbacks = [...CSS.matchAll(/([a-z-]+): 100vh;\s*([a-z-]+): 100[sd]vh;/g)];
    const bare = CSS.match(/[\d.]+vh\b/g) ?? [];
    expect(bare).toHaveLength(fallbacks.length);
    for (const [, property, twin] of fallbacks) expect(twin).toBe(property);
    expect(CSS).not.toContain('!important');
  });
});

describe('dashboard.css header controls', () => {
  it('the session pill is a 44 px surface-2 pill whose ring and tint turn amber at warn and rose at alert', () => {
    const pill = rule('.ki-session');
    expect(pill).toContain('min-block-size: var(--target)');
    expect(pill).toContain('border-radius: var(--r-pill)');
    expect(pill).toContain('background: var(--tone-surface-2)');
    expect(rule(".ki-session[data-urgency='warn']")).toContain('--tone-action-brand: var(--tone-weather)');
    expect(rule(".ki-session[data-urgency='alert']")).toContain('--tone-action-brand: var(--tone-urgency)');
  });
  it('the safety control shows its word on the urgency tint and drops it only under 360 px, where the aria-label carries it', () => {
    const safety = rule('.ki-safety');
    expect(safety).toContain('background: var(--tone-tint-urgency)');
    expect(safety).toContain('min-block-size: var(--target)');
    expect(rule('.ki-safety .ki-nav-label')).toContain('display: inline');
    const narrow = /@media \(max-width: 22\.4375rem\) \{([\s\S]*?)\n\}/.exec(CSS)?.[1] ?? '';
    expect(rule('.ki-safety .ki-nav-label', narrow)).toContain('display: none');
    expect(rule('.ki-safety', narrow)).toContain('min-inline-size: var(--target)');
  });
  it('the wordmark keeps its size and paints only the question mark in the brand tone', () => {
    expect(rule('.ki-wordmark-text')).toContain('font-size: var(--text-lg)');
    expect(rule('.ki-wordmark-mark')).toContain('color: var(--tone-action-brand)');
  });
  it('notice banners take the tint of their kind and keep the dismiss control beside the text at every width', () => {
    expect(rule('.banner-notice')).toContain('flex-wrap: nowrap');
    expect(rule('.banner-notice .banner-text')).toContain('min-inline-size: 0');
    expect(rule(".banner-notice[data-kind='joined']")).toContain('background: var(--tone-tint-success)');
    expect(rule(".banner-notice[data-kind='expiring60'], .banner-notice[data-kind='refusal']")).toContain('background: var(--tone-tint-weather)');
    expect(rule(".banner-notice[data-kind='expiring20']")).toContain('background: var(--tone-tint-urgency)');
    expect(rule('.banner-dismiss')).toContain('margin-inline-start: auto');
  });
});

describe('dashboard.css desktop (60rem and up)', () => {
  it('pins one rail beside the banners and main: sticky, a viewport tall, a flex column on the chrome surface with a hairline at its right edge', () => {
    const ki = rule('.ki', DESKTOP);
    expect(ki).toContain('grid-template-columns: var(--ki-side) minmax(0, 1fr)');
    expect(ki).toContain('grid-template-rows: auto 1fr');
    expect(ki).toContain("grid-template-areas: 'rail banners' 'rail main'");
    const rail = rule('.ki-rail', DESKTOP);
    expect(rail).toContain('grid-area: rail');
    expect(rail).toContain('display: flex');
    expect(rail).toContain('flex-direction: column');
    expect(rail).toContain('position: sticky');
    expect(rail).toContain('inset-block-start: 0');
    // R-D5: the small viewport, as the shell itself is sized; a sticky rail in dvh would resize while a
    // tablet's browser chrome hides on scroll. dvh belongs to the Promet stage and dialogs only.
    expect(rail).toContain('block-size: 100vh; block-size: 100svh');
    expect(rail).not.toContain('dvh');
    expect(rail).toContain('background: var(--tone-surface-1)');
    expect(rail).toContain('border-inline-end: 1px solid var(--tone-stroke)');
    expect(rule('.ki-banners', DESKTOP)).toContain('grid-area: banners');
    expect(rule('.ki-main', DESKTOP)).toContain('grid-area: main');
    // A quarter-screen window on a 1080p display is about 960×430: the rail's content is taller than
    // that, and a sticky rail never scrolls with the page, so it must scroll on its own or lose its foot.
    expect(rail).toContain('overflow-y: auto');
  });
  it('gives the banners the same wide gutter as main from 90rem, so a notice aligns with the workspace edge', () => {
    const wide = /@media \(min-width: 90rem\) \{([\s\S]*?)\n\}/.exec(CSS)?.[1] ?? '';
    expect(rule('.ki-main', wide)).toContain('padding-inline: var(--sp-12)');
    expect(rule('.ki-banners', wide)).toContain('padding-inline: var(--sp-12)');
  });
  it('dissolves the header into the rail: the wordmark, then the seven links, then the session card pushed to the foot; the safety control and the tab bar leave', () => {
    expect(rule('.ki-head', DESKTOP)).toContain('display: contents');
    expect(rule('.ki-head::after', DESKTOP)).toContain('content: none');
    const top = rule('.ki-top', DESKTOP);
    expect(top).toContain('order: 1');
    expect(top).toContain('position: relative');
    expect(rule('.ki-top::after', DESKTOP)).toContain('block-size: 2px');
    expect(rule(".ki[data-loading='true'] .ki-top::after", DESKTOP)).toContain('opacity: 1');
    const side = rule('.ki-side', DESKTOP);
    expect(side).toContain('order: 2');
    expect(side).toContain('display: block');
    const slot = rule('.ki-session-slot', DESKTOP);
    expect(slot).toContain('order: 3');
    expect(slot).toContain('margin-block-start: auto');
    expect(rule('.ki-safety-slot, .ki-tabbar', DESKTOP)).toContain('display: none');
    // Nothing on the desk places by the wave-1 row names any more.
    expect(DESKTOP).not.toMatch(/grid-area: (?:top|side|session)\b/);
  });
  it('keeps both sidebar clamps byte-identical (pinned by workspace-css.test.ts as well)', () => {
    expect(CSS).toContain('--ki-side: clamp(14rem, 30vw, 17rem);');
    expect(CSS).toContain('.ki { --ki-side: clamp(14rem, 30vw, 19rem); }');
  });
});

// T1.2: the tab bar, zoom-compact containers, hover gating, press states and
// touch behaviour. map.css is T1.3's except the one deleted 40 px override.
describe('tab bar: 56 px targets, the current tab a bold peacock bar, labels that never ellipsise', () => {
  it('the tab is 56 px tall with 14 px labels and a manipulation touch-action (no double-tap zoom delay)', () => {
    const tab = rule('.ki-tab');
    expect(tab).toContain('font-size: var(--text-sm)');
    expect(tab).toContain('min-block-size: 3.5rem');
    expect(tab).toContain('touch-action: manipulation');
  });
  it('the current tab is bold peacock with a 2 px bar across the top of its own cell', () => {
    const current = rule(".ki-tab[aria-current='page']");
    expect(current).toContain('color: var(--tone-action-brand)');
    expect(current).toContain('font-weight: var(--weight-bold)');
    const bar = rule(".ki-tab[aria-current='page']::before");
    expect(bar).toContain("content: ''");
    expect(bar).toContain('block-size: 2px');
    expect(bar).toContain('background: var(--tone-action-brand)');
  });
  it('never truncates a label with an ellipsis', () => {
    expect(rule('.ki-nav-label')).not.toContain('text-overflow');
    expect(rule('.ki-nav-label')).not.toContain('overflow: hidden');
  });
  it('keeps --ki-tabs at 3.5rem plus the safe-area inset; the tab bar and the toast stack both key off it', () => {
    expect(CSS).toContain('--ki-tabs: calc(3.5rem + env(safe-area-inset-bottom, 0px));');
  });
});

describe('zoom-compact containers: 390 px at 200% text is 12.2rem, so container queries catch zoom like a narrow phone', () => {
  it('the header and tab bar are named inline-size containers', () => {
    expect(rule('.ki-head')).toContain('container-type: inline-size; container-name: header;');
    expect(rule('.ki-tabbar')).toContain('container-type: inline-size; container-name: tabs;');
  });
  it('under 18rem the header drops the ring and the safety label, and the tab bar hides every label but the current one', () => {
    expect(CSS).toContain('@container header (max-width: 18rem)');
    expect(CSS).toContain('@container tabs (max-width: 18rem)');
    const header = /@container header \(max-width: 18rem\) \{([\s\S]*?)\n\}/.exec(CSS)?.[1] ?? '';
    expect(rule('.ki-session .g-ring', header)).toContain('display: none');
    expect(rule('.ki-safety .ki-nav-label', header)).toContain('display: none');
    const tabs = /@container tabs \(max-width: 18rem\) \{([\s\S]*?)\n\}/.exec(CSS)?.[1] ?? '';
    expect(rule('.ki-tab .icon', tabs)).toContain('1.75rem');
    expect(rule(".ki-tab:not([aria-current='page']) .ki-nav-label", tabs)).toContain('clip: rect(0 0 0 0)');
  });
});

describe('every :hover lives under @media (hover: hover); :active gives instant surface-2 feedback under (hover: none)', () => {
  it('gates every :hover in the shell, base and workspace stylesheets', () => {
    for (const [label, css] of [
      ['dashboard.css', CSS],
      ['base.css', BASE_CSS],
      ['layers.css', LAYERS_CSS],
      ['toast.css', TOAST_CSS],
      ['map.css', MAP_CSS],
    ] as const) {
      expect(ungatedHovers(css), `ungated :hover selectors in ${label}`).toEqual([]);
    }
  });
  it('.row-button:hover keeps only its background; the geometry change (the old hover-grows-the-row trick) is gone', () => {
    const hover = rule('.row-button:hover', LAYERS_CSS);
    expect(hover).toContain('background: var(--tone-surface-2)');
    expect(hover).not.toContain('margin-inline');
    expect(hover).not.toContain('padding-inline');
    expect(hover).not.toContain('inline-size');
    // The current row shares the same fixed geometry now — only the tint differs.
    expect(rule(".row-button[aria-current='true']", LAYERS_CSS)).not.toContain('margin-inline');
  });
  it('presses give instant feedback on the controls this task owns, across the three files that define them', () => {
    const dash = /@media \(hover: none\) \{([\s\S]*?)\n\}/.exec(CSS)?.[1] ?? '';
    expect(dash).toContain('.ki-tab:active');
    expect(dash).toContain('.ki-session:active');
    expect(dash).toContain('.ki-safety:active');
    expect(dash).toContain('.ki-side-link:active');
    const base = /@media \(hover: none\) \{([\s\S]*?)\n\}/.exec(BASE_CSS)?.[1] ?? '';
    expect(base).toContain('.btn:active');
    expect(base).toContain('.chip:active');
    const layers = /@media \(hover: none\) \{([\s\S]*?)\n\}/.exec(LAYERS_CSS)?.[1] ?? '';
    expect(layers).toContain('.row-button:active');
    expect(layers).toContain('.route-link:active');
    // Sada's own controls: the "+ N" feet and the segments press to surface-2; a tile already
    // stands on surface-1, so its press goes one level further, like the rows in the events well.
    expect(layers).toContain('.tb-more:active, .tb-seg-btn:active');
    expect(layers).toContain(".tl:not([data-tone]):not([data-variant='ink']):active { background-color: var(--tone-surface-3); transition: none; }");
    expect(layers).toContain('.dir-item:active');
    expect(layers).toContain('.sf-number:active');
    expect(layers).toContain('.link-arrow:active');
    expect(layers).toContain('.link-ext:active');
  });
});

describe('touch: the main scrolls vertically only; controls get the browser out of the way of a tap', () => {
  it('.ki-main is pan-y (a one-finger drag scrolls, it never pinch-zooms or text-selects)', () => {
    expect(rule('.ki-main')).toContain('touch-action: pan-y');
  });
  it('every S-owned control is touch-action: manipulation (no 300 ms tap delay)', () => {
    for (const selector of ['.ki-session', '.ki-safety', '.ki-tab']) expect(rule(selector)).toContain('touch-action: manipulation');
    expect(rule('.ki-side-link', DESKTOP)).toContain('touch-action: manipulation');
    for (const selector of ['.btn, .btn-ghost, .btn-quiet', '.chip']) expect(rule(selector, BASE_CSS)).toContain('touch-action: manipulation');
    for (const selector of ['.row-button', '.route-link', '.dir-item', '.link-arrow, .link-ext', '.source-link']) {
      expect(rule(selector, LAYERS_CSS)).toContain('touch-action: manipulation');
    }
  });
});

describe('targets: 44 px minimum, every link a real target, no 40 px map-toolbar override left in map.css', () => {
  it('the provenance block’s bare /izvori/ link gets a 44 px target; the old auto override on .source-link inside it is gone', () => {
    expect(LAYERS_CSS).not.toContain('.provenance .source-link { min-height: auto');
    expect(rule('.provenance a', LAYERS_CSS)).toContain('min-block-size: var(--target)');
  });
  it('map.css no longer shrinks the map toolbar buttons to a 40 px override; the base 44 px .t-action applies', () => {
    expect(MAP_CSS).not.toContain('min-height: 2.5rem');
    expect(rule('.t-action', MAP_CSS)).toContain('min-height: 2.75rem');
  });
});

describe('toasts sit above the tab bar on a phone, at body size, with a 44 px dismiss', () => {
  it('the stack clears the tab bar and both safe-area insets below the desktop breakpoint', () => {
    const phone = /@media \(max-width: 59\.99rem\) \{([\s\S]*?)\n\}/.exec(TOAST_CSS)?.[1] ?? '';
    const stack = rule('.toast-stack', phone);
    expect(stack).toContain('inset-block-end: calc(3.5rem + env(safe-area-inset-bottom, 0px)');
    expect(stack).toContain('inset-inline: var(--sp-4)');
  });
  it('the message reads at body size (16 px), never the 12 px metadata size', () => {
    expect(rule('.toast-message', TOAST_CSS)).toContain('font-size: var(--text-body)');
  });
  it('the dismiss button is a full 44 px target', () => {
    const dismiss = rule('.toast-dismiss', TOAST_CSS);
    expect(dismiss).toContain('inline-size: var(--target)');
    expect(dismiss).toContain('block-size: var(--target)');
  });
});

describe('scroll padding keeps focused rows clear of the fixed chrome', () => {
  it('pads the document scrollport by the header and the tab bar on the phone, and by nothing at the desk', () => {
    expect(CSS).toContain('html:has(.ki) { scroll-padding-block: calc(3rem + env(safe-area-inset-top, 0px)) calc(4rem + env(safe-area-inset-bottom, 0px)); }');
    const desk = /@media \(min-width: 60rem\) \{([\s\S]*?)\n\}/.exec(CSS)?.[1] ?? '';
    expect(desk).toContain('html:has(.ki) { scroll-padding-block: 0; }');
  });
});

describe('the shell grid has one shrinkable track', () => {
  it('sizes the phone column as minmax(0, 1fr), so a zoomed header or workspace can never widen the page', () => {
    expect(rule('.ki', CSS)).toContain('grid-template-columns: minmax(0, 1fr);');
  });
});

describe('the tab bar is exactly the space the shell reserves for it', () => {
  it('draws its hairline inside the box, so the bar measures --ki-tabs and never hangs over the stage', () => {
    const bar = rule('.ki-tabbar');
    expect(bar).toContain('box-shadow: inset 0 1px 0 var(--tone-stroke)');
    expect(bar).not.toContain('border-block-start');
    expect(rule('.ki-nav-label')).toContain('line-height: var(--lh-title)');
  });
});


describe('Sada reads in one order on every width', () => {
  it('never reorders a head, a lane or a tile in CSS, so the visual order is the DOM order (SC 2.4.3)', () => {
    // `order` (and a row-reversed flow) would move a lane past its neighbours
    // for the eye while leaving it where it was for a Tab key and a screen
    // reader. Heads, lanes and tiles are written in time order instead; the
    // desk and the phone are grid and flex changes that move nothing past
    // anything.
    const rules = /\.t[bl](?:-[a-z-]+)?\b[^{}]*\{[^}]*\}/g;
    let seen = 0;
    for (const [declaration] of LAYERS_CSS.matchAll(rules)) {
      seen += 1;
      expect(declaration, declaration).not.toMatch(/\border\s*:/);
    }
    expect(seen).toBeGreaterThan(10);
    expect(LAYERS_CSS).not.toMatch(/\.t[bl]\b[^{}]*\{[^}]*flex-direction: (?:column|row)-reverse/);
    expect(LAYERS_CSS).not.toMatch(/\.ov\b/);
  });
});

describe('layers.css time band', () => {
  it('lays the heads, the axis and the lanes on one five-track grid with the sada track wider, 20 px apart; four tracks at night', () => {
    const grid = rule('.tb-heads, .tb-lanes, .tb-axis', LAYERS_CSS);
    expect(grid).toContain('display: grid');
    expect(grid).toContain('grid-template-columns: 2.2fr 1fr 1fr 1fr 1fr');
    expect(grid).toContain('column-gap: 1.25rem');
    expect(rule(".tb[data-cols='4'] .tb-heads, .tb[data-cols='4'] .tb-lanes, .tb[data-cols='4'] .tb-axis", LAYERS_CSS)).toContain('grid-template-columns: 2.2fr 1fr 1fr 1fr');
  });
  it('stacks a lane’s tiles 10 px apart; the sada lane auto-fits half-width value tiles and spans its bands, rows, feet and states', () => {
    const lane = rule('.tb-lane', LAYERS_CSS);
    expect(lane).toContain('display: grid');
    expect(lane).toContain('gap: 0.625rem');
    expect(lane).toContain('min-inline-size: 0');
    expect(rule(".tb-lane[data-col='sada']", LAYERS_CSS)).toContain('grid-template-columns: repeat(auto-fit, minmax(min(10.5rem, 100%), 1fr))');
    expect(LAYERS_CSS).toContain(".tb-lane[data-col='sada'] > .tl[data-variant='band'], .tb-lane[data-col='sada'] > .tl[data-variant='row'], .tb-lane[data-col='sada'] > .tb-more, .tb-lane[data-col='sada'] > .state, .tb-lane[data-col='sada'] > .tb-empty { grid-column: 1 / -1; }");
  });
  it('sets the segments, the feet and the weather group as 44 px controls on tokens, hover under (hover: hover) only', () => {
    expect(rule('.tb-seg-btn', LAYERS_CSS)).toContain('min-block-size: var(--target)');
    expect(rule('.tb-seg-btn', LAYERS_CSS)).toContain('touch-action: manipulation');
    expect(rule(".tb-seg-btn[aria-pressed='true'] > span", LAYERS_CSS)).toContain('background: var(--tone-action-brand)');
    expect(rule('.tb-more', LAYERS_CSS)).toContain('min-block-size: var(--target)');
    expect(rule('.tb-weather', LAYERS_CSS)).toContain('min-block-size: var(--target)');
    const hover = mediaBlocks(LAYERS_CSS, '@media (hover: hover)').find((body) => body.includes('.tl:not([data-tone])')) ?? '';
    expect(hover).toContain(".tl:not([data-tone]):not([data-variant='ink']):hover { background-color: var(--tone-surface-2); }");
    expect(hover).toContain(".tl[data-tone]:hover, .tl[data-variant='ink']:hover { box-shadow: inset 0 0 0 1.5px var(--tone-stroke-strong); }");
    expect(hover).toContain('.tb-more:hover, .tb-weather:hover');
  });
  it('in a workspace of 60rem or less (a 1280 laptop beside the kvart aside, or a desk at 125 % text) keeps three lanes: sutra and tjedan wait in Događanja', () => {
    const middling = /@container ws \(max-width: 60rem\) \{([\s\S]*?)\n\}/.exec(LAYERS_CSS)?.[1] ?? '';
    expect(rule('.tb-heads, .tb-lanes, .tb-axis', middling)).toContain('grid-template-columns: 2fr 1fr 1fr');
    expect(middling).toContain(".tb-head[data-col='tjedan'], .tb-lane[data-col='tjedan'], .tb-dot[data-col='tjedan'],");
    expect(middling).toContain(".tb[data-cols='5'] .tb-head[data-col='sutra'], .tb[data-cols='5'] .tb-lane[data-col='sutra'], .tb[data-cols='5'] .tb-dot[data-col='sutra'] { display: none; }");
    // Cascade: after the last viewport rule it overrides, before the phone form that overrides it.
    const at = LAYERS_CSS.indexOf('@container ws (max-width: 60rem)');
    expect(at).toBeGreaterThan(LAYERS_CSS.lastIndexOf('@media (min-width: 80rem)'));
    expect(at).toBeLessThan(LAYERS_CSS.indexOf('@container ws (max-width: 36rem)'));
    expect(LAYERS_CSS).not.toContain('@container ws (max-width: 50rem)');
  });
  it('the phone form (36rem): sticky segments, one head shown and the rest clipped, a snapping lane row that pans both ways with the FAB reserve', () => {
    const phone = /@container ws \(max-width: 36rem\) \{([\s\S]*?)\n\}/.exec(LAYERS_CSS)?.[1] ?? '';
    expect(phone).toContain('.tb-seg { display: flex; position: sticky; inset-block-start: var(--ki-top); z-index: 2; background: var(--tone-surface-canvas); }');
    expect(phone).toContain('.tb-heads { display: block; position: relative; }');
    expect(phone).toContain(".tb-head:not([data-current='true']) { position: absolute; inline-size: 1px; block-size: 1px; margin: -1px; padding: 0; clip-path: inset(50%); white-space: nowrap; border: 0; }");
    expect(phone).toContain('.tb-axis { display: none; }');
    expect(phone).toContain('.tb-lanes { display: flex; overflow-x: auto; scroll-snap-type: x mandatory; scrollbar-width: none; touch-action: pan-x pan-y; margin-inline: -2px; padding: 2px 2px 5rem; }');
    expect(phone).toContain(".tb[data-cols] .tb-lane[data-col] { display: grid; flex: 0 0 100%; scroll-snap-align: start; scroll-snap-stop: always; }");
    // The restore rules share the hiding rules' specificity and come later, so on a phone every lane and head is back.
    expect(phone).toContain('.tb[data-cols] .tb-head[data-col] { display: grid; }');
    expect(phone.indexOf('.tb[data-cols] .tb-head[data-col]')).toBeGreaterThan(-1);
    // Motion is a decision made in JS from the reader's preference, never here.
    expect(LAYERS_CSS).not.toContain('scroll-behavior');
    // Every trace of the old overview is gone from the sheet.
    expect(LAYERS_CSS).not.toMatch(/\.ov[-\s.{,]/);
  });
});
