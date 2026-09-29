// The one reading of ZET's service state that every surface shares (upgrade
// 2026-10 §5.2, U0 step 5): the wall's list and header sentence, the phone's
// Sada list and sentence, the kiosk's touch board and map note all ask here,
// so a frozen feed reaches every screen as the same state at the same second.
//
// U0 fills three states: `loading` (no snapshot yet), `down` (the module's own
// status) and `unconfirmed` (the source is older than three minutes). Every
// other snapshot is `unknown`: U0 has no expectation of how many vehicles
// should be running, so it never claims `normal`. U2 adds `silent`, `reduced`
// and `normal` and the `live-only` voice from `sources.zet.service` by changing
// the function bodies only; the signatures are the seam and stay.
//
// Why three minutes: at 180 s the twin has evicted every fix (plan.ts EVICT_S),
// so "no positions" is true when the note shows. ZET's own 30-second stale flag
// (`sources.zet.status === 'stale'`) is not read: it fires four to nine times on
// a normal weekday. The one ZET-side gap over 180 s of a normal weekday (around
// 07:15) may honestly show the note.
import type { ModuleSnapshot } from '../../worker/feed/schema';
import type { ZetService } from './service-wire';

export type ServiceStateKind = 'loading' | 'down' | 'unconfirmed' | 'silent' | 'reduced' | 'normal' | 'unknown';

export interface ServiceState {
  kind: ServiceStateKind;
  /** When the state began, epoch ms: `sourceAt + UNCONFIRMED_AFTER_MS` for unconfirmed; null when not known. */
  since: number | null;
}

/** Which departures a surface may say in its header sentence: every one, only those a vehicle confirms, or none. */
export type DepartureVoice = 'all' | 'live-only' | 'none';

/**
 * A source older than this is unconfirmed. Equal to shared/motion/plan.ts EVICT_S × 1000 (the twin's eviction),
 * written as a literal so the phone's first screen does not carry the planner (test/city/service-state.test.ts
 * pins the two equal).
 */
export const UNCONFIRMED_AFTER_MS = 180_000;
/** Once entered, unconfirmed holds at least this long, so a feed that flickers back for a frame does not flicker the note. */
export const UNCONFIRMED_HOLD_MS = 60_000;

/**
 * The one memory of the seam: the frozen source time that entered `unconfirmed` and the instant it did, so the
 * state holds UNCONFIRMED_HOLD_MS from its entry even when a fresh snapshot arrives earlier. One feed per device,
 * so one memory per module instance.
 */
let held: { sourceAt: number; enteredAt: number } | null = null;

/** Forgets the hold (tests, and a surface that starts over). */
export function resetServiceStateMemory(): void {
  held = null;
}

/** ZET's own time for the snapshot: the source's, else the module's; null when neither parses. */
function sourceTimeOf(snapshot: ModuleSnapshot): number | null {
  const iso = snapshot.sources?.zet?.sourceUpdatedAt ?? snapshot.sourceUpdatedAt;
  if (iso === undefined) return null;
  const at = Date.parse(iso);
  return Number.isFinite(at) ? at : null;
}

/** The service state of the zet-rt snapshot at `now`. */
export function serviceStateOf(snapshot: ModuleSnapshot | undefined, now: number): ServiceState {
  if (!snapshot) return { kind: 'loading', since: null };
  if (snapshot.status === 'down') return { kind: 'down', since: null };
  // A clock that went back past the entry (a test, a device clock set back) is no hold.
  if (held && now < held.enteredAt) held = null;
  const sourceAt = sourceTimeOf(snapshot);
  if (sourceAt !== null && now - sourceAt > UNCONFIRMED_AFTER_MS) {
    if (!held || held.sourceAt !== sourceAt) held = { sourceAt, enteredAt: now };
    return { kind: 'unconfirmed', since: sourceAt + UNCONFIRMED_AFTER_MS };
  }
  if (held && now - held.enteredAt < UNCONFIRMED_HOLD_MS) return { kind: 'unconfirmed', since: held.sourceAt + UNCONFIRMED_AFTER_MS };
  held = null;
  return fleetState(snapshot);
}

/** Which departures the header sentence may say: none while ZET is down, unconfirmed or silent; only those a vehicle
 *  or a confirmed route backs while reduced (U2); every one otherwise. */
