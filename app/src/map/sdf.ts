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
