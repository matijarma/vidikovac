// The pill's look and the cluster rule, shared by the city map (overlays.ts,
// basemap.ts) and the schema (schema-paint.ts, round F): one pure module, no
// DOM, no MapLibre import, so a plain node test exercises the geometry and
// the union-find that never lets a vehicle disappear. Consumers hoist their
// constants from here; they keep their own tests and behaviour (F1 only
// moves the source of truth, F2/F3 wire the layers and the schema to it).

import { PILL_MAX_CHARS_CLUSTER, pillLabel } from './pill-label';

/** Pill geometry in CSS px: the hand-tuned capsule widths for a label of 1
 *  to 4 characters. On the city map the capsule follows its own text
 *  (overlays.ts: one stretchable SDF image, icon-text-fit), and these
 *  widths are what that fit lands on for a route number; the cluster rule
 *  below and the schema's painted pill measure with them directly. */
export const PILL_HEIGHT_PX = 18;
export const PILL_BASE_WIDTHS_PX: readonly number[] = [18, 24, 31, 38];
/** A cluster label ("6·11·12·14") can run past four characters; each one
 *  beyond the hand-tuned table widens the pill instead of clipping it. */
export const PILL_EXTRA_CHAR_PX = 7;
/** The budget of one row and the one line's cap (pill-label.ts, where the
 *  lightweight graph reads them without the rest of this module). */
export { PILL_MAX_CHARS_CLUSTER, pillLabel };
/** The rows a merged pill may take (decision 23, three since the
 *  Črnomerec hub's 23 lines, 91 characters, did not fit two): a label past
 *  one row's budget wraps onto a second, then a third, before anything is
 *  left out, so three rows of PILL_MAX_CHARS_CLUSTER, 120 characters of
 *  lines, is the whole cap. Only past it does clusterLabel keep the whole
 *  lines that fit -- a shorter list, never a count. */
export const PILL_MAX_LINES = 3;
/** What a cluster label breaks its rows with, in place of the "·" between
 *  the last line of one row and the first of the next: MapLibre's forced
 *  line break in a text-field, and the next row the canvas schema paints.
 *  The census reads a wrapped pill's lines split on both. */
export const PILL_ROW_BREAK = '\n';

/** The city map's one stretchable pill image: every label length is the
 *  same capsule, widened in its flat middle to the text it carries. */
export const PILL_IMAGE = 'vehicle-pill';
/** The tram's plate (the badge rule of signage.css: a tram is a plate, a bus
 *  a capsule -- first on the public screen under plan D4, on every map and in
 *  the legend chips since): the pill's box with the corners barely rounded,
 *  one stretchable image like the pill's. */
export const PLATE_IMAGE = 'vehicle-plate';
export const PLATE_RADIUS_PX = 3;
/** The direction nose: an isosceles triangle, its length along the direction
 *  of travel and its width across it. The city map draws it as an SDF image
 *  ahead of a pill (overlays.ts); the schema paints it by hand on each side
 *  of a cluster whose members pass each other (schema-paint.ts), so both
 *  surfaces show one arrow. */
export const NOSE_LENGTH_PX = 8;
export const NOSE_WIDTH_PX = 9;

// --- The capsule as the city map draws it ----------------------------------
//
// MapLibre lays the stretchable pill on its number (icon-text-fit), so the
// drawn capsule is the text's own advance plus PILL_FIT_PAD_X each side, and
// never narrower than its two fixed round ends. These are the numbers the
// render census and the direction nose need to agree with what is on the
// screen; the cluster rule above keeps measuring with the hand-tuned table.

/** The pill's number, in CSS px before the surface's symbol scale. */
export const PILL_TEXT_PX = 12;
/** The line the pill's number is set in, in CSS px before the symbol
 *  scale: MapLibre's text-line-height at PILL_TEXT_PX (overlays.ts states
 *  the default, PILL_LINE_HEIGHT_EM = 1.2 em). One row is this line inside
 *  PILL_HEIGHT_PX, and each further row of a wrapped label adds exactly one
 *  of it to the capsule's height. */
