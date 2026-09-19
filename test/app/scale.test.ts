import { describe, expect, it } from 'vitest';
import { metresPerPixel } from '../../app/src/map/scale';
import { metresPerPixel as kioskMetresPerPixel } from '../../app/src/kiosk/mapview';
import { PROJECTION_LAT_DEG } from '../../shared/motion/geo';
import { VEHICLE_LENGTH_M } from '../../shared/motion/vehicle';

describe('metres per pixel', () => {
  it('is the 512 px tile formula, the one the kiosk has always read, and at Zagreb\u2019s latitude a tram body is 38, 77 and 154 px at zooms 16, 17 and 18', () => {
    // 512 px tiles: one zoom level halves the ground a pixel covers, and at
    // zoom 0 the equator's circumference spans exactly one tile.
    expect(metresPerPixel(0, 0)).toBeCloseTo(40_075_016.686 / 512, 3);
    expect(metresPerPixel(16, PROJECTION_LAT_DEG) / metresPerPixel(17, PROJECTION_LAT_DEG)).toBeCloseTo(2, 9);
    expect(kioskMetresPerPixel).toBe(metresPerPixel);
    const px = (zoom: number): number => VEHICLE_LENGTH_M.tram / metresPerPixel(zoom, PROJECTION_LAT_DEG);
    expect(px(16)).toBeCloseTo(38.4, 1);
    expect(px(17)).toBeCloseTo(76.9, 1);
    expect(px(18)).toBeCloseTo(153.7, 1);
  });
});
