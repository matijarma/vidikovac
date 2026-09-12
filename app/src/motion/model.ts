// The motion model: the heart of area T and the one file that earns
// Matija's rule (12 September): "we should rely on the sparse real-time
// data, in fact we should assume that with all the latencies and such it's
// wrong, and therefore we make it a rule that we never show or care about
// the reported location, but we have a good algorithm that takes all
// available data into consideration and calculates the speed of each tram
// and bus and makes their movement smooth around the coordinates reported."
//
// So: a reported position (a Fix) is evidence, folded into a vehicle's own
// history by `update`; it is never itself drawn. `step` is the only thing
// that produces a position, and it always arrives at a new fix by
// convergence, never by jumping onto it. Being *behind* along the line it
// is already on is the model lagging, never the model being wrong, so an
// along-track gap of any size is closed by catching up (R-F1); the model is
// only ever wrong about *which* line, or where across it, and that is
// decided -- and recorded -- in selectShape, never by teleporting the mark.

import { dist, toPlane, type XY } from './geo';
import { at, project, tangent } from './polyline';
import type { Network } from './network';

export interface Fix {
  id: string;
  lon: number;
  lat: number;
  /** Epoch milliseconds -- the same clock `now` in update/step uses. */
  at: number;
  tripId?: string;
  routeId?: string;
  /** GTFS route_type as the wire carries it (R-P1, zet-rt.ts's routeType):
   *  the fallback for a route the network artefact does not know, or
   *  before/without the artefact (lightweight mode never loads it). The
   *  artefact's own answer wins when it has one. */
  type?: number;
}

export interface Drawn {
  id: string;
  routeId?: string;
  short?: string;
  type: number;
  p: XY;
  heading: XY | null; // null means "smjer nepoznat"
  speed: number; // m/s, the model's own estimate
  confidence: number; // 0 to 1, drives alpha
  onShape: number | null; // null means free-plane mode
  /** The track's own direction at the drawn position, on-shape only --
   *  the same tangent `heading` is derived from, before the confidence
   *  threshold decides whether the facing is known. A renderer that lays
   *  a tram along its rails reads this instead of re-projecting `p` onto
   *  the shape every frame. */
  track?: XY;
  /** True on a frame the stop gate is holding this vehicle at a stop. */
  held?: boolean;
  /** Epoch ms of the last time the model found itself wrong about its
   *  line (a cross-track residual past DISCREPANCY_LIMIT_M, or a shape
   *  change) and re-seeded; undefined if it never has. Never set by an
   *  along-track gap, however large -- see convergeScalar. */
  lastSnapAt?: number;
}

export interface Model {
  /** Fold in a snapshot's fixes. Cheap; called once per poll. */
  update(fixes: readonly Fix[], now: number): void;
  /** Advance to wall-clock `now` and return what to draw. Called once per frame. */
  step(now: number): Drawn[];
  size(): number;
}

// --- Every constant below has a reason (decision 3); the reason is the comment. ---

/** The probe's own ceiling: a moving vehicle covers 100-620 m per 30 s tick,
 *  i.e. well under 21 m/s; 22 m/s leaves a hair of headroom rather than
 *  clipping a real fast bus. A bad interval (GPS jitter, a skipped fix
 *  briefly inflating ds/dt) must not be read as literal evidence of a tram
 *  doing 60 km/h. */
const MAX_SPEED_MS = 22;

/** Matches the module's own `maxStale`: a fix goes 30 s stale-per-tick
 *  under ordinary skips, so under 90 s of silence the estimate is still the
 *  best evidence available and holds unchanged. */
const SILENCE_HOLD_S = 90;
/** After the hold, confidence in a speed estimate erodes -- halved every
 *  45 s, a continuous decay rather than a step function, so the drawn
 *  motion eases down rather than visibly ticking down in stages. */
const SILENCE_HALFLIFE_S = 45;
/** Past five minutes of silence the report is not "a bit old", it is gone:
 *  the vehicle is evicted from the model (R-F2) -- `size()` shrinks and
 *  nothing is drawn -- rather than flagged and carried, so a legend's
 *  denominator stays honest and per-frame cost stops growing with uptime. */
export const STALE_S = 300;

/** Below this the model does nothing: floating-point and GPS jitter must
 *  never read as motion. */
const DEAD_ZONE_M = 15;
/** A target ahead of the drawn position converges quickly -- tau 1.5 s --
 *  because that is simply the vehicle continuing to move as expected. */
