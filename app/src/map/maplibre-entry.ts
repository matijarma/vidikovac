// The only module that imports MapLibre, and the only one that imports the
// style builder (@protomaps/basemaps, through ./basemap) and the overlay
// layer specs (./overlays). city-map.ts reaches all three with one dynamic
// import, so neither the unit tests nor the pages that show no map -- the
// lightweight path above all (R-L2, test/app/budget.test.ts) -- ever load
// the library, its stylesheet, the layer generator or the SDF rasteriser.
import 'maplibre-gl/dist/maplibre-gl.css';
import '../../../shared/kiosk/external-text';
// MapLibre v6 is ESM-only: Vite bundles the worker and its shared chunk, and
// core/map-worker.ts names them through setWorkerUrl. Imported here and only
// here, so the lightweight graph never carries either file.
import '../core/map-worker';
export { AttributionControl, GeolocateControl, LngLatBounds, Map, NavigationControl, ScaleControl } from 'maplibre-gl';

let webgl2: boolean | undefined;
/**
 * Whether this browser gives a canvas a WebGL2 context, the one MapLibre v6 draws with. Without it v6's Map
 * constructor no longer throws: it reports a GPUInitializationError on the map's error event and returns a map
 * with no painter, whose resize() and remove() then throw (a still map on Sada, torn down when Karta opened,
 * broke the page's render). city-map.ts asks this before it builds a map and takes its no-map path instead.
 * One probe per page; its context is released at once.
 */
export function webgl2Available(): boolean {
  if (webgl2 !== undefined) return webgl2;
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    webgl2 = gl !== null;
  } catch {
    webgl2 = false;
  }
  return webgl2;
}
export * from './basemap';
export * from './overlays';
export * from './city-layers';
export * from './name-census';
export * from './external-labels';
export * from './external-features';
export * from './vehicle-features';
export * from './map-pointer';
