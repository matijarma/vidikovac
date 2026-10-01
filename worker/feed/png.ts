// A small PNG codec for the radar composite (docs/reveal-2026-10-plan/R3.md §0.2 (a)). DHMZ's composite is an 8-bit,
// non-interlaced RGB PNG; the Worker reads its top rows to count rain near Zagreb and serves a 120-pixel crop of it.
// No dependency: zlib through the platform's DecompressionStream / CompressionStream ('deflate' is the zlib format
// IDAT holds; the Worker and Node 22 both have them), CRC-32 by a 256-entry table. This file imports nothing, so
// scripts/radar-calibrate.mjs can load it through esbuild as well.

export interface RasterRgb { width: number; height: number; /** 3 bytes a pixel, row-major, top row first. */ data: Uint8Array }

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array, start: number, end: number): number {
  let c = 0xffffffff;
  for (let i = start; i < end; i += 1) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function u32(bytes: Uint8Array, at: number): number {
  return ((bytes[at]! << 24) | (bytes[at + 1]! << 16) | (bytes[at + 2]! << 8) | bytes[at + 3]!) >>> 0;
}

function concat(parts: readonly Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** Inflates a zlib stream, reading only until `need` bytes are out (all of it when `need` is undefined). */
async function inflate(data: Uint8Array, need?: number): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate'));
  const reader = stream.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      if (need !== undefined && total >= need) break;
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      total += value.length;
    }
  } finally {
    // Stops the inflater once the rows wanted are out; a cancel after the end is a no-op.
    await reader.cancel().catch(() => undefined);
  }
  return concat(parts, total);
}

async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** 8-bit, non-interlaced PNG of colour type 2 (RGB), 6 (RGBA, alpha dropped) or 3 (palette); rows 0..rows-1 only when `rows` is given. Throws on anything else. */
export async function decodePng(bytes: Uint8Array, options?: { rows?: number }): Promise<RasterRgb> {
  if (bytes.length < 8 || SIGNATURE.some((value, i) => bytes[i] !== value)) throw new Error('png: not a PNG');
  let at = 8;
  let width = 0;
  let height = 0;
  let colourType = -1;
  let palette: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  let idatLength = 0;
  let ended = false;
  while (!ended) {
    if (at + 12 > bytes.length) throw new Error('png: truncated');
    const length = u32(bytes, at);
    const type = String.fromCharCode(bytes[at + 4]!, bytes[at + 5]!, bytes[at + 6]!, bytes[at + 7]!);
    const start = at + 8;
    const end = start + length;
    if (end + 4 > bytes.length) throw new Error('png: truncated');
    if (crc32(bytes, at + 4, end) !== u32(bytes, end)) throw new Error(`png: bad CRC in ${type}`);
    const body = bytes.subarray(start, end);
    if (type === 'IHDR') {
      if (length !== 13) throw new Error('png: bad IHDR');
      width = u32(body, 0);
      height = u32(body, 4);
      const depth = body[8]!;
      colourType = body[9]!;
      const interlace = body[12]!;
      if (depth !== 8) throw new Error(`png: bit depth ${depth} not supported`);
      if (colourType !== 2 && colourType !== 3 && colourType !== 6) throw new Error(`png: colour type ${colourType} not supported`);
      if (body[10] !== 0 || body[11] !== 0) throw new Error('png: unknown compression or filter method');
      if (interlace !== 0) throw new Error('png: interlaced images are not supported');
      if (width === 0 || height === 0) throw new Error('png: empty image');
    } else if (type === 'PLTE') {
      palette = body;
    } else if (type === 'IDAT') {
      idat.push(body);
      idatLength += body.length;
    } else if (type === 'IEND') {
      ended = true;
    }
    at = end + 4;
  }
  if (colourType < 0) throw new Error('png: no IHDR');
  if (colourType === 3 && !palette) throw new Error('png: palette image without PLTE');
  if (idatLength === 0) throw new Error('png: no image data');
  const rows = options?.rows === undefined ? height : Math.max(0, Math.min(height, Math.floor(options.rows)));
  const channels = colourType === 2 ? 3 : colourType === 6 ? 4 : 1;
  const stride = width * channels;
  const need = rows * (stride + 1);
  const raw = await inflate(concat(idat, idatLength), rows < height ? need : undefined);
  if (raw.length < need) throw new Error('png: image data ends early');
  const data = new Uint8Array(width * rows * 3);
  let previous = new Uint8Array(stride);
  let current = new Uint8Array(stride);
  for (let y = 0; y < rows; y += 1) {
    const base = y * (stride + 1);
    const filter = raw[base]!;
    for (let x = 0; x < stride; x += 1) {
      const value = raw[base + 1 + x]!;
      const left = x >= channels ? current[x - channels]! : 0;
      const up = previous[x]!;
      const upLeft = x >= channels ? previous[x - channels]! : 0;
      let out: number;
      switch (filter) {
        case 0: out = value; break;
        case 1: out = value + left; break;
        case 2: out = value + up; break;
        case 3: out = value + ((left + up) >> 1); break;
        case 4: out = value + paeth(left, up, upLeft); break;
        default: throw new Error(`png: filter type ${filter} on row ${y}`);
      }
      current[x] = out & 0xff;
    }
    const row = y * width * 3;
    if (colourType === 2) {
      data.set(current, row);
    } else if (colourType === 6) {
      for (let x = 0; x < width; x += 1) {
        data[row + x * 3] = current[x * 4]!;
        data[row + x * 3 + 1] = current[x * 4 + 1]!;
        data[row + x * 3 + 2] = current[x * 4 + 2]!;
      }
    } else {
      for (let x = 0; x < width; x += 1) {
        const index = current[x]! * 3;
        if (index + 2 >= palette!.length) throw new Error('png: palette index out of range');
        data[row + x * 3] = palette![index]!;
        data[row + x * 3 + 1] = palette![index + 1]!;
        data[row + x * 3 + 2] = palette![index + 2]!;
      }
    }
    [previous, current] = [current, previous];
  }
  return { width, height: rows, data };
}

function chunk(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + body.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, body.length);
  for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
  out.set(body, 8);
  view.setUint32(8 + body.length, crc32(out, 4, 8 + body.length));
  return out;
}

/** An 8-bit RGB PNG, filter 0 on every row. */
export async function encodePng(raster: RasterRgb): Promise<Uint8Array> {
  const { width, height, data } = raster;
  if (data.length !== width * height * 3) throw new Error('png: raster size does not match its data');
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header[8] = 8;
  header[9] = 2;
  const stride = width * 3;
  const raw = new Uint8Array(height * (stride + 1));
  for (let y = 0; y < height; y += 1) raw.set(data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  const parts = [new Uint8Array(SIGNATURE), chunk('IHDR', header), chunk('IDAT', await deflate(raw)), chunk('IEND', new Uint8Array(0))];
  return concat(parts, parts.reduce((sum, part) => sum + part.length, 0));
}

export function cropRaster(raster: RasterRgb, rect: readonly [x0: number, y0: number, x1: number, y1: number]): RasterRgb { // inclusive
  const [x0, y0, x1, y1] = rect;
  if (x0 < 0 || y0 < 0 || x1 >= raster.width || y1 >= raster.height || x1 < x0 || y1 < y0) throw new Error('png: crop outside the image');
  const width = x1 - x0 + 1;
  const height = y1 - y0 + 1;
  const data = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    const from = ((y0 + y) * raster.width + x0) * 3;
    data.set(raster.data.subarray(from, from + width * 3), y * width * 3);
  }
  return { width, height, data };
}
