// The twin's judgement of the city's fleet against the timetable (upgrade
// U2): what it publishes as `sources.zet.service` (shared/city/service-wire.ts).
// At every judged frame the vehicles the twin publishes (worker/twin/publish.ts
// fleetSeen) are counted against the runs the declared expectation has in
// service (shared/motion/expect.ts, the smallest over the next ten minutes),
// and the state moves with hysteresis: a condition must hold for its dwell
// before the state changes, a stale or thin frame holds the state and clears
// every dwell, and nothing is judged at all without an artefact or a calendar
// day. Pure: the memory goes in with one observation and comes out changed;
// tick.ts calls it once per tick and the state row carries it between ticks.
//
// The numbers are prep-E's, measured on six normal days and the strike days
// (review.local/upgrade/analysis: curves.md, strike-ratio.md; brief §3):
// zero false minutes on the normal days, the lowest ratio held five minutes
// 0.75, the collapse of 28 September read `reduced` at 00:12:45 and `silent`
// at 00:54:50. The product never names a cause: the state says how much of
// the timetable is on the road, not why.

import type { ServiceWireState, ZetService } from '../../shared/city/service-wire';
import { expectedAt, type ExpectIndex, type Expectation } from '../../shared/motion/expect';
import { EVICT_S } from '../../shared/motion/plan';
import type { Track } from '../../shared/motion/track';

/** No verdict below this many expected runs: the night trough (00:50 to
 *  03:55 on a weekday, 04:00 Saturday, 05:00 Sunday) declares too few
 *  vehicles for a ratio to mean anything; 30 changes no false minute and
 *  only delays the first judgement by five minutes. */
export const MIN_EXPECTED = 20;
/** The expectation is the smallest of the slot and the next ten minutes:
 *  night runs leave the feed minutes before their blocks end (decision 30).
 *  Five minutes left Sunday 27 September a margin of 0.15; fifteen delayed
 *  the collapse's `silent` past the night hold. */
export const EXPECT_LEAD_S = 600;
/** `reduced`: the city ratio below this ... */
export const REDUCED_BELOW = 0.5;
/** ... or one judged mode's own ratio below this (a tram stoppage at the
 *  weekday peak reads 0.50 for the city and never `reduced` without it) ... */
export const MODE_REDUCED_BELOW = 0.4;
/** ... for this long. Never under three minutes: after ZET's 07:15 gaps the
 *  header resumes before the positions and the ratio reads 0 for a minute. */
export const REDUCED_AFTER_S = 300;
/** `silent`: seen at most max(SILENT_FLOOR, SILENT_SHARE x expected) for SILENT_AFTER_S. */
export const SILENT_SHARE = 0.1;
export const SILENT_FLOOR = 2;
export const SILENT_AFTER_S = 600;
/** Out of `silent`: the ratio at or above this for this long. */
export const LIFT_AT = 0.25;
export const LIFT_AFTER_S = 180;
/** Back to `normal`: the city ratio at or above NORMAL_AT and every judged
 *  mode at or above MODE_NORMAL_AT for NORMAL_AFTER_S; without the mode
 *  floor a mode-only entry with a city ratio above 0.7 would flap. */
export const NORMAL_AT = 0.7;
export const MODE_NORMAL_AT = 0.6;
export const NORMAL_AFTER_S = 300;
/** Judged only while the header is at most this old (decision 18): the
 *  planner's eviction age, so every counted vehicle is one the wire shows.
 *  U0's `unconfirmed` outranks the service state on the surfaces, so a
 *  frozen feed never reads as a silent city. */
export const JUDGE_HEADER_AGE_S = EVICT_S;
/** Judged frames further apart than this break every dwell, as a hold would. */
export const CONTINUITY_S = 180;
/** In `reduced` and `silent`, a route whose own share is below this is listed. */
export const ROUTE_BELOW = 0.5;

/** The numbers of the last judged frame, as they go on the wire. */
export type ServiceNumbers = Omit<ZetService, 'state' | 'since' | 'reason' | 'operator'>;

export interface ServiceMemory {
  state: ServiceWireState;
  /** When the state was entered, epoch seconds; null until the first verdict or hold. */
  sinceSec: number | null;
  reason?: ZetService['reason'];
  /** The header time of the last judged frame. */
  judgedAtSec: number | null;
  /** Each timer holds the second its condition began, or null while it does not hold. */
  lowSince: number | null;
  silentSince: number | null;
  liftSince: number | null;
  normalSince: number | null;
  last: ServiceNumbers | null;
}

