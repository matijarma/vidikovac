// ZET artwork, in its own y-down coordinate system. Only the placer maps
// an integrator arc to this plane; reported GPS coordinates never enter a
// painter. Canvas mounting, gestures and the clock live in schema-map.ts.
import type { XY } from '../../../shared/motion/geo';
import { pointAt, type Schema, type createSchemaPlacer } from '../../../shared/motion/schema';
import { vehicleLabel } from '../map/city-map';
import type { Drawn } from './integrator';
import {
  clusterPills, PILL_HEIGHT_PX, PILL_MAX_CHARS_CLUSTER, pillChars, pillWidthPx, type PillPoint,
} from './pills';
import {
  MIN_VEHICLE_ALPHA, ROUTE_TYPE_TRAM,
  type SchematicContext, type VehicleLayout, type VehicleMark, type VehicleTones,
} from './schematic';

/** A 7.92-artwork-unit stop label reaches 11 CSS px at 1.4 px/unit.
 *  Below that the phone gets the clean network, not illegible tiny text. */
export const LABEL_MIN_PX_PER_UNIT = 1.4;
export const STOP_LABEL_UNITS = 7.92;
/** The source's larger terminal labels retain their hierarchy. */
const TERMINAL_LABEL_UNITS = 9.4;
/** A public screen is read across a room, not at phone distance (R-P1). */
export const KIOSK_LABEL_MIN_PX = 24;
export const KIOSK_LABEL_SCALE = KIOSK_LABEL_MIN_PX / STOP_LABEL_UNITS;
/** The artwork groups successive label baselines about one em apart. */
const LABEL_ROW_ADVANCE = 1.1;

// --- The vehicle pills (F3). Every constant carries its reason. ---

/** A single pill sits on a hairline of paper, the same one-CSS-px separation
 *  the rectangles had from the line under them and from a neighbour. */
const PILL_HALO_PX = 1;
/** A cluster trades that hairline for a 2 px ring in the ink tone: the city
 *  map's own convention (city-map.ts clusterToFeature) for "several here". */
const PILL_CLUSTER_RING_PX = 2;
/** The selected pill's ring, clear of the capsule so the pill's own edge
 *  still reads, at the weight the rectangles' selection ring already used. */
const PILL_SELECT_GAP_PX = 3;
const PILL_SELECT_RING_PX = 1.5;
/** The number inside the pill: the city map paints its pills at 12 px
 *  (overlays.ts's vehicle text-size), and the schema is the same badge. */
const PILL_TEXT_PX = 12;
/** A mark whose centre has left the canvas by less than this still has ink
 *  on it, so it is clipped by the canvas rather than culled: half of the
 *  widest pill a cluster label can take, plus its ring. Below this a pill
 *  half over the edge blinked out, which is exactly what F3 exists to stop. */
export const PILL_EDGE_MARGIN_PX = pillWidthPx(PILL_MAX_CHARS_CLUSTER) / 2 + PILL_CLUSTER_RING_PX;

/** Structurally a subset of CanvasRenderingContext2D, like the existing
 *  SchematicContext, so tests can record actual paint calls without a GPU. */
export interface SchemaContext extends SchematicContext {
  arc(x: number, y: number, radius: number, start: number, end: number, counterclockwise?: boolean): void;
  closePath(): void;
  fill(): void;
  fillText(text: string, x: number, y: number): void;
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
}

/** Pan/zoom uses CSS px, while both painters use backing-store pixels. */
export interface SchemaViewport {
  x: number;
  y: number;
  scale: number;
  width: number;
  height: number;
}

export interface SchemaMarkViewport extends SchemaViewport {
  density: number;
  symbolScale?: number;
}

/** The four inks a pill is painted with: the mode's fill and text (light or
 *  dark, from PILL_INKS) and the canvas's own paper and ink tones, which a
 *  single's halo and a cluster's ring take from the app's role tokens. */
export interface PillInkSet {
  fill: string;
  text: string;
  halo: string;
  ink: string;
}

