// The pill's look and the cluster rule, shared by the city map (overlays.ts,
// basemap.ts) and the schema (schema-paint.ts, round F): one pure module, no
// DOM, no MapLibre import, so a plain node test exercises the geometry and
// the union-find that never lets a vehicle disappear. Consumers hoist their
// constants from here; they keep their own tests and behaviour (F1 only
// moves the source of truth, F2/F3 wire the layers and the schema to it).

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
/** A merged pill names every line in it and grows with them [O-35]: a
 *  count of hidden lines tells someone waiting for a tram nothing. This is
 *  only the hard cap, the widest capsule there is (290 px): all fifteen
 *  tram lines, "1·2·3·4·5·6·7·8·9·11·12·13·14·15·17", are 35 characters
 *  and fit whole; ten three-digit bus routes are 39. A bus hub past forty
 *  keeps the whole lines that fit (clusterLabel), never a count. */
export const PILL_MAX_CHARS_CLUSTER = 40;

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
 *  the digits, the cluster's separator, the no-break space an unknown route
 *  writes, and the capitals a route name may carry. Anything else is taken
 *  as wide as a digit. */
const PILL_GLYPH_ADVANCE_24: Readonly<Record<string, number>> = Object.freeze({
  '0': 13, '1': 13, '2': 13, '3': 13, '4': 13, '5': 13, '6': 13, '7': 13, '8': 13, '9': 13,
  '·': 6, ' ': 6, ' ': 6, '-': 7,
  A: 15, B: 15, C: 15, D: 17, E: 13, F: 12, G: 17, H: 17, I: 8, J: 6, K: 15, L: 12, M: 22,
  N: 18, O: 18, P: 14, Q: 18, R: 15, S: 13, T: 13, U: 17, V: 14, W: 22, X: 14, Y: 13, Z: 13,
});
const DIGIT_ADVANCE_24 = 13;

/** The width MapLibre shapes `label` to at the pill's text size, in CSS px
 *  before the symbol scale: the sum of its glyph advances. '' is the one
 *  no-break space the pill layer writes for a route nobody knows. */
export function pillTextWidthPx(label: string): number {
  let advance = 0;
  for (const ch of label === '' ? ' ' : label) advance += PILL_GLYPH_ADVANCE_24[ch] ?? DIGIT_ADVANCE_24;
  return (advance * PILL_TEXT_PX) / 24;
}

/** The drawn capsule's half extents in CSS px before the symbol scale: the
 *  text plus its padding, never narrower than the two fixed ends (a circle
 *  of PILL_HEIGHT_PX), always PILL_HEIGHT_PX tall. */
export function capsuleHalfPx(label: string): { halfWidth: number; halfHeight: number } {
  const halfHeight = PILL_HEIGHT_PX / 2;
  return { halfWidth: Math.max(halfHeight, pillTextWidthPx(label) / 2 + PILL_FIT_PAD_X), halfHeight };
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
 *  takes the smallest pill, anything past the cap takes the widest. */
export function pillChars(label: string): number {
  return Math.min(PILL_MAX_CHARS_CLUSTER, Math.max(1, label.length));
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

/** One line's name as its pill writes it: whole, as it always is for a
 *  ZET line (four characters at most). Only an identifier longer than the
 *  widest capsule (PILL_MAX_CHARS_CLUSTER) is cut to it, so no label ever
 *  runs past its pill; it is never emptied. The standalone and selected
 *  pills (city-map.ts's vehicleLabel) and a cluster's first line both pass
 *  through here, so the cap holds on every mark. */
export function pillLabel(label: string): string {
  return label.length > PILL_MAX_CHARS_CLUSTER ? label.slice(0, PILL_MAX_CHARS_CLUSTER) : label;
}

/** A cluster's name: every distinct line, numbers ascending then letters,
 *  joined by CLUSTER_SEPARATOR -- every line number, the pill grows
 *  [O-35]. Nothing is folded into a count. Only past the capsule's hard cap
 *  (PILL_MAX_CHARS_CLUSTER, a bus hub; every tram line together fits) does
 *  the name stop at the last whole line that fits: a shorter list, never a
 *  count in place of the lines. Every candidate is checked against the cap,
 *  the first one too (pillLabel), so the name never outgrows its pill. */
export function clusterLabel(labels: readonly string[]): string {
  const distinct = [...new Set(labels)].sort(compareClusterLabel);
  let label = pillLabel(distinct[0] ?? '');
  for (const line of distinct.slice(1)) {
    const next = label + CLUSTER_SEPARATOR + line;
    if (next.length > PILL_MAX_CHARS_CLUSTER) break;
    label = next;
  }
  return label;
}

/** A vehicle's pill in screen px: the box `clusterPills` tests for overlap is
 *  `pillWidthPx(pillChars(label)) x PILL_HEIGHT_PX` centred on (x, y). */
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
