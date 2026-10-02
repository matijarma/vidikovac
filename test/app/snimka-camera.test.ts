// The small-fleet camera (app/src/snimka/camera.ts): the view a camera shows,
// the decision to go to the fleet (a reader's move wins, an empty fleet
// gives nothing, a normal fleet keeps the view, a fleet on screen needs no
// help, otherwise the envelope), and the camera that fits an envelope inside
// the zoom band.
import { describe, expect, it } from 'vitest';
import { cameraFor, FIT_MAX_ZOOM, FIT_MIN_ZOOM, FIT_PADDING_PX, fitDecision, fromWorld, inBounds, SMALL_FLEET_MAX, toWorld, viewBounds, type LonLat } from '../../app/src/snimka/camera';

const JELACIC: LonLat = [15.98, 45.815];
const W = 871;
const H = 522;
/** Metres per degree at Zagreb's latitude, for the checks below. */
const M_PER_LON = 111_320 * Math.cos((45.815 * Math.PI) / 180);
const M_PER_LAT = 111_320;

describe('the view', () => {
  it('round-trips through the world plane', () => {
    const w = toWorld(JELACIC);
    const back = fromWorld(w.x, w.y);
    expect(back[0]).toBeCloseTo(JELACIC[0], 9);
    expect(back[1]).toBeCloseTo(JELACIC[1], 9);
  });

  it('is 7.6 by 4.6 km at the opening zoom on the stage, centred on the camera', () => {
    const v = viewBounds(JELACIC, 12.6, W, H);
    const widthM = (v.east - v.west) * M_PER_LON;
    const heightM = (v.north - v.south) * M_PER_LAT;
    expect(widthM).toBeGreaterThan(7500);
    expect(widthM).toBeLessThan(7800);
    expect(heightM).toBeGreaterThan(4450);
    expect(heightM).toBeLessThan(4700);
    expect(widthM / heightM).toBeCloseTo(W / H, 1);
    expect((v.east + v.west) / 2).toBeCloseTo(JELACIC[0], 6);
    expect((v.north + v.south) / 2).toBeCloseTo(JELACIC[1], 3);
    expect(inBounds(JELACIC, v)).toBe(true);
    expect(inBounds([15.9204, 45.7897], v)).toBe(false); // line 17's tram of the fixture, 4.7 km west
    expect(inBounds([16.0049, 45.8016], v)).toBe(true); // line 13, 1.9 km east and 1.5 km south
  });

  it('doubles its span for every zoom step out', () => {
    const near = viewBounds(JELACIC, 12.6, W, H);
    const far = viewBounds(JELACIC, 11.6, W, H);
    expect((far.east - far.west) / (near.east - near.west)).toBeCloseTo(2, 6);
  });
});

describe('fitDecision', () => {
  const view = viewBounds(JELACIC, 12.6, W, H);
  const outsideWest: LonLat = [15.9204, 45.7897];
  const outsideSouth: LonLat = [15.9799, 45.7809];

  it('gives nothing for no vehicles, and ignores a point that is not a position', () => {
    expect(fitDecision([], view, false)).toEqual({ fit: false, reason: 'none' });
    expect(fitDecision([[Number.NaN, 45.8]], view, false)).toEqual({ fit: false, reason: 'none' });
  });

  it('keeps the view for a normal fleet, even one entirely outside it', () => {
    const many = Array.from({ length: SMALL_FLEET_MAX + 1 }, (_, i): LonLat => [15.90 + i * 0.001, 45.70]);
    expect(fitDecision(many, view, false)).toEqual({ fit: false, reason: 'many' });
    expect(SMALL_FLEET_MAX).toBe(12);
  });

  it('needs no help when one of a small fleet is already on screen', () => {
    expect(fitDecision([outsideWest, JELACIC], view, false)).toEqual({ fit: false, reason: 'inView' });
    const edge: LonLat = [view.east, view.north];
    expect(fitDecision([edge], view, false)).toEqual({ fit: false, reason: 'inView' });
  });

  it('never moves a map the reader moved, whatever the fleet', () => {
    expect(fitDecision([outsideWest], view, true)).toEqual({ fit: false, reason: 'userMoved' });
    expect(fitDecision([], view, true)).toEqual({ fit: false, reason: 'userMoved' });
  });

  it('goes to the envelope of a small fleet that is wholly off screen', () => {
    expect(fitDecision([outsideWest], view, false)).toEqual({ fit: true, bounds: { west: 15.9204, south: 45.7897, east: 15.9204, north: 45.7897 } });
    expect(fitDecision([outsideWest, outsideSouth], view, false)).toEqual({ fit: true, bounds: { west: 15.9204, south: 45.7809, east: 15.9799, north: 45.7897 } });
    const twelve = Array.from({ length: SMALL_FLEET_MAX }, (_, i): LonLat => [15.90 + i * 0.001, 45.70]);
    expect(fitDecision(twelve, view, false).fit).toBe(true);
  });
});

