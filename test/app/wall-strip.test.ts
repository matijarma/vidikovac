// @vitest-environment happy-dom
// The wall's map when its pane is short (lane w-labels, 24 Sep): a 1280 x 800
// desktop window gave the compact wall's map a 669 x 162 strip, and its two
// hub pills, all the trams and all the buses, lay over each other and over
// the own name (reports/lane-p-map.md). Two rules. The layout: the map pane
// keeps a legible minimum (map/frame.ts MAP_MIN_HEIGHT_PX) whenever the list
// beside it, with the QR card under it, still holds the rows it never drops
// (invitation.ts cardPlacement). The map: below that minimum it is the frame's
// stop rings and the pills alone, and the pills yield to one another instead
// of overlapping, so what is drawn is never on top of something else.
import { describe, expect, it, vi } from 'vitest';
import { cardPlacement } from '../../app/src/kiosk/invitation';
import { createKioskMapAdapter, FIELD_SPAN_M, requestKioskMap } from '../../app/src/kiosk/mapview';
import { createMapSlots } from '../../app/src/map/map-slots';
import { MAP_MIN_HEIGHT_PX } from '../../app/src/map/frame';
import { pillOverlaps, pillsClipped } from '../../app/src/map/name-census';
import { LAYERS, NEVER, overlayLayers, type ProzorOptions } from '../../app/src/map/overlays';
import { OVERLAY_DARK } from '../../app/src/map/basemap';
import { emptyCity, type CityState } from '../../shared/city/types';

const NOW = Date.parse('2026-09-24T10:00:00Z');
const STOP = { id: '106_1', name: 'Trg bana J. Jelačića', lon: 15.97726, lat: 45.81286, routes: ['6', '11', '13'] };

describe('the map pane’s legible minimum', () => {
  it('is two read-tier rows plus the own place’s ring and name and the frame’s clearance', () => {
    // 2 x 40 px x 1.2 (the read tier's line), the own ring at the wall's scale 2 (9 px radius, 2 px halo: 44 px across),
    // its 30 px name at 1.2, and 24 px of frame padding on either side.
    expect(MAP_MIN_HEIGHT_PX).toBe(2 * 40 * 1.2 + 44 + 30 * 1.2 + 2 * 24);
  });

  it('keeps the card under the map when the map is legible there, moves it under the list when the list still holds its promises, and lets the promises win otherwise', () => {
    const min = MAP_MIN_HEIGHT_PX;
    expect(cardPlacement({ mapUnderPx: min, listAsidePx: 0, floorPx: 999, minMapPx: min })).toBe('map');
    expect(cardPlacement({ mapUnderPx: 162, listAsidePx: 216, floorPx: 180, minMapPx: min })).toBe('aside');
    expect(cardPlacement({ mapUnderPx: 162, listAsidePx: 216, floorPx: 216, minMapPx: min })).toBe('aside');
    // At night the first tram, the pharmacy and one departure need more than the list would keep: decision 50 stands.
    expect(cardPlacement({ mapUnderPx: 116, listAsidePx: 173, floorPx: 300, minMapPx: min })).toBe('map');
    // Nothing measured yet: the arrangement stays as it is laid out.
    expect(cardPlacement({ mapUnderPx: 0, listAsidePx: 0, floorPx: 0, minMapPx: min })).toBe('map');
  });
});

describe('pills on a short map', () => {
  const PROZOR: ProzorOptions = { networkKinds: ['tram', 'bus'], stopRoutes: null, stopLabelMinRank: 4, stopRadius: false, overlapZoom: 10.4, labelPadding: 24 };
  it('yield to one another (no pill over a pill) and draw no stray nose, only when the option set says so', () => {
    const strip = overlayLayers(OVERLAY_DARK, { prozor: { ...PROZOR, pillsYield: true }, scale: 2 });
    const by = (id: string) => strip.find((l) => l.id === id)!;
    expect(by(LAYERS.vehicles).layout!['icon-allow-overlap']).toBe(false);
    expect(by(LAYERS.vehicles).layout!['text-allow-overlap']).toBe(false);
    for (const id of [LAYERS.vehicleNoses, LAYERS.vehicleTwoWayFore, LAYERS.vehicleTwoWayAft]) expect(by(id).filter, id).toEqual(NEVER);
    const full = overlayLayers(OVERLAY_DARK, { prozor: PROZOR, scale: 2 });
    expect(full.find((l) => l.id === LAYERS.vehicles)!.layout!['icon-allow-overlap']).toBe(true);
    expect(JSON.stringify(overlayLayers(OVERLAY_DARK, { prozor: { ...PROZOR, pillsYield: false }, scale: 2 }))).toBe(JSON.stringify(full));
  });

  // The own name is drawn under the pills (decision 19), so on a strip a hub pill standing on the place
  // covered it (Trg at 714 x 413: the fourteen tram lines' pill lay on "Trg bana J. Jelačića"). An unseen
  // copy of the name above the pills is placed first, and a pill that would cover the name yields.
  it('keeps the own name clear of the pills on a strip with an unseen copy placed before them', () => {
    const ids = (layers: ReturnType<typeof overlayLayers>) => layers.map((l) => l.id);
    const strip = overlayLayers(OVERLAY_DARK, { prozor: { ...PROZOR, pillsYield: true }, scale: 2 });
    const guard = strip.find((l) => l.id === LAYERS.screenStopGuard)!;
    const own = strip.find((l) => l.id === LAYERS.screenStopLabel)!;
    expect(ids(strip).indexOf(LAYERS.screenStopGuard)).toBeGreaterThan(ids(strip).indexOf(LAYERS.vehicles));
    expect(guard.source).toBe(own.source);
    for (const key of ['text-field', 'text-font', 'text-size', 'text-anchor', 'text-offset', 'text-max-width']) expect(guard.layout![key], key).toEqual(own.layout![key]);
    expect(guard.layout!['text-allow-overlap']).toBe(true);
    expect(guard.layout!['text-ignore-placement']).toBe(false);
    expect(guard.paint!['text-opacity']).toBe(0);
    expect(guard.filter).not.toEqual(NEVER);
    // Off the strip the copy places nothing, so every other map keeps decision 19 exactly.
    expect(overlayLayers(OVERLAY_DARK, { prozor: PROZOR, scale: 2 }).find((l) => l.id === LAYERS.screenStopGuard)!.filter).toEqual(NEVER);
  });

  it('counts pills over pills and pills past the map’s edge, for the census', () => {
    const box = (left: number, top: number, w = 40, h = 20) => ({ left, top, right: left + w, bottom: top + h });
    expect(pillOverlaps([box(0, 0), box(30, 10), box(100, 100)])).toBe(1);
    expect(pillOverlaps([box(0, 0), box(40, 0)])).toBe(0);
    expect(pillsClipped([box(-1, 10), box(10, 10), box(640, 150)], { width: 669, height: 162 })).toBe(2);
    expect(pillsClipped([box(10, 10)], { width: 0, height: 0 })).toBe(0);
  });
});

