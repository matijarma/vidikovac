import { describe, expect, it } from 'vitest';
import { OVERLAY_DARK, OVERLAY_LIGHT, basemapLayers, styleDiff } from '../../app/src/map/basemap';
import {
  BELOW_LABELS,
  LAYERS,
  NEVER,
  PILL_MAX_CHARS,
  PILL_OVERLAP_ZOOM,
  PILL_ZOOM,
  SOURCES,
  firstSymbolLayer,
  overlayImages,
  overlayLayers,
  pillInks,
  selectionFilters,
  stopFilter,
  vehicleFilter,
  vehicleKinds,
} from '../../app/src/map/overlays';
import { ROUTE_TYPE_BUS, ROUTE_TYPE_TRAM } from '../../app/src/motion/schematic';

const layerById = (id: string) => overlayLayers(OVERLAY_LIGHT).find((l) => l.id === id)!;

describe('the overlay layer list', () => {
  it('draws every overlay on one of the six sources, lines and closures under the basemap labels and everything else on top', () => {
    const layers = overlayLayers(OVERLAY_LIGHT);
    expect(new Set(layers.map((l) => l.id)).size).toBe(layers.length);
    for (const layer of layers) expect(Object.values(SOURCES)).toContain(layer.source);
    const below = layers.filter((l) => BELOW_LABELS.has(l.id));
    expect(below.map((l) => l.type).every((t) => t === 'line')).toBe(true);
    // What sits under the labels comes first in draw order, so the insertion point is one id.
    expect(layers.findIndex((l) => !BELOW_LABELS.has(l.id))).toBe(below.length);
    expect(firstSymbolLayer(basemapLayers('light'))).toBe('address_label');
  });

  it('declutters by scale: dots at every zoom, pills from PILL_ZOOM thinned by collision, everything from PILL_OVERLAP_ZOOM, the selected vehicle always', () => {
    expect(PILL_ZOOM).toBeLessThan(PILL_OVERLAP_ZOOM);
    expect(layerById(LAYERS.vehicleDots).minzoom).toBeUndefined();
    const pills = layerById(LAYERS.vehicles);
    expect(pills.minzoom).toBe(PILL_ZOOM);
    expect(pills.layout!['icon-allow-overlap']).toEqual(['step', ['zoom'], false, PILL_OVERLAP_ZOOM, true]);
    expect(pills.layout!['text-allow-overlap']).toEqual(['step', ['zoom'], false, PILL_OVERLAP_ZOOM, true]);
    expect(pills.layout!['text-optional']).toBe(false); // number and pill are one mark
    expect(layerById(LAYERS.vehicleNoses).minzoom).toBe(PILL_OVERLAP_ZOOM);
    const selected = layerById(LAYERS.vehicleSelected);
    expect(selected.minzoom).toBeUndefined();
    expect(selected.layout!['icon-allow-overlap']).toBe(true);
    // Pills are upright in the viewport; only the nose turns with the heading, compass minus ninety.
    expect(pills.layout!['icon-rotation-alignment']).toBe('viewport');
    expect(layerById(LAYERS.vehicleNoses).layout!['icon-rotate']).toEqual(['-', ['get', 'bearing'], 90]);
    expect(layerById(LAYERS.vehicleNoses).layout!['icon-rotation-alignment']).toBe('map');
  });

  it('generates one SDF pill per label length up to PILL_MAX_CHARS, a nose and a ring, and the pill layer picks the pill by the label\u2019s length', () => {
    const images = overlayImages();
    expect(images.map((i) => i.id)).toEqual(['vehicle-pill-1', 'vehicle-pill-2', 'vehicle-pill-3', 'vehicle-pill-4', 'vehicle-nose', 'selection-ring']);
    expect(PILL_MAX_CHARS).toBe(4);
    const widths = images.slice(0, 4).map((i) => i.image.width);
    for (let i = 1; i < widths.length; i++) expect(widths[i]).toBeGreaterThan(widths[i - 1]!);
    expect(JSON.stringify(layerById(LAYERS.vehicles).layout!['icon-image'])).toContain('"length",["get","short"]');
  });
});

