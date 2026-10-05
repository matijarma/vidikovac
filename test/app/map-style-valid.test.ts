// Every layer the map builds is valid MapLibre style, by the style spec's own validator. MapLibre drops a layer
// whose paint or layout fails validation and only logs it, so an invalid expression is silent in the unit tests
// (no style engine here) and loud on the wall: on 5 Oct 2026 a zoom curve nested inside a `case` in
// city-place-dots (the rail bead) took every BAJS disc and venue off the map until the e2e counted zero of them.
import { describe, expect, it } from 'vitest';
import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import * as basemap from '../../app/src/map/basemap';
import type { StyleLayerLike } from '../../app/src/map/basemap';
import { cityLayers } from '../../app/src/map/city-layers';
import { overlayLayers } from '../../app/src/map/overlays';

/** The validator's messages for a style of these layers over empty GeoJSON sources (glyphs named: a text-field needs them). */
function problems(layers: StyleLayerLike[]): string[] {
  const names = [...new Set(layers.map((l) => (l as { source?: string }).source).filter((s): s is string => typeof s === 'string'))];
  const sources = Object.fromEntries(names.map((s) => [s, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } }]));
  const style = { version: 8, glyphs: 'https://fonts.example/{fontstack}/{range}.pbf', sprite: 'https://sprites.example/s', sources, layers };
  return validateStyleMin(style as never).map((e) => e.message);
}

describe('the map layers are valid MapLibre style (the style spec validator)', () => {
  const faces = ['light', 'dark'] as const;
  it('the city layers, in every labels mode, at both scales, with and without a selection', () => {
    for (const face of faces) {
      const p = basemap.overlayPalette(face);
      for (const labels of ['all', 'venues', 'none'] as const) for (const scale of [1, 2]) for (const selected of [null, 'city-1']) {
        expect(problems(cityLayers(p, selected, scale, labels)), `${face} ${labels} ×${scale} ${selected}`).toEqual([]);
      }
    }
  });
  it('the overlay layers with the default options', () => {
    for (const face of faces) expect(problems(overlayLayers(basemap.overlayPalette(face))), face).toEqual([]);
  });
});
