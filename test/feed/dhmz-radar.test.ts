import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FetchContext } from '../../worker/feed/schema';

// Every decode goes through a spy, so the 304 case can prove the image is not decoded twice.
vi.mock('../../worker/feed/png', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../worker/feed/png')>();
  return { ...original, decodePng: vi.fn(original.decodePng) };
});

const png = await import('../../worker/feed/png');
const { CALIBRATION, fetchDhmzRadar, isRainPixel, parseRadar, rainCells, resetRadarMemo } = await import('../../worker/feed/modules/dhmz-radar');

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'radar', 'kompozit-20261001T020410Z.png');
const LAST_MODIFIED = 'Thu, 01 Oct 2026 02:04:10 GMT';
const NOW = new Date('2026-10-01T02:10:00Z');
const bytes = () => new Uint8Array(readFileSync(FIXTURE));

/** The fixture with `count` pixels inside (or outside) the near square painted 00c6c6, a colour of DHMZ's scale. */
async function painted(count: number, where: 'inside' | 'outside' = 'inside'): Promise<Uint8Array> {
  const raster = await png.decodePng(bytes());
  const [x0, y0, x1] = CALIBRATION.near.rect;
  const width = x1 - x0 + 1;
  for (let k = 0; k < count; k += 1) {
    const x = where === 'inside' ? x0 + (k % width) : x1 + 2 + (k % 20);
    const y = where === 'inside' ? y0 + 5 + Math.floor(k / width) : y0 + Math.floor(k / 20);
    raster.data.set([0x00, 0xc6, 0xc6], (y * raster.width + x) * 3);
  }
  return png.encodePng(raster);
}

describe('dhmz-radar on the saved composite', () => {
  beforeEach(() => resetRadarMemo());

  it('gives one dry item with the id of its Last-Modified, ten minutes long, over a closed square', async () => {
    const payload = await parseRadar(bytes(), LAST_MODIFIED, NOW);
    expect(payload.sourceUpdatedAt).toBe('2026-10-01T02:04:10.000Z');
    expect(payload.items).toHaveLength(1);
    const [item] = payload.items;
    expect(item!.id).toBe(`dhmz-radar:${Date.parse('2026-10-01T02:04:10Z') / 1000}`);
    expect(item!.kind).toBe('radar');
    expect(item!.at).toBe('2026-10-01T02:04:10.000Z');
    expect(item!.until).toBe('2026-10-01T02:14:10.000Z');
    expect(item!.dateBasis).toBe('observed');
    expect(item!.data).toEqual({ rainNear: false, rainCells: 0, crop: 'zagreb', image: '/api/radar/zagreb.png' });
    expect(item!.geo?.type).toBe('Polygon');
    const ring = (item!.geo!.coordinates as number[][][])[0]!;
    expect(ring).toHaveLength(5);
    expect(ring[0]).toEqual(ring[4]);
    // West-north first, then east-north: the square around 45.81 N 15.98 E, 30 km a side.
    expect(ring[0]![0]!).toBeLessThan(15.98);
    expect(ring[0]![1]!).toBeGreaterThan(45.81);
    expect(ring[1]![0]! - ring[0]![0]!).toBeCloseTo(30 / (111.32 * Math.cos((45.81 * Math.PI) / 180)), 3);
  });

  it('says rain is near from 22 rain pixels in the square (2 percent of 1,089), never from pixels outside it', async () => {
    const rainy = await parseRadar(await painted(40), LAST_MODIFIED, NOW);
    expect(rainy.items[0]!.data).toMatchObject({ rainNear: true, rainCells: 40 });
    expect((await parseRadar(await painted(21), LAST_MODIFIED, NOW)).items[0]!.data).toMatchObject({ rainNear: false, rainCells: 21 });
    expect((await parseRadar(await painted(22), LAST_MODIFIED, NOW)).items[0]!.data).toMatchObject({ rainNear: true, rainCells: 22 });
    expect((await parseRadar(await painted(60, 'outside'), LAST_MODIFIED, NOW)).items[0]!.data).toMatchObject({ rainNear: false, rainCells: 0 });
  });

  it('counts every colour of the scale as rain and none of the map behind it', async () => {
    const rule = CALIBRATION.rain;
    for (const hex of ['d6e6b5', 'bdbdff', '808080', '000000', 'c5e6bd', 'ceefbd', 'ffffff']) {
      const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
      expect(isRainPixel(r!, g!, b!, rule), hex).toBe(false);
    }
    const raster = await png.decodePng(bytes());
    const scale = rainCells(raster, [1, 724, 675, 724], rule);
    expect(scale).toBe(675);
    // The map rows of this image hold no rain near Zagreb, nor anywhere inside the inset.
    expect(rainCells(raster, CALIBRATION.inset.rect, rule)).toBe(0);
  });

  it('refuses an old composite, another size and a truncated body', async () => {
    await expect(parseRadar(bytes(), LAST_MODIFIED, new Date('2026-10-01T02:35:11Z'))).rejects.toThrow(/30 minutes/);
    const small = await png.encodePng({ width: 700, height: 700, data: new Uint8Array(700 * 700 * 3) });
    await expect(parseRadar(small, LAST_MODIFIED, NOW)).rejects.toThrow(/700 × 700/);
    await expect(parseRadar(bytes().subarray(0, 100_000), LAST_MODIFIED, NOW)).rejects.toThrow(/png/);
  });

  it('asks with If-Modified-Since and does not decode the same composite again after a 304', async () => {
    const asked: (string | null)[] = [];
    const ctx: FetchContext = {
      now: () => NOW,
      fetch: async (_url, init) => {
        const since = new Headers(init?.headers).get('if-modified-since');
        asked.push(since);
        return since ? new Response(null, { status: 304 }) : new Response(bytes(), { headers: { 'last-modified': LAST_MODIFIED } });
      },
    };
    const decode = vi.mocked(png.decodePng);
    decode.mockClear();
    const first = await fetchDhmzRadar(ctx);
    const second = await fetchDhmzRadar(ctx);
    expect(asked).toEqual([null, LAST_MODIFIED]);
    expect(second.items).toEqual(first.items);
    expect(decode).toHaveBeenCalledTimes(1);
  });

  it('throws when the composite comes without Last-Modified', async () => {
    const ctx: FetchContext = { now: () => NOW, fetch: async () => new Response(bytes()) };
    await expect(fetchDhmzRadar(ctx)).rejects.toThrow(/Last-Modified/);
  });
});
