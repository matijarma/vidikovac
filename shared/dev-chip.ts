// DEV mode's mark (owner, 30 Sep 2026; worker/routes/dev.ts describes the whole of DEV). On a page
// in DEV the header's wordmark gets a suffix, so it reads "Kaj ima?dev", and a tiny × after it turns
// DEV off; the suffix opens a menu of the surfaces, each link carrying ?DEV. Where a page has no
// wordmark to join, the same mark floats at the top of the page instead. Pure markup and one
// stylesheet, shared by the scripted pages (app/src/experience/dev-chip.ts mounts them) and by the
// zero-JS /hitno (worker/hitno/dev.ts): the menu is a <details>, so it opens without a script.

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
 * The mark, its menu and the ×. `current` marks the surface the page is (aria-current); `offHref`
 * is the page itself without the flag, where the × goes. Each target holds its word in a line of
 * the wordmark's own size (.dev-line), so the smaller word sits on the wordmark's baseline.
 */
export function devChipMarkup(labels: DevLabels, options: { current: DevSurface | null; offHref: string }): string {
  const items = DEV_SURFACES.map((surface) => {
    const current = surface.id === options.current ? ' aria-current="page"' : '';
    const size = surface.window ? ` data-dev-window="${surface.window.width}x${surface.window.height}"` : '';
    return `<li><a href="${esc(surface.href)}" data-dev-surface="${surface.id}"${size}${current}>${esc(labels[surface.id])}</a></li>`;
  }).join('')
    // The way out, for a header too narrow for the × beside the suffix (shown only there).
    + `<li class="dev-menu-off"><a href="${esc(options.offHref)}" data-testid="dev-off-menu" data-dev-off>${esc(labels.off)}</a></li>`;
  return `<nav class="dev" id="dev-mark" data-testid="dev" aria-label="${esc(labels.menu)}">`
    + `<details class="dev-details"><summary class="dev-chip" data-testid="dev-chip"><span class="dev-line"><span class="dev-word">${esc(labels.chip)}</span></span></summary>`
    + `<ul class="dev-menu" data-testid="dev-menu">${items}</ul></details>`
    + `<a class="dev-off" data-testid="dev-off" data-dev-off href="${esc(options.offHref)}" aria-label="${esc(labels.off)}" title="${esc(labels.off)}"><span class="dev-line" aria-hidden="true"><span class="dev-x">×</span></span></a>`
    + `</nav>`;
}

/**
 * The mark's stylesheet, for the app's tokens and /hitno's palette alike (each variable falls back
 * from the app's name to /hitno's). It takes no layout height anywhere and moves nothing in a header.
 *
 * Joined to a wordmark (every .dev not a child of <body>): the suffix "dev" in the muted tier, a
 * quarter smaller than the wordmark (never under the 13 px type floor), with no space before it, and
 * the tiny × after it. --dev-strut is the wordmark's font size where it stands, so each target's
 * line box is the wordmark's own and the small word shares its baseline; the targets are 44 px
 * squares centred in a header row that is at least that tall. The phone and desk header (.ki-head,
 * a grid) keeps the suffix in its free column after the wordmark, pulled back over the column gap.
 * A phone's row has no room to spare (390 px leaves 0 px beside a DEV session's pill), so there the
 * words step back as the header already lets them under 21rem, each only below the width that
 * needs it (measured in both languages): the share button's word under 31rem, Zaslon's under
 * 25rem (its glyph shows instead), and under 23rem the × itself, whose place is then the menu's
 * last row; the wordmark, the pill and the safety control never move. The wall's brand group
 * (.k-head-brand), /hitno's header line (.brand) and the /dev/ grid's header take it inline. The
 * menu opens under the suffix, above the page.
 *
 * Floating (a page with no wordmark to join: /s/ on its way to /d/, the empty /d/): a small pill
 * fixed at the top centre, over the page and out of its flow. Above sheets and drawers, below toasts.
 * /hitno's own rules for a <details> (its folds) are undone for the mark's.
 */
