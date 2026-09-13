// MapLibre v6 is ESM-only. Vite must bundle the worker and its sibling shared
// module, not rely on import.meta.url inside an optimised dependency.
// This module is imported only by the lazy map entry, never by lightweight UI.
import { setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

setWorkerUrl(workerUrl);
