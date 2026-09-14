import type { FetchContext, SourceAvailability } from '../schema';
import type { FeedPayload, ItemInput } from '../payload';
import { compactData, sourceCoverage } from '../payload';

// Two spatial layers, two direct downloads. The seventeen city districts come
// from the City's ArcGIS FeatureServer as polygons and are reduced to one
// labelled centroid each; the civil-protection assembly points are read
// straight from the portal's resource download URL. data.zagreb.hr/robots.txt
// disallows /api/, so CKAN package_show is never called (R-P5): if the portal
// moves the resource the layer goes `down` and docs/izvori.md is updated.

export const ZBORNA_MJESTA_URL =
  'https://data.zagreb.hr/dataset/d736c146-6497-4915-894b-41bdf51267b0/resource/d30eb215-3ce2-48f8-88b2-6ffac82d46b5/download/zborna_mjesta_civilne_zatite_grada_zagreba-1.geojson';
export const ARCGIS_CETVRTI_URL =
  'https://services8.arcgis.com/Usi0jGQwMmBUpFjr/arcgis/rest/services/Gradske_cetvrti/FeatureServer/0/query?where=1%3D1&outFields=*&outSR=4326&f=geojson';
export const ZBORNA_MJESTA_DATASET = 'zborna-mjesta-civilne-zastite-grada-zagreba';
export const CETVRTI_DATASET = 'gradske-cetvrti';
/** Per layer, after parsing. Coverage counts the source rows before this cap. */
export const CKAN_GEO_SOURCE_LIMIT = 500;

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

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function coordinate(value: unknown): value is [number, number] {
  return Array.isArray(value)
    && typeof value[0] === 'number' && Number.isFinite(value[0]) && Math.abs(value[0]) <= 180
    && typeof value[1] === 'number' && Number.isFinite(value[1]) && Math.abs(value[1]) <= 90;
}

function ringMeasure(ring: unknown): { centroid: [number, number]; area: number } | null {
  if (!Array.isArray(ring) || ring.length < 4 || !ring.every(coordinate)) return null;
  if (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1]) return null;
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
  if (!Number.isFinite(twiceArea) || twiceArea === 0) return null;
  const centroid: [number, number] = [x / (3 * twiceArea), y / (3 * twiceArea)];
  return coordinate(centroid) ? { centroid, area: Math.abs(twiceArea) / 2 } : null;
}

/** Area-weighted centroid of a closed WGS84 ring; null for invalid geometry. */
export function ringCentroid(ring: unknown): [number, number] | null {
  return ringMeasure(ring)?.centroid ?? null;
}

export function featureCentroid(geometry: unknown): [number, number] | null {
  const geo = recordOf(geometry);
  if (!geo) return null;
  if (geo.type === 'Point') {
    return coordinate(geo.coordinates) ? [geo.coordinates[0], geo.coordinates[1]] : null;
  }
  if (!Array.isArray(geo.coordinates)) return null;
  // Holes are not standalone polygons. For a multipolygon use the largest
  // exterior by area, never the most densely sampled ring.
  const rings: unknown[] =
    geo.type === 'Polygon'
      ? [geo.coordinates[0]]
      : geo.type === 'MultiPolygon'
        ? geo.coordinates.map((polygon: unknown) => Array.isArray(polygon) ? polygon[0] : undefined)
        : [];
  let best: [number, number] | null = null;
  let bestSize = -1;
  for (const ring of rings) {
    const measured = ringMeasure(ring);
    if (measured && measured.area > bestSize) {
      best = measured.centroid;
      bestSize = measured.area;
    }
  }
  return best;
}

export function parseGradskeCetvrti(json: unknown): ItemInput[] {
  const features = (json as { features?: unknown })?.features;
  if (!Array.isArray(features)) return [];
  const items: ItemInput[] = [];

  for (const feature of features) {
    const object = recordOf(feature);
    const properties = recordOf(object?.properties);
    if (!properties) continue;
    const name = text(properties.IME_GC);
    const number = pickNumber(properties, ['RBR_GC']);
    const centroid = featureCentroid(object?.geometry);
    if (!name || number === undefined || !Number.isSafeInteger(number) || number <= 0 || !centroid) continue;
    const seat = text(properties.sjediste_G);
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

// The official assembly GeoJSON uses zboriste / gradska_ce / OBJECTID.
const NAME_KEYS = ['zboriste', 'ZBORISTE', 'naziv', 'NAZIV', 'ime', 'IME', 'name', 'NAME', 'lokacija', 'LOKACIJA'];
const ADDRESS_KEYS = ['adresa', 'ADRESA', 'address', 'ulica', 'ULICA'];
const DISTRICT_KEYS = ['gradska_ce', 'GRADSKA_CE'];
const LON_KEYS = ['lon', 'LON', 'lng', 'longitude', 'x', 'X'];
const LAT_KEYS = ['lat', 'LAT', 'latitude', 'y', 'Y'];

function pick(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = text(record[key]);
    if (value) return value;
  }
  return undefined;
}

function pickNumber(record: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const raw = record[key];
    // Number(null), Number('') and Number(false) are zero, not coordinates.
    if (typeof raw !== 'number' && (typeof raw !== 'string' || !raw.trim())) continue;
    const value = Number(raw);
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
    const feature = recordOf(row);
    if (!feature) continue;
    const record = recordOf(feature.properties) ?? feature;
    const title = pick(record, NAME_KEYS);
    if (!title) continue;
    const address = pick(record, ADDRESS_KEYS) ?? pick(record, DISTRICT_KEYS);
    const lon = pickNumber(record, LON_KEYS);
    const lat = pickNumber(record, LAT_KEYS);
    const point = [lon, lat];
    const centroid = featureCentroid(feature.geometry) ?? (coordinate(point) ? point : null);
    const sourceId = feature.id ?? record.OBJECTID ?? record.objectid ?? record.id;
    const id = text(sourceId) ?? (typeof sourceId === 'number' && Number.isFinite(sourceId) ? String(sourceId) : String(index));
    items.push({
      id: `${layer}:${id}`,
      kind: 'poi',
      title,
      ...(address ? { summary: address } : {}),
      ...(centroid ? { geo: { type: 'Point' as const, coordinates: centroid } } : {}),
      data: compactData({ layer, category: POI_CATEGORIES[layer], district: pick(record, DISTRICT_KEYS) }),
    });
  }
  return items;
}

