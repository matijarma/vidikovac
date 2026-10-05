// Seam S2: shared/city/frame.ts. The measured radius (N stops down the tram
// lines that serve the place, orchestrator decision 6, read as the 25th
// percentile of the ways out; bus stops by air as the fallback; held to each
// Kadar's caps), the camera span and the "U blizini" pill.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import stopsJson from '../../app/public/data/stops.json';
import {
  DEFAULT_FRAME_STOPS,
  FRAME_PERCENTILE,
  FRAME_RADIUS_CAP_M,
  FRAME_RADIUS_M,
  FRAME_SAME_STOP_M,
  FRAME_STOPS,
  FRAME_TRAM_REACH_M,
  WALK_MIN_PER_KM,
  frameLinesOf,
  frameRadiusM,
  frameSpanM,
  frameStopsFrom,
  isFrameStops,
  pillText,
  type FrameLine,
  type FrameStop,
  type FrameStops,
} from '../../shared/city/frame';
import { decodeNetwork } from '../../shared/motion/network';
import { isTramRoute } from '../../worker/pairing/place';
import type { ScreenStop } from '../../worker/protocol';

const PLACE = { lon: 16.0, lat: 45.8 };
/** Metres per degree of latitude on the sphere shared/city/geo.ts distanceM uses (R = 6,371 km). */
const M_PER_DEG = (6_371_000 * Math.PI) / 180;
/** Metres per degree of longitude at PLACE's latitude, on the same sphere. */
const M_PER_DEG_LON = M_PER_DEG * Math.cos((PLACE.lat * Math.PI) / 180);
type Row = { id: string; name: string; lon: number; lat: number; routes: string[] };
/** A platform `north` metres north (negative: south) and `east` metres east of PLACE. */
const at = (id: string, name: string, north: number, east = 0, routes = ['6']): Row => ({ id, name, lon: PLACE.lon + east / M_PER_DEG_LON, lat: PLACE.lat + north / M_PER_DEG, routes });
const isTram = (route: string) => route !== '109';
/** A tram line due north from PLACE: its stop P at PLACE, then `count` stops every `step` metres, named S1, S2, … */
const northLine = (step: number, count: number, prefix = 'n'): { rows: Row[]; line: FrameLine } => {
  const rows = [at(`${prefix}0`, 'P', 0), ...Array.from({ length: count }, (_, i) => at(`${prefix}${i + 1}`, `S${i + 1}`, step * (i + 1)))];
  return { rows, line: rows.map((r) => r.id) };
};
const table = (rows: Row[], lines: FrameLine[] = []): FrameStop[] => frameStopsFrom(rows, isTram, lines);
/** A stop `d` metres due north of PLACE, so its air distance is exactly `d`. */
const north = (name: string, d: number, tram = true): FrameStop => ({ name, lon: PLACE.lon, lat: PLACE.lat + d / M_PER_DEG, tram });

describe('frame constants', () => {
  it('offers Kadar 2, 4 and 6, four by default; a stored 8 is no longer a Kadar', () => {
    expect(FRAME_STOPS).toEqual([2, 4, 6]);
    expect(DEFAULT_FRAME_STOPS).toBe(4);
    expect([2, 4, 6].every(isFrameStops)).toBe(true);
    expect([8, 5, '4', null, undefined, 4.5].some(isFrameStops)).toBe(false);
  });

  it('keeps the fallback table, the per-Kadar caps and the bounds', () => {
    expect(FRAME_RADIUS_M).toEqual({ 2: 650, 4: 950, 6: 1250 });
    expect(Object.isFrozen(FRAME_RADIUS_M)).toBe(true);
    expect(FRAME_RADIUS_CAP_M).toEqual({ 2: [400, 700], 4: [650, 1000], 6: [900, 1300] });
    expect(Object.isFrozen(FRAME_RADIUS_CAP_M) && FRAME_STOPS.every((n) => Object.isFrozen(FRAME_RADIUS_CAP_M[n]))).toBe(true);
    // Both bounds grow with N (the clamp keeps a wider Kadar from framing less), and the fallback sits inside its caps.
    for (const [a, b] of [[2, 4], [4, 6]] as const) {
      expect(FRAME_RADIUS_CAP_M[a][0]).toBeLessThan(FRAME_RADIUS_CAP_M[b][0]);
      expect(FRAME_RADIUS_CAP_M[a][1]).toBeLessThan(FRAME_RADIUS_CAP_M[b][1]);
    }
    for (const n of FRAME_STOPS) {
      expect(FRAME_RADIUS_M[n]).toBeGreaterThanOrEqual(FRAME_RADIUS_CAP_M[n][0]);
      expect(FRAME_RADIUS_M[n]).toBeLessThanOrEqual(FRAME_RADIUS_CAP_M[n][1]);
    }
    expect([FRAME_PERCENTILE, FRAME_TRAM_REACH_M, WALK_MIN_PER_KM, FRAME_SAME_STOP_M]).toEqual([0.25, 3000, 7.5, 300]);
  });
});

