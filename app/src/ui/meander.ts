// The Knifer square-wave meander (design.md §3.2): a thick rectangular zigzag
// used as a countdown, on the kiosk for the 30 s code and on /d for the
// 10-minute session. Pure geometry plus a draw function over a narrow
// StrokeContext, so it replays without a real <canvas> or Path2D (which
// happy-dom and node both lack) — the "full trace" and the "remaining
// interval" are the same point list stroked twice, the second pass clipped
// to a shrinking rect instead of a second, shorter path.
import { prepareCanvas } from './canvas';

export const MEANDER_STEPS = 10;

export interface StrokeContext {
  save(): void;
  restore(): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  rect(x: number, y: number, w: number, h: number): void;
  clip(): void;
  stroke(): void;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  lineJoin: CanvasLineJoin;
  miterLimit: number;
}

export interface MeanderGeometry {
  lineWidth: number;
  points: readonly (readonly [number, number])[];
}

/** Builds the square wave as a point list: alternating verticals (risers) at
 *  the top and bottom of the stroke band, joined by horizontal runs, never
 *  stepping past `w`. */
export function meanderGeometry(w: number, h: number): MeanderGeometry {
  const lineWidth = h * 0.3;
  const half = lineWidth / 2;
  const top = half;
  const bottom = h - half;
  const step = bottom - top;
  const points: Array<readonly [number, number]> = [[half, bottom], [half, top]];
  // h<=0 (reachable: a CSS height in (0,0.25) at density 2 rounds to exactly
  // 0 in prepareCanvas) makes step<=0, and `while (x < w - step)` would never
  // advance x — an infinite loop. Bail out with the degenerate two-point
  // geometry instead of hanging the caller.
  if (step <= 0) return { lineWidth, points };
  let x = half;
  let atTop = true;
  while (x < w - step) {
    x += step;
    points.push([x, atTop ? top : bottom]);
    points.push([x, atTop ? bottom : top]);
    atTop = !atTop;
  }
  return { lineWidth, points };
}

/** Floors `pct` (clamped to [0,1]) to `steps` quantised steps — the
 *  smanjeni-pokret twin of a linear countdown, and always what the
 *  lightweight bar uses. */
export function quantise(pct: number, steps: number = MEANDER_STEPS): number {
  const clamped = Math.min(1, Math.max(0, pct));
  return Math.floor(clamped * steps) / steps;
}

/** Strokes the point list twice: first the full-width trace in `ink` (the
 *  emptied track, always whole), then the remaining interval in `fill`,
 *  clipped to `w * pct` — the bar drains linearly from the right. */
export function drawMeander(
  ctx: StrokeContext,
  g: MeanderGeometry,
  o: { w: number; h: number; ink: string; fill: string; pct: number },
): void {
  const pass = (style: string, clipWidth: number | null): void => {
    ctx.save();
    if (clipWidth !== null) {
      ctx.beginPath();
      ctx.rect(0, 0, clipWidth, o.h);
      ctx.clip();
    }
    ctx.beginPath();
    g.points.forEach(([x, y], i) => { if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
    ctx.strokeStyle = style;
    ctx.lineWidth = g.lineWidth;
    ctx.lineJoin = 'miter';
    ctx.miterLimit = 4;
    ctx.stroke();
    ctx.restore();
  };
  pass(o.ink, null);
  pass(o.fill, o.w * o.pct);
}

/** DOM wrapper: sizes the canvas at 2x density and paints the current
 *  geometry. Returns early when there is no box or no 2D context. */
export function paintMeander(canvas: HTMLCanvasElement, o: { ink: string; fill: string; pct: number }): void {
  const sized = prepareCanvas(canvas);
  if (!sized) return;
  const { ctx, w, h } = sized;
  drawMeander(ctx, meanderGeometry(w, h), { w, h, ink: o.ink, fill: o.fill, pct: o.pct });
}

/** Lightweight twin (R-L2): sets the width of the inner bar in quantised
 *  percent, no canvas, no transition. */
export function paintMeanderBar(bar: HTMLElement, pct: number): void {
  bar.style.width = `${quantise(pct) * 100}%`;
}
