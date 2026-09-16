// The schematic: how the motion model's output becomes ink on two stacked
// canvases. The route layer (paintRoutes) is repainted only when the theme,
// the size or the crop changes; the vehicle layer (paintVehicles) is
// repainted every frame on a second canvas laid over the first, so routes
// sit under vehicles by construction and a frame never re-strokes 500
// polylines. Everything here is pure geometry plus two draw functions over
// a narrow structural context, so plain node exercises it without a
// <canvas>; mounting the canvases, owning the model and the loop is the
// view's job (T8).
//
// What is drawn is the real shape geometry in the local metre plane, never
// the artefact's octilinear diagram: the model computes every position on
// those shapes, and a crop in metres around a real square only means
// something on real geometry. The `Drawn.p` this receives is the model's
// own estimate; a reported fix never reaches this file (R-P2).

import { dist, toPlane, type XY } from './geo';
import type { Drawn } from './integrator';
import type { Network } from './network';

/** The narrow stroke/path/clip surface a canvas 2D context exposes,
 *  structurally a subset of CanvasRenderingContext2D so a recording test
 *  double can implement it without a real <canvas>. */
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

/** The narrow canvas surface the two painters need: StrokeContext
 *  (save/restore, path, stroke, clip) plus what a filled, rotated mark and
 *  a cleared layer add. Structurally a subset of CanvasRenderingContext2D. */
