// Two explicit compositions, not one layout shrunk to fit: `wide` is drawn
// for 1920 x 1080, `compact` for 1366 x 768 (design.md, kiosk). A screen
// between the two gets the compact composition with the map column taking
// the extra width; a screen larger than 1920 x 1080 (a 4K television) gets
// the wide composition scaled up, never a wider sea of small type; a screen
// a little smaller than 1366 x 768 gets compact scaled down no further than
// 0.8, below which the code and the text would stop being readable from a
// few steps away -- at that point the layout is simply cropped by its own
// overflow rule rather than made minuscule.
//
// Anything narrower than KIOSK_HANDHELD_MAX_PX (core/breakpoints.ts) is a
// `handheld`: a phone that opened /kiosk/, the hand that sets a screen up
// rather than the screen. It is never a compact drawing cropped at 0.8: zoom
// stays 1, the page scrolls (kiosk.css) and, once a screen exists, the stage
// shows the provisioning link and the code card alone (kiosk.ts).
//
// A portrait screen (taller than wide, at least the handheld bound across) is
// one more drawing, not a landscape one on its side: the compact tokens with
// the blocks stacked (kiosk.css [data-portrait='1']), designed for a
// 1080 x 1920 totem and scaled from that size the way the landscape drawings
// scale from theirs -- up for a 4K totem, down to 0.8 for a squat or narrow
// one. Measured as the compact landscape it would shrink to 0.8 and put the
// credit line under the 13 px floor and the QR under 240 px on a wall that
// has the room.
//
// The invitation's column is composed per drawing too (plan "The column",
// R-KP5): the tables at the foot say how many statements each composition
// shows, how many line badges it lets the transit statement carry, and how
// long a title it lets the composer keep before shortening it at a word.
import { KIOSK_HANDHELD_MAX_PX, KIOSK_WIDE_MIN_PX } from '../core/breakpoints';

export type KioskSize = 'wide' | 'compact' | 'handheld';

export const WIDE = { width: 1920, height: 1080 } as const;
export const COMPACT = { width: 1366, height: 768 } as const;
/** The portrait drawing's design size: a 1080p screen stood up. */
export const PORTRAIT = { width: 1080, height: 1920 } as const;
/** From this width up the wide composition has room to breathe. */
export const WIDE_MIN_WIDTH = KIOSK_WIDE_MIN_PX;
/** Below this width the kiosk is a handheld. */
export const HANDHELD_MAX_WIDTH = KIOSK_HANDHELD_MAX_PX;
export const MIN_ZOOM = 0.8;
export const MAX_ZOOM = 2.5;

export interface Viewport { width: number; height: number }
export interface LayoutDecision {
  size: KioskSize;
  zoom: number;
  /** The viewport is taller than it is wide, whatever the device. */
  portrait: boolean;
  /** The portrait drawing: a screen stood up on a wall, never a phone in a
   *  hand. A phone is its own drawing (`size: 'handheld'`) and must not take
   *  the totem's rules, which hide the date and lay the basics in two columns
   *  for a 1080 x 1920 wall. */
  totem: boolean;
}

export function decideLayout(viewport: Viewport): LayoutDecision {
  const { width, height } = viewport;
  const portrait = height > width;
  if (width < HANDHELD_MAX_WIDTH) return { size: 'handheld', zoom: 1, portrait, totem: false };
  const size: KioskSize = !portrait && width >= WIDE_MIN_WIDTH ? 'wide' : 'compact';
  // The drawing this screen is measured against: the largest one (wide, or the
  // portrait drawing itself) for scaling up, its own for scaling down.
  const largest = portrait ? PORTRAIT : WIDE;
  const design = portrait ? PORTRAIT : size === 'wide' ? WIDE : COMPACT;
  let zoom = 1;
  if (width > largest.width && height > largest.height) {
    zoom = Math.min(width / largest.width, height / largest.height);
  } else if (width < design.width || height < design.height) {
    zoom = Math.min(width / design.width, height / design.height);
  }
  zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
  return { size, zoom: Math.round(zoom * 1000) / 1000, portrait, totem: portrait };
}

/** Writes the decision onto the kiosk root: `data-size`, `data-portrait`
 *  and `--kiosk-zoom`, which every size in kiosk.css multiplies.
 *  `data-portrait` is the totem drawing, never a phone held upright. */
