// One map component for the whole app: an open raster basemap with vehicles as
// circles and closures as lines.
//
// PRODUCTION NOTE: tile.openstreetmap.org is the OSMF community tile server. Its
// tile usage policy forbids heavy or app-like traffic, so before any public
// screen runs unattended this URL must move to a provider with a usage policy
// that covers applications (MapTiler, Protomaps on our own R2, or a self-hosted
// renderer). The attribution line below stays whatever happens; only the URL and
// the extra provider credit change.
export const OSM_RASTER_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
export const OSM_ATTRIBUTION = '© OpenStreetMap contributors';
/** [lon, lat], GeoJSON order, Trg bana Jelačića. */
export const ZAGREB_CENTER: [number, number] = [15.98, 45.815];

export interface MapPoint {
  id: string;
  lon: number;
  lat: number;
  title: string;
  routeId?: string;
}

export interface MapLine {
  id: string;
  title: string;
  coordinates: [number, number][];
}

export interface OsmStyle {
  version: 8;
  sources: { osm: { type: 'raster'; tiles: string[]; tileSize: 256; attribution: string } };
  layers: { id: 'osm'; type: 'raster'; source: 'osm' }[];
}

export function osmStyle(): OsmStyle {
  return {
    version: 8,
    sources: {
      osm: { type: 'raster', tiles: [OSM_RASTER_URL], tileSize: 256, attribution: OSM_ATTRIBUTION },
    },
    layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
  };
}

export interface PointFeatureCollection {
  type: 'FeatureCollection';
  features: {
    type: 'Feature';
    geometry: { type: 'Point'; coordinates: [number, number] };
    properties: { id: string; title: string; routeId?: string };
  }[];
}

export interface LineFeatureCollection {
  type: 'FeatureCollection';
  features: {
    type: 'Feature';
    geometry: { type: 'LineString'; coordinates: [number, number][] };
    properties: { id: string; title: string };
  }[];
}

export function pointsToGeoJson(points: readonly MapPoint[]): PointFeatureCollection {
  return {
    type: 'FeatureCollection',
    features: points
      .filter((p) => Number.isFinite(p.lon) && Number.isFinite(p.lat))
      .map((p) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [p.lon, p.lat] as [number, number] },
        properties: p.routeId === undefined ? { id: p.id, title: p.title } : { id: p.id, title: p.title, routeId: p.routeId },
      })),
  };
}

export function linesToGeoJson(lines: readonly MapLine[]): LineFeatureCollection {
  return {
    type: 'FeatureCollection',
    features: lines
      .filter((l) => l.coordinates.length >= 2 && l.coordinates.every(([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat)))
      .map((l) => ({
        type: 'Feature' as const,
        geometry: { type: 'LineString' as const, coordinates: l.coordinates },
        properties: { id: l.id, title: l.title },
      })),
  };
}

export interface CityMapOptions {
  container: HTMLElement;
  ariaLabel: string;
  points?: MapPoint[];
  lines?: MapLine[];
  reducedMotion?: boolean;
}

export interface CityMapHandle {
  update(points: MapPoint[], lines: MapLine[]): void;
  destroy(): void;
}

// Contract: installed maplibre-gl is ^5 (GHSA-jrc7-96c5-q579, a sanitizer XSS
// bypass fixed only in 6.9.0+ — tracked as a separate major-version upgrade,
// not done here). Until that upgrade lands, no caller of a MapFactory may pass
// feed-derived (external) text into a MapLibre Popup or marker HTML; this
// wrapper itself only ever hands MapLibre the static OSM_ATTRIBUTION string.
export type MapFactory = (options: CityMapOptions) => CityMapHandle;

export function createCityMap(options: CityMapOptions): CityMapHandle {
  let points = options.points ?? [];
  let lines = options.lines ?? [];
  let disposed = false;
  let apply: (() => void) | null = null;
  let destroyMap: (() => void) | null = null;

  options.container.setAttribute('role', 'img');
  options.container.setAttribute('aria-label', options.ariaLabel);

  void (async () => {
    const { AttributionControl, Map, NavigationControl } = await import('./maplibre-entry');
    if (disposed) return;
    const map = new Map({
      container: options.container,
      style: osmStyle() as never,
      center: ZAGREB_CENTER,
      zoom: 12,
      attributionControl: false,
      // The ring on the kiosk is the only continuous motion in the product.
      fadeDuration: options.reducedMotion ? 0 : 300,
    });
    map.addControl(new AttributionControl({ compact: false, customAttribution: OSM_ATTRIBUTION }));
    map.addControl(new NavigationControl({ showCompass: false }), 'top-right');
    destroyMap = () => map.remove();

    map.on('load', () => {
      map.addSource('vehicles', { type: 'geojson', data: pointsToGeoJson(points) as never });
      map.addSource('closures', { type: 'geojson', data: linesToGeoJson(lines) as never });
      map.addLayer({
        id: 'closures',
        type: 'line',
        source: 'closures',
        paint: { 'line-width': 4, 'line-color': '#c13d3d' },
      });
      map.addLayer({
        id: 'vehicles',
        type: 'circle',
        source: 'vehicles',
        paint: { 'circle-radius': 5, 'circle-color': '#7cd4ff', 'circle-stroke-width': 1, 'circle-stroke-color': '#0b1020' },
      });
      apply = () => {
        (map.getSource('vehicles') as { setData(d: unknown): void } | undefined)?.setData(pointsToGeoJson(points));
        (map.getSource('closures') as { setData(d: unknown): void } | undefined)?.setData(linesToGeoJson(lines));
      };
      apply();
    });
  })();

  return {
    update(nextPoints, nextLines) {
      points = nextPoints;
      lines = nextLines;
      apply?.();
    },
    destroy() {
      disposed = true;
      apply = null;
      destroyMap?.();
    },
  };
}
