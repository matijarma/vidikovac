// ZET's page-space artwork is a coordinate system, not another motion
// engine. Decode once, match each path's stop OCCURRENCES once, then sample
// the integrator's arc. No DOM, geographic snapping or network mutation.
import type { XY } from './geo';
import type { GraphNetwork } from './network';
import { at, cumulative, tangent } from './polyline';

export interface SchemaLabel extends XY {
  text: string;
  rows: 1 | 2;
  /** Radians in the artwork's y-down page space. */
  rot: number;
  anchor: 'start' | 'end';
}

export interface SchemaStop extends XY {
  name: string;
  r: number;
  half: null | 'D';
  label: SchemaLabel | null;
  terminal: boolean;
}

export interface SchemaLineStop {
  u: number;
  name: string;
  ownCircle: boolean;
}

export interface RawSchemaLine {
  route: string;
  night: boolean;
  colour: string;
  width: number;
  pts: [number, number][];
  /** Ascending arc order; names need not be unique. */
  stops: SchemaLineStop[];
}

/** The exact version-1 wire format from docs/plan-shema-linija.md. */
export interface RawSchema {
  version: 1;
  source: string;
  builtAt: string;
  feedVersion: string;
  box: [number, number];
  lines: RawSchemaLine[];
  stops: SchemaStop[];
  water: { pts: [number, number][]; width: number; colour: string }[];
}

export interface SchemaLine extends Omit<RawSchemaLine, 'pts'> {
  pts: XY[];
  cum: number[];
  len: number;
}

export interface SchemaWater {
  pts: XY[];
  /** Zero denotes a filled lake polygon; positive widths denote strokes. */
  width: number;
  colour: string;
}

export interface Schema extends Omit<RawSchema, 'lines' | 'water'> {
  lines: SchemaLine[];
  water: SchemaWater[];
}

export type SchemaSign = 1 | -1;
export interface SchemaPlacement extends XY {
  /** Forward artwork tangent, absent on a chord. Multiply by sign only if
   *  the integrator knows the vehicle's heading. */
  track?: XY;
  sign: SchemaSign;
  colour: string;
  /** GTFS route id, not a line-array index or the short display name. */
  line: string;
  chord: boolean;
}

export interface SchemaPlacer {
  place(pathIdx: number | null | undefined, s: number | null | undefined): SchemaPlacement | null;
}

export class SchemaVersionError extends Error {
  readonly found: unknown;
  constructor(found: unknown) {
    super(`zet-schema.json: unsupported artefact version ${JSON.stringify(found)}, expected 1`);
    this.name = 'SchemaVersionError';
    this.found = found;
  }
}

function invalid(field: string): never {
  throw new Error(`zet-schema.json: invalid ${field}`);
}
function object(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid(field);
  return value as Record<string, unknown>;
}
function array(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) return invalid(field);
  return value;
}
function number(value: unknown, field: string, min = -Infinity): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min) return invalid(field);
  return value;
}
function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) return invalid(field);
  return value;
}
function boolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') return invalid(field);
  return value;
}

/** Throws on stale/malformed artwork instead of allowing NaN into canvas.
 *  Tuples are ordinary page coordinates, never chain-delta encoded. */