describe('frameRadiusM', () => {
  it('walks N stops down the line that serves the place', () => {
    const { rows, line } = northLine(200, 10);
    const stops = table(rows, [line]);
    expect(frameRadiusM(PLACE, stops, 2)).toBeCloseTo(400, 3);
    expect(frameRadiusM(PLACE, stops, 4)).toBeCloseTo(800, 3);
    expect(frameRadiusM(PLACE, stops, 6)).toBeCloseTo(1200, 3);
  });

  it('counts the stops down the place\u2019s own lines, not the nearest stops of other lines by air', () => {
    // The place's line runs north every 200 m; another line crosses 100–400 m to the east and never calls at P.
    const own = northLine(200, 10);
    const cross = [at('x1', 'X1', 100, 150), at('x2', 'X2', 0, 250), at('x3', 'X3', -100, 350), at('x4', 'X4', -200, 400), at('x5', 'X5', -300, 450)];
    const stops = table([...own.rows, ...cross], [own.line, cross.map((r) => r.id)]);
    expect(frameRadiusM(PLACE, stops, 4)).toBeCloseTo(800, 3);
    // By air the fourth-nearest stop name would be a crossing stop (X3, 364 m), under Kadar 4's lower cap.
    expect(Math.hypot(100, 350)).toBeLessThan(FRAME_RADIUS_CAP_M[4][0]);
  });

  it('walks both directions from the stop\u2019s platforms and counts each way out once, however many lines run it', () => {
    // North every 200 m on three lines that share every stop; south every 300 m from the opposite platform 20 m away.
    const up = northLine(200, 8);
    const down = [at('p2', 'P', -20), ...Array.from({ length: 8 }, (_, i) => at(`s${i + 1}`, `South ${i + 1}`, -300 * (i + 1)))];
    const stops = table([...up.rows, ...down], [up.line, up.line, up.line, down.map((r) => r.id)]);
    // The 25th percentile of the two ways out, 800 m north and 1200 m south (a quarter of the way up: 900 m); the
    // three lines north are one of them (counted three times the percentile would read 800 m).
    expect(frameRadiusM(PLACE, stops, 4)).toBeCloseTo(900, 3);
  });

  it('reads the 25th percentile of the ways out, so one long direction does not drive the frame', () => {
    // Four ways out from four platforms of P: the fourth stops lie 700, 800, 900 and 2400 m away.
    const way = (prefix: string, north: number, east: number, step: number): Row[] =>
      [at(`${prefix}0`, 'P', north * 10, east * 10), ...Array.from({ length: 6 }, (_, i) => at(`${prefix}${i + 1}`, `${prefix.toUpperCase()}${i + 1}`, north * step * (i + 1), east * step * (i + 1)))];
    const ways = [way('n', 1, 0, 175), way('e', 0, 1, 200), way('s', -1, 0, 225), way('w', 0, -1, 600)];
    const stops = table(ways.flat(), ways.map((rows) => rows.map((r) => r.id)));
    // The median would be 850 m and the far west way would pull a mean to 1200 m; the quarter reads 775 m.
    expect(frameRadiusM(PLACE, stops, 4)).toBeCloseTo(775, 0);
  });

  it('counts platforms that share a name once, never the place\u2019s own name, and keeps a stop\u2019s far-off namesake out of its platforms', () => {
    const rows = [at('p', 'P', 0), at('p-b', 'P', 40), at('a', 'A', 200), at('a-b', 'A', 230), at('b', 'B', 400), at('c', 'C', 600), at('d', 'D', 800), at('e', 'E', 1000)];
    // A stop also named P five kilometres south, on a line of its own: it is not the place's platform.
    const far = [at('pz', 'P', -5000), at('z1', 'Z1', -5100), at('z2', 'Z2', -5200), at('z3', 'Z3', -5300), at('z4', 'Z4', -5400)];
    const stops = table([...rows, ...far], [rows.map((r) => r.id), far.map((r) => r.id)]);
    expect(frameRadiusM({ ...PLACE, name: 'P', kind: 'tram' }, stops, 2)).toBeCloseTo(400, 3);
    expect(frameRadiusM({ ...PLACE, name: 'P', kind: 'tram' }, stops, 4)).toBeCloseTo(800, 3);
  });

  it('measures an address from the address, down the lines of the nearest tram stop', () => {
    const { rows, line } = northLine(200, 8);
    const stops = table(rows, [line]);
    const address = { lon: PLACE.lon - 300 / M_PER_DEG_LON, lat: PLACE.lat, name: 'Ilica 1', kind: 'address' };
    // The fourth stop is 800 m north of P, the address 300 m west of P.
    expect(frameRadiusM(address, stops, 4)).toBeCloseTo(Math.hypot(800, 300), -1);
  });

  it('reaches the end of a line that ends before N stops', () => {
    const { rows, line } = northLine(400, 3);
    expect(frameRadiusM(PLACE, table(rows, [line]), 6)).toBeCloseTo(1200, 3);
  });

  it('grows with N', () => {
    for (const step of [150, 420]) {
      const { rows, line } = northLine(step, 12);
      const stops = table(rows, [line]);
      const [r2, r4, r6] = FRAME_STOPS.map((n: FrameStops) => frameRadiusM(PLACE, stops, n));
      expect(r2).toBeLessThan(r4!);
      expect(r4).toBeLessThan(r6!);
    }
  });

  it('never frames less for a wider Kadar: a line that curves back, and lines of different lengths', () => {
    // North 340 m a stop to the second, then back south-east: the fourth stop lies nearer by air than the second.
    const curve = [at('c0', 'P', 0), at('c1', 'C1', 340), at('c2', 'C2', 680), at('c3', 'C3', 600, 250), at('c4', 'C4', 500, 300), at('c5', 'C5', 300, 500), at('c6', 'C6', 100, 600)];
    const curved = table(curve, [curve.map((r) => r.id)]);
    const [c2, c4, c6] = FRAME_STOPS.map((n) => frameRadiusM(PLACE, curved, n));
    expect(Math.hypot(500, 300)).toBeLessThan(680); // the bare fourth stop
    expect(c2).toBeCloseTo(680, 3);
    expect(c4).toBe(c2);
    expect(c6).toBe(FRAME_RADIUS_CAP_M[6][0]);
    // A long line north every 150 m and a short one south every 500 m that ends after five stops: at Kadar 6 only
    // the long line reaches its sixth stop (900 m), while Kadar 4's quarter between 600 and 2000 m is 950 m.
    const long = northLine(150, 10);
    const short = [at('q0', 'P', -20), ...Array.from({ length: 5 }, (_, i) => at(`q${i + 1}`, `Q${i + 1}`, -500 * (i + 1)))];
    const mixed = table([...long.rows, ...short], [long.line, short.map((r) => r.id)]);
    const [m2, m4, m6] = FRAME_STOPS.map((n) => frameRadiusM(PLACE, mixed, n));
    expect(m4).toBeCloseTo(950, -1);
    expect(m6).toBe(m4);
    expect(m2).toBeLessThanOrEqual(m4!);
  });

  it('starts from the nearest tram platform, in a stable order, and falls back when that stop has no line order', () => {
    // The place's own tram platform has no line order; a line runs two kilometres away: the frame does not borrow it.
    const far = [at('f0', 'Far', 2000), ...Array.from({ length: 8 }, (_, i) => at(`f${i + 1}`, `F${i + 1}`, 2000 + 300 * (i + 1)))];
    const lonely = table([at('p', 'P', 0), ...far], [far.map((r) => r.id)]);
    expect(FRAME_STOPS.map((n) => frameRadiusM(PLACE, lonely, n))).toEqual([650, 950, 1250]);
    // Two tram stops of different names, each 100 m from the place, each on its own line: the platform with the
    // smaller id wins whatever the table's order.
    const west = [at('a', 'West', 0, -100), ...Array.from({ length: 6 }, (_, i) => at(`w${i + 1}`, `W${i + 1}`, 200 * (i + 1), -100))];
    const east = [at('b', 'East', 0, 100), ...Array.from({ length: 6 }, (_, i) => at(`e${i + 1}`, `E${i + 1}`, 500 * (i + 1), 100))];
    const lines = [west.map((r) => r.id), east.map((r) => r.id)];
    const one = frameRadiusM(PLACE, table([...west, ...east], lines), 4);
    const other = frameRadiusM(PLACE, table([...east, ...west], lines), 4);
    expect(one).toBe(other);
    expect(one).toBeCloseTo(Math.hypot(800, 100), 0);
  });

  it('is always a finite number of metres: rows with a broken position are never counted, a place without one takes the table', () => {
    const buses = Array.from({ length: 10 }, (_, i) => north(`B${i + 1}`, 200 * (i + 1), false));
    const broken: FrameStop[] = [
      { name: 'X1', lon: Number.NaN, lat: 45.8, tram: false },
      { name: 'X2', lon: 16, lat: Number.POSITIVE_INFINITY, tram: false },
      { name: 'X3', lon: null as unknown as number, lat: undefined as unknown as number, tram: false },
      { name: 'X4', lon: Number.NaN, lat: Number.NaN, tram: true },
    ];
    for (const n of FRAME_STOPS) {
      const r = frameRadiusM(PLACE, [...broken, ...buses], n);
      expect(Number.isFinite(r)).toBe(true);
      expect(r).toBeCloseTo(200 * n, 3);
    }
    expect(frameRadiusM(PLACE, broken, 6)).toBe(FRAME_RADIUS_CAP_M[6][1]);
    const { rows, line } = northLine(200, 10);
    expect(frameRadiusM(PLACE, [...broken, ...table(rows, [line])], 4)).toBeCloseTo(800, 3);
    expect(FRAME_STOPS.map((n) => frameRadiusM({ lon: Number.NaN, lat: 45.8 }, table(rows, [line]), n))).toEqual([650, 950, 1250]);
  });

  it('counts bus stops by air only when no tram stop lies within 3 km, the place\u2019s own stop included', () => {
    const buses = Array.from({ length: 10 }, (_, i) => north(`B${i + 1}`, 180 * (i + 1), false));
    expect(frameRadiusM(PLACE, [...buses, north('Far tram', 3200)], 4)).toBeCloseTo(720, 3);
    // A bus-stop place does not count its own name.
    expect(frameRadiusM({ ...PLACE, name: 'B1', kind: 'bus' }, [...buses, north('Far tram', 3200)], 4)).toBeCloseTo(900, 3);
    // The place is a tram stop whose next stops lie beyond 3 km, with buses all around it: its own
    // stop is a tram within reach, so the frame walks the tram line (capped) and ignores the buses.
    const rows = [at('t0', 'Tram P', 0), at('t1', 'T1', 3200), at('t2', 'T2', 3400), at('t3', 'T3', 3600), at('t4', 'T4', 3800)];
    const lonely = [...table(rows, [rows.map((r) => r.id)]), ...buses];
    expect(frameRadiusM({ ...PLACE, name: 'Tram P', kind: 'tram' }, lonely, 4)).toBe(FRAME_RADIUS_CAP_M[4][1]);
  });

  it('holds every Kadar to its own caps', () => {
    const close = northLine(50, 10);
    expect(FRAME_STOPS.map((n) => frameRadiusM(PLACE, table(close.rows, [close.line]), n))).toEqual([400, 650, 900]);
    const wide = northLine(1000, 10);
    expect(FRAME_STOPS.map((n) => frameRadiusM(PLACE, table(wide.rows, [wide.line]), n))).toEqual([700, 1000, 1300]);
    // Fewer than N bus stops in the whole table reads as the Kadar's upper cap.
    expect(frameRadiusM(PLACE, [north('B1', 300, false), north('B2', 600, false)], 6)).toBe(1300);
  });

  it('falls back to the table when no stops are loaded, or no tram line order is known', () => {
    expect(FRAME_STOPS.map((n) => frameRadiusM(PLACE, [], n))).toEqual([650, 950, 1250]);
    const { rows } = northLine(300, 10);
    expect(FRAME_STOPS.map((n) => frameRadiusM(PLACE, table(rows), n))).toEqual([650, 950, 1250]);
  });
});