export const PILL_LINE_HEIGHT_PX = 14.4;
/** The capsule's room around its number, in CSS px before the symbol scale
 *  (overlays.ts icon-text-fit-padding, top/bottom and left/right). The
 *  pill's 12 px Noto Sans Medium sets every digit 6.5 px wide (its glyph
 *  advance, 13 at 24 px) on a 14.4 px line, so two digits land on the
 *  24 x 18 capsule stated above, three and four within a pixel of its 31
 *  and 38, and one (or none) on the ends' own 18. */
export const PILL_FIT_PAD_X = 5.5;
export const PILL_FIT_PAD_Y = 1.8;
/** Glyph advances of Noto Sans Medium at the glyph set's 24 px (the PBF
 *  ranges under app/public/maps/fonts, which MapLibre shapes the pill with):
 *  the cluster's separator, the no-break space an unknown route writes, and
 *  the capitals a route name may carry. Every digit, and anything else, is
 *  DIGIT_ADVANCE_24 wide (the PBF's own figure for all ten: tabular digits),
 *  so the digits need no entry -- which keeps the phone's lightweight graph
 *  under its budget (test/app/budget.test.ts). */
const PILL_GLYPH_ADVANCE_24: Readonly<Record<string, number>> = {
  '·': 6, ' ': 6, ' ': 6, '-': 7,
  A: 15, B: 15, C: 15, D: 17, E: 13, F: 12, G: 17, H: 17, I: 8, J: 6, K: 15, L: 12, M: 22,
  N: 18, O: 18, P: 14, Q: 18, R: 15, S: 13, T: 13, U: 17, V: 14, W: 22, X: 14, Y: 13, Z: 13,
};
const DIGIT_ADVANCE_24 = 13;

/** A label's rows: one, or the rows a wrapped cluster label (clusterLabel)
 *  breaks with PILL_ROW_BREAK. */
export function pillRows(label: string): string[] {
  return label.split(PILL_ROW_BREAK);
}

/** The width of one row's glyph advances at the glyph set's 24 px. */
function rowAdvance24(row: string): number {
  let advance = 0;
  for (const ch of row) advance += PILL_GLYPH_ADVANCE_24[ch] ?? DIGIT_ADVANCE_24;
  return advance;
}

/** The width MapLibre shapes `label` to at the pill's text size, in CSS px
 *  before the symbol scale: the sum of its glyph advances, and for a
 *  wrapped label its widest row (MapLibre centres the narrower one under
 *  it). '' is the one no-break space the pill layer writes for a route
 *  nobody knows. */
export function pillTextWidthPx(label: string): number {
  const widest = Math.max(...pillRows(label === '' ? ' ' : label).map(rowAdvance24));
  return (widest * PILL_TEXT_PX) / 24;
}

/** The capsule's height for a label of `rows` rows (one, or up to
 *  PILL_MAX_LINES for a wrapped cluster), in CSS px before the symbol scale:
 *  PILL_HEIGHT_PX for one, one PILL_LINE_HEIGHT_PX more for each further row
 *  (MapLibre shapes rows a line height apart, and the fit padding stays top
 *  and bottom). */
export function pillHeightPx(rows: number): number {
  return PILL_HEIGHT_PX + (rows - 1) * PILL_LINE_HEIGHT_PX;
}

/** The drawn capsule's half extents in CSS px before the symbol scale: the
 *  widest row plus its padding, never narrower than the two fixed ends (a
 *  circle of PILL_HEIGHT_PX), and as tall as its rows (pillHeightPx):
 *  PILL_HEIGHT_PX for every label but a wrapped cluster's. */
export function capsuleHalfPx(label: string): { halfWidth: number; halfHeight: number } {
  const halfHeight = pillHeightPx(pillRows(label).length) / 2;
  return { halfWidth: Math.max(PILL_HEIGHT_PX / 2, pillTextWidthPx(label) / 2 + PILL_FIT_PAD_X), halfHeight };
}

/** The corner radius of the mark a vehicle of `kind` wears (overlays.ts
 *  MARK_IMAGE): a tram's plate, anything else the round-ended capsule. */
export function markRadiusPx(kind: string): number {
  return kind === 'tram' ? PLATE_RADIUS_PX : PILL_HEIGHT_PX / 2;
}

