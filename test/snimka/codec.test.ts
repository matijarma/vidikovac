// The /snimka/ codec round-trips exactly: motion to 1 m and 1e-5 degrees over
// random vehicles with gaps and geometry changes, BAJS rows with both
// sentinels, and base64 over every byte value (shared/snimka-codec.ts).
import { describe, expect, it } from 'vitest';
import { BAJS_STEP_S, MOTION_TICKS, SNIMKA_COMPARISON, SNIMKA_WINDOW, ZAGREB_OFFSET_S, isMotionChunk } from '../../shared/snimka';
import {
  BAJS_MISSING, BAJS_NOT_RENTING, SnimkaError, chunkStart, contentPath, decodeBajs, decodeBase64, decodeMotionChunk, encodeBajs, encodeBase64,
  encodeMotionChunk, expandVehicle, samplesAt, type MotionChunkInput, type MotionSample,
} from '../../shared/snimka-codec';

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** A vehicle whose 60 ticks hold gaps, path and shape runs and free positions, all with fractional inputs. */
function randomVehicle(r: () => number, id: string): MotionChunkInput['vehicles'][number] {
  const samples: (MotionSample | null)[] = [];
  let mode: 'gap' | 'path' | 'shape' | 'free' = 'gap';
  let idx = 0;
  let s = 0;
  let lon = 15.97 + r() * 0.05;
  let lat = 45.79 + r() * 0.04;
  for (let k = 0; k < MOTION_TICKS; k++) {
    if (r() < 0.12) {
      const pick = r();
      mode = pick < 0.2 ? 'gap' : pick < 0.5 ? 'path' : pick < 0.8 ? 'shape' : 'free';
      idx = Math.floor(r() * 400);
      s = r() * 12_000;
    }
    if (mode === 'gap') { samples.push(null); continue; }
    if (mode === 'free') {
      lon += (r() - 0.5) * 0.0004;
      lat += (r() - 0.5) * 0.0003;
      samples.push({ on: 2, idx: -1, lon, lat });
      continue;
    }
    s += (r() - 0.2) * 120; // mostly forward, sometimes a step back
    samples.push({ on: mode === 'path' ? 0 : 1, idx, s: Math.max(0, s) });
  }
  const kinds = [0, 3, null] as const;
  return { id, route: r() < 0.8 ? String(1 + Math.floor(r() * 30)) : null, label: r() < 0.8 ? `L${id}` : null, kind: kinds[Math.floor(r() * 3)]!, samples };
}

