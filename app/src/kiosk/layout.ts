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
export interface LayoutDecision { size: KioskSize; zoom: number; portrait: boolean }

export function decideLayout(viewport: Viewport): LayoutDecision {
  const { width, height } = viewport;
  const portrait = height > width;
  if (width < HANDHELD_MAX_WIDTH) return { size: 'handheld', zoom: 1, portrait };
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
  return { size, zoom: Math.round(zoom * 1000) / 1000, portrait };
}

/** Writes the decision onto the kiosk root: `data-size`, `data-portrait`
 *  and `--kiosk-zoom`, which every size in kiosk.css multiplies. */
export function applyLayout(root: HTMLElement, viewport: Viewport): LayoutDecision {
  const decision = decideLayout(viewport);
  root.dataset.size = decision.size;
  root.dataset.portrait = decision.portrait ? '1' : '0';
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