/**
 * How far a ray from the centre of a rounded rectangle (half extents
 * `halfWidth` x `halfHeight`, corner radius `radius`) runs before it leaves
 * the shape, heading `bearingDeg` degrees clockwise from screen up: the
 * straight sides where it meets them, else the corner's own arc. The shape
 * is symmetric about both axes, so only the heading's two magnitudes count.
 */
export function outlineDistancePx(halfWidth: number, halfHeight: number, radius: number, bearingDeg: number): number {
  const rad = (bearingDeg * Math.PI) / 180;
  const ux = Math.abs(Math.sin(rad));
  const uy = Math.abs(Math.cos(rad));
  const r = Math.max(0, Math.min(radius, halfWidth, halfHeight));
  const EPS = 1e-9;
  if (ux > EPS) {
    const t = halfWidth / ux;
    if (t * uy <= halfHeight - r + EPS) return t;
  }
  if (uy > EPS) {
    const t = halfHeight / uy;
    if (t * ux <= halfWidth - r + EPS) return t;
  }
  // Through the corner: |t u - c| = r, c the corner arc's centre.
  const cx = halfWidth - r;
  const cy = halfHeight - r;
  const b = cx * ux + cy * uy;
  return b + Math.sqrt(Math.max(0, b * b - (cx * cx + cy * cy - r * r)));
}

/** How far into the capsule the nose's base is tucked along its heading, in
 *  CSS px before the symbol scale: half a pixel (one on the wall's scale 2),
 *  so the triangle reads as attached and never shows a hairline of street
 *  between the two, while all but that half pixel of its length is outside. */
export const NOSE_TUCK_PX = 0.5;

/**
 * The centre of the direction nose (or of one arrow of an opposed merge),
 * its distance from the mark's centre along `bearingDeg`, in CSS px before
 * the symbol scale: the capsule MapLibre draws for `label` (capsuleHalfPx,
 * markRadiusPx), left along the heading, plus half the triangle, less the
 * tuck. The capsule stays upright in the viewport while the triangle turns
 * with the heading, so a north-bound nose sits on the capsule's top edge and
 * an east-bound one on its round end: the old per-length table measured the
 * half-width alone, and floated the arrows of a vertical "6·7·8" 14 to 21 px
 * off the wall's capsule (lane-w-e2e-2.md).
 */
export function noseCentrePx(label: string, kind: string, bearingDeg: number): number {
  const { halfWidth, halfHeight } = capsuleHalfPx(label);
  return outlineDistancePx(halfWidth, halfHeight, markRadiusPx(kind), bearingDeg) + NOSE_LENGTH_PX / 2 - NOSE_TUCK_PX;
}

/** Padding added to a pill's box (each side) before two boxes are tested for
 *  overlap: two pills that almost touch still read as one cluster, not a
 *  hairline gap that flickers between joined and apart frame to frame. */
export const CLUSTER_PADDING_PX = 2;
/** The separator between distinct labels in a cluster's name. */
export const CLUSTER_SEPARATOR = '·';

/** The label length clamped to the cluster's widest pill: '' (route unknown)
 *  takes the smallest pill, anything past the cap takes the widest. A
 *  wrapped label is as wide as its longest row. */
export function pillChars(label: string): number {
  return Math.min(PILL_MAX_CHARS_CLUSTER, Math.max(1, ...pillRows(label).map((row) => row.length)));
}

/** The four hand-tuned widths verbatim, then +7px per character beyond them. */
export function pillWidthPx(chars: number): number {
  const n = Math.max(1, chars);
  if (n <= PILL_BASE_WIDTHS_PX.length) return PILL_BASE_WIDTHS_PX[n - 1]!;
  const last = PILL_BASE_WIDTHS_PX[PILL_BASE_WIDTHS_PX.length - 1]!;
  return last + (n - PILL_BASE_WIDTHS_PX.length) * PILL_EXTRA_CHAR_PX;
}

/** The tram/bus fill and text colours (and the shared halo), light and dark:
 *  the exact hexes basemap.ts's OVERLAY_LIGHT/OVERLAY_DARK have always drawn
 *  from, hoisted here so the schema paints the same ink as the city map. */
