import { describe, expect, it } from 'vitest';
import { OVERLAY_DARK, OVERLAY_LIGHT, basemapLayers, styleDiff } from '../../app/src/map/basemap';
import {
  BELOW_LABELS,
  LAYERS,
  NEVER,
  NOSE_MAX_ZOOM,
  NOSE_MIN_ZOOM,
  PILL_IMAGE_PREFIX,
  PILL_MAX_CHARS,
  PILL_ZOOM,
  PLACE_FILTERS,
  PLATE_IMAGE_PREFIX,
  SOURCES,
  WORKS_ONGOING_PHASE,
  firstSymbolLayer,
  overlayImages,
  overlayLayers,
  pillInks,
  selectionFilters,
  stopFilter,
  vehicleFilter,
  vehicleKinds,
  type ProzorOptions,
} from '../../app/src/map/overlays';
import { SDF_SPREAD_PX } from '../../app/src/map/sdf';
import { pointsToGeoJson, type MapPoint } from '../../app/src/map/city-map';
import { DISTRICTS } from '../../app/src/kiosk/districts';
import { ASSEMBLY_CAP, assemblyPoints, placedEvents, quakePoints, seatPoint } from '../../app/src/kiosk/mapview';
import type { FeedItem, ModuleId, ModuleSnapshot } from '../../worker/feed/schema';
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

  it('declutters by scale: dots at every zoom, pills from PILL_ZOOM, the selected vehicle always, and the direction nose inside its band alone', () => {
    expect(PILL_ZOOM).toBeLessThan(NOSE_MIN_ZOOM);
    expect(layerById(LAYERS.vehicleDots).minzoom).toBeUndefined();
    const pills = layerById(LAYERS.vehicles);
    expect(pills.minzoom).toBe(PILL_ZOOM);
    expect(pills.layout!['text-optional']).toBe(false); // number and pill are one mark
    // The band (section D): from 16.5 the rails themselves say the direction.
    expect([NOSE_MIN_ZOOM, NOSE_MAX_ZOOM]).toEqual([14.5, 16.5]);
    const noses = layerById(LAYERS.vehicleNoses);
    expect([noses.minzoom, noses.maxzoom]).toEqual([14.5, 16.5]);
    const selectedNose = layerById(LAYERS.vehicleSelectedNose);
    expect(selectedNose.minzoom).toBeUndefined(); // the selected vehicle's nose has no lower edge
    expect(selectedNose.maxzoom).toBe(16.5);
    const selected = layerById(LAYERS.vehicleSelected);
    expect(selected.minzoom).toBeUndefined();
    expect(selected.layout!['icon-allow-overlap']).toBe(true);
    // Pills are upright in the viewport; only the nose turns with the heading, compass minus ninety.
    expect(pills.layout!['icon-rotation-alignment']).toBe('viewport');
    expect(noses.layout!['icon-rotate']).toEqual(['-', ['get', 'bearing'], 90]);
    expect(noses.layout!['icon-rotation-alignment']).toBe('map');
  });

  it('draws the network under the marks on it: a hairline out of town, under 2.5 px in the city (section C)', () => {
    const layers = overlayLayers(OVERLAY_LIGHT);
    expect(layers.find((l) => l.id === LAYERS.networkTram)!.paint!['line-width']).toEqual(['interpolate', ['linear'], ['zoom'], 10, 0.6, 13, 1.1, 16, 2.4]);
    expect(layers.find((l) => l.id === LAYERS.networkBus)!.paint!['line-width']).toEqual(['interpolate', ['linear'], ['zoom'], 10, 0.45, 13, 0.85, 16, 1.9]);
    // The opacity ramp is untouched by the thinning.
    expect(layers.find((l) => l.id === LAYERS.networkTram)!.paint!['line-opacity']).toEqual(['interpolate', ['linear'], ['zoom'], 10, 0.4, 14, 0.55, 17, 0.7]);
  });

  it('generates one SDF pill and one plate per label length up to PILL_MAX_CHARS, a nose and a ring, and the pill layer picks the pill by the label\u2019s length', () => {
    const images = overlayImages();
    expect(images.map((i) => i.id)).toEqual([
      'vehicle-pill-1', 'vehicle-pill-2', 'vehicle-pill-3', 'vehicle-pill-4',
      'vehicle-plate-1', 'vehicle-plate-2', 'vehicle-plate-3', 'vehicle-plate-4',
      'vehicle-nose', 'selection-ring', 'place-square', 'place-square-ring', 'place-ring',
    ]);
    expect(PILL_MAX_CHARS).toBe(4);
    const widths = images.slice(0, 4).map((i) => i.image.width);
    for (let i = 1; i < widths.length; i++) expect(widths[i]).toBeGreaterThan(widths[i - 1]!);
    // A plate is the pill's box with the corners barely rounded: same size, and the corner pixel a capsule leaves empty is filled.
    for (let i = 0; i < 4; i++) {
      const pill = images[i]!.image;
      const plate = images[4 + i]!.image;
      expect([plate.width, plate.height]).toEqual([pill.width, pill.height]);
      const corner = (img: { width: number; data: Uint8ClampedArray }) => img.data[((SDF_SPREAD_PX + 1) * img.width + SDF_SPREAD_PX + 1) * 4 + 3]!;
      expect(corner(plate)).toBeGreaterThan(corner(pill) + 60);
    }
    expect(JSON.stringify(layerById(LAYERS.vehicles).layout!['icon-image'])).toContain('"length",["get","short"]');
    expect(JSON.stringify(layerById(LAYERS.vehicles).layout!['icon-image'])).not.toContain(PLATE_IMAGE_PREFIX);
  });
});

