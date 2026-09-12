import { describe, expect, it } from 'vitest';
import { SDF_EDGE_ALPHA, SDF_PIXEL_RATIO, SDF_SPREAD_PX, sdfRectangle } from '../../app/src/map/sdf';

/** Alpha of the pixel at (x, y) in image pixels. */
function alphaAt(img: { width: number; data: Uint8ClampedArray }, x: number, y: number): number {
  return img.data[(y * img.width + x) * 4 + 3]!;
}

describe('sdfRectangle', () => {
  it('pads the rectangle by the SDF spread on every side, at the icon pixel ratio', () => {
    const img = sdfRectangle(12, 3.5);
    expect(SDF_PIXEL_RATIO).toBe(2);
    expect(img.width).toBe(Math.round(12 * SDF_PIXEL_RATIO) + 2 * SDF_SPREAD_PX);
    expect(img.height).toBe(Math.round(3.5 * SDF_PIXEL_RATIO) + 2 * SDF_SPREAD_PX);
    expect(img.data).toHaveLength(img.width * img.height * 4);
  });

  it('encodes distance in the alpha channel the way MapLibre reads an SDF: opaque inside, the edge at 0.75, transparent past the spread', () => {
    const img = sdfRectangle(8, 8);
    const cx = Math.floor(img.width / 2);
    const cy = Math.floor(img.height / 2);
    // Deep inside: fully opaque.
    expect(alphaAt(img, cx, cy)).toBe(255);
    // The rectangle's edge sits SDF_SPREAD_PX in from the image edge; the
    // first pixel inside it reads about 0.75 of 255, MapLibre's icon cutoff,
    // within half a pixel's worth of alpha.
    expect(Math.abs(alphaAt(img, SDF_SPREAD_PX, cy) - SDF_EDGE_ALPHA)).toBeLessThanOrEqual(255 / SDF_SPREAD_PX);
    // The outermost corner is more than a full spread outside: nothing.
    expect(alphaAt(img, 0, 0)).toBe(0);
    // Symmetric, so a rotated icon has no preferred side.
    expect(alphaAt(img, 1, cy)).toBe(alphaAt(img, img.width - 2, cy));
    expect(alphaAt(img, cx, 1)).toBe(alphaAt(img, cx, img.height - 2));
  });

  it('is monotone: alpha never rises as a pixel moves away from the shape', () => {
    const img = sdfRectangle(12, 3.5);
    const cy = Math.floor(img.height / 2);
    let last = 256;
    for (let x = Math.floor(img.width / 2); x < img.width; x++) {
      const a = alphaAt(img, x, cy);
      expect(a).toBeLessThanOrEqual(last);
      last = a;
    }
  });
});
