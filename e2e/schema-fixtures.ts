// Real committed geometry, synthetic evidence only at the browser boundary.
// Shared by the browser gate and the local visual-review script.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { decodeNetwork } from '../shared/motion/network';
import { decodeSchema, matchSchemaPath } from '../shared/motion/schema';
import { toLonLat } from '../shared/motion/geo';
import type { ModuleSnapshot } from '../worker/feed/schema';

const root = resolve(import.meta.dirname, '..');
const net = decodeNetwork(JSON.parse(readFileSync(resolve(root, 'app/public/data/zet-network.json'), 'utf8')));
const schema = decodeSchema(JSON.parse(readFileSync(resolve(root, 'app/public/data/zet-schema.json'), 'utf8')));
const index = net.paths.findIndex((p, i) => p.route === '6' && matchSchemaPath(schema, net, i).placeable);
if (index < 0) throw new Error('Schema E2E: no real line 6 path');
const path = net.paths[index];
const matched = matchSchemaPath(schema, net, index).stops;
const reference = matched.find(s => s.name === 'Frankopanska') ?? matched[Math.floor(matched.length / 2)];
const start = Math.max(0, reference.s - 100);
const [lon, lat] = toLonLat(net.toPathPoint(index, start));

export function schemaSnapshot(time: number): ModuleSnapshot {
  const stamp = new Date(time).toISOString();
  return {
    module: 'zet-rt', tier: 'open', status: 'live', fetchedAt: stamp, sourceUpdatedAt: stamp,
    attribution: { text: 'ZET, test evidence over committed geometry', url: 'https://www.zet.hr', licence: 'Otvorena dozvola' },
    items: [{
      id: 'vehicle:schema-e2e', module: 'zet-rt', kind: 'vehicle', tier: 'open', title: 'Tramvaj 6', at: stamp,
      geo: { type: 'Point', coordinates: [lon, lat] },
      data: { routeId: '6', routeType: 0, confidence: .9, speed: 10, headsign: matched.at(-1)?.name ?? '6' },
      motion: { path: path.id, plan: [[0, start], [90, Math.min(path.len, start + 900)]] },
    }],
  };
}