export interface SchemaLayout extends VehicleLayout {
  schema: Schema;
  viewport: SchemaViewport;
  labels: boolean;
  trams: boolean;
  selectedRoute?: string | null;
  selectedStop?: string | null;
  screenStop?: string | null;
  /** Kiosk floor, independent of an unusually small host's viewport. */
  labelMinPx?: number;
}

export interface SchemaTones extends VehicleTones {
  water: string;
}

type SchemaPlacer = ReturnType<typeof createSchemaPlacer>;

export function schemaPoint(p: XY, viewport: SchemaViewport, density = 1): XY {
  return { x: (viewport.x + p.x * viewport.scale) * density, y: (viewport.y + p.y * viewport.scale) * density };
}

/** The exact same visibility rule serves the canvas and accessible list.
 *  The viewport is grown by PILL_EDGE_MARGIN_PX on every side: a pill whose
 *  centre has just left the canvas is still half on it, and the canvas
 *  itself is what clips it. */
export function schemaInFrame(p: XY, viewport: SchemaViewport): boolean {
  const screen = schemaPoint(p, viewport);
  const m = PILL_EDGE_MARGIN_PX;
  return screen.x >= -m && screen.x <= viewport.width + m && screen.y >= -m && screen.y <= viewport.height + m;
}

/** One pill per placeable tram: no shape lookup, live-position projection or
 *  direction offset (a chord deliberately has no track; it must not borrow a
 *  geographic heading), and no rotation either -- a numbered pill is read,
 *  not aimed, and the line under it already says where the rails go. */
export function schemaVehicleMarks(placer: SchemaPlacer, drawn: readonly Drawn[], viewport: SchemaMarkViewport): VehicleMark[] {
  const marks: VehicleMark[] = [];
  const density = viewport.density;
  const size = density * (viewport.symbolScale ?? 1);
  for (const v of drawn) {
    if (v.type !== ROUTE_TYPE_TRAM || v.onShape === null) continue;
    const p = placer.place(v.path, v.s);
    if (!p || (v.routeId !== undefined && p.line !== v.routeId) || !schemaInFrame(p, viewport)) continue;
    const label = vehicleLabel(v);
    marks.push({
      id: v.id, kind: 'tram', ...schemaPoint(p, viewport, density),
      w: pillWidthPx(pillChars(label)) * size, h: PILL_HEIGHT_PX * size,
      angle: 0,
      alpha: MIN_VEHICLE_ALPHA + (1 - MIN_VEHICLE_ALPHA) * Math.min(1, Math.max(0, v.confidence)),
      label, pill: 'single',
    });
  }
  return marks;
}

/** A mark as clusterPills measures it, carrying the mark it came from. */
interface MarkPillPoint extends PillPoint {
  mark: VehicleMark;
}

/**
 * Merges the pills that would pile up into one cluster mark each, exactly as
 * the city map does (city-map.ts vehiclesToGeoJson): within one mode, never
 * across it, and measured in the CSS px the pill geometry is stated in --
 * marks are in backing-store pixels, so they are divided by density and by
 * the symbol scale, which is the size the pills are actually painted at. The
 * selected vehicle is never absorbed.
 */
export function clusterSchemaMarks(
  marks: readonly VehicleMark[],
  viewport: SchemaMarkViewport,
  selectedId: string | null = null,
): VehicleMark[] {
  const size = viewport.density * (viewport.symbolScale ?? 1);
  const byKind = new Map<VehicleMark['kind'], MarkPillPoint[]>();
  const out: VehicleMark[] = [];
  for (const mark of marks) {
    // A mark with no pill has no label to join one with: it is left alone.
    if (!mark.pill) {
      out.push(mark);
      continue;
    }
    const point: MarkPillPoint = { id: mark.id, x: mark.x / size, y: mark.y / size, label: mark.label ?? '', mark };
    const mode = byKind.get(mark.kind);
    if (mode) mode.push(point);
    else byKind.set(mark.kind, [point]);
  }
  for (const [kind, points] of byKind) {
    for (const group of clusterPills(points, { selectedId })) {
      if (group.kind === 'single') {
        out.push(group.point.mark);
        continue;
      }
      out.push({
        id: group.id, kind,
        x: group.x * size, y: group.y * size,
        w: pillWidthPx(pillChars(group.label)) * size, h: PILL_HEIGHT_PX * size,
        angle: 0,
        // The group is as solid as its most confident member: a cluster that
        // faded with its weakest would read as less certain than what it hides.
        alpha: Math.max(...group.members.map((m) => m.mark.alpha)),
        label: group.label, pill: 'cluster', ids: group.members.map((m) => m.mark.id),
      });
    }
  }
  return out;
}

