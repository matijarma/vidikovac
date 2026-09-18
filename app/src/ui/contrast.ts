// WCAG 2.x relative luminance and contrast ratio. Used by the CI contrast test
// and, at runtime, to pick the number's tone on a terminal's line chip
// (schema-paint.ts, F4), so it stays dependency-free and exact.
//
// It has to read the colour forms the app actually produces, not only hex: a
// tone read off computed style comes back the way the engine resolved it, and
// tokens.css redefines the whole palette in `oklch()` inside an @supports
// block, so in every current browser `--tone-text-primary` resolves to
// `oklch(25.159% 0.03844 252.41)` and never to the hex fallback under it.

/** WCAG AA for text under 24 px regular / 18.66 px bold. */
export const AA_TEXT = 4.5;

/** Linear-light sRGB, 0..1 per channel. An out-of-gamut OKLCH can land just
 *  outside that; luminance clamps, exactly as an engine does when it paints. */
export type LinearRgb = [number, number, number];

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;
/** `rgb(12 18 80)`, `rgb(12, 18, 80)`, `rgba(12 18 80 / 0.5)`, percentages. */
const RGB = /^rgba?\(\s*([\d.]+)(%?)\s*[,\s]\s*([\d.]+)(%?)\s*[,\s]\s*([\d.]+)(%?)\s*(?:[,/][^)]*)?\)$/i;
/** `oklch(25.159% 0.03844 252.41)`, as tokens.css writes it. */
const OKLCH = /^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)(?:deg)?\s*(?:\/[^)]*)?\)$/i;

export function parseHex(hex: string): [number, number, number] {
  const m = HEX.exec(hex.trim());
  if (!m) throw new Error(`contrast: expected a hex colour, got "${hex}"`);
  let v = m[1]!;
  if (v.length === 3) v = v.split('').map((c) => c + c).join('');
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}

function channel(byte: number): number {
  const c = byte / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** OKLCH to linear sRGB by Ottosson's matrices -- the same maths the palette
 *  is measured with in test/app/oklab.ts, ported here because the runtime
 *  needs it too. No round trip through 8-bit: quantising twice would shift
 *  a ratio by a hundredth for nothing. */
function oklchToLinear(L: number, C: number, hDeg: number): LinearRgb {
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ];
}

/** Any colour form the app's own tokens, artefacts and computed styles
 *  produce: `#rgb`/`#rrggbb`, `rgb()`/`rgba()`, `oklch(L C H)`. Throws on
 *  anything else, so a caller reading a tone off computed style still has to
 *  say what it wants done with a colour nobody here can measure. */
export function parseCssColour(text: string): LinearRgb {
  const value = text.trim();
  if (HEX.test(value)) return parseHex(value).map(channel) as LinearRgb;
  const rgb = RGB.exec(value);
  // A percentage channel is 0-100 of full scale, a plain one 0-255.
  if (rgb) return [1, 3, 5].map((i) => channel(Number(rgb[i]) * (rgb[i + 1] ? 2.55 : 1))) as LinearRgb;
  const oklch = OKLCH.exec(value);
  if (oklch) return oklchToLinear(Number(oklch[1]) / (oklch[2] ? 100 : 1), Number(oklch[3]), Number(oklch[4]));
  throw new Error(`contrast: unsupported colour "${text}"`);
}

export function luminance(colour: string): number {
  const rgb = parseCssColour(colour);
  const clamp = (v: number): number => Math.min(1, Math.max(0, v));
  return 0.2126 * clamp(rgb[0]) + 0.7152 * clamp(rgb[1]) + 0.0722 * clamp(rgb[2]);
}

export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