describe('cameraFor', () => {
  it('centres on a single vehicle at the top of the band', () => {
    const cam = cameraFor({ west: 15.9204, south: 45.7897, east: 15.9204, north: 45.7897 }, W, H);
    expect(cam.zoom).toBe(FIT_MAX_ZOOM);
    expect(cam.center[0]).toBeCloseTo(15.9204, 9);
    expect(cam.center[1]).toBeCloseTo(45.7897, 9);
  });

  it('fits the fixture’s two off-screen vehicles (4.6 km apart) at the top of the band with the padding clear', () => {
    const bounds = { west: 15.9204, south: 45.7809, east: 15.9799, north: 45.7897 };
    const cam = cameraFor(bounds, W, H);
    expect(cam.zoom).toBe(FIT_MAX_ZOOM);
    const inner = viewBounds(cam.center, cam.zoom, W - 2 * FIT_PADDING_PX, H - 2 * FIT_PADDING_PX);
    expect(inBounds([bounds.west, bounds.south], inner)).toBe(true);
    expect(inBounds([bounds.east, bounds.north], inner)).toBe(true);
    expect(cam.center[0]).toBeCloseTo((bounds.west + bounds.east) / 2, 9);
  });

  it('fits a pair ten kilometres apart tightly inside the band: a step closer would push a corner out of the padded box', () => {
    const bounds = { west: 15.90, south: 45.79, east: 16.03, north: 45.81 };
    const cam = cameraFor(bounds, W, H);
    expect(cam.zoom).toBeLessThan(FIT_MAX_ZOOM);
    expect(cam.zoom).toBeGreaterThan(FIT_MIN_ZOOM);
    // The limiting corners sit on the padded box's edge: one CSS px of tolerance for the floating point.
    const inner = viewBounds(cam.center, cam.zoom, W - 2 * FIT_PADDING_PX + 1, H - 2 * FIT_PADDING_PX + 1);
    expect(inBounds([bounds.west, bounds.south], inner)).toBe(true);
    expect(inBounds([bounds.east, bounds.north], inner)).toBe(true);
    const closer = viewBounds(cam.center, cam.zoom + 0.2, W - 2 * FIT_PADDING_PX, H - 2 * FIT_PADDING_PX);
    expect(inBounds([bounds.west, bounds.south], closer) && inBounds([bounds.east, bounds.north], closer)).toBe(false);
    const view = viewBounds(cam.center, cam.zoom, W, H);
    expect(view.west).toBeLessThan(bounds.west);
    expect(view.east).toBeGreaterThan(bounds.east);
  });

  it('stops at the whole-network zoom for a fleet spread across the city', () => {
    const cam = cameraFor({ west: 15.87, south: 45.75, east: 16.10, north: 45.86 }, W, H);
    expect(cam.zoom).toBe(FIT_MIN_ZOOM);
    expect(cam.center[0]).toBeCloseTo(15.985, 6);
  });

  it('respects a caller’s own band and padding', () => {
    const cam = cameraFor({ west: 15.9204, south: 45.7897, east: 15.9204, north: 45.7897 }, W, H, { maxZoom: 12, minZoom: 11, paddingPx: 0 });
    expect(cam.zoom).toBe(12);
  });
});

// ---- v3: the passive frame and the edge marker (decision V3-13) ------------------------------------------------

import { EDGE_INSET_PX, NETWORK_FRAME_MIN_ZOOM, NETWORK_FRAME_PADDING_PX, edgeMarkerFor, networkBounds, networkFrame } from '../../app/src/snimka/camera';
import { toPlane } from '../../shared/motion/geo';

