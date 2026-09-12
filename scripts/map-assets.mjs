// Reproducible copies of the upstream Protomaps basemap glyphs/sprites. These
// are build inputs; the running app never fetches a third-party asset host.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../app/public/maps');
const base = 'https://protomaps.github.io/basemaps-assets';
const fonts = ['Noto Sans Regular', 'Noto Sans Medium', 'Noto Sans Italic'];
const ranges = ['0-255', '256-511', '512-767', '768-1023', '1024-1279', '8192-8447'];

async function copy(path, url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`${response.status}: ${url}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const output = resolve(root, path);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, bytes);
  return bytes.length;
}

const assets = [];
for (const font of fonts) for (const range of ranges) {
  const path = `fonts/${font}/${range}.pbf`;
  assets.push([path, `${base}/fonts/${encodeURIComponent(font)}/${range}.pbf`]);
}
for (const theme of ['light', 'dark']) for (const extension of ['.json', '.png', '@2x.json', '@2x.png']) {
  assets.push([`sprites/${theme}${extension}`, `${base}/sprites/v4/${theme}${extension}`]);
}
let total = 0;
for (let i = 0; i < assets.length; i += 4) {
  const sizes = await Promise.all(assets.slice(i, i + 4).map(([path, url]) => copy(path, url)));
  total += sizes.reduce((a, b) => a + b, 0);
}
console.log(`Copied ${assets.length} Protomaps assets, ${total} bytes.`);
