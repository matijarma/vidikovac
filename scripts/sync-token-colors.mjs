// Mechanical conversion of the sRGB compatibility palette to its OKLCH twin.
// No independent second palette. --check makes this a non-mutating drift gate.
import { readFileSync, writeFileSync } from 'node:fs';
const file = new URL('../app/src/ui/tokens.css', import.meta.url);
const source = readFileSync(file, 'utf8');
function oklch(hex) {
  const [r, g, b] = hex.match(/../g).map(v => parseInt(v, 16) / 255)
    .map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const b2 = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return `oklch(${(100 * L).toFixed(3)}% ${Math.hypot(a, b2).toFixed(5)} ${((Math.atan2(b2, a) * 180 / Math.PI + 360) % 360).toFixed(2)})`;
}
let next = source;
for (const [, name, hex] of source.matchAll(/(--palette-(?:light|dark)-[\w-]+): #([a-f0-9]{6});/g)) {
  const pattern = new RegExp(`${name}: oklch\\([^;]+\\);`, 'g');
  next = next.replace(pattern, `${name}: ${oklch(hex)};`);
}
if (process.argv.includes('--check')) {
  if (next !== source) { console.error('OKLCH palette is out of sync. Run node scripts/sync-token-colors.mjs.'); process.exitCode = 1; }
} else if (next !== source) writeFileSync(file, next);
