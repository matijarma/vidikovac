import type { FetchContext } from '../schema';
import type { FeedPayload, ItemInput } from '../payload';
import { compactData } from '../payload';
import { isoOrUndefined } from '../time';

// Two spatial layers, two access paths. The seventeen city districts come from
// the City's ArcGIS FeatureServer as polygons and are reduced to one labelled
// centroid each; the civil-protection assembly points are found through CKAN
// package_show, because the download URL of a resource is not stable enough to
// pin but the package name is.

export const CKAN_PACKAGE_SHOW = 'https://data.zagreb.hr/api/3/action/package_show?id=';
export const ARCGIS_CETVRTI_URL =
  'https://services8.arcgis.com/Usi0jGQwMmBUpFjr/arcgis/rest/services/Gradske_cetvrti/FeatureServer/0/query?where=1%3D1&outFields=*&outSR=4326&f=geojson';
export const ZBORNA_MJESTA_DATASET = 'zborna-mjesta-civilne-zastite-grada-zagreba';
export const CETVRTI_DATASET = 'gradske-cetvrti';

// FeedItem.data.layer is the stable slug a consumer filters on (/hitno picks
// the assembly points out of the mixed poi stream with it); data.category is
// the Croatian label the panel prints under the name. Both are the whole poi
// vocabulary (R-22, R-50).
export const ZBORNA_MJESTA_LAYER = 'zborna-mjesta';
export const POI_CATEGORIES: Record<string, string> = {
  [CETVRTI_DATASET]: 'Gradska četvrt',
  [ZBORNA_MJESTA_LAYER]: 'Zborno mjesto civilne zaštite',
};

export function titleCaseHr(value: string): string {
  return value
    .toLocaleLowerCase('hr')
    .replace(/(^|[\s\-/])(\p{L})/gu, (_match, prefix: string, letter: string) => prefix + letter.toLocaleUpperCase('hr'));
}

/** Area-weighted centroid of a closed ring; null when the ring is degenerate. */
export function ringCentroid(ring: number[][]): [number, number] | null {
  if (!Array.isArray(ring) || ring.length < 3) return null;
  let twiceArea = 0;
  let x = 0;
  let y = 0;
  for (let index = 0; index < ring.length - 1; index += 1) {
    const [x0, y0] = ring[index];
    const [x1, y1] = ring[index + 1];
    const cross = x0 * y1 - x1 * y0;
    twiceArea += cross;
    x += (x0 + x1) * cross;
    y += (y0 + y1) * cross;
  }
  if (twiceArea === 0) return null;
  return [x / (3 * twiceArea), y / (3 * twiceArea)];
}

export function featureCentroid(geometry: unknown): [number, number] | null {
  const geo = geometry as { type?: string; coordinates?: unknown };
  if (!geo || typeof geo.type !== 'string') return null;
  if (geo.type === 'Point') {
    const [lon, lat] = (geo.coordinates as number[]) ?? [];
    return Number.isFinite(lon) && Number.isFinite(lat) ? [lon, lat] : null;
  }
  const rings: number[][][] =
    geo.type === 'Polygon'
      ? ((geo.coordinates as number[][][]) ?? [])
      : geo.type === 'MultiPolygon'
        ? ((geo.coordinates as number[][][][]) ?? []).map((polygon) => polygon[0])
        : [];
  let best: [number, number] | null = null;
  let bestSize = -1;
  for (const ring of rings) {
    const centroid = ringCentroid(ring);
    if (centroid && ring.length > bestSize) {
      best = centroid;
      bestSize = ring.length;
    }
  }
  return best;
}

interface CetvrtProperties {
  IME_GC?: string;
  RBR_GC?: number;
  sjediste_G?: string;
}

export function parseGradskeCetvrti(json: unknown): ItemInput[] {
  const features = (json as { features?: unknown })?.features;
  if (!Array.isArray(features)) return [];
  const items: ItemInput[] = [];

  for (const feature of features as { properties?: CetvrtProperties; geometry?: unknown }[]) {
    const name = feature.properties?.IME_GC;
    const number = Number(feature.properties?.RBR_GC);
    const centroid = featureCentroid(feature.geometry);
    if (!name || !Number.isFinite(number) || !centroid) continue;
    const seat = feature.properties?.sjediste_G;
    items.push({
      id: `cetvrt:${number}`,
      kind: 'poi',
      title: titleCaseHr(name),
      ...(seat ? { summary: seat } : {}),
      geo: { type: 'Point', coordinates: centroid },
      data: { layer: CETVRTI_DATASET, category: POI_CATEGORIES[CETVRTI_DATASET]! },
    });
  }

  items.sort((a, b) => a.title.localeCompare(b.title, 'hr'));
  return items;
}

