// Test-only colour maths: OKLCH/Oklab (Ottosson's matrices) to linear sRGB, the
// oklab mixes an engine renders for the tints, and 8-bit quantisation. The
// contrast test uses this to measure the colours a browser actually paints,
// not only the hex fallbacks. Not a *.test.ts file, so it is not a suite.
export type Linear = [number, number, number];

export function oklabToLinear(L: number, a: number, b: number): Linear {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ];
}

export function linearToOklab(r: number, g: number, b: number): Linear {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  ];
}

const gamma = (v: number): number => {
  const c = Math.min(1, Math.max(0, v));
  return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
};
const linear = (v: number): number => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);

/** The 8-bit sRGB pixel an engine paints for a linear colour. */
export const toHex = (rgb: Linear): string => `#${rgb.map((v) => Math.round(gamma(v) * 255).toString(16).padStart(2, '0')).join('')}`;
export const hexToLinear = (hex: string): Linear => [1, 3, 5].map((i) => linear(parseInt(hex.slice(i, i + 2), 16) / 255)) as Linear;

/** An `oklch(L% C h)` literal as written in tokens.css, as linear sRGB. */
export function parseOklch(value: string): Linear {
  const m = /oklch\(\s*([\d.]+)%\s+([\d.]+)\s+([\d.]+)\s*\)/.exec(value);
  if (!m) throw new Error(`not an oklch() literal: ${value}`);
  const [L, C, h] = [Number(m[1]) / 100, Number(m[2]), Number(m[3])];
  return oklabToLinear(L, C * Math.cos((h * Math.PI) / 180), C * Math.sin((h * Math.PI) / 180));
}

/** `color-mix(in oklab, fg pct, bg)` for two opaque colours, as an engine computes it. */
export function mixOklab(fg: Linear, pct: number, bg: Linear): Linear {
  const a = linearToOklab(...fg);
  const b = linearToOklab(...bg);
  return oklabToLinear(a[0] * pct + b[0] * (1 - pct), a[1] * pct + b[1] * (1 - pct), a[2] * pct + b[2] * (1 - pct));
}

/** Oklab distance between two linear colours. */
export function deltaE(a: Linear, b: Linear): number {
  const x = linearToOklab(...a);
  const y = linearToOklab(...b);
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}