export function applyLayout(root: HTMLElement, viewport: Viewport): LayoutDecision {
  const decision = decideLayout(viewport);
  root.dataset.size = decision.size;
  root.dataset.portrait = decision.totem ? '1' : '0';
  root.style.setProperty('--kiosk-zoom', String(decision.zoom));
  return decision;
}

/** The root's own box, falling back to the window and then to the wide
 *  design size (happy-dom lays nothing out). */
export function measureViewport(root: HTMLElement, win: { innerWidth?: number; innerHeight?: number } = globalThis as never): Viewport {
  const rect = root.getBoundingClientRect?.();
  const width = rect?.width || win.innerWidth || WIDE.width;
  const height = rect?.height || win.innerHeight || WIDE.height;
  return { width, height };
}

// --- The invitation's four compositions ----------------------------------------

/** The four drawings the invitation is composed for: the two landscape sizes, the totem and a phone. */
export type Composition = 'wide' | 'compact' | 'portrait' | 'handheld';

/** Which of the four a layout decision is: the totem is the compact size stood up, a phone its own drawing. */
export function compositionOf(decision: Pick<LayoutDecision, 'size' | 'totem'>): Composition {
  if (decision.size === 'handheld') return 'handheld';
  return decision.totem ? 'portrait' : decision.size;
}

/** The field's width in CSS px at each composition's design size, the camera's
 *  input before anything is laid out (kiosk/mapview.ts fieldZoom); the map
 *  host's measured width replaces it from the first paint after layout. Wide:
 *  1920 less the 520 px column. Compact: 1366 less the 440 px column. Portrait:
 *  the totem's whole 1080. Handheld: 390 less the stage's 16 px padding on
 *  both sides. Being out by a hundred pixels moves the derived zoom by about a
 *  tenth, which is why the measurement, not this table, wins once it exists. */
export const FIELD_DESIGN_WIDTH: Readonly<Record<Composition, number>> = Object.freeze({ wide: 1400, compact: 926, portrait: 1080, handheld: 358 });

/** How many statements each composition asks the ranker for (R-KP5): three
 *  on a wide wall and on the totem's row, two on the compact wall, and every
 *  candidate on a phone, which scrolls -- eight is every kind say.ts knows
 *  (SayKind), so it is "all" without an infinity the composer would have to
 *  guard against. The room decides the rest: a statement the column does not
 *  hold whole is hidden by measurement (kiosk/invitation.ts), never clipped.
 *  At wide that room is 373 px at 1920 x 1080 (kiosk.css, "The column"):
 *  two statements whole, the third shown where the type outgrows the card,
 *  on a wall above Full HD. */
export const SAY_SLOTS: Readonly<Record<Composition, number>> = Object.freeze({ wide: 3, compact: 2, portrait: 3, handheld: 8 });

/** Line badges before the transit statement says "+N". The kicker sits on
 *  the first badge row (kiosk.css .k-say-label), so the badges have the
 *  column's width less the kicker ("PROMET", about 105 / 79 / 79 / 60 px)
 *  and its gap; a k-size badge is --k-badge wide (60 / 46 / 46 / 36 px, up
 *  to ten more for three digits) plus its 0.3-gap, and the "+N" tail about
 *  46 / 34 / 34 / 30 px. The cap is what the rows the budget allows hold
 *  with the tail at any digit count, so a transit statement's height is
 *  known before it is measured (kiosk.css, "The column"): wide, two rows
 *  (356 px: five two-digit or four three-digit badges a row, so seven and
 *  the tail); compact, one row (318 px: four and the tail; five three-digit
 *  badges overflow it); the totem's left half, eight (405 px: eight
 *  two-digit badges on one row, or two rows with the tail, and its 388 px
 *  of room holds three statements either way); a phone, six on the 292 px
 *  it has (a phone scrolls; the cap keeps the row a glance). */
export const SAY_BADGE_CAP: Readonly<Record<Composition, number>> = Object.freeze({ wide: 7, compact: 4, portrait: 8, handheld: 6 });

/** A title's shortening budget in characters (a notice, a session, a work),
 *  cut at a word boundary with "..." by the composer (R-KP14), never by CSS:
 *  about two lines of the main tier on each column -- 40 px bold across 472
 *  px, 28 px across 368 px, and the totem's and the phone's widths at the
 *  compact tier. The measured two-line clamp in kiosk/invitation.ts catches a
 *  title of wide glyphs the count let through. */
export const SAY_VALUE_CHARS: Readonly<Record<Composition, number>> = Object.freeze({ wide: 56, compact: 44, portrait: 48, handheld: 40 });