export function decodeSchema(raw: unknown): Schema {
  if (!raw || typeof raw !== 'object' || !('version' in raw)) throw new SchemaVersionError(undefined);
  if (raw.version !== 1) throw new SchemaVersionError(raw.version);
  const r = object(raw, 'artefact');
  const boxRaw = array(r.box, 'box');
  if (boxRaw.length !== 2) invalid('box');
  const box: [number, number] = [number(boxRaw[0], 'box[0]', Number.MIN_VALUE), number(boxRaw[1], 'box[1]', Number.MIN_VALUE)];
  const points = (value: unknown, field: string): XY[] => {
    const pts = array(value, field).map((v, i) => {
      const pair = array(v, `${field}[${i}]`);
      if (pair.length !== 2) invalid(`${field}[${i}]`);
      const x = number(pair[0], `${field}[${i}].x`, 0);
      const y = number(pair[1], `${field}[${i}].y`, 0);
      // Page dimensions have four decimals; vertices are rounded to two.
      if (x > box[0] + 0.01 || y > box[1] + 0.01) invalid(`${field}[${i}] outside page`);
      return { x, y };
    });
    if (pts.length < 2) invalid(`${field} (at least two points)`);
    return pts;
  };
  const routes = new Set<string>();
  const lines = array(r.lines, 'lines').map((value, i): SchemaLine => {
    const field = `lines[${i}]`;
    const line = object(value, field);
    const route = text(line.route, `${field}.route`);
    if (routes.has(route)) invalid(`duplicate route ${route}`);
    routes.add(route);
    const pts = points(line.pts, `${field}.pts`);
    const cum = cumulative(pts);
    const len = cum[cum.length - 1];
    if (!(len > 0) || !Number.isFinite(len)) invalid(`${field}.length`);
    let previousU = -Infinity;
    const stops = array(line.stops, `${field}.stops`).map((value, k): SchemaLineStop => {
      const stopField = `${field}.stops[${k}]`;
      const stop = object(value, stopField);
      const u = number(stop.u, `${stopField}.u`, 0);
      // Each rounded vertex can change the length of both its segments.
      if (u < previousU || u > len + 0.02 * pts.length) invalid(`${stopField}.u (arc order/range)`);
      previousU = u;
      return { u: Math.min(u, len), name: text(stop.name, `${stopField}.name`), ownCircle: boolean(stop.ownCircle, `${stopField}.ownCircle`) };
    });
    return {
      route, night: boolean(line.night, `${field}.night`), colour: text(line.colour, `${field}.colour`),
      width: number(line.width, `${field}.width`, Number.MIN_VALUE), pts, cum, len, stops,
    };
  });
  const stops = array(r.stops, 'stops').map((value, i): SchemaStop => {
    const field = `stops[${i}]`;
    const stop = object(value, field);
    if (stop.half !== null && stop.half !== 'D') invalid(`${field}.half`);
    let label: SchemaLabel | null = null;
    if (stop.label !== null) {
      const l = object(stop.label, `${field}.label`);
      if (l.rows !== 1 && l.rows !== 2) invalid(`${field}.label.rows`);
      if (l.anchor !== 'start' && l.anchor !== 'end') invalid(`${field}.label.anchor`);
      label = {
        text: text(l.text, `${field}.label.text`), rows: l.rows,
        x: number(l.x, `${field}.label.x`), y: number(l.y, `${field}.label.y`),
        rot: number(l.rot, `${field}.label.rot`), anchor: l.anchor,
      };
    }
    return {
      name: text(stop.name, `${field}.name`), x: number(stop.x, `${field}.x`), y: number(stop.y, `${field}.y`),
      r: number(stop.r, `${field}.r`, 0), half: stop.half, terminal: boolean(stop.terminal, `${field}.terminal`), label,
    };
  });
  const water = array(r.water, 'water').map((value, i): SchemaWater => {
    const field = `water[${i}]`;
    const w = object(value, field);
    return { pts: points(w.pts, `${field}.pts`), width: number(w.width, `${field}.width`, 0), colour: text(w.colour, `${field}.colour`) };
  });
  return {
    version: 1, source: text(r.source, 'source'), builtAt: text(r.builtAt, 'builtAt'), feedVersion: text(r.feedVersion, 'feedVersion'),
    box, lines, stops, water,
  };
}

export function pointAt(line: SchemaLine, u: number): XY {
  return at(line.pts, line.cum, u);
}
export function tangentAt(line: SchemaLine, u: number): XY {
  return tangent(line.pts, line.cum, u);
}

