import { describe, expect, it } from 'vitest';
import { MAP_CONFIG } from '../../app/src/core/contracts';
import {
  BASEMAP_SOURCE,
  MAP_ATTRIBUTION_HTML,
  MAP_FONTS,
  MAP_MAX_ZOOM,
  MAP_MIN_ZOOM,
  OVERLAY_DARK,
  OVERLAY_LIGHT,
  PROZOR_ARCMIN_PER_PX,
  PROZOR_DROPPED_LAYERS,
  PROZOR_LABEL_PADDING_PX,
  PROZOR_MAJOR_ROAD_DETAILS,
  PROZOR_RECOGNITION_ARCMIN,
  PROZOR_TEXT_MAX_PX,
  PROZOR_TEXT_MIN_PX,
  SPRITE_V4_ICONS,
  basemapLayers,
  basemapStyle,
  flavorFor,
  haloCap,
  labelLanguage,
  maxBounds,
  prozorArcminutes,
  spriteUrl,
  styleDiff,
  textSizeAt,
  type MapTheme,
  type StyleLayerLike,
} from '../../app/src/map/basemap';
import { overlayLayers, type ProzorOptions } from '../../app/src/map/overlays';
import { KIOSK_SYMBOL_SCALE, LABEL_PADDING_TILE_PX } from '../../app/src/kiosk/mapview';
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
/** `ink` laid over `ground` at `alpha`, as the eye sees a translucent line. */
function over(ink: string, ground: string, alpha: number): string {
  const mix = (i: number): string => {
    const a = parseInt(ink.slice(1 + 2 * i, 3 + 2 * i), 16);
    const b = parseInt(ground.slice(1 + 2 * i, 3 + 2 * i), 16);
    return Math.round(a * alpha + b * (1 - alpha)).toString(16).padStart(2, '0');
  };
  return `#${mix(0)}${mix(1)}${mix(2)}`;
}

