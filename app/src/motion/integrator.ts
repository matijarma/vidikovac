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
// it never jumps; a mark never runs backwards at all, whatever a re-plan
// says, and a target behind it is a hold until the plan catches up; and
// being behind along the path is lag to be caught up, never an error to
// snap out of. That is the owner's rule for this round -- bias behind,
// never ahead; catch up forwards; hold when contradicted -- because a mark
// behind the real tram reads as GPS lagging, while a mark ahead that has to
// come back reads as a broken app.
//
// A fourth is the screen's own copy of the ordering law (R-TE7): two marks
// converging at different rates onto plans that respect the order must not
// draw the wrong way round in between, so a follower's convergence is
// capped one tram length behind its leader every frame -- on any two paths
// that share the rails, not only on one geometry, and in the order the twin
// published (the wire's own leader) rather than whatever this frame's plans
// happen to say.
//
// Before any plan exists (the artefact not yet loaded, a test feeding bare
// fixes, a twin that only knows the position), a fix is a point to converge
// towards in the free plane and hold at -- still never a jump.

import { dist, toPlane, type XY } from '../../../shared/motion/geo';
import { ARC_PRIOR_WEIGHT, BACK_WINDOW_M, OFF_GRAPH_M, REACH_SLACK_M } from '../../../shared/motion/match';
import type { GraphNetwork, Network } from '../../../shared/motion/network';
import { edgeIndexAt, HEADWAY_M, mapArc, mapArcNear, onSharedRails, SWAP_LIMIT_M } from '../../../shared/motion/order';
import { CONFIDENCE_FREE_CAP, EVICT_S, silenceDecay } from '../../../shared/motion/plan';
import { at, projectionsWithin, tangent } from '../../../shared/motion/polyline';
import { REDUCED_MOTION_INTERVAL_MS } from './loop';

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
  /** The vehicle id of the tram this one is behind, from the twin's own
   *  ordering register (E3). The client never derives the relation itself
   *  while the wire names one: roles change when the register says so, not
   *  because two plans crossed between polls. */
  behind?: string;
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
  /** Graph path and post-order-clamp arc (metres), for alternate map
   *  projections. Absent for a bus shape or a free-plane estimate. */
  path?: number;
  s?: number;
  /** The geometry's own tangent at the drawn position, on geometry only. */
  track?: XY;
  /** True while the twin holds the vehicle at a stop. */
  held?: boolean;
  /** True while the mark may not move: its own plan puts it behind where it
   *  is drawn, or the tram ahead leaves it no room. Drawn nowhere this
   *  round; it is what a hold is called instead of a step backwards. */
  holding?: true;
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
 *  planned. There is no backward counterpart any more: a target behind the
 *  mark is a hold (F9), because easing back at any rate is still a vehicle
 *  drawn going the wrong way. (R-F1, ported.) */
const TAU_FORWARD_S = 1.5;
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
/** A frame longer than this is a paused loop (a parked stage, a hidden
 *  tab), not time to catch up in one go: the mark converges from where it
 *  was over the following frames, so a resume never reads as a jump. The cap
 *  is the reduced-motion loop's own tick (loop.ts), and must stay so: that
 *  path draws once a second, and a tick that integrates only a quarter of
 *  the second it covers leaves every mark further behind its plan after
 *  every tick, for ever. */
const MAX_FRAME_S = REDUCED_MOTION_INTERVAL_MS / 1000;
/** Decision 5: under this the facing is undecidable and drawn as unknown. */
const HEADING_CONFIDENCE_THRESHOLD = 0.3;
/** GTFS route_type 0 is a tram; the ordering law applies to trams only
 *  (R-TE7). A vehicle the wire gave no route type at all reads as -1, and is
 *  a tram too wherever its plan runs a graph path: only a tram is planned
 *  along the rails. */
const ROUTE_TYPE_TRAM = 0;
const ROUTE_TYPE_UNKNOWN = -1;
/** The window a re-seed onto a new geometry searches, around the arc the new
 *  plan puts the vehicle at: the mark may be a poll's worth of catch-up
 *  behind that plan (CATCHUP_GAP_M) plus the platform scatter the matcher
 *  allows itself (BACK_WINDOW_M), and never far ahead of it, since it only
 *  ever converges forwards onto it (REACH_SLACK_M). */
