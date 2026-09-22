// Seam S2: shared/city/frame.ts. The measured radius (N stops down the tram
// lines that serve the place, orchestrator decision 6; bus stops by air as the
// fallback, clamped 0.5–3 km), the camera span and the "U blizini" pill.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import stopsJson from '../../app/public/data/stops.json';
import {
  DEFAULT_FRAME_STOPS,
  FRAME_RADIUS_M,
  FRAME_RADIUS_MAX_M,
  FRAME_RADIUS_MIN_M,
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
  it('offers Kadar 4, 6 and 8, six by default', () => {
    expect(FRAME_STOPS).toEqual([4, 6, 8]);
    expect(DEFAULT_FRAME_STOPS).toBe(6);
    expect([4, 6, 8].every(isFrameStops)).toBe(true);
    expect([5, '6', null, undefined, 6.5].some(isFrameStops)).toBe(false);
  });

  it('keeps the fallback table and the bounds', () => {
    expect(FRAME_RADIUS_M).toEqual({ 4: 1300, 6: 2000, 8: 2700 });
    expect(Object.isFrozen(FRAME_RADIUS_M)).toBe(true);
    expect([FRAME_RADIUS_MIN_M, FRAME_RADIUS_MAX_M, FRAME_TRAM_REACH_M, WALK_MIN_PER_KM, FRAME_SAME_STOP_M]).toEqual([500, 3000, 3000, 7.5, 300]);
  });
});

