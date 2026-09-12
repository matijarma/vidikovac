import { describe, expect, it } from 'vitest';
import {
  drawMeander,
  MEANDER_STEPS,
  meanderGeometry,
  paintMeanderBar,
  quantise,
  type StrokeContext,
} from '../../app/src/ui/meander';

describe('meanderGeometry', () => {
  it('makes the line width 30% of the height', () => {
    expect(meanderGeometry(400, 72).lineWidth).toBeCloseTo(72 * 0.3);
    expect(meanderGeometry(400, 30).lineWidth).toBeCloseTo(30 * 0.3);
  });

  it('alternates between the top and bottom of the stroke band and never exceeds the width', () => {
    const { points } = meanderGeometry(400, 72);
    expect(points.length).toBeGreaterThan(4);
    const half = (72 * 0.3) / 2;
    const top = half;
    const bottom = 72 - half;
    for (const [x, y] of points) {
      expect(x).toBeLessThanOrEqual(400);
      expect(x).toBeGreaterThanOrEqual(0);
      expect([top, bottom]).toContain(y);
    }
    // consecutive points at the same x alternate y (the vertical riser),
    // consecutive points at different x share y (the horizontal run).
    for (let i = 1; i < points.length; i++) {
      const [px, py] = points[i - 1]!;
      const [x, y] = points[i]!;
      if (x === px) expect(y).not.toBe(py);
    }
  });

  it('is deterministic for the same w and h', () => {
    expect(meanderGeometry(437, 61)).toEqual(meanderGeometry(437, 61));
  });
});

describe('quantise', () => {
  it('floors to ten steps by default', () => {
    expect(quantise(0.37)).toBeCloseTo(0.3);
    expect(quantise(0.999)).toBeCloseTo(0.9);
    expect(quantise(1)).toBe(1);
    expect(quantise(-2)).toBe(0);
  });

  it('MEANDER_STEPS is 10', () => {
    expect(MEANDER_STEPS).toBe(10);
  });

  it('accepts a custom step count', () => {
    expect(quantise(0.37, 4)).toBe(0.25);
  });
});

class RecordingStrokeContext implements StrokeContext {
  calls: string[] = [];
  strokeStyle = '';
  lineWidth = 0;
  lineJoin = 'miter';
  miterLimit = 0;
  passes: { clip: [number, number, number, number] | null; style: string }[] = [];
  private currentClip: [number, number, number, number] | null = null;

  save(): void { this.calls.push('save'); }
  restore(): void { this.calls.push('restore'); this.currentClip = null; }
  beginPath(): void { this.calls.push('beginPath'); }
  moveTo(x: number, y: number): void { this.calls.push(`moveTo ${x},${y}`); }
  lineTo(x: number, y: number): void { this.calls.push(`lineTo ${x},${y}`); }
  rect(x: number, y: number, w: number, h: number): void {
    this.calls.push(`rect ${x},${y},${w},${h}`);
    this.currentClip = [x, y, w, h];
  }
  clip(): void { this.calls.push('clip'); }
  stroke(): void {
    this.calls.push('stroke');
    this.passes.push({ clip: this.currentClip, style: this.strokeStyle });
  }
}

describe('drawMeander', () => {
  it('strokes the geometry twice: a full trace, then the remaining interval clipped to w * pct', () => {
    const w = 400, h = 72;
    const g = meanderGeometry(w, h);
    const ctx = new RecordingStrokeContext();
    drawMeander(ctx, g, { w, h, ink: 'rgba(1,1,1,.2)', fill: '#f2ead8', pct: 0.6 });
    expect(ctx.passes).toHaveLength(2);
    expect(ctx.passes[0]).toEqual({ clip: null, style: 'rgba(1,1,1,.2)' });
    expect(ctx.passes[1]).toEqual({ clip: [0, 0, w * 0.6, h], style: '#f2ead8' });
    // save/restore bracket each pass.
    expect(ctx.calls.filter((c) => c === 'save')).toHaveLength(2);
    expect(ctx.calls.filter((c) => c === 'restore')).toHaveLength(2);
  });
});

describe('paintMeanderBar', () => {
  it('sets the width of the inner bar in quantised percent', () => {
    const bar = { style: { width: '' } } as unknown as HTMLElement;
    paintMeanderBar(bar, 0.37);
    expect(bar.style.width).toBe('30%');
    paintMeanderBar(bar, 1);
    expect(bar.style.width).toBe('100%');
    paintMeanderBar(bar, -2);
    expect(bar.style.width).toBe('0%');
  });
});