describe('motion chunks', () => {
  it('round-trips random vehicles with gaps and geometry changes to 1 m and 1e-5 degrees', () => {
    const r = rng(2026_09_28);
    const vehicles = Array.from({ length: 40 }, (_, i) => randomVehicle(r, `v${i}`));
    const input: MotionChunkInput = { net: '396', t0: SNIMKA_WINDOW.fromSec + 600, vehicles };
    const chunk = encodeMotionChunk(input);
    expect(isMotionChunk(chunk)).toBe(true);
    expect(chunk).toMatchObject({ v: 1, net: '396', step: 10, n: 60, t0: input.t0 });
    const decoded = decodeMotionChunk(JSON.parse(JSON.stringify(chunk)));
    const byId = new Map(decoded.vehicles.map((v) => [v.id, v]));
    for (const v of vehicles) {
      const hadSample = v.samples.some((x) => x !== null);
      const encoded = byId.get(v.id);
      if (!hadSample) {
        expect(encoded, `${v.id} has no sample and must be dropped`).toBeUndefined();
        continue;
      }
      expect(encoded, v.id).toBeDefined();
      expect(encoded!.route).toBe(v.route);
      expect(encoded!.label).toBe(v.label);
      expect(encoded!.kind).toBe(v.kind);
      const back = expandVehicle(encoded!);
      expect(back).toHaveLength(MOTION_TICKS);
      for (let k = 0; k < MOTION_TICKS; k++) {
        const want = v.samples[k]!;
        const got = back[k]!;
        if (want === null) { expect(got, `${v.id}@${k}`).toBeNull(); continue; }
        expect(got, `${v.id}@${k}`).not.toBeNull();
        expect(got!.on).toBe(want.on);
        expect(got!.idx).toBe(want.idx);
        if (want.on === 2 && got!.on === 2) {
          expect(Math.abs(got.lon - want.lon)).toBeLessThanOrEqual(0.5e-5 + 1e-9);
          expect(Math.abs(got.lat - want.lat)).toBeLessThanOrEqual(0.5e-5 + 1e-9);
        } else if (want.on !== 2 && got!.on !== 2) {
          expect(got.s).toBe(Math.round(want.s));
          expect(Number.isInteger(got.s)).toBe(true);
        }
      }
      // A new segment at every gap and every change of geometry, never otherwise.
      let changes = 0;
      let prev: MotionSample | null = null;
      for (const x of v.samples) {
        if (x !== null && (prev === null || prev.on !== x.on || prev.idx !== x.idx)) changes += 1;
        prev = x;
      }
      expect(encoded!.segs).toHaveLength(changes);
      for (const seg of encoded!.segs) expect(seg.v.every(Number.isInteger)).toBe(true);
    }
  });

  it('samplesAt lists every vehicle present at the tick with its undelta position, and nobody in a gap', () => {
    const r = rng(7);
    const vehicles = Array.from({ length: 12 }, (_, i) => randomVehicle(r, `s${i}`));
    const chunk = encodeMotionChunk({ net: '395', t0: SNIMKA_COMPARISON.fromSec, vehicles });
    for (const tick of [0, 1, 17, 33, 58, 59]) {
      const at = samplesAt(chunk, tick);
      const expectedIds = vehicles.filter((v) => v.samples[tick] !== null).map((v) => v.id).sort();
      expect(at.map((p) => p.id).sort()).toEqual(expectedIds);
      for (const p of at) {
        const want = vehicles.find((v) => v.id === p.id)!.samples[tick]!;
        expect(p.on).toBe(want.on);
        if (want.on === 2 && p.on === 2) {
          expect(Math.abs(p.lon - want.lon)).toBeLessThanOrEqual(0.5e-5 + 1e-9);
          expect(Math.abs(p.lat - want.lat)).toBeLessThanOrEqual(0.5e-5 + 1e-9);
        } else if (want.on !== 2 && p.on !== 2) expect(p.s).toBe(Math.round(want.s));
        const expanded = expandVehicle(chunk.vehicles.find((v) => v.id === p.id)!)[tick]!;
        expect({ on: p.on, idx: p.idx, ...('s' in p ? { s: p.s } : { lon: p.lon, lat: p.lat }) }).toEqual(expanded);
      }
    }
    expect(() => samplesAt(chunk, 60)).toThrow(SnimkaError);
    expect(() => samplesAt(chunk, -1)).toThrow(SnimkaError);
  });

  it('encodes a known vehicle exactly as the contract describes the wire', () => {
    const samples: (MotionSample | null)[] = new Array<MotionSample | null>(60).fill(null);
    samples[3] = { on: 0, idx: 12, s: 100.4 };
    samples[4] = { on: 0, idx: 12, s: 110.6 };
    samples[5] = { on: 0, idx: 12, s: 108 };
    samples[6] = { on: 1, idx: 40, s: 7 };
    samples[8] = { on: 2, idx: -1, lon: 15.97718, lat: 45.81317 };
    samples[9] = { on: 2, idx: -1, lon: 15.97730, lat: 45.81310 };
    const chunk = encodeMotionChunk({ net: '396', t0: 1790574000, vehicles: [{ id: 'a', route: '6', label: '6', kind: 0, samples }] });
    expect(chunk.vehicles[0]!.segs).toEqual([
      { k: 3, on: 0, idx: 12, v: [100, 11, -3] },
      { k: 6, on: 1, idx: 40, v: [7] },
      { k: 8, on: 2, idx: -1, v: [1597718, 4581317, 12, -7] },
    ]);
    expect(chunkStart(1790574300)).toBe(1790574000);
  });

  it('refuses a malformed chunk and keeps extra fields', () => {
    const good = encodeMotionChunk({ net: '396', t0: 1790574000, vehicles: [{ id: 'a', route: null, label: null, kind: null, samples: [{ on: 0, idx: 1, s: 5 }, ...new Array<null>(59).fill(null)] }] });
    const clone = (): Record<string, unknown> => JSON.parse(JSON.stringify(good)) as Record<string, unknown>;
    const seg = (c: Record<string, unknown>): Record<string, unknown> => ((c.vehicles as Record<string, unknown>[])[0]!.segs as Record<string, unknown>[])[0]!;
    expect(decodeMotionChunk({ ...clone(), extra: 1 })).toMatchObject({ extra: 1 });
    for (const [name, mutate] of [
      ['version', (c: Record<string, unknown>): void => { c.v = 2; }],
      ['network', (c: Record<string, unknown>): void => { c.net = '397'; }],
      ['step', (c: Record<string, unknown>): void => { c.step = 20; }],
      ['n', (c: Record<string, unknown>): void => { c.n = 61; }],
      ['k below 0', (c: Record<string, unknown>): void => { seg(c).k = -1; }],
      ['k past 59', (c: Record<string, unknown>): void => { seg(c).k = 60; }],
      ['segment past the end', (c: Record<string, unknown>): void => { seg(c).k = 59; seg(c).v = [1, 2]; }],
      ['empty v', (c: Record<string, unknown>): void => { seg(c).v = []; }],
      ['fractional v', (c: Record<string, unknown>): void => { seg(c).v = [1.5]; }],
      ['free with an idx', (c: Record<string, unknown>): void => { seg(c).on = 2; seg(c).v = [1, 2]; }],
      ['odd free pairs', (c: Record<string, unknown>): void => { seg(c).on = 2; seg(c).idx = -1; seg(c).v = [1, 2, 3]; }],
      ['bad kind', (c: Record<string, unknown>): void => { (c.vehicles as Record<string, unknown>[])[0]!.kind = 1; }],
      ['overlap', (c: Record<string, unknown>): void => { const v = (c.vehicles as Record<string, unknown>[])[0]!; v.segs = [{ k: 0, on: 0, idx: 1, v: [5, 1] }, { k: 1, on: 0, idx: 2, v: [9] }]; }],
    ] as const) {
      const c = clone();
      mutate(c);
      expect(() => decodeMotionChunk(c), name).toThrow(SnimkaError);
    }
    expect(() => encodeMotionChunk({ net: '396', t0: 1, vehicles: [{ id: 'x', route: null, label: null, kind: null, samples: [] }] })).toThrow(SnimkaError);
    expect(() => encodeMotionChunk({ net: '396', t0: 1, vehicles: [{ id: 'x', route: null, label: null, kind: null, samples: [{ on: 0, idx: 1, s: Number.NaN }, ...new Array<null>(59).fill(null)] }] })).toThrow(SnimkaError);
  });
});