export interface PillInks {
  tram: string;
  tramText: string;
  bus: string;
  busText: string;
  other: string;
  otherText: string;
  halo: string;
}

export const PILL_INKS: { light: PillInks; dark: PillInks } = {
  light: {
    tram: '#0751bf',
    tramText: '#f7faff',
    bus: '#34465c',
    busText: '#f7faff',
    other: '#47586d',
    otherText: '#fbfcfe',
    halo: '#fbfcfe',
  },
  dark: {
    tram: '#84b5ff',
    tramText: '#102236',
    bus: '#b8c9dc',
    busText: '#102236',
    other: '#b8c5d5',
    otherText: '#111922',
    halo: '#111922',
  },
};

/** A label is "numeric" when it is only digits: a route number, not the K of
 *  a night line. */
function isNumeric(label: string): boolean {
  return /^\d+$/.test(label);
}

/** Route numbers the way a person reads them: numeric first (by value), then
 *  text, alphabetically -- clusterLabel's own comparator, kept local so this
 *  module never reaches into transport/search.ts for it. */
function compareClusterLabel(a: string, b: string): number {
  const an = isNumeric(a);
  const bn = isNumeric(b);
  if (an && bn) return Number(a) - Number(b);
  if (an !== bn) return an ? -1 : 1;
  return a.localeCompare(b, 'hr');
}


/**
 * The lines on exactly `rows` rows of at most PILL_MAX_CHARS_CLUSTER
 * characters each, broken only between two lines and balanced: the breaks
 * whose widest row is the narrowest as drawn (the glyph advances, so a row
 * of narrow separators is not taken for a long one), the earlier rows the
 * fuller on a tie. Null when `rows` rows cannot hold them.
 */
function balancedRows(lines: readonly string[], rows: number): string[] | null {
  if (rows === 1) {
    const one = lines.join(CLUSTER_SEPARATOR);
    return one.length <= PILL_MAX_CHARS_CLUSTER ? [one] : null;
  }
  let best: string[] | null = null;
  let narrowest = Infinity;
  for (let k = lines.length - 1; k > 0; k--) {
    const head = lines.slice(0, k).join(CLUSTER_SEPARATOR);
    if (head.length > PILL_MAX_CHARS_CLUSTER) continue;
    const tail = balancedRows(lines.slice(k), rows - 1);
    if (!tail) continue;
    const width = Math.max(rowAdvance24(head), ...tail.map(rowAdvance24));
    if (width < narrowest) {
      best = [head, ...tail];
      narrowest = width;
    }
  }
  return best;
}

/** The lines on the fewest rows, up to PILL_MAX_LINES, that hold them
 *  (balancedRows), joined by PILL_ROW_BREAK; null when even those cannot. */
function wrapLines(lines: readonly string[]): string | null {
  // Each break stands in for one separator, so a label longer than this
  // cannot fit however it is broken, and no break search is run for it.
  if (lines.join(CLUSTER_SEPARATOR).length > PILL_MAX_LINES * (PILL_MAX_CHARS_CLUSTER + 1) - 1) return null;
  for (let rows = 1; rows <= PILL_MAX_LINES; rows++) {
    const wrapped = balancedRows(lines, rows);
    if (wrapped) return wrapped.join(PILL_ROW_BREAK);
  }
  return null;
}

/** A cluster's name: every distinct line, numbers ascending then letters,
 *  joined by CLUSTER_SEPARATOR -- every line number, the pill grows
 *  [O-35]. Nothing is folded into a count. A name past one row's budget
 *  (PILL_MAX_CHARS_CLUSTER; every tram line together fits on one) wraps
 *  onto a second row at a separator, and past two onto a third, the rows
 *  balanced (decision 23), so a bus hub of up to 120 characters of lines is
 *  written whole. Only past PILL_MAX_LINES rows does the name stop at the
 *  last whole line the rows hold: a shorter list, never a count in place of
 *  the lines. Every line is held to one row first (pillLabel), so the name
 *  never outgrows its pill. */
