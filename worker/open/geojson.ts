// /open/prometnice.geojson: the closures snapshot as a GeoJSON
// FeatureCollection. The Otvorena dozvola requires adaptations to be marked,
// so the collection and every feature carry `adapted: true` and the source
// attribution rides along as top-level foreign members (RFC 7946 §6.1).
import type { FeedItem, Geo, ModuleSnapshot } from '../feed/schema';
import { fillAttribution } from './attribution';

export interface ClosureFeature {
  type: 'Feature';
  id: string;
  geometry: Geo;
  properties: Record<string, string | number | boolean | null>;
}

export interface ClosuresGeoJson {
  type: 'FeatureCollection';
  features: ClosureFeature[];
  attribution: string;
  licence: string;
  source: string;
  adapted: true;
  adaptedBy: string;
  fetchedAt: string;
  sourceUpdatedAt: string | null;
  status: ModuleSnapshot['status'];
}

function toFeature(item: FeedItem, geo: Geo): ClosureFeature {
  return {
    type: 'Feature',
    id: item.id,
    geometry: { type: geo.type, coordinates: geo.coordinates },
    properties: {
      // Source-specific extras first (type, subtype, direction...); the named
      // keys below always win, so `adapted` cannot be overridden by a feed.
      ...(item.data ?? {}),
      id: item.id,
      title: item.title,
      summary: item.summary ?? null,
      severity: item.severity ?? null,
      from: item.at ?? null,
      until: item.until ?? null,
      module: item.module,
      adapted: true,
    },
  };
}

export function closuresToGeoJson(snapshot: ModuleSnapshot, origin: string): ClosuresGeoJson {
  const features: ClosureFeature[] = [];
  for (const item of snapshot.items) {
    if (item.kind !== 'closure' || item.geo === undefined) continue;
    features.push(toFeature(item, item.geo));
  }
  return {
    type: 'FeatureCollection',
    features,
    // R-62: the human-readable attribution line is filled from this same
    // snapshot before it leaves the Worker, so a brace never reaches whoever
    // downloads this file.
    attribution: fillAttribution(snapshot.attribution, snapshot, snapshot.items[0]),
    licence: snapshot.attribution.licence,
    source: snapshot.attribution.url,
    adapted: true,
    adaptedBy: `Vidikovac, ${origin}`,
    fetchedAt: snapshot.fetchedAt,
    sourceUpdatedAt: snapshot.sourceUpdatedAt ?? null,
    status: snapshot.status,
  };
}
