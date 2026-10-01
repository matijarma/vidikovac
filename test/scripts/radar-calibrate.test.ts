// scripts/radar-calibrate.mjs and the committed worker/data/radar-calibration.json (docs/reveal-2026-10-plan/R3.md
// step 2): the least-squares fit recovers a known map, refuses one it cannot determine, and the committed file is
// inside the limits the module and the route rely on.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkCalibration, findMarkers, fitAffine, project, rectangles } from '../../scripts/radar-calibrate.mjs';
import { decodePng } from '../../worker/feed/png';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const calibration = JSON.parse(readFileSync(join(ROOT, 'worker/data/radar-calibration.json'), 'utf8'));

describe('the radar calibration fit', () => {
  it('R3 review: refuses non-finite fit inputs and impossible crop geometry', () => {
    const points = [{ lon: 15, lat: 45, x: 10, y: 10 }, { lon: 16, lat: 46, x: 20, y: 20 }, { lon: 17, lat: 45, x: NaN, y: 30 }];
    expect(() => fitAffine(points)).toThrow(/non-finite/);
    expect(() => rectangles(calibration.affine, [100, 100])).toThrow(/too small/);
    expect(() => rectangles([81, 0, 1e6, 0, -117, 5600], [720, 751])).toThrow(/outside/);
    expect(() => rectangles([NaN, 0, 0, 0, 1, 0], [720, 751])).toThrow(/invalid/);
  });

  it('R3 review: clamps the inset to the actual image height, not only the historical map bottom', () => {
    const affine = [...calibration.affine];
    affine[5] -= 50;
    const rects = rectangles(affine, [720, 205]);
    expect(rects.inset[3]).toBeLessThan(205);
    expect(rects.inset[1]).toBeGreaterThanOrEqual(20);
    expect(rects.near[3]).toBeLessThanOrEqual(rects.inset[3]);
  });

  it('R3 review: check fails closed on missing landmarks, non-finite allowances and inconsistent geometry', async () => {
    const raster = await decodePng(new Uint8Array(readFileSync(join(ROOT, 'test/fixtures/radar/kompozit-20261001T020410Z.png'))));
    expect(checkCalibration(raster, calibration)).toEqual([]);
    const bad = [
      { ...calibration, landmarks: [] },
      { ...calibration, affine: [NaN, 0, 0, 0, 1, 0] },
      { ...calibration, residualPx: NaN },
      { ...calibration, landmarks: calibration.landmarks.map((p: object) => ({ ...p, residualPx: NaN })) },
      { ...calibration, near: { ...calibration.near, rect: [0, 0, 1, 1] } },
    ];
    for (const file of bad) expect(checkCalibration(raster, file)).not.toEqual([]);
  });

  it('decision 15: checks displacement from saved markers, not the affine residual envelope', () => {
    const image = (zgShift: number) => {
      const width = 720, height = 751;
      const data = new Uint8Array(width * height * 3).fill(220);
      for (const landmark of calibration.landmarks) {
        const x = landmark.x + (landmark.name === 'Zagreb' ? zgShift : 0), y = landmark.y;
        for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
          const distance = Math.abs(dx) + Math.abs(dy);
          if (distance === 3 || distance === 4) {
            const offset = ((y + dy) * width + x + dx) * 3;
            data.fill(0, offset, offset + 3);
          }
        }
      }
      return { width, height, data };
    };
    expect(checkCalibration(image(0), calibration)).toEqual([]);
    expect(checkCalibration(image(2), calibration)).toEqual([]);
    // Moving toward the affine prediction used to pass even though the real marker moved three pixels.
    expect(checkCalibration(image(3), calibration)).toEqual([expect.stringContaining('Zagreb')]);
  });

  it('recovers a known affine from four synthetic landmarks exactly', () => {
    const affine = [81.4, -0.07, -952.3, 0.29, -117.47, 5603.56];
    const points = [[15.98, 45.81], [14.5, 46.05], [17.19, 44.77], [15.44, 47.07]].map(([lon, lat]) => {
      const [x, y] = project(affine, lon!, lat!);
      return { lon: lon!, lat: lat!, x, y };
    });
    const fit = fitAffine(points);
    fit.affine.forEach((value: number, i: number) => expect(value).toBeCloseTo(affine[i]!, 6));
    expect(fit.rms).toBeLessThan(1e-6);
  });

  it('refuses three collinear landmarks and fewer than three', () => {
    const line = [0, 1, 2].map((k) => ({ lon: 15 + k, lat: 45 + k, x: 10 * k, y: 20 * k }));
    expect(() => fitAffine(line)).toThrow(/collinear/);
    expect(() => fitAffine(line.slice(0, 2))).toThrow(/at least 3/);
  });

  it('finds a two-pixel diamond outline at its inner tips', () => {
    const width = 20;
    const height = 20;
    const data = new Uint8Array(width * height * 3).fill(220);
    for (let dy = -4; dy <= 4; dy += 1) {
      for (let dx = -4; dx <= 4; dx += 1) {
        const d = Math.abs(dx) + Math.abs(dy);
        if (d === 3 || d === 4) data.fill(0, ((10 + dy) * width + 10 + dx) * 3, ((10 + dy) * width + 10 + dx) * 3 + 3);
      }
    }
    expect(findMarkers({ width, height, data }, [0, 19])).toEqual([{ x: 10, y: 10, r: 3 }]);
  });
});

describe('the committed calibration', () => {
  it('fits the composite closely, over at least 8 landmarks', () => {
    expect(calibration.version).toBe(1);
    expect(calibration.imageSize).toEqual([720, 751]);
    expect(calibration.residualPx).toBeLessThanOrEqual(3);
    expect(calibration.residualMaxPx).toBeLessThanOrEqual(4);
    expect(calibration.landmarks.length).toBeGreaterThanOrEqual(8);
    expect(Date.parse(calibration.derivedAt)).not.toBeNaN();
    expect(Date.parse(calibration.imageLastModified)).not.toBeNaN();
  });

  it('puts the near square where the probe of 30 September did, inside a 120-pixel inset', () => {
    const [x0, y0, x1, y1] = calibration.near.rect as number[];
    [x0, y0, x1, y1].forEach((value, i) => expect(Math.abs(value! - [329, 211, 361, 243][i]!)).toBeLessThanOrEqual(1));
    const [ix0, iy0, ix1, iy1] = calibration.inset.rect as number[];
    expect(ix1! - ix0! + 1).toBe(120);
    expect(iy1! - iy0! + 1).toBe(120);
    expect(ix0! <= x0! && iy0! <= y0! && ix1! >= x1! && iy1! >= y1!).toBe(true);
    // The file's rectangles are what its own affine gives.
    const again = rectangles(calibration.affine, calibration.imageSize);
    expect(again.near).toEqual(calibration.near.rect);
    expect(again.inset).toEqual(calibration.inset.rect);
  });
});