describe('the wall’s map below its legible minimum', () => {
  const iso = new Date(NOW - 60_000).toISOString();
  const city: CityState = { ...emptyCity(), live: { schema: 1 as never, generatedAt: iso, sources: [{ id: 'bajs', name: 'BAJS', url: 'https://example.test/', licence: 'x', status: 'live', count: 1 }],
    bikes: [{ id: 'b1', name: 'b1', lon: STOP.lon, lat: STOP.lat + 0.002, bikes: 3, docks: 5, capacity: 8, installed: true, renting: true, returning: true, observedAt: iso }], air: [], consultations: [] } };
  const stub = () => {
    const calls = { setModes: vi.fn(), setCityLabels: vi.fn(), setProzor: vi.fn(), setOutline: vi.fn(), update: vi.fn(), setView: vi.fn() };
    const factory = vi.fn((_options: unknown) => ({ ...calls, pause: vi.fn(), resume: vi.fn(), destroy: vi.fn() }));
    const adapter = createKioskMapAdapter(factory);
    return { calls, factory, adapter, maps: createMapSlots(adapter.factory) };
  };
  const base = { stop: STOP, placeSet: true, frame: 6 as const, city, snapshots: {}, now: NOW, selection: null, phase: 'invitation' as const, spanM: FIELD_SPAN_M, ariaLabel: 'karta' };
  const first = (s: ReturnType<typeof stub>) => s.factory.mock.calls[0]![0] as { points: { id: string; place?: string }[]; prozor: ProzorOptions; cityLabels: unknown };

  it('is the frame’s rings and the pills, which yield to one another; a legible pane keeps its discs and names', () => {
    const strip = stub();
    requestKioskMap(strip.maps, { ...base, widthPx: 669, heightPx: 162 }, strip.adapter);
    expect(first(strip).prozor.pillsYield).toBe(true);
    expect(first(strip).points.some((p) => p.place === 'city')).toBe(false);
    expect(first(strip).cityLabels).toBe('none');
    // The same strip on a display at twice the zoom is shorter still in design px.
    const zoomed = stub();
    requestKioskMap(zoomed.maps, { ...base, widthPx: 1338, heightPx: 324, displayScale: 2 }, zoomed.adapter);
    expect(first(zoomed).prozor.pillsYield).toBe(true);
    // Tall enough but framed below the marks' floor (Trg at 669 x 457 fits at z12.3): the discs would pile, so a strip too.
    const low = stub();
    requestKioskMap(low.maps, { ...base, widthPx: 669, heightPx: 457 }, low.adapter);
    expect((low.factory.mock.calls[0]![0] as { zoom: number }).zoom).toBeLessThan(12.7);
    expect(first(low).prozor.pillsYield).toBe(true);
    // The wall's own field frames Trg at z13.2 and keeps its discs and names.
    const tall = stub();
    requestKioskMap(tall.maps, { ...base, widthPx: 1170, heightPx: 803 }, tall.adapter);
    expect(first(tall).prozor.pillsYield).toBeUndefined();
    expect(first(tall).points.some((p) => p.place === 'city')).toBe(true);
    expect(first(tall).cityLabels).toBe('venues');
    // The whole-city window follows the height rule, not the zoom one (its small dots are drawn for z12.5);
    // a phone's band never does.
    const city2 = stub();
    requestKioskMap(city2.maps, { ...base, placeSet: false, widthPx: 669, heightPx: 162 }, city2.adapter);
    expect(first(city2).prozor.pillsYield).toBe(true);
    const city3 = stub();
    requestKioskMap(city3.maps, { ...base, placeSet: false, widthPx: 669, heightPx: MAP_MIN_HEIGHT_PX }, city3.adapter);
    expect(first(city3).prozor.pillsYield).toBeUndefined();
    const phone = stub();
    requestKioskMap(phone.maps, { ...base, handheld: true, widthPx: 356, heightPx: 160 }, phone.adapter);
    expect(first(phone).prozor.pillsYield).toBeUndefined();
  });
});
