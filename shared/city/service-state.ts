// The one helper every surface asks before it speaks for ZET (upgrade seam
// brief §5.2): which state the city's transit is in, and what voice the
// departures keep in it. U0-client owns the file and the source's own states
// (loading, down, unconfirmed); U2 adds the fleet's states (silent, reduced,
// normal) from the twin's judgement on the wire, sources.zet.service
// (shared/city/service-wire.ts), by changing function bodies only.
//
// The voice table (docs/upgrade-2026-10-plan/U2.md §0.1):
//   kind         departureVoice  routeConfirmed
//   loading      all             true
//   down         none            false
//   unconfirmed  none            true (the voice decides)
//   silent       none            false
//   reduced      live-only       the route is absent from service.routes
//   normal       all             true
//   unknown      all             true
// The rows never change on any surface (a grey clock, no word); the state
// speaks in the header sentence, the map note and the status line only.
import type { ModuleSnapshot } from '../../worker/feed/schema';
import type { ZetService } from './service-wire';

export type ServiceKind = 'loading' | 'down' | 'unconfirmed' | 'silent' | 'reduced' | 'normal' | 'unknown';
export interface ServiceState {
  kind: ServiceKind;
  /** Epoch ms: when the state began, or null when it is not known. */
  since: number | null;
}
export type DepartureVoice = 'all' | 'live-only' | 'none';

// --- stand-in for U0-client's part (the integrator keeps U0's file and drops these lines)
const UNCONFIRMED_AFTER_MS = 180_000;
function sourceAt(snapshot: ModuleSnapshot): number {
  return Date.parse(snapshot.sources?.zet?.sourceUpdatedAt ?? snapshot.sourceUpdatedAt ?? '');
}
// --- end of the stand-in

export function serviceStateOf(snapshot: ModuleSnapshot | undefined, now: number): ServiceState {
  if (!snapshot) return { kind: 'loading', since: null };
  if (snapshot.status === 'down') return { kind: 'down', since: null };
  const at = sourceAt(snapshot);
  if (now - at > UNCONFIRMED_AFTER_MS) return { kind: 'unconfirmed', since: at + UNCONFIRMED_AFTER_MS };
  return fleetState(snapshot);
}

export function departureVoice(snapshot: ModuleSnapshot | undefined, now: number): DepartureVoice {
  const { kind } = serviceStateOf(snapshot, now);
  if (kind === 'down' || kind === 'unconfirmed') return 'none';
  return fleetVoice(kind);
}

/** Whether a timetable row of this route may be said as a departure. Reads the wire only; callers ask departureVoice first. */
export function routeConfirmed(snapshot: ModuleSnapshot | undefined, routeId: string): boolean {
  if (snapshot?.status === 'down') return false;
  return fleetRouteConfirmed(snapshot, routeId);
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