const TAU_FORWARD_S = 1.5;
/** A target behind the drawn position converges slowly -- tau 4 s --
 *  because a vehicle that turns out to be further back than dead reckoning
 *  assumed has usually been stuck (traffic, a red light, a longer dwell),
 *  and easing backward reads as a correction, not a stutter. */
const TAU_BACKWARD_S = 4;
/** Under CATCHUP_GAP_M the mark settles onto a target that is itself moving
 *  at the vehicle's speed, so the settle cap must exceed that speed or the
 *  mark could never gain on it: at exactly `speed` a 15 to 50 m lag was a
 *  permanent fixture, and it was where much of the steady-state lag sat
 *  (R-F9). Half again the vehicle's speed closes the last 50 m in about
 *  ten seconds while still reading as a tram, not a dart. */
const SETTLE_GAIN_FACTOR = 1.5;
/** Even at zero estimated speed the model may still correct at up to this
 *  rate, or a genuinely stopped-but-slightly-mismatched vehicle would never
 *  visibly settle onto its own stop (R-F9 raised it from 4 alongside the
 *  factor, for the same reason: a slow estimate must still gain). */
const SETTLE_MIN_MS = 6;
/** An along-track gap wider than this is a poll interval's worth of lag
 *  (a fix delivered 25 to 45 s late, a gate that held through a dwell), not
 *  a vehicle a few metres off its mark; from here the catch-up cap rises so
 *  the gap closes in about one poll interval (R-F1a). */
const CATCHUP_GAP_M = 50;
/** The raised cap: twice the vehicle's own speed, and never under 8 m/s so
 *  a slow or freshly-stopped estimate still closes a real gap -- a 300 m
 *  lag at tram speed is gone in 15 to 20 s, one poll interval, which a
 *  person on the pavement reads as a tram catching up, not teleporting. */
const CATCHUP_BEHIND_MIN_MS = 8;
/** Beyond this the model does not know it is "a bit off" about *where
 *  across* the line it is -- it knows it is on the wrong line: past it on
 *  the current shape the assignment is dropped, past it on every candidate
 *  shape the vehicle leaves the geometry for free-plane mode. Along the
 *  line it means nothing: being behind is lag, handled by catch-up. */
const DISCREPANCY_LIMIT_M = 150;
/** How long the stop gate holds a vehicle whose dead reckoning has reached
 *  the next stop nobody has confirmed it past: one dwell -- doors open,
 *  people off and on -- after which a real tram has usually left, so the
 *  gate lets go at the full estimated speed (R-F9: a half-speed release
 *  was measured to build 87 to 375 m of lag per stop, since the fix that
 *  confirms the departure arrives 25 to 75 s after it). */
const GATE_DWELL_S = 25;
/** The evidence discount on that released motion: it is a guess about a
 *  departure nobody saw, so the mark fades by this much until a fix past
 *  the stop confirms it -- and never above STOP_GATE_CONFIDENCE_CAP, so a
 *  release cannot brighten the mark or show a heading at the exact moment
 *  the model starts guessing (R-F9). */
const GATE_RELEASE_CONFIDENCE_PENALTY = 0.2;

/** A candidate shape whose implied direction of travel disagrees with the
 *  vehicle's own last movement is probably the wrong one even when its raw
 *  projection distance is closer -- a parallel street, or the other
 *  carriageway of a divided road. 60 m is enough to swing the choice
 *  without ever overriding a genuinely large gap in raw distance. */
const DIRECTION_PENALTY_M = 60;
/** A new shape must beat the current one by more than this to take over,
 *  or the two nearly-parallel candidates a route sometimes has (a
 *  short-turn variant, a depot spur) would flap the choice fix to fix. */
const HYSTERESIS_MARGIN_M = 25;

/** How fast confidence (accumulated evidence) eases toward 1 on a fix that
 *  showed real movement, or toward 0 on one that did not: 0.6 of the
 *  remaining gap per fix, so two consecutive confirming fixes already clear
 *  the 0.3 heading threshold (0 -> 0.6 -> 0.84) -- matching how quickly a
 *  terminus turn-around must resolve. */
const CONFIDENCE_EASE = 0.6;
/** Free-plane mode has no shape to check a fix against, so its own fit can
 *  never be mistaken for a shape-verified one: confidence never exceeds this. */
