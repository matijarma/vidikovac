import { describe, expect, it } from 'vitest';
import { MAP_CONFIG } from '../../app/src/core/contracts';
import {
  BASEMAP_SOURCE,
  MAP_ATTRIBUTION_HTML,
  MAP_FONTS,
  OVERLAY_DARK,
  OVERLAY_LIGHT,
  SPRITE_V4_ICONS,
  basemapLayers,
  basemapStyle,
  flavorFor,
  labelLanguage,
  maxBounds,
  spriteUrl,
  styleDiff,
} from '../../app/src/map/basemap';
import { deltaE, hexToLinear } from './oklab';

const ORIGIN = 'https://zagreb.example';

/** WCAG relative luminance of a #rrggbb colour. */
function luminance(hex: string): number {
  const channel = (i: number): number => {
    const c = parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}
function contrast(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (l1 + 0.05) / (l2 + 0.05);
}

describe('the same-origin Protomaps v4 basemap', () => {
  it('builds a style whose only source is MAP_CONFIG\u2019s tiles, glyphs and sprite on this origin, with the linked credit', () => {
    const style = basemapStyle('light', { origin: ORIGIN });
    expect(style.version).toBe(8);
    expect(Object.keys(style.sources)).toEqual([BASEMAP_SOURCE]);
    const source = style.sources[BASEMAP_SOURCE]!;
    expect(source.tiles).toEqual([`${ORIGIN}${MAP_CONFIG.tiles}`]);
    expect(source.bounds).toEqual(MAP_CONFIG.bounds);
    expect(source.minzoom).toBe(MAP_CONFIG.minzoom);
    expect(source.maxzoom).toBe(MAP_CONFIG.maxzoom);
    expect(source.attribution).toBe(MAP_ATTRIBUTION_HTML);
    expect(MAP_ATTRIBUTION_HTML).toContain('href="https://www.openstreetmap.org/copyright"');
    expect(MAP_ATTRIBUTION_HTML).toContain('© OpenStreetMap contributors');
    expect(style.glyphs).toBe(`${ORIGIN}${MAP_CONFIG.glyphs}`);
    expect(style.sprite).toBe(`${ORIGIN}${MAP_CONFIG.sprite}`);
    expect(spriteUrl('dark', ORIGIN)).toBe(`${ORIGIN}${MAP_CONFIG.darkSprite}`);
    // Nothing reaches a third-party host: every URL in the style is ours.
    const urls = JSON.stringify(style).match(/https?:\/\/[^"'\s]+/g) ?? [];
    for (const url of urls) expect(url.startsWith(ORIGIN) || url.startsWith('https://www.openstreetmap.org/') || url.startsWith('https://protomaps.com')).toBe(true);
  });

  it('reads only Protomaps v4 source layers and asks the glyph endpoint only for the three self-hosted Noto Sans faces', () => {
    const layers = basemapLayers('light', { locale: 'hr' });
    const sourceLayers = new Set(layers.map((l) => l['source-layer']).filter(Boolean));
    for (const sl of sourceLayers) expect(['earth', 'landcover', 'landuse', 'water', 'buildings', 'roads', 'boundaries', 'places', 'pois', 'transit']).toContain(sl);
    expect(sourceLayers.has('roads')).toBe(true);
    expect(sourceLayers.has('water')).toBe(true);
    expect(sourceLayers.has('places')).toBe(true);
    const fonts = new Set(JSON.stringify(layers).match(/Noto Sans [A-Za-z ]+?(?=")/g));
    fonts.delete('Noto Sans Devanagari Regular v1'); // an expression branch only a Devanagari script feature could take
    expect([...fonts].sort()).toEqual([MAP_FONTS.italic, MAP_FONTS.medium, MAP_FONTS.regular].sort());
    for (const layer of layers) expect(layer.source ?? BASEMAP_SOURCE).toBe(BASEMAP_SOURCE);
  });

  it('labels in Croatian by default and in English for an English page', () => {
    expect(labelLanguage('hr')).toBe('hr');
    expect(labelLanguage(undefined)).toBe('hr');
    expect(labelLanguage('en-GB')).toBe('en');
    const hr = JSON.stringify(basemapLayers('light', { locale: 'hr' }));
    const en = JSON.stringify(basemapLayers('light', { locale: 'en' }));
    expect(hr).toContain('name:hr');
    expect(en).toContain('name:en');
    expect(hr).not.toBe(en);
  });

  it('the two faces share one layer list and differ only in paint, so a theme flip is a paint diff and never a setStyle', () => {
    const light = basemapLayers('light');
    const dark = basemapLayers('dark');
    expect(dark.map((l) => l.id)).toEqual(light.map((l) => l.id));
    const ops = styleDiff(light, dark);
    expect(ops.length).toBeGreaterThan(20);
    expect(ops.every((op) => op.kind === 'paint')).toBe(true);
    expect(styleDiff(light, light)).toEqual([]);
    // Product colours, not the upstream flavour: the dark face's ground is ultramarine ink, the light face's water a paper-family blue.
    expect(flavorFor('dark').earth).toBe('#0b1150');
    expect(flavorFor('light').water).toBe('#cdd3ea');
    expect(flavorFor('light').regular).toBe(MAP_FONTS.regular);
    expect(flavorFor('dark').bold).toBe(MAP_FONTS.medium);
  });

  // R-D3: one Zagreb blue for trams (the accent role) and ink for buses (the
  // transit role, which equals ink in the light face); land moves from
  // mineral green to paper by day and ultramarine by night.
  it('paints trams in the accent blue and buses in ink, in both faces (R-D3)', () => {
    expect(OVERLAY_LIGHT.tram).toBe('#03409c');
    expect(OVERLAY_LIGHT.bus).toBe('#0c1250');
    expect(OVERLAY_LIGHT.routeTram).toBe('#03409c');
    expect(OVERLAY_LIGHT.routeBus).toBe('#0c1250');
    expect(OVERLAY_LIGHT.closure).toBe('#b3271e');
    expect(OVERLAY_LIGHT.stopFill).toBe('#f4f2ec');
    expect(OVERLAY_LIGHT.label).toBe('#0c1250');
    expect(OVERLAY_LIGHT.halo).toBe('#fbfaf6');
    expect(OVERLAY_LIGHT.selection).toBe('#0c1250');
    expect(OVERLAY_LIGHT.screenStop).toBe('#03409c');
    expect(OVERLAY_DARK.tram).toBe('#f4f2ec');
    expect(OVERLAY_DARK.tramText).toBe('#0b1150');
    expect(OVERLAY_DARK.bus).toBe('#9fb4ff');
    expect(OVERLAY_DARK.busText).toBe('#0b1150');
    expect(OVERLAY_DARK.routeTram).toBe('#f4f2ec');
    expect(OVERLAY_DARK.routeBus).toBe('#9fb4ff');
    expect(OVERLAY_DARK.closure).toBe('#ff9d9d');
    expect(OVERLAY_DARK.label).toBe('#f4f2ec');
    expect(OVERLAY_DARK.halo).toBe('#0b1150');
    expect(deltaE(hexToLinear(OVERLAY_LIGHT.tram), hexToLinear(OVERLAY_LIGHT.bus))).toBeGreaterThanOrEqual(0.1);
    expect(deltaE(hexToLinear(OVERLAY_DARK.tram), hexToLinear(OVERLAY_DARK.bus))).toBeGreaterThanOrEqual(0.1);
  });

  it('keeps the camera inside the archive: maxBounds pads MAP_CONFIG.bounds by a hair on every side', () => {
    const [[w, s], [e, n]] = maxBounds();
    expect(w).toBeLessThan(MAP_CONFIG.bounds[0]);
    expect(s).toBeLessThan(MAP_CONFIG.bounds[1]);
    expect(e).toBeGreaterThan(MAP_CONFIG.bounds[2]);
    expect(n).toBeGreaterThan(MAP_CONFIG.bounds[3]);
  });

  it('every route number reads at 4.5:1 on its pill, in both faces', () => {
    for (const p of [OVERLAY_LIGHT, OVERLAY_DARK]) {
      expect(contrast(p.tram, p.tramText)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(p.bus, p.busText)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(p.other, p.otherText)).toBeGreaterThanOrEqual(4.5);
      // The inverted pill of a route that is not the selected one: its own colour as the number on the surface.
      expect(contrast(p.tram, p.stopFill)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(p.bus, p.stopFill)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(p.other, p.stopFill)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(p.label, p.halo)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(p.closure, p.closureCasing)).toBeGreaterThanOrEqual(3);
    }
  });

  // One peacock and one blue on the map. A route line has no shape to help it
  // the way a badge does, so the two fills have to stay apart in the space a
  // person perceives (OKLab distance, the same maths the contrast test uses).
  // The plan asks for 0.10 in both faces (R-D6: the dark bus carries the blue
  // the dark map already drew, #9fb4ff, so badge, pill and route line agree).
  it('keeps the tram and bus route fills apart in OKLab, so a glance tells the mode', () => {
    const apart = (p: { routeTram: string; routeBus: string }): number => deltaE(hexToLinear(p.routeTram), hexToLinear(p.routeBus));
    expect(apart(OVERLAY_LIGHT)).toBeGreaterThanOrEqual(0.1);
    expect(apart(OVERLAY_DARK)).toBeGreaterThanOrEqual(0.1);
  });

  it('asks the sprite only for icons it carries: the pois layer names a kind as its icon only when SPRITE_V4_ICONS has it, and the one kind upstream admits without an image (townhall) keeps its label alone', () => {
    const pois = basemapLayers('light').find((l) => l.id === 'pois')!;
    const icon = pois.layout!['icon-image'] as unknown[];
    expect(icon[0]).toBe('case');
    expect(JSON.stringify(icon)).toContain(JSON.stringify(['in', ['get', 'kind'], ['literal', SPRITE_V4_ICONS]]));
    expect(icon[icon.length - 1]).toBe('');
    // ['all', ['in', ['get','kind'], ['literal', [...kinds]]], ...]: the admitted kinds sit inside the literal.
    const inClause = (pois.filter as unknown[])[1] as unknown[];
    const admitted = (inClause[2] as unknown[])[1] as string[];
    expect(admitted.length).toBeGreaterThan(30);
    const withoutImage = admitted.filter((kind) => kind !== 'station' && !SPRITE_V4_ICONS.includes(kind));
    expect(withoutImage).toEqual(['townhall']);
    expect(SPRITE_V4_ICONS).toContain('train_station');
  });
});
