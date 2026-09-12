// Derive a small searchable stop catalogue from the existing verified GTFS
// geometry artefact. No new upstream, guessed locations, or browser decoder.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

export function stopCatalogue(raw) {
  const rows = [];
  let x = 0, y = 0;
  for (let i = 0; i < raw.stops.id.length; i++) {
    x += raw.stops.p[i][0];
    y += raw.stops.p[i][1];
    let shapeIndex = 0;
    const routes = new Set();
    for (const [delta] of raw.stops.on[i]) {
      shapeIndex += delta;
      const route = raw.shapes.route[shapeIndex];
      if (route) routes.add(route);
    }
    rows.push({
      id: raw.stops.id[i], name: raw.stops.name[i],
      lon: +((raw.origin[0] + x * raw.scale).toFixed(5)),
      lat: +((raw.origin[1] + y * raw.scale).toFixed(5)),
      routes: [...routes].sort((a, b) => a.localeCompare(b, 'hr', { numeric: true })),
    });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name, 'hr') || a.id.localeCompare(b.id));
}

if (process.argv[1]?.replaceAll('\\', '/').endsWith('gtfs-stops.mjs')) {
  const root = resolve(import.meta.dirname, '..');
  const input = JSON.parse(readFileSync(resolve(root, 'app/public/data/zet-network.json'), 'utf8'));
  const text = JSON.stringify(stopCatalogue(input));
  mkdirSync(resolve(root, 'worker/data'), { recursive: true });
  writeFileSync(resolve(root, 'worker/data/zet-stops.json'), text + '\n');
  writeFileSync(resolve(root, 'app/public/data/stops.json'), text + '\n');
  console.log(`Derived ${input.stops.id.length} stops, ${Buffer.byteLength(text)} bytes, from feed ${input.feedVersion}.`);
}