export function clusterLabel(labels: readonly string[]): string {
  const lines = [...new Set([...labels].sort(compareClusterLabel).map(pillLabel))];
  // One line always fits (pillLabel), and none at all is the empty name.
  for (let n = lines.length; ; n--) {
    const label = wrapLines(lines.slice(0, n));
    if (label !== null) return label;
  }
}

/** A vehicle's pill in screen px: the box `clusterPills` tests for overlap is
 *  `pillWidthPx(pillChars(label)) x PILL_HEIGHT_PX` centred on (x, y): a
 *  vehicle's own label is one line (pillLabel), only a cluster's wraps. */
export interface PillPoint {
  id: string;
  x: number;
  y: number;
  label: string;
}

export interface Single<T extends PillPoint> {
  kind: 'single';
  point: T;
}

export interface Cluster<T extends PillPoint> {
  kind: 'cluster';
  id: string;
  x: number;
  y: number;
  label: string;
  members: T[];
}

interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

function boxOf(p: PillPoint): Box {
  const halfW = pillWidthPx(pillChars(p.label)) / 2 + CLUSTER_PADDING_PX;
  const halfH = PILL_HEIGHT_PX / 2 + CLUSTER_PADDING_PX;
  return { left: p.x - halfW, right: p.x + halfW, top: p.y - halfH, bottom: p.y + halfH };
}

function intersects(a: Box, b: Box): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

/** Groups pills whose boxes (plus CLUSTER_PADDING_PX) overlap in screen space
 *  into one cluster mark per group, by union-find: A-B and B-C overlapping
 *  joins A, B and C transitively even when A and C do not touch. A group of
 *  one stays a single. The selected (or followed) vehicle is never absorbed
 *  -- it is excluded from every overlap test and always comes back as its
 *  own single, so a tap never loses the mark it was aimed at. */
export function clusterPills<T extends PillPoint>(
  points: readonly T[],
  opts: { selectedId?: string | null } = {},
): Array<Single<T> | Cluster<T>> {
  const selectedId = opts.selectedId ?? null;
  const rest = selectedId === null ? points : points.filter((p) => p.id !== selectedId);
  const selected = selectedId === null ? undefined : points.find((p) => p.id === selectedId);

  const boxes = rest.map(boxOf);
  const parent = rest.map((_, i) => i);
  function find(i: number): number {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  }
  function union(i: number, j: number): void {
    const ri = find(i);
    const rj = find(j);
    if (ri !== rj) parent[ri] = rj;
  }
  for (let i = 0; i < rest.length; i++) {
    for (let j = i + 1; j < rest.length; j++) {
      if (intersects(boxes[i]!, boxes[j]!)) union(i, j);
    }
  }

  const groups = new Map<number, T[]>();
  for (let i = 0; i < rest.length; i++) {
    const root = find(i);
    const members = groups.get(root);
    if (members) members.push(rest[i]!);
    else groups.set(root, [rest[i]!]);
  }

  const results: Array<Single<T> | Cluster<T>> = [];
  for (const members of groups.values()) {
    if (members.length === 1) {
      results.push({ kind: 'single', point: members[0]! });
      continue;
    }
    const ids = members.map((m) => m.id).sort();
    const x = members.reduce((sum, m) => sum + m.x, 0) / members.length;
    const y = members.reduce((sum, m) => sum + m.y, 0) / members.length;
    results.push({
      kind: 'cluster',
      id: `cluster:${ids.join(',')}`,
      x,
      y,
      label: clusterLabel(members.map((m) => m.label)),
      members,
    });
  }
  if (selected) results.push({ kind: 'single', point: selected });
  return results;
}

/** The ZET colour table (scripts/zet-schema.mjs writes
 *  app/src/data/zet-line-colours.json, a later task) as a lookup with a
 *  fallback for a route id the table does not carry. */
export function createLineColours(
  table: Record<string, string>,
): (routeId: string | undefined, fallback: string) => string {
  return (routeId, fallback) => (routeId !== undefined && Object.hasOwn(table, routeId) ? table[routeId]! : fallback);
}