const FREE_PLANE_CONFIDENCE_CAP = 0.5;
/** Held at the stop gate, the model does not know why (dwell, a closure, a
 *  terminus) it hasn't been confirmed past the stop -- and not knowing why
 *  also means not knowing which way it is still facing, so confidence is
 *  capped under the 0.3 heading threshold. */
const STOP_GATE_CONFIDENCE_CAP = 0.25;
/** Decision 5: direction is undecidable below this; heading draws as null
 *  ("smjer nepoznat") rather than guessed. */
const HEADING_CONFIDENCE_THRESHOLD = 0.3;

interface Interval {
  dt: number; // seconds
  ds: number; // metres, along-track (arc length on the shape, or straight line off it)
}

interface VehicleState {
  id: string;
  routeId?: string;
  tripId?: string;
  short?: string;
  type: number;

  intervals: Interval[]; // most recent last, capped at 3

  shapeIdx: number | null; // null = free-plane
  // The currently-chosen shape's own score, as of the last fix it won on --
  // tracked because the brief names it as part of a vehicle's state
  // (alongside shapeIdx). The hysteresis comparison itself (selectShape)
  // always recomputes both the current shape's and every candidate's score
  // fresh against the *new* fix, since comparing a stale score (from a
  // different point) against a fresh one would not be a fair contest; this
  // field is the record of what most recently won, not an input to the
  // next comparison.
  shapeScore: number;

  s: number; // current drawn arc length (on-shape only)
  targetS: number; // the target arc length from the last fix (on-shape only)
  nextStopS: number; // the stop gate: dead reckoning holds here for a dwell (on-shape only)
  followingStopS: number; // the stop after that: the released reckoning's own ceiling (on-shape only)

  // Free-plane interpolation anchors: p glides from `freeFromP` (at
  // `freeFromAt`) to `freeToP` (at `freeToAt`), then holds.
  freeFromP: XY;
  freeFromAt: number;
  freeToP: XY;
  freeToAt: number;

  p: XY; // the position the last step() call actually drew
  speed: number; // baseline estimate, m/s, before silence decay
  confidence: number; // baseline accumulated evidence, before decay/caps

  lastFixAt: number;
  lastFixLon: number;
  lastFixLat: number;
  lastFixP: XY;
  lastStepAt: number;

