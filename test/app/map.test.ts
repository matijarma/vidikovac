// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import {
  linesToGeoJson,
  OSM_ATTRIBUTION,
  OSM_RASTER_URL,
  osmStyle,
  pointsToGeoJson,
  ZAGREB_CENTER,
} from '../../app/src/map/city-map';
import { createMapSlots } from '../../app/src/map/map-slots';

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

describe('map slots', () => {
  const spyFactory = () => {
    const made: { update: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn>; pause: ReturnType<typeof vi.fn> }[] = [];
    const factory = vi.fn(() => {
      const handle = { update: vi.fn(), destroy: vi.fn(), pause: vi.fn() };
      made.push(handle);
      return handle;
    });
    return { factory, made };
  };
  const ask = (maps: ReturnType<typeof createMapSlots>, id: string) =>
    maps.slot({ id, className: 'map-canvas', ariaLabel: `karta ${id}`, points: [], lines: [] });

  it('answers with nothing when the page has no map factory', () => {
    expect(ask(createMapSlots(undefined), 'a')).toBeNull();
  });

  it('creates one map per id and updates it on every later render', () => {
    const { factory, made } = spyFactory();
    const maps = createMapSlots(factory as never);
    const first = ask(maps, 'a')!;
    maps.sweep();
    const second = ask(maps, 'a')!;
    maps.sweep();
    expect(second).toBe(first);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(made[0]!.update).toHaveBeenCalledTimes(1);
    expect(made[0]!.destroy).not.toHaveBeenCalled();
    expect(first.getAttribute('aria-label')).toBe('karta a');
  });

  it('pauses every live map on pause() (R-F6: the frozen dashboard stops both of its maps)', () => {
    const { factory, made } = spyFactory();
    const maps = createMapSlots(factory as never);
    ask(maps, 'a');
    ask(maps, 'b');
    maps.pause();
    expect(made[0]!.pause).toHaveBeenCalledTimes(1);
    expect(made[1]!.pause).toHaveBeenCalledTimes(1);
    expect(() => createMapSlots(undefined).pause()).not.toThrow();
  });

  it('destroys a map no render asked for, and every map on destroy', () => {
    const { factory, made } = spyFactory();
    const maps = createMapSlots(factory as never);
    ask(maps, 'a');
    ask(maps, 'b');
    maps.sweep();
    ask(maps, 'a');
    maps.sweep(); // 'b' was not drawn this time
    expect(made[1]!.destroy).toHaveBeenCalledTimes(1);
    expect(made[0]!.destroy).not.toHaveBeenCalled();
    maps.destroy();
    expect(made[0]!.destroy).toHaveBeenCalledTimes(1);
    // A map that came back after a destroy is a new one.
    ask(maps, 'a');
    expect(factory).toHaveBeenCalledTimes(3);
  });
});