/** A two-route artefact: tram 6 with a normal shape (0) and a depot run (1) far to the east, bus 228 way out of town. */
const net = {
  routes: new Map([
    ['6', { short: '6', type: 0, rank: 1, shapes: [0, 1], main: [0] }],
    ['228', { short: '228', type: 3, rank: 2, shapes: [2] }],
  ]),
  shapes: [
    { id: 's0', route: '6', pts: [toPlane(15.92, 45.78), toPlane(16.02, 45.84)], cum: [0, 1], len: 1 },
    { id: 's1', route: '6', pts: [toPlane(16.30, 45.90)], cum: [0], len: 0 },
    { id: 's2', route: '228', pts: [toPlane(15.50, 45.50)], cum: [0], len: 0 },
  ],
} as never;

describe('networkBounds and networkFrame', () => {
  it('spans the tram routes’ normal shapes only: no depot run, no bus', () => {
    const b = networkBounds(net)!;
    expect(b.west).toBeCloseTo(15.92, 6);
    expect(b.east).toBeCloseTo(16.02, 6);
    expect(b.south).toBeCloseTo(45.78, 6);
    expect(b.north).toBeCloseTo(45.84, 6);
    expect(networkBounds({ routes: new Map(), shapes: [] } as never)).toBeNull();
  });
  it('frames the network with the margin clear, between the floor and the opening zoom, once per box size (pure)', () => {
    const b = networkBounds(net)!;
    const cam = networkFrame(b, W, H, 12.6);
    expect(cam.zoom).toBeGreaterThanOrEqual(NETWORK_FRAME_MIN_ZOOM);
    expect(cam.zoom).toBeLessThanOrEqual(12.6);
    const inner = viewBounds(cam.center, cam.zoom, W - 2 * NETWORK_FRAME_PADDING_PX + 1, H - 2 * NETWORK_FRAME_PADDING_PX + 1);
    expect(inBounds([b.west, b.south], inner)).toBe(true);
    expect(inBounds([b.east, b.north], inner)).toBe(true);
    expect(networkFrame(b, W, H, 12.6)).toEqual(cam);
    // A narrower box frames further out; the floor holds for a sliver.
    expect(networkFrame(b, 480, H, 12.6).zoom).toBeLessThan(cam.zoom);
    expect(networkFrame(b, 60, 60, 12.6).zoom).toBe(NETWORK_FRAME_MIN_ZOOM);
    // A box the size of the real network's envelope (about 13 by 9 km) at 645 px lands in R1's band, z 11.3 to 11.8.
    expect(networkFrame({ west: 15.90, south: 45.76, east: 16.07, north: 45.84 }, 645, 522, 12.6).zoom).toBeGreaterThan(11.2);
  });
});

describe('edgeMarkerFor', () => {
  it('is nothing while every vehicle is inside the box or there is none', () => {
    expect(edgeMarkerFor([], W, H)).toBeNull();
    expect(edgeMarkerFor([{ x: 10, y: 10 }, { x: W, y: H }], W, H)).toBeNull();
    expect(edgeMarkerFor([{ x: Number.NaN, y: 5 }], W, H)).toBeNull();
  });
  it('counts the vehicles outside and stands on the inset edge toward the nearest of them', () => {
    const m = edgeMarkerFor([{ x: W / 2, y: -300 }, { x: W + 20, y: H / 2 }, { x: 10, y: 10 }], W, H)!;
    expect(m.count).toBe(2);
    // The one 20 px past the right edge (455 px from the centre) is nearer than the one 300 px above (561 px): the marker sits on the right edge, mid-height.
    expect(m.x).toBeCloseTo(W - EDGE_INSET_PX, 6);
    expect(m.y).toBeCloseTo(H / 2, 6);
    expect(m.angle).toBeCloseTo(0, 6);
    const up = edgeMarkerFor([{ x: W / 2, y: -300 }], W, H)!;
    expect(up.y).toBeCloseTo(EDGE_INSET_PX, 6);
    expect(up.x).toBeCloseTo(W / 2, 6);
    expect(up.angle).toBeCloseTo(-90, 6);
    const corner = edgeMarkerFor([{ x: -1000, y: -1000 }], 200, 200, 10)!;
    expect(corner.x).toBeCloseTo(10, 6);
    expect(corner.y).toBeCloseTo(10, 6);
  });
});
