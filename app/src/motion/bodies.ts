// The vehicle bodies the city map lays under its pills from BODY_ZOOM up
// (map/overlays.ts): one length per mode (shared/motion/vehicle.ts), centred
// on the mark, because nobody knows where on the vehicle the antenna sits. A
// tram's body follows the curve of its rail; a bus's is a straight segment,
// because 12 m does not bend visibly. Pure -- no DOM, no MapLibre -- so the
// geometry is unit-tested in node; city-map.ts pushes the result as a GeoJSON
// source beside the vehicles.
import { toLonLat, type XY } from '../../../shared/motion/geo';
import type { GraphNetwork } from '../../../shared/motion/network';
import { slice } from '../../../shared/motion/polyline';
import { VEHICLE_LENGTH_M } from '../../../shared/motion/vehicle';
import { markAlpha, vehicleKind, type VehicleKind } from '../map/vehicle-mark';
import type { Drawn } from './integrator';

export interface BodyFeatureCollection {
  type: 'FeatureCollection';
  features: {
    type: 'Feature';
    geometry: { type: 'LineString'; coordinates: [number, number][] };
    /** What the body layer reads: its kind for the ink and the mode filter, its route for line focus, its alpha with the dots'. */
    properties: { id: string; kind: VehicleKind; routeId: string; alpha: number };
  }[];
}

/** The one length a mark of this kind is drawn at. An unknown kind takes the
 *  tram's: the longer body is the honest guess for a mark whose route type
 *  the feed did not say, in a city where the untyped marks are trams. */
export function bodyLengthM(kind: VehicleKind): number {
  return kind === 'bus' ? VEHICLE_LENGTH_M.bus : VEHICLE_LENGTH_M.tram;
}

/**
 * Where a vehicle of `lengthM` lies, in plane metres, centred on its mark.
 * A mark with a path and an arc on a network is the path itself sliced
 * L/2 each way (polyline.slice keeps the bend vertices and clamps at a
 * terminus, so a body never hangs off the end of its rail). Otherwise a
 * straight segment p +- L/2 along the heading, or the geometry's tangent
 * when the model is unsure of the heading. No direction at all is no body:
 * a mark that does not know which way it lies draws nothing under its pill.
 */
export function bodyOf(v: Drawn, net: GraphNetwork | null, lengthM: number): XY[] | null {
  const half = lengthM / 2;
  if (v.path !== undefined && v.s !== undefined && net) {
    const geo = net.pathGeometry(v.path);
    return slice(geo.pts, geo.cum, v.s - half, v.s + half);
  }
  const dir = v.heading ?? v.track;
  if (!dir) return null;
  const norm = Math.hypot(dir.x, dir.y);
  if (norm === 0) return null;
  const dx = (dir.x / norm) * half;
  const dy = (dir.y / norm) * half;
  return [{ x: v.p.x - dx, y: v.p.y - dy }, { x: v.p.x + dx, y: v.p.y + dy }];
}

/** The bodies as a GeoJSON source: one LineString per drawn vehicle that
 *  knows its direction, never one per cluster -- a merge of two marks is
 *  still two vehicles on the street, and both bodies show under the one
 *  pill. */
export function bodiesToGeoJson(drawn: readonly Drawn[], net: GraphNetwork | null): BodyFeatureCollection {
  const features: BodyFeatureCollection['features'] = [];
  for (const v of drawn) {
    const kind = vehicleKind(v.type);
    const body = bodyOf(v, net, bodyLengthM(kind));
    if (!body) continue;
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: body.map(toLonLat) },
      properties: { id: v.id, kind, routeId: v.routeId ?? '', alpha: markAlpha(v.confidence) },
    });
  }
  return { type: 'FeatureCollection', features };
}
