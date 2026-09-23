// Named static sources belong to the lazy map renderer. The public API is
// re-exported by city-map for pure callers, but startup imports no renderer.
import { toLonLat } from '../../../shared/motion/geo';
import type { Network } from '../../../shared/motion/network';
import { vetExternal, vetExternalMap } from '../../../shared/kiosk/external-text-boundary';
import { ROUTE_TYPE_BUS, ROUTE_TYPE_TRAM } from '../motion/schematic';
import { vehicleKind } from './vehicle-mark';
import type { MapPoint, MapLine, MapOutline, PointProperties, PointFeatureCollection, LineFeatureCollection, LineStringFeatureCollection, NetworkFeatureCollection, StopFeatureCollection } from './city-map';
import type { ScreenStop } from '../core/contracts';

const RESERVED_POINT_PROPS: ReadonlySet<string> = new Set(['id', 'title', 'routeId', 'place']);

export function outlineToGeoJson(outline: MapOutline | null): LineStringFeatureCollection {
  const rings: [number, number][][] = [];
  for (const polygon of outline?.polygons ?? []) {
    for (const ring of polygon) if (ring.length >= 4) rings.push(ring);
  }
  if (!outline || rings.length === 0) return { type: 'FeatureCollection', features: [] };
  return { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'MultiLineString', coordinates: rings }, properties: { id: outline.id } }] };
}

export function screenStopGeoJson(stop: ScreenStop | null): { type: 'FeatureCollection'; features: unknown[] } {
  if (!stop || !Number.isFinite(stop.lon) || !Number.isFinite(stop.lat)) return { type: 'FeatureCollection', features: [] };
  return { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [stop.lon, stop.lat] }, properties: { id: stop.id, name: vetExternal('name', stop.name, 'row') ?? '' } }] };
}

export function pointsToGeoJson(points: readonly MapPoint[], publicDisplay = true): PointFeatureCollection {
  return {
    type: 'FeatureCollection',
    features: points
      .filter(p => p.at === undefined && Number.isFinite(p.lon) && Number.isFinite(p.lat))
      .flatMap(p => {
        const title = p.title === '' ? '' : vetExternalMap('name', p.title, publicDisplay);
        if (title === null) return [];
        const properties: PointProperties = p.routeId === undefined ? { id: p.id, title } : { id: p.id, title, routeId: p.routeId };
        if (p.place !== undefined) properties.place = p.place;
        for (const [key, value] of Object.entries(p.props ?? {})) {
          if (RESERVED_POINT_PROPS.has(key) || value === undefined) continue;
          properties[key] = typeof value === 'string' && ['name', 'address', 'badge', 'label'].includes(key)
            ? vetExternalMap(key === 'address' ? 'address' : 'name', value, publicDisplay) ?? '' : value;
        }
        return [{ type: 'Feature' as const, geometry: { type: 'Point' as const, coordinates: [p.lon, p.lat] as [number, number] }, properties }];
      }),
  };
}

export function linesToGeoJson(lines: readonly MapLine[], publicDisplay = true): LineFeatureCollection {
  return {
    type: 'FeatureCollection',
    features: lines
      .filter(l => l.coordinates.length >= 2 && l.coordinates.every(([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat)))
      .flatMap(l => {
        const title = l.title === '' ? '' : vetExternalMap('name', l.title, publicDisplay);
        return title === null ? [] : [{ type: 'Feature' as const, geometry: { type: 'LineString' as const, coordinates: l.coordinates }, properties: { id: l.id, title } }];
      }),
  };
}

export function networkToGeoJson(net: Network): NetworkFeatureCollection {
  return {
    type: 'FeatureCollection',
    features: net.shapes.filter(shape => shape.pts.length >= 2).map((shape, i) => {
      const route = net.routes.get(shape.route);
      return {
        type: 'Feature' as const,
        geometry: { type: 'LineString' as const, coordinates: shape.pts.map(toLonLat) },
        properties: { shape: i, route: shape.route, short: vetExternal('headsign', route?.short ?? shape.route, 'row') ?? '', kind: vehicleKind(route?.type ?? -1) },
      };
    }),
  };
}

/** Interchange and label rank remain properties of the original platform
 * name. A rejected name cannot enter the source's text field. */
export function stopsToGeoJson(net: Network): StopFeatureCollection {
  const rows = net.stops.map(stop => {
    const routes = [...new Set(stop.on.map(on => net.shapes[on.shape]?.route).filter((r): r is string => Boolean(r)))]
      .sort((a, b) => a.localeCompare(b, 'hr', { numeric: true }));
    const types = routes.map(r => net.routes.get(r)?.type);
    return { stop, routes, tram: types.includes(ROUTE_TYPE_TRAM), bus: types.includes(ROUTE_TYPE_BUS) };
  });
  const labelled = new Map<string, { id: string; rank: number }>();
  const interchange = new Map<string, { tram: boolean; terminal: boolean }>();
  for (const { stop, routes, tram } of rows) {
    const best = labelled.get(stop.name);
    if (!best || routes.length > best.rank || (routes.length === best.rank && stop.id < best.id)) labelled.set(stop.name, { id: stop.id, rank: routes.length });
    const seen = interchange.get(stop.name) ?? { tram: false, terminal: false };
    interchange.set(stop.name, { tram: seen.tram || tram, terminal: seen.terminal || stop.terminal });
  }
  return {
    type: 'FeatureCollection',
    features: rows.map(({ stop, routes, tram, bus }) => {
      const hub = interchange.get(stop.name)!;
      return {
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: toLonLat(stop.p) },
        properties: {
          id: stop.id, name: vetExternal('name', stop.name, 'row') ?? '', routes, rank: routes.length, tram, bus,
          label: labelled.get(stop.name)?.id === stop.id, tramInterchange: hub.tram && hub.terminal,
        },
      };
    }),
  };
}