/** `unknown`, nothing judged yet: what an old state row loads and a fresh twin starts from. */
export function emptyService(): ServiceMemory {
  return { state: 'unknown', sinceSec: null, judgedAtSec: null, lowSince: null, silentSince: null, liftSince: null, normalSince: null, last: null };
}

export interface ServiceObservation {
  /** The tick's own clock, epoch seconds. */
  nowSec: number;
  /** The header time of the frame the twin holds, null before the first. */
  headerTs: number | null;
  /** True when this tick folded a new frame in (a 304 or a repeated header judges nothing). */
  newFrame: boolean;
  /** The vehicles the twin publishes as pins (publish.ts fleetSeen). */
  published: readonly Pick<Track, 'routeId' | 'kind'>[];
  expect: ExpectIndex | null;
}

/**
 * What the timetable declares at `atSec`, with the runs lowered to their
 * smallest over the next EXPECT_LEAD_S (the slot of `atSec`, then the slots
 * that follow, a later slot the calendar does not know skipped); `known`,
 * `reason` and `routes` are the first slot's.
 */
export function expectationAt(expect: ExpectIndex, atSec: number): Expectation {
  const first = expectedAt(expect, atSec);
  const blocks = { ...first.blocks };
  for (let lead = expect.slotSec; lead <= EXPECT_LEAD_S; lead += expect.slotSec) {
    const later = expectedAt(expect, atSec + lead);
    if (!later.known) continue;
    blocks.all = Math.min(blocks.all, later.blocks.all);
    blocks.tram = Math.min(blocks.tram, later.blocks.tram);
    blocks.bus = Math.min(blocks.bus, later.blocks.bus);
  }
  return { ...first, blocks };
}

const iso = (sec: number): string => new Date(sec * 1000).toISOString();
const round2 = (value: number): number => Math.round(value * 100) / 100;
const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

function clearTimers(memory: ServiceMemory): ServiceMemory {
  return { ...memory, lowSince: null, silentSince: null, liftSince: null, normalSince: null };
}

/** The memory in `state`: `sinceSec` moves to `atSec` on a change of state
 *  and on the first state a fresh memory takes, and stays otherwise. */
function settle(memory: ServiceMemory, state: ServiceWireState, atSec: number): ServiceMemory {
  const entered = state !== memory.state || memory.sinceSec === null;
  return { ...memory, state, sinceSec: entered ? atSec : memory.sinceSec };
}

/** [seen, trips in service] of every route with a trip in service whose own share is below ROUTE_BELOW. */
function routesBelow(expect: ExpectIndex, atSec: number, published: ServiceObservation['published']): Record<string, [number, number]> {
  const trips = expectedAt(expect, atSec, expect.routeType.keys()).routes;
  const seen = new Map<string, number>();
  for (const track of published) seen.set(track.routeId, (seen.get(track.routeId) ?? 0) + 1);
  const out: Record<string, [number, number]> = {};
  for (const [route, inService] of Object.entries(trips)) {
    if (inService < 1) continue;
    const count = seen.get(route) ?? 0;
    if (count / inService < ROUTE_BELOW) out[route] = [count, inService];
  }
  return out;
}

/**
 * One tick's judgement. In order: no artefact reads `unknown` (`no-artefact`);
 * no header, or one older than JUDGE_HEADER_AGE_S, holds the state with its
 * numbers and clears the dwells; a tick without a new frame changes nothing;
 * then the frame is judged at its header time: a calendar day the artefact
 * does not know reads `unknown` (`no-calendar`), fewer than MIN_EXPECTED
 * runs hold the state (`below-min`) with the numbers refreshed, and
 * otherwise the dwell timers and the transitions run as the file header
 * says. A change of state, or the first state a fresh memory takes, sets
 * `sinceSec`; a judged frame clears the reason.
 */