export interface SchemaPathUnmatched {
  /** Original stopsOnPath position, preserved even on a later visit. */
  k: number;
  stopId: string;
  name: string;
  s: number;
}
export interface SchemaPathStop extends SchemaPathUnmatched {
  u: number;
  lineIndex: number;
}
export interface SchemaPathLeg {
  /** Inclusive indices in the matched table. Turning stops belong to both legs. */
  from: number;
  to: number;
  sign: SchemaSign;
  /** Strictly monotone in u, increasing in path arc s. */
  stops: SchemaPathStop[];
}
export type SchemaPathFailure =
  | 'invalid-path' | 'non-tram' | 'missing-line' | 'too-few-stops'
  | 'non-increasing-arc' | 'ambiguous-stops' | 'no-progress' | 'loop-path' | 'loop-undrawn';

/** The direction a terminus loop path carries (scripts/gtfs-shapes.mjs
 *  LOOP_DIRECTION): stops [L, F], from one trip's last platform to the next
 *  trip's first, which the artwork draws as one terminus. */
export const LOOP_PATH_DIRECTION = -1;
export interface SchemaPathMatch {
  pathIdx: number | null;
  route: string | null;
  line: SchemaLine | null;
  stops: SchemaPathStop[];
  legs: SchemaPathLeg[];
  unmatched: SchemaPathUnmatched[];
  sourceStops: number;
  collapsedAssociations: number;
  placeable: boolean;
  /** Global monotonicity, NOT a condition for placement. Real return paths
   *  have multiple individually monotone legs and must keep both visits. */
  monotone: boolean;
  reason: SchemaPathFailure | null;
}

/** Coincident projections and adjacent platforms with the same name are
 *  one logical diagram stop. Keep their coordinates as separate choices;
 *  neither variant makes a neighbouring served stop into a detour chord. */
function diagramPositions(line: SchemaLine): number[] {
  let position = 0;
  return line.stops.map((stop, k) => {
    if (k > 0 && stop.u !== line.stops[k - 1].u && stop.name !== line.stops[k - 1].name) position++;
    return position;
  });
}

interface Choice {
  index: number;
  sign: SchemaSign | 0;
  // Prefer actual progress, then the fewest skipped diagram stops, then
  // continuity. A reversal is allowed, never inferred from direction_id.
  cost: [number, number, number, number, number];
  parent: Choice | null;
  ambiguous: boolean;
  /** Logical occurrence sequence; two platform variants are not ambiguity. */
  sequence: string;
}
function compareCost(a: Choice, b: Choice): number {
  for (let i = 0; i < a.cost.length; i++) if (Math.abs(a.cost[i] - b.cost[i]) > 1e-9) return a.cost[i] - b.cost[i];
  return 0;
}

/** Shared build/runtime validator. No repair of the graph: coalesce local
 *  duplicate projections of a platform before grouping neighbouring names.
 *  A later stop-name run remains a NEW visit. For each visit keep the
 *  association closest to its platform, first arc on an exact tie.
 *
 *  Artwork names also need not be unique. Match candidate occurrences as
 *  a sequence, not a name->u dictionary. Within one logical stop, prefer an
 *  own circle, then proximity to the local stop-bracket arc fraction.
 *  Equal best DISTINCT logical sequences are reported as ambiguous.
 */