// --- A mark steps aside for a disc's number (round 2, F6) ------------------
//
// At the frame zoom the wall's pills and its BAJS discs share the main
// streets: half the discs lay under a pill at 22:32 (26 of 53), and a tram
// standing at a stop covered the station's count for a minute at a time; on
// the phone's Karta at z12.7 the same (21 of 41). Both marks must stay (every
// vehicle is drawn, every station says its count), so the vehicle mark, the
// one that moves anyway, steps aside. Up or down the screen, never along its
// own width: the capsule stands upright in the viewport whatever the heading,
// so across its height a mark clears a disc within a radius or two, while
// along a hub label's width it would have to travel half the label. Which
// way: a mark moving mostly up or down the screen steps ahead of the disc, so
// its side never flips as it passes the centre; one moving mostly across
// steps to the side of the disc it is already on, which does not change on a
// straight pass. By the smallest hop past every disc in its way (hub stations
// stand twelve pixels apart at z13, each forty wide, a pile no single hop
// clears) plus DEFLECT_MARGIN_PX, and never by a jump: the hop is ramped with
// the true overlap (DEFLECT_GAIN), so a mark meeting a disc slides off it and
// back once past. A bus pill steps aside for a tram plate the same way (trams
// are placed first, then buses, then the rest), and every mark placed is in
// the way of the ones after it. Never further than DEFLECT_MAX_PX: a mark in
// a pile too deep to hop goes as far as that and keeps what it still covers.
// Pure, in the CSS px
// the pill geometry is stated in (vehicle-features.ts divides the projected
// positions by the symbol scale first, as it does for the clustering).

/** A round obstacle a mark must not cover: a disc with a number, as its drawn radius (city-layers.ts). */
export interface DiscObstacle { x: number; y: number; r: number }
/** A mark to place: its centre, the label its capsule is fitted to, its kind and its heading (null: none known). */
export interface DeflectableMark { id: string; x: number; y: number; label: string; kind: string; bearing: number | null }
/** Where a mark was placed and how far it moved (0: where the model put it). */
export interface PlacedMark { x: number; y: number; moved: number }

/** The clearance left between a placed mark and what it stepped aside for. */
export const DEFLECT_MARGIN_PX = 1;
/** How far a mark may be moved per pixel of true overlap: the hop a mark stepping ahead of a disc needs is
 *  two radii at the first touch, which unramped would be a jump. Eight per pixel completes a single disc's
 *  hop within three pixels of travel and a hub pile's within six, so a tram standing on a station with a
 *  partial overlap (its dwell at the stop) is clear and not half over the count; the slide is fast but has
 *  no step, and the plate then waits ahead of the disc while the tram passes under it. (Three per pixel,
 *  the first try, left 8 of 16 covered discs covered on a replay of Trg: the hops stopped part-way through
 *  the pile, on the next disc.) */
export const DEFLECT_GAIN = 8;
/** The furthest a mark is ever moved from where the model put it: two capsule heights, one disc's hop and a
 *  little more. In ground that is 450 m at the wall's z13 (where the disc itself claims 500 m of street) and
 *  66 m at street level; a mark whose pile needs more stays where it is. */
export const DEFLECT_MAX_PX = 2 * PILL_HEIGHT_PX;

/** A capsule's spine (a horizontal segment) and its radius, as drawn. */
interface Capsule { x: number; y: number; spine: number; radius: number }
function capsuleOf(m: { x: number; y: number; label: string }): Capsule {
  const { halfWidth, halfHeight } = capsuleHalfPx(m.label);
  return { x: m.x, y: m.y, spine: Math.max(0, halfWidth - halfHeight), radius: halfHeight };
}
/** Something in a mark's way as the mark's own capsule meets it: a round obstacle, or a placed capsule
 *  (a horizontal segment of `spine` with `radius`): its centre, its half-length across and its radius. */
interface Obstacle { x: number; y: number; spine: number; r: number }
/** The distance between a capsule's spine and an obstacle's (a disc is a spine of 0). */
function spinesDistance(a: Capsule, b: Obstacle): number {
  const gap = Math.max(0, Math.abs(a.x - b.x) - a.spine - b.spine);
  return Math.hypot(gap, a.y - b.y);
}
/** Draw order among the kinds: a tram's plate is placed first, a bus pill steps aside for it. */
const DEFLECT_RANK: Readonly<Record<string, number>> = { tram: 0, bus: 1 };

