import { describe, expect, it } from 'vitest';
import { OVERLAY_DARK, OVERLAY_LIGHT, basemapLayers, styleDiff } from '../../app/src/map/basemap';
import {
  BELOW_LABELS,
  BODY_ZOOM,
  CITY_STOP_ZOOM,
  LAYERS,
  NAME_ANCHORS,
  NAME_ANCHOR_BASELINE_EM,
  NETWORK_OPACITY,
  NETWORK_OPACITY_DIMMED,
  NEVER,
  NOSE_IMAGE,
  NOSE_MAX_ZOOM,
  NOSE_MIN_ZOOM,
  VEHICLE_OPACITY_DIMMED,
  PILL_FIT_PAD_X,
  PILL_FIT_PAD_Y,
  PILL_IMAGE,
  PILL_ZOOM,
  PLACE_FILTERS,
  PLATE_IMAGE,
  SOURCES,
  WORKS_ONGOING_PHASE,
  firstSymbolLayer,
  kindFilter,
  nameAnchorOffsets,
  NOSE_FALLBACK_PX,
  NOSE_OFFSET_MAX_PX,
  overlayImages,
  overlayLayers,
  pillInks,
  routeStopsFilter,
  selectionFilters,
  stopFilter,
  vehicleFilter,
  vehicleKinds,
  type ProzorOptions,
} from '../../app/src/map/overlays';
import { PILL_HEIGHT_PX, PILL_MAX_CHARS_CLUSTER, clusterLabel, noseCentrePx, pillChars, pillWidthPx } from '../../app/src/motion/pills';
import { SDF_PIXEL_RATIO, SDF_SPREAD_PX } from '../../app/src/map/sdf';
import { pointsToGeoJson, type MapPoint } from '../../app/src/map/city-map';
import { DISTRICTS } from '../../app/src/kiosk/districts';
import { ASSEMBLY_CAP, assemblyPoints, placedEvents, quakePoints, seatPoint } from '../../app/src/kiosk/mapview';
import type { FeedItem, ModuleId, ModuleSnapshot } from '../../worker/feed/schema';
import { ROUTE_TYPE_BUS, ROUTE_TYPE_TRAM } from '../../app/src/motion/schematic';
import { metresPerPixel } from '../../app/src/map/scale';
import { PROJECTION_LAT_DEG } from '../../shared/motion/geo';
import { VEHICLE_WIDTH_M } from '../../shared/motion/vehicle';

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

  it('never drops a pill: overlap and ignore-placement on for the icon and the number at every zoom, a cluster ringed in the selection ink, and the nose only inside its band', () => {
    expect(PILL_ZOOM).toBeLessThan(NOSE_MIN_ZOOM);
    expect(layerById(LAYERS.vehicleDots).minzoom).toBeUndefined();
    const pills = layerById(LAYERS.vehicles);
    expect(pills.minzoom).toBe(PILL_ZOOM);
    // A pill is never dropped, and never blocks a stop name either.
    for (const key of ['icon-allow-overlap', 'text-allow-overlap', 'icon-ignore-placement', 'text-ignore-placement']) {
      expect(pills.layout![key], key).toBe(true);
    }
    expect(pills.layout!['text-optional']).toBe(false); // number and pill are one mark
    // A cluster's label is one line or it is nothing: MapLibre may break after
    // the "·" joining its lines, and its default 10 em hung the tail under the capsule.
    expect(pills.layout!['text-max-width']).toBe(100);
    // What reads as "several here": the ink ring around a merged pill.
    expect(pills.paint!['icon-halo-color']).toEqual(['case', ['get', 'cluster'], OVERLAY_LIGHT.selection, OVERLAY_LIGHT.halo]);
    expect(pills.paint!['icon-halo-width']).toEqual(['case', ['get', 'cluster'], 2, 1]);
    // The capsule is its number's size: the stretchable image fitted to the
    // text plus its padding, at icon-size 1 (the fit already carries the scale).
    expect(pills.layout!['icon-size']).toBe(1);
    expect(pills.layout!['icon-text-fit']).toBe('both');
    expect(pills.layout!['icon-text-fit-padding']).toEqual([PILL_FIT_PAD_Y, PILL_FIT_PAD_X, PILL_FIT_PAD_Y, PILL_FIT_PAD_X]);
    // A vehicle whose route nobody knows still has a text box to fit: one
    // no-break space, the smallest capsule, nothing written on it.
    expect(pills.layout!['text-field']).toEqual(['case', ['==', ['get', 'short'], ''], '\u00a0', ['get', 'short']]);
    // The direction nose's band (section D): from 16.5 the rails themselves say the direction.
    expect([NOSE_MIN_ZOOM, NOSE_MAX_ZOOM]).toEqual([14.5, 16.5]);
    const noses = layerById(LAYERS.vehicleNoses);
    expect([noses.minzoom, noses.maxzoom]).toEqual([14.5, 16.5]);
    // The selected vehicle's nose is a nose: the owner's ruling is "only
    // between 14.5 and 16.5", and a selection is no reason to draw a triangle
    // over a city-wide view where nothing else carries one.
    const selectedNose = layerById(LAYERS.vehicleSelectedNose);
    expect([selectedNose.minzoom, selectedNose.maxzoom]).toEqual([14.5, 16.5]);
    const selected = layerById(LAYERS.vehicleSelected);
    expect(selected.minzoom).toBeUndefined();
    expect(selected.layout!['icon-allow-overlap']).toBe(true);
    // Pills are upright in the viewport; only the nose turns with the heading, compass minus ninety.
    expect(pills.layout!['icon-rotation-alignment']).toBe('viewport');
    expect(noses.layout!['icon-rotate']).toEqual(['-', ['get', 'bearing'], 90]);
    expect(noses.layout!['icon-rotation-alignment']).toBe('map');
  });

  it('sets the nose where the capsule\u2019s outline meets its heading: the vehicle source\u2019s own `nose` distance as a [d, 0] pair, which MapLibre turns with the triangle', () => {
    const offset = layerById(LAYERS.vehicleNoses).layout!['icon-offset'] as unknown[];
    // MapLibre has no expression that builds an array from a computed number
    // (['array', ...] only asserts a type), but it interpolates arrays: from
    // [0, 0] to [M, 0], linearly, the output at d is exactly [d, 0].
    expect(offset).toEqual(['interpolate', ['linear'], ['number', ['get', 'nose'], NOSE_FALLBACK_PX], 0, ['literal', [0, 0]], NOSE_OFFSET_MAX_PX, ['literal', [NOSE_OFFSET_MAX_PX, 0]]]);
    expect(JSON.stringify(offset)).not.toContain('"array"');
    // Past every capsule there is: forty characters of the widest digit.
    expect(NOSE_OFFSET_MAX_PX).toBeGreaterThan(noseCentrePx('8'.repeat(PILL_MAX_CHARS_CLUSTER), 'bus', 90));
    // A mark without the property (none is pushed so) gets a two-digit pill's end.
    expect(NOSE_FALLBACK_PX).toBe(noseCentrePx('00', 'bus', 90));
    // The selected vehicle's nose and an opposed merge's arrows read the same distance.
    expect(layerById(LAYERS.vehicleSelectedNose).layout!['icon-offset']).toEqual(offset);
  });

  it('an opposed merge carries a triangle each way: two nose layers on the twoWay cluster alone, fore and aft of the pill, from PILL_ZOOM with no upper edge', () => {
    const ids = overlayLayers(OVERLAY_LIGHT).map((l) => l.id);
    expect([LAYERS.vehicleTwoWayFore, LAYERS.vehicleTwoWayAft]).toEqual(['vehicle-twoway-fore', 'vehicle-twoway-aft']);
    // Right after the noses and under the pills, so a triangle sits where a nose would.
    const at = ids.indexOf(LAYERS.vehicleNoses);
    expect(ids.slice(at, at + 4)).toEqual([LAYERS.vehicleNoses, LAYERS.vehicleTwoWayFore, LAYERS.vehicleTwoWayAft, LAYERS.vehicles]);
    const noses = layerById(LAYERS.vehicleNoses);
    const rotations = [[LAYERS.vehicleTwoWayFore, ['-', ['get', 'bearing'], 90]], [LAYERS.vehicleTwoWayAft, ['+', ['get', 'bearing'], 90]]] as const;
    for (const [id, rotate] of rotations) {
      const layer = layerById(id);
      expect(layer, id).toMatchObject({ type: 'symbol', source: SOURCES.vehicles, minzoom: PILL_ZOOM });
      // The rail cannot say which way a merged pair goes, so the nose band's upper edge does not apply.
      expect(layer.maxzoom, id).toBeUndefined();
      expect(layer.filter, id).toEqual(['all', vehicleFilter(null, null), ['get', 'cluster'], ['get', 'twoWay']]);
      expect(layer.layout!['icon-rotate'], id).toEqual(rotate);
      expect(layer.layout!['icon-image'], id).toBe(NOSE_IMAGE);
      expect(layer.layout!['icon-offset'], id).toEqual(noses.layout!['icon-offset']);
      expect(layer.layout!['icon-rotation-alignment'], id).toBe('map');
      expect(layer.paint, id).toEqual(noses.paint);
    }
    // The mode toggle and the selected vehicle reach them exactly as they reach the pills.
    const trams = overlayLayers(OVERLAY_LIGHT, { modes: new Set([ROUTE_TYPE_TRAM]), selection: { kind: 'vehicle', id: 'v1' } });
    expect(trams.find((l) => l.id === LAYERS.vehicleTwoWayFore)!.filter).toEqual(['all', vehicleFilter(new Set([ROUTE_TYPE_TRAM]), 'v1'), ['get', 'cluster'], ['get', 'twoWay']]);
  });

  it('lays a vehicle body under the pills from zoom 16: a flat-ended line on its own source, right before the dots, the mode ink metres wide, dimmed with the dots and hidden with the mode', () => {
    const layers = overlayLayers(OVERLAY_LIGHT);
    const ids = layers.map((l) => l.id);
    // Over the rails and the stop rings, under every dot, nose and pill.
    expect(ids.indexOf(LAYERS.vehicleBodies)).toBe(ids.indexOf(LAYERS.vehicleDots) - 1);
    expect(LAYERS.vehicleBodies).toBe('vehicle-bodies');
    expect(BODY_ZOOM).toBe(16);
    const body = layerById(LAYERS.vehicleBodies);
    expect(body).toMatchObject({ type: 'line', source: SOURCES.bodies, minzoom: BODY_ZOOM });
    expect(SOURCES.bodies).not.toBe(SOURCES.vehicles); // one LineString per vehicle, beside the point source the pills read
    // A vehicle ends flat: round caps would add a width to the length.
    expect(body.layout).toEqual({ 'line-cap': 'butt', 'line-join': 'round' });
    expect(body.filter).toEqual(kindFilter(null));
    expect(body.paint!['line-color']).toEqual(['match', ['get', 'kind'], 'tram', OVERLAY_LIGHT.tram, 'bus', OVERLAY_LIGHT.bus, OVERLAY_LIGHT.other]);
    expect(body.paint!['line-opacity']).toEqual(['*', ['get', 'alpha'], 0.9]);
    // Metres as pixels: the width doubles with every zoom, so it is one exponential ramp between two pinned zooms.
    const width = body.paint!['line-width'] as unknown[];
    expect(width.slice(0, 4)).toEqual(['interpolate', ['exponential', 2], ['zoom'], 16]);
    expect(width[4]).toBeCloseTo(VEHICLE_WIDTH_M / metresPerPixel(16, PROJECTION_LAT_DEG), 9);
    expect(width[5]).toBe(22);
    expect(width[6]).toBeCloseTo(VEHICLE_WIDTH_M / metresPerPixel(22, PROJECTION_LAT_DEG), 9);
    expect(width[4]).toBeCloseTo(3, 1); // 3 px at 16, 6 at 17, 12 at 18
    expect(width[6] as number).toBeCloseTo(64 * (width[4] as number), 6);
    // Line focus steps the other lines' bodies back with their dots, and the mode toggle hides them with their pills.
    const lit = overlayLayers(OVERLAY_LIGHT, { selection: { kind: 'route', id: '6' } }).find((l) => l.id === LAYERS.vehicleBodies)!;
    expect(lit.paint!['line-opacity']).toEqual(['*', ['*', ['get', 'alpha'], ['case', ['==', ['get', 'routeId'], '6'], 1, VEHICLE_OPACITY_DIMMED]], 0.9]);
    const trams = overlayLayers(OVERLAY_LIGHT, { modes: new Set([ROUTE_TYPE_TRAM]) }).find((l) => l.id === LAYERS.vehicleBodies)!;
    expect(trams.filter).toEqual(['in', ['get', 'kind'], ['literal', ['tram']]]);
    // The public screen's scale never widens a body: a metre is a metre on every surface.
    expect(overlayLayers(OVERLAY_LIGHT, { scale: 2 }).find((l) => l.id === LAYERS.vehicleBodies)!.paint!['line-width']).toEqual(width);
  });

  it('draws the network under the marks on it: a hairline out of town, under 2.5 px in the city (section C)', () => {
    const layers = overlayLayers(OVERLAY_LIGHT);
    expect(layers.find((l) => l.id === LAYERS.networkTram)!.paint!['line-width']).toEqual(['interpolate', ['linear'], ['zoom'], 10, 0.6, 13, 1.1, 16, 2.4]);
    expect(layers.find((l) => l.id === LAYERS.networkBus)!.paint!['line-width']).toEqual(['interpolate', ['linear'], ['zoom'], 10, 0.45, 13, 0.85, 16, 1.9]);
    // The opacity ramp is untouched by the thinning.
    expect(layers.find((l) => l.id === LAYERS.networkTram)!.paint!['line-opacity']).toEqual(['interpolate', ['linear'], ['zoom'], 10, 0.4, 14, 0.55, 17, 0.7]);
  });

  it('generates one stretchable SDF pill and one plate, drawn at the surface\u2019s scale, then the nose, the ring and the place marks, and the pill layer picks a plate for a tram and a pill for a bus', () => {
    // The cap, and the reason it is what it is: a merged pill lists every
    // line [O-35], and all fifteen tram lines together are 35 characters, so
    // every tram cluster is written whole. Forty is the widest capsule.
    expect(PILL_MAX_CHARS_CLUSTER).toBe(40);
    const bus = (n: number): string[] => Array.from({ length: n }, (_, i) => String(109 + i));
    // A bus hub of sixteen three-digit routes would be 63 characters: it keeps
    // the ten whole lines that fit in the widest capsule, and never a count.
    const hub = clusterLabel(bus(16));
    expect(hub).toBe(bus(10).join('\u00b7'));
    expect(hub).not.toContain('+');
    expect(hub.length).toBeLessThanOrEqual(PILL_MAX_CHARS_CLUSTER);
    expect(pillChars(hub)).toBe(hub.length);
    // Five three-digit routes -- the everyday bus cluster -- are written whole.
    const five = clusterLabel(bus(5));
    expect(five).toBe('109\u00b7110\u00b7111\u00b7112\u00b7113');
    expect(pillChars(five)).toBe(five.length);
    // One capsule stretches to every label: no image per label length.
    const images = overlayImages();
    expect([PILL_IMAGE, PLATE_IMAGE]).toEqual(['vehicle-pill', 'vehicle-plate']);
    expect(images.map((i) => i.id)).toEqual(['vehicle-pill', 'vehicle-plate', 'vehicle-nose', 'selection-ring', 'place-square', 'place-square-ring', 'place-ring']);
    // Only the pill and the plate stretch; the fixed marks carry no options, are
    // drawn once at 1x and are sized by icon-size.
    for (const { id, options } of images.slice(2)) expect(options, id).toBeUndefined();
    expect(overlayImages(2).slice(2)).toEqual(images.slice(2));
    // The fit's height is the capsule's: a 12 px line (MapLibre's 1.2 em)
    // plus the padding twice, so the vertical stretch is exactly 1.
    expect(12 * 1.2 + 2 * PILL_FIT_PAD_Y).toBeCloseTo(PILL_HEIGHT_PX, 9);
    // And two digits of the map's medium face (6.5 px each at 12 px, its glyph
    // advance) plus the padding are the two-character capsule pills.ts states.
    expect(2 * 6.5 + 2 * PILL_FIT_PAD_X).toBe(pillWidthPx(2));
    for (const scale of [1, 1.5, 2]) {
      const [pill, plate] = overlayImages(scale);
      for (const { id, image, options } of [pill!, plate!]) {
        const at = `${id} at ${scale}`;
        // A two-character capsule at this scale plus the distance field's own spread around it.
        expect(image.width, at).toBe(pillWidthPx(2) * scale * SDF_PIXEL_RATIO + 2 * SDF_SPREAD_PX);
        expect(image.height, at).toBe(PILL_HEIGHT_PX * scale * SDF_PIXEL_RATIO + 2 * SDF_SPREAD_PX);
        // The content box is the shape's own edge, so the fit lays that edge on
        // the number plus its padding (image px, as MapLibre reads them).
        expect(options!.content, at).toEqual([SDF_SPREAD_PX, SDF_SPREAD_PX, image.width - SDF_SPREAD_PX, image.height - SDF_SPREAD_PX]);
        // Only the middle stretches, between two fixed ends as long as the capsule's round end.
        const end = (PILL_HEIGHT_PX * scale * SDF_PIXEL_RATIO) / 2;
        expect(options!.stretchX, at).toEqual([[SDF_SPREAD_PX + end, image.width - SDF_SPREAD_PX - end]]);
        expect(options, at).toMatchObject({ textFitWidth: 'stretchOrShrink', textFitHeight: 'stretchOrShrink' });
        // Every stretched column is the same column: the field there varies
        // with the row alone, so stretching lengthens the shape and nothing else.
        const [[x1, x2]] = options!.stretchX as [[number, number]];
        const alpha = (x: number, y: number): number => image.data[(y * image.width + x) * 4 + 3]!;
        for (let y = 0; y < image.height; y++) {
          for (let x = Math.ceil(x1); x < Math.floor(x2); x++) expect(alpha(x, y)).toBe(alpha(Math.ceil(x1), y));
        }
      }
      // A plate is the pill's box with the corners barely rounded: the corner pixel a capsule leaves empty is filled.
      const corner = (img: { width: number; data: Uint8ClampedArray }) => img.data[((SDF_SPREAD_PX + 1) * img.width + SDF_SPREAD_PX + 1) * 4 + 3]!;
      expect(corner(plate!.image), `plate at ${scale}`).toBeGreaterThan(corner(pill!.image) + 60);
    }
    // The badge rule on every surface, not only the public screen: a tram
    // takes the plate, anything else the pill; the selected vehicle's own
    // layer draws the same mark.
    const mark = ['match', ['get', 'kind'], 'tram', PLATE_IMAGE, PILL_IMAGE];
    expect(layerById(LAYERS.vehicles).layout!['icon-image']).toEqual(mark);
    expect(layerById(LAYERS.vehicleSelected).layout!['icon-image']).toEqual(mark);
  });
});

