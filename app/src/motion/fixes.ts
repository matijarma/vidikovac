// The wire item to the model's evidence: a zet-rt snapshot's 'vehicle:' pins
// become Fixes (Fix is what the motion model folds into a vehicle's own
// history, never something it draws -- R-P2), and its 'route:' summary rows
// become the routeId -> median delay map the schematic's card and list read.
// Both surfaces that mount the schematic (the U pokretu layer and the kiosk
// stage) go through this one file, so the wire vocabulary (DATA_KEYS.vehicle
// in worker/feed/schema.ts) is read in exactly one place on the client.
import type { ModuleSnapshot } from '../../../worker/feed/schema';
import { dataNumber, dataText } from '../panels/panel';
import type { Fix } from './model';

function parseTime(iso: string | undefined): number | null {
  if (iso === undefined) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

/**
 * Every 'vehicle:' pin with a point, as a Fix. A pin's own `at` is its
 * timestamp; a pin without one (ZET omits it now and then) is dated at the
 * snapshot's source time, then its fetch time, then `now` -- a date the
 * source vouches for wherever possible, so the same snapshot re-read on the
 * next poll does not look like fresh evidence (model.ts's applyFix already
 * ignores a fix that is not newer than the last one).
 */
export function vehicleFixes(snapshot: ModuleSnapshot | undefined, now: number): Fix[] {
  if (!snapshot) return [];
  const fallbackAt = parseTime(snapshot.sourceUpdatedAt) ?? parseTime(snapshot.fetchedAt) ?? now;
  const fixes: Fix[] = [];
  for (const item of snapshot.items) {
    if (!item.id.startsWith('vehicle:') || item.geo?.type !== 'Point') continue;
    const [lon, lat] = item.geo.coordinates as number[];
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    const type = dataNumber(item, 'routeType');
    fixes.push({
      id: item.id,
      lon,
      lat,
      at: parseTime(item.at) ?? fallbackAt,
      tripId: dataText(item, 'tripId') || undefined,
      routeId: dataText(item, 'routeId') || undefined,
      type: type ?? undefined,
    });
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
