import { describe, expect, it } from 'vitest';
import {
  linesToGeoJson,
  OSM_ATTRIBUTION,
  OSM_RASTER_URL,
  osmStyle,
  pointsToGeoJson,
  ZAGREB_CENTER,
} from '../../app/src/map/city-map';

describe('open raster basemap', () => {
  it('uses the OpenStreetMap tile URL and attributes it in the style', () => {
    expect(OSM_RASTER_URL).toBe('https://tile.openstreetmap.org/{z}/{x}/{y}.png');
    expect(OSM_ATTRIBUTION).toBe('© OpenStreetMap contributors');
    const style = osmStyle();
    expect(style.sources.osm.tiles).toEqual([OSM_RASTER_URL]);
    expect(style.sources.osm.attribution).toBe(OSM_ATTRIBUTION);
    expect(style.sources.osm.tileSize).toBe(256);
    expect(style.layers[0]?.id).toBe('osm');
  });
  it('centres on Zagreb in GeoJSON order', () => {
    expect(ZAGREB_CENTER).toEqual([15.98, 45.815]);
  });
});

describe('feed items to GeoJSON', () => {
  it('turns points into a FeatureCollection keeping the route id', () => {
    const fc = pointsToGeoJson([{ id: 'v1', lon: 15.97, lat: 45.81, title: '6 · Črnomerec', routeId: '6' }]);
    expect(fc.type).toBe('FeatureCollection');
    expect(fc.features[0]?.geometry).toEqual({ type: 'Point', coordinates: [15.97, 45.81] });
    expect(fc.features[0]?.properties).toEqual({ id: 'v1', title: '6 · Črnomerec', routeId: '6' });
  });
  it('turns closures into line features', () => {
    const fc = linesToGeoJson([{ id: 'c1', title: 'Grada Vukovara', coordinates: [[15.95, 45.79], [15.96, 45.79]] }]);
    expect(fc.features[0]?.geometry.type).toBe('LineString');
    expect(fc.features[0]?.geometry.coordinates).toHaveLength(2);
    expect(fc.features[0]?.properties.title).toBe('Grada Vukovara');
  });
  it('drops coordinates that are not finite numbers', () => {
    expect(pointsToGeoJson([{ id: 'x', lon: Number.NaN, lat: 45, title: 'x' }]).features).toHaveLength(0);
    expect(linesToGeoJson([{ id: 'x', title: 'x', coordinates: [[15.9, 45.8]] }]).features).toHaveLength(0);
  });
});
