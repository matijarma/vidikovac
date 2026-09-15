import rows from '../data/zet-stops.json';
import type { ScreenStop } from '../protocol';
import { districtOf } from '../feed/geo/districts';

const stops = new Map<string, ScreenStop>((rows as ScreenStop[]).map((row) => [row.id, row]));
export const DEFAULT_STOP_ID = '106_1';

/** Read-path enrichment for a stop stored before `district` existed (or from a zet-stops.json row that never carried it): stamps it from the coordinates already on file, leaving an existing value untouched. */
export function withDistrict(stop: ScreenStop): ScreenStop {
  if (stop.district !== undefined) return stop;
  const district = districtOf(stop.lon, stop.lat);
  return district ? { ...stop, district } : stop;
}

export function screenStop(id: string): ScreenStop | null {
  const stop = stops.get(id);
  return stop ? withDistrict(stop) : null;
}
