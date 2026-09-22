/** CSS pixels, independent of canvas size and devicePixelRatio. A small
 * visual symbol keeps a finger-sized hit tolerance on a handheld.
 * `placeClusters` is false on every surface: the map curates instead of
 * merging places into "+N" bubbles (app/src/city/curated.ts: every BAJS
 * station a counted disc, a venue only with a programme tonight). */
export type MapPresentation = 'handheld' | 'desktop' | 'public-display';
export const MAP_PRESENTATIONS = Object.freeze({
  handheld: { symbolScale: 1, hitTolerancePx: 22, clusterMaxNumbers: 1, placeClusters: false },
  desktop: { symbolScale: 1, hitTolerancePx: 8, clusterMaxNumbers: 2, placeClusters: false },
  'public-display': { symbolScale: 2, hitTolerancePx: 28, clusterMaxNumbers: 1, placeClusters: false },
});
