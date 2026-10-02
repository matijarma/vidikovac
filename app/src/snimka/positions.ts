// Where every recorded vehicle is drawn at one replay instant. A motion
// chunk holds ten-second samples (shared/snimka-codec.ts): metres along a
// path or a shape, or a free lon/lat. Between two samples on the same
// geometry the position is linear in the arc, so a tram glides along its
// rails at any speed; on a geometry change, a missing neighbour or a hop
// over SNAP_M the mark stands on its sample and never glides across the
// city. Heading is the geometry's tangent, flipped when the arc decreases;
// a vehicle that moves under HELD_M between two samples is `held`.
//
// Everything here is pure and stateless: drawnAt() answers for one instant
// from the chunks it is handed, and createReplayModel() wraps it as the
// Model the city map steps every frame (app/src/map/city-map.ts
// CityMapDeps.createModel). The map keeps its own loop on real time; the
// model reads the replay clock itself, so the map's resync and advance
// rules never see a fast clock.
import { toLonLat, toPlane, type XY } from '../../../shared/motion/geo';
import type { GraphNetwork } from '../../../shared/motion/network';
import { at as pointAt, tangent } from '../../../shared/motion/polyline';
import { MOTION_STEP_S, MOTION_TICKS, SNIMKA_COMPARISONS, type MotionChunk, type Speed } from '../../../shared/snimka';
import { expandVehicle, type MotionSample } from '../../../shared/snimka-codec';
import type { Drawn, Model } from '../motion/integrator';
import type { GlyphMode } from '../map/overlays';
import { zagrebTimeOfDay } from './format';

/** A hop over this between two samples ten seconds apart (144 km/h) is a re-plan, not motion: snap. */
export const SNAP_M = 400;
/** Under this much movement between two samples the vehicle stands (a stop, a signal). */
export const HELD_M = 1;

/** One vehicle's identity and its 60 samples, undelta'd once per chunk. */
export interface Track { id: string; route: string | null; label: string | null; kind: 0 | 3 | null; samples: (MotionSample | null)[] }
interface Expanded { tracks: Track[]; byId: Map<string, Track> }

const expanded = new WeakMap<MotionChunk, Expanded>();

/** The chunk's vehicles with their samples undelta'd, computed once per chunk object. */
export function expandChunk(chunk: MotionChunk): { tracks: readonly Track[]; byId: ReadonlyMap<string, Track> } {
  let e = expanded.get(chunk);
  if (!e) {
    const tracks = chunk.vehicles.map((v) => ({ id: v.id, route: v.route, label: v.label, kind: v.kind, samples: expandVehicle(v) }));
    e = { tracks, byId: new Map(tracks.map((t) => [t.id, t])) };
    expanded.set(chunk, e);
  }
  return e;
}

/** The tick (0..59) and the fraction towards the next tick for an instant inside the chunk; null outside it. */
export function tickOf(chunk: Pick<MotionChunk, 't0'>, atMs: number): { tick: number; f: number } | null {
  const offset = atMs / 1000 - chunk.t0;
  if (offset < 0 || offset >= MOTION_TICKS * MOTION_STEP_S) return null;
  const tick = Math.floor(offset / MOTION_STEP_S);
  return { tick, f: (offset - tick * MOTION_STEP_S) / MOTION_STEP_S };
}

interface Geometry { pts: readonly XY[]; cum: readonly number[]; shape: number | null; path: number | null }

/** The polyline a sample rides: a path's edges as one line (on 0) or a shape (on 1); null for an index the network lacks. */
function geometryOf(net: GraphNetwork, sample: MotionSample): Geometry | null {
  if (sample.on === 2) return null;
  if (sample.on === 0) {
    const path = net.paths[sample.idx];
    if (!path) return null;
    const geo = net.pathGeometry(sample.idx);
    return { pts: geo.pts, cum: geo.cum, shape: path.shape ?? -1, path: sample.idx };
  }
  const shape = net.shapes[sample.idx];
  if (!shape) return null;
  return { pts: shape.pts, cum: shape.cum, shape: sample.idx, path: null };
}

