import { describe, expect, it } from 'vitest';
import { SDF_EDGE_ALPHA, SDF_PIXEL_RATIO, SDF_SPREAD_PX, sdfRectangle, sdfRing, sdfRoundedRect, sdfTriangle } from '../../app/src/map/sdf';

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

describe('the pill, the ring and the nose (the numbered vehicle marks)', () => {
  it('sdfRoundedRect is opaque at its centre, rounds its corners and keeps its straight edges at the cutoff', () => {
    const img = sdfRoundedRect(22, 13, 4);
    const cx = Math.floor(img.width / 2);
    const cy = Math.floor(img.height / 2);
    expect(img.width).toBe(22 * SDF_PIXEL_RATIO + 2 * SDF_SPREAD_PX);
    expect(img.height).toBe(13 * SDF_PIXEL_RATIO + 2 * SDF_SPREAD_PX);
    expect(alphaAt(img, cx, cy)).toBe(255);
    // The straight edge sits SDF_SPREAD_PX in from the image edge, like the plain rectangle's.
    expect(Math.abs(alphaAt(img, SDF_SPREAD_PX, cy) - SDF_EDGE_ALPHA)).toBeLessThanOrEqual(255 / SDF_SPREAD_PX);
    // The corner is cut away: the pixel where a sharp rectangle's corner
    // would be opaque reads well below the edge.
    expect(alphaAt(img, SDF_SPREAD_PX, SDF_SPREAD_PX)).toBeLessThan(SDF_EDGE_ALPHA - 20);
    // A radius of half the height is a capsule: the midpoint of the short side is still on the edge.
    const capsule = sdfRoundedRect(27, 13, 6.5);
    expect(Math.abs(alphaAt(capsule, SDF_SPREAD_PX, Math.floor(capsule.height / 2)) - SDF_EDGE_ALPHA)).toBeLessThanOrEqual(255 / SDF_SPREAD_PX);
  });

  it('sdfRing is hollow: transparent at the centre, opaque on the stroke, transparent outside', () => {
    const img = sdfRing(32, 3);
    const cx = Math.floor(img.width / 2);
    const cy = Math.floor(img.height / 2);
    expect(alphaAt(img, cx, cy)).toBe(0);
    // The stroke's middle lies 1.5 CSS px inside the outer edge.
    const strokeMid = Math.round(SDF_SPREAD_PX + 1.5 * SDF_PIXEL_RATIO);
    expect(alphaAt(img, strokeMid, cy)).toBe(255);
    expect(alphaAt(img, 0, cy)).toBe(0);
    expect(alphaAt(img, cx, 0)).toBe(0);
  });

  it('sdfTriangle points along +x: opaque near the base, transparent behind the tip, symmetric across its axis', () => {
    const img = sdfTriangle(7, 8);
    const cy = Math.floor(img.height / 2);
    const baseX = SDF_SPREAD_PX + 2; // just inside the base, which sits at the left edge of the shape box
    expect(alphaAt(img, baseX, cy)).toBe(255);
    // Behind the tip on the right, outside the shape.
    expect(alphaAt(img, img.width - 1, cy)).toBe(0);
    // Above the base's top corner the wedge has already narrowed: transparent.
    expect(alphaAt(img, img.width - SDF_SPREAD_PX - 2, 1)).toBe(0);
    for (let x = 0; x < img.width; x++) expect(alphaAt(img, x, 1)).toBe(alphaAt(img, x, img.height - 2));
  });
});