describe('BAJS rows', () => {
  it('round-trips a station matrix with both sentinels', () => {
    const r = rng(11);
    const n = 288;
    const stations = Array.from({ length: 23 }, (_, i) => `st-${i}`);
    const matrix = stations.map(() => {
      const row = new Uint8Array(n);
      for (let j = 0; j < n; j++) {
        const pick = r();
        row[j] = pick < 0.05 ? BAJS_MISSING : pick < 0.1 ? BAJS_NOT_RENTING : Math.floor(r() * 251);
      }
      return row;
    });
    matrix[0]![0] = 0;
    matrix[0]![1] = 250;
    matrix[0]![2] = BAJS_NOT_RENTING;
    matrix[0]![3] = BAJS_MISSING;
    const file = encodeBajs(SNIMKA_WINDOW.fromSec, BAJS_STEP_S, stations, matrix);
    expect(file).toMatchObject({ v: 1, step: 300, n, t0: SNIMKA_WINDOW.fromSec });
    expect(file.stations).toEqual(stations);
    const back = decodeBajs(JSON.parse(JSON.stringify(file)) as typeof file);
    expect(back).toHaveLength(stations.length);
    back.forEach((row, i) => expect(Array.from(row)).toEqual(Array.from(matrix[i]!)));
    expect(BAJS_NOT_RENTING).toBe(254);
    expect(BAJS_MISSING).toBe(255);
  });

  it('refuses a byte between 251 and 253, a ragged matrix and a row of the wrong length', () => {
    expect(() => encodeBajs(0, 300, ['a'], [Uint8Array.of(252)])).toThrow(SnimkaError);
    expect(() => encodeBajs(0, 300, ['a', 'b'], [Uint8Array.of(1, 2), Uint8Array.of(1)])).toThrow(SnimkaError);
    expect(() => encodeBajs(0, 300, ['a'], [])).toThrow(SnimkaError);
    const file = encodeBajs(0, 300, ['a'], [Uint8Array.of(1, 2, 3)]);
    expect(() => decodeBajs({ ...file, n: 4 })).toThrow(SnimkaError);
    expect(() => decodeBajs({ ...file, bikes: ['AQID', 'AQID'] })).toThrow(SnimkaError);
    expect(() => decodeBajs({ ...file, bikes: ['/P8='] })).toThrow(SnimkaError); // 252, 255
  });
});