/** A sample's place in the plane: the geometry's point at its arc, or the free fix projected. */
function planeOf(net: GraphNetwork, sample: MotionSample): XY | null {
  if (sample.on === 2) {
    const [lon, lat] = [sample.lon, sample.lat];
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
    return toPlane(lon, lat);
  }
  const geo = geometryOf(net, sample);
  return geo && geo.pts.length > 0 ? pointAt(geo.pts, geo.cum, sample.s) : null;
}

export interface Placed {
  track: Track;
  p: XY;
  /** The arc the mark stands at and the metres it moves to the next sample, on geometry only. */
  geo: Geometry | null;
  s: number;
  ds: number;
  /** True when the position is a sample, not an interpolation (a geometry change, a missing neighbour, a hop). */
  snapped: boolean;
}

/**
 * Every vehicle present at `atMs` with its interpolated place: the sample at the tick, moved `f` of the way
 * towards the sample at the next tick when both ride the same geometry and the hop is under SNAP_M; `next` is
 * the following chunk, read only for the tick after the last one.
 */
export function placedAt(current: MotionChunk, next: MotionChunk | null, atMs: number, net: GraphNetwork): Placed[] {
  const where = tickOf(current, atMs);
  if (!where) return [];
  const { tick, f } = where;
  const e = expandChunk(current);
  const following = tick + 1 < MOTION_TICKS ? null : next && next.t0 === current.t0 + MOTION_TICKS * MOTION_STEP_S ? expandChunk(next) : null;
  const out: Placed[] = [];
  for (const track of e.tracks) {
    const a = track.samples[tick];
    if (!a) continue;
    const b = tick + 1 < MOTION_TICKS ? track.samples[tick + 1] : following?.byId.get(track.id)?.samples[0] ?? null;
    const geo = geometryOf(net, a);
    if (a.on !== 2 && !geo) continue; // a geometry this network does not carry: nowhere honest to draw it
    const pa = planeOf(net, a);
    if (!pa) continue;
    if (!b || b.on !== a.on || b.idx !== a.idx) {
      out.push({ track, p: pa, geo, s: a.on === 2 ? 0 : a.s, ds: 0, snapped: true });
      continue;
    }
    if (a.on === 2 && b.on === 2) {
      const pb = planeOf(net, b);
      if (!pb || Math.hypot(pb.x - pa.x, pb.y - pa.y) > SNAP_M) { out.push({ track, p: pa, geo: null, s: 0, ds: 0, snapped: true }); continue; }
      out.push({ track, p: { x: pa.x + (pb.x - pa.x) * f, y: pa.y + (pb.y - pa.y) * f }, geo: null, s: 0, ds: Math.hypot(pb.x - pa.x, pb.y - pa.y), snapped: false });
      continue;
    }
    if (a.on === 2 || b.on === 2) continue; // unreachable: on and idx agree above; keeps the types honest
    const ds = b.s - a.s;
    if (Math.abs(ds) > SNAP_M) { out.push({ track, p: pa, geo, s: a.s, ds: 0, snapped: true }); continue; }
    const s = a.s + ds * f;
    out.push({ track, p: pointAt(geo!.pts, geo!.cum, s), geo, s, ds, snapped: false });
  }
  return out;
}

/** The drawn marks for the city map: pills, labels and palettes come from the map (vehicle-features.ts) unchanged. */
export function drawnAt(current: MotionChunk | null, next: MotionChunk | null, atMs: number, net: GraphNetwork): Drawn[] {
  if (!current) return [];
  const out: Drawn[] = [];
  for (const placed of placedAt(current, next, atMs, net)) {
    const { track, geo, p, s, ds } = placed;
    let heading: XY | null = null;
    let track_: XY | undefined;
    if (geo && geo.pts.length > 1) {
      const t = tangent(geo.pts, geo.cum, s);
      track_ = t;
      heading = ds < 0 ? { x: -t.x, y: -t.y } : t;
    }
    const drawn: Drawn = {
      id: track.id,
      type: track.kind ?? -1,
      p,
      heading,
      speed: Math.abs(ds) / MOTION_STEP_S,
      confidence: 1,
      onShape: geo ? geo.shape : null,
      held: !placed.snapped && Math.abs(ds) < HELD_M,
    };
    if (track.route !== null) drawn.routeId = track.route;
    if (track.label !== null) drawn.short = track.label;
    if (geo?.path !== null && geo?.path !== undefined) { drawn.path = geo.path; drawn.s = s; }
    if (track_) drawn.track = track_;
    out.push(drawn);
  }
  return out;
}

