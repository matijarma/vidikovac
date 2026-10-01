import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { cropRaster, decodePng, encodePng, PNG_MAX_PIXELS, type RasterRgb } from '../../worker/feed/png';

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'radar', 'kompozit-20261001T020410Z.png');

/** A PNG built by hand: IHDR with the given fields, one IDAT of the given filtered rows, IEND. */
function chunk(type: string, body: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])) >>> 0, 0);
  return Buffer.concat([head, body, crc]);
}
function png(fields: { width: number; height: number; depth?: number; colourType: number; interlace?: number }, raw: Uint8Array, extra: Buffer[] = []): Uint8Array {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(fields.width, 0);
  ihdr.writeUInt32BE(fields.height, 4);
  ihdr[8] = fields.depth ?? 8;
  ihdr[9] = fields.colourType;
  ihdr[12] = fields.interlace ?? 0;
  return new Uint8Array(Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    ...extra.map((body) => chunk('PLTE', body)),
    chunk('IDAT', deflateSync(Buffer.from(raw))),
    chunk('IEND', Buffer.alloc(0)),
  ]));
}

const SMALL: RasterRgb = { width: 3, height: 2, data: new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 10, 20, 30, 40, 50, 60, 70, 80, 90]) };

describe('R3 review: bounded PNG validation', () => {
  it('rejects huge dimensions before inflation and excess full-image scanlines', async () => {
    await expect(decodePng(png({ width: PNG_MAX_PIXELS + 1, height: 1, colourType: 2 }, new Uint8Array()))).rejects.toThrow(/dimensions/);
    await expect(decodePng(png({ width: 4097, height: 1, colourType: 2 }, new Uint8Array()))).rejects.toThrow(/dimensions/);
    await expect(decodePng(png({ width: 1, height: 1, colourType: 2 }, new Uint8Array(100_000)))).rejects.toThrow(/exceeds/);
    await expect(decodePng(png({ width: 1, height: 2, colourType: 2 }, new Uint8Array([0, 1, 2, 3])))).rejects.toThrow(/early/);
  });

  it.each([NaN, Infinity, -1, 0.5])('rejects invalid partial row count %s', async (rows) => {
    await expect(decodePng(await encodePng(SMALL), { rows })).rejects.toThrow(/row count/);
  });

  it('rejects duplicate or misplaced headers, trailing data and malformed palettes', async () => {
    const good = await encodePng(SMALL);
    const doubled = new Uint8Array([...good.subarray(0, 33), ...good.subarray(8)]);
    await expect(decodePng(doubled)).rejects.toThrow(/duplicate IHDR/);
    await expect(decodePng(new Uint8Array([...good.subarray(0, 8), ...good.subarray(33)]))).rejects.toThrow(/IHDR must be first/);
    await expect(decodePng(new Uint8Array([...good, 0]))).rejects.toThrow(/trailing/);
    for (const palette of [Buffer.alloc(0), Buffer.alloc(4), Buffer.alloc(771)]) {
      await expect(decodePng(png({ width: 1, height: 1, colourType: 3 }, new Uint8Array([0, 0]), [palette]))).rejects.toThrow(/PLTE/);
    }
  });

  it('checks every chunk CRC even for a partial decode, and rejects invalid filters', async () => {
    const good = await encodePng(SMALL);
    good[good.length - 1] ^= 1;
    await expect(decodePng(good, { rows: 1 })).rejects.toThrow(/CRC/);
    await expect(decodePng(png({ width: 1, height: 1, colourType: 2 }, new Uint8Array([5, 1, 2, 3])))).rejects.toThrow(/filter type 5/);
    const one = await decodePng(await encodePng(SMALL), { rows: 1 });
    expect([...one.data]).toEqual([...SMALL.data.subarray(0, 9)]);
  });

  it('rejects unknown critical chunks, nonconsecutive IDATs, late palettes and a nonempty IEND', async () => {
    const good = Buffer.from(await encodePng(SMALL));
    const beforeEnd = good.subarray(0, -12);
    const end = good.subarray(-12);
    await expect(decodePng(Buffer.concat([beforeEnd, chunk('ABCD', Buffer.alloc(0)), end]))).rejects.toThrow(/critical/);
    await expect(decodePng(Buffer.concat([beforeEnd, chunk('tEXt', Buffer.from('note')), chunk('IDAT', Buffer.alloc(0)), end]))).rejects.toThrow(/IDAT order/);
    await expect(decodePng(Buffer.concat([beforeEnd, chunk('PLTE', Buffer.alloc(3)), end]))).rejects.toThrow(/PLTE/);
    await expect(decodePng(Buffer.concat([beforeEnd, chunk('IEND', Buffer.from([0]))]))).rejects.toThrow(/IEND/);
  });

  it('rejects non-integer raster and crop dimensions or incomplete raster data', async () => {
    await expect(encodePng({ width: 0.5, height: 2, data: new Uint8Array(3) })).rejects.toThrow(/dimensions/);
    await expect(encodePng({ width: 0, height: 0, data: new Uint8Array() })).rejects.toThrow(/dimensions/);
    expect(() => cropRaster(SMALL, [0.5, 0, 1, 1])).toThrow(/outside/);
    expect(() => cropRaster(SMALL, [0, 0, 1] as unknown as [number, number, number, number])).toThrow(/outside/);
    expect(() => cropRaster({ ...SMALL, data: new Uint8Array(3) }, [0, 0, 0, 0])).toThrow(/size/);
  });
});