interface CkanResource {
  format?: string;
  url?: string;
}

export function ckanResourceUrl(packageShow: unknown): string | null {
  const resources = (packageShow as { result?: { resources?: CkanResource[] } })?.result?.resources;
  if (!Array.isArray(resources)) return null;
  const preferred = ['GEOJSON', 'JSON'];
  for (const format of preferred) {
    const found = resources.find((resource) => (resource.format ?? '').toUpperCase() === format && resource.url);
    if (found?.url) return found.url;
  }
  return null;
}

const NAME_KEYS = ['naziv', 'NAZIV', 'ime', 'IME', 'name', 'NAME', 'lokacija', 'LOKACIJA'];
const ADDRESS_KEYS = ['adresa', 'ADRESA', 'address', 'ulica', 'ULICA'];
const LON_KEYS = ['lon', 'LON', 'lng', 'longitude', 'x', 'X'];
const LAT_KEYS = ['lat', 'LAT', 'latitude', 'y', 'Y'];

function pick(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number') return String(value);
  }
  return undefined;
}

function pickNumber(record: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = Number(record[key]);
    if (Number.isFinite(value)) return value;
  }
  return undefined;
}

export function parseCkanRecords(json: unknown, layer: string): ItemInput[] {
  const rows: unknown[] = Array.isArray(json)
    ? json
    : Array.isArray((json as { features?: unknown })?.features)
      ? ((json as { features: unknown[] }).features)
      : [];

  const items: ItemInput[] = [];
  for (const [index, row] of rows.entries()) {
    if (!row || typeof row !== 'object') continue;
    const feature = row as { properties?: Record<string, unknown>; geometry?: unknown };
    const record = (feature.properties ?? row) as Record<string, unknown>;
    const title = pick(record, NAME_KEYS);
    if (!title) continue;
    const address = pick(record, ADDRESS_KEYS);
    const lon = pickNumber(record, LON_KEYS);
    const lat = pickNumber(record, LAT_KEYS);
    const centroid = featureCentroid(feature.geometry) ?? (lon !== undefined && lat !== undefined ? [lon, lat] : null);
    items.push({
      id: `${layer}:${index}`,
      kind: 'poi',
      title,
      ...(address ? { summary: address } : {}),
      ...(centroid ? { geo: { type: 'Point' as const, coordinates: centroid } } : {}),
      data: compactData({ layer, category: POI_CATEGORIES[layer] }),
    });
  }
  return items;
}

/**
 * CKAN's `metadata_modified` is UTC but carries no zone suffix ("2026-09-01T08:00:00.000000"),
 * so the generic Date Time String Format parser in `isoOrUndefined` would read it as host-local
 * time. Append the missing `Z` before normalising so the result never depends on the runtime's
 * time zone (this codebase's own host is Europe/Zagreb, which silently shifts the naive parse).
 */
function ckanTimestampIso(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const withZone = /[zZ]|[+-]\d{2}:?\d{2}$/.test(value) ? value : `${value}Z`;
  return isoOrUndefined(withZone);
}

export async function fetchCkanGeo(ctx: FetchContext): Promise<FeedPayload> {
  const districts = ctx
    .fetch(ARCGIS_CETVRTI_URL)
    .then(async (response) => parseGradskeCetvrti(await response.json()));

  const assembly = (async () => {
    const meta = await (await ctx.fetch(`${CKAN_PACKAGE_SHOW}${ZBORNA_MJESTA_DATASET}`)).json();
    const url = ckanResourceUrl(meta);
    if (!url) throw new Error('ckan-geo: no JSON resource for the assembly points');
    const records = await (await ctx.fetch(url)).json();
    return {
      items: parseCkanRecords(records, ZBORNA_MJESTA_LAYER),
      modified: ckanTimestampIso((meta as { result?: { metadata_modified?: string } })?.result?.metadata_modified),
    };
  })();

  const [districtResult, assemblyResult] = await Promise.allSettled([districts, assembly]);
  const items: ItemInput[] = [];
  if (districtResult.status === 'fulfilled') items.push(...districtResult.value);
  if (assemblyResult.status === 'fulfilled') items.push(...assemblyResult.value.items);
  if (items.length === 0) throw new Error('ckan-geo: no spatial layer could be read');

  return {
    items,
    ...(assemblyResult.status === 'fulfilled' && assemblyResult.value.modified
      ? { sourceUpdatedAt: assemblyResult.value.modified }
      : {}),
  };
}
