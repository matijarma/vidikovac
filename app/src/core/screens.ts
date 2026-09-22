import type { CreateBeaconResponse } from '../../../worker/protocol';
import type { ScreenStop } from './contracts';
import type { StreetGeo } from '../kiosk/places';

/** Everything is optional: the one-button start posts an empty body and the
 *  Worker answers with a whole-city screen (area `zagreb`, no stop). An area
 *  or a stop is only ever named by a caller that already has one. */
export interface CreateScreenInput { area?: string; stopId?: string | null; operatorLabel?: string }

export class ScreenError extends Error {
  constructor(readonly reason: string, readonly status: number, readonly retryAfter = 0) {
    super(reason);
  }
}

export async function createTemporaryScreen(input: CreateScreenInput, fetchImpl: typeof fetch = fetch): Promise<CreateBeaconResponse> {
  const response = await fetchImpl('/api/screens', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input), cache: 'no-store',
  });
  const body = await response.json() as CreateBeaconResponse & { error?: string; retryAfter?: number };
  if (!response.ok) throw new ScreenError(body.error ?? 'screen-create-failed', response.status, body.retryAfter ?? 0);
  if (!body.beaconId || !body.secret || !body.screen) throw new ScreenError('invalid-screen-response', 502);
  return body;
}

let stops: Promise<ScreenStop[]> | undefined;
/** Lazy: fetched for screen setup or stop search, never the lightweight entry graph. */
export function loadStops(fetchImpl: typeof fetch = fetch): Promise<ScreenStop[]> {
  return stops ??= fetchImpl('/data/stops.json').then(async (response) => {
    if (!response.ok) throw new Error('stops-unavailable');
    const data: unknown = await response.json();
    if (!Array.isArray(data)) throw new Error('stops-unavailable');
    return data as ScreenStop[];
  }).catch((error) => { stops = undefined; throw error; });
}

/**
 * The wire of app/public/data/streets-geo.json (scripts/streets-geo.mjs STREET_KEYS):
 * struct of arrays, the point in 1/pointScale of a degree above `origin`, the box as
 * outward offsets from the point and each line as deltas, both in 1/shapeScale of a degree.
 */
interface StreetsWire {
  origin: [number, number];
  pointScale: number;
  shapeScale: number;
  settlements: [string, string][];
  streets: {
    name: string[]; id: (number | null)[]; settlement: number[]; lon: number[]; lat: number[];
    bbox: [number, number, number, number][]; lengthM: number[]; stops: string[][];
  };
  lines: Record<string, number[]>;
}

function isStreetsWire(data: unknown): data is StreetsWire {
  if (!data || typeof data !== 'object') return false;
  const wire = data as Partial<StreetsWire>;
  const c = wire.streets;
  if (!Array.isArray(wire.origin) || typeof wire.pointScale !== 'number' || typeof wire.shapeScale !== 'number') return false;
  if (!Array.isArray(wire.settlements) || !c || typeof c !== 'object' || !wire.lines || typeof wire.lines !== 'object') return false;
  const n = Array.isArray(c.name) ? c.name.length : -1;
  return n >= 0 && [c.id, c.settlement, c.lon, c.lat, c.bbox, c.lengthM, c.stops].every((column) => Array.isArray(column) && column.length === n);
}

/** streets-geo.json → StreetGeo rows; scripts/streets-geo.mjs decodeIndex is the twin the test holds this to. */
export function decodeStreets(data: unknown): StreetGeo[] {
  if (!isStreetsWire(data)) throw new Error('streets-unavailable');
  const [ox, oy] = data.origin;
  const point = data.pointScale;
  const shape = data.shapeScale;
  const step = point / shape;
  const c = data.streets;
  const rows: StreetGeo[] = [];
  for (let i = 0; i < c.name.length; i += 1) {
    const lonQ = ox + c.lon[i]!;
    const latQ = oy + c.lat[i]!;
    const px = Math.round(lonQ / step);
    const py = Math.round(latQ / step);
    const [dw, ds, de, dn] = c.bbox[i]!;
    const [settlementId, settlement] = data.settlements[c.settlement[i]!] ?? [];
    const id = c.id[i];
    const row: StreetGeo = {
      name: c.name[i]!,
      ...(id !== null && id !== undefined ? { id: String(id) } : {}),
      ...(settlementId ? { settlementId, settlement } : {}),
      lon: lonQ / point,
      lat: latQ / point,
      bbox: [(px - dw) / shape, (py - ds) / shape, (px + de) / shape, (py + dn) / shape],
      lengthM: c.lengthM[i]!,
      stops: c.stops[i]!,
    };
    const deltas = data.lines[String(i)];
    if (deltas) {
      const line: [number, number][] = [];
      let x = px;
      let y = py;
      for (let k = 0; k + 1 < deltas.length; k += 2) {
        x += deltas[k]!;
        y += deltas[k + 1]!;
        line.push([x / shape, y / shape]);
      }
      row.line = line;
    }
    rows.push(row);
  }
  return rows;
}

let streets: Promise<StreetGeo[]> | undefined;
/** Lazy like loadStops: the offline street index, fetched on the place field's first use only. */
export function loadStreets(fetchImpl: typeof fetch = fetch): Promise<StreetGeo[]> {
  return streets ??= fetchImpl('/data/streets-geo.json').then(async (response) => {
    if (!response.ok) throw new Error('streets-unavailable');
    return decodeStreets(await response.json());
  }).catch((error) => { streets = undefined; throw error; });
}
