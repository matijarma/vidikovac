// The speed a vehicle is judged to be cruising at, from its own fixes: the
// median of the last three moving intervals whose ends lie clear of any
// platform. A port of model.ts's R-F10 with the standing time measured
// where it can be and left alone where it cannot: at ZET's 10 s tick a stop
// shows up as its own run of near-identical fixes, so an interval that ends
// at a platform holds an unknown share of standing time that can be the
// whole interval, and no charge would read it right. Such intervals are
// skipped; with none left the estimate is 0 and the planner falls back to
// the timetable's speed for the stretch, which beats a guess dressed as a
// measurement.

import { dist } from './geo';
import type { PlaneFix } from './track';

/** Below this two fixes are the same place: GPS scatter and rounding must
 *  never read as motion (model.ts, decision 4). */
export const DEAD_ZONE_M = 15;

/** A ZET vehicle covers 100 to 620 m per 30 s tick, well under 21 m/s;
 *  22 leaves a hair of headroom and refuses a skipped fix's inflated ratio. */
export const MAX_SPEED_MS = 22;

/** Three moving intervals: enough for a median to drop one bad ratio, few
 *  enough to follow a tram from cruise into a slow zone within a minute. */
export const SPEED_INTERVALS = 3;

/** A fix within this of a stop was taken at the platform: the interval on
 *  either side of it holds an unknown share of standing time, which read a
 *  cruising tram as 5 to 7 m/s (F6's measurement behind R-F10). */
export const STOP_ZONE_M = 40;

/** Doors open, people off and on: the standing time charged for a stop that
 *  lies strictly inside an interval, which the tram must have stood at
 *  (R-F10). Only long intervals, with a fix skipped, can contain one. */
export const DWELL_CHARGE_S = 20;

/** Never charge more than two thirds of an interval: the moving part is at
 *  least a third of the measured duration, so a stop crossed on a short
 *  interval cannot make a tram look three times faster than it is (R-F10). */
const MOVING_SHARE_FLOOR = 1 / 3;

/** An interval shorter than this cannot hide a dwell (R-TE50): at ZET's
 *  10 s tick a vehicle that stood at the platform would have been reported
 *  there, and that interval is skipped as platform-touching above; a stop
 *  passed within two ticks was passed, not dwelt at. Charging it read
 *  buses at 15 to 22 m/s on the live feed (recording of 16 Sept). */
export const CHARGEABLE_INTERVAL_S = 25;

export interface SpeedContext {
  /** The stops that lie strictly between two arcs on the geometry `key`, by
   *  id: the platforms the line CALLS AT there (graph.ts stopsOnPath), never
   *  every platform the rails pass. Before F8 this counted the opposite
   *  direction's platform and other lines' too, and charged a dwell for each. */
  stopsBetween(key: string, fromS: number, toS: number): string[];
  /** The dwell to charge at a given stop: the timetable's or a learned one
   *  (F8). Where it answers nothing, `dwellSec` stands in, and failing that
   *  the flat DWELL_CHARGE_S. */
  dwellOf?: (stopId: string) => number;
  /** One dwell for every stop, where nothing knows them apart. */
  dwellSec?: number;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** m/s, or 0 when the history holds no interval to trust, and 0 for a
 *  vehicle whose recent intervals say it is standing (F11). Distance is the
 *  arc along the matched geometry when both fixes were placed on the same
 *  one (a chord across a curve underestimates), the straight line otherwise. */
export function estimateSpeed(fixes: readonly PlaneFix[], ctx?: SpeedContext): number {
  const flatDwell = ctx?.dwellSec ?? DWELL_CHARGE_S;
  const dwellAt = (stopId: string): number => {
    const own = ctx?.dwellOf?.(stopId);
    return own !== undefined && Number.isFinite(own) && own >= 0 ? own : flatDwell;
  };
  const ratios: number[] = [];
  // Where the platforms are so dense that no interval is clear of a stop
  // zone (the inner city at ZET's 10 s tick), the vehicle's own recent pace
  // over its moving intervals, standing time and all, still says more about
  // the next quarter minute than the timetable's average does (R-TE51). Each
  // such pace is a lower bound on the cruise (the interval may hold a stand),
  // so the tightest of the recent ones speaks, never a guess dressed as a
  // measurement.
  const pace: number[] = [];
  for (let i = 1; i < fixes.length; i++) {
    const a = fixes[i - 1];
    const b = fixes[i];
    const sameGeometry = a.arc !== undefined && b.arc !== undefined && a.arc.key === b.arc.key;
    const ds = sameGeometry ? Math.abs(b.arc!.s - a.arc!.s) : dist(a, b);
    const dt = b.atSec - a.atSec;
    if (dt <= 0) continue;
    if (ds < DEAD_ZONE_M) {
      // F11: an interval that covered less than the dead zone is not an
      // interval we know nothing about -- it is evidence of a speed near
      // zero, and skipping it left a tram that cruised and then stopped
      // holding its old cruise for as long as it stood. The planner's first
      // stretch then ran at a speed measured BEFORE the last stop (D8). Two
      // such intervals are enough to pull the median of three to zero, and
      // the planner falls back to what the stretch usually takes.
      ratios.push(0);
      pace.push(0);
      continue;
    }
    pace.push(ds / dt);
    if (a.arc?.atStop || b.arc?.atStop) continue;
    let charged = 0;
    if (sameGeometry && ctx && dt >= CHARGEABLE_INTERVAL_S) {
      const lo = Math.min(a.arc!.s, b.arc!.s) + DEAD_ZONE_M;
      const hi = Math.max(a.arc!.s, b.arc!.s) - DEAD_ZONE_M;
      if (hi > lo) for (const stopId of ctx.stopsBetween(a.arc!.key, lo, hi)) charged += dwellAt(stopId);
    }
    const moving = Math.max(dt - charged, dt * MOVING_SHARE_FLOOR);
    ratios.push(ds / moving);
  }
  const recent = ratios.slice(-SPEED_INTERVALS);
  if (recent.length > 0) return Math.min(median(recent), MAX_SPEED_MS);
  const recentPace = pace.slice(-SPEED_INTERVALS);
  if (recentPace.length === 0) return 0;
  return Math.min(Math.max(...recentPace), MAX_SPEED_MS);
}
