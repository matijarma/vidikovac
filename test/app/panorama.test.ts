import { describe, expect, it } from 'vitest';
import { drawPanorama, panoramaGeometry, type FillContext, type Shape } from '../../app/src/ui/panorama';

const W = 1920;
const H = 264; // kiosk panorama height (design.md §3.1), doubled for density is just a bigger W/H — the ratio is what matters.

describe('panoramaGeometry', () => {
  it('is deterministic for a fixed seed', () => {
    const a = panoramaGeometry(W, H, 6, 2026);
    const b = panoramaGeometry(W, H, 6, 2026);
    expect(a).toEqual(b);
  });

  it('a different seed produces a different skyline', () => {
    const a = panoramaGeometry(W, H, 6, 2026);
    const b = panoramaGeometry(W, H, 6, 99);
    expect(a.city).not.toEqual(b.city);
  });

  it('defaults the seed to the approved 2026 skyline', () => {
    expect(panoramaGeometry(W, H, 6)).toEqual(panoramaGeometry(W, H, 6, 2026));
  });

  it('the ridge (Medvednica) has nine crests, all above the baseline', () => {
    const g = panoramaGeometry(W, H, 6);
    expect(g.ridge).toHaveLength(9);
    for (const [, y] of g.ridge) expect(y).toBeLessThan(g.baseline.y);
  });

  it('the tower has a mast, an elliptical pod and a base that sits below the pod and is never a horizontal crossbar', () => {
    const g = panoramaGeometry(W, H, 6);
    const { mast, pod, base } = g.tower;
    expect(mast.h).toBeGreaterThan(mast.w); // the stup is a tall narrow shaft
    expect(base.y).toBeGreaterThan(pod.cy); // base sits below the pod
    expect(base.h).toBeGreaterThanOrEqual(base.w); // never a horizontal crossbar
  });

  it('the city holds one cathedral group first crossing 0.36 of the width and one slim tower crossing 0.60', () => {
    const g = panoramaGeometry(W, H, 6);
    // The nave and the slim tower have dimensions no generated block shares
    // (H*0.11/W*0.062 and H*0.34/W*0.017 respectively), so they're found by shape.
    const nave = g.city.find((s): s is Extract<Shape, { kind: 'rect' }> => s.kind === 'rect' && s.h === H * 0.11 && s.w === W * 0.062);
    const slimTower = g.city.find((s): s is Extract<Shape, { kind: 'rect' }> => s.kind === 'rect' && s.h === H * 0.34 && s.w === W * 0.017);
    expect(nave).toBeDefined();
    expect(slimTower).toBeDefined();
    expect(nave!.x / W).toBeGreaterThanOrEqual(0.3);
    expect(nave!.x / W).toBeLessThan(0.42);
    expect(slimTower!.x / W).toBeGreaterThanOrEqual(0.58);
    expect(slimTower!.x / W).toBeLessThan(0.65);
    expect(g.city.indexOf(nave!)).toBeLessThan(g.city.indexOf(slimTower!));

    // Two spires follow the nave immediately: shaft (rect) then cap (poly), twice.
    const spireIndex = g.city.indexOf(nave!) + 1;
    expect(g.city[spireIndex]?.kind).toBe('rect');
    expect(g.city[spireIndex + 1]?.kind).toBe('poly');
    expect(g.city[spireIndex + 2]?.kind).toBe('rect');
    expect(g.city[spireIndex + 3]?.kind).toBe('poly');
    // Exactly one cathedral (never repeats) and one slim tower.
    expect(g.city.filter((s) => s.kind === 'rect' && s.h === H * 0.11).length).toBe(1);
    expect(g.city.filter((s) => s.kind === 'rect' && s.h === H * 0.34).length).toBe(1);
  });

  it('every city rect sits on the baseline (its bottom equals base.y)', () => {
    const g = panoramaGeometry(W, H, 12);
    for (const shape of g.city) {
      if (shape.kind === 'rect') expect(shape.y + shape.h).toBeCloseTo(g.baseline.y, 6);
    }
  });

  it('lays out `count` beads, strictly increasing, inside the box, all sharing one y (never a grid)', () => {
    const g = panoramaGeometry(W, H, 7);
    expect(g.beads.xs).toHaveLength(7);
    for (let i = 1; i < g.beads.xs.length; i++) expect(g.beads.xs[i]!).toBeGreaterThan(g.beads.xs[i - 1]!);
    for (const x of g.beads.xs) { expect(x).toBeGreaterThan(0); expect(x).toBeLessThan(W); }
    expect(new Set([g.beads.y]).size).toBe(1); // trivially one shared y, stated for clarity
  });

  it('count === 0 still draws the rail (no beads)', () => {
    const g = panoramaGeometry(W, H, 0);
    expect(g.beads.xs).toHaveLength(0);
    expect(g.rail.y).toBeGreaterThan(g.baseline.y);
    expect(g.rail.lineWidth).toBeGreaterThan(0);
  });
});

class RecordingFillContext implements FillContext {
  alphas: number[] = [];
  fillStyle = '';
  strokeStyle = '';
  lineWidth = 0;
  private _alpha = 1;
  get globalAlpha(): number { return this._alpha; }
  set globalAlpha(a: number) { this._alpha = a; this.alphas.push(a); }
  beginPath(): void {}
  moveTo(): void {}
  lineTo(): void {}
  closePath(): void {}
  fill(): void {}
  fillRect(): void {}
  arc(): void {}
  ellipse(): void {}
  stroke(): void {}
}

describe('drawPanorama', () => {
  it('paints ridge, tower, city+baseline, rail and beads at the spec alphas, then resets to 1', () => {
    const g = panoramaGeometry(W, H, 5);
    const ctx = new RecordingFillContext();
    drawPanorama(ctx, g, '#f2ead8');
    expect(ctx.alphas).toEqual([0.3, 0.55, 1, 0.28, 0.95, 1]);
  });

  it('does the same six-step alpha sequence with zero vehicles', () => {
    const g = panoramaGeometry(W, H, 0);
    const ctx = new RecordingFillContext();
    drawPanorama(ctx, g, '#f2ead8');
    expect(ctx.alphas).toEqual([0.3, 0.55, 1, 0.28, 0.95, 1]);
  });
});