describe('filters and the selection', () => {
  it('admits kinds by GTFS type: every kind when modes is null, no unknown kind otherwise, and hides the other mode\u2019s network', () => {
    expect(vehicleKinds(null)).toEqual(['tram', 'bus', 'other']);
    expect(vehicleKinds(new Set([ROUTE_TYPE_TRAM]))).toEqual(['tram']);
    expect(vehicleFilter(new Set([ROUTE_TYPE_BUS]), 'v9', true)).toEqual(['all', ['in', ['get', 'kind'], ['literal', ['bus']]], ['!=', ['get', 'id'], 'v9'], ['get', 'hasHeading']]);
    expect(stopFilter(new Set([ROUTE_TYPE_TRAM]))).toEqual(['any', ['==', ['get', 'tram'], true]]);
    expect(stopFilter(new Set())).toEqual(NEVER);
    const trams = overlayLayers(OVERLAY_LIGHT, { modes: new Set([ROUTE_TYPE_TRAM]) });
    expect(trams.find((l) => l.id === LAYERS.networkBus)!.layout!.visibility).toBe('none');
    expect(trams.find((l) => l.id === LAYERS.networkTram)!.layout!.visibility).toBe('visible');
  });

  it('carries NEVER on every selection layer while nothing is selected, and lights exactly the selected thing otherwise', () => {
    for (const f of Object.values(selectionFilters(null))) expect(f).toEqual(NEVER);
    const route = selectionFilters({ kind: 'route', id: '6' });
    expect(route[LAYERS.networkSelected]).toEqual(['==', ['get', 'route'], '6']);
    expect(route[LAYERS.stopsRoute]).toEqual(['in', '6', ['get', 'routes']]);
    expect(route[LAYERS.vehicleSelected]).toEqual(NEVER);
    const stop = selectionFilters({ kind: 'stop', id: '1_21', ids: ['1_21', '1_22'] });
    expect(stop[LAYERS.stopsSelected]).toEqual(['in', ['get', 'id'], ['literal', ['1_21', '1_22']]]);
    const vehicle = selectionFilters({ kind: 'vehicle', id: 'v1' });
    expect(vehicle[LAYERS.vehicleSelected]).toEqual(['==', ['get', 'id'], 'v1']);
    expect(vehicle[LAYERS.selectionRing]).toEqual(vehicle[LAYERS.vehicleSelected]);
    // The rest of the network steps back while one route is lit; the selected vehicle leaves the ordinary pill layer.
    expect(overlayLayers(OVERLAY_LIGHT, { selection: { kind: 'route', id: '6' } }).find((l) => l.id === LAYERS.networkTram)!.paint!['line-opacity']).toBe(0.14);
    expect(JSON.stringify(overlayLayers(OVERLAY_LIGHT, { selection: { kind: 'vehicle', id: 'v1' } }).find((l) => l.id === LAYERS.vehicles)!.filter)).toContain('"v1"');
  });

  it('a theme flip is paint alone; a selection or hiding the closures is filters and layout alone, all through one styleDiff', () => {
    const light = overlayLayers(OVERLAY_LIGHT);
    const dark = overlayLayers(OVERLAY_DARK);
    expect(dark.map((l) => l.id)).toEqual(light.map((l) => l.id));
    const theme = styleDiff(light, dark);
    expect(theme.length).toBeGreaterThan(10);
    expect(theme.every((op) => op.kind === 'paint')).toBe(true);
    expect(styleDiff(light, overlayLayers(OVERLAY_LIGHT, { selection: { kind: 'stop', id: '1_21' } })).map((op) => op.kind)).toEqual(['filter']);
    expect(styleDiff(light, overlayLayers(OVERLAY_LIGHT, { closuresVisible: false })).map((op) => `${op.id}:${op.kind}`).sort()).toEqual([`${LAYERS.closuresCasing}:layout`, `${LAYERS.closures}:layout`]);
  });

  it('a pill and its number are always opaque; while a route is selected the other routes invert (surface fill, own colour as number and outline) instead of fading, and the dots and noses carry the confidence', () => {
    for (const p of [OVERLAY_LIGHT, OVERLAY_DARK]) {
      const plain = overlayLayers(p);
      for (const id of [LAYERS.vehicles, LAYERS.vehicleSelected]) {
        const layer = plain.find((l) => l.id === id)!;
        expect(layer.paint!['icon-opacity']).toBe(1);
        expect(layer.paint!['text-opacity']).toBe(1);
      }
      expect(plain.find((l) => l.id === LAYERS.vehicleDots)!.paint!['circle-opacity']).toEqual(['get', 'alpha']);
      const lit = overlayLayers(p, { selection: { kind: 'route', id: '6' } });
      const pills = lit.find((l) => l.id === LAYERS.vehicles)!;
      expect(pills.paint!['icon-opacity']).toBe(1);
      expect(JSON.stringify(pills.paint!['icon-color'])).toContain(JSON.stringify(p.stopFill));
      expect(pillInks(p, '6').halo).toEqual(['case', ['==', ['get', 'routeId'], '6'], p.halo, ['match', ['get', 'kind'], 'tram', p.tram, 'bus', p.bus, p.other]]);
      expect(lit.find((l) => l.id === LAYERS.vehicleDots)!.paint!['circle-opacity']).toEqual(['*', ['get', 'alpha'], ['case', ['==', ['get', 'routeId'], '6'], 1, 0.35]]);
    }
  });
});
