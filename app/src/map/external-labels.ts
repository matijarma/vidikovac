import { vetExternal } from '../../../shared/kiosk/external-text-boundary';
import type { StyleLayerLike } from './basemap';

export interface TileLabelFeature {
  type: string;
  geometry: unknown;
  properties: Record<string, unknown> | null;
}
export interface LabelSource { id: string; source: string; sourceLayer: string }

/** Vector-tile text cannot call a JS validator inside a style expression.
 * Wall symbol layers therefore read only a vetted GeoJSON copy. They start
 * empty, retain their filters/geometry/type tiers, and never render raw names. */
export function wallLabelLayers(layers: readonly StyleLayerLike[]): { layers: StyleLayerLike[]; sources: LabelSource[] } {
  const sources = new Map<string, LabelSource>();
  return {
    layers: layers.map(layer => {
      if (!layer.source || !layer['source-layer'] || !layer.layout?.['text-field']) return layer;
      const sourceLayer = layer['source-layer'];
      const id = `wall-labels:${layer.source}:${sourceLayer}`;
      sources.set(id, { id, source: layer.source, sourceLayer });
      const { 'source-layer': _unused, ...copy } = layer;
      return { ...copy, source: id, layout: { ...layer.layout, 'text-field': ['get', 'wallText'] } };
    }),
    // The map() above populates the sources before this property is evaluated.
    sources: [...sources.values()],
  };
}

export function vettedTileLabels(features: readonly TileLabelFeature[], locale: string): { type: 'FeatureCollection'; features: TileLabelFeature[] } {
  const seen = new Set<string>();
  const kept: TileLabelFeature[] = [];
  for (const feature of features) {
    const props = feature.properties ?? {};
    const value = props[locale.startsWith('en') ? 'name:en' : 'name:hr'] ?? props.name;
    const text = vetExternal('name', value, 'row');
    if (text === null) continue;
    // Only wallText is displayable. Other properties retain the original
    // layer filters (road kind, rank, population), not a fallback text path.
    const next = { type: 'Feature', geometry: feature.geometry, properties: { ...props, wallText: text } };
    const key = JSON.stringify(next);
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(next);
  }
  return { type: 'FeatureCollection', features: kept };
}

/** Keep tile enumeration and copying with the lazy renderer, not the phone's
 * startup graph. The returned style has empty safe sources before first paint. */
export function prepareWallStyle<T extends { layers: StyleLayerLike[]; sources: object }>(original: T) {
  const vetted = wallLabelLayers(original.layers);
  const signatures = new Map<string, string>();
  return {
    style: { ...original, layers: vetted.layers, sources: { ...original.sources,
      ...Object.fromEntries(vetted.sources.map(({ id }) => [id, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } }])) } },
    refresh(map: {
      querySourceFeatures?(source: string, options: { sourceLayer: string }): TileLabelFeature[];
      getSource(id: string): { setData(data: unknown): void } | undefined;
    }, locale: string): void {
      if (!map.querySourceFeatures) return;
      for (const { id, source, sourceLayer } of vetted.sources) {
        const data = vettedTileLabels(map.querySourceFeatures(source, { sourceLayer }), locale);
        const signature = JSON.stringify(data);
        if (signatures.get(id) === signature) continue;
        signatures.set(id, signature);
        map.getSource(id)?.setData(data);
      }
    },
  };
}
