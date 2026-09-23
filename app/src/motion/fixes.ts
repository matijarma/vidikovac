// The wire to the integrator: a zet-rt snapshot's 'vehicle:' pins become
// Fixes (the twin's estimate, the report time, the static join, the twin's
// scalars and its plan, R-TE13), and its 'route:' summary rows become the
// routeId -> median delay map the cards and lists read. Both surfaces that
// mount the schematic and the full map go through this one file, so the
// wire vocabulary (DATA_KEYS.vehicle and FeedItem.motion in
// worker/feed/schema.ts) is read in exactly one place on the client.
import type { ModuleSnapshot } from '../../../worker/feed/schema';
import { isFreeMotion, isPathMotion } from '../../../shared/motion/wire';
import { dataNumber, dataText } from '../panels/panel';
import type { Fix, FixPlan } from './integrator';

function parseTime(iso: string | undefined): number | null {
  if (iso === undefined) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

/**
 * Every 'vehicle:' pin with a point, as a Fix. A pin's own `at` is its report
 * time; a pin without one is dated at the snapshot's source time, then its
 * fetch time, then `now`. Plan knot times on the wire are seconds relative to
 * the snapshot's source time (the twin's header); they leave here as absolute
 * epoch milliseconds, so the integrator evaluates them against its own clock.
 * The next-stop ETA is the exception: the twin publishes a planned arrival in
 * epoch seconds, so it is only scaled, never re-based.
 */
export function vehicleFixes(snapshot: ModuleSnapshot | undefined, now: number): Fix[] {
  if (!snapshot) return [];
  const sourceAt = parseTime(snapshot.sourceUpdatedAt);
  const fallbackAt = sourceAt ?? parseTime(snapshot.fetchedAt) ?? now;
  const origin = fallbackAt;
  const fixes: Fix[] = [];
  for (const item of snapshot.items) {
    if (!item.id.startsWith('vehicle:') || item.geo?.type !== 'Point') continue;
    const [lon, lat] = item.geo.coordinates as number[];
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    const type = dataNumber(item, 'routeType');
    const rawDirection = dataNumber(item, 'direction');
    const direction: 0 | 1 | undefined = rawDirection === 0 ? 0 : rawDirection === 1 ? 1 : undefined;
    const nextStopEtaSec = dataNumber(item, 'nextStopEtaSec');
    const fix: Fix = {
      id: item.id,
      lon,
      lat,
      at: parseTime(item.at) ?? fallbackAt,
      network: item.motion?.network,
      generatedAt: item.motion?.generatedAt,
      tripId: dataText(item, 'tripId') || undefined,
      routeId: dataText(item, 'routeId') || undefined,
      type: type ?? undefined,
      shapeId: dataText(item, 'shapeId') || undefined,
      direction,
      headsign: dataText(item, 'headsign') || undefined,
      nextStopId: dataText(item, 'nextStopId') || undefined,
      // The one wire time that is absolute already: the twin plans an arrival
      // at that stop, not an offset from the header, so it is only scaled to
      // milliseconds while the plan knots are resolved against the origin.
      nextStopEtaMs: nextStopEtaSec === null ? undefined : nextStopEtaSec * 1000,
      delaySeconds: dataNumber(item, 'delaySeconds') ?? undefined,
      speed: dataNumber(item, 'speed') ?? undefined,
      confidence: dataNumber(item, 'confidence') ?? undefined,
      held: typeof item.data?.held === 'boolean' ? item.data.held : undefined,
      // The twin's ordering register, one leader per vehicle (E3). Absent
      // until the twin publishes it; the integrator falls back to plan order
      // for a pair it names neither side of.
      behind: dataText(item, 'behind') || undefined,
    };
    for (const key of Object.keys(fix) as (keyof Fix)[]) if (fix[key] === undefined) delete fix[key];
    const motion = item.motion;
    if (motion && isPathMotion(motion)) {
      fix.path = motion.path;
      fix.plan = { on: 'path', knots: motion.plan.map(([t, s]) => [origin + t * 1000, s] as const) } satisfies FixPlan;
    } else if (motion && isFreeMotion(motion)) {
      fix.plan = { on: 'free', knots: motion.plan.map(([t, plon, plat]) => [origin + t * 1000, plon, plat] as const) } satisfies FixPlan;
    }
    fixes.push(fix);
  }
  return fixes;
}

/** routeId -> medianDelaySeconds from the 'route:' summary rows -- the same
 *  field u-pokretu.ts's routeDelays reads, in the shape SchematicUpdate.delays
 *  takes. A row without a delay figure is left out rather than read as 0. */
export function routeDelayMap(snapshot: ModuleSnapshot | undefined): Map<string, number> {
  const out = new Map<string, number>();
  for (const item of snapshot?.items ?? []) {
    if (!item.id.startsWith('route:')) continue;
    const routeId = dataText(item, 'routeId');
    const delay = dataNumber(item, 'medianDelaySeconds');
    if (routeId && delay !== null) out.set(routeId, delay);
  }
  return out;
}