/** The first comparison day (Thu 24 Sep), the v1 alignment; the stage aligns to the weekday-matched day (compareInstantFor). */
const COMPARISON_MIDNIGHT_MS = SNIMKA_COMPARISONS[0].fromSec * 1000;

/** The instant of the comparison day (Thu 24 Sep) at the same Zagreb time of day as the window instant. */
export function compareInstant(atMs: number): number {
  return COMPARISON_MIDNIGHT_MS + zagrebTimeOfDay(atMs);
}

/** The instant of a given comparison day at the same Zagreb time of day as the window instant (S-12: the weekday-matched
 *  day, context.ts comparisonFor). */
export function compareInstantFor(comparison: { fromSec: number }, atMs: number): number {
  return comparison.fromSec * 1000 + zagrebTimeOfDay(atMs);
}

/** The comparison day's positions at the window instant `atMs`, aligned by time of day, as [lon, lat] for setGhosts;
 *  `compareMs` is the aligned instant when the caller aligned it already (compareInstantFor), else Thu 24 Sep's. */
export function ghostsAt(chunk: MotionChunk | null, next: MotionChunk | null, atMs: number, net: GraphNetwork, compareMs = compareInstant(atMs)): [number, number][] {
  if (!chunk) return [];
  return placedAt(chunk, next, compareMs, net).map((placed) => toLonLat(placed.p));
}

export interface ChunkPair { current: MotionChunk | null; next: MotionChunk | null }

export interface ReplayModelDeps {
  /** The replay instant, epoch milliseconds (the clock's now()). */
  now(): number;
  speed(): Speed;
  /** The Vozila layer. */
  vehiclesOn(): boolean;
  /** The chunk that holds the instant and the one after it; null while loading or when the recording has none. */
  chunksAt(ms: number): ChunkPair | null;
  net: GraphNetwork | null;
}

/** At one hour per second no vehicle is drawn (the brief's decision; the counts stay in the side column). */
export const NO_VEHICLES_SPEED: Speed = 3600;

/** Decision V3-10: from ten minutes a second, a fleet over GLYPH_DOTS_OVER vehicles draws as dots (no number, no
 *  cluster, the mode's colour); pills when paused, at one minute a second and slower, or with a fleet this small. */
export const GLYPH_DOTS_SPEED: Speed = 600;
export const GLYPH_DOTS_OVER = 12;
export function glyphModeFor(speed: Speed, playing: boolean, drawn: number): GlyphMode {
  return playing && speed >= GLYPH_DOTS_SPEED && drawn > GLYPH_DOTS_OVER ? 'dots' : 'pills';
}

/**
 * The stateless replay model the city map steps: update() and resync() do nothing (there is no evidence to fold
 * and nothing to re-seed), step() returns drawnAt() for the clock's own instant, or [] when the vehicles layer is
 * off, the chunk is missing or the speed is NO_VEHICLES_SPEED.
 */
export function createReplayModel(deps: ReplayModelDeps): Model {
  let last: Drawn[] = [];
  return {
    update() {},
    resync() {},
    step() {
      if (!deps.net || !deps.vehiclesOn() || deps.speed() === NO_VEHICLES_SPEED) { last = []; return last; }
      const t = deps.now();
      const pair = deps.chunksAt(t);
      last = pair ? drawnAt(pair.current, pair.next, t, deps.net) : [];
      return last;
    },
    size: () => last.length,
  };
}
