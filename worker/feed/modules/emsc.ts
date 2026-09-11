import type { FetchContext, Severity } from '../schema';
import type { FeedPayload, ItemInput } from '../payload';
import { compactData } from '../payload';
import { isoOrUndefined } from '../time';

// EMSC's FDSN event service answers GeoJSON. The geometry carries a third,
// negative depth value, so the item position is built from the flat lon/lat
// properties instead: GeoJSON order, exactly two numbers.

export const EMSC_URL =
  'https://www.seismicportal.eu/fdsnws/event/1/query?lat=45.81&lon=15.98&maxradius=1.5&format=json';

export function magnitudeSeverity(magnitude: number): Severity {
  if (!Number.isFinite(magnitude) || magnitude < 3) return 'info';
  if (magnitude < 4) return 'minor';
  if (magnitude < 5) return 'moderate';
  if (magnitude < 6) return 'severe';
  return 'extreme';
}

interface EmscProperties {
  unid?: string;
  time?: string;
  lastupdate?: string;
  lat?: number;
  lon?: number;
  depth?: number;
  mag?: number;
  magtype?: string;
  flynn_region?: string;
}
interface EmscFeature {
  id?: string;
  properties?: EmscProperties;
}

export function parseEmsc(json: unknown): FeedPayload {
  const features = (json as { features?: unknown })?.features;
  if (!Array.isArray(features)) return { items: [] };

  const items: ItemInput[] = [];
  let newestUpdate = '';

  for (const feature of features as EmscFeature[]) {
    const props = feature.properties;
    const at = isoOrUndefined(props?.time);
    const lat = Number(props?.lat);
    const lon = Number(props?.lon);
    const id = props?.unid ?? feature.id;
    if (!id || !at || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    const magnitude = Number(props?.mag);
    const depthKm = Number(props?.depth);
    const region = props?.flynn_region ?? '';
    const lastUpdate = isoOrUndefined(props?.lastupdate) ?? '';
    if (lastUpdate > newestUpdate) newestUpdate = lastUpdate;

    items.push({
      id,
      kind: 'quake',
      title: `Potres magnitude ${String(magnitude).replace('.', ',')}`,
      summary: [region, Number.isFinite(depthKm) ? `dubina ${depthKm} km` : ''].filter(Boolean).join(', '),
      severity: magnitudeSeverity(magnitude),
      at,
      geo: { type: 'Point', coordinates: [lon, lat] },
      data: compactData({
        magnitude: Number.isFinite(magnitude) ? magnitude : undefined,
        magnitudeType: props?.magtype,
        depthKm: Number.isFinite(depthKm) ? depthKm : undefined,
        region: region || undefined,
      }),
    });
  }

  items.sort((a, b) => Date.parse(b.at ?? '') - Date.parse(a.at ?? ''));
  return { items, ...(newestUpdate ? { sourceUpdatedAt: newestUpdate } : {}) };
}

export async function fetchEmsc(ctx: FetchContext): Promise<FeedPayload> {
  const response = await ctx.fetch(EMSC_URL);
  return parseEmsc(await response.json());
}