describe('frameStopsFrom and frameLinesOf', () => {
  it('joins the lines on the stop ids and flags a stop a tram line calls at as tram', () => {
    const rows = [at('a', 'A', 0, 0, ['109']), at('b', 'B', 300), at('c', 'C', 600, 0, ['109'])];
    const stops = frameStopsFrom(rows, isTram, [['a', 'b'], ['b']]);
    expect(stops.map((s) => s.tram)).toEqual([true, true, false]);
    expect(stops.map((s) => s.lines)).toEqual([[[0, 0]], [[0, 1], [1, 0]], undefined]);
    expect(frameStopsFrom(rows, isTram).every((s) => s.lines === undefined)).toBe(true);
  });

  it('reads the tram paths that carry a served list, as platform ids in call order', () => {
    const network = {
      routes: new Map([['6', { type: 0 }], ['109', { type: 3 }]]),
      stops: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      paths: [
        { route: '6', served: [{ stop: 2 }, { stop: 0 }] },
        { route: '109', served: [{ stop: 0 }, { stop: 1 }] },
        { route: '6' },
      ],
    };
    expect(frameLinesOf(network)).toEqual([['c', 'a']]);
    expect(frameLinesOf({ ...network, paths: undefined })).toEqual([]);
  });
});

// The artefact the app ships (feed 000395): the measure the camera, the circle and the pill read.
describe('the frame over the real network', () => {
  const rows = stopsJson as ScreenStop[];
  const net = decodeNetwork(JSON.parse(readFileSync(resolve(import.meta.dirname, '../../app/public/data/zet-network.json'), 'utf8')));
  const stops = frameStopsFrom(rows, isTramRoute, frameLinesOf(net));
  const median = (values: number[]): number => {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  };

  it('is finite, within its Kadar\u2019s caps and monotone in N at every stop of the table', () => {
    let checked = 0;
    for (const stop of rows) {
      const [r2, r4, r6] = FRAME_STOPS.map((n) => frameRadiusM(stop, stops, n));
      FRAME_STOPS.forEach((n, i) => {
        const r = [r2!, r4!, r6!][i]!;
        const [min, max] = FRAME_RADIUS_CAP_M[n];
        if (!(Number.isFinite(r) && r >= min && r <= max)) throw new Error(`${stop.id} ${stop.name}, Kadar ${n}: ${r}`);
      });
      if (!(r2! <= r4! && r4! <= r6!)) throw new Error(`${stop.id} ${stop.name}: ${r2} / ${r4} / ${r6}`);
      checked++;
    }
    expect(checked).toBe(rows.length);
    expect(checked).toBeGreaterThan(2500);
  }, 60_000);

  it('knows the order of every tram platform a line calls at', () => {
    expect(frameLinesOf(net).length).toBeGreaterThan(100);
    expect(stops.filter((s) => s.lines).length).toBeGreaterThan(250);
    expect(stops.filter((s) => s.lines).every((s) => s.tram)).toBe(true);
  });

  // The owner's ladder (irritation pass, 5 Oct 2026): Trg bana J. Jelačića at 0.7 / 1.0 / 1.3 km, Kadar 6 a touch
  // tighter than the old Kadar 4 there (1539 m over feed 000396; the old 6 and 8 read 2182 and 2768 m). Measured over
  // feed 000396 before the caps, the 25th percentile of the ways out: Trg 837 / 1459 / 1732 m, Kvaternikov trg
  // 643 / 1115 / 1515 m, Črnomerec 1077 / 1709 / 2330 m (review.local/companion/plan/WP2/frame-calibration.mjs).
  const LADDER: Readonly<Record<FrameStops, number>> = { 2: 700, 4: 1000, 6: 1300 };
  const ladderOf = (id: string): number[] => FRAME_STOPS.map((n) => frameRadiusM(rows.find((s) => s.id === id)!, stops, n));

  it('frames Trg bana J. Jelačića at the owner\u2019s 0.7 / 1.0 / 1.3 km and prints its Kadar 4 as the pill', () => {
    const [r2, r4, r6] = ladderOf('106_1');
    expect([r2, r4, r6].map(Math.round)).toEqual([700, 1000, 1300]);
    expect(r6).toBeLessThan(1539); // the old Kadar 4 at Trg
    expect(pillText(r4!)).toBe('1 km · ~8 min');
    expect(pillText(r6!)).toBe('1,3 km · ~10 min');
  });

  it('holds Kvaternikov trg and Črnomerec within 20 % of the same ladder', () => {
    expect(ladderOf('236_1').map(Math.round)).toEqual([643, 1000, 1300]);
    expect(ladderOf('98_1').map(Math.round)).toEqual([700, 1000, 1300]);
    for (const id of ['106_1', '236_1', '98_1']) {
      ladderOf(id).forEach((r, i) => {
        const n = FRAME_STOPS[i]!;
        expect(Math.abs(r - LADDER[n]) / LADDER[n], `${id} Kadar ${n}: ${Math.round(r)} m`).toBeLessThanOrEqual(0.2);
      });
    }
  });

  // The calibration (orchestrator decision 6): the constant table the first paint and the
  // fallback use stays within 20 % of the measure's median over the artefact's tram platforms.
  it('holds the fallback table within 20 % of the median over every tram platform', () => {
    const tram = rows.filter((_, i) => stops[i]!.lines);
    for (const n of FRAME_STOPS) {
      const p50 = median(tram.map((stop) => frameRadiusM(stop, stops, n)));
      expect(Math.abs(p50 - FRAME_RADIUS_M[n]) / FRAME_RADIUS_M[n], `Kadar ${n}: median ${Math.round(p50)} m`).toBeLessThanOrEqual(0.2);
    }
  });
});

