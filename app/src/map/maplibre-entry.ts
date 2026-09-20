// The only module that imports MapLibre, and the only one that imports the
// style builder (@protomaps/basemaps, through ./basemap) and the overlay
// layer specs (./overlays). city-map.ts reaches all three with one dynamic
// import, so neither the unit tests nor the pages that show no map -- the
// lightweight path above all (R-L2, test/app/budget.test.ts) -- ever load
// the library, its stylesheet, the layer generator or the SDF rasteriser.
import 'maplibre-gl/dist/maplibre-gl.css';
// MapLibre v6 is ESM-only: Vite bundles the worker and its shared chunk, and
// core/map-worker.ts names them through setWorkerUrl. Imported here and only
// here, so the lightweight graph never carries either file.
import '../core/map-worker';
export { AttributionControl, GeolocateControl, LngLatBounds, Map, NavigationControl, ScaleControl } from 'maplibre-gl';
export * from './basemap';
export * from './overlays';
export * from './city-layers';