describe('the PNG codec', () => {
  it('round-trips a 3 x 2 RGB image byte for byte', async () => {
    const decoded = await decodePng(await encodePng(SMALL));
    expect(decoded.width).toBe(3);
    expect(decoded.height).toBe(2);
    expect([...decoded.data]).toEqual([...SMALL.data]);
  });

  it('decodes a palette image and an RGBA image to RGB', async () => {
    const palette = Buffer.from([0, 0, 0, 200, 100, 50, 1, 2, 3]);
    const indexed = png({ width: 2, height: 2, colourType: 3 }, new Uint8Array([0, 1, 2, 0, 2, 0]), [palette]);
    expect([...(await decodePng(indexed)).data]).toEqual([200, 100, 50, 1, 2, 3, 1, 2, 3, 0, 0, 0]);
    // RGBA, row 0 filter 0, row 1 filter 2 (up): the second row adds 1 to every byte of the first.
    const rgba = png({ width: 2, height: 2, colourType: 6 }, new Uint8Array([0, 10, 20, 30, 255, 40, 50, 60, 128, 2, 1, 1, 1, 0, 1, 1, 1, 0]));
    expect([...(await decodePng(rgba)).data]).toEqual([10, 20, 30, 40, 50, 60, 11, 21, 31, 41, 51, 61]);
  });

  it('unfilters sub, average and Paeth rows', async () => {
    const raw = new Uint8Array([
      1, 10, 10, 10, 5, 5, 5, // sub: 10 10 10, 15 15 15
      3, 2, 2, 2, 4, 4, 4, // average: (0 + 10) >> 1 = 5, + 2 = 7; (7 + 15) >> 1 = 11, + 4 = 15
      4, 1, 1, 1, 1, 1, 1, // Paeth: a 0 b 7 c 0 -> b, 7 + 1 = 8; a 8 b 15 c 7 -> p 16, b is nearest, 15 + 1 = 16
    ]);
    const decoded = await decodePng(png({ width: 2, height: 3, colourType: 2 }, raw));
    expect([...decoded.data]).toEqual([10, 10, 10, 15, 15, 15, 7, 7, 7, 15, 15, 15, 8, 8, 8, 16, 16, 16]);
  });

  it('refuses an interlaced, a 16-bit and a corrupt image', async () => {
    const raw = new Uint8Array([0, 1, 2, 3]);
    await expect(decodePng(png({ width: 1, height: 1, colourType: 2, interlace: 1 }, raw))).rejects.toThrow(/interlaced/);
    await expect(decodePng(png({ width: 1, height: 1, colourType: 2, depth: 16 }, raw))).rejects.toThrow(/bit depth 16/);
    const broken = await encodePng(SMALL);
    broken[20] ^= 0xff; // inside IHDR, so its CRC no longer agrees
    await expect(decodePng(broken)).rejects.toThrow(/CRC/);
    const whole = await encodePng(SMALL);
    await expect(decodePng(whole.subarray(0, whole.length - 20))).rejects.toThrow(/truncated/);
  });

  it('returns only the rows asked for', async () => {
    const one = await decodePng(await encodePng(SMALL), { rows: 1 });
    expect(one.height).toBe(1);
    expect([...one.data]).toEqual([...SMALL.data.subarray(0, 9)]);
  });

  it('crops an inclusive rectangle', () => {
    const crop = cropRaster(SMALL, [1, 0, 2, 1]);
    expect(crop.width).toBe(2);
    expect(crop.height).toBe(2);
    expect([...crop.data]).toEqual([0, 255, 0, 0, 0, 255, 40, 50, 60, 70, 80, 90]);
    expect(() => cropRaster(SMALL, [0, 0, 3, 1])).toThrow(/outside/);
  });

  it('decodes the saved composite, with the ZG diamond where the calibration expects it', async () => {
    const started = performance.now();
    const raster = await decodePng(new Uint8Array(readFileSync(FIXTURE)));
    const fullMs = performance.now() - started;
    expect(raster.width).toBe(720);
    expect(raster.height).toBe(751);
    const sum = (x: number, y: number) => {
      const i = (y * raster.width + x) * 3;
      return raster.data[i]! + raster.data[i + 1]! + raster.data[i + 2]!;
    };
    for (const [x, y] of [[339, 227], [347, 227], [343, 223], [343, 231]] as const) expect(sum(x, y), `tip ${x},${y}`).toBeLessThan(120);
    const partStarted = performance.now();
    const top = await decodePng(new Uint8Array(readFileSync(FIXTURE)), { rows: 244 });
    const partMs = performance.now() - partStarted;
    expect(top.height).toBe(244);
    expect([...top.data.subarray(0, 720 * 244 * 3)]).toEqual([...raster.data.subarray(0, 720 * 244 * 3)]);
    // The decode cost the Worker pays (R3 Risks): recorded, not asserted, since a shared host's timing is noisy.
    console.info(`decode: whole image ${fullMs.toFixed(1)} ms, rows 0..243 ${partMs.toFixed(1)} ms`);
  });
});