/** The portal's `Last-Modified` response header when it sends one; never the fetch time. */
function headerTimestampIso(value: string | null): string | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : undefined;
}

async function readJsonResponse(ctx: FetchContext, url: string): Promise<{ json: unknown; response: Response }> {
  const response = await ctx.fetch(url);
  if (!response.ok) throw new Error(`ckan-geo: HTTP ${response.status}`);
  const json: unknown = await response.json();
  const envelope = recordOf(json);
  if (envelope?.success === false || envelope?.error != null || envelope?.errors != null) {
    throw new Error('ckan-geo: upstream API error');
  }
  return { json, response };
}

async function readJson(ctx: FetchContext, url: string): Promise<unknown> {
  return (await readJsonResponse(ctx, url)).json;
}

interface SpatialResult {
  items: ItemInput[];
  availability: SourceAvailability;
}

function spatialResult(json: unknown, layer: string, ctx: FetchContext, sourceUpdatedAt?: string): SpatialResult {
  const collection = recordOf(json);
  const rows = Array.isArray(json) && layer === ZBORNA_MJESTA_LAYER
    ? json
    : collection?.features;
  if (!Array.isArray(rows) || (collection?.type !== undefined && collection.type !== 'FeatureCollection')) {
    throw new Error('ckan-geo: invalid spatial collection');
  }
  const parsed = layer === CETVRTI_DATASET ? parseGradskeCetvrti(json) : parseCkanRecords(json, layer);
  // Non-empty, wholly unreadable data is a schema failure, not an empty source.
  if (rows.length > 0 && parsed.length === 0) throw new Error('ckan-geo: no readable spatial records');
  const items = parsed.slice(0, CKAN_GEO_SOURCE_LIMIT);
  const exceeded = collection?.exceededTransferLimit === true
    || recordOf(collection?.properties)?.exceededTransferLimit === true;
  // ArcGIS can truncate even a GeoJSON response. Never turn a partial page's
  // length into an asserted dataset total. Explicit totals must be plausible.
  const reportedTotal = collection?.numberMatched ?? collection?.totalFeatures;
  const totalItems = reportedTotal !== undefined
    ? typeof reportedTotal === 'number' && Number.isSafeInteger(reportedTotal) && reportedTotal >= rows.length
      && (!exceeded || reportedTotal > rows.length)
      ? reportedTotal : undefined
    : exceeded ? undefined : rows.length;
  return {
    items,
    availability: {
      status: 'live',
      itemCount: items.length,
      fetchedAt: ctx.now().toISOString(),
      ...(totalItems !== undefined ? { totalItems } : {}),
      ...(sourceUpdatedAt ? { sourceUpdatedAt } : {}),
    },
  };
}

export async function fetchCkanGeo(ctx: FetchContext): Promise<FeedPayload> {
  const districts = readJson(ctx, ARCGIS_CETVRTI_URL)
    .then((json) => spatialResult(json, CETVRTI_DATASET, ctx));

  const assembly = readJsonResponse(ctx, ZBORNA_MJESTA_URL)
    .then(({ json, response }) => spatialResult(json, ZBORNA_MJESTA_LAYER, ctx, headerTimestampIso(response.headers.get('last-modified'))));

  const [districtResult, assemblyResult] = await Promise.allSettled([districts, assembly]);
  if (districtResult.status === 'rejected' && assemblyResult.status === 'rejected') {
    throw new Error('ckan-geo: no spatial layer could be read');
  }
  const items: ItemInput[] = [];
  const sources: Record<string, SourceAvailability> = {};
  for (const [layer, result] of [[CETVRTI_DATASET, districtResult], [ZBORNA_MJESTA_LAYER, assemblyResult]] as const) {
    if (result.status === 'fulfilled') {
      items.push(...result.value.items);
      sources[layer] = result.value.availability;
    } else {
      sources[layer] = { status: 'down', itemCount: 0 };
    }
  }

  // There is no shared source timestamp: the portal's Last-Modified for the
  // assembly file says nothing about when the district geometry last changed.
  return { items, sources, coverage: sourceCoverage(sources) };
}