export const DEV_CHIP_CSS = `
.dev{--dev-surface:var(--tone-surface-2,var(--surface-2));--dev-menu-bg:var(--tone-surface-1,var(--surface-1));--dev-ink:var(--tone-text-muted,var(--muted));--dev-ink-strong:var(--tone-text-primary,var(--ink));--dev-stroke:var(--tone-stroke,var(--stroke));--dev-focus:var(--tone-focus-ring,var(--accent));--dev-size:max(13px,calc(var(--dev-strut,1rem) * .75));position:relative;z-index:99;display:inline-flex;align-items:center;flex:none;box-sizing:border-box;min-inline-size:0;margin:0;padding:0;color:var(--dev-ink);vertical-align:baseline}
.dev-details{position:static;display:block;margin:0;padding:0;border:0}
.dev-chip,.dev-off{position:relative;display:flex;align-items:center;justify-content:flex-start;box-sizing:border-box;min-block-size:44px;min-inline-size:44px;margin:0;padding:0;border:0;border-radius:8px;background:none;color:inherit;text-decoration:none;cursor:pointer;-webkit-tap-highlight-color:transparent}
.dev-chip{list-style:none}
.dev-chip::-webkit-details-marker{display:none}
.dev-chip::marker{content:''}
.dev-chip::before,.dev-chip::after{content:none}
.dev-line{display:block;font-size:var(--dev-strut,1rem);line-height:inherit;white-space:nowrap}
.dev-word{font-size:var(--dev-size);font-weight:600;letter-spacing:0}
.dev-x{font-size:var(--dev-size);font-weight:500}
.dev-off{padding-inline-start:.25em}
.dev-details[open]>.dev-chip,.dev-chip:hover,.dev-off:hover{color:var(--dev-ink-strong)}
.dev-menu{position:absolute;inset-block-start:calc(100% - 4px);inset-inline-start:0;box-sizing:border-box;inline-size:max-content;min-inline-size:12rem;margin:0;padding:4px;list-style:none;border:1px solid var(--dev-stroke);border-radius:12px;background:var(--dev-menu-bg);box-shadow:0 8px 24px rgba(0,0,0,.18);font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;letter-spacing:0;text-align:start}
.dev-menu li{margin:0;padding:0}
.dev-menu .dev-menu-off{display:none;margin-block-start:4px;padding-block-start:4px;border-block-start:1px solid var(--dev-stroke)}
.dev-menu a{display:flex;align-items:center;min-block-size:44px;padding:0 12px;border-radius:8px;color:var(--dev-ink-strong);font-size:15px;font-weight:500;line-height:1.2;text-decoration:none}
.dev-menu a:hover{background:var(--dev-surface)}
.dev-menu a[aria-current='page']{font-weight:700}
.dev a:focus-visible,.dev summary:focus-visible{outline:2px solid var(--dev-focus);outline-offset:-2px}
.ki-head>.dev{grid-column:2;grid-row:1;justify-self:start;margin-inline-start:calc(-1 * var(--sp-1,4px));--dev-strut:var(--type-body,1rem)}
.ki-head>.dev~[data-key='space']{grid-column:2;grid-row:1}
@media (min-width:60rem){.ki-head>.dev{margin-inline-start:calc(-1 * var(--sp-3,12px));--dev-strut:var(--type-title,1.5rem)}}
@container header (max-width:31rem){.ki-head>.dev~.ki-share>span{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}}
@container header (max-width:25rem){.ki-head>.dev~.ki-screen>span{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}.ki-head>.dev~.ki-screen>.icon{display:inline-block}.ki-head>.dev~.ki-screen{padding-inline:0}}
@container header (max-width:23rem){.ki-head>.dev .dev-off{display:none}.ki-head>.dev .dev-menu-off{display:block}}
.k-head-brand>.dev{--dev-strut:var(--k-sup-size)}
header>.brand+.dev{--dev-strut:1.375rem}
body>.dev{position:fixed;inset-block-start:0;inset-inline-start:50%;transform:translateX(-50%);--dev-strut:13px;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;line-height:1}
body>.dev::before{content:'';position:absolute;inset:8px 0;z-index:-1;border:1px solid var(--dev-stroke);border-radius:999px;background:var(--dev-surface);pointer-events:none}
body>.dev .dev-chip{padding-inline-start:14px}
body>.dev .dev-word{letter-spacing:.08em;font-variant-caps:all-small-caps}
body>.dev .dev-off{justify-content:center;padding-inline:0 4px}
body>.dev .dev-menu{inset-inline-start:50%;transform:translateX(-50%)}
`;
