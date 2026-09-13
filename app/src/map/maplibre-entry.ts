// The only module that imports MapLibre. city-map.ts reaches it with a dynamic
// import, so neither the unit tests nor the pages that show no map ever load the
// library or its stylesheet.
import 'maplibre-gl/dist/maplibre-gl.css';
import '../core/map-worker';
export { AttributionControl, Map, NavigationControl } from 'maplibre-gl';