/**
 * The smallest hop `p` (0 or more) along the screen's vertical, in direction `side` (+1 down, -1 up), that
 * leaves the capsule `own` clear of every obstacle it would meet on the way: each obstacle it reaches across
 * forbids an interval of `p`, and the hop walks past the chain of them the mark stands in. Never past
 * DEFLECT_MAX_PX: a chain that runs further is not hopped whole, the mark goes as far as the cap (a hop
 * that switched to nothing as the chain shortened under the cap would be the jump the gain avoids).
 */
function hopPast(own: Capsule, obstacles: readonly Obstacle[], side: 1 | -1): number {
  const forbidden: [number, number][] = [];
  for (const o of obstacles) {
    const r = o.r + DEFLECT_MARGIN_PX;
    // Reached across: the spines' horizontal gap is inside the two radii, so the vertical distance decides.
    const gap = Math.max(0, Math.abs(own.x - o.x) - own.spine - o.spine);
    const reach = own.radius + r;
    if (gap >= reach) continue;
    const across = Math.sqrt(reach * reach - gap * gap);
    const centre = side * (o.y - own.y);
    forbidden.push([centre - across, centre + across]);
  }
  forbidden.sort((a, b) => a[0] - b[0]);
  let p = 0;
  for (const [from, to] of forbidden) {
    if (to <= p) continue;
    if (from >= p) break;
    p = to;
  }
  return Math.min(p, DEFLECT_MAX_PX);
}

/**
 * The marks placed: each in `marks` (singles and clusters alike, in the CSS px
 * of the pill geometry) moved off the `discs` and off the marks placed before
 * it, as described above. Every mark comes back, moved or not.
 */
export function deflectMarks(marks: readonly DeflectableMark[], discs: readonly DiscObstacle[]): Map<string, PlacedMark> {
  const placed = new Map<string, PlacedMark>();
  const before: Obstacle[] = [];
  const order = [...marks].sort((a, b) => (DEFLECT_RANK[a.kind] ?? 2) - (DEFLECT_RANK[b.kind] ?? 2) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const mark of order) {
    const own = capsuleOf(mark);
    const inWay: Obstacle[] = [...discs.map((d) => ({ x: d.x, y: d.y, spine: 0, r: d.r })), ...before];
    // The true overlap now: how far the nearest thing in the way reaches into the capsule (0: clear).
    let overlap = 0;
    let nearest: Obstacle | null = null;
    for (const o of inWay) {
      const depth = own.radius + o.r + DEFLECT_MARGIN_PX - spinesDistance(own, o);
      if (depth > overlap) { overlap = depth; nearest = o; }
    }
    if (overlap <= 0 || !nearest) {
      placed.set(mark.id, { x: mark.x, y: mark.y, moved: 0 });
      before.push({ x: own.x, y: own.y, spine: own.spine, r: own.radius });
      continue;
    }
    // Which way: ahead of the disc for a mark moving mostly up or down the screen (screen y grows
    // downward, a bearing of 0 is up); the side it is already on for one moving mostly across, or one
    // with no heading; dead level, down.
    const rad = ((mark.bearing ?? 90) * Math.PI) / 180;
    const ux = Math.sin(rad);
    const uy = -Math.cos(rad);
    const vertical = mark.bearing !== null && Math.abs(uy) > Math.abs(ux);
    const side: 1 | -1 = vertical ? (uy < 0 ? -1 : 1) : (own.y - nearest.y < 0 ? -1 : 1);
    const hop = hopPast(own, inWay, side);
    // Never a jump: at most DEFLECT_GAIN per pixel of true overlap, nothing at a touch.
    const m = Math.min(hop, DEFLECT_GAIN * overlap);
    const at = { x: mark.x, y: mark.y + side * m, moved: m };
    placed.set(mark.id, at);
    before.push({ x: at.x, y: at.y, spine: own.spine, r: own.radius });
  }
  return placed;
}