const RESEED_BACK_M = BACK_WINDOW_M + CATCHUP_GAP_M;
const RESEED_AHEAD_M = REACH_SLACK_M;

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
  path: number | null;
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
  /** True while this frame's convergence had to leave the mark where it is. */
  holding: boolean;
  /** The vehicle this one is behind, as the wire last said (null: the wire
   *  names none). Sticky between polls, and never written from the plans. */
  leader: string | null;
  lastFixAt: number;
  lastStepAt: number;
  lastSnapAt?: number;
  /** This frame's plan target arc and integration step: scratch the order
   *  clamp reads, written once a frame before anything converges. */
  targetS: number;
  stepDt: number;
  /** The clamp's own per-frame scratch, fields rather than a frame's worth of
   *  maps and sets: the index of the edge the mark is drawn on, the leaders it
   *  must stay behind (reused in place, never reallocated), and the sweep's
   *  mark -- 0 not reached, 1 on the stack, 2 converged. Sixty frames a second
   *  with two hundred marks is not the place to make rubbish. */
  edgeK: number;
  aheadOf: VehicleState[];
  sweep: number;
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
        geom = { key, pts: g.pts, cum: g.cum, onShape: graph.paths[pathIdx].shape ?? -1, path: pathIdx };
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
        geom = { key, pts: shape.pts, cum: shape.cum, onShape: shapeIdx, path: null };
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
        holding: false,
        leader: fix.behind ?? null,
        lastFixAt: fix.at,
        lastStepAt: now,
        targetS: target.s,
        stepDt: 0,
        edgeK: 0,
        aheadOf: [],
        sweep: 0,
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
    // The order comes from the twin's register alone (E3): a poll that names
    // no leader is the register saying there is none, and between polls the
    // relation stands whatever the plans do.
    v.leader = fix.behind ?? null;
    v.lastFixAt = Math.max(v.lastFixAt, fix.at);
    v.planAt = now;
    v.plan = fix.plan ?? null;
    if (onPath) {
      if (!v.geom || v.geom.key !== geom!.key) {
        // A new geometry: the arc is re-seeded from wherever the mark is
        // drawn, so the change of mind is recorded, never shown as a jump.
        v.s = reseedArc(v.geom, geom!, v.s, v.p, target.s);
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

  /**
   * Where a mark's arc lands when its geometry changes under it (E1): the
   * same arc mapped exactly when the new path runs the edge the mark is on,
   * and otherwise the nearest point on the new geometry within a WINDOW
   * around where the new plan puts the vehicle now. What this replaces is a
   * global nearest point, and the reason is the reason the matcher refuses
   * one too (R-TE45): on a loop or a balloon the two rails pass within a few
   * metres of each other and a whole circuit apart along the path, so the
   * nearest point on the ground is regularly the wrong one, and a mark that
   * lands on it is a tram drawn a kilometre from where it is.
   */
  function reseedArc(from: Geometry | null, to: Geometry, s: number, p: XY, expected: number): number {
    if (graph && from && from.path !== null && to.path !== null) {
      const mapped = mapArc(graph.paths[from.path], s, graph.paths[to.path]);
      if (mapped !== null) return mapped;
    }
    const sFrom = expected - RESEED_BACK_M;
    const sTo = expected + RESEED_AHEAD_M;
    const window =
      graph && to.path !== null
        ? graph.projectionsOntoPath(to.path, p, sFrom, sTo, OFF_GRAPH_M)
        : projectionsWithin(to.pts, to.cum, p, sFrom, sTo, OFF_GRAPH_M).map((proj) => ({ s: proj.s, d: proj.d }));
    // Nothing on the new geometry within the window leaves the plan's own
    // arc, which is the twin's matched position: still evidence, and still
    // not a point picked by centimetres of scatter half a circuit away.
    let best = expected;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const candidate of window) {
      // The matcher's own score (match.ts): the residual, plus what an arc
      // costs for lying away from where the vehicle is expected to be.
      const score = candidate.d + ARC_PRIOR_WEIGHT * Math.abs(candidate.s - expected);
      if (score < bestScore) {
        best = candidate.s;
        bestScore = score;
      }
    }
    return best;
  }

  /** Exponential convergence of the drawn arc onto the target: forwards
   *  only, dead-zoned, capped by catchUpCap, and never past `ceiling` -- the
   *  arc the order leaves this mark this frame. A mark whose target lies
   *  behind it, or whose ceiling does, holds where it is until the plan (or
   *  the tram ahead) catches up. A vehicle on a geometry cannot reverse, and
   *  a mark that comes back does not read as a correction; it reads as an
   *  app that got it wrong. */
  function convergeArc(v: VehicleState, target: number, dt: number, ceiling: number): number {
    const diff = target - v.s;
    const room = ceiling - v.s;
    v.holding = diff < -DEAD_ZONE_M || (diff > DEAD_ZONE_M && room <= 0);
    if (diff < DEAD_ZONE_M || dt <= 0) return v.s;
    let step = diff * (1 - Math.exp(-dt / TAU_FORWARD_S));
    const maxStep = catchUpCap(diff, v.speed) * dt;
    if (step > maxStep) step = maxStep;
    if (step > room) step = Math.max(0, room);
    return v.s + step;
  }

  /** The same convergence in the plane, for a free plan or a bare fix. The
   *  mark may only close on a target lying ahead of it along the direction
   *  the target itself is travelling -- the free plan's own forward
   *  direction, or the last direction the mark moved when the twin sends
   *  nothing but a position -- and a target behind it is a hold. A bus
   *  reversing at eight metres a second reads as wrong as a tram doing it. */
  function convergePoint(v: VehicleState, target: XY, dt: number): void {
    const gap = dist(v.p, target);
    const dir = unit(target.x - v.p.x, target.y - v.p.y);
    if (!dir || gap < DEAD_ZONE_M || dt <= 0) return;
    if (v.moveDir && dir.x * v.moveDir.x + dir.y * v.moveDir.y < 0) {
      v.holding = true;
      return;
    }
    let step = gap * (1 - Math.exp(-dt / TAU_FORWARD_S));
    const maxStep = catchUpCap(gap, v.speed) * dt;
    if (step > maxStep) step = maxStep;
    v.p = { x: v.p.x + dir.x * step, y: v.p.y + dir.y * step };
    v.moveDir = dir;
  }

  /** Is this one a vehicle the ordering law speaks of? A tram, and a vehicle
   *  whose route type the wire never named but whose plan runs a graph path,
   *  which on this network is the same thing. */
  function onRails(v: VehicleState): boolean {
    return v.geom !== null && v.geom.path !== null && (v.type === ROUTE_TYPE_TRAM || v.type === ROUTE_TYPE_UNKNOWN);
  }

  // The clamp's working set, kept between frames so a frame allocates
  // nothing of its own: the marks on rails, the marks on each edge, and the
  // edges that have a mark on them at all (which is what gets cleared).
  const onRailsNow: VehicleState[] = [];
  const byEdge = new Map<number, VehicleState[]>();
  const edgesUsed: number[] = [];

  function add(follower: VehicleState, leader: VehicleState): void {
    if (!follower.aheadOf.includes(leader)) follower.aheadOf.push(leader);
  }

  /**
   * Every leader each mark must stay behind this frame, written onto the
   * marks themselves, from two sources in strict order. First the twin's own
   * register, published per vehicle and held between polls: while it names a
   * leader, nothing else may name one for that vehicle, so an order cannot
   * flip because two plans crossed between two polls. Then, only for a pair
   * the register has placed neither side of, this frame's plans -- all the
   * client has to go on until the twin publishes the order, and the same rule
   * the law itself uses: a pair within one tram length is unordered.
   *
   * The index is by the edge each mark is drawn on, looked up one edge either
   * side along the mark's own path. A ceiling one tram length back can only
   * bind between marks that close together, so a partner is looked for there
   * and nowhere else: two hundred marks on screen would otherwise be twenty
   * thousand pair tests every frame. Every pair the index offers already
   * satisfies onSharedRails one way round -- the bucket is on this mark's own
   * path -- and the test is still made, cheap end first, because the rule is
   * the pairing test and not the index.
   */
  function buildOrder(list: readonly VehicleState[]): void {
    onRailsNow.length = 0;
    for (const v of list) {
      v.aheadOf.length = 0;
      v.sweep = 0;
      if (onRails(v)) onRailsNow.push(v);
    }
    if (!graph || onRailsNow.length < 2) return;

    for (const edge of edgesUsed) byEdge.get(edge)!.length = 0;
    edgesUsed.length = 0;
    for (const v of onRailsNow) {
      const path = graph.paths[v.geom!.path!];
      v.edgeK = edgeIndexAt(path, v.s);
      const edge = path.edges[v.edgeK];
      let here = byEdge.get(edge);
      if (!here) {
        here = [];
        byEdge.set(edge, here);
      }
      if (here.length === 0) edgesUsed.push(edge);
      here.push(v);
    }

    for (const v of onRailsNow) {
      if (v.leader === null) continue;
      const leader = vehicles.get(v.leader);
      if (!leader) {
        v.leader = null; // the leader fell silent and was evicted: the relation ends with it
        continue;
      }
      if (onRails(leader)) add(v, leader);
    }

    for (const a of onRailsNow) {
      if (a.leader !== null) continue;
      const pathA = graph.paths[a.geom!.path!];
      for (let n = a.edgeK - 1; n <= a.edgeK + 1; n++) {
        if (n < 0 || n >= pathA.edges.length) continue;
        const bucket = byEdge.get(pathA.edges[n]);
        if (!bucket) continue;
        for (const b of bucket) {
          if (b === a || b.leader !== null) continue;
          // A pair reached from both sides is written twice and `add` keeps
          // it once, which is cheaper than a set of pair keys per frame.
          const pathB = graph.paths[b.geom!.path!];
          if (!onSharedRails({ path: pathB, s: b.s }, { path: pathA, s: a.s })) continue;
          // The two plans read in one frame; a pair whose paths have diverged
          // at both arcs has no common frame and no order to keep.
          let planA = a.targetS;
          let planB = pathA === pathB ? b.targetS : mapArc(pathB, b.targetS, pathA);
          if (planB === null) {
            const mapped = mapArc(pathA, a.targetS, pathB);
            if (mapped === null) continue;
            planA = mapped;
            planB = b.targetS;
          }
          if (Math.abs(planA - planB) < HEADWAY_M) continue;
          if (planA > planB) add(b, a);
          else add(a, b);
        }
      }
    }
  }

  /** The arc a mark may not pass this frame: one tram length behind the
   *  nearer of its leader's own mark and its leader's plan, read on the
   *  follower's path. A leader whose arc does not map onto that path
   *  constrains nothing -- the two have diverged there, and a constraint
   *  that cannot be stated in the follower's frame is not one. */
  function ceilingFor(v: VehicleState): number {
    let ceiling = Number.POSITIVE_INFINITY;
    for (const leader of v.aheadOf) {
      const ahead = Math.min(leader.s, leader.targetS) - HEADWAY_M;
      const here = leader.geom!.path === v.geom!.path ? ahead : mapArc(graph!.paths[leader.geom!.path!], ahead, graph!.paths[v.geom!.path!]);
      if (here !== null && here < ceiling) ceiling = here;
    }
    return ceiling;
  }

  /** Converges one mark after every leader it must stay behind, marking as it
   *  goes: a mark already on the stack is the relation that closes a cycle,
   *  and it is the one dropped. */
  function convergeInOrder(v: VehicleState): void {
    if (v.sweep !== 0) return;
    v.sweep = 1;
    for (const leader of v.aheadOf) convergeInOrder(leader);
    v.sweep = 2;
    v.s = convergeArc(v, v.targetS, v.stepDt, v.aheadOf.length > 0 ? ceilingFor(v) : Number.POSITIVE_INFINITY);
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
      // Nothing on a geometry moves in this pass: the order clamp is an upper
      // bound on a follower's step, so it has to be known before that
      // follower converges, and it is read off the leader's arc for this
      // frame. Free-plane marks have no order to keep and converge at once.
      for (const v of vehicles.values()) {
        const dt = Math.min(MAX_FRAME_S, Math.max(0, (now - v.lastStepAt) / 1000));
        v.lastStepAt = now;
        v.stepDt = dt;
        v.holding = false;
        if (v.geom && v.plan && v.plan.on === 'path') {
          v.targetS = evalPath(v.plan.knots, now);
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

      // The screen's copy of the ordering law (R-TE7), applied THROUGH the
      // convergence and never as a write: leaders converge first, and every
      // follower then converges with its leader's arc for this frame as its
      // ceiling, so a mark that would have to come back to respect the order
      // holds instead. The sweep enters in id order, which is also how a
      // cycle in the published order is broken: at the relation that closes
      // it, the same one every frame.
      onGeometry.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      buildOrder(onGeometry);
      for (const v of onGeometry) convergeInOrder(v);

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
        if (v.geom && v.geom.path !== null) {
          drawn.path = v.geom.path;
          drawn.s = v.s;
        }
        if (v.held) drawn.held = true;
        if (v.holding) drawn.holding = true;
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