describe('base64', () => {
  it('encodes and decodes every byte value at every tail length', () => {
    for (let tail = 0; tail < 4; tail++) {
      const bytes = new Uint8Array(256 + tail);
      for (let i = 0; i < bytes.length; i++) bytes[i] = i & 255;
      const text = encodeBase64(bytes);
      expect(text).toMatch(/^[A-Za-z0-9+/]*={0,2}$/);
      expect(text.length % 4).toBe(0);
      expect(Array.from(decodeBase64(text))).toEqual(Array.from(bytes));
      // The same text Node would produce, so the pipeline's files and the page agree.
      expect(text).toBe(Buffer.from(bytes).toString('base64'));
    }
    expect(encodeBase64(new Uint8Array(0))).toBe('');
    expect(Array.from(decodeBase64(''))).toEqual([]);
  });
  it('refuses a bad length and a bad character', () => {
    expect(() => decodeBase64('abc')).toThrow(SnimkaError);
    expect(() => decodeBase64('ab$=')).toThrow(SnimkaError);
    expect(() => decodeBase64('čččč')).toThrow(SnimkaError);
  });
});

describe('content names and constants', () => {
  it('names an object by the first 16 hex of its hash', () => {
    const sha = 'a'.repeat(32) + 'b'.repeat(32);
    expect(contentPath('series', sha, 'json')).toBe(`series.${'a'.repeat(16)}.json`);
    expect(contentPath('motion/396/20260928-0740', sha, 'json')).toBe(`motion/396/20260928-0740.${'a'.repeat(16)}.json`);
    expect(contentPath('captures/mon-0745-kiosk', sha, 'webp')).toBe(`captures/mon-0745-kiosk.${'a'.repeat(16)}.webp`);
    expect(() => contentPath('series', 'abc', 'json')).toThrow(SnimkaError);
    expect(() => contentPath('/series', sha, 'json')).toThrow(SnimkaError);
    expect(() => contentPath('../series', sha, 'json')).toThrow(SnimkaError);
  });
  it('the window is Sun 27 Sep 20:00 to Thu 1 Oct 08:00 Zagreb, 5040 minutes; the comparison day is Thu 24 Sep', () => {
    expect(SNIMKA_WINDOW.toSec - SNIMKA_WINDOW.fromSec).toBe(SNIMKA_WINDOW.minutes * 60);
    expect(SNIMKA_WINDOW.minutes).toBe(5040);
    expect(SNIMKA_COMPARISON.minutes).toBe(1440);
    const zagreb = (sec: number): string => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Zagreb', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(sec * 1000));
    expect(zagreb(SNIMKA_WINDOW.fromSec)).toBe('Sun 27 Sept, 20:00');
    expect(zagreb(SNIMKA_WINDOW.toSec)).toBe('Thu 1 Oct, 08:00');
    expect(zagreb(SNIMKA_COMPARISON.fromSec)).toBe('Thu 24 Sept, 00:00');
    // Fixed UTC+2 arithmetic holds across the window and the comparison day.
    for (const sec of [SNIMKA_WINDOW.fromSec, SNIMKA_WINDOW.toSec, SNIMKA_COMPARISON.fromSec, SNIMKA_COMPARISON.fromSec + 86_399]) {
      const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Zagreb', timeZoneName: 'longOffset' }).formatToParts(new Date(sec * 1000));
      expect(parts.find((p) => p.type === 'timeZoneName')?.value).toBe('GMT+02:00');
    }
    expect(ZAGREB_OFFSET_S).toBe(7200);
  });
});
