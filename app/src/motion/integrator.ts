// The integrator: the client half of the engine (R-TE10). The twin reasons
// once per tick and publishes, per vehicle, a plan -- where along its path
// (or where in the free plane) it will be over the next minute and a half --
// plus the scalars it derived: speed, confidence, whether it is held at a
// stop, the headsign and the next stop. This file turns those plans into
// what is drawn sixty times a second, and nothing more: no map matching, no
// speed estimation, no shape guessing on the phone.
//
// Three rules survive from the old client model because they are about the
// screen, not the estimate (R-P2, R-F1): a mark converges onto a new plan,
// it never jumps; a tram's mark never runs backwards beyond a small
// correction, whatever a re-plan says; and being behind along the path is
// lag to be caught up, never an error to snap out of. A fourth is the
// screen's own copy of the ordering law (R-TE7): two marks converging at
// different rates onto plans that respect the order must not draw the
// wrong way round in between, so followers are clamped one tram length
// behind their leader on a shared path every frame.
//
// Before any plan exists (the artefact not yet loaded, a test feeding bare
// fixes, a twin that only knows the position), a fix is a point to converge
// towards in the free plane and hold at -- still never a jump.

import { dist, toPlane, type XY } from '../../../shared/motion/geo';
import { HEADWAY_M } from '../../../shared/motion/laws';
import type { GraphNetwork, Network } from '../../../shared/motion/network';
import { CONFIDENCE_FREE_CAP, EVICT_S, silenceDecay } from '../../../shared/motion/plan';
import { at, project, tangent } from '../../../shared/motion/polyline';

/** A plan as the wire decoder hands it over: knot times are absolute epoch
 *  milliseconds (fixes.ts resolves the wire's header-relative seconds), the
 *  rest as shared/motion/wire.ts defines it. */
export type FixPlan =
  | { on: 'path'; knots: readonly (readonly [tMs: number, s: number])[] }
  | { on: 'free'; knots: readonly (readonly [tMs: number, lon: number, lat: number])[] };

/** One vehicle as one poll reports it: the twin's estimate (`lon`, `lat`),
 *  the report time, the static join, the twin's scalars and its plan. A Fix
 *  without a plan is still valid input: the integrator converges onto it
 *  and holds there. */
export interface Fix {
  id: string;
  lon: number;
  lat: number;
  /** Epoch milliseconds of the vehicle's own last report; eviction counts from here. */
  at: number;
  tripId?: string;
  routeId?: string;
  /** GTFS route_type as the wire carries it (0 tram, 3 bus). */
  type?: number;
  shapeId?: string;
  direction?: 0 | 1;
  headsign?: string;
  nextStopId?: string;
  delaySeconds?: number;
  /** The geometry the plan runs on: a graph path id or a bus shape id. */
  path?: string;
  plan?: FixPlan;
  /** The twin's own estimates (R-TE1). */
  speed?: number;
  confidence?: number;
  held?: boolean;
}

export interface Drawn {
  id: string;
  routeId?: string;
  short?: string;
  type: number;
  p: XY;
  /** null means "smjer nepoznat" (decision 5): the confidence is under the threshold. */
  heading: XY | null;
  /** m/s, the twin's estimate. */
  speed: number;
  /** 0 to 1, the twin's confidence faded by the plan's age; drives alpha. */
  confidence: number;
  /** The shape index the mark rides (a bus shape, or the shape a tram path
   *  is), -1 on a synthetic path, null in the free plane. Renderers read
   *  only "null or not". */
  onShape: number | null;
  /** The geometry's own tangent at the drawn position, on geometry only. */
  track?: XY;
  /** True while the twin holds the vehicle at a stop. */
  held?: boolean;
  /** Epoch ms of the last time the mark was re-seeded onto a new geometry. */
  lastSnapAt?: number;
  /** The trip's headsign from the twin's join, when known. */
  headsign?: string;
  /** The next stop's id from the twin, when known. */
  nextStopId?: string;
}