export function matchSchemaPath(schema: Schema, net: GraphNetwork, pathIdx: number | null | undefined): SchemaPathMatch {
  const result: SchemaPathMatch = {
    pathIdx: typeof pathIdx === 'number' ? pathIdx : null, route: null, line: null,
    stops: [], legs: [], unmatched: [], sourceStops: 0, collapsedAssociations: 0,
    placeable: false, monotone: false, reason: null,
  };
  const fail = (reason: SchemaPathFailure): SchemaPathMatch => ({ ...result, reason });
  if (typeof pathIdx !== 'number' || !Number.isInteger(pathIdx) || pathIdx < 0 || !net.paths[pathIdx]) return fail('invalid-path');
  const path = net.paths[pathIdx];
  result.route = path.route;
  if (net.routes.get(path.route)?.type !== 0) return fail('non-tram');
  const line = schema.lines.find((l) => l.route === path.route);
  if (!line) return fail('missing-line');
  result.line = line;
  // A terminus loop has no legs to lay along the artwork: it is where the
  // line turns, and the placer puts it on the terminus circle instead
  // ('loop-path'). A loop neither of whose platforms this line's artwork
  // prints has no circle to go to ('loop-undrawn', see loopPlacement): the
  // schematic does not draw it, and the tram stays on the geographic map.
  if (path.direction === LOOP_PATH_DIRECTION) return fail(loopEntry(line, net, path) ? 'loop-path' : 'loop-undrawn');
  // The GEOMETRIC list, not the served one (F8): this is artwork placement,
  // not planning. Every platform the rails pass is a legitimate anchor for
  // the arc -> u mapping -- only names printed on this line become anchors
  // anyway, and a platform of another line at the same place is the same
  // place. Reading the served list instead would cost three paths their
  // anchors (13_11 and two of line 1's synthetic paths on feed 000395) and
  // buy nothing: the placer already dedupes by name and locality.
  const source = net.stopsOnPathGeometric(pathIdx);
  result.sourceStops = source.length;
  interface Association {
    entry: SchemaPathUnmatched;
    distance: number;
    end: number;
  }
  const associations: Association[] = [];
  // This map points only to the most recent local cluster, not to the
  // platform's sole visit. All earlier visits remain in `associations`.
  const latest = new Map<string, Association>();
  for (let k = 0; k < source.length; k++) {
    const { stop, s } = source[k];
    if (!Number.isFinite(s) || (k > 0 && s < source[k - 1].s)) return fail('non-increasing-arc');
    const p = net.toPathPoint(pathIdx, s);
    const distance = Math.hypot(p.x - stop.p.x, p.y - stop.p.y);
    const entry = { k, stopId: stop.id, name: stop.name, s };
    const previous = latest.get(stop.id);
    // At a junction one platform projects onto several neighbouring edges,
    // interleaved with OTHER stop names. Overlapping [s-d, s+d] intervals
    // identify these local associations without a city-specific radius or
    // deleting a real visit kilometres later. 0.1 m is the wire arc quantum.
    if (previous && s - distance <= previous.end + 0.1) {
      previous.end = Math.max(previous.end, s + distance);
      if (distance + 1e-6 < previous.distance) {
        previous.entry = entry;
        previous.distance = distance;
      }
    } else {
      const association = { entry, distance, end: s + distance };
      associations.push(association);
      latest.set(stop.id, association);
    }
  }
  associations.sort((a, b) => a.entry.s - b.entry.s || a.entry.k - b.entry.k);
  const visits: SchemaPathUnmatched[] = [];
  let error = Infinity;
  for (const { entry, distance } of associations) {
    if (visits.at(-1)?.name === entry.name) {
      if (distance + 1e-6 < error) {
        visits[visits.length - 1] = entry;
        error = distance;
      }
    } else {
      visits.push(entry);
      error = distance;
    }
  }
  result.collapsedAssociations = source.length - visits.length;
  const candidates = new Map<string, number[]>();
  line.stops.forEach((stop, index) => {
    const list = candidates.get(stop.name) ?? [];
    // Duplicate links to the same printed point are not different choices.
    if (!list.some((k) => line.stops[k].u === stop.u)) list.push(index);
    candidates.set(stop.name, list);
  });
  const matched = visits.filter((entry) => {
    if (candidates.has(entry.name)) return true;
    result.unmatched.push(entry);
    return false;
  });
  if (matched.length < 2) {
    result.stops = matched.map((entry) => {
      const index = candidates.get(entry.name)![0];
      return { ...entry, u: line.stops[index].u, lineIndex: index };
    });
    return fail('too-few-stops');
  }
  const positions = diagramPositions(line);
  const residual = (k: number, index: number): number => {
    const indices = candidates.get(matched[k].name)!;
    // Repeated names at distinct logical positions are resolved by sequence
    // order below, not by pretending the entire distorted diagram is to scale.
    if (indices.length === 1 || indices.some((i) => positions[i] !== positions[indices[0]])) return 0;
    let before = k - 1;
    let after = k + 1;
    while (before >= 0 && candidates.get(matched[before].name)!.length !== 1) before--;
    while (after < matched.length && candidates.get(matched[after].name)!.length !== 1) after++;
    if (before < 0 || after >= matched.length) return 0;
    const a = matched[before];
    const b = matched[after];
    const from = line.stops[candidates.get(a.name)![0]].u;
    const to = line.stops[candidates.get(b.name)![0]].u;
    if (from === to) return 0;
    const expected = from + (to - from) * (matched[k].s - a.s) / (b.s - a.s);
    return Math.abs(line.stops[index].u - expected) / Math.abs(to - from);
  };
  let choices: Choice[] = candidates.get(matched[0].name)!.map((index) => ({
    index, sign: 0, cost: [0, 0, 0, line.stops[index].ownCircle ? 0 : 1, residual(0, index)],
    parent: null, ambiguous: false, sequence: String(positions[index]),
  }));
  for (let k = 1; k < matched.length; k++) {
    if (matched[k].s <= matched[k - 1].s) return fail('non-increasing-arc');
    const next = new Map<string, Choice>();
    for (const index of candidates.get(matched[k].name)!) {
      for (const prev of choices) {
        const du = line.stops[index].u - line.stops[prev.index].u;
        const sign = du === 0 ? prev.sign : du > 0 ? 1 : -1;
        const choice: Choice = {
          index, sign, parent: prev, ambiguous: prev.ambiguous, sequence: `${prev.sequence},${positions[index]}`,
          cost: [
            prev.cost[0] + (du === 0 ? 1 : 0),
            prev.cost[1] + Math.max(0, Math.abs(positions[index] - positions[prev.index]) - 1),
            prev.cost[2] + (prev.sign && sign !== prev.sign ? 1 : 0),
            prev.cost[3] + (line.stops[index].ownCircle ? 0 : 1),
            prev.cost[4] + residual(k, index),
          ],
        };
        const key = `${index}:${sign}`;
        const best = next.get(key);
        if (!best || compareCost(choice, best) < 0) next.set(key, choice);
        else if (compareCost(choice, best) === 0) best.ambiguous ||= choice.ambiguous || best.sequence !== choice.sequence;
      }
    }
    choices = [...next.values()];
  }
  choices.sort(compareCost);
  const best = choices[0];
  let chosen: Choice | null = best;
  result.stops = new Array<SchemaPathStop>(matched.length);
  for (let k = matched.length - 1; k >= 0 && chosen; k--, chosen = chosen.parent) {
    result.stops[k] = { ...matched[k], u: line.stops[chosen.index].u, lineIndex: chosen.index };
  }
  for (let k = 1; k < result.stops.length; k++) {
    const du = result.stops[k].u - result.stops[k - 1].u;
    if (du === 0) continue; // two visits to one circle: a stationary chord
    const sign = du > 0 ? 1 : -1;
    const leg = result.legs.at(-1);
    if (leg && leg.to === k - 1 && leg.sign === sign) {
      leg.to = k;
      leg.stops.push(result.stops[k]);
    } else {
      result.legs.push({ from: k - 1, to: k, sign, stops: [result.stops[k - 1], result.stops[k]] });
    }
  }
  result.monotone = result.legs.length === 1 && result.legs[0].from === 0 && result.legs[0].to === matched.length - 1;
  if (choices.some((choice) => compareCost(best, choice) === 0 && (choice.ambiguous || choice.sequence !== best.sequence))) return fail('ambiguous-stops');
  if (result.legs.length === 0) return fail('no-progress');
  result.placeable = true;
  return result;
}

