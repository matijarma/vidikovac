// DEV mode's label (owner, 30 Sep 2026; worker/routes/dev.ts describes the whole of DEV). On a
// page in DEV a small chip sits at the top centre: the word "DEV" and a tiny × that turns DEV off.
// The chip opens a menu of the surfaces, each link carrying ?DEV. Pure markup and one stylesheet,
// shared by the scripted pages (app/src/experience/dev-chip.ts mounts them) and by the zero-JS
// /hitno (worker/hitno/dev.ts): the menu is a <details>, so it opens without a script.

export type DevSurface = 'screen' | 'phone' | 'desktop' | 'hitno' | 'all';

/**
 * The menu in the owner's order: Zaslon, Telefon, Računalo, Hitno, Sve zajedno. Telefon and
 * Računalo are the same page, /d/, which lays itself out by the window it is in: at a desk the
 * app opens Telefon in a phone-sized window of its own (`window`), and on a phone both open /d/.
 */
export const DEV_SURFACES: ReadonlyArray<{ id: DevSurface; href: string; window?: { width: number; height: number } }> = [
  { id: 'screen', href: '/kiosk/?DEV' },
  { id: 'phone', href: '/d/?DEV', window: { width: 390, height: 844 } },
  { id: 'desktop', href: '/d/?DEV' },
  { id: 'hitno', href: '/hitno?DEV' },
  { id: 'all', href: '/dev/?DEV' },
];

/** The chip's words: the dev.* group of app/src/i18n/{hr,en}.json. */
export interface DevLabels {
  chip: string;
  menu: string;
  off: string;
  screen: string;
  phone: string;
  desktop: string;
  hitno: string;
  all: string;
}

function esc(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * The chip, its menu and the ×. `current` marks the surface the page is (aria-current); `offHref`
 * is the page itself without the flag, where the × goes.
 */
export function devChipMarkup(labels: DevLabels, options: { current: DevSurface | null; offHref: string }): string {
  const items = DEV_SURFACES.map((surface) => {
    const current = surface.id === options.current ? ' aria-current="page"' : '';
    const size = surface.window ? ` data-dev-window="${surface.window.width}x${surface.window.height}"` : '';
    return `<li><a href="${esc(surface.href)}" data-dev-surface="${surface.id}"${size}${current}>${esc(labels[surface.id])}</a></li>`;
  }).join('');
  return `<nav class="dev" data-testid="dev" aria-label="${esc(labels.menu)}"><div class="dev-bar">`
    + `<details class="dev-details"><summary class="dev-chip" data-testid="dev-chip">${esc(labels.chip)}</summary>`
    + `<ul class="dev-menu" data-testid="dev-menu">${items}</ul></details>`
    + `<a class="dev-off" data-testid="dev-off" href="${esc(options.offHref)}" aria-label="${esc(labels.off)}" title="${esc(labels.off)}"><span aria-hidden="true">×</span></a>`
    + `</div></nav>`;
}

/**
 * The chip's stylesheet, for the app's tokens and /hitno's palette alike (each variable falls back
 * from the app's name to /hitno's). While the chip shows, `html[data-dev-chip]` gives each surface a
 * strip of --dev-strip at its top, inside its own header, so the chip never covers the header's
 * content: the phone and desk header (.ki-head), the wall's header (.k-head), and the body of the
 * pages without one of their own (/s/, /dev/, /hitno), whose strip takes the canvas so nothing
 * scrolls under the chip (/hitno's sticky contents stop below it). The bar is fixed and lets every
 * pointer through; only the chip, the × and the open menu take one. Above sheets and drawers, below
 * toasts. /hitno's own rules for a <details> (its folds) are undone for the chip's.
 */
export const DEV_CHIP_CSS = `
html[data-dev-chip]{--dev-strip:44px}
.dev{--dev-surface:var(--tone-surface-2,var(--surface-2));--dev-menu-bg:var(--tone-surface-1,var(--surface-1));--dev-ink:var(--tone-text-muted,var(--muted));--dev-ink-strong:var(--tone-text-primary,var(--ink));--dev-stroke:var(--tone-stroke,var(--stroke));--dev-focus:var(--tone-focus-ring,var(--accent));position:fixed;inset-block-start:0;inset-inline:0;z-index:99;display:flex;justify-content:center;block-size:44px;pointer-events:none;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif}
.dev-bar{position:relative;display:flex;align-items:center;block-size:44px}
.dev-bar::before{content:'';position:absolute;inset:8px 0;border:1px solid var(--dev-stroke);border-radius:999px;background:var(--dev-surface);pointer-events:none}
.dev-details{position:static;border:0}
.dev-chip,.dev-off{position:relative;display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;min-block-size:44px;min-inline-size:44px;color:var(--dev-ink);text-decoration:none;cursor:pointer;pointer-events:auto;-webkit-tap-highlight-color:transparent}
.dev-chip{list-style:none;padding:0 4px 0 14px;font-size:13px;font-weight:600;line-height:1;letter-spacing:.08em;font-variant-caps:all-small-caps}
.dev-chip::-webkit-details-marker{display:none}
.dev-chip::marker{content:''}
.dev-chip::before{content:none}
.dev-off{padding:0 10px 0 2px;font-size:15px;line-height:1}
.dev-menu{position:absolute;inset-block-start:calc(100% - 4px);inset-inline-start:50%;transform:translateX(-50%);box-sizing:border-box;min-inline-size:12rem;margin:0;padding:4px;list-style:none;border:1px solid var(--dev-stroke);border-radius:12px;background:var(--dev-menu-bg);box-shadow:0 8px 24px rgba(0,0,0,.18);pointer-events:auto}
.dev-menu a{display:flex;align-items:center;min-block-size:44px;padding:0 12px;border-radius:8px;color:var(--dev-ink-strong);font-size:15px;font-weight:500;text-decoration:none}
.dev-menu a:hover{background:var(--dev-surface)}
.dev-menu a[aria-current='page']{font-weight:700}
.dev a:focus-visible,.dev summary:focus-visible{outline:2px solid var(--dev-focus);outline-offset:-4px;border-radius:999px}
html[data-dev-chip] .ki{--ki-top:calc(3.25rem + env(safe-area-inset-top,0px) + var(--dev-strip))}
@media (min-width:60rem){html[data-dev-chip] .ki{--ki-top:calc(3.5rem + var(--dev-strip))}}
html[data-dev-chip] .ki-head{padding-block-start:calc(env(safe-area-inset-top,0px) + var(--dev-strip))}
html[data-dev-chip] .k-head{padding-block-start:var(--dev-strip);min-height:calc(var(--k-head-h) + var(--dev-strip))}
html[data-dev-chip][data-page='scan'] body,html[data-dev-chip][data-page='dev'] body,html[data-dev-chip][data-page='hitno'] body{padding-block-start:var(--dev-strip)}
html[data-dev-chip][data-page='scan'] .dev,html[data-dev-chip][data-page='dev'] .dev,html[data-dev-chip][data-page='hitno'] .dev{background:var(--tone-surface-canvas,var(--canvas))}
html[data-dev-chip] nav.toc{top:var(--dev-strip)}
`;