export interface Model {
  /** Fold in a poll's fixes. Cheap; called once per poll. */
  update(fixes: readonly Fix[], now: number): void;
  /** Advance to wall-clock `now` and return what to draw. Called once per frame. */
  step(now: number): Drawn[];
  size(): number;
}

// --- Every constant has a reason; the reason is the comment. ---

/** A plan target ahead converges quickly: that is the vehicle continuing as
 *  planned. A target behind converges slowly, because a re-plan that put the
 *  vehicle further back has usually learned it stood longer than assumed,
 *  and easing back reads as a correction, not a stutter. (R-F1, ported.) */
const TAU_FORWARD_S = 1.5;
const TAU_BACKWARD_S = 4;
/** Under this gap the mark settles onto a target that is itself moving at
 *  the vehicle's speed, so the settle rate must exceed that speed or the
 *  mark could never gain on it (R-F9); above it the gap is a poll's worth
 *  of lag and the cap rises so it closes in about one poll interval (R-F1a). */
const CATCHUP_GAP_M = 50;
const SETTLE_GAIN_FACTOR = 1.5;
const SETTLE_MIN_MS = 6;
const CATCHUP_BEHIND_MIN_MS = 8;
/** A plan target glides, so the dead zone guards only floating-point
 *  jitter, not real movement; the old 15 m zone made a mark following a
 *  moving target advance in steps. */
const DEAD_ZONE_M = 1;
/** A backward correction on a tram is drawn at walking pace and never past
 *  one tram length per plan: a viewer reads that as the mark settling, and a
 *  genuine reversal cannot happen on rails (R-TE7). */
const BACKWARD_MAX_MS = 1;
const BACKWARD_BUDGET_M = 30;
/** A frame longer than this is a paused loop (a parked stage, a hidden
 *  tab), not time to catch up in one go: the mark converges from where it
 *  was over the following frames, so a resume never reads as a jump. */
const MAX_FRAME_S = 0.25;
/** Decision 5: under this the facing is undecidable and drawn as unknown. */
const HEADING_CONFIDENCE_THRESHOLD = 0.3;
/** GTFS route_type 0 is a tram; the laws apply to trams only (R-TE7). */
const ROUTE_TYPE_TRAM = 0;

/** The most the drawn arc may move in one second toward a target `gap`
 *  metres away (R-F1a, R-F9), exported for the tests that bound every frame. */
export function catchUpCap(gap: number, speed: number): number {
  return gap > CATCHUP_GAP_M ? Math.max(CATCHUP_BEHIND_MIN_MS, 2 * speed) : Math.max(SETTLE_MIN_MS, SETTLE_GAIN_FACTOR * speed);
}

interface Geometry {
  /** `p<pathIdx>` or `b<shapeIdx>`: vehicles sharing a key share a track. */
  key: string;
  pts: XY[];
  cum: number[];
  onShape: number;
}

interface VehicleState {
  id: string;
  routeId?: string;
  tripId?: string;
  short?: string;
  type: number;
  headsign?: string;
  nextStopId?: string;
  geom: Geometry | null;
  plan: FixPlan | null;
  /** When the current plan (or bare fix) arrived, epoch ms: its age fades the confidence. */
  planAt: number;
  /** Drawn arc along `geom`, and the drawn point. */
  s: number;
  p: XY;
  /** The point to converge to without geometry (a free plan, a bare fix). */
  targetP: XY;
  /** The last direction the free-plane mark moved in: its facing. */
  moveDir: XY | null;
  speed: number;
  confidence: number;
  held: boolean;
  lastFixAt: number;
  lastStepAt: number;
  /** Backward metres spent within the current plan (trams). */
  backwardUsed: number;
  lastSnapAt?: number;
  /** This frame's plan target arc, for the order clamp. */
  targetS: number;
}