/** The capsule a pill is: two half-circle ends and the lines between them,
 *  built by hand because the narrow context deliberately has no roundRect
 *  (and neither do the older browsers a kiosk can be left running on). */
function capsulePath(ctx: SchemaContext, x: number, y: number, w: number, h: number): void {
  const r = h / 2;
  const right = x + Math.max(0, w / 2 - r);
  const left = x - Math.max(0, w / 2 - r);
  ctx.beginPath();
  ctx.arc(right, y, r, -Math.PI / 2, Math.PI / 2);
  ctx.lineTo(left, y + r);
  ctx.arc(left, y, r, Math.PI / 2, -Math.PI / 2);
  ctx.lineTo(right, y - r);
  ctx.closePath();
}

/**
 * The vehicle layer as numbered pills (F3): clear, then for every pill mark
 * a capsule in the mode's fill with its number centred in it -- a single
 * ringed by a hairline of paper, a cluster by the ink ring that says it
 * stands for several -- and a wider ring around the selected one. Alpha
 * carries confidence exactly as the rectangles did; the ring is always
 * opaque, because "this one" is not a matter of confidence.
 *
 * Marks are already in backing-store pixels and already carry the size they
 * are painted at (schemaVehicleMarks), so the stroke weights and the text
 * scale with the pill: a public screen's doubled pill keeps its proportions.
 */
export function paintPills(
  ctx: SchemaContext,
  layout: VehicleLayout,
  marks: readonly VehicleMark[],
  inks: PillInkSet,
  selectedId: string | null = null,
): void {
  ctx.clearRect(0, 0, layout.w, layout.h);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const m of marks) {
    if (!m.pill) continue;
    const size = m.h / PILL_HEIGHT_PX;
    ctx.save();
    ctx.globalAlpha = m.alpha;
    capsulePath(ctx, m.x, m.y, m.w, m.h);
    ctx.fillStyle = inks.fill;
    ctx.fill();
    ctx.strokeStyle = m.pill === 'cluster' ? inks.ink : inks.halo;
    ctx.lineWidth = (m.pill === 'cluster' ? PILL_CLUSTER_RING_PX : PILL_HALO_PX) * size;
    ctx.stroke();
    ctx.fillStyle = inks.text;
    ctx.font = `600 ${PILL_TEXT_PX * size}px Manrope, system-ui, sans-serif`;
    ctx.fillText(m.label ?? '', m.x, m.y);
    if (m.id === selectedId) {
      const gap = 2 * PILL_SELECT_GAP_PX * size;
      ctx.globalAlpha = 1;
      capsulePath(ctx, m.x, m.y, m.w + gap, m.h + gap);
      ctx.strokeStyle = inks.ink;
      ctx.lineWidth = PILL_SELECT_RING_PX * size;
      ctx.stroke();
    }
    ctx.restore();
  }
}

/** Only static work: repaint on size, viewport, selection or theme changes,
 *  never on an ordinary vehicle frame. ZET line colours are invariant;
 *  water, paper, circles and label ink come from the app's role tokens. */
