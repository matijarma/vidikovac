// Zagreb panorama (design.md §3.1): Medvednica ridge, the Sljeme tower
// (mast, elliptical pod, base — never a horizontal crossbar, which reads as
// a cross), the city silhouette with a cathedral at ~36% of the width and a
// slim tower at ~60%, a baseline, and a single track of beads below it —
// one bead per ZET vehicle moving right now. Pure geometry
// (`panoramaGeometry`) plus a draw function over a narrow FillContext, ported
// bit-for-bit from the approved reference (same linear-congruential sequence,
// same seed) so the drawn skyline never drifts from what was approved.
import { prepareCanvas } from './canvas';

export interface Rect { x: number; y: number; w: number; h: number }

export type Shape = ({ kind: 'rect' } & Rect) | { kind: 'poly'; points: readonly (readonly [number, number])[] };

export interface PanoramaGeometry {
  w: number;
  h: number;
  ridge: readonly (readonly [number, number])[];
  tower: { mast: Rect; pod: { cx: number; cy: number; rx: number; ry: number }; base: Rect };
  city: readonly Shape[];
  baseline: Rect;
  rail: { y: number; lineWidth: number };
  beads: { y: number; r: number; xs: readonly number[] };
}

export interface FillContext {
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  closePath(): void;
  fill(): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  arc(x: number, y: number, r: number, start: number, end: number): void;
  ellipse(x: number, y: number, rx: number, ry: number, rotation: number, start: number, end: number): void;
  stroke(): void;
  globalAlpha: number;
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
}

const RIDGE_PROFILE: ReadonlyArray<readonly [number, number]> = [
  [0, .42], [.10, .32], [.20, .25], [.30, .31], [.44, .26], [.58, .34], [.72, .28], [.86, .35], [1, .32],
];

/** Same linear-congruential sequence as the approved reference, so the same
 *  seed always reproduces the same skyline bit for bit. */
function makeRnd(seed: number): () => number {
  let s = seed >>> 0;
  return (): number => {
    s = (s * 1103515245 + 12345) >>> 0;
    return s / 4294967296;
  };
}

export function panoramaGeometry(w: number, h: number, count: number, seed = 2026): PanoramaGeometry {
  const rnd = makeRnd(seed);

  const ridge = RIDGE_PROFILE.map(([px, py]) => [w * px, h * py] as const);

  const tx = w * 0.20;
  const tw = Math.max(2.4, w * 0.0032);
  const tower = {
    mast: { x: tx - tw / 2, y: h * 0.045, w: tw, h: h * 0.205 },
    pod: { cx: tx, cy: h * 0.115, rx: tw * 1.9, ry: h * 0.022 },
    base: { x: tx - tw, y: h * 0.19, w: tw * 2, h: h * 0.06 },
  };

  const base = h * 0.68;
  const city: Shape[] = [];
  let x = w * 0.02;
  let cathedralDone = false;
  let towerDone = false;
  while (x < w * 0.97) {
    const px = x / w;
    if (!cathedralDone && px >= 0.36) {
      const sw = w * 0.011;
      const gap = w * 0.017;
      const shh = h * 0.28;
      const sph = h * 0.15;
      city.push({ kind: 'rect', x: x - w * 0.012, y: base - h * 0.11, w: w * 0.062, h: h * 0.11 });
      for (const k of [0, 1]) {
        const sx = x + k * (sw + gap);
        city.push({ kind: 'rect', x: sx, y: base - shh, w: sw, h: shh });
        city.push({
          kind: 'poly',
          points: [
            [sx - sw * 0.4, base - shh],
            [sx + sw / 2, base - shh - sph],
            [sx + sw * 1.4, base - shh],
          ],
        });
      }
      x += sw * 2 + gap + w * 0.022;
      cathedralDone = true;
      continue;
    }
    if (!towerDone && px >= 0.60) {
      city.push({ kind: 'rect', x, y: base - h * 0.34, w: w * 0.017, h: h * 0.34 });
      x += w * 0.022;
      towerDone = true;
      continue;
    }
    const bw = w * (0.016 + rnd() * 0.028);
    const bh = h * (0.06 + rnd() * 0.15);
    city.push({ kind: 'rect', x, y: base - bh, w: bw, h: bh });
    x += bw + w * 0.0045;
  }

  const baseline: Rect = { x: 0, y: base, w, h: Math.max(1.5, h * 0.012) };
  const railY = base + h * 0.10;
  const rail = { y: railY, lineWidth: Math.max(1, h * 0.008) };

  const r = Math.max(1.4, h * 0.016);
  const xs: number[] = [];
  for (let i = 0; i < count; i++) xs.push(w * (0.008 + 0.984 * ((i + rnd() * 0.6) / count)));
  const beads = { y: railY, r, xs };

  return { w, h, ridge, tower, city, baseline, rail, beads };
}

/** Draw order and alphas fixed by design.md: ridge .30, tower .55 (mast rect,
 *  ellipse pod, base rect — never a bar), city + baseline 1, rail .28, beads
 *  .95, then reset to 1. */
export function drawPanorama(ctx: FillContext, g: PanoramaGeometry, fg: string): void {
  const setAlpha = (a: number): void => { ctx.globalAlpha = a; ctx.fillStyle = fg; ctx.strokeStyle = fg; };
  const fullTurn = Math.PI * 2;

  setAlpha(0.3);
  ctx.beginPath();
  ctx.moveTo(0, g.h * 0.66);
  g.ridge.forEach(([x, y]) => ctx.lineTo(x, y));
  ctx.lineTo(g.w, g.h * 0.66);
  ctx.closePath();
  ctx.fill();

  setAlpha(0.55);
  const { mast, pod, base } = g.tower;
  ctx.fillRect(mast.x, mast.y, mast.w, mast.h);
  ctx.beginPath();
  ctx.ellipse(pod.cx, pod.cy, pod.rx, pod.ry, 0, 0, fullTurn);
  ctx.fill();
  ctx.fillRect(base.x, base.y, base.w, base.h);

  setAlpha(1);
  for (const shape of g.city) {
    if (shape.kind === 'rect') {
      ctx.fillRect(shape.x, shape.y, shape.w, shape.h);
    } else {
      ctx.beginPath();
      shape.points.forEach(([x, y], i) => { if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
      ctx.closePath();
      ctx.fill();
    }
  }
  ctx.fillRect(g.baseline.x, g.baseline.y, g.baseline.w, g.baseline.h);

  setAlpha(0.28);
  ctx.lineWidth = g.rail.lineWidth;
  ctx.beginPath();
  ctx.moveTo(0, g.rail.y);
  ctx.lineTo(g.w, g.rail.y);
  ctx.stroke();

  setAlpha(0.95);
  for (const bx of g.beads.xs) {
    ctx.beginPath();
    ctx.arc(bx, g.beads.y, g.beads.r, 0, fullTurn);
    ctx.fill();
  }

  ctx.globalAlpha = 1;
}

/** DOM wrapper: sizes the canvas at 2x density and paints the current
 *  geometry (the approved 2026 skyline). Returns early when there is no box
 *  or no 2D context. */
export function paintPanorama(canvas: HTMLCanvasElement, o: { fg: string; count: number }): void {
  const sized = prepareCanvas(canvas);
  if (!sized) return;
  const { ctx, w, h } = sized;
  drawPanorama(ctx, panoramaGeometry(w, h, o.count), o.fg);
}
