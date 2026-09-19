// The ordering law (R-TE7): trams on one directed track keep their order at
// every knot of their plans, a tram length apart. Physically true on a single
// track, and the one thing a viewer notices first when it is not. When fresh
// evidence contradicts the established order, the vehicle with the OLDER
// evidence gives way: a newer follower fix is a lower bound that pushes the
// stale leader's plan forward (on single track the stale leader is what is
// wrong), a newer leader fix holds the follower's plan back. A pair within a
// tram length is unordered. A vehicle without a new fix for more than two
// ticks constrains nobody (it can still be moved). A genuine swap (a tram
// short-turned or withdrawn into a siding) is conceded only after three
// consecutive contradicting fixes with the leader's last fix at a stop or at
// the end of its path, the only places a tram leaves a single track. Plans
// never run backwards: a hold or a push keeps every plan monotone.
// Buses are exempt: they overtake.

import type { GraphNetwork, Path } from './network';
// The geometry of the order -- which edge an arc is on, and how that arc
// reads on another path -- is shared with the client's own copy of this law
// (app/src/motion/integrator.ts), so it lives in order.ts (E3).
import { mapArc } from './order';
import { evalPathPlan } from './plan';
import { lastFix, type PathKnot, type Track } from './track';

/** One ZET tram: a TMK 2200 is 32 m, a Crotram low-floor 35 m over buffers. */
export const HEADWAY_M = 35;
/** Two ticks of ZET's feed: a vehicle silent this long has stale evidence and constrains nobody. */
export const SILENT_AFTER_S = 20;
/** Contradicting fixes in a row before a swap is believed. */
export const CONCESSION_FIXES = 3;
/** How near a stop or the path end the leader must be for a swap to be physically possible. */
export const CONCESSION_NEAR_STOP_M = 40;
/** Two stop spacings: fixes that contradict an established order by more
 *  than this are not a swap on single track but a relation that has stopped
 *  meaning anything (the leader began its next trip at a circuit's start, a
 *  fold flipped, a vehicle id changed hands), and it is dropped rather than
 *  enforced (R-TE52). On the live feed a follower six kilometres on was held
 *  at arc zero for minutes this way (recording of 16 Sept). */
export const SWAP_LIMIT_M = 300;

export interface OrderReport {
  pushes: number;
  holds: number;
  concessions: number;
}

interface Framed {
  track: Track;
  path: Path;
  knots: PathKnot[];
  fixSec: number;
}

function evalOn(f: Framed, tRel: number, target: Path): number | null {
  return mapArc(f.path, evalPathPlan(f.knots, tRel), target);
}

/** Inserts knots at the given relative times (interpolating the arc), so two
 *  plans compared knot by knot are compared over the same breakpoints: the
 *  difference of two piecewise-linear functions with shared breakpoints has
 *  its extremes at those breakpoints, so a constraint met at every knot is
 *  met everywhere. */
function withBreakpoints(knots: PathKnot[], timesRel: readonly number[]): void {
  for (const t of timesRel) {
    if (t < knots[0][0] || t > knots[knots.length - 1][0]) continue;
    if (knots.some((k) => k[0] === t)) continue;
    const s = evalPathPlan(knots, t);
    const at = knots.findIndex((k) => k[0] > t);
    knots.splice(at, 0, [t, s]);
  }
}

function monotone(knots: PathKnot[]): void {
  for (let i = 1; i < knots.length; i++) if (knots[i][1] < knots[i - 1][1]) knots[i][1] = knots[i - 1][1];
}

function nearStopOrEnd(net: GraphNetwork, f: Framed): boolean {
  const s = f.track.match.s;
  if (f.path.len - s <= CONCESSION_NEAR_STOP_M) return true;
  for (const entry of net.stopsOnPath(f.track.match.pathIdx!)) if (Math.abs(entry.s - s) <= CONCESSION_NEAR_STOP_M) return true;
  return false;
}

