// ZET artwork, in its own y-down coordinate system. Only the placer maps
// an integrator arc to this plane; reported GPS coordinates never enter a
// painter. Canvas mounting, gestures and the clock live in schema-map.ts.
import type { XY } from '../../../shared/motion/geo';
import { vetExternal } from '../../../shared/kiosk/external-text-boundary';
import { pointAt, type Schema, type SchemaPlacement, type SchemaStop, type createSchemaPlacer } from '../../../shared/motion/schema';
import { vehicleLabel } from '../map/city-map';
import { contrastRatio } from '../ui/contrast';
import type { Drawn } from './integrator';
import {
  clusterPills, NOSE_LENGTH_PX, NOSE_WIDTH_PX, PILL_HEIGHT_PX, PILL_MAX_CHARS_CLUSTER, PLATE_RADIUS_PX, pillChars, pillWidthPx,
  type PillPoint,
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
/** A wall's whole-network schema names its stops at the wall's walk-up tier
 *  (28 px, kiosk.css --k-sub-size): as many as the collision pass has room
 *  for, terminals first, then the stops the most lines call at. */
export const WALL_LABEL_MIN_PX = 28;
/** The artwork groups successive label baselines about one em apart. */
const LABEL_ROW_ADVANCE = 1.1;

// --- The vehicle pills (F3). Every constant carries its reason. ---

/** A single pill sits on a hairline of paper, the same one-CSS-px separation
 *  the rectangles had from the line under them and from a neighbour. */
const PILL_HALO_PX = 1;
/** A cluster trades that hairline for a 2 px ring in the ink tone: the city
 *  map's own convention (city-map.ts clusterToFeature) for "several here". */
const PILL_CLUSTER_RING_PX = 2;
/** The selected pill's ring, clear of the mark so the pill's own edge
 *  still reads, at the weight the rectangles' selection ring already used. */
const PILL_SELECT_GAP_PX = 3;
const PILL_SELECT_RING_PX = 1.5;
/** The number inside the pill: the city map paints its pills at 12 px
 *  (overlays.ts's vehicle text-size), and the schema is the same badge. */
const PILL_TEXT_PX = 12;
/** A two-way cluster's arrows are centred this far past the pill's edge,
 *  one on each side along the line: half a nose, so the triangle's base lies
 *  on the edge under the ink ring and its tip reaches a nose length beyond
 *  -- the arrow grows out of the ring rather than floating beside it. */
const TWO_WAY_ARROW_GAP_PX = NOSE_LENGTH_PX / 2;
/** A mark whose centre has left the canvas by less than this still has ink
 *  on it, so it is clipped by the canvas rather than culled: half of the
 *  widest pill a cluster label can take, plus its ring. Below this a pill
 *  half over the edge blinked out, which is exactly what F3 exists to stop. */
export const PILL_EDGE_MARGIN_PX = pillWidthPx(PILL_MAX_CHARS_CLUSTER) / 2 + PILL_CLUSTER_RING_PX;

// --- The names and the terminals (F4). Every constant carries its reason. ---

/** A name is a word to read, not texture: under 11 CSS px it is neither, so
 *  the size floors here once names start (LABEL_MIN_PX_PER_UNIT). */
export const LABEL_MIN_PX = 11;
/** And it stops growing here. Past 16 px a zoom that keeps enlarging the
 *  letters ends with three words laid over the network they name; beyond
 *  this the camera shows more map instead of bigger type. */
export const LABEL_MAX_PX = 16;
/** A terminal keeps the source's larger hierarchy two px above that cap. */
const TERMINAL_LABEL_EXTRA_PX = 2;
/** The names lie across the coloured lines now (the owner's decision), so
 *  each is stroked in the canvas tone first: three CSS px is about one
 *  letter-stroke of paper on either side at the sizes above. */
export const LABEL_HALO_PX = 3;
/** Translucent, so the line under a name is dimmed rather than cut in two. */
export const LABEL_HALO_ALPHA = 0.75;
/** Two names are apart when their boxes clear each other by this much: at
 *  one hairline the eye still reads them as one collided smudge. */
export const LABEL_GAP_PX = 2;
/** A terminal's disc against the ordinary platform ring: half again as
 *  large reads as emphasis, twice as large reads as a different symbol. */
export const TERMINAL_DISC_SCALE = 1.6;
/** Never smaller than this, so the end of a line is still a disc at the
 *  scale where names begin (r is about 2 units, LABEL_MIN_PX_PER_UNIT 1.4). */
const TERMINAL_MIN_RING_PX = 4;
/** The paper gap ring inside the disc, at this share of its radius: the
 *  printed network's own terminus mark, a filled disc with a ring cut out. */
const TERMINAL_GAP_RATIO = 0.7;
const TERMINAL_GAP_PX = 1;
/** A terminal's disc is never allowed to sit on its own name, so the
 *  capitals hang below it, clear of the disc's rim by half an em -- the
 *  space a printed network leaves between a terminus dot and its name. */
const TERMINAL_NAME_GAP_EM = 0.5;
/** The chips under a terminal's name. Barely rounded, like the kiosk's tram
 *  plate (pills.ts PLATE_RADIUS_PX): a number on a coloured tab. */
export const CHIP_RADIUS_PX = 3;
/** A chip's box against the name above it. */
const CHIP_HEIGHT_EM = 1.25;
/** The number inside it keeps the vehicle pill's own proportion -- 12 px of
 *  text in an 18 px pill -- so both badges on the map read at one
 *  weight, and it obeys the same size floor as a name: a line number no one
 *  can read is not a line number. */
const CHIP_TEXT_RATIO = PILL_TEXT_PX / PILL_HEIGHT_PX;
/** Padding on each side of the number, and the space between two chips. */
const CHIP_PAD_EM = 0.6;
const CHIP_GAP_PX = 2;

// --- Line focus (F5). ---

/** The other nineteen lines while one is in focus. Dimmed, never hidden: the
 *  diagram is a picture of a network, and a single line floating in white
 *  paper says nothing about where it goes. A fifth is the weakest ink that
 *  still reads as a line at the phone's fit while leaving the focused one
 *  unmistakably in front. */
export const SCHEMA_FOCUS_DIM_ALPHA = 0.2;

/** Structurally a subset of CanvasRenderingContext2D, like the existing
 *  SchematicContext, so tests can record actual paint calls without a GPU. */
export interface SchemaContext extends SchematicContext {
  arc(x: number, y: number, radius: number, start: number, end: number, counterclockwise?: boolean): void;
  closePath(): void;
  fill(): void;
  fillText(text: string, x: number, y: number): void;
  /** The halo under a name (F4), and the width the collision pass measures. */
  strokeText(text: string, x: number, y: number): void;
  measureText(text: string): { width: number };
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
  /** The reader's "only this line" switch (core/line-focus-store.ts, F5). */
  lineFocus?: boolean;
  /** The line in focus while that switch is on: the selected route, or the
   *  route of the selected vehicle. Null focuses nothing. */
  focusedRoute?: string | null;
  selectedRoute?: string | null;
  selectedStop?: string | null;
  screenStop?: string | null;
  /** Kiosk floor, independent of an unusually small host's viewport: a name on
   *  a screen read across a room is never smaller than this, whatever the
   *  crop's own scale says. Its presence is also what says this is a public
   *  screen -- it lifts the cap as well as the floor. It does not lift the
   *  collision pass: a screen that shows every name shows them over each
   *  other (F6b, schema-kiosk capture). */
  labelMinPx?: number;
  /** The one name the collision pass may never drop: the stop the surface is
   *  about -- on a public screen its own stop, whose 24 px name is the anchor
   *  the whole crop is chosen around. It sorts above the terminals, so the
   *  names that collide with it are the ones that give way. */
  priorityStop?: string | null;
  /** A route's display number for a terminal's chips. The artwork carries
   *  GTFS route ids; only the network knows what ZET calls them. */
  routeShort: (routeId: string) => string;
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
 *  itself is what clips it. The margin is stated in the CSS px the pill
 *  geometry is, and the pill is painted at `symbolScale` -- so on the kiosk,
 *  where every mark is twice as wide, the margin doubles with it. Flat, a
 *  wide cluster pill blinked out on the public screen with ink still showing
 *  (M3), which is exactly what this margin exists to stop. */
export function schemaInFrame(p: XY, viewport: SchemaViewport & { symbolScale?: number }): boolean {
  const screen = schemaPoint(p, viewport);
  const m = PILL_EDGE_MARGIN_PX * (viewport.symbolScale ?? 1);
  return screen.x >= -m && screen.x <= viewport.width + m && screen.y >= -m && screen.y <= viewport.height + m;
}

/** The direction of travel on the artwork: the placer's forward tangent
 *  turned by the leg's sign and normalised, so the dot product of two marks'
 *  directions is the cosine between their headings. A chord has no tangent
 *  and gets none; nor does a tram whose facing the integrator has not
 *  decided (decision 5: `heading` is null under its confidence threshold) --
 *  the rails say which line it is on, not which way it goes, so the sign is
 *  applied only to a known heading, as SchemaPlacement.track's own rule
 *  says, and the same gate the city map's clusterToFeature keeps. */
function travelDirection(p: SchemaPlacement, v: Drawn): XY | undefined {
  if (!p.track || v.heading === null) return undefined;
  const len = Math.hypot(p.track.x, p.track.y);
  return len > 0 ? { x: (p.track.x * p.sign) / len, y: (p.track.y * p.sign) / len } : undefined;
}

/** One pill per placeable tram: no shape lookup, live-position projection or
 *  direction offset (a chord deliberately has no track; it must not borrow a
 *  geographic heading), and no rotation either -- a numbered pill is read,
 *  not aimed, and the line under it already says where the rails go. The
 *  direction of travel rides along unpainted, for the arrows of a two-way
 *  cluster (clusterSchemaMarks). */
export function schemaVehicleMarks(placer: SchemaPlacer, drawn: readonly Drawn[], viewport: SchemaMarkViewport): VehicleMark[] {
  const marks: VehicleMark[] = [];
  const density = viewport.density;
  const size = density * (viewport.symbolScale ?? 1);
  for (const v of drawn) {
    if (v.type !== ROUTE_TYPE_TRAM || v.onShape === null) continue;
    const p = placer.place(v.path, v.s);
    if (!p || (v.routeId !== undefined && p.line !== v.routeId) || !schemaInFrame(p, viewport)) continue;
    const label = vehicleLabel(v);
    const dir = travelDirection(p, v);
    marks.push({
      id: v.id, kind: 'tram', ...schemaPoint(p, viewport, density),
      w: pillWidthPx(pillChars(label)) * size, h: PILL_HEIGHT_PX * size,
      angle: 0,
      alpha: MIN_VEHICLE_ALPHA + (1 - MIN_VEHICLE_ALPHA) * Math.min(1, Math.max(0, v.confidence)),
      label, pill: 'single',
      ...(dir ? { dir } : {}),
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
 *
 * A cluster is two-way when two of its members head against each other
 * along the line (a negative dot product of their directions): two trams of
 * one number passing at a stop. It takes the first known direction as its
 * own, so paintPills can lay the arrows along the line.
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
      const dirs = group.members.map((m) => m.mark.dir).filter((d): d is XY => d !== undefined);
      const dir = dirs[0];
      out.push({
        id: group.id, kind,
        x: group.x * size, y: group.y * size,
        w: pillWidthPx(pillChars(group.label)) * size, h: PILL_HEIGHT_PX * size,
        angle: 0,
        // The group is as solid as its most confident member: a cluster that
        // faded with its weakest would read as less certain than what it hides.
        alpha: Math.max(...group.members.map((m) => m.mark.alpha)),
        label: group.label, pill: 'cluster', ids: group.members.map((m) => m.mark.id),
        ...(dir ? { dir } : {}),
        twoWay: dirs.some((a) => dirs.some((b) => a.x * b.x + a.y * b.y < 0)),
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

/** The mark's outline, the badge rule (signage.css, the city map's
 *  MARK_IMAGE): a tram the plate, its corner PLATE_RADIUS_PX scaled with the
 *  mark; anything else the capsule. Centred on (x, y) like capsulePath. */
function markPath(ctx: SchemaContext, kind: VehicleMark['kind'], x: number, y: number, w: number, h: number, radius: number): void {
  if (kind === 'tram') roundRectPath(ctx, x - w / 2, y - h / 2, w, h, radius);
  else capsulePath(ctx, x, y, w, h);
}

/** An isosceles triangle centred on (cx, cy): its tip half its length along
 *  the unit direction (dx, dy), its base the same distance behind and its
 *  width across the direction -- the schema's own drawing of the city map's
 *  SDF nose (sdf.ts sdfTriangle), one path the caller fills and strokes. */
function arrowPath(ctx: SchemaContext, cx: number, cy: number, dx: number, dy: number, length: number, width: number): void {
  const ax = -dy * width / 2, ay = dx * width / 2;
  const bx = cx - dx * length / 2, by = cy - dy * length / 2;
  ctx.beginPath();
  ctx.moveTo(cx + dx * length / 2, cy + dy * length / 2);
  ctx.lineTo(bx + ax, by + ay);
  ctx.lineTo(bx - ax, by - ay);
  ctx.closePath();
}

/**
 * The vehicle layer as numbered marks (F3): clear, then for every pill mark
 * its shape in the mode's fill with its number centred in it -- a tram a
 * plate, a bus a capsule, the badge rule -- a single ringed by a hairline of
 * paper, a cluster by the ink ring that says it stands for several, and a
 * wider ring in the mark's own shape around the selected one. Alpha carries
 * confidence exactly as the rectangles did; the ring is always opaque,
 * because "this one" is not a matter of confidence.
 *
 * A two-way cluster (two trams of one number passing each other) then gets
 * a nose on each side along the line, pointing outward, in the fill with the
 * paper halo: the owner's ruling on an opposed merge, where a same-direction
 * merge is the plain ringed pill. The arrows are their own paths after the
 * pill, its number and its rings, so nothing about a plain mark's sequence
 * changes.
 *
 * Marks are already in backing-store pixels and already carry the size they
 * are painted at (schemaVehicleMarks), so the stroke weights, the text and
 * the arrows scale with the pill: a public screen's doubled pill keeps its
 * proportions.
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
    if (vetExternal('name', m.label, 'row') === null) continue;
    const size = m.h / PILL_HEIGHT_PX;
    ctx.save();
    ctx.globalAlpha = m.alpha;
    markPath(ctx, m.kind, m.x, m.y, m.w, m.h, PLATE_RADIUS_PX * size);
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
      // The ring's corner is the plate's plus the gap, so the two stay concentric.
      markPath(ctx, m.kind, m.x, m.y, m.w + gap, m.h + gap, (PLATE_RADIUS_PX + PILL_SELECT_GAP_PX) * size);
      ctx.strokeStyle = inks.ink;
      ctx.lineWidth = PILL_SELECT_RING_PX * size;
      ctx.stroke();
    }
    if (m.pill === 'cluster' && m.twoWay && m.dir) {
      // The arrows are part of the mark, so they carry its confidence like
      // the pill, not the selection ring's opacity.
      ctx.globalAlpha = m.alpha;
      ctx.fillStyle = inks.fill;
      ctx.strokeStyle = inks.halo;
      ctx.lineWidth = PILL_HALO_PX * size;
      const reach = m.w / 2 + TWO_WAY_ARROW_GAP_PX * size;
      for (const way of [1, -1] as const) {
        const dx = way * m.dir.x, dy = way * m.dir.y;
        arrowPath(ctx, m.x + dx * reach, m.y + dy * reach, dx, dy, NOSE_LENGTH_PX * size, NOSE_WIDTH_PX * size);
        ctx.fill();
        ctx.stroke();
      }
    }
    ctx.restore();
  }
}

// --- The names (F4) ------------------------------------------------------
//
// The artwork's own rot/anchor no longer place a name: the owner chose
// horizontal names that cross the coloured lines at the stop's ring, with
// the vehicle pills (a canvas above this one) driving over them. The
// artefact is untouched; those two fields simply stop being read.

/** A name's footprint on the canvas, in backing-store pixels. */
interface LabelBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface TerminalChip {
  text: string;
  colour: string;
  /** Measured in planNames, where the chip font is the one in the context. */
  w: number;
}

/** One name that will be painted, already measured and placed. */
interface NamePlan {
  rows: string[];
  terminal: boolean;
  px: number;
  /** The stop's own point horizontally; vertically the centre of the FIRST
   *  row -- an ordinary name straddles the stop, a terminal's hangs below
   *  its disc. */
  x: number;
  y: number;
  advance: number;
  chips: TerminalChip[];
  chipPx: number;
  chipHeight: number;
  chipsWidth: number;
  chipY: number;
}

const nameFont = (terminal: boolean, px: number): string => `${terminal ? 700 : 600} ${px}px Manrope, sans-serif`;
const chipFont = (px: number): string => `700 ${px}px Manrope, sans-serif`;

/** A name's size: the artwork's units at the current scale, floored so it
 *  stays a word and capped so it never grows into the network. A public
 *  screen states its own floor and takes no cap -- its crop is chosen for
 *  the names in it, and it is read across a room (R-P1). */
function labelPx(units: number, scale: number, density: number, capPx: number, kioskMinPx?: number): number {
  const raw = units * scale;
  if (kioskMinPx !== undefined) return Math.max(raw, kioskMinPx * density);
  return Math.min(Math.max(raw, LABEL_MIN_PX * density), capPx * density);
}

/** The lines that begin or end at this stop, one chip each, deduped by
 *  route: two directions of one line are one number on the tab. */
function terminalChips(layout: SchemaLayout, name: string): TerminalChip[] {
  const chips: TerminalChip[] = [];
  const seen = new Set<string>();
  for (const line of layout.schema.lines) {
    const first = line.stops[0], last = line.stops[line.stops.length - 1];
    if (seen.has(line.route) || (first?.name !== name && last?.name !== name)) continue;
    seen.add(line.route);
    chips.push({ text: layout.routeShort(line.route), colour: line.colour, w: 0 });
  }
  return chips;
}

function overlaps(a: LabelBox, b: LabelBox, gap: number): boolean {
  return a.x0 - gap < b.x1 && b.x0 - gap < a.x1 && a.y0 - gap < b.y1 && b.y0 - gap < a.y1;
}

/**
 * Measures every name and decides which of them this scale has room for.
 *
 * The order is the rank: the surface's own stop first where it has one
 * (`priorityStop`), then the terminals (they are what a stranger reads a
 * network by), then the stops the most lines call at, then the name itself
 * so one scale always drops the same name rather than flickering between
 * two. A candidate is placed when its box -- the widest row by the rows'
 * height, plus the halo, plus a terminal's chips -- clears everything
 * already placed; otherwise it waits for the next zoom step. Every surface
 * runs this, the public screen included: its crop is chosen for its own
 * stop, not for every name that falls inside it.
 */
function planNames(ctx: SchemaContext, layout: SchemaLayout, point: (p: XY) => XY, scale: number): NamePlan[] {
  const { schema, density } = layout;
  const kioskMinPx = layout.labelMinPx;
  const minPx = (kioskMinPx ?? LABEL_MIN_PX) * density;
  const halo = LABEL_HALO_PX * density;
  const gap = LABEL_GAP_PX * density;
  const calling = new Map<string, number>();
  for (const line of schema.lines) for (const name of new Set(line.stops.map(s => s.name))) {
    calling.set(name, (calling.get(name) ?? 0) + 1);
  }
  const priority = layout.priorityStop ?? null;
  const ranked = schema.stops.filter((s): s is SchemaStop & { label: NonNullable<SchemaStop['label']> } => s.label !== null)
    .sort((a, b) => Number(b.name === priority) - Number(a.name === priority)
      || Number(b.terminal) - Number(a.terminal)
      || (calling.get(b.name) ?? 0) - (calling.get(a.name) ?? 0)
      || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const placed: LabelBox[] = [];
  const plans: NamePlan[] = [];
  for (const stop of ranked) {
    const terminal = stop.terminal;
    const px = labelPx(terminal ? TERMINAL_LABEL_UNITS : STOP_LABEL_UNITS, scale, density,
      terminal ? LABEL_MAX_PX + TERMINAL_LABEL_EXTRA_PX : LABEL_MAX_PX, kioskMinPx);
    // A terminal shouts in the source too; Croatian diacritics survive it.
    const rawRows = stop.label.text.split(/\r?\n/);
    if (rawRows.some(row => vetExternal('name', row, 'row') === null)
      || vetExternal('name', rawRows.join(' '), 'row') === null) continue;
    const rows = rawRows.map(row => terminal ? row.toLocaleUpperCase('hr') : row);
    ctx.font = nameFont(terminal, px);
    let width = 0;
    for (const row of rows) width = Math.max(width, ctx.measureText(row).width);
    const advance = px * LABEL_ROW_ADVANCE;
    const at = point(stop);
    const chips = terminal ? terminalChips(layout, stop.name) : [];
    const chipPx = Math.max(px * CHIP_HEIGHT_EM * CHIP_TEXT_RATIO, minPx);
    const chipHeight = chipPx / CHIP_TEXT_RATIO;
    let chipsWidth = 0;
    if (chips.length > 0) {
      ctx.font = chipFont(chipPx);
      for (const chip of chips) {
        chip.w = ctx.measureText(chip.text).width + CHIP_PAD_EM * chipPx;
        chipsWidth += chip.w;
      }
      chipsWidth += (chips.length - 1) * CHIP_GAP_PX * density;
    }
    // An ordinary name straddles its stop and lets the ring show through
    // the halo; a terminal's disc is too large for that, so its capitals
    // hang below the disc's rim and the disc is never sat on.
    const disc = terminal ? terminalDiscRadius(stop, scale, density) : 0;
    const firstRow = terminal
      ? at.y + disc + TERMINAL_NAME_GAP_EM * px + px / 2
      : at.y - (rows.length - 1) * advance / 2;
    const top = firstRow - px / 2 - halo / 2;
    const nameBottom = firstRow + (rows.length - 1) * advance + px / 2 + halo / 2;
    const chipY = nameBottom + CHIP_GAP_PX * density + chipHeight / 2;
    const reach = Math.max(width + halo, chipsWidth, 2 * disc) / 2;
    const box: LabelBox = {
      x0: at.x - reach, x1: at.x + reach,
      // A terminal's box covers its disc, its name and its chips.
      y0: Math.min(top, at.y - disc), y1: chips.length > 0 ? chipY + chipHeight / 2 : nameBottom,
    };
    // Every surface chooses (F4, and F6b for the public screen): a name laid
    // over another name is not more information, it is two unreadable names.
    if (placed.some(other => overlaps(other, box, gap))) continue;
    placed.push(box);
    plans.push({ rows, terminal, px, x: at.x, y: firstRow, advance, chips, chipPx, chipHeight, chipsWidth, chipY });
  }
  return plans;
}

/** Halo first, then ink, row by row: a name laid over a coloured line reads
 *  because the paper tone is stroked under it, not because the line breaks. */
function paintNames(ctx: SchemaContext, plans: readonly NamePlan[], tones: SchemaTones, density: number): void {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = tones.halo;
  ctx.lineWidth = LABEL_HALO_PX * density;
  ctx.fillStyle = tones.ink;
  for (const plan of plans) {
    if (vetExternal('name', plan.rows.join(' '), 'row') === null) continue;
    ctx.font = nameFont(plan.terminal, plan.px);
    plan.rows.forEach((row, i) => {
      const y = plan.y + i * plan.advance;
      ctx.globalAlpha = LABEL_HALO_ALPHA;
      ctx.strokeText(row, plan.x, y);
      ctx.globalAlpha = 1;
      ctx.fillText(row, plan.x, y);
    });
  }
}

/** The number on a chip, in whichever tone the line's colour carries better.
 *  The tones come from computed style, so they arrive in whatever form the
 *  engine resolved them to -- `oklch()` for every current browser, since
 *  tokens.css redefines the palette there; contrast.ts reads those. A colour
 *  nobody can measure falls back to the paper tone, which is what a ZET line
 *  colour carries in nearly every case and what the vehicle pills already
 *  print (pills.ts PILL_INKS: near-white on the tram blue). */
function chipTextTone(colour: string, tones: SchemaTones): string {
  try {
    return contrastRatio(colour, tones.halo) > contrastRatio(colour, tones.ink) ? tones.halo : tones.ink;
  } catch {
    return tones.halo;
  }
}

/** The end of a line is half again the size of an ordinary platform ring,
 *  and never under the floor, so it is still a disc where names begin. */
function terminalDiscRadius(stop: SchemaStop, scale: number, density: number): number {
  return Math.max(stop.r * scale, TERMINAL_MIN_RING_PX * density) * TERMINAL_DISC_SCALE;
}

/** Built by hand because the narrow context deliberately has no roundRect
 *  (and neither do the older browsers a kiosk can be left running on). */
function roundRectPath(ctx: SchemaContext, x: number, y: number, w: number, h: number, radius: number): void {
  const r = Math.min(radius, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arc(x + w - r, y + r, r, -Math.PI / 2, 0);
  ctx.lineTo(x + w, y + h - r);
  ctx.arc(x + w - r, y + h - r, r, 0, Math.PI / 2);
  ctx.lineTo(x + r, y + h);
  ctx.arc(x + r, y + h - r, r, Math.PI / 2, Math.PI);
  ctx.lineTo(x, y + r);
  ctx.arc(x + r, y + r, r, Math.PI, -Math.PI / 2);
  ctx.closePath();
}

/** A row of numbered tabs under a terminal's name, one per line that ends
 *  there, each in that line's own ZET colour. */
function paintChips(ctx: SchemaContext, plans: readonly NamePlan[], tones: SchemaTones, density: number): void {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.globalAlpha = 1;
  for (const plan of plans) {
    if (plan.chips.length === 0) continue;
    ctx.font = chipFont(plan.chipPx);
    let x = plan.x - plan.chipsWidth / 2;
    for (const chip of plan.chips) {
      if (vetExternal('headsign', chip.text, 'row') === null) continue;
      roundRectPath(ctx, x, plan.chipY - plan.chipHeight / 2, chip.w, plan.chipHeight, CHIP_RADIUS_PX * density);
      ctx.fillStyle = chip.colour;
      ctx.fill();
      ctx.fillStyle = chipTextTone(chip.colour, tones);
      ctx.fillText(chip.text, x + chip.w / 2, plan.chipY);
      x += chip.w + CHIP_GAP_PX * density;
    }
  }
}

/** What one static repaint actually put on the canvas, counted rather than
 *  guessed: `schema-map.ts` writes it to `data-names` and `data-chips` so a
 *  browser proof can read the collision pass's outcome (F4) without diffing
 *  pixels. Nothing in the painting depends on it. */
export interface SchemaPaintCensus {
  /** Names the collision pass placed and inked at this scale. */
  names: number;
  /** Terminal chips painted, one per line ending at a placed terminal. */
  chips: number;
}

/** Only static work: repaint on size, viewport, selection or theme changes,
 *  never on an ordinary vehicle frame. ZET line colours are invariant;
 *  water, paper, circles and label ink come from the app's role tokens. */
export function paintSchema(ctx: SchemaContext, layout: SchemaLayout, tones: SchemaTones): SchemaPaintCensus {
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
  const census: SchemaPaintCensus = { names: 0, chips: 0 };
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
    // Line focus: the others first and faint, the one in focus last, so
    // nothing crossing it is painted over its ink.
    const focused = layout.lineFocus === true && layout.focusedRoute ? layout.focusedRoute : null;
    const ordered = focused === null
      ? schema.lines
      : [...schema.lines.filter((l) => l.route !== focused), ...schema.lines.filter((l) => l.route === focused)];
    for (const line of ordered) {
      ctx.globalAlpha = focused !== null && line.route !== focused ? SCHEMA_FOCUS_DIM_ALPHA : 1;
      path(line.pts);
      if (line.route === layout.selectedRoute || line.route === focused) {
        ctx.strokeStyle = tones.ink;
        ctx.lineWidth = line.width * scale + 2 * density;
        ctx.stroke();
      }
      ctx.strokeStyle = line.colour;
      ctx.lineWidth = line.width * scale;
      ctx.stroke();
    }
    // Nothing below a line -- a stop ring, a name, a terminal -- is dimmed.
    ctx.globalAlpha = 1;
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
    // The names go on over the ordinary rings, which show through the
    // translucent halo, so a ring never covers a letter and a letter never
    // covers a ring; the pills on the canvas above drive over both.
    const plans = layout.labels ? planNames(ctx, layout, point, scale) : [];
    census.names = plans.length;
    census.chips = plans.reduce((n, plan) => n + plan.chips.length, 0);
    paintNames(ctx, plans, tones, density);
    // The end of a line is a mark of its own: a disc half again the size of
    // an ordinary platform ring, with a gap ring of paper cut into it.
    for (const stop of schema.stops) {
      if (!stop.terminal) continue;
      const p = point(stop);
      const radius = terminalDiscRadius(stop, scale, density);
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = tones.ink;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius * TERMINAL_GAP_RATIO, 0, Math.PI * 2);
      ctx.strokeStyle = tones.halo;
      ctx.lineWidth = TERMINAL_GAP_PX * density;
      ctx.stroke();
    }
    // The chips belong to the name they sit under, and are drawn only where
    // that name was actually placed.
    paintChips(ctx, plans, tones, density);
    // One highlight per named stop, not a stack of overlapping large rings
    // for every line's tiny platform circle in that corridor. Last of all:
    // "this one" outranks every mark and every name under it.
    for (const name of new Set([layout.screenStop, layout.selectedStop].filter(Boolean))) {
      const stop = stopsByName.get(name!);
      if (!stop) continue;
      const p = point(stop);
      // Clear of whatever mark it rings: a terminal's disc is larger than
      // the platform ring, and a highlight inside it would be invisible.
      const marked = stop.terminal ? terminalDiscRadius(stop, scale, density) : stop.r * scale;
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(marked + 4 * density, 8 * density), 0, Math.PI * 2);
      ctx.strokeStyle = tones.ink;
      ctx.lineWidth = 2 * density;
      ctx.stroke();
    }
  }
  ctx.restore();
  return census;
}
