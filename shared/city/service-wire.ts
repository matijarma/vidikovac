// sources.zet.service: the twin's judgement of the city's fleet against the
// timetable (upgrade U2). Written by worker/twin/service.ts, read by
// shared/city/service-state.ts. Additive: a snapshot without it reads unknown.
export type ServiceWireState = 'normal' | 'reduced' | 'silent' | 'unknown';
export interface ZetService {
  state: ServiceWireState;
  /** ISO: when this state was entered. */
  since: string;
  /** ISO: the header time of the last judged frame; frozen while the twin holds. */
  observedAt?: string;
  /** Vehicle runs the timetable has in service: the smallest over the next 10 minutes. */
  expected: number;
  /** Vehicles with a fresh position that the twin publishes. */
  seen: number;
  /** seen / expected, two decimals; null when expected is 0. */
  ratio: number | null;
  /** 0..1: the verdict's footing (size of expected, header freshness). */
  confidence: number;
  baseline: 'declared' | 'learned';
  /** [seen, expected] per mode. */
  byMode: { tram: [number, number]; bus: [number, number] };
  /** Reduced and silent only: [seen, trips in service] of every route with trips >= 1 whose own share is below 0.5. */
  routes?: Record<string, [number, number]>;
  reason?: 'no-artefact' | 'no-calendar' | 'below-min';
  /** Reserved for U1 (the operator's own statements). */
  operator?: { cancelledTrips: number; noServiceAlerts: number; noticesAt: string | null };
}