/** The rule (WP0; DESIGN.md takes the same sentence): a loop vehicle is
 *  drawn at the terminus circle of the loop's first stop that exists on
 *  ZET's schematic (stops[0], else stops[1]), on its own line. stops[0] is
 *  the platform its last trip ended at, stops[1] the one its next trip leaves
 *  from; the second is reached only where the artwork prints no stop of the
 *  first's name (Mandlova, the depot, which the artwork leaves out). The
 *  whole loop is one point of the artwork, so the arc does not move the
 *  vehicle, and it has no track to point along. Null exactly where
 *  matchSchemaPath says 'loop-undrawn': the line's artwork names neither
 *  stop (on feed 000395 the depot run from Mandlova to Ravnice of the lines
 *  that do not serve Ravnice: 6, 8, 13, 14, 15, 31, 33). Such a tram is not
 *  drawn on the schematic, because another line's terminus circle would
 *  misplace it; it stays on the geographic map. */
export function loopPlacement(schema: Schema, net: GraphNetwork, pathIdx: number): SchemaPlacement | null {
  const path = net.paths[pathIdx];
  if (!path || path.direction !== LOOP_PATH_DIRECTION) return null;
  const line = schema.lines.find((l) => l.route === path.route);
  if (!line) return null;
  const entry = loopEntry(line, net, path);
  return entry ? { ...pointAt(line, entry.u), sign: 1, colour: line.colour, line: line.route, chord: false } : null;
}