export interface SchematicContext extends StrokeContext {
  clearRect(x: number, y: number, w: number, h: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  translate(x: number, y: number): void;
  rotate(angle: number): void;
  fillStyle: string | CanvasGradient | CanvasPattern;
  lineCap: CanvasLineCap;
  globalAlpha: number;
}

/** A crop is a centre in the metre plane plus a radius in metres (R-P1). */
export interface Crop {
  centre: XY;
  radius: number;
}

/** GTFS route_type values the network artefact carries. */
export const ROUTE_TYPE_TRAM = 0;
export const ROUTE_TYPE_BUS = 3;

// --- Every constant has a reason; the reason is the comment. ---

/** Trg bana Jelačića, between the square's two tram platforms in the GTFS
 *  (15.97726/45.81286 and 15.97653/45.81307). Every kiosk without its own
 *  configured centre looks out from here. */
const JELACIC_LON = 15.9769;
const JELACIC_LAT = 45.8130;
/** R-P1 asks for "about five to six stops around the screen's configured
 *  centre". Along the inner-city tram lines the named stops fall roughly
 *  every 400-500 m (Jelačića, Zrinjevac at ~400 m, Draškovićeva at ~490 m,
 *  Trg žrtava fašizma at ~900 m, from the artefact), so a 1.8 km diameter
 *  through the square carries five to six of them on any line that crosses
 *  it. */
const DEFAULT_RADIUS_M = 900;

export const DEFAULT_CROP: Readonly<Crop> = Object.freeze({
  centre: toPlane(JELACIC_LON, JELACIC_LAT),
  radius: DEFAULT_RADIUS_M,
});

/** Matija, 12 September: "both bus and tram should be a blue square but
 *  tram visibly thinner. direction is visible from movement." A bus is a
 *  10 px square and never rotates. These are on-screen minimums (R-V2):
 *  marks are sized in CSS px times device density, never in metres and
 *  never through --kiosk-scale, so a 4K wall and a phone draw the same mark.
 *  The production screenshot that set them (12 September, 1080p) had an
 *  8 px bus and a 12 by 3.5 px tram, and the tram vanished into the line. */
export const BUS_SIDE_PX = 10;
/** A tram is a 14 by 5 px rectangle laid along its track: at half the bus's
 *  side it is visibly thinner at a glance, not on inspection, and at 5 px it
 *  is still a shape rather than a hairline. */
export const TRAM_LENGTH_PX = 14;
export const TRAM_WIDTH_PX = 5;

/** Route lines are the printed network under the vehicles, drawn in the
 *  label tone (design.md's one permitted third shade) at this alpha: dark
 *  enough to read as a diagram, light enough that a vehicle at the minimum
 *  alpha below is still unmistakably the darker thing on it (R-V2). */
export const ROUTE_ALPHA = 0.55;
/** Two CSS px of route line: one reads as a hairline and disappears under a
 *  5 px tram at 1080p; three starts competing with the vehicles. */
const ROUTE_LINE_PX = 2;

/** Alpha carries confidence, but a vehicle the model draws exists: at zero
 *  confidence (a fresh vehicle, a stop-gate hold) it is still a vehicle on
 *  the map, only its direction is unknown, so it never fades below this --
 *  which is the line's own alpha, so ink at this alpha over the halo is
 *  never lighter than label blue at the same alpha over the cloth (R-V2:
 *  alpha = 0.55 + 0.45 * confidence). */
export const MIN_VEHICLE_ALPHA = 0.7;
/** A one-CSS-pixel halo in the canvas tone under every mark, drawn first:
 *  what separates a vehicle from the line it sits on and from a neighbour
 *  at the same stop. One extra fillRect per mark per frame; the loop parks
 *  when nothing moves, so it costs nothing on a still map. */
export const HALO_PX = 1;

/** The whole-network crop pads the bounding circle by this so the outermost
 *  terminus does not sit on the canvas edge. */
const WHOLE_NETWORK_PADDING = 1.04;

/** WCAG 2.5.8: a pointer target is at least 24 by 24 CSS px. A 3.5 px tram
 *  is therefore reached through a 12 px radius around its centre, not
 *  through its own ink; the nearest mark inside that radius wins. */
export const HIT_RADIUS_CSS_PX = 12;
/** The ring around a selected mark is a square twice the mark's longer
 *  side: big enough to read as "this one" from a few steps back on a
 *  kiosk, drawn in the mark's own frame so a tram's ring turns with it. */
const RING_SCALE = 2;
const RING_LINE_PX = 1.5;

/** A route polyline in canvas pixels, already clipped to the crop. */
export interface RouteLine {
  route: string;
  type: number;
  pts: XY[];
}

export interface SchematicLayout {
  crop: Crop;
  w: number;
  h: number;
  /** Device pixels per CSS pixel (canvas.ts DENSITY); mark sizes scale by it. */
  density: number;
  /** Canvas pixels per metre. */
  scale: number;
  /** Route types the layout draws, or null for every type. */
  types: ReadonlySet<number> | null;
  net: Network;
  lines: RouteLine[];
  toPx(p: XY): XY;
}

/** The two tones the vehicle layer paints with: `ink` for the marks and the
 *  selection ring (`--tone-text-primary`), `halo` for the cloth-coloured
 *  halo under each mark (`--tone-surface-canvas`). Read off computed style
 *  by the view (ui/canvas.ts's tone()), never literals here. */
export interface VehicleTones {
  ink: string;
  halo: string;
}

export interface VehicleMark {
  id: string;
  kind: 'bus' | 'tram';
  x: number;
  y: number;
  w: number;
  h: number;
  /** Canvas rotation in radians (y down); always 0 for a bus. */
  angle: number;
  alpha: number;
}

/**
 * Clips a polyline to a circle, returning the runs that lie inside. A
 * segment crossing the rim is cut at the rim; a segment wholly outside
 * breaks the run, so a line that leaves the crop and comes back yields two
 * runs rather than one false chord through the outside.
 */
export function clipToCircle(pts: readonly XY[], centre: XY, radius: number): XY[][] {
  const runs: XY[][] = [];
  let current: XY[] | null = null;
  const r2 = radius * radius;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const span = segmentInCircle(a, b, centre, r2);
    if (!span) { current = null; continue; }
    const [t0, t1] = span;
    const pa = t0 === 0 ? a : lerp(a, b, t0);
    const pb = t1 === 1 ? b : lerp(a, b, t1);
    if (current && t0 === 0) {
      current.push(pb);
    } else {
      current = [pa, pb];
      runs.push(current);
    }
    if (t1 < 1) current = null;
  }
  return runs;
}