export function enforceOrder(tracks: Track[], net: GraphNetwork, nowSec: number, headerSec: number): OrderReport {
  const report: OrderReport = { pushes: 0, holds: 0, concessions: 0 };
  const framed: Framed[] = [];
  for (const track of tracks) {
    if (track.kind !== 'tram' || track.offGraph || !track.plan || track.plan.on !== 'path' || track.match.edge === null) continue;
    const fix = lastFix(track);
    if (!fix) continue;
    framed.push({ track, path: net.paths[track.plan.pathIdx], knots: track.plan.knots, fixSec: fix.atSec });
  }
  const byId = new Map(framed.map((f) => [f.track.id, f]));

  // Relations survive only while the follower's path still runs the leader's edge.
  for (const f of framed) {
    f.track.order.behind = f.track.order.behind.filter((id) => {
      const leader = byId.get(id);
      return leader !== undefined && f.path.edges.includes(leader.track.match.edge!);
    });
    for (const id of Object.keys(f.track.order.contradictions)) if (!f.track.order.behind.includes(id)) delete f.track.order.contradictions[id];
  }

  const tRelOf = (sec: number) => Math.round(sec - headerSec);

  for (let i = 0; i < framed.length; i++) {
    for (let j = i + 1; j < framed.length; j++) {
      const a = framed[i];
      const b = framed[j];
      // Same track: one's path runs the edge the other is on.
      const aOnB = b.path.edges.includes(a.track.match.edge!);
      const bOnA = a.path.edges.includes(b.track.match.edge!);
      if (!aOnB && !bOnA) continue;

      /** The order the two plans read at the header give, in a's frame; null within a headway. */
      const establish = (): [leader: Framed, follower: Framed] | null => {
        const sa = evalPathPlan(a.knots, 0);
        const sb = evalOn(b, 0, a.path);
        if (sb === null || Math.abs(sa - sb) <= HEADWAY_M) return null;
        const pair: [Framed, Framed] = sa > sb ? [a, b] : [b, a];
        pair[1].track.order.behind.push(pair[0].track.id);
        pair[1].track.order.contradictions[pair[0].track.id] = 0;
        return pair;
      };

      let leader: Framed;
      let follower: Framed;
      if (a.track.order.behind.includes(b.track.id)) {
        leader = b;
        follower = a;
      } else if (b.track.order.behind.includes(a.track.id)) {
        leader = a;
        follower = b;
      } else {
        const pair = establish();
        if (!pair) continue;
        [leader, follower] = pair;
      }

      // The two fixes themselves disagree with the order by more than a swap
      // could: the relation is stale, not the evidence (R-TE52). It is dropped
      // and the plans establish the order afresh, this same pass.
      const followerFixOnLeaderNow = mapArc(follower.path, follower.track.match.s, leader.path);
      if (followerFixOnLeaderNow !== null && followerFixOnLeaderNow - leader.track.match.s > SWAP_LIMIT_M) {
        follower.track.order.behind = follower.track.order.behind.filter((id) => id !== leader.track.id);
        delete follower.track.order.contradictions[leader.track.id];
        const pair = establish();
        if (!pair) continue;
        [leader, follower] = pair;
      }

      // Contradiction: the follower's own fix lies ahead of where the leader's plan puts the leader at that moment.
      const followerFixOnLeader = mapArc(follower.path, follower.track.match.s, leader.path);
      const leaderAtFollowerFix = evalPathPlan(leader.knots, tRelOf(follower.fixSec));
      const contradicts = followerFixOnLeader !== null && followerFixOnLeader > leaderAtFollowerFix;
      const count = (follower.track.order.contradictions[leader.track.id] ?? 0) + (contradicts ? 1 : 0);
      follower.track.order.contradictions[leader.track.id] = contradicts ? count : 0;
      if (contradicts && count >= CONCESSION_FIXES && nearStopOrEnd(net, leader)) {
        // A genuine swap: the leader was short-turned or set aside.
        follower.track.order.behind = follower.track.order.behind.filter((id) => id !== leader.track.id);
        delete follower.track.order.contradictions[leader.track.id];
        leader.track.order.behind.push(follower.track.id);
        leader.track.order.contradictions[follower.track.id] = 0;
        report.concessions++;
        [leader, follower] = [follower, leader];
      }

      const followerSilent = nowSec - follower.fixSec > SILENT_AFTER_S;
      const leaderSilent = nowSec - leader.fixSec > SILENT_AFTER_S;
      if (follower.fixSec > leader.fixSec) {
        // Newer follower evidence: push the leader ahead of it, unless the follower is itself silent.
        if (followerSilent) continue;
        withBreakpoints(leader.knots, follower.knots.map((k) => k[0]));
        let changed = false;
        for (const knot of leader.knots) {
          const required = evalOn(follower, knot[0], leader.path);
          if (required === null) continue;
          const floor = Math.min(required + HEADWAY_M, leader.path.len);
          if (knot[1] < floor) {
            knot[1] = floor;
            changed = true;
          }
        }
        if (changed) {
          monotone(leader.knots);
          report.pushes++;
        }
      } else {
        // Newer (or equal) leader evidence: hold the follower behind it, unless the leader is silent.
        if (leaderSilent) continue;
        withBreakpoints(follower.knots, leader.knots.map((k) => k[0]));
        let changed = false;
        for (const knot of follower.knots) {
          const ahead = evalOn(leader, knot[0], follower.path);
          if (ahead === null) continue;
          // Never behind the follower's own fix: that fix is evidence (R-P2), and
          // a contradiction it makes is counted above, not overwritten (R-TE52).
          const ceiling = Math.max(ahead - HEADWAY_M, follower.track.match.s);
          if (knot[1] > ceiling) {
            knot[1] = Math.max(0, ceiling);
            changed = true;
          }
        }
        if (changed) {
          monotone(follower.knots);
          report.holds++;
        }
      }
    }
  }
  return report;
}
