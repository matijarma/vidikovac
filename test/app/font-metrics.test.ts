// The 3-metre floors of e2e/legibility.ts are x-heights in millimetres turned
// into font sizes through Manrope's own x-height ratio. This file reads that
// ratio out of the shipped fonts (app/public/fonts/manrope/*.woff2: the WOFF2
// header, its table directory with base-128 lengths, the Brotli stream, then
// head.unitsPerEm and OS/2 sxHeight / sCapHeight), so a font swap or a new cut
// cannot move the floors silently.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { brotliDecompressSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { MANROPE_CAP_HEIGHT_RATIO, MANROPE_X_HEIGHT_RATIO } from '../../e2e/legibility';

const FONTS = join(import.meta.dirname, '..', '..', 'app', 'public', 'fonts', 'manrope');
const WOFF2_SIGNATURE = 0x774f4632; // 'wOF2'
const HEADER_BYTES = 48;
/** WOFF2 §5.1: the known-table index a flags byte names in its low six bits (63 = an explicit tag follows). */
const KNOWN_TAGS = [
  'cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep', 'CFF ', 'VORG', 'EBDT',
  'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB', 'EBSC', 'JSTF', 'MATH',
  'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar', 'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar',
  'gvar', 'hsty', 'just', 'lcar', 'mort', 'morx', 'opbd', 'prop', 'trak', 'Zapf', 'Silf', 'Glat', 'Gloc', 'Feat', 'Sill',
];

interface FontMetrics { unitsPerEm: number; sxHeight: number; sCapHeight: number; os2Version: number }

/** head and OS/2 out of a WOFF2 file (single font, not a collection). */
function woff2Metrics(bytes: Buffer): FontMetrics {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0) !== WOFF2_SIGNATURE) throw new Error('not a WOFF2 file');
  if (view.getUint32(4) === 0x74746366) throw new Error('font collections are not read here');
  const numTables = view.getUint16(12);
  const totalCompressedSize = view.getUint32(20);
  let offset = HEADER_BYTES;
  const base128 = (): number => {
    let value = 0;
    for (let i = 0; i < 5; i++) {
      const byte = view.getUint8(offset++);
      if (i === 0 && byte === 0x80) throw new Error('UIntBase128 with a leading zero');
      value = value * 128 + (byte & 0x7f);
      if (!(byte & 0x80)) return value;
    }
    throw new Error('UIntBase128 longer than five bytes');
  };
  const tables: { tag: string; length: number }[] = [];
  for (let t = 0; t < numTables; t++) {
    const flags = view.getUint8(offset++);
    let tag = KNOWN_TAGS[flags & 0x3f];
    if ((flags & 0x3f) === 63) {
      tag = String.fromCharCode(view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3));
      offset += 4;
    }
    const version = flags >> 6;
    const origLength = base128();
    // glyf and loca are transformed at version 0 (3 is the null transform); every other table is transformed at a non-zero version.
    const transformed = tag === 'glyf' || tag === 'loca' ? version !== 3 : version !== 0;
    const length = transformed ? base128() : origLength;
    tables.push({ tag, length });
  }
  const stream = brotliDecompressSync(bytes.subarray(offset, offset + totalCompressedSize));
  // The decompressed stream is every table in directory order, unpadded.
  const at: Record<string, number> = {};
  let cursor = 0;
  for (const table of tables) {
    at[table.tag] = cursor;
    cursor += table.length;
  }
  if (cursor !== stream.length) throw new Error(`table lengths ${cursor} do not add up to the stream ${stream.length}`);
  if (at.head === undefined || at['OS/2'] === undefined) throw new Error('head or OS/2 missing');
  const data = new DataView(stream.buffer, stream.byteOffset, stream.byteLength);
  return {
    unitsPerEm: data.getUint16(at.head + 18),
    os2Version: data.getUint16(at['OS/2']),
    sxHeight: data.getInt16(at['OS/2'] + 86),
    sCapHeight: data.getInt16(at['OS/2'] + 88),
  };
}

const files = readdirSync(FONTS).filter((f) => f.endsWith('.woff2')).sort();

describe('Manrope as shipped', () => {
  it('ships the weight the wall rows use (500, latin)', () => {
    expect(files).toContain('manrope-500-normal-latin.woff2');
  });

  it('manrope-500-normal-latin.woff2: unitsPerEm 2000, sxHeight 1080, sCapHeight 1440', () => {
    const m = woff2Metrics(readFileSync(join(FONTS, 'manrope-500-normal-latin.woff2')));
    expect(m.os2Version).toBeGreaterThanOrEqual(2); // sxHeight and sCapHeight exist from OS/2 version 2
    expect(m).toMatchObject({ unitsPerEm: 2000, sxHeight: 1080, sCapHeight: 1440 });
  });

  it.each(files)('%s carries the ratios e2e/legibility.ts converts with (x-height 0.54, cap height 0.72)', (file) => {
    const m = woff2Metrics(readFileSync(join(FONTS, file)));
    expect(m.sxHeight / m.unitsPerEm).toBe(MANROPE_X_HEIGHT_RATIO);
    expect(m.sCapHeight / m.unitsPerEm).toBe(MANROPE_CAP_HEIGHT_RATIO);
  });
});