// The public screen's overlay set (plan D4, R-KP4): the tram network is a
// thin neutral rail, buses and every stop off the screen's routes step
// aside, the screen's stop is the largest mark on the map, and the fixed
// 14.5 thresholds follow the field's own zoom. (Trams as plates and buses as
// capsules began here and are now every surface's rule, pinned by the block
// above.)
describe('the kiosk overlay set (prozor)', () => {
  const PROZOR: ProzorOptions = { networkKinds: ['tram'], stopRoutes: ['6', '11'], stopLabelMinRank: 4, stopRadius: false, overlapZoom: 14.6, labelPadding: 24 };

  // Ruling 30: below THIN_NAMES_ZOOM the window asks for interchanges and the
  // rank stops being the question; from the line up nothing changed.
  it('names interchanges and not ranks when the field holds the whole city', () => {
    const far = overlayLayers(OVERLAY_LIGHT, { prozor: { ...PROZOR, stopLabelTramInterchanges: true } }).find((l) => l.id === LAYERS.stopLabels)!;
    const json = JSON.stringify(far.filter);
    expect(json).toContain('["get","tramInterchange"]');
    expect(json).not.toContain('"rank"');
    // Nearer in (a quarter, the wall's frame), the ranked reading with every interchange beside it:
    // an interchange is always worth its name, whatever its route count.
    const near = overlayLayers(OVERLAY_LIGHT, { prozor: PROZOR }).find((l) => l.id === LAYERS.stopLabels)!;
    const nearJson = JSON.stringify(near.filter);
    expect(nearJson).toContain('["any",["get","tramInterchange"],[">=",["get","rank"],4]]');
    // Either way the one label per name and the screen's own stop rule hold.
    for (const f of [json, nearJson]) expect(f).toContain('["get","label"]');
  });

  // Ruling 30's own follow-up: route count decided which names survived a
  // crowded corner too, so below the line an interchange is placed before
  // anything else and the rank is only the tiebreak among them.
  it('places an interchange before a merely busy stop when the field holds the whole city', () => {
    const key = (prozor: ProzorOptions) => JSON.stringify(overlayLayers(OVERLAY_LIGHT, { prozor }).find((l) => l.id === LAYERS.stopLabels)!.layout!['symbol-sort-key']);
    expect(key({ ...PROZOR, stopLabelTramInterchanges: true })).toBe('["-",["case",["get","tramInterchange"],0,100],["get","rank"]]');
    // Nearer in, the ranked reading the hub tier has always used.
    expect(key(PROZOR)).toBe('["-",100,["get","rank"]]');
  });

  // Ruling 31. The square marks' titles are the artefact's own names --
  // "Igralište Sava", "Zagrebački velesajam" -- at the same 22 px a stop name
  // gets. On a whole-city window the square is the claim and the name is not
  // something anyone acts on from three metres, so the names go and the marks
  // stay; the quake keeps its own label, which is a different layer.
  it('draws the square place marks without names while the field holds the whole city', () => {
    const squares = [LAYERS.placeWorks, LAYERS.placeEvents, LAYERS.placeSeat, LAYERS.placeAssembly, LAYERS.placePharmacy];
    const far = overlayLayers(OVERLAY_LIGHT, { prozor: { ...PROZOR, placeTitles: false } });
    for (const id of squares) {
      const layer = far.find((l) => l.id === id);
      if (!layer) continue; // the seat is never lit under the kiosk's set
      expect(layer.layout!['text-field'], id).toBeUndefined();
      // The mark itself is untouched: an urgent state still shows where to go.
      expect(layer.layout!['icon-image'], id).toBeDefined();
    }
    // The quake keeps its words at every zoom: it is the one thing a city window should say.
    expect(far.find((l) => l.id === LAYERS.placeQuakeLabels)!.layout!['text-field']).toBeDefined();
    // Nearer in, and everywhere off the kiosk's option set, the names are there.
    const near = overlayLayers(OVERLAY_LIGHT, { prozor: PROZOR });
    for (const id of squares) {
      const layer = near.find((l) => l.id === id);
      if (!layer) continue;
      expect(layer.layout!['text-field'], id).toEqual(['get', 'title']);
    }
    expect(overlayLayers(OVERLAY_LIGHT).find((l) => l.id === LAYERS.placeAssembly)!.layout!['text-field']).toEqual(['get', 'title']);
  });

  it('never labels the screen’s own stop from the hub tier: its anchor label already names it (R-KP25)', () => {
    const labels = overlayLayers(OVERLAY_LIGHT, { prozor: PROZOR, screenStopId: '106_1' }).find((l) => l.id === LAYERS.stopLabels)!;
    expect(JSON.stringify(labels.filter)).toContain('["!=",["get","id"],"106_1"]');
  });

  it('draws the tram network as a thin neutral rail and hides the bus lines, stops only on the screen\u2019s routes as dots labelled from the hub rank at the field\u2019s zoom, the screen\u2019s stop as the largest mark, and no seat', () => {
    for (const p of [OVERLAY_LIGHT, OVERLAY_DARK]) {
      const layers = overlayLayers(p, { scale: 2, prozor: PROZOR });
      const by = (id: string) => layers.find((l) => l.id === id)!;
      expect(by(LAYERS.networkBus).layout!.visibility).toBe('none');
      const tram = by(LAYERS.networkTram);
      expect(tram.layout!.visibility).toBe('visible');
      expect(tram.paint!['line-color']).toBe(p.rail);
      expect(tram.paint!['line-opacity']).toBe(0.8);
      expect(tram.paint!['line-width']).toEqual(['interpolate', ['linear'], ['zoom'], 12.5, 1.2, 14, 2, 16, 3]);
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
      // With stopRadius the same dots grow with the camera instead: 1.5 px at the whole-city
      // window's own floor, 5 at street level, on a one-pixel stroke of the same ink, so a
      // three-pixel bead on a city full of stops is still a mark and still tappable. Drawn
      // pixels, never the surface's symbol scale: a stop says where it is, not what it says,
      // and at the screen's scale 2 the street end outweighed the plates standing on it.
      const ramped = overlayLayers(p, { scale: 2, prozor: { ...PROZOR, stopRadius: true } }).find((l) => l.id === LAYERS.stops)!;
      expect(ramped.paint!['circle-radius']).toEqual(['interpolate', ['linear'], ['zoom'], CITY_STOP_ZOOM, 1.5, 15.5, 5]);
      expect(CITY_STOP_ZOOM).toBe(12.7);
      expect(ramped.paint!['circle-stroke-width']).toBe(1);
      expect(ramped.paint!['circle-stroke-color']).toBe(p.figure);
      expect(ramped.paint!['circle-stroke-opacity']).toBe(p.figureOpacity);
      expect(ramped.minzoom).toBe(stops.minzoom);
      // Their names: hubs only (rank 4 and up), from the field's zoom, never below it; the same routes filter as the dots.
      const labels = by(LAYERS.stopLabels);
      expect(labels.minzoom).toBe(14.6);
      expect(JSON.stringify(labels.filter)).toContain(JSON.stringify(['>=', ['get', 'rank'], 4]));
      expect(JSON.stringify(labels.filter)).toContain(JSON.stringify(['in', '6', ['get', 'routes']]));
      expect(labels.layout!['text-size']).toBe(22);
      // Vehicles: the same plate-or-pill mark as every surface; every mark places unconditionally and the noses draw from the field's zoom.
      const pills = by(LAYERS.vehicles);
      expect(pills.layout!['icon-image']).toEqual(['match', ['get', 'kind'], 'tram', PLATE_IMAGE, PILL_IMAGE]);
      // At the screen's scale 2 the number is 24 px and the fit's padding doubles
      // with it; icon-size stays 1, the nose (a fixed mark) takes the scale.
      expect(pills.layout!['text-size']).toBe(24);
      expect(pills.layout!['icon-size']).toBe(1);
      expect(pills.layout!['icon-text-fit']).toBe('both');
      expect(pills.layout!['icon-text-fit-padding']).toEqual([2 * PILL_FIT_PAD_Y, 2 * PILL_FIT_PAD_X, 2 * PILL_FIT_PAD_Y, 2 * PILL_FIT_PAD_X]);
      expect(by(LAYERS.vehicleNoses).layout!['icon-size']).toBe(2);
      expect(pills.layout!['icon-allow-overlap']).toBe(true);
      expect(pills.layout!['text-allow-overlap']).toBe(true);
      expect(by(LAYERS.vehicleNoses).minzoom).toBe(14.6); // the kiosk's own threshold stays its own
      expect(by(LAYERS.vehicleNoses).maxzoom).toBe(NOSE_MAX_ZOOM);
      // The selected vehicle's nose sits in the same band as every other nose, the field's zoom included.
      expect(by(LAYERS.vehicleSelectedNose).minzoom).toBe(14.6);
      expect(by(LAYERS.vehicleSelected).layout!['icon-image']).toEqual(pills.layout!['icon-image']);
      // The screen's stop: the biggest ring and the biggest name on the map,
      // always drawn under the pills (decision 19), and every other name
      // yields to it.
      const screenStop = by(LAYERS.screenStop);
      expect(screenStop.paint!['circle-radius']).toBe(18);
      expect(screenStop.paint!['circle-stroke-width']).toBe(4);
      const screenStopLabel = by(LAYERS.screenStopLabel);
      expect(screenStopLabel.layout!['text-size']).toBe(30);
      expect(screenStopLabel.layout!['text-allow-overlap']).toBe(true);
      expect(screenStopLabel.layout!['text-ignore-placement']).toBe(false);
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

  it('a relayed route selection keeps the pinned tram blue: with no focus handed in, the lit line is the mode ink it has always been', () => {
    // A paired screen mirrors the phone's route (kiosk/mapview.ts setView).
    // Round F's constraint is that its drawing does not move, and city-map.ts
    // gives a surface that never asked for line focus no `focus` at all -- so
    // this is the option set the kiosk actually builds, asserted whole.
    const lit = overlayLayers(OVERLAY_LIGHT, { prozor: PROZOR, selection: { kind: 'route', id: '6' }, lineFocus: false, focus: null });
    expect(lit.find((l) => l.id === LAYERS.networkSelected)!.paint!['line-color'])
      .toEqual(['match', ['get', 'kind'], 'tram', OVERLAY_LIGHT.routeTram, 'bus', OVERLAY_LIGHT.routeBus, OVERLAY_LIGHT.other]);
    expect(lit.find((l) => l.id === LAYERS.networkTram)!.layout!.visibility).toBe('visible');
    expect(lit.find((l) => l.id === LAYERS.networkTram)!.paint!['line-opacity']).toBe(NETWORK_OPACITY_DIMMED);
  });
});

// Decision 17: on the public screen the vehicle pills have priority. The
// names sit under the vehicle marks on every surface; on the public screen
// the marks keep their collision boxes and a name tries its other anchors,
// then yields while the tram passes. The BAJS counts do not move.
describe('decision 17: the vehicle marks before the names', () => {
  const PROZOR: ProzorOptions = { networkKinds: ['tram', 'bus'], stopRoutes: null, stopLabelMinRank: 4, stopRadius: false, overlapZoom: 13, labelPadding: 30, placeTitles: true };
  const NAMES = [LAYERS.stopLabels, LAYERS.stopLabelsHeld, LAYERS.placeWorks, LAYERS.placeEvents, LAYERS.placeSeat, LAYERS.placeAssembly, LAYERS.placePharmacy, LAYERS.placeQuakeLabels, LAYERS.screenStopLabel];
  /** Every name but the screen's own (decision 19) and the held ones, which are cooperative (decision 19's hysteresis). */
  const YIELDING = NAMES.filter((id) => id !== LAYERS.screenStopLabel && id !== LAYERS.stopLabelsHeld);
  const MARKS = [LAYERS.vehicleNoses, LAYERS.vehicleTwoWayFore, LAYERS.vehicleTwoWayAft, LAYERS.vehicles, LAYERS.vehicleSelectedNose, LAYERS.vehicleSelected];

  it('stacks every name under every vehicle mark and over the vehicle dots, on every surface, so MapLibre places the marks first', () => {
    for (const options of [{}, { prozor: PROZOR, scale: 2 }]) {
      const ids = overlayLayers(OVERLAY_LIGHT, options).map((l) => l.id);
      const firstMark = Math.min(...MARKS.map((id) => ids.indexOf(id)));
      for (const id of NAMES) {
        expect(ids.indexOf(id), id).toBeGreaterThan(ids.indexOf(LAYERS.vehicleDots));
        expect(ids.indexOf(id), id).toBeLessThan(firstMark);
      }
      // Among themselves the names keep their order: the screen's stop placed first of them.
      expect(NAMES.map((id) => ids.indexOf(id))).toEqual([...NAMES.map((id) => ids.indexOf(id))].sort((a, b) => a - b));
      // The layer list is one list whatever the options, so setProzor is one styleDiff.
      expect(ids).toEqual(overlayLayers(OVERLAY_LIGHT).map((l) => l.id));
    }
  });

  it('keeps every vehicle mark always drawn; on the public screen the marks also keep their boxes for the names, elsewhere they ignore placement', () => {
    const wall = overlayLayers(OVERLAY_LIGHT, { prozor: PROZOR, scale: 2 });
    const phone = overlayLayers(OVERLAY_LIGHT);
    for (const id of MARKS) {
      const w = wall.find((l) => l.id === id)!.layout!;
      const ph = phone.find((l) => l.id === id)!.layout!;
      expect(w['icon-allow-overlap'], id).toBe(true);
      expect(w['icon-ignore-placement'], id).toBe(false);
      expect(ph['icon-allow-overlap'], id).toBe(true);
      expect(ph['icon-ignore-placement'], id).toBe(true);
    }
    for (const id of [LAYERS.vehicles, LAYERS.vehicleSelected]) {
      expect(wall.find((l) => l.id === id)!.layout!['text-allow-overlap'], id).toBe(true);
      expect(wall.find((l) => l.id === id)!.layout!['text-ignore-placement'], id).toBe(false);
      expect(phone.find((l) => l.id === id)!.layout!['text-ignore-placement'], id).toBe(true);
    }
    // No other name on the public screen overlaps anything: each one yields.
    for (const id of YIELDING) {
      const layout = wall.find((l) => l.id === id)!.layout!;
      expect(layout['text-allow-overlap'] ?? false, id).toBe(false);
      expect(layout['icon-allow-overlap'] ?? false, id).toBe(false);
      expect(layout['text-overlap'], id).toBeUndefined();
    }
    // Decision 19: the screen's own name is always drawn, in its one place, and blocks the others.
    const own = wall.find((l) => l.id === LAYERS.screenStopLabel)!.layout!;
    expect([own['text-allow-overlap'], own['text-ignore-placement'], own['text-anchor'], own['text-offset'], own['text-variable-anchor-offset']]).toEqual([true, false, 'top', [0, 0.9], undefined]);
    // The pills stay ordered among themselves: a cluster over a tram over a bus.
    expect(wall.find((l) => l.id === LAYERS.vehicles)!.layout!['symbol-sort-key']).toEqual(['get', 'sort']);
  });

  it('holds the stop names that just came back in their own cooperative twin, keyed by id, and fades a stop name by its `o` feature state (decision 19)', () => {
    const wall = overlayLayers(OVERLAY_LIGHT, { prozor: PROZOR, scale: 2, heldNames: ['1_1', '2_2'] });
    const ids = wall.map((l) => l.id);
    const normal = wall.find((l) => l.id === LAYERS.stopLabels)!;
    const twin = wall.find((l) => l.id === LAYERS.stopLabelsHeld)!;
    // Right over the stop names, so MapLibre places the held ones first and the rest flow round them.
    expect(ids.indexOf(LAYERS.stopLabelsHeld)).toBe(ids.indexOf(LAYERS.stopLabels) + 1);
    expect(twin.source).toBe(normal.source);
    expect(twin.minzoom).toBe(normal.minzoom);
    const base = (normal.filter as unknown[])[1];
    expect(normal.filter).toEqual(['all', base, ['!', ['in', ['get', 'id'], ['literal', ['1_1', '2_2']]]]]);
    expect(twin.filter).toEqual(['all', base, ['in', ['get', 'id'], ['literal', ['1_1', '2_2']]]]);
    // Over a pill's box, never over another name; otherwise the stop name's own layout and paint.
    expect(twin.layout).toEqual({ ...normal.layout, 'text-overlap': 'cooperative' });
    expect(twin.paint).toEqual(normal.paint);
    expect(normal.paint!['text-opacity']).toEqual(['number', ['feature-state', 'o'], 1]);
    // Nothing held: the same shape, an empty list. Off the public screen the twin draws nothing and the names keep their plain ink.
    expect(overlayLayers(OVERLAY_LIGHT, { prozor: PROZOR }).find((l) => l.id === LAYERS.stopLabelsHeld)!.filter).toEqual(['all', base, ['in', ['get', 'id'], ['literal', []]]]);
    const phone = overlayLayers(OVERLAY_LIGHT, { heldNames: ['1_1'] });
    expect(phone.find((l) => l.id === LAYERS.stopLabelsHeld)!.filter).toEqual(NEVER);
    expect(phone.find((l) => l.id === LAYERS.stopLabels)!.paint!['text-opacity']).toBeUndefined();
    // A hold that starts or ends is two filters, applied by styleDiff.
    expect(styleDiff(overlayLayers(OVERLAY_LIGHT, { prozor: PROZOR, scale: 2 }), wall).map((op) => `${op.id}:${op.kind}`).sort()).toEqual([`${LAYERS.stopLabels}:filter`, `${LAYERS.stopLabelsHeld}:filter`].sort());
  });

  it('lets a name on the public screen try its other anchors before it yields, starting exactly where the fixed anchor stood', () => {
    expect([...NAME_ANCHORS]).toEqual(['top', 'bottom', 'left', 'right']);
    expect(nameAnchorOffsets(0.7)).toEqual(['top', [0, 0.7 + 7 / 24], 'bottom', [0, -(0.7 + 7 / 24)], 'left', [0.7, 0], 'right', [-0.7, 0]]);
    expect(NAME_ANCHOR_BASELINE_EM).toBe(7 / 24);
    const wall = overlayLayers(OVERLAY_LIGHT, { prozor: PROZOR, scale: 2 });
    const phone = overlayLayers(OVERLAY_LIGHT);
    const offsets: Record<string, number> = { [LAYERS.stopLabels]: 0.7, [LAYERS.stopLabelsHeld]: 0.7, [LAYERS.placeQuakeLabels]: 0.9, [LAYERS.placeEvents]: 0.9, [LAYERS.placePharmacy]: 0.9 };
    for (const [id, em] of Object.entries(offsets)) {
      const w = wall.find((l) => l.id === id)!.layout!;
      expect(w['text-variable-anchor-offset'], id).toEqual(nameAnchorOffsets(em));
      expect(w['text-justify'], id).toBe('auto');
      expect(w['text-anchor'], id).toBeUndefined();
      expect(w['text-offset'], id).toBeUndefined();
      // Everywhere else the one fixed place, as always.
      const ph = phone.find((l) => l.id === id)!.layout!;
      expect([ph['text-anchor'], ph['text-offset'], ph['text-variable-anchor-offset']], id).toEqual(['top', [0, em], undefined]);
    }
    expect(phone.find((l) => l.id === LAYERS.screenStopLabel)!.layout!['text-anchor']).toBe('top');
    // setProzor on a live map: the anchors are layout, applied by styleDiff.
    const ops = styleDiff(phone, wall).filter((op) => op.id === LAYERS.stopLabels && op.kind === 'layout').map((op) => op.key).sort();
    expect(ops).toEqual(expect.arrayContaining(['text-anchor', 'text-justify', 'text-offset', 'text-variable-anchor-offset']));
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

  it('line focus hides the rest of the network instead of dimming it and paints the one line in its ZET colour, every other pill still drawn and inverted; switched off, the network dims as before and the selected route keeps that colour', () => {
    const focus = { routeId: '6', colour: '#cc706f' };
    // The focused route may come from a vehicle, which on its own lights nothing.
    const on = overlayLayers(OVERLAY_LIGHT, { selection: { kind: 'vehicle', id: 'v1' }, focus, lineFocus: true });
    for (const id of [LAYERS.networkTram, LAYERS.networkBus]) expect(on.find((l) => l.id === id)!.layout!.visibility, id).toBe('none');
    const selected = on.find((l) => l.id === LAYERS.networkSelected)!;
    expect(selected.filter).toEqual(['==', ['get', 'route'], '6']);
    expect(selected.paint!['line-color']).toBe('#cc706f');
    expect(on.find((l) => l.id === LAYERS.networkSelectedCasing)!.filter).toEqual(['==', ['get', 'route'], '6']);
    // Every pill still draws; the ones off the line invert, as under a route selection.
    expect(on.find((l) => l.id === LAYERS.vehicles)!.paint!['icon-color']).toEqual(pillInks(OVERLAY_LIGHT, '6').fill);
    expect(on.find((l) => l.id === LAYERS.vehicleDots)!.paint!['circle-opacity']).toEqual(['*', ['get', 'alpha'], ['case', ['==', ['get', 'routeId'], '6'], 1, VEHICLE_OPACITY_DIMMED]]);

    const off = overlayLayers(OVERLAY_LIGHT, { selection: { kind: 'route', id: '6' }, focus, lineFocus: false });
    expect(off.find((l) => l.id === LAYERS.networkTram)!.layout!.visibility).toBe('visible');
    expect(off.find((l) => l.id === LAYERS.networkTram)!.paint!['line-opacity']).toBe(NETWORK_OPACITY_DIMMED);
    expect(off.find((l) => l.id === LAYERS.networkSelected)!.paint!['line-color']).toBe('#cc706f');
    // A vehicle with the switch off is what it always was: nothing emphasised.
    const plain = overlayLayers(OVERLAY_LIGHT, { selection: { kind: 'vehicle', id: 'v1' }, focus, lineFocus: false });
    expect(plain.find((l) => l.id === LAYERS.networkSelected)!.filter).toEqual(NEVER);
    expect(plain.find((l) => l.id === LAYERS.networkTram)!.paint!['line-opacity']).toEqual(NETWORK_OPACITY);
  });

  it('line focus thins the stop rings to the focused line’s own platforms, keeps the selection ring and the screen’s own stop, and switched off draws every stop again', () => {
    const focus = { routeId: '6', colour: '#cc706f' };
    const stopsOf = (options: Parameters<typeof overlayLayers>[1]) => overlayLayers(OVERLAY_LIGHT, options).find((l) => l.id === LAYERS.stops)!;
    // Hiding every other line and keeping every other line’s rings left the
    // F6 capture a field of grey circles with no line under them.
    expect(stopsOf({ selection: { kind: 'vehicle', id: 'v1' }, focus, lineFocus: true }).filter)
      .toEqual(routeStopsFilter(null, ['6']));
    // The switch off is the whole network again, rings and all.
    expect(stopsOf({ selection: { kind: 'route', id: '6' }, focus, lineFocus: false }).filter).toEqual(stopFilter(null));
    expect(stopsOf({}).filter).toEqual(stopFilter(null));
    // The selection layer still lights the route’s platforms, and the
    // screen’s own stop is its own source and draws under focus too.
    const on = overlayLayers(OVERLAY_LIGHT, { selection: { kind: 'route', id: '6' }, focus, lineFocus: true });
    expect(on.find((l) => l.id === LAYERS.stopsRoute)!.filter).toEqual(['in', '6', ['get', 'routes']]);
    expect(on.find((l) => l.id === LAYERS.screenStop)!.filter).toBeUndefined();
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