export function judgeService(prev: ServiceMemory, obs: ServiceObservation): ServiceMemory {
  const { nowSec, headerTs, newFrame, expect } = obs;
  if (expect === null) return settle({ ...clearTimers(prev), reason: 'no-artefact', last: null }, 'unknown', nowSec);
  if (headerTs === null || nowSec - headerTs > JUDGE_HEADER_AGE_S) return clearTimers(prev);
  if (!newFrame) return prev;

  const t = headerTs;
  const e = expectationAt(expect, t);
  const seen = obs.published.length;
  let seenTram = 0;
  let seenBus = 0;
  for (const track of obs.published) {
    if (track.kind === 'tram') seenTram++;
    else seenBus++;
  }
  const expected = e.blocks.all;
  const numbers: ServiceNumbers = {
    observedAt: iso(t),
    expected,
    seen,
    ratio: expected > 0 ? round2(seen / expected) : null,
    confidence: round2(clamp01((expected - MIN_EXPECTED) / 40) * (nowSec - t <= 30 ? 1 : 0.5)),
    baseline: 'declared',
    byMode: { tram: [seenTram, e.blocks.tram], bus: [seenBus, e.blocks.bus] },
  };
  if (!e.known) {
    // The calendar does not cover this instant: no expectation at all, so
    // the numbers carry the count and nothing to compare it with.
    const blank: ServiceNumbers = { ...numbers, expected: 0, ratio: null, confidence: 0, byMode: { tram: [seenTram, 0], bus: [seenBus, 0] } };
    return settle({ ...clearTimers(prev), reason: 'no-calendar', last: blank }, 'unknown', t);
  }
  if (expected < MIN_EXPECTED) return settle({ ...clearTimers(prev), reason: 'below-min', last: numbers }, prev.state, t);

  // Judged. Dwells continue only from a judged frame at most CONTINUITY_S ago.
  const base = prev.judgedAtSec !== null && t - prev.judgedAtSec <= CONTINUITY_S ? prev : clearTimers(prev);
  const ratio = seen / expected;
  const tramJudged = e.blocks.tram >= MIN_EXPECTED;
  const busJudged = e.blocks.bus >= MIN_EXPECTED;
  const tramRatio = tramJudged ? seenTram / e.blocks.tram : null;
  const busRatio = busJudged ? seenBus / e.blocks.bus : null;
  const low = ratio < REDUCED_BELOW || (tramRatio !== null && tramRatio < MODE_REDUCED_BELOW) || (busRatio !== null && busRatio < MODE_REDUCED_BELOW);
  const silent = seen <= Math.max(SILENT_FLOOR, SILENT_SHARE * expected);
  const lift = ratio >= LIFT_AT;
  const normal = ratio >= NORMAL_AT && (tramRatio === null || tramRatio >= MODE_NORMAL_AT) && (busRatio === null || busRatio >= MODE_NORMAL_AT);
  const since = (holds: boolean, began: number | null): number | null => (holds ? (began ?? t) : null);
  const lowSince = since(low, base.lowSince);
  const silentSince = since(silent, base.silentSince);
  const liftSince = since(lift, base.liftSince);
  const normalSince = since(normal, base.normalSince);
  const held = (began: number | null, dwell: number): boolean => began !== null && t - began >= dwell;

  let next: ServiceWireState = prev.state;
  if (prev.state === 'normal' || prev.state === 'unknown') {
    if (held(silentSince, SILENT_AFTER_S)) next = 'silent';
    else if (held(lowSince, REDUCED_AFTER_S)) next = 'reduced';
    else if (prev.state === 'unknown' && !low) next = 'normal';
  } else if (prev.state === 'reduced') {
    if (held(silentSince, SILENT_AFTER_S)) next = 'silent';
    else if (held(normalSince, NORMAL_AFTER_S)) next = 'normal';
  } else if (held(liftSince, LIFT_AFTER_S)) {
    // From `silent`; the normal timer keeps running, so a full return reads
    // `normal` NORMAL_AFTER_S after it began, not after `reduced`.
    next = 'reduced';
  }

  const last: ServiceNumbers = next === 'reduced' || next === 'silent' ? { ...numbers, routes: routesBelow(expect, t, obs.published) } : numbers;
  const { reason: _cleared, ...judged } = base;
  return settle({ ...judged, judgedAtSec: t, lowSince, silentSince, liftSince, normalSince, last }, next, t);
}

/** The memory as `sources.zet.service`; undefined until the twin has taken a
 *  state (a fresh memory under a stale header says nothing yet). */
export function serviceOnWire(memory: ServiceMemory): ZetService | undefined {
  if (memory.sinceSec === null) return undefined;
  const last: ServiceNumbers = memory.last ?? { expected: 0, seen: 0, ratio: null, confidence: 0, baseline: 'declared', byMode: { tram: [0, 0], bus: [0, 0] } };
  return {
    state: memory.state,
    since: iso(memory.sinceSec),
    ...(last.observedAt !== undefined ? { observedAt: last.observedAt } : {}),
    expected: last.expected,
    seen: last.seen,
    ratio: last.ratio,
    confidence: last.confidence,
    baseline: last.baseline,
    byMode: { tram: [...last.byMode.tram], bus: [...last.byMode.bus] },
    ...(last.routes !== undefined ? { routes: { ...last.routes } } : {}),
    ...(memory.reason !== undefined ? { reason: memory.reason } : {}),
  };
}