/** The artwork stop a loop is drawn at: stops[0], else stops[1], its own
 *  printed circle first, then a projection onto the line. */
function loopEntry(line: SchemaLine, net: GraphNetwork, path: GraphNetwork['paths'][number]): SchemaLineStop | null {
  for (const stopId of path.stops ?? []) {
    const name = net.stops.find((stop) => stop.id === stopId)?.name;
    const entry = line.stops.find((stop) => stop.name === name && stop.ownCircle) ?? line.stops.find((stop) => stop.name === name);
    if (entry) return entry;
  }
  return null;
}

/** Cached stop brackets, including cached rejection of unplaceable paths. */
export function createSchemaPlacer(schema: Schema, net: GraphNetwork): SchemaPlacer {
  const cache = new Map<number, { match: SchemaPathMatch; positions: number[] }>();
  const loops = new Map<number, SchemaPlacement | null>();
  return {
    place(pathIdx, s) {
      if (typeof pathIdx !== 'number' || !Number.isInteger(pathIdx) || pathIdx < 0 || !net.paths[pathIdx]
        || typeof s !== 'number' || !Number.isFinite(s)) return null;
      if (net.paths[pathIdx].direction === LOOP_PATH_DIRECTION) {
        if (!loops.has(pathIdx)) loops.set(pathIdx, loopPlacement(schema, net, pathIdx));
        const at = loops.get(pathIdx) ?? null;
        return at ? { ...at } : null;
      }
      let cached = cache.get(pathIdx);
      if (!cached) {
        const match = matchSchemaPath(schema, net, pathIdx);
        cached = { match, positions: match.line ? diagramPositions(match.line) : [] };
        cache.set(pathIdx, cached);
      }
      const { match, positions } = cached;
      if (!match.placeable || !match.line) return null;
      const { stops, line } = match;
      // Upper bound selects the outgoing leg at an exact turning stop.
      let lo = 0;
      let hi = stops.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (stops[mid].s <= s) lo = mid + 1;
        else hi = mid;
      }
      const k = Math.max(0, Math.min(stops.length - 2, lo - 1));
      const a = stops[k];
      const b = stops[k + 1];
      const t = Math.max(0, Math.min(1, (s - a.s) / (b.s - a.s)));
      const du = b.u - a.u;
      const sign: SchemaSign = du === 0
        ? (match.legs.find((leg) => leg.to > k) ?? match.legs.at(-1)!).sign
        : du > 0 ? 1 : -1;
      const chord = Math.abs(positions[b.lineIndex] - positions[a.lineIndex]) !== 1;
      const shared = { sign, colour: line.colour, line: line.route, chord };
      if (chord) {
        const start = pointAt(line, a.u);
        const end = pointAt(line, b.u);
        return { x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t, ...shared };
      }
      const u = a.u + du * t;
      return { ...pointAt(line, u), track: tangentAt(line, u), ...shared };
    },
  };
}