export function departureVoice(snapshot: ModuleSnapshot | undefined, now: number): DepartureVoice {
  const { kind } = serviceStateOf(snapshot, now);
  if (kind === 'down' || kind === 'unconfirmed') return 'none';
  return fleetVoice(kind);
}

/** Whether a line's timetable may be taken as running: not while the module is down or the city is silent, and in
 *  reduced not for a route the twin names below half its trips (U2). */
export function routeConfirmed(snapshot: ModuleSnapshot | undefined, routeId: string): boolean {
  if (snapshot?.status === 'down') return false;
  return fleetRouteConfirmed(snapshot, routeId);
}

/**
 * The one predicate for "no live fix may time a row now": true exactly while ZET is down or unconfirmed. The wall's
 * and the phone's lists drop their fixes on it, the kiosk's outage() is it, and Sada's sentence takes it as input.
 */
export function positionsUnavailable(snapshot: ModuleSnapshot | undefined, now: number): boolean {
  const { kind } = serviceStateOf(snapshot, now);
  return kind === 'down' || kind === 'unconfirmed';
}

// --- the city's fleet (U2)
// sources.zet.service is the twin's judgement of the vehicles it publishes
// against the runs the timetable has in service (worker/twin/service.ts). The
// states it names are only as good as the source under them: U0's states
// above outrank them, so a frozen feed never reads as a silent city. A
// snapshot without it (an older twin, a cold start) reads unknown and keeps
// today's voice.

type Kind = ReturnType<typeof serviceStateOf>['kind'];
const FLEET_STATES = new Set(['normal', 'reduced', 'silent', 'unknown']);

/** The twin's judgement as this client can trust it: a known state with whole, non-negative counts. */
function fleetService(snapshot: ModuleSnapshot | undefined): ZetService | undefined {
  const service = snapshot?.sources?.zet?.service;
  if (!service || typeof service !== 'object' || !FLEET_STATES.has(service.state)) return undefined;
  return service;
}

function fleetState(snapshot: ModuleSnapshot): { kind: Kind; since: number | null } {
  const service = fleetService(snapshot);
  if (!service) return { kind: 'unknown', since: null };
  const since = typeof service.since === 'string' ? Date.parse(service.since) : Number.NaN;
  return { kind: service.state, since: Number.isFinite(since) ? since : null };
}

function fleetVoice(kind: Kind): 'all' | 'live-only' | 'none' {
  return kind === 'silent' ? 'none' : kind === 'reduced' ? 'live-only' : 'all';
}

function fleetRouteConfirmed(snapshot: ModuleSnapshot | undefined, routeId: string): boolean {
  const service = fleetService(snapshot);
  if (service?.state === 'silent') return false;
  if (service?.state !== 'reduced') return true;
  // `routes` names the routes whose own share of their trips is below one half.
  const routes = service.routes;
  return !(routes && typeof routes === 'object' && Object.prototype.hasOwnProperty.call(routes, routeId));
}

const count = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0;

/** The two numbers a surface says while the city deviates (reduced or silent); null in every other state. */
export function serviceNumbers(snapshot: ModuleSnapshot | undefined): { seen: number; expected: number } | null {
  const service = fleetService(snapshot);
  if (!service || (service.state !== 'reduced' && service.state !== 'silent')) return null;
  if (!count(service.seen) || !count(service.expected) || service.expected === 0) return null;
  return { seen: service.seen, expected: service.expected };
}

/**
 * The timetable's count as a surface says it after "oko": to ten above a hundred, else to five,
 * never below five. The count is the timetable's runs, not a measurement, so it is never said
 * to the vehicle.
 */
export function aboutExpected(expected: number): number {
  if (expected > 100) return Math.round(expected / 10) * 10;
  return Math.max(5, Math.round(expected / 5) * 5);
}

/**
 * Rail and bikes move forward while ZET deviates (NearbyInput.policy, U3's field): three train
 * rows fill the departures' place when no tram is confirmed, two leave room for confirmed trams.
 */
export function railPolicy(kind: Kind): { railMax: number; railFirst: boolean } | undefined {
  if (kind === 'silent') return { railMax: 3, railFirst: true };
  if (kind === 'reduced') return { railMax: 2, railFirst: true };
  return undefined;
}