describe('frameRadiusM', () => {
  it('walks N stops down the line that serves the place', () => {
    const { rows, line } = northLine(300, 10);
    const stops = table(rows, [line]);
    expect(frameRadiusM(PLACE, stops, 4)).toBeCloseTo(1200, 3);
    expect(frameRadiusM(PLACE, stops, 6)).toBeCloseTo(1800, 3);
    expect(frameRadiusM(PLACE, stops, 8)).toBeCloseTo(2400, 3);
  });

  it('counts the stops down the place\u2019s own lines, not the nearest stops of other lines by air', () => {
    // The place's line runs north every 500 m; another line crosses 100–400 m to the east and never calls at P.
    const own = northLine(500, 10);
    const cross = [at('x1', 'X1', 100, 150), at('x2', 'X2', 0, 250), at('x3', 'X3', -100, 350), at('x4', 'X4', -200, 400), at('x5', 'X5', -300, 450)];
    const stops = table([...own.rows, ...cross], [own.line, cross.map((r) => r.id)]);
    expect(frameRadiusM(PLACE, stops, 4)).toBeCloseTo(2000, 3);
    // By air the fourth-nearest stop name would be a crossing stop, under half a kilometre out.
    expect(frameRadiusM(PLACE, stops, 4)).toBeGreaterThan(FRAME_RADIUS_MIN_M * 3);
  });

  it('walks both directions from the stop\u2019s platforms and counts each way out once, however many lines run it', () => {
    // North every 300 m on three lines that share every stop; south every 500 m from the opposite platform 20 m away.
    const up = northLine(300, 8);
    const down = [at('p2', 'P', -20), ...Array.from({ length: 8 }, (_, i) => at(`s${i + 1}`, `South ${i + 1}`, -500 * (i + 1)))];
    const stops = table([...up.rows, ...down], [up.line, up.line, up.line, down.map((r) => r.id)]);
    // The median of the two ways out, 1200 m north and 2000 m south: the three lines north are one of them.
    expect(frameRadiusM(PLACE, stops, 4)).toBeCloseTo(1600, 3);
  });

  it('counts platforms that share a name once, never the place\u2019s own name, and keeps a stop\u2019s far-off namesake out of its platforms', () => {
    const rows = [at('p', 'P', 0), at('p-b', 'P', 40), at('a', 'A', 300), at('a-b', 'A', 330), at('b', 'B', 600), at('c', 'C', 900), at('d', 'D', 1200), at('e', 'E', 1500)];
    // A stop also named P five kilometres south, on a line of its own: it is not the place's platform.
    const far = [at('pz', 'P', -5000), at('z1', 'Z1', -5100), at('z2', 'Z2', -5200), at('z3', 'Z3', -5300), at('z4', 'Z4', -5400)];
    const stops = table([...rows, ...far], [rows.map((r) => r.id), far.map((r) => r.id)]);
    expect(frameRadiusM({ ...PLACE, name: 'P', kind: 'tram' }, stops, 4)).toBeCloseTo(1200, 3);
  });

  it('measures an address from the address, down the lines of the nearest tram stop', () => {
    const { rows, line } = northLine(400, 8);
    const stops = table(rows, [line]);
    const address = { lon: PLACE.lon - 300 / M_PER_DEG_LON, lat: PLACE.lat, name: 'Ilica 1', kind: 'address' };
    // The fourth stop is 1600 m north of P, the address 300 m west of P.
    expect(frameRadiusM(address, stops, 4)).toBeCloseTo(Math.hypot(1600, 300), -1);
  });

  it('reaches the end of a line that ends before N stops', () => {
    const { rows, line } = northLine(400, 3);
    expect(frameRadiusM(PLACE, table(rows, [line]), 6)).toBeCloseTo(1200, 3);
  });

  it('grows with N', () => {
    for (const step of [250, 420]) {
      const { rows, line } = northLine(step, 12);
      const stops = table(rows, [line]);
      const [r4, r6, r8] = FRAME_STOPS.map((n: FrameStops) => frameRadiusM(PLACE, stops, n));
      expect(r4).toBeLessThan(r6!);
      expect(r6).toBeLessThan(r8!);
    }
  });

  it('never frames less for a wider Kadar: a line that curves back, and lines of different lengths', () => {
    // North 400 m a stop to the sixth, then back south-east: the eighth stop lies nearer by air than the sixth.
    const curve = [at('c0', 'P', 0), ...[400, 800, 1200, 1600, 2000, 2400].map((d, i) => at(`c${i + 1}`, `C${i + 1}`, d)), at('c7', 'C7', 1900, 500), at('c8', 'C8', 1400, 800), at('c9', 'C9', 900, 1000)];
    const curved = table(curve, [curve.map((r) => r.id)]);
    const [c4, c6, c8] = FRAME_STOPS.map((n) => frameRadiusM(PLACE, curved, n));
    expect(Math.hypot(1400, 800)).toBeLessThan(2400); // the bare eighth stop
    expect(c6).toBeCloseTo(2400, 3);
    expect(c8).toBe(c6);
    expect(c4).toBeLessThan(c6!);
    // A long line north every 300 m and a short one south every 700 m that ends after five stops: at Kadar 6 only
    // the long line reaches its sixth stop (1800 m), while Kadar 4's median of 1200 and 2800 m is 2000 m.
    const long = northLine(300, 10);
    const short = [at('q0', 'P', -20), ...Array.from({ length: 5 }, (_, i) => at(`q${i + 1}`, `Q${i + 1}`, -700 * (i + 1)))];
    const mixed = table([...long.rows, ...short], [long.line, short.map((r) => r.id)]);
    const [m4, m6, m8] = FRAME_STOPS.map((n) => frameRadiusM(PLACE, mixed, n));
    expect(m4).toBeCloseTo(2000, -1);
    expect(m6).toBe(m4);
    expect(m8).toBeGreaterThanOrEqual(m6!);
  });

  it('starts from the nearest tram platform, in a stable order, and falls back when that stop has no line order', () => {
    // The place's own tram platform has no line order; a line runs two kilometres away: the frame does not borrow it.
    const far = [at('f0', 'Far', 2000), ...Array.from({ length: 8 }, (_, i) => at(`f${i + 1}`, `F${i + 1}`, 2000 + 300 * (i + 1)))];
    const lonely = table([at('p', 'P', 0), ...far], [far.map((r) => r.id)]);
    expect(FRAME_STOPS.map((n) => frameRadiusM(PLACE, lonely, n))).toEqual([1300, 2000, 2700]);
    // Two tram stops of different names, each 100 m from the place, each on its own line: the platform with the
    // smaller id wins whatever the table's order.
    const west = [at('a', 'West', 0, -100), ...Array.from({ length: 6 }, (_, i) => at(`w${i + 1}`, `W${i + 1}`, 300 * (i + 1), -100))];
    const east = [at('b', 'East', 0, 100), ...Array.from({ length: 6 }, (_, i) => at(`e${i + 1}`, `E${i + 1}`, 500 * (i + 1), 100))];
    const lines = [west.map((r) => r.id), east.map((r) => r.id)];
    const one = frameRadiusM(PLACE, table([...west, ...east], lines), 4);
    const other = frameRadiusM(PLACE, table([...east, ...west], lines), 4);
    expect(one).toBe(other);
    expect(one).toBeCloseTo(Math.hypot(1200, 100), 0);
  });

  it('is always a finite number of metres: rows with a broken position are never counted, a place without one takes the table', () => {
    const buses = Array.from({ length: 10 }, (_, i) => north(`B${i + 1}`, 400 * (i + 1), false));
    const broken: FrameStop[] = [
      { name: 'X1', lon: Number.NaN, lat: 45.8, tram: false },
      { name: 'X2', lon: 16, lat: Number.POSITIVE_INFINITY, tram: false },
      { name: 'X3', lon: null as unknown as number, lat: undefined as unknown as number, tram: false },
      { name: 'X4', lon: Number.NaN, lat: Number.NaN, tram: true },
    ];
    for (const n of FRAME_STOPS) {
      const r = frameRadiusM(PLACE, [...broken, ...buses], n);
      expect(Number.isFinite(r)).toBe(true);
      expect(r).toBeCloseTo(Math.min(FRAME_RADIUS_MAX_M, 400 * n), 3);
    }
    expect(frameRadiusM(PLACE, broken, 6)).toBe(FRAME_RADIUS_MAX_M);
    const { rows, line } = northLine(300, 10);
    expect(frameRadiusM(PLACE, [...broken, ...table(rows, [line])], 4)).toBeCloseTo(1200, 3);
    expect(FRAME_STOPS.map((n) => frameRadiusM({ lon: Number.NaN, lat: 45.8 }, table(rows, [line]), n))).toEqual([1300, 2000, 2700]);
  });

  it('counts bus stops by air only when no tram stop lies within 3 km, the place\u2019s own stop included', () => {
    const buses = Array.from({ length: 10 }, (_, i) => north(`B${i + 1}`, 400 * (i + 1), false));
    expect(frameRadiusM(PLACE, [...buses, north('Far tram', 3200)], 4)).toBeCloseTo(1600, 3);
    // A bus-stop place does not count its own name.
    expect(frameRadiusM({ ...PLACE, name: 'B1', kind: 'bus' }, [...buses, north('Far tram', 3200)], 4)).toBeCloseTo(2000, 3);
    // The place is a tram stop whose next stops lie beyond 3 km, with buses all around it: its own
    // stop is a tram within reach, so the frame walks the tram line (clamped) and ignores the buses.
    const rows = [at('t0', 'Tram P', 0), at('t1', 'T1', 3200), at('t2', 'T2', 3400), at('t3', 'T3', 3600), at('t4', 'T4', 3800)];
    const lonely = [...table(rows, [rows.map((r) => r.id)]), ...buses];
    expect(frameRadiusM({ ...PLACE, name: 'Tram P', kind: 'tram' }, lonely, 4)).toBe(FRAME_RADIUS_MAX_M);
  });

  it('clamps to half a kilometre and three', () => {
    const close = northLine(50, 10);
    expect(frameRadiusM(PLACE, table(close.rows, [close.line]), 4)).toBe(FRAME_RADIUS_MIN_M);
    const wide = northLine(1000, 10);
    expect(frameRadiusM(PLACE, table(wide.rows, [wide.line]), 8)).toBe(FRAME_RADIUS_MAX_M);
    // Fewer than N bus stops in the whole table reads as the maximum.
    expect(frameRadiusM(PLACE, [north('B1', 300, false), north('B2', 600, false)], 6)).toBe(FRAME_RADIUS_MAX_M);
  });

  it('falls back to the table when no stops are loaded, or no tram line order is known', () => {
    expect(FRAME_STOPS.map((n) => frameRadiusM(PLACE, [], n))).toEqual([1300, 2000, 2700]);
    const { rows } = northLine(300, 10);
    expect(FRAME_STOPS.map((n) => frameRadiusM(PLACE, table(rows), n))).toEqual([1300, 2000, 2700]);
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

  it('is finite, within the bounds and monotone in N at every stop of the table', () => {
    let checked = 0;
    for (const stop of rows) {
      const [r4, r6, r8] = FRAME_STOPS.map((n) => frameRadiusM(stop, stops, n));
      for (const r of [r4!, r6!, r8!]) {
        if (!(Number.isFinite(r) && r >= FRAME_RADIUS_MIN_M && r <= FRAME_RADIUS_MAX_M)) throw new Error(`${stop.id} ${stop.name}: ${r}`);
      }
      if (!(r4! <= r6! && r6! <= r8!)) throw new Error(`${stop.id} ${stop.name}: ${r4} / ${r6} / ${r8}`);
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

  it('frames Trg bana J. Jelačića about 1.5 / 2.2 / 2.8 km, monotone, and prints its Kadar 6 as the owner\u2019s pill', () => {
    const trg = rows.find((s) => s.id === '106_1')!;
    const [r4, r6, r8] = FRAME_STOPS.map((n) => frameRadiusM(trg, stops, n));
    expect(r4).toBeLessThan(r6!);
    expect(r6).toBeLessThan(r8!);
    expect(r4! / 1500).toBeGreaterThan(0.9);
    expect(r4! / 1500).toBeLessThan(1.1);
    expect(r8! / 2800).toBeGreaterThan(0.9);
    expect(r8! / 2800).toBeLessThan(1.1);
    expect(pillText(r6!)).toBe('2,2 km · ~16 min');
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
    for (let r = FRAME_RADIUS_MIN_M; r <= FRAME_RADIUS_MAX_M; r += 37) expect(`U blizini · ${pillText(r)}`).toMatch(/^U blizini · \d+(,\d)? km · ~\d+ min$/);
  });
});