function evalPath(knots: readonly (readonly [number, number])[], tMs: number): number {
  if (knots.length === 0) return 0;
  if (tMs <= knots[0][0]) return knots[0][1];
  for (let i = 1; i < knots.length; i++) {
    const [t0, s0] = knots[i - 1];
    const [t1, s1] = knots[i];
    if (tMs <= t1) return t1 === t0 ? s1 : s0 + ((tMs - t0) / (t1 - t0)) * (s1 - s0);
  }
  return knots[knots.length - 1][1];
}

function evalFree(knots: readonly (readonly [number, number, number])[], tMs: number): [number, number] {
  if (knots.length === 0) return [0, 0];
  if (tMs <= knots[0][0]) return [knots[0][1], knots[0][2]];
  for (let i = 1; i < knots.length; i++) {
    const [t0, lon0, lat0] = knots[i - 1];
    const [t1, lon1, lat1] = knots[i];
    if (tMs <= t1) {
      if (t1 === t0) return [lon1, lat1];
      const f = (tMs - t0) / (t1 - t0);
      return [lon0 + f * (lon1 - lon0), lat0 + f * (lat1 - lat0)];
    }
  }
  const last = knots[knots.length - 1];
  return [last[1], last[2]];
}

function unit(dx: number, dy: number): XY | null {
  const len = Math.hypot(dx, dy);
  return len > 0 ? { x: dx / len, y: dy / len } : null;
}

