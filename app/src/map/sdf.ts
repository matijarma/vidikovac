// Signed-distance-field icon images for the full map's vehicles. MapLibre
// draws an SDF image through `icon-color` and `icon-halo-color` at render
// time, so one image per vehicle shape serves the night face, the day face
// and any future recolour without a second bitmap (T10). Pure: no DOM, no
// canvas -- a Uint8ClampedArray a unit test can read pixel by pixel.
//
// The encoding is the one MapLibre's own glyph SDFs use (TinySDF, radius 8,
// cutoff 0.25): alpha = 0.75 - d / 8, with d the distance from the shape's
// edge in image pixels, positive outside. The symbol shader then treats
// 0.75 as the edge and draws the halo in the band just below it.

export interface SdfImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** Image pixels per CSS pixel: 2, so the icon stays crisp on the phone's
 *  hidpi screen and on a 1080p kiosk alike (the same density
 *  ui/canvas.ts's DENSITY chooses for every canvas motif). */
export const SDF_PIXEL_RATIO = 2;
/** How many image pixels the distance field extends past the shape's edge:
 *  MapLibre's own glyph radius, and the room a halo needs -- a 1 CSS px halo
 *  is 2 image px at this ratio, comfortably inside it. */
export const SDF_SPREAD_PX = 8;
/** The alpha MapLibre's symbol shader reads as "the edge": (256 - 64) / 256. */
export const SDF_EDGE_ALPHA = Math.round(0.75 * 255);

/**
 * A filled axis-aligned rectangle of `cssWidth` x `cssHeight` CSS pixels,
 * centred, with SDF_SPREAD_PX of field around it. Sharp corners: the design
 * draws squares and rectangles, not rounded pills (design.md, T7's marks).
 */
export function sdfRectangle(cssWidth: number, cssHeight: number): SdfImage {
  const w = Math.round(cssWidth * SDF_PIXEL_RATIO);
  const h = Math.round(cssHeight * SDF_PIXEL_RATIO);
  const width = w + 2 * SDF_SPREAD_PX;
  const height = h + 2 * SDF_SPREAD_PX;
  const halfW = w / 2;
  const halfH = h / 2;
  const cx = width / 2;
  const cy = height / 2;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Distance from the pixel centre to the rectangle's edge, positive
      // outside (the standard box SDF).
      const qx = Math.abs(x + 0.5 - cx) - halfW;
      const qy = Math.abs(y + 0.5 - cy) - halfH;
      const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
      const inside = Math.min(Math.max(qx, qy), 0);
      const d = outside + inside;
      const alpha = Math.round(255 * (0.75 - d / SDF_SPREAD_PX));
      const i = (y * width + x) * 4;
      // RGB is ignored for an SDF; the colour comes from paint.
      data[i + 3] = Math.min(255, Math.max(0, alpha));
    }
  }
  return { width, height, data };
}

/** Signed distance (image px, positive outside) from a pixel centre to a shape. */
type Distance = (x: number, y: number) => number;

/** Rasterises any signed-distance function into MapLibre's SDF encoding,
 *  centred on an image of `cssWidth` x `cssHeight` CSS px plus the spread.
 *  The pill, the ring and the direction nose below are all this one loop. */
function sdfImage(cssWidth: number, cssHeight: number, distance: Distance): SdfImage {
  const w = Math.round(cssWidth * SDF_PIXEL_RATIO);
  const h = Math.round(cssHeight * SDF_PIXEL_RATIO);
  const width = w + 2 * SDF_SPREAD_PX;
  const height = h + 2 * SDF_SPREAD_PX;
  const cx = width / 2;
  const cy = height / 2;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const d = distance(x + 0.5 - cx, y + 0.5 - cy);
      const alpha = Math.round(255 * (0.75 - d / SDF_SPREAD_PX));
      data[(y * width + x) * 4 + 3] = Math.min(255, Math.max(0, alpha));
    }
  }
  return { width, height, data };
}

/**
 * A filled rounded rectangle: the pill under every vehicle's route number.
 * Radius in CSS px, clamped to half the shorter side (a radius of half the
 * height is a capsule).
 */
export function sdfRoundedRect(cssWidth: number, cssHeight: number, cssRadius: number): SdfImage {
  const halfW = (cssWidth * SDF_PIXEL_RATIO) / 2;
  const halfH = (cssHeight * SDF_PIXEL_RATIO) / 2;
  const r = Math.min(cssRadius * SDF_PIXEL_RATIO, halfW, halfH);
  return sdfImage(cssWidth, cssHeight, (x, y) => {
    const qx = Math.abs(x) - (halfW - r);
    const qy = Math.abs(y) - (halfH - r);
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
  });
}

/**
 * A hollow ring of `cssDiameter` outer diameter and `cssStroke` line width:
 * the selection mark around a vehicle or a stop, coloured by paint.
 */
export function sdfRing(cssDiameter: number, cssStroke: number): SdfImage {
  const outer = (cssDiameter * SDF_PIXEL_RATIO) / 2;
  const half = (cssStroke * SDF_PIXEL_RATIO) / 2;
  const mid = outer - half;
  return sdfImage(cssDiameter, cssDiameter, (x, y) => Math.abs(Math.hypot(x, y) - mid) - half);
}

/**
 * A filled isosceles triangle pointing along +x (east at rest), `cssLength`
 * long and `cssWidth` across its base: the direction nose a vehicle shows
 * only when the model knows which way it faces. Rotated through
 * `icon-rotate`, placed ahead of the pill through `icon-offset`.
 */
export function sdfTriangle(cssLength: number, cssWidth: number): SdfImage {
  const len = cssLength * SDF_PIXEL_RATIO;
  const halfBase = (cssWidth * SDF_PIXEL_RATIO) / 2;
  // Vertices: tip at +len/2, base corners at -len/2.
  const ax = len / 2;
  const bx = -len / 2;
  const edge = (px: number, py: number, x0: number, y0: number, x1: number, y1: number): number => {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const t = Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(px - (x0 + t * dx), py - (y0 + t * dy));
  };
  return sdfImage(cssLength, cssWidth, (x, y) => {
    const d = Math.min(edge(x, y, ax, 0, bx, halfBase), edge(x, y, bx, halfBase, bx, -halfBase), edge(x, y, bx, -halfBase, ax, 0));
    // Inside test: to the right of the base and within the wedge.
    const inside = x >= bx && Math.abs(y) <= halfBase * (1 - (x - bx) / len);
    return inside ? -d : d;
  });
}