/** The parameter interval [t0,t1] of a-b inside the circle, or null. */
function segmentInCircle(a: XY, b: XY, c: XY, r2: number): [number, number] | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const fx = a.x - c.x;
  const fy = a.y - c.y;
  const qa = dx * dx + dy * dy;
  const qb = 2 * (fx * dx + fy * dy);
  const qc = fx * fx + fy * fy - r2;
  if (qa === 0) return qc <= 0 ? [0, 1] : null; // a repeated point: in or out as a whole
  const disc = qb * qb - 4 * qa * qc;
  if (disc < 0) return null;
  const root = Math.sqrt(disc);
  const t0 = Math.max(0, (-qb - root) / (2 * qa));
  const t1 = Math.min(1, (-qb + root) / (2 * qa));
  return t0 < t1 ? [t0, t1] : null;
}

function lerp(a: XY, b: XY, t: number): XY {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function typeOfShape(net: Network, shapeIdx: number): number | undefined {
  const shape = net.shapes[shapeIdx];
  return shape ? net.routes.get(shape.route)?.type : undefined;
}

/**
 * Lays the crop onto a canvas of `w` by `h` device pixels: the crop centre
 * lands on the canvas centre and the crop circle fits the shorter side, so
 * the same crop shows the same metres on a wide kiosk stage and a tall
 * phone. Route lines are transformed to pixels and clipped once here;
 * paintRoutes replays them until the next layout.
 */
export function layoutSchematic(
  net: Network,
  crop: Crop,
  w: number,
  h: number,
  density = 1,
  types: ReadonlySet<number> | null = null,
): SchematicLayout {
  const scale = Math.min(w, h) / (2 * crop.radius);
  const cx = w / 2;
  const cy = h / 2;
  const toPx = (p: XY): XY => ({ x: cx + (p.x - crop.centre.x) * scale, y: cy - (p.y - crop.centre.y) * scale });

  const lines: RouteLine[] = [];
  net.shapes.forEach((shape, idx) => {
    const type = typeOfShape(net, idx);
    if (type === undefined) return;
    if (types && !types.has(type)) return;
    for (const run of clipToCircle(shape.pts, crop.centre, crop.radius)) {
      lines.push({ route: shape.route, type, pts: run.map(toPx) });
    }
  });

  return { crop, w, h, density, scale, types, net, lines, toPx };
}

/**
 * The crop that shows the whole network (a session's dashboard, T9): the
 * bounding circle of every shape point of the requested types, slightly
 * padded. Falls back to the default crop when nothing matches, so a caller
 * always gets something drawable.
 */
export function wholeNetworkCrop(net: Network, types: ReadonlySet<number> | null = null): Crop {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  net.shapes.forEach((shape, idx) => {
    const type = typeOfShape(net, idx);
    if (type === undefined || (types && !types.has(type))) return;
    for (const p of shape.pts) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
  });
  if (!Number.isFinite(minX)) return DEFAULT_CROP;
  const centre = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  const radius = Math.hypot(maxX - minX, maxY - minY) / 2;
  return { centre, radius: radius * WHOLE_NETWORK_PADDING };
}

/** Canvas rotation (y down) that lays a mark along a plane direction. */
function canvasAngle(dir: XY): number {
  return Math.atan2(-dir.y, dir.x);
}

/** The direction a tram's rectangle lies along. The model's heading when it
 *  has one; otherwise the track's own tangent at the drawn position, which
 *  a rectangle can use without knowing which way the tram faces (decision
 *  5: direction is undecidable at a standstill, but the rails are not); and
 *  for a free-plane vehicle with no heading, no rotation at all. */
function tramDirection(v: Drawn): XY | null {
  return v.heading ?? v.track ?? null;
}

/**
 * Turns the model's output into marks: one per vehicle that lies inside the
 * crop and is of a type the layout draws (the model evicts what has gone
 * quiet, R-F2, so everything it hands over is fresh). Positions are the
 * model's own estimates, never a reported fix (R-P2).
 */
export function vehicleMarks(layout: SchematicLayout, vehicles: readonly Drawn[]): VehicleMark[] {
  const marks: VehicleMark[] = [];
  const { crop, density, types } = layout;
  for (const v of vehicles) {
    if (types && !types.has(v.type)) continue;
    if (dist(v.p, crop.centre) > crop.radius) continue;
    const { x, y } = layout.toPx(v.p);
    const alpha = MIN_VEHICLE_ALPHA + (1 - MIN_VEHICLE_ALPHA) * Math.min(1, Math.max(0, v.confidence));
    if (v.type === ROUTE_TYPE_TRAM) {
      const dir = tramDirection(v);
      marks.push({
        id: v.id, kind: 'tram', x, y,
        w: TRAM_LENGTH_PX * density, h: TRAM_WIDTH_PX * density,
        angle: dir ? canvasAngle(dir) : 0,
        alpha,
      });
    } else {
      marks.push({ id: v.id, kind: 'bus', x, y, w: BUS_SIDE_PX * density, h: BUS_SIDE_PX * density, angle: 0, alpha });
    }
  }
  return marks;
}

/**
 * The mark under a pointer at device-pixel (x, y), or null: the nearest one
 * within HIT_RADIUS_CSS_PX (scaled by density). Pure, so the view's click
 * and the tests share one answer to "which vehicle did that tap mean".
 */
export function hitVehicle(marks: readonly VehicleMark[], x: number, y: number, density: number): VehicleMark | null {
  const radius = HIT_RADIUS_CSS_PX * density;
  let best: VehicleMark | null = null;
  let bestD = Infinity;
  for (const m of marks) {
    const d = Math.hypot(m.x - x, m.y - y);
    if (d <= radius && d < bestD) {
      best = m;
      bestD = d;
    }
  }
  return best;
}

/** The route layer: clear, then stroke every clipped run in the line tone
 *  (`--tone-label`, R-V2) at the route alpha. Called on theme, resize or
 *  crop change only. */
export function paintRoutes(ctx: SchematicContext, layout: SchematicLayout, lineTone: string): void {
  ctx.clearRect(0, 0, layout.w, layout.h);
  if (layout.lines.length === 0) return;
  ctx.save();
  ctx.strokeStyle = lineTone;
  ctx.globalAlpha = ROUTE_ALPHA;
  ctx.lineWidth = ROUTE_LINE_PX * layout.density;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const line of layout.lines) {
    ctx.beginPath();
    line.pts.forEach((p, i) => { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
    ctx.stroke();
  }
  ctx.restore();
}

/** The vehicle layer: clear, then for each mark fill its halo (opaque, in
 *  the cloth tone) and the mark itself (ink at the mark's alpha), both
 *  centred on its own position and rotated only when the mark carries an
 *  angle; ring the one mark whose id is `selectedId` (the tapped vehicle,
 *  T9). Called per frame. */
export function paintVehicles(
  ctx: SchematicContext,
  layout: SchematicLayout,
  marks: readonly VehicleMark[],
  tones: VehicleTones,
  selectedId: string | null = null,
): void {
  ctx.clearRect(0, 0, layout.w, layout.h);
  const halo = HALO_PX * layout.density;
  for (const m of marks) {
    ctx.save();
    ctx.translate(m.x, m.y);
    if (m.angle !== 0) ctx.rotate(m.angle);
    ctx.globalAlpha = 1;
    ctx.fillStyle = tones.halo;
    ctx.fillRect(-m.w / 2 - halo, -m.h / 2 - halo, m.w + 2 * halo, m.h + 2 * halo);
    ctx.globalAlpha = m.alpha;
    ctx.fillStyle = tones.ink;
    ctx.fillRect(-m.w / 2, -m.h / 2, m.w, m.h);
    if (m.id === selectedId) {
      const side = Math.max(m.w, m.h) * RING_SCALE;
      ctx.globalAlpha = 1;
      ctx.strokeStyle = tones.ink;
      ctx.lineWidth = RING_LINE_PX * layout.density;
      ctx.lineJoin = 'miter';
      ctx.beginPath();
      ctx.rect(-side / 2, -side / 2, side, side);
      ctx.stroke();
    }
    ctx.restore();
  }
}
