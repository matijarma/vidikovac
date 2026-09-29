import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { PbfWriter } from 'pbf';
import { decodeHeader, readBlocks, readPois } from '../../scripts/lib/osm-pbf.mjs';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const message = (write: (p: PbfWriter) => void) => { const p = new PbfWriter(); write(p); return Buffer.from(p.finish()); };
const save = (bytes: Buffer) => {
  const dir = mkdtempSync(join(tmpdir(), 'osm-pbf-')); dirs.push(dir);
  const path = join(dir, 'synthetic.pbf'); writeFileSync(path, bytes); return path;
};
const block = (type: string, payload: Buffer, compressed = false, rawSize = payload.length, dual = false) => {
  const blob = message((p) => {
    if (!compressed || dual) p.writeBytesField(1, payload);
    if (compressed) { p.writeVarintField(2, rawSize); p.writeBytesField(3, deflateSync(payload)); }
  });
  const header = message((p) => { p.writeStringField(1, type); p.writeVarintField(3, blob.length); });
  const length = Buffer.alloc(4); length.writeUInt32BE(header.length);
  return Buffer.concat([length, header, blob]);
};
const HEADER = block('OSMHeader', message((p) => {
  p.writeStringField(4, 'OsmSchema-V0.6'); p.writeStringField(4, 'DenseNodes'); p.writeVarintField(32, 1790626985);
}));
const STRINGS = ['', 'name', 'Proba', 'amenity', 'cafe', 'opening_hours', 'Mo-Fr 08:00-20:00'];
const group = (tag: number, payload: Buffer) => message((p) => p.writeBytesField(tag, payload));
const primitive = (groups: Buffer[], strings = STRINGS, granularity = 100) => message((p) => {
  p.writeBytesField(1, message((s) => { for (const text of strings) s.writeStringField(1, text); }));
  for (const g of groups) p.writeBytesField(2, g);
  p.writeVarintField(17, granularity);
});
const dense = (id = [10], lat = [458100000], lon = [159700000], tags = [1, 2, 3, 4, 5, 6, 0]) => group(2, message((p) => {
  p.writePackedSVarint(1, id); p.writePackedSVarint(8, lat); p.writePackedSVarint(9, lon); p.writePackedVarint(10, tags);
}));
const node = (keys = [1, 3, 5], vals = [2, 4, 6], omitLat = false) => group(1, message((p) => {
  p.writeSVarintField(1, 40); p.writePackedVarint(2, keys); p.writePackedVarint(3, vals);
  if (!omitLat) p.writeSVarintField(8, 458100000);
  p.writeSVarintField(9, 159700000);
}));
const way = group(3, message((p) => {
  p.writeVarintField(1, 50); p.writePackedVarint(2, [1, 3]); p.writePackedVarint(3, [2, 4]); p.writePackedSVarint(8, [10, 10, -10]);
}));
const read = (body: Buffer) => readPois(save(body), {
  bbox: [15.87, 45.72, 16.16, 45.9], keys: ['amenity'], select: (tags: Record<string, string>) => tags.amenity === 'cafe',
});

describe('PBF source validation', () => {
  it('reads raw/zlib blocks, dense/plain nodes, closed ways and skipped relations', () => {
    const relation = group(4, message((p) => {
      p.writeVarintField(1, 60); p.writePackedVarint(2, [1, 3]); p.writePackedVarint(3, [2, 4]);
    }));
    const pbf = Buffer.concat([HEADER, block('OSMData', primitive([
      dense([10, 10, 10], [458100000, 0, 0], [159700000, 10000, 3290000], [1, 2, 3, 4, 5, 6, 0, 0, 0]),
      node(), way, relation,
    ]), true)]);
    const result = read(pbf);
    expect(result.stats).toMatchObject({ nodes: 4, nodesInBox: 3, waysKept: 1, relationsSkipped: 1 });
    expect(result.elements.find((e: { type: string }) => e.type === 'way')).toMatchObject({ lon: 15.9705, lat: 45.81 });
  });

  it.each([
    ['unequal dense columns', primitive([dense([10, 10], [458100000], [159700000, 0], [])])],
    ['extra dense tags', primitive([dense([10], [458100000], [159700000], [1, 2, 3, 4, 0, 0])])],
    ['invalid dense string id', primitive([dense([10], [458100000], [159700000], [1, 2, 3, 4, 5, 99, 0])])],
    ['unequal tag columns', primitive([node([1, 3, 5], [2, 4])])],
    ['missing required latitude', primitive([node([1, 3], [2, 4], true)])],
    ['invalid string table', primitive([dense()], ['not empty', ...STRINGS.slice(1)])],
    ['zero granularity', primitive([dense()], STRINGS, 0)],
    ['nodes after ways', primitive([dense(), way, node()])],
    ['mixed primitive group', primitive([Buffer.concat([dense(), node()])])],
  ])('rejects %s instead of emitting partial POIs', (_name, payload) => {
    expect(() => read(Buffer.concat([HEADER, block('OSMData', payload)]))).toThrow(/osm-pbf/);
  });

  it('requires the header before any OSM data', () => {
    expect(() => read(Buffer.concat([block('OSMData', primitive([dense()])), HEADER]))).toThrow(/osm-pbf/);
  });

  it('refuses unsupported required features', () => {
    expect(() => decodeHeader(message((p) => p.writeStringField(4, 'HistoricalInformation')))).toThrow(/required features/);
  });

  it('refuses ambiguous blob payloads and bounds inflation before allocation', () => {
    expect(() => [...readBlocks(save(block('OSMData', Buffer.from('x'), true, 1, true)))]).toThrow(/osm-pbf/);
    expect(() => [...readBlocks(save(block('OSMData', Buffer.from('x'), true, 32 * 1024 * 1024)))]).toThrow(/osm-pbf/);
    expect(() => [...readBlocks(save(block('OSMData', Buffer.alloc(32 * 1024 * 1024), true, 1)))]).toThrow();
  });

  it('refuses a length-delimited protobuf field truncated inside its message', () => {
    const malformedHeader = Buffer.from([0x22, 0x10, 0x78]); // required_features claims sixteen bytes, only one follows
    expect(() => decodeHeader(malformedHeader)).toThrow(/osm-pbf/);
  });
});
