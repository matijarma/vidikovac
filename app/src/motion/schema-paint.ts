// ZET artwork, in its own y-down coordinate system. Only the placer maps
// an integrator arc to this plane; reported GPS coordinates never enter a
// painter. Canvas mounting, gestures and the clock live in schema-map.ts.
import type { XY } from '../../../shared/motion/geo';
import { pointAt, type Schema, type createSchemaPlacer } from '../../../shared/motion/schema';
import type { Drawn } from './integrator';
import {
  MIN_VEHICLE_ALPHA, ROUTE_TYPE_TRAM, TRAM_LENGTH_PX, TRAM_WIDTH_PX,
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

/** The exact same visibility rule serves the canvas and accessible list. */
export function schemaInFrame(p: XY, viewport: SchemaViewport): boolean {
  const screen = schemaPoint(p, viewport);
  return screen.x >= 0 && screen.x <= viewport.width && screen.y >= 0 && screen.y <= viewport.height;
}

/** No shape lookup, live-position projection or direction offset. A chord
 *  deliberately has no track; it must not borrow a geographic heading. */
export function schemaMarks(placer: SchemaPlacer, drawn: readonly Drawn[], viewport: SchemaMarkViewport): VehicleMark[] {
  const marks: VehicleMark[] = [];
  const density = viewport.density;
  const size = density * (viewport.symbolScale ?? 1);
  for (const v of drawn) {
    if (v.type !== ROUTE_TYPE_TRAM || v.onShape === null) continue;
    const p = placer.place(v.path, v.s);
    if (!p || (v.routeId !== undefined && p.line !== v.routeId) || !schemaInFrame(p, viewport)) continue;
    const screen = schemaPoint(p, viewport, density);
    const sign = v.heading ? p.sign : 1;
    marks.push({
      id: v.id, kind: 'tram', ...screen,
      w: TRAM_LENGTH_PX * size, h: TRAM_WIDTH_PX * size,
      angle: p.track ? Math.atan2(p.track.y * sign, p.track.x * sign) : 0,
      alpha: MIN_VEHICLE_ALPHA + (1 - MIN_VEHICLE_ALPHA) * Math.min(1, Math.max(0, v.confidence)),
      colour: p.colour,
    });
  }
  return marks;
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