// The public screen's overlay set (plan D4, R-KP4): the tram network is the
// figure, buses and every stop off the screen's routes step aside, trams are
// plates and buses capsules (the badge rule), the screen's stop is the largest
// mark on the map, and the fixed 14.5 thresholds follow the field's own zoom.
describe('the kiosk overlay set (prozor)', () => {
  const PROZOR: ProzorOptions = { networkKinds: ['tram'], stopRoutes: ['6', '11'], stopLabelMinRank: 4, overlapZoom: 14.6, labelPadding: 24 };

  it('never labels the screen’s own stop from the hub tier: its anchor label already names it (R-KP25)', () => {
    const labels = overlayLayers(OVERLAY_LIGHT, { prozor: PROZOR, screenStopId: '106_1' }).find((l) => l.id === LAYERS.stopLabels)!;
    expect(JSON.stringify(labels.filter)).toContain('["!=",["get","id"],"106_1"]');
  });

  it('draws the tram network as the figure and hides the bus lines, stops only on the screen\u2019s routes as dots labelled from the hub rank at the field\u2019s zoom, trams as plates and buses as pills, the screen\u2019s stop as the largest mark, and no seat', () => {
    for (const p of [OVERLAY_LIGHT, OVERLAY_DARK]) {
      const layers = overlayLayers(p, { scale: 2, prozor: PROZOR });
      const by = (id: string) => layers.find((l) => l.id === id)!;
      expect(by(LAYERS.networkBus).layout!.visibility).toBe('none');
      const tram = by(LAYERS.networkTram);
      expect(tram.layout!.visibility).toBe('visible');
      expect(tram.paint!['line-color']).toBe(p.figure);
      expect(tram.paint!['line-opacity']).toBe(p.figureOpacity);
      expect(tram.paint!['line-width']).toEqual(['interpolate', ['linear'], ['zoom'], 14, 3, 15, 5, 16, 6]);
      expect(tram.layout!['line-cap']).toBe('round');
      expect(tram.layout!['line-join']).toBe('round');
      // Stops: the screen's routes only, as filled dots in the figure colour.
      const stops = by(LAYERS.stops);
      const stopsFilter = JSON.stringify(stops.filter);
      expect(stopsFilter).toContain(JSON.stringify(['in', '6', ['get', 'routes']]));
      expect(stopsFilter).toContain(JSON.stringify(['in', '11', ['get', 'routes']]));
      expect(stops.paint!['circle-radius']).toBe(6);
      expect(stops.paint!['circle-color']).toBe(p.figure);
      expect(stops.paint!['circle-stroke-width']).toBe(0);
      // Their names: hubs only (rank 4 and up), from the field's zoom, never below it; the same routes filter as the dots.
      const labels = by(LAYERS.stopLabels);
      expect(labels.minzoom).toBe(14.6);
      expect(JSON.stringify(labels.filter)).toContain(JSON.stringify(['>=', ['get', 'rank'], 4]));
      expect(JSON.stringify(labels.filter)).toContain(JSON.stringify(['in', '6', ['get', 'routes']]));
      expect(labels.layout!['text-size']).toBe(22);
      // Vehicles: a tram takes the plate of its label's length, a bus the pill; every mark places unconditionally and the noses draw from the field's zoom.
      const pills = by(LAYERS.vehicles);
      const image = JSON.stringify(pills.layout!['icon-image']);
      expect(image).toContain(PLATE_IMAGE_PREFIX);
      expect(image).toContain(PILL_IMAGE_PREFIX);
      expect(image).toContain('"tram"');
      expect(image).toContain('"length",["get","short"]');
      expect(pills.layout!['icon-allow-overlap']).toBe(false);
      expect(pills.layout!['text-allow-overlap']).toBe(false);
      expect(by(LAYERS.vehicleNoses).minzoom).toBe(14.6); // the kiosk's own threshold stays its own
      expect(by(LAYERS.vehicleNoses).maxzoom).toBe(NOSE_MAX_ZOOM);
      expect(JSON.stringify(by(LAYERS.vehicleSelected).layout!['icon-image'])).toContain(PLATE_IMAGE_PREFIX);
      // The screen's stop: the biggest ring and the biggest name on the map, never thinned.
      const screenStop = by(LAYERS.screenStop);
      expect(screenStop.paint!['circle-radius']).toBe(18);
      expect(screenStop.paint!['circle-stroke-width']).toBe(4);
      const screenStopLabel = by(LAYERS.screenStopLabel);
      expect(screenStopLabel.layout!['text-size']).toBe(30);
      expect(screenStopLabel.layout!['text-allow-overlap']).toBe(true);
      expect(by(LAYERS.placeSeat).layout!.visibility).toBe('none');
    }
    // Every stop when the routes are unknown (today's drawing), none for an empty list.
    const stopsOf = (prozor: ProzorOptions) => overlayLayers(OVERLAY_LIGHT, { prozor }).find((l) => l.id === LAYERS.stops)!;
    expect(stopsOf({ ...PROZOR, stopRoutes: null }).filter).toEqual(stopFilter(null));
    expect(stopsOf({ ...PROZOR, stopRoutes: [] }).filter).toEqual(NEVER);
    // Both kinds asked for: both networks drawn, as without the options.
    expect(overlayLayers(OVERLAY_LIGHT, { prozor: { ...PROZOR, networkKinds: ['tram', 'bus'] } }).find((l) => l.id === LAYERS.networkBus)!.layout!.visibility).toBe('visible');
    // The two faces share the list and differ in paint alone, exactly as without the options.
    const light = overlayLayers(OVERLAY_LIGHT, { prozor: PROZOR });
    const dark = overlayLayers(OVERLAY_DARK, { prozor: PROZOR });
    expect(dark.map((l) => l.id)).toEqual(light.map((l) => l.id));
    expect(dark.map((l) => l.id)).toEqual(overlayLayers(OVERLAY_LIGHT).map((l) => l.id));
    expect(styleDiff(light, dark).every((op) => op.kind === 'paint')).toBe(true);
    // The figure's own literals live in the report's colour table; only the pinned tram blue is asserted here, because the plan forbids touching it.
    expect(OVERLAY_LIGHT.routeTram).toBe('#0751bf');
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
// Four rules the product will not draw without. Two of them live where
// MapLibre itself enforces them (a layer filter), two where the screen picks
// which points exist at all; both halves are checked here, because a rule
// that is only a comment is not a rule.
describe('the city on the map: the rules that keep each mark honest', () => {
  /** The expression subset PLACE_FILTERS uses, evaluated over one feature's
   *  properties. Small on purpose: a filter that needed more than this would
   *  be a filter a reviewer could not read either. */
  function matches(filter: unknown, props: Record<string, unknown>): boolean {
    if (!Array.isArray(filter)) throw new Error(`not an expression: ${JSON.stringify(filter)}`);
    const [op, ...args] = filter as [string, ...unknown[]];
    const value = (expr: unknown): unknown => {
      if (Array.isArray(expr) && expr[0] === 'get') return props[expr[1] as string];
      if (Array.isArray(expr) && expr[0] === 'literal') return expr[1];
      return expr;
    };
    switch (op) {
      case 'all': return args.every((a) => matches(a, props));
      case '!': return !matches(args[0], props);
      case '==': return value(args[0]) === value(args[1]);
      case '!=': return value(args[0]) !== value(args[1]);
      case 'has': return Object.prototype.hasOwnProperty.call(props, args[0] as string);
      default: throw new Error(`unhandled operator ${op}`);
    }
  }
  /** Which place layers would draw this feature. */
  const drawnBy = (props: Record<string, unknown>): string[] =>
    Object.entries(PLACE_FILTERS).filter(([, filter]) => matches(filter, props)).map(([id]) => id);

  const NOW = Date.parse('2026-09-16T20:00:00+02:00');
  const iso = (hours: number) => new Date(NOW + hours * 3_600_000).toISOString();
  const snap = (module: ModuleId, items: FeedItem[], status: ModuleSnapshot['status'] = 'live'): ModuleSnapshot =>
    ({ module, tier: 'open', status, fetchedAt: iso(0), attribution: { text: '', url: '', licence: '' }, items });
  const row = (module: ModuleId, id: string, extra: Partial<FeedItem>): FeedItem =>
    ({ id, module, kind: 'event', tier: 'open', title: id, ...extra });
  const STOP = { id: 's', name: 'Stop', lon: 15.98, lat: 45.81, routes: ['6'], district: 'donji-grad' };

  it('an announced work never draws, an assembly point draws only while it is urgent, a quake outside the window never draws, and an untagged point still lands on the plain old circle', () => {
    // 1. A communal work draws in the register's "under way" phase and in no
    //    other. An announced one matches neither the works layer nor the
    //    placed-event layer, so it is not drawn as something else instead.
    expect(drawnBy({ place: 'event', source: 'komunalne', phase: WORKS_ONGOING_PHASE })).toEqual([LAYERS.placeWorks]);
    for (const phase of ['U pripremi', 'Ugovaranje', 'Provedba javne nabave', 'Izvodac uveden u posao', 'Zavrseni radovi', '']) {
      expect(drawnBy({ place: 'event', source: 'komunalne', phase }), phase).toEqual([]);
    }
    // A placed row from any other source is an event, whatever its phase field
    // says: the layer keys on geometry and styling, never on the source list.
    expect(drawnBy({ place: 'event', source: 'kvartovske', phase: '' })).toEqual([LAYERS.placeEvents]);
    expect(drawnBy({ place: 'event', source: 'kulturpunkt', phase: '' })).toEqual([LAYERS.placeEvents]);

    // 2. Assembly points ride every teaser; they are drawn only while the
    //    safety state is urgent.
    const zborna = snap('ckan-geo', Array.from({ length: 20 }, (_, i) =>
      row('ckan-geo', `zm${i}`, { kind: 'poi', title: `Zborno ${i}`, geo: { type: 'Point', coordinates: [15.98 + i * 0.01, 45.81] }, data: { layer: 'zborna-mjesta' } })));
    expect(assemblyPoints(zborna, STOP, false)).toEqual([]);
    const urgent = assemblyPoints(zborna, STOP, true);
    expect(urgent).toHaveLength(ASSEMBLY_CAP);
    expect(urgent[0]!.title).toBe('Zborno 0'); // nearest the stop first
    expect(urgent.every((p) => p.place === 'assembly')).toBe(true);

    // 3. A quake outside the declared 72 h / 150 km window never reaches the
    //    map, and one with no magnitude carries its region, never "M 0".
    const emsc = snap('emsc', [
      row('emsc', 'old', { kind: 'quake', at: iso(-80), geo: { type: 'Point', coordinates: [15.9, 45.8] }, data: { mag: 4 } }),
      row('emsc', 'far', { kind: 'quake', at: iso(-2), geo: { type: 'Point', coordinates: [13, 44] }, data: { mag: 4 } }),
      row('emsc', 'near', { kind: 'quake', at: iso(-2), geo: { type: 'Point', coordinates: [16.1, 45.9] }, data: { mag: 1.5 } }),
      row('emsc', 'nomag', { kind: 'quake', at: iso(-3), geo: { type: 'Point', coordinates: [16, 45.85] }, data: { region: 'CROATIA' } }),
    ]);
    const quakes = quakePoints(emsc, NOW, 'hr');
    expect(quakes.map((q) => q.id)).toEqual(['quake:near', 'quake:nomag']);
    expect(quakes.map((q) => q.title)).toEqual(['M 1,5', 'CROATIA']);
    expect(drawnBy({ place: 'quake', mag: 1.5 })).toEqual([LAYERS.placeQuakes, LAYERS.placeQuakeLabels]);
    expect(drawnBy({ place: 'quake' })).toEqual([LAYERS.placeQuakeLabels]);

    // 4. An untagged point is drawn by the one circle this map always had, and
    //    its GeoJSON properties are what they always were, so the dashboard's
    //    quake map and the kvart thumbnail are unchanged.
    const plain: MapPoint = { id: 'w1', lon: 15.97, lat: 45.8, title: 'Radovi' };
    expect(pointsToGeoJson([plain]).features[0]!.properties).toEqual({ id: 'w1', title: 'Radovi' });
    const places = overlayLayers(OVERLAY_LIGHT).find((l) => l.id === LAYERS.places)!;
    expect(places.filter).toEqual(['!', ['has', 'place']]);
    expect(matches(places.filter, { id: 'w1', title: 'Radovi' })).toBe(true);
    expect(matches(places.filter, { place: 'event' })).toBe(false);
    expect(drawnBy({ id: 'w1', title: 'Radovi' })).toEqual([]);

    // 5. A pharmacy without its published address does not draw: the address
    //    is the exact part, the coordinate is hand-entered.
    expect(drawnBy({ place: 'pharmacy', address: 'Ilica 301' })).toEqual([LAYERS.placePharmacy]);
    expect(drawnBy({ place: 'pharmacy' })).toEqual([]);

    // 6. The district seat is the real seat address, never the polygon centroid.
    const seat = seatPoint(STOP)[0]!;
    const donji = DISTRICTS.find((d) => d.slug === 'donji-grad')!;
    expect([seat.lon, seat.lat]).toEqual([donji.seat.lon, donji.seat.lat]);
    expect(seatPoint(null)).toEqual([]);

    // 7. A placed happening keeps the evening's own band: still running or
    //    starting today, never a pin for something months out.
    const dogadanja = snap('dogadanja', [
      row('dogadanja', 'tonight', { dateBasis: 'event', at: iso(2), geo: { type: 'Point', coordinates: [15.97, 45.81] }, data: { source: 'kvartovske' } }),
      row('dogadanja', 'months', { dateBasis: 'event', at: iso(24 * 60), geo: { type: 'Point', coordinates: [15.97, 45.81] }, data: { source: 'kvartovske' } }),
      row('dogadanja', 'ended', { dateBasis: 'event', at: iso(-40), until: iso(-2), geo: { type: 'Point', coordinates: [15.97, 45.81] }, data: { source: 'kvartovske' } }),
      row('dogadanja', 'novenue', { dateBasis: 'event', at: iso(2), data: { source: 'kvartovske' } }),
      row('dogadanja', 'culture', { dateBasis: 'event', at: iso(2), geo: { type: 'Point', coordinates: [15.97, 45.81] }, data: { source: 'kulturpunkt' } }),
      row('dogadanja', 'work', { dateBasis: 'updated', at: iso(-100), geo: { type: 'Point', coordinates: [15.96, 45.8] }, data: { source: 'komunalne', phase: WORKS_ONGOING_PHASE } }),
    ]);
    // A row whose venue is free text and carries no coordinate is not placed:
    // geocoding a venue name on the client would be inventing a position.
    // Every source the app fetches reaches the screen, a Kulturpunkt row with a coordinate included (owner, 16 Sept 2026: no licence wall on the app's own screens).
    expect(placedEvents(dogadanja, NOW).map((p) => p.id)).toEqual(['event:tonight', 'event:culture', 'event:work']);
  });
});