export function paintSchema(ctx: SchemaContext, layout: SchemaLayout, tones: SchemaTones): void {
  const { schema, viewport, density, w, h } = layout;
  const scale = viewport.scale * density;
  const point = (p: XY): XY => schemaPoint(p, viewport, density);
  const path = (pts: readonly XY[]): void => {
    ctx.beginPath();
    pts.forEach((p, i) => {
      const q = point(p);
      if (i === 0) ctx.moveTo(q.x, q.y);
      else ctx.lineTo(q.x, q.y);
    });
  };
  ctx.clearRect(0, 0, w, h);
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.fillStyle = tones.halo;
  ctx.fillRect(0, 0, w, h);
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  ctx.clip();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (const water of schema.water) {
    path(water.pts);
    if (water.width === 0) {
      ctx.closePath();
      ctx.fillStyle = tones.water;
      ctx.fill();
    } else {
      ctx.strokeStyle = tones.water;
      ctx.lineWidth = water.width * scale;
      ctx.stroke();
    }
  }
  if (layout.trams) {
    for (const line of schema.lines) {
      path(line.pts);
      if (line.route === layout.selectedRoute) {
        ctx.strokeStyle = tones.ink;
        ctx.lineWidth = line.width * scale + 2 * density;
        ctx.stroke();
      }
      ctx.strokeStyle = line.colour;
      ctx.lineWidth = line.width * scale;
      ctx.stroke();
    }
    // The source has one ring per line/platform within a corridor. A
    // canonical named stop is its label/selection anchor, not another ring
    // invented halfway between the parallel lines.
    const stopsByName = new Map(schema.stops.map(s => [s.name, s]));
    const circles = new Map<string, { stop: Schema['stops'][number]; at: XY }>();
    for (const line of schema.lines) for (const entry of line.stops) {
      const stop = stopsByName.get(entry.name);
      if (!stop || !entry.ownCircle) continue;
      const at = pointAt(line, entry.u);
      const key = `${entry.name}:${at.x.toFixed(1)},${at.y.toFixed(1)}`;
      circles.set(key, { stop, at });
    }
    for (const { stop, at } of circles.values()) {
      const p = point(at);
      const radius = stop.r * scale;
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, stop.half ? -Math.PI / 2 : 0, stop.half ? Math.PI / 2 : Math.PI * 2);
      if (stop.half) ctx.closePath();
      ctx.fillStyle = stop.terminal ? tones.ink : tones.halo;
      ctx.fill();
      ctx.strokeStyle = tones.ink;
      // The source's 0.36-unit outlines remain visible at phone fit.
      ctx.lineWidth = Math.max(0.75 * density, 0.36 * scale);
      ctx.stroke();
    }
    // One highlight per named stop, not a stack of overlapping large rings
    // for every line's tiny platform circle in that corridor.
    for (const name of new Set([layout.screenStop, layout.selectedStop].filter(Boolean))) {
      const stop = stopsByName.get(name!);
      if (!stop) continue;
      const p = point(stop);
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(stop.r * scale + 4 * density, 8 * density), 0, Math.PI * 2);
      ctx.strokeStyle = tones.ink;
      ctx.lineWidth = 2 * density;
      ctx.stroke();
    }
    if (layout.labels) {
      ctx.fillStyle = tones.ink;
      ctx.textBaseline = 'alphabetic';
      for (const stop of schema.stops) {
        const label = stop.label;
        if (!label) continue;
        const p = point(label);
        const fontSize = Math.max((stop.terminal ? TERMINAL_LABEL_UNITS : STOP_LABEL_UNITS) * scale, (layout.labelMinPx ?? 0) * density);
        ctx.save();
        ctx.translate(p.x, p.y);
        if (label.rot !== 0) ctx.rotate(label.rot);
        ctx.textAlign = label.anchor;
        ctx.font = `${stop.terminal ? 700 : 500} ${fontSize}px Manrope, sans-serif`;
        label.text.split(/\r?\n/).forEach((row, i) => ctx.fillText(row, 0, i * fontSize * LABEL_ROW_ADVANCE));
        ctx.restore();
      }
    }
  }
  ctx.restore();
}
