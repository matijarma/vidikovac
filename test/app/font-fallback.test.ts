// Manrope arrives after the first paint (every entry imports fonts.css dynamically, and never on the lightweight
// path), so the text is first laid out in the fallback and then again in Manrope. With the plain system stack that
// second layout moved the landing's actions 59 px at 1440 px (Lighthouse CLS 0.113, lane/v-lh P6). tokens.css
// therefore puts a metric-matched face first behind Manrope: the system's Arial (or a metric twin of it), sized to
// Manrope's advance widths and given Manrope's own vertical metrics, one face per shipped weight so no weight is
// synthesised. Nothing is downloaded (local() only), the lightweight path keeps the plain system stack, and once
// Manrope has loaded nothing about the page changes.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { brotliDecompressSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

const UI = join(import.meta.dirname, '..', '..', 'app', 'src', 'ui');
const FONTS = join(import.meta.dirname, '..', '..', 'app', 'public', 'fonts', 'manrope');
const tokens = readFileSync(join(UI, 'tokens.css'), 'utf8');

/** head.unitsPerEm and hhea ascender / descender / lineGap of a shipped WOFF2 (the reader of font-metrics.test.ts, cut down). */
function vertical(file: string): { upm: number; ascender: number; descender: number; lineGap: number } {
  const bytes = readFileSync(join(FONTS, file));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const known = ['cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep'];
  let offset = 48;
  const base128 = (): number => { let value = 0; for (let i = 0; i < 5; i++) { const b = view.getUint8(offset++); value = value * 128 + (b & 0x7f); if (!(b & 0x80)) return value; } throw new Error('base128'); };
  const tables: { tag: string; length: number }[] = [];
  for (let t = 0; t < view.getUint16(12); t++) {
    const flags = view.getUint8(offset++);
    let tag = known[flags & 0x3f] ?? `#${flags & 0x3f}`;
    if ((flags & 0x3f) === 63) { tag = String.fromCharCode(...[0, 1, 2, 3].map((i) => view.getUint8(offset + i))); offset += 4; }
    const original = base128();
    const transformed = tag === 'glyf' || tag === 'loca' ? flags >> 6 !== 3 : flags >> 6 !== 0;
    tables.push({ tag, length: transformed ? base128() : original });
  }
  const stream = brotliDecompressSync(bytes.subarray(offset, offset + view.getUint32(20)));
  const at: Record<string, number> = {};
  let cursor = 0;
  for (const table of tables) { at[table.tag] = cursor; cursor += table.length; }
  const data = new DataView(stream.buffer, stream.byteOffset, stream.byteLength);
  return { upm: data.getUint16(at.head! + 18), ascender: data.getInt16(at.hhea! + 4), descender: data.getInt16(at.hhea! + 6), lineGap: data.getInt16(at.hhea! + 8) };
}

/** Every @font-face block of tokens.css, as descriptor → value. */
const faces = [...tokens.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => Object.fromEntries(
  m[1]!.split(';').map((d) => d.trim()).filter(Boolean).map((d) => [d.slice(0, d.indexOf(':')).trim(), d.slice(d.indexOf(':') + 1).trim()]),
));
const percent = (value: string | undefined): number => Number(/^([\d.]+)%$/.exec(value ?? '')?.[1] ?? NaN);

describe('the metric-matched fallback in front of the system stack (tokens.css)', () => {
  it('is named right after Manrope, before the system stack, in --font-sans', () => {
    const stack = /--font-sans:\s*([^;]+);/.exec(tokens)![1]!;
    expect(stack.split(',').map((s) => s.trim()).slice(0, 3)).toEqual(["'Manrope'", "'Manrope Fallback'", 'system-ui']);
  });

  it('has one face for each weight Manrope ships (400, 500, 700), each a local Arial or its metric twin, nothing to download', () => {
    const fallback = faces.filter((f) => f['font-family'] === "'Manrope Fallback'");
    expect(fallback.map((f) => f['font-weight'])).toEqual(['400', '500', '700']);
    for (const face of fallback) {
      expect(face.src, 'local() only: the lightweight graph ships no webfont').not.toMatch(/url\(/);
      const bold = face['font-weight'] === '700';
      for (const name of bold ? ['Arial Bold', 'Arial-BoldMT', 'Liberation Sans Bold', 'Arimo Bold'] : ['Arial', 'ArialMT', 'Liberation Sans', 'Arimo']) {
        expect(face.src).toContain(`local('${name}')`);
      }
    }
  });

  it.each(['400', '500', '700'])('weight %s: Manrope\'s own ascent, descent and line gap, divided by its size-adjust', (weight) => {
    const face = faces.find((f) => f['font-family'] === "'Manrope Fallback'" && f['font-weight'] === weight)!;
    const m = vertical(`manrope-${weight}-normal-latin.woff2`);
    const size = percent(face['size-adjust']) / 100;
    expect(size).toBeGreaterThan(0.95);
    expect(size).toBeLessThan(1.05);
    expect(percent(face['ascent-override'])).toBeCloseTo((m.ascender / m.upm / size) * 100, 1);
    expect(percent(face['descent-override'])).toBeCloseTo((-m.descender / m.upm / size) * 100, 1);
    expect(percent(face['line-gap-override'])).toBeCloseTo((m.lineGap / m.upm / size) * 100, 1);
  });

  it('the lightweight path keeps the plain system stack: no Manrope, no fallback face', () => {
    const lagano = /:root\[data-lagano='1'\]\s*\{[^}]*--font-sans:\s*([^;]+);/.exec(tokens);
    expect(lagano, "tokens.css sets --font-sans under :root[data-lagano='1']").not.toBeNull();
    expect(lagano![1]).not.toMatch(/Manrope/);
    expect(lagano![1]!.trim().startsWith('system-ui')).toBe(true);
  });
});