export function createIntegrator(net: Network | GraphNetwork | null): Model {
  const vehicles = new Map<string, VehicleState>();
  const graph = net && 'paths' in net ? (net as GraphNetwork) : null;
  const pathIndex = new Map<string, number>(graph ? graph.paths.map((p, i) => [p.id, i] as const) : []);
  const shapeIndex = new Map<string, number>(net ? net.shapes.map((s, i) => [s.id, i] as const) : []);
  const geometries = new Map<string, Geometry>();

  /** The geometry a plan names: a graph path first, else a bus shape, else none. */
  function resolveGeometry(pathId: string): Geometry | null {
    const pathIdx = pathIndex.get(pathId);
    if (graph && pathIdx !== undefined) {
      const key = `p${pathIdx}`;
      let geom = geometries.get(key);
      if (!geom) {
        const g = graph.pathGeometry(pathIdx);
        geom = { key, pts: g.pts, cum: g.cum, onShape: graph.paths[pathIdx].shape ?? -1 };
        geometries.set(key, geom);
      }
      return geom;
    }
    const shapeIdx = shapeIndex.get(pathId);
    if (net && shapeIdx !== undefined) {
      const key = `b${shapeIdx}`;
      let geom = geometries.get(key);
      if (!geom) {
        const shape = net.shapes[shapeIdx];
        geom = { key, pts: shape.pts, cum: shape.cum, onShape: shapeIdx };
        geometries.set(key, geom);
      }
      return geom;
    }
    return null;
  }

  function routeMeta(fix: Fix): { short?: string; type: number } {
    const route = net && fix.routeId !== undefined ? net.routes.get(fix.routeId) : undefined;
    return { short: route?.short, type: route?.type ?? fix.type ?? -1 };
  }

  /** The point a fix asks the mark to be at right now: its plan at `now`, else its estimate. */
  function targetOf(fix: Fix, geom: Geometry | null, now: number): { s: number; p: XY } {
    if (fix.plan && fix.plan.on === 'path' && geom) {
      const s = evalPath(fix.plan.knots, now);
      return { s, p: at(geom.pts, geom.cum, s) };
    }
    if (fix.plan && fix.plan.on === 'free') {
      const [lon, lat] = evalFree(fix.plan.knots, now);
      return { s: 0, p: toPlane(lon, lat) };
    }
    return { s: 0, p: toPlane(fix.lon, fix.lat) };
  }

  function applyFix(v: VehicleState | null, fix: Fix, now: number): VehicleState {
    const meta = routeMeta(fix);
    const geom = fix.plan && fix.plan.on === 'path' && fix.path !== undefined ? resolveGeometry(fix.path) : null;
    const onPath = geom !== null && fix.plan !== undefined && fix.plan.on === 'path';
    const target = targetOf(fix, geom, now);
    if (!v) {
      // Nothing drawn yet: the mark starts where the plan says it is now
      // (R-P2 concerns a mark already on screen), and moves from its first frame.
      return {
        id: fix.id,
        routeId: fix.routeId,
        tripId: fix.tripId,
        short: meta.short,
        type: meta.type,
        headsign: fix.headsign,
        nextStopId: fix.nextStopId,
        geom: onPath ? geom : null,
        plan: fix.plan ?? null,
        planAt: now,
        s: target.s,
        p: target.p,
        targetP: target.p,
        moveDir: null,
        speed: fix.speed ?? 0,
        confidence: fix.confidence ?? (fix.plan || onPath ? CONFIDENCE_FREE_CAP : 0),
        held: fix.held === true,
        lastFixAt: fix.at,
        lastStepAt: now,
        backwardUsed: 0,
        targetS: target.s,
      };
    }
    v.routeId = fix.routeId;
    v.tripId = fix.tripId;
    v.short = meta.short;
    v.type = meta.type;
    v.headsign = fix.headsign;
    v.nextStopId = fix.nextStopId;
    v.speed = fix.speed ?? 0;
    v.confidence = fix.confidence ?? CONFIDENCE_FREE_CAP;
    v.held = fix.held === true;
    v.lastFixAt = Math.max(v.lastFixAt, fix.at);
    v.planAt = now;
    v.plan = fix.plan ?? null;
    v.backwardUsed = 0;
    if (onPath) {
      if (!v.geom || v.geom.key !== geom!.key) {
        // A new geometry: the arc is re-seeded from wherever the mark is
        // drawn, so the change of mind is recorded, never shown as a jump.
        v.s = project(geom!.pts, geom!.cum, v.p).s;
        v.lastSnapAt = now;
      }
      v.geom = geom;
    } else {
      if (v.geom) v.lastSnapAt = now;
      v.geom = null;
      v.targetP = target.p;
    }
    return v;
  }

  /** Exponential convergence of the drawn arc onto the target, dead-zoned,
   *  capped, and for a tram never backwards faster than walking pace nor
   *  further than one tram length within a plan. */
  function convergeArc(v: VehicleState, target: number, dt: number): number {
    const diff = target - v.s;
    const absDiff = Math.abs(diff);
    if (absDiff < DEAD_ZONE_M || dt <= 0) return v.s;
    const tau = diff > 0 ? TAU_FORWARD_S : TAU_BACKWARD_S;
    let step = diff * (1 - Math.exp(-dt / tau));
    const maxStep = catchUpCap(absDiff, v.speed) * dt;
    if (Math.abs(step) > maxStep) step = Math.sign(step) * maxStep;
    if (step < 0 && v.type === ROUTE_TYPE_TRAM) {
      const allowed = Math.min(BACKWARD_MAX_MS * dt, Math.max(0, BACKWARD_BUDGET_M - v.backwardUsed));
      if (-step > allowed) step = -allowed;
      v.backwardUsed += -step;
    }
    return v.s + step;
  }

  /** The same convergence in the plane, for a free plan or a bare fix. */
  function convergePoint(v: VehicleState, target: XY, dt: number): void {
    const gap = dist(v.p, target);
    if (gap < DEAD_ZONE_M || dt <= 0) return;
    let step = gap * (1 - Math.exp(-dt / TAU_FORWARD_S));
    const maxStep = catchUpCap(gap, v.speed) * dt;
    if (step > maxStep) step = maxStep;
    const dir = unit(target.x - v.p.x, target.y - v.p.y);
    if (!dir) return;
    v.p = { x: v.p.x + dir.x * step, y: v.p.y + dir.y * step };
    v.moveDir = dir;
  }

  function evict(now: number): void {
    for (const [id, v] of vehicles) {
      if (now - v.lastFixAt >= EVICT_S * 1000) vehicles.delete(id);
    }
  }

  return {
    update(fixes, now) {
      for (const fix of fixes) {
        if (!Number.isFinite(fix.lon) || !Number.isFinite(fix.lat)) continue;
        const v = vehicles.get(fix.id) ?? null;
        vehicles.set(fix.id, applyFix(v, fix, now));
      }
      evict(now);
    },

    step(now) {
      evict(now);
      const out: Drawn[] = [];
      const onGeometry: VehicleState[] = [];
      for (const v of vehicles.values()) {
        const dt = Math.min(MAX_FRAME_S, Math.max(0, (now - v.lastStepAt) / 1000));
        v.lastStepAt = now;
        if (v.geom && v.plan && v.plan.on === 'path') {
          v.targetS = evalPath(v.plan.knots, now);
          v.s = convergeArc(v, v.targetS, dt);
          onGeometry.push(v);
        } else if (v.plan && v.plan.on === 'free') {
          const [lon, lat] = evalFree(v.plan.knots, now);
          const target = toPlane(lon, lat);
          const [lon1, lat1] = evalFree(v.plan.knots, now + 1000);
          const ahead = toPlane(lon1, lat1);
          v.moveDir = unit(ahead.x - target.x, ahead.y - target.y) ?? v.moveDir;
          convergePoint(v, target, dt);
        } else {
          convergePoint(v, v.targetP, dt);
        }
      }

      // The screen's copy of the ordering law (R-TE7): on one geometry, whoever
      // the plans put behind draws at least one tram length behind, whatever
      // the two marks' convergence did this frame. Plans within a tram length
      // of each other are unordered and left alone.
      const byKey = new Map<string, VehicleState[]>();
      for (const v of onGeometry) {
        if (v.type !== ROUTE_TYPE_TRAM) continue;
        const list = byKey.get(v.geom!.key) ?? [];
        list.push(v);
        byKey.set(v.geom!.key, list);
      }
      for (const list of byKey.values()) {
        list.sort((a, b) => b.targetS - a.targetS);
        for (let i = 1; i < list.length; i++) {
          const leader = list[i - 1];
          const follower = list[i];
          if (leader.targetS - follower.targetS < HEADWAY_M) continue;
          const ceiling = leader.s - HEADWAY_M;
          if (follower.s > ceiling) follower.s = Math.max(ceiling, follower.targetS - HEADWAY_M * 2);
        }
      }

      for (const v of vehicles.values()) {
        const decay = silenceDecay((now - v.planAt) / 1000);
        let confidence = v.confidence * decay;
        let rawHeading: XY | null;
        let track: XY | undefined;
        if (v.geom && v.plan && v.plan.on === 'path') {
          v.p = at(v.geom.pts, v.geom.cum, v.s);
          track = tangent(v.geom.pts, v.geom.cum, v.s);
          rawHeading = track;
        } else {
          rawHeading = v.moveDir;
          confidence = Math.min(confidence, CONFIDENCE_FREE_CAP);
        }
        confidence = Math.max(0, Math.min(1, confidence));
        const drawn: Drawn = {
          id: v.id,
          routeId: v.routeId,
          short: v.short,
          type: v.type,
          p: v.p,
          heading: confidence < HEADING_CONFIDENCE_THRESHOLD ? null : rawHeading,
          speed: v.speed,
          confidence,
          onShape: v.geom ? v.geom.onShape : null,
        };
        if (track) drawn.track = track;
        if (v.held) drawn.held = true;
        if (v.lastSnapAt !== undefined) drawn.lastSnapAt = v.lastSnapAt;
        if (v.headsign !== undefined) drawn.headsign = v.headsign;
        if (v.nextStopId !== undefined) drawn.nextStopId = v.nextStopId;
        out.push(drawn);
      }
      return out;
    },

    size() {
      return vehicles.size;
    },
  };
}