  /** Epoch ms of the last fix on which the model found itself wrong about
   *  its line -- a shape change, or a residual past DISCREPANCY_LIMIT_M
   *  that dropped it to free-plane -- and re-seeded from where it was
   *  drawn; undefined if it never has. Surfaced on Drawn so a test (or a
   *  reviewer) can assert that being behind never counts as being wrong. */
  lastSnapAt: number | undefined;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Decision 4: the feed repeats a stationary vehicle's coordinates
 *  byte-identically, so this fix's speed is 0 immediately -- overriding the
 *  median, which would otherwise lag behind an actual stop by up to two
 *  more fixes. */
function computeSpeed(intervals: readonly Interval[]): number {
  if (intervals.length === 0) return 0;
  if (intervals[intervals.length - 1].ds === 0) return 0;
  const speeds = intervals.map((iv) => iv.ds / iv.dt);
  return Math.min(median(speeds), MAX_SPEED_MS);
}

/** The silence-decay envelope shared by speed and confidence: unchanged
 *  under SILENCE_HOLD_S, halved every SILENCE_HALFLIFE_S after that, and
 *  driven to 0 by STALE_S (the caller enforces the hard cutoff; this alone
 *  only asymptotes toward it). */
function silenceDecay(silenceSeconds: number): number {
  if (silenceSeconds <= SILENCE_HOLD_S) return 1;
  return Math.pow(0.5, (silenceSeconds - SILENCE_HOLD_S) / SILENCE_HALFLIFE_S);
}

/** The integral of that envelope: how many seconds' worth of travel at the
 *  baseline speed a vehicle has dead-reckoned after `silenceSeconds` of
 *  silence. Reckoning with the *integral* (not the decayed speed times the
 *  whole elapsed time) is what makes the reckoned position monotonic: a
 *  speed that halves every 45 s eases the mark to a halt, it never pulls
 *  it back along the line it has already covered. */
function reckonedSeconds(silenceSeconds: number): number {
  if (silenceSeconds <= SILENCE_HOLD_S) return silenceSeconds;
  return SILENCE_HOLD_S + (SILENCE_HALFLIFE_S / Math.LN2) * (1 - silenceDecay(silenceSeconds));
}

/** The inverse: the silence after which `reckoned` seconds' worth of travel
 *  has been dead-reckoned, or Infinity when the decay halts the vehicle
 *  first (the envelope integrates to SILENCE_HOLD_S + SILENCE_HALFLIFE_S /
 *  ln 2, about 155 s of travel, and never more). */
function silenceToReckon(reckoned: number): number {
  if (reckoned <= SILENCE_HOLD_S) return reckoned;
  const remaining = 1 - ((reckoned - SILENCE_HOLD_S) * Math.LN2) / SILENCE_HALFLIFE_S;
  if (remaining <= 0) return Infinity;
  return SILENCE_HOLD_S - SILENCE_HALFLIFE_S * Math.log2(remaining);
}

/** The most the drawn arc length may move in one second toward a target
 *  `gap` metres away: the settle rate under CATCHUP_GAP_M -- half again
 *  the vehicle's speed, so the mark gains on a target moving at that speed
 *  (R-F9) -- and the raised catch-up rate beyond it (R-F1a). Exported for
 *  the tests that bound every frame of the steady-state scenario by it. */
export function catchUpCap(gap: number, speed: number): number {
  return gap > CATCHUP_GAP_M ? Math.max(CATCHUP_BEHIND_MIN_MS, 2 * speed) : Math.max(SETTLE_MIN_MS, SETTLE_GAIN_FACTOR * speed);
}

/**
 * Exponential convergence of the drawn arc length toward the target, tau
 * depending on direction, dead-zoned and catch-up-capped -- and never a
 * jump, whatever the gap: along the shape the model can only be behind or
 * ahead, never wrong (R-F1). Free-plane mode does not use this -- with no
 * shape to stay glued to, it has no "arc length" to converge and instead
 * interpolates the 2D position directly against wall-clock time (see the
 * free-plane branch in `step` below).
 */
function convergeScalar(cur: number, target: number, dtSeconds: number, speed: number): number {
  const diff = target - cur;
  const absDiff = Math.abs(diff);
  if (absDiff < DEAD_ZONE_M || dtSeconds <= 0) return cur;
  const tau = diff > 0 ? TAU_FORWARD_S : TAU_BACKWARD_S;
  const alpha = 1 - Math.exp(-dtSeconds / tau);
  let step = diff * alpha;
  const maxStep = catchUpCap(absDiff, speed) * dtSeconds;
  if (Math.abs(step) > maxStep) step = Math.sign(step) * maxStep;
  return cur + step;
}

interface ShapeCandidate {
  idx: number;
  score: number;
  proj: { s: number; d: number };
}

/** Scores every candidate shape for query point q: raw projection distance,
 *  plus DIRECTION_PENALTY_M when the shape's own tangent there disagrees
 *  with `dirVec` (the vehicle's own last movement -- undefined when there is
 *  no movement evidence yet, in which case no candidate is penalised). */
function scoreCandidates(net: Network, candidates: readonly number[], q: XY, dirVec: XY | null): ShapeCandidate[] {
  return candidates.map((idx) => {
    const shape = net.shapes[idx];
    const proj = project(shape.pts, shape.cum, q);
    let score = proj.d;
    if (dirVec) {
      const tan = tangent(shape.pts, shape.cum, proj.s);
      if (tan.x * dirVec.x + tan.y * dirVec.y < 0) score += DIRECTION_PENALTY_M;
    }
    return { idx, score, proj };
  });
}

interface Selection {
  shapeIdx: number | null;
  shapeScore: number;
  proj: { s: number; d: number } | null;
  /** True when the shape assignment actually changed this fix (a fresh
   *  pick, a hysteresis-driven switch, entering or leaving free-plane) --
   *  the caller uses this to decide whether the fix-to-fix interval is a
   *  comparable arc-length delta or must fall back to a straight line. */
  changed: boolean;
}

/** Picks the shape a vehicle should be on, applying the 25 m hysteresis
 *  margin only when there is a current shape to defend, and only when that
 *  current shape's own residual is still inside the 150 m gate. A shape
 *  whose own proj.d has already drifted past the gate is not a valid
 *  baseline to defend -- its score no longer means "this is a good fit",
 *  so measuring a switch-in candidate against it could let hysteresis
 *  block a perfectly valid sibling shape (a route can have several) purely
 *  because the vehicle's *current* assignment happened to be the one that
 *  drifted. So a current shape past the gate is treated exactly like "no
 *  current shape" and falls through to the free pick below, same as a
 *  brand new vehicle, one just past a tripId change, or one recovering
 *  from free-plane. */
function selectShape(net: Network, candidates: readonly number[], q: XY, dirVec: XY | null, prevShapeIdx: number | null): Selection {
  if (candidates.length === 0) return { shapeIdx: null, shapeScore: Infinity, proj: null, changed: prevShapeIdx !== null };

  const scored = scoreCandidates(net, candidates, q, dirVec);
  let best = scored[0];
  for (const c of scored) if (c.score < best.score) best = c;

  if (prevShapeIdx !== null) {
    const current = scored.find((c) => c.idx === prevShapeIdx);
    if (current && current.proj.d <= DISCREPANCY_LIMIT_M) {
      if (best.idx !== prevShapeIdx && best.score + HYSTERESIS_MARGIN_M < current.score && best.proj.d <= DISCREPANCY_LIMIT_M) {
        return { shapeIdx: best.idx, shapeScore: best.score, proj: best.proj, changed: true };
      }
      return { shapeIdx: prevShapeIdx, shapeScore: current.score, proj: current.proj, changed: false };
    }
  }

  if (best.proj.d <= DISCREPANCY_LIMIT_M) {
    return { shapeIdx: best.idx, shapeScore: best.score, proj: best.proj, changed: true };
  }
  // No candidate qualifies: free-plane. `changed` is true whenever there
  // was a real previous assignment (including one that just drifted past
  // the gate above) being dropped, false when it was already free-plane.
  return { shapeIdx: null, shapeScore: Infinity, proj: null, changed: prevShapeIdx !== null };
}

export function createModel(net: Network | null): Model {
  const vehicles = new Map<string, VehicleState>();

  function routeMeta(fix: Pick<Fix, 'routeId' | 'type'>): { short?: string; type: number } {
    const route = net && fix.routeId !== undefined ? net.routes.get(fix.routeId) : undefined;
    // -1: genuinely unknown, when neither the network nor the wire says --
    // never a guessed GTFS route_type that could visibly lie about tram vs.
    // bus. The wire's type is the same static GTFS the artefact was built
    // from, so it is an answer, not a guess.
    return { short: route?.short, type: route?.type ?? fix.type ?? -1 };
  }

  function nextStopCeiling(shapeIdx: number, s: number): number {
    if (!net) return Infinity;
    const shape = net.shapes[shapeIdx];
    const shapeLen = shape.cum[shape.cum.length - 1];
    return Math.min(net.nextStop(shapeIdx, s)?.s ?? shapeLen, shapeLen);
  }

  function initVehicle(fix: Fix, now: number): VehicleState {
    const p = toPlane(fix.lon, fix.lat);
    const meta = routeMeta(fix);
    const candidates = (net && fix.routeId !== undefined ? net.routes.get(fix.routeId)?.shapes : undefined) ?? [];
    let shapeIdx: number | null = null;
    let s = 0;
    let shapeScore = Infinity;
    let nextStopS = Infinity;
    let followingStopS = Infinity;
    if (net && candidates.length > 0) {
      const sel = selectShape(net, candidates, p, null, null);
      if (sel.shapeIdx !== null && sel.proj) {
        shapeIdx = sel.shapeIdx;
        shapeScore = sel.shapeScore;
        s = sel.proj.s;
        nextStopS = nextStopCeiling(shapeIdx, s);
        followingStopS = nextStopCeiling(shapeIdx, nextStopS);
      }
    }
    return {
      id: fix.id,
      routeId: fix.routeId,
      tripId: fix.tripId,
      short: meta.short,
      type: meta.type,
      intervals: [],
      shapeIdx,
      shapeScore,
      s,
      targetS: s,
      nextStopS,
      followingStopS,
      freeFromP: p,
      freeFromAt: now,
      freeToP: p,
      freeToAt: now,
      p,
      speed: 0,
      confidence: 0,
      lastFixAt: fix.at,
      lastFixLon: fix.lon,
      lastFixLat: fix.lat,
      lastFixP: p,
      lastStepAt: now,
      lastSnapAt: undefined,
    };
  }

  function applyFix(v: VehicleState, fix: Fix, now: number): void {
    if (fix.at <= v.lastFixAt) return; // no new evidence: a repeat or out-of-order fix

    if (fix.routeId !== v.routeId) {
      const meta = routeMeta(fix);
      v.short = meta.short;
      v.type = meta.type;
      v.routeId = fix.routeId;
    }

    const tripChanged = v.tripId !== undefined && fix.tripId !== undefined && v.tripId !== fix.tripId;
    v.tripId = fix.tripId;
    if (tripChanged) {
      // Decision: clear the hysteresis so a terminus turn-around is free
      // (the brief's own words). The old arc length lives in a shape whose
      // coordinate system has nothing to do with the new one, so it is
      // discarded, not carried across, along with the fix-interval history
      // (it too spans a trip boundary and is not comparable evidence).
      v.shapeIdx = null;
      v.shapeScore = Infinity;
      v.intervals = [];
      v.confidence = 0;
    }

    const newP = toPlane(fix.lon, fix.lat);
    const isStationary = fix.lon === v.lastFixLon && fix.lat === v.lastFixLat;
    const dirVec: XY | null = isStationary ? null : { x: newP.x - v.lastFixP.x, y: newP.y - v.lastFixP.y };

    // Confidence eases toward 1 on real movement, toward 0 on a repeat --
    // see CONFIDENCE_EASE.
    v.confidence = isStationary ? v.confidence * (1 - CONFIDENCE_EASE) : v.confidence + (1 - v.confidence) * CONFIDENCE_EASE;

    const candidates = (net && fix.routeId !== undefined ? net.routes.get(fix.routeId)?.shapes : undefined) ?? [];
    const sel: Selection = net
      ? selectShape(net, candidates, newP, dirVec, v.shapeIdx)
      : { shapeIdx: null, shapeScore: Infinity, proj: null, changed: v.shapeIdx !== null };

    let ds: number;
    if (isStationary) {
      ds = 0;
    } else if (!sel.changed && sel.shapeIdx !== null) {
      ds = Math.abs(sel.proj!.s - v.targetS); // same shape as before: a real arc-length delta
    } else {
      ds = dist(newP, v.lastFixP); // a shape switch, or free-plane: arc length is not comparable
    }

    const dtSeconds = (fix.at - v.lastFixAt) / 1000;
    v.intervals.push({ dt: dtSeconds, ds });
    if (v.intervals.length > 3) v.intervals.shift();
    v.speed = computeSpeed(v.intervals);

    // The one place the model can be *wrong* rather than behind: it changed
    // its mind about which line (or left the geometry because no line fits
    // within DISCREPANCY_LIMIT_M across). Recorded, never drawn as a jump:
    // the re-seeds below keep the mark continuous with where it was.
    if (sel.changed) v.lastSnapAt = now;

    if (sel.shapeIdx !== null && sel.proj) {
      if (sel.changed) {
        // A fresh assignment (new vehicle path aside): re-seed the drawn
        // arc length from wherever the vehicle is *currently drawn*
        // (continuous with free-plane or the previous shape), not from 0 --
        // only the target comes from the new evidence.
        v.s = project(net!.shapes[sel.shapeIdx].pts, net!.shapes[sel.shapeIdx].cum, v.p).s;
      }
      v.shapeIdx = sel.shapeIdx;
      v.shapeScore = sel.shapeScore;
      v.targetS = sel.proj.s;
      v.nextStopS = nextStopCeiling(sel.shapeIdx, sel.proj.s);
      v.followingStopS = nextStopCeiling(sel.shapeIdx, v.nextStopS);
    } else {
      v.shapeIdx = null;
      v.shapeScore = Infinity;
      v.freeFromP = v.p; // continuous with wherever it was actually drawn
      v.freeFromAt = now;
      v.freeToP = newP;
      v.freeToAt = now + Math.max(dtSeconds, 0) * 1000; // dtSeconds -> ms, same clock as `now`
    }

    v.lastFixAt = fix.at;
    v.lastFixLon = fix.lon;
    v.lastFixLat = fix.lat;
    v.lastFixP = newP;
  }

  /** R-F2: a vehicle silent for STALE_S is gone, not flagged. Run on every
   *  update() (the poll that did not mention it) and every step() (so a
   *  paused or failing poll cannot keep ghosts alive on screen either). */
  function evict(now: number): void {
    for (const [id, v] of vehicles) {
      if (now - v.lastFixAt >= STALE_S * 1000) vehicles.delete(id);
    }
  }

  return {
    update(fixes, now) {
      for (const fix of fixes) {
        const v = vehicles.get(fix.id);
        if (!v) {
          vehicles.set(fix.id, initVehicle(fix, now));
        } else {
          applyFix(v, fix, now);
        }
      }
      evict(now);
    },

    step(now) {
      evict(now);
      const out: Drawn[] = [];
      for (const v of vehicles.values()) {
        const dtFrame = Math.max(0, (now - v.lastStepAt) / 1000);
        v.lastStepAt = now;

        const silence = Math.max(0, (now - v.lastFixAt) / 1000);
        const decay = silenceDecay(silence);
        const effSpeed = v.speed * decay;

        let confidence = v.confidence * decay;
        let heldByGate = false;
        let rawHeading: XY | null;
        let track: XY | undefined;

        if (v.shapeIdx !== null && net) {
          const shape = net.shapes[v.shapeIdx];
          const shapeLen = shape.cum[shape.cum.length - 1];
          // Dead reckoning: the baseline speed over the decay envelope's
          // integral (reckonedSeconds), so the reckoned position only ever
          // advances and eases to a halt as the silence grows.
          const reckoned = reckonedSeconds(silence);
          const rawDeadReckon = v.targetS + v.speed * reckoned;
          const gate = Math.min(v.nextStopS, shapeLen);
          let effTarget = rawDeadReckon;
          if (rawDeadReckon > gate && v.speed > 0) {
            // Reckoning reached the next stop this many seconds ago. For one
            // dwell the gate holds the vehicle there; after that it lets go
            // at the estimated speed -- along the same envelope, from the
            // moment the dwell ended -- still never past the stop after it
            // (R-F1b, R-F9).
            const reachedAt = silenceToReckon((gate - v.targetS) / v.speed);
            const heldFor = silence - reachedAt;
            if (heldFor <= GATE_DWELL_S) {
              effTarget = gate;
              heldByGate = true;
            } else {
              const following = Math.min(v.followingStopS, shapeLen);
              const released = gate + v.speed * (reckoned - reckonedSeconds(reachedAt + GATE_DWELL_S));
              if (released >= following) {
                effTarget = following;
                heldByGate = true;
              } else {
                effTarget = released;
                // A guess about a departure nobody saw reads no more certain
                // than the hold it follows.
                confidence = Math.min(confidence - GATE_RELEASE_CONFIDENCE_PENALTY, STOP_GATE_CONFIDENCE_CAP);
              }
            }
          }
          v.s = convergeScalar(v.s, effTarget, dtFrame, effSpeed);
          v.p = at(shape.pts, shape.cum, v.s);
          track = tangent(shape.pts, shape.cum, v.s);
          rawHeading = track;
        } else {
          const span = v.freeToAt - v.freeFromAt;
          const frac = span <= 0 ? 1 : Math.min(1, Math.max(0, (now - v.freeFromAt) / span));
          v.p = { x: v.freeFromP.x + (v.freeToP.x - v.freeFromP.x) * frac, y: v.freeFromP.y + (v.freeToP.y - v.freeFromP.y) * frac };
          const dx = v.freeToP.x - v.freeFromP.x;
          const dy = v.freeToP.y - v.freeFromP.y;
          const len = Math.hypot(dx, dy);
          rawHeading = len > 0 ? { x: dx / len, y: dy / len } : null;
          confidence = Math.min(confidence, FREE_PLANE_CONFIDENCE_CAP);
        }

        if (heldByGate) confidence = Math.min(confidence, STOP_GATE_CONFIDENCE_CAP);
        confidence = Math.max(0, Math.min(1, confidence));
        const heading = confidence < HEADING_CONFIDENCE_THRESHOLD ? null : rawHeading;

        const drawn: Drawn = {
          id: v.id,
          routeId: v.routeId,
          short: v.short,
          type: v.type,
          p: v.p,
          heading,
          speed: effSpeed,
          confidence,
          onShape: v.shapeIdx,
        };
        if (track) drawn.track = track;
        if (heldByGate) drawn.held = true;
        if (v.lastSnapAt !== undefined) drawn.lastSnapAt = v.lastSnapAt;
        out.push(drawn);
      }
      return out;
    },

    size() {
      return vehicles.size;
    },
  };
}