describe('frameSpanM and pillText', () => {
  it('spans the whole circle', () => {
    expect(frameSpanM(2000)).toBe(4000);
    expect(frameSpanM(650)).toBe(1300);
  });

  it('prints a whole kilometre without a decimal', () => {
    expect(pillText(2000)).toBe('2 km · ~15 min');
    expect(pillText(1960)).toBe('2 km · ~15 min');
    expect(pillText(3000)).toBe('3 km · ~22 min');
  });

  it('prints one decimal with a comma and the minutes of the printed distance', () => {
    expect(pillText(2200)).toBe('2,2 km · ~16 min');
    expect(pillText(2170)).toBe('2,2 km · ~16 min');
    expect(pillText(1300)).toBe('1,3 km · ~10 min');
    expect(pillText(2700)).toBe('2,7 km · ~20 min');
    expect(pillText(500)).toBe('0,5 km · ~4 min');
    expect(pillText(680)).toBe('0,7 km · ~5 min');
  });

  it('matches the probe the wall spec reads', () => {
    for (let r = FRAME_RADIUS_CAP_M[2][0]; r <= FRAME_RADIUS_CAP_M[6][1]; r += 37) expect(`U blizini · ${pillText(r)}`).toMatch(/^U blizini · \d+(,\d)? km · ~\d+ min$/);
  });
});
