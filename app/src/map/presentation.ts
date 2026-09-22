/** CSS pixels, independent of canvas size and devicePixelRatio. A small
 * visual symbol keeps a finger-sized hit tolerance on a handheld. */
export type MapPresentation = 'handheld' | 'desktop' | 'public-display';
export const MAP_PRESENTATIONS = Object.freeze({
  handheld: { symbolScale: 1, hitTolerancePx: 22, placeClusterPx: 48 },
  desktop: { symbolScale: 1, hitTolerancePx: 8, placeClusterPx: 48 },
  'public-display': { symbolScale: 2, hitTolerancePx: 28, placeClusterPx: 72 },
});