describe('the same-origin Protomaps v4 basemap', () => {
  it('builds a style whose only source is MAP_CONFIG’s tiles, glyphs and sprite on this origin, with the linked credit', () => {
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

  // D7: no reproducible glyph tooling builds on this host (fontnik needs cmake
  // and a C++ toolchain; maplibre's font-maker is a browser page with no CLI),
  // so both profiles ask for the three Noto Sans faces the glyph endpoint
  // carries and nothing else.
  it('reads only Protomaps v4 source layers and asks the glyph endpoint only for the three self-hosted Noto Sans faces, on both profiles', () => {
    const layers = basemapLayers('light', { locale: 'hr' });
    const sourceLayers = new Set(layers.map((l) => l['source-layer']).filter(Boolean));
    for (const sl of sourceLayers) expect(['earth', 'landcover', 'landuse', 'water', 'buildings', 'roads', 'boundaries', 'places', 'pois', 'transit']).toContain(sl);
    expect(sourceLayers.has('roads')).toBe(true);
    expect(sourceLayers.has('water')).toBe(true);
    expect(sourceLayers.has('places')).toBe(true);
    const fontsOf = (list: StyleLayerLike[]): string[] => {
      const fonts = new Set(JSON.stringify(list).match(/Noto Sans [A-Za-z ]+?(?=")/g));
      fonts.delete('Noto Sans Devanagari Regular v1'); // an expression branch only a Devanagari script feature could take
      return [...fonts].sort();
    };
    const stack = [MAP_FONTS.italic, MAP_FONTS.medium, MAP_FONTS.regular].sort();
    expect(fontsOf(layers)).toEqual(stack);
    expect(fontsOf(basemapLayers('light', { profile: 'prozor' }))).toEqual(stack);
    expect(JSON.stringify(basemapLayers('light', { profile: 'prozor' }))).not.toContain('Manrope');
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
    expect(flavorFor('light').water).toBe('#c3cbe8');
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

describe('place labels on a thumbnail (kajimafix 01.8)', () => {
  it('drops every places_* layer when asked, and keeps them by default; both faces drop the same layers so the theme diff stays whole', () => {
    const all = basemapLayers('light', { origin: ORIGIN });
    const places = all.filter((l) => l.id.startsWith('places_'));
    expect(places.length).toBeGreaterThan(0);
    const bare = basemapLayers('light', { origin: ORIGIN, placeLabels: false });
    expect(bare.some((l) => l.id.startsWith('places_'))).toBe(false);
    expect(bare).toHaveLength(all.length - places.length);
    expect(styleDiff(bare, basemapLayers('dark', { origin: ORIGIN, placeLabels: false })).every((op) => !op.id.startsWith('places_'))).toBe(true);
  });
});

// The public screen's basemap (plan D3, D12; R-KP3): the tram rails, the
// vehicles and the screen's stop are the figure, drawn by the overlays; this
// profile is the ground under them. Two landuse tones, hairline streets,
// faint blocks, no POIs, no minor labels, the neighbourhood names kept.
describe('the prozor basemap profile: the ground under the figure, readable from three metres', () => {
  /** Every zoom the archive covers, in quarter steps: the field's clamp (13.5…15.5) sits inside it. */
  const ZOOMS: number[] = [];
  for (let z = MAP_MIN_ZOOM; z <= MAP_MAX_ZOOM; z += 0.25) ZOOMS.push(Number(z.toFixed(2)));
  const layersOf = (theme: MapTheme): StyleLayerLike[] => basemapLayers(theme, { profile: 'prozor' });
  const byId = (layers: StyleLayerLike[], id: string): StyleLayerLike => {
    const layer = layers.find((l) => l.id === id);
    if (!layer) throw new Error(`no layer ${id}`);
    return layer;
  };
  /** The subset of the expression language a fill colour uses, over one feature's properties: what colour this kind of landuse gets. */
  function colourOf(expr: unknown, props: Record<string, unknown>): string {
    if (typeof expr === 'string') return expr;
    if (!Array.isArray(expr)) throw new Error(`not a colour: ${JSON.stringify(expr)}`);
    const [op, ...args] = expr as [string, ...unknown[]];
    const value = (e: unknown): unknown => (Array.isArray(e) && e[0] === 'get' ? props[e[1] as string] : Array.isArray(e) && e[0] === 'literal' ? e[1] : e);
    const truth = (e: unknown): boolean => {
      if (!Array.isArray(e)) return Boolean(e);
      if (e[0] === 'in') return (value(e[2]) as unknown[]).includes(value(e[1]));
      if (e[0] === '==') return value(e[1]) === value(e[2]);
      throw new Error(`unhandled test ${e[0]}`);
    };
    if (op === 'case') {
      for (let i = 0; i + 1 < args.length; i += 2) if (truth(args[i])) return colourOf(args[i + 1], props);
      return colourOf(args[args.length - 1], props);
    }
    throw new Error(`unhandled operator ${op}`);
  }
  const TONES: Record<MapTheme, { ground: string; green: string; blocks: string; water: string }> = {
    light: { ground: '#f4f2ec', green: '#dfe4cf', blocks: '#ebe8df', water: '#c3cbe8' },
    dark: { ground: '#0b1150', green: '#12275c', blocks: '#121a63', water: '#060a3a' },
  };

  it('shares one layer list across the faces, drops what a café guest cannot use, and paints every landuse in two tones under blocks one step off the ground', () => {
    const light = layersOf('light');
    const dark = layersOf('dark');
    expect(dark.map((l) => l.id)).toEqual(light.map((l) => l.id));
    const ops = styleDiff(light, dark);
    expect(ops.length).toBeGreaterThan(10);
    expect(ops.every((op) => op.kind === 'paint')).toBe(true);

    const ids = light.map((l) => l.id);
    for (const dropped of PROZOR_DROPPED_LAYERS) expect(ids, dropped).not.toContain(dropped);
    expect(ids).not.toContain('pois');
    for (const id of ids) {
      expect(id.startsWith('roads_tunnels_'), id).toBe(false);
      expect(id.endsWith('_casing'), id).toBe(false);
    }
    // The default keeps every one of them: the phone and the kvart thumbnail are untouched.
    const plain = basemapLayers('light').map((l) => l.id);
    for (const dropped of PROZOR_DROPPED_LAYERS) expect(plain, dropped).toContain(dropped);
    expect(plain.some((id) => id.endsWith('_casing'))).toBe(true);
    expect(plain.some((id) => id.startsWith('roads_tunnels_'))).toBe(true);

    for (const theme of ['light', 'dark'] as const) {
      const layers = layersOf(theme);
      const tones = TONES[theme];
      const allowed = new Set([tones.ground, tones.green, tones.blocks]);
      const fills = layers.filter((l) => l.type === 'fill' && (l['source-layer'] === 'landuse' || l.id === 'earth' || l.id === 'buildings'));
      expect(fills.length).toBeGreaterThan(8);
      for (const layer of fills) {
        for (const hex of JSON.stringify(layer.paint!['fill-color']).match(/#[0-9a-f]{6}/gi) ?? []) expect(allowed.has(hex.toLowerCase()), `${theme} ${layer.id} ${hex}`).toBe(true);
      }
      expect(byId(layers, 'buildings').paint!['fill-color']).toBe(tones.blocks);
      expect(byId(layers, 'buildings').paint!['fill-opacity']).toBe(1);
      expect(byId(layers, 'buildings').minzoom).toBe(basemapLayers(theme).find((l) => l.id === 'buildings')!.minzoom);
      expect(byId(layers, 'water').paint!['fill-color']).toBe(tones.water);
      // The park layer sorts its kinds itself: vegetation green, a barracks and
      // an airfield the ground (upstream paints those from the zoo key).
      const park = byId(layers, 'landuse_park').paint!['fill-color'];
      for (const kind of ['park', 'cemetery', 'wood', 'scrub', 'grass', 'sand', 'glacier']) expect(colourOf(park, { kind }), `${theme} ${kind}`).toBe(tones.green);
      for (const kind of ['military', 'naval_base', 'airfield']) expect(colourOf(park, { kind }), `${theme} ${kind}`).toBe(tones.ground);
      for (const id of ['landuse_hospital', 'landuse_school', 'landuse_industrial', 'landuse_pedestrian', 'landuse_pier', 'landuse_aerodrome', 'landuse_runway']) {
        expect(byId(layers, id).paint!['fill-color'], `${theme} ${id}`).toBe(tones.ground);
      }
      for (const id of ['landuse_zoo', 'landuse_beach']) expect(byId(layers, id).paint!['fill-color'], `${theme} ${id}`).toBe(tones.green);
      // Allotments and playgrounds are the same green, not a third tone at 0.7.
      expect(byId(layers, 'landuse_urban_green').paint!['fill-opacity']).toBe(1);
      // Blocks and green step off the ground, but stay in its family: texture, not figure.
      expect(contrast(tones.blocks, tones.ground)).toBeGreaterThan(1.05);
      expect(contrast(tones.blocks, tones.ground)).toBeLessThan(1.6);
      expect(contrast(tones.green, tones.ground)).toBeGreaterThan(1.05);
      expect(contrast(tones.green, tones.ground)).toBeLessThan(1.6);
    }
  });

  // D12, R-KP3: streets are ground texture, never the figure. By day they are
  // one step darker than the paper (paper on white left 1.09:1, invisible at
  // three metres); by night a whisper for the minor ones and paper at a
  // quarter for the majors, so Ilica and Savska orient the eye.
  it('draws streets as hairlines of ink by day and a whisper and translucent paper by night, majors over minors over nothing, bridges exactly as their surface roads, the railway as upstream left it', () => {
    const inks = {
      light: { minor: '#0c1250', minorOpacity: 0.18, major: '#0c1250', majorOpacity: 0.34 },
      dark: { minor: '#1a2373', minorOpacity: 1, major: '#f4f2ec', majorOpacity: 0.25 },
    };
    for (const theme of ['light', 'dark'] as const) {
      const layers = layersOf(theme);
      const ink = inks[theme];
      const minor = byId(layers, 'roads_minor');
      const major = byId(layers, 'roads_major');
      const highway = byId(layers, 'roads_highway');
      expect(minor.paint!['line-color']).toBe(ink.minor);
      expect(minor.paint!['line-opacity']).toBe(ink.minorOpacity);
      expect(major.paint!['line-color']).toBe(ink.major);
      expect(major.paint!['line-opacity']).toBe(ink.majorOpacity);
      expect(highway.paint!['line-color']).toBe(ink.major);
      expect(highway.paint!['line-opacity']).toBe(ink.majorOpacity);
      // Widths at the two ends of the field's zoom range: a hairline, a line, a heavier line.
      for (const [zoom, m, M, H] of [[13.5, 0.8, 1.6, 2], [15.5, 1.2, 2.4, 3]] as const) {
        expect(textSizeAt(minor.paint!['line-width'], zoom), `${theme} minor @${zoom}`).toBeCloseTo(m, 5);
        expect(textSizeAt(major.paint!['line-width'], zoom), `${theme} major @${zoom}`).toBeCloseTo(M, 5);
        expect(textSizeAt(highway.paint!['line-width'], zoom), `${theme} highway @${zoom}`).toBeCloseTo(H, 5);
      }
      for (const id of ['roads_link', 'roads_bridges_minor', 'roads_bridges_link', 'roads_bridges_other']) {
        const layer = byId(layers, id);
        expect(layer.paint!['line-color'], `${theme} ${id}`).toBe(ink.minor);
        expect(layer.paint!['line-opacity'], `${theme} ${id}`).toBe(ink.minorOpacity);
        expect(layer.paint!['line-width'], `${theme} ${id}`).toEqual(minor.paint!['line-width']);
      }
      expect(byId(layers, 'roads_bridges_major').paint).toEqual(major.paint);
      expect(byId(layers, 'roads_bridges_highway').paint).toEqual(highway.paint);
      expect(byId(layers, 'roads_rail').paint).toEqual(basemapLayers(theme).find((l) => l.id === 'roads_rail')!.paint);
      // What the eye meets: the composited street against the ground.
      const ground = TONES[theme].ground;
      const seenMinor = contrast(over(ink.minor, ground, ink.minorOpacity), ground);
      const seenMajor = contrast(over(ink.major, ground, ink.majorOpacity), ground);
      expect(seenMinor, `${theme} minor`).toBeGreaterThan(1.15);
      expect(seenMajor, `${theme} major`).toBeGreaterThan(seenMinor);
      expect(seenMajor, `${theme} major`).toBeGreaterThan(theme === 'dark' ? 2 : 1.5);
      // Texture, never the figure: the tram rails stay well ahead of any street.
      const figure = theme === 'dark' ? OVERLAY_DARK : OVERLAY_LIGHT;
      expect(contrast(over(figure.figure, ground, figure.figureOpacity), ground)).toBeGreaterThan(seenMajor);
    }
  });

  // The one rule of this profile a size table cannot state: every label the
  // screen draws subtends at least ten arcminutes from three metres, and a
  // label that cannot is dropped rather than shrunk. Checked at every zoom the
  // archive covers, so it holds at any camera the field can derive.
  it('keeps four label layers, every one between the ten-arcminute floor and the ceiling at every zoom with a halo the glyph renderer can draw; neighbourhood names lead and at most a few major streets are named', () => {
    // The derivation itself, so a change to the stated geometry is visible here.
    expect(PROZOR_ARCMIN_PER_PX).toBeCloseTo(0.509, 3);
    expect(PROZOR_TEXT_MIN_PX).toBe(20);
    expect(prozorArcminutes(PROZOR_TEXT_MIN_PX)).toBeGreaterThanOrEqual(PROZOR_RECOGNITION_ARCMIN);
    expect(prozorArcminutes(PROZOR_TEXT_MIN_PX - 1)).toBeLessThan(PROZOR_RECOGNITION_ARCMIN);

    for (const theme of ['light', 'dark'] as const) {
      const layers = layersOf(theme);
      const labels = layers.filter((l) => l.type === 'symbol' && l.layout?.['text-size'] !== undefined);
      expect(labels.map((l) => l.id).sort()).toEqual(['places_subplace', 'roads_labels_major', 'water_label_lakes', 'water_label_ocean']);
      expect(layers.some((l) => l.type === 'symbol' && l.layout?.['text-size'] === undefined)).toBe(false); // no icon-only layer (shields, one-way arrows) either
      for (const layer of labels) {
        const halo = layer.paint?.['text-halo-width'];
        expect(typeof halo, layer.id).toBe('number');
        for (const zoom of ZOOMS) {
          if (layer.minzoom !== undefined && zoom < layer.minzoom) continue;
          const size = textSizeAt(layer.layout!['text-size'], zoom);
          expect(Number.isNaN(size), `${layer.id} @ ${zoom}`).toBe(false);
          expect(size, `${layer.id} @ ${zoom}`).toBeGreaterThanOrEqual(PROZOR_TEXT_MIN_PX);
          expect(size, `${layer.id} @ ${zoom}`).toBeLessThanOrEqual(PROZOR_TEXT_MAX_PX);
          expect(halo as number, `${layer.id} @ ${zoom}`).toBeLessThanOrEqual(haloCap(size));
        }
      }
      const flavor = flavorFor(theme, 'prozor');
      const ground = TONES[theme].ground;
      // The 224 neighbourhood names the tiles carry: the biggest words on the ground, in the label role.
      const hood = byId(layers, 'places_subplace');
      expect(textSizeAt(hood.layout!['text-size'], 13.5)).toBe(26);
      expect(textSizeAt(hood.layout!['text-size'], 15.5)).toBe(28);
      expect(hood.layout!['text-transform']).toBe('uppercase');
      expect(hood.layout!['text-letter-spacing']).toBe(0.12);
      expect(hood.layout!['text-padding']).toBe(12);
      expect(hood.layout!['text-font']).toEqual([MAP_FONTS.medium]);
      expect(hood.paint!['text-color']).toBe(theme === 'light' ? '#363d73' : '#b6bbe0');
      expect(flavor.subplace_label).toBe(hood.paint!['text-color']);
      expect(hood.paint!['text-halo-color']).toBe(ground);
      expect(hood.paint!['text-halo-width']).toBe(2);
      // Major street names: the trunk of the hierarchy only, spaced so one field holds a handful.
      const street = byId(layers, 'roads_labels_major');
      expect(street.layout!['text-size']).toBe(22);
      // Tile pixels at z14 (R-KP17): 360 is about 1.7 km between anchors on one street, 24 the collision padding measured on the wall's field.
      expect(street.layout!['symbol-spacing']).toBe(360);
      expect(street.layout!['text-padding']).toBe(PROZOR_LABEL_PADDING_PX);
      // The kiosk keeps its own copy of the literal off this module's graph (mapview.ts labelPadding); the two never drift apart.
      expect(PROZOR_LABEL_PADDING_PX).toBe(LABEL_PADDING_TILE_PX);
      // The kiosk's option set carries a wider padding for a field that shows more ground than the wall's (kiosk/mapview.ts labelPadding); the names' layer alone reads it, the spacing stays the ruling's.
      const wider = byId(basemapLayers(theme, { profile: 'prozor', labelPadding: 48 }), 'roads_labels_major');
      expect(wider.layout!['text-padding']).toBe(48);
      expect(wider.layout!['symbol-spacing']).toBe(360);
      expect(byId(basemapLayers(theme, { profile: 'prozor', labelPadding: 48 }), 'places_subplace').layout!['text-padding']).toBe(12);
      expect(street.layout!['text-font']).toEqual([MAP_FONTS.medium]);
      expect(PROZOR_MAJOR_ROAD_DETAILS).toEqual(['motorway', 'trunk', 'primary', 'secondary']);
      const filter = JSON.stringify(street.filter);
      expect(filter).toContain(JSON.stringify(['in', ['get', 'kind_detail'], ['literal', PROZOR_MAJOR_ROAD_DETAILS]]));
      expect(filter).toContain(JSON.stringify(['literal', ['highway', 'major_road']]));
      expect(street.paint!['text-color']).toBe(theme === 'light' ? '#4a5178' : '#8f96c9');
      expect(street.paint!['text-halo-color']).toBe(ground);
      // The Sava is the best orientation cue this city has: its labels keep the promoted sizes.
      expect(textSizeAt(byId(layers, 'water_label_lakes').layout!['text-size'], 14)).toBe(22);
    }

    // The overlays are drawn at the screen's own symbol scale with the kiosk's
    // option set, and a route number on a plate is read across the same room
    // as a street name.
    const prozor: ProzorOptions = { networkKinds: ['tram'], stopRoutes: ['6'], stopLabelMinRank: 4, overlapZoom: 14.6, labelPadding: 24 };
    for (const layer of overlayLayers(OVERLAY_LIGHT, { scale: KIOSK_SYMBOL_SCALE, prozor })) {
      if (layer.type !== 'symbol' || layer.layout?.['text-size'] === undefined) continue;
      for (const zoom of ZOOMS) {
        if (layer.minzoom !== undefined && zoom < layer.minzoom) continue;
        expect(textSizeAt(layer.layout['text-size'], zoom), `${layer.id} @ ${zoom}`).toBeGreaterThanOrEqual(PROZOR_TEXT_MIN_PX);
      }
    }
  });
});
