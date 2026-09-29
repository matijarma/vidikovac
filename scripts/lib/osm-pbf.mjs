// A reader for the OpenStreetMap PBF format (https://wiki.openstreetmap.org/wiki/PBF_Format),
// just enough for scripts/osm-hours.mjs: the file header, and the named points of interest
// inside one bounding box, as nodes and as ways reduced to one point.
//
// The file is a sequence of blocks: a 4-byte big-endian length, a BlobHeader (type
// "OSMHeader" or "OSMData"), then a Blob whose payload is raw or zlib-compressed (the
// only two encodings Geofabrik writes; lzma and zstd are refused). The payload is a
// HeaderBlock or a PrimitiveBlock: a string table, then primitive groups of plain Nodes,
// DenseNodes (ids, coordinates and tags delta-coded in parallel packed arrays), Ways
// (tags and delta-coded node references) and Relations. Protobuf decoding goes through
// `pbf` (already a dependency, scripts/streets-geo.mjs) and inflation through node:zlib,
// so the reader needs no new package.
//
// Memory: a way carries node references, not coordinates, so the coordinates of every
// node inside the box are kept (ids in a Float64Array, exact below 2^53; coordinates as
// Int32 in 1e-7 degrees) in arrays that grow by doubling. Only the box is kept: the
// Croatia extract has tens of millions of nodes, Zagreb's box a few million. Geofabrik
// writes nodes before ways, sorted by id (Sort.Type_then_ID); the reader checks the
// order and sorts once if it ever meets an unsorted file. A way's point is the mean of
// its nodes inside the box (a closed way's repeated last node counted once). Relations
// are skipped and counted: a multipolygon's point would need its member ways' geometry.
import { closeSync, openSync, readSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { PbfReader } from 'pbf';

const UTF8 = new TextDecoder('utf-8');

/** Reads `length` bytes at `position` or throws when the file ends first. */
function readExactly(fd, length, position) {
  const buf = Buffer.allocUnsafe(length);
  let done = 0;
  while (done < length) {
    const n = readSync(fd, buf, done, length - done, position + done);
    if (n === 0) throw new Error(`osm-pbf: file ends inside a block (wanted ${length} bytes at ${position})`);
    done += n;
  }
  return buf;
}

function readBlobHeader(tag, header, pbf) {
  if (tag === 1) header.type = pbf.readString();
  else if (tag === 3) header.datasize = pbf.readVarint();
}

function readBlob(tag, blob, pbf) {
  if (tag === 1) blob.raw = pbf.readBytes();
  else if (tag === 2) blob.rawSize = pbf.readVarint();
  else if (tag === 3) blob.zlib = pbf.readBytes();
  else if (tag === 4 || tag === 5 || tag === 6 || tag === 7) blob.unsupported = tag;
}

/** Every block of the file, decompressed: { type: 'OSMHeader' | 'OSMData' | other, data: Uint8Array }. */
export function* readBlocks(path) {
  const fd = openSync(path, 'r');
  try {
    let position = 0;
    for (;;) {
      const lengthBytes = Buffer.allocUnsafe(4);
      const n = readSync(fd, lengthBytes, 0, 4, position);
      if (n === 0) return;
      if (n < 4) throw new Error('osm-pbf: truncated block length');
      const headerLength = lengthBytes.readUInt32BE(0);
      if (headerLength > 64 * 1024) throw new Error(`osm-pbf: BlobHeader of ${headerLength} bytes (limit 64 KiB): not a PBF file`);
      position += 4;
      const header = new PbfReader(readExactly(fd, headerLength, position)).readFields(readBlobHeader, { type: '', datasize: 0 });
      position += headerLength;
      if (!(header.datasize > 0) || header.datasize > 32 * 1024 * 1024) throw new Error(`osm-pbf: Blob of ${header.datasize} bytes (limit 32 MiB)`);
      const blob = new PbfReader(readExactly(fd, header.datasize, position)).readFields(readBlob, {});
      position += header.datasize;
      if (blob.unsupported) throw new Error(`osm-pbf: Blob field ${blob.unsupported} (lzma, bzip2, lz4 or zstd) is not supported`);
      const data = blob.raw ?? (blob.zlib ? inflateSync(blob.zlib) : null);
      if (!data) throw new Error('osm-pbf: Blob without data');
      if (blob.rawSize !== undefined && data.length !== blob.rawSize) throw new Error(`osm-pbf: Blob inflated to ${data.length} bytes, header says ${blob.rawSize}`);
      yield { type: header.type, data };
    }
  } finally {
    closeSync(fd);
  }
}

function readHeaderBlock(tag, h, pbf) {
  if (tag === 4) h.requiredFeatures.push(pbf.readString());
  else if (tag === 5) h.optionalFeatures.push(pbf.readString());
  else if (tag === 16) h.writingProgram = pbf.readString();
  else if (tag === 17) h.source = pbf.readString();
  else if (tag === 32) h.replicationTimestamp = pbf.readVarint();
  else if (tag === 33) h.replicationSequence = pbf.readVarint();
}

/** The HeaderBlock: features, writing program and the replication timestamp (seconds). */
export function decodeHeader(data) {
  const h = new PbfReader(data).readFields(readHeaderBlock, { requiredFeatures: [], optionalFeatures: [] });
  const unknown = h.requiredFeatures.filter((f) => f !== 'OsmSchema-V0.6' && f !== 'DenseNodes');
  if (unknown.length) throw new Error(`osm-pbf: required features not supported: ${unknown.join(', ')}`);
  return h;
}

// ---------------------------------------------------------------------------
// PrimitiveBlock

function readStringTable(tag, strings, pbf) {
  if (tag === 1) strings.push(UTF8.decode(pbf.readBytes()));
}

function readDense(tag, d, pbf) {
  if (tag === 1) pbf.readPackedSVarint(d.id);
  else if (tag === 8) pbf.readPackedSVarint(d.lat);
  else if (tag === 9) pbf.readPackedSVarint(d.lon);
  else if (tag === 10) pbf.readPackedVarint(d.keysVals);
}

function readNode(tag, n, pbf) {
  if (tag === 1) n.id = pbf.readSVarint();
  else if (tag === 2) pbf.readPackedVarint(n.keys);
  else if (tag === 3) pbf.readPackedVarint(n.vals);
  else if (tag === 8) n.lat = pbf.readSVarint();
  else if (tag === 9) n.lon = pbf.readSVarint();
}

function readWay(tag, w, pbf) {
  if (tag === 1) w.id = pbf.readVarint();
  else if (tag === 2) pbf.readPackedVarint(w.keys);
  else if (tag === 3) pbf.readPackedVarint(w.vals);
  else if (tag === 8) pbf.readPackedSVarint(w.refs);
}

function readRelation(tag, r, pbf) {
  if (tag === 1) r.id = pbf.readVarint();
  else if (tag === 2) pbf.readPackedVarint(r.keys);
  else if (tag === 3) pbf.readPackedVarint(r.vals);
}

function readGroup(tag, g, pbf) {
  if (tag === 1) g.nodes.push(pbf.readMessage(readNode, { id: 0, keys: [], vals: [], lat: 0, lon: 0 }));
  else if (tag === 2) g.dense = pbf.readMessage(readDense, { id: [], lat: [], lon: [], keysVals: [] });
  else if (tag === 3) g.ways.push(pbf.readMessage(readWay, { id: 0, keys: [], vals: [], refs: [] }));
  else if (tag === 4) g.relations.push(pbf.readMessage(readRelation, { id: 0, keys: [], vals: [] }));
}

function readBlock(tag, b, pbf) {
  if (tag === 1) pbf.readMessage(readStringTable, b.strings);
  else if (tag === 2) b.groups.push(pbf.readMessage(readGroup, { nodes: [], dense: null, ways: [], relations: [] }));
  else if (tag === 17) b.granularity = pbf.readVarint();
  else if (tag === 19) b.latOffset = pbf.readVarint(true);
  else if (tag === 20) b.lonOffset = pbf.readVarint(true);
}

// ---------------------------------------------------------------------------
// Node coordinates inside the box

class NodeIndex {
  constructor() {
    this.size = 0;
    this.ids = new Float64Array(1 << 20);
    this.lon = new Int32Array(1 << 20);
    this.lat = new Int32Array(1 << 20);
    this.sorted = true;
  }
  push(id, lon, lat) {
    if (this.size === this.ids.length) {
      const grow = (a) => { const b = new a.constructor(a.length * 2); b.set(a); return b; };
      this.ids = grow(this.ids); this.lon = grow(this.lon); this.lat = grow(this.lat);
    }
    if (this.size > 0 && id <= this.ids[this.size - 1]) this.sorted = false;
    this.ids[this.size] = id; this.lon[this.size] = lon; this.lat[this.size] = lat;
    this.size += 1;
  }
  /** Sorts by id once, for a file that did not keep Sort.Type_then_ID. */
  ensureSorted() {
    if (this.sorted) return;
    const order = Array.from({ length: this.size }, (_, i) => i).sort((a, b) => this.ids[a] - this.ids[b]);
    const pick = (a) => { const b = new a.constructor(this.size); order.forEach((j, i) => { b[i] = a[j]; }); return b; };
    this.ids = pick(this.ids); this.lon = pick(this.lon); this.lat = pick(this.lat);
    this.sorted = true;
  }
  /** Position of `id`, or -1 when the node is outside the box (or absent). */
  find(id) {
    let lo = 0, hi = this.size - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      const v = this.ids[mid];
      if (v === id) return mid;
      if (v < id) lo = mid + 1; else hi = mid - 1;
    }
    return -1;
  }
}

/**
 * Reads the whole file and returns the elements `select(tags)` keeps, inside `bbox`
 * ([west, south, east, north], degrees): { type: 'node' | 'way', id, lon, lat, tags }.
 * `select` sees only elements that carry at least one of `keys` (a cheap pre-filter on the
 * string table, so tags are built for a few thousand elements, not millions).
 */
export function readPois(path, { bbox, keys, select }) {
  const [west, south, east, north] = bbox;
  const stats = { blocks: 0, nodes: 0, nodesInBox: 0, ways: 0, waysKept: 0, waysOutside: 0, relations: 0, relationsSkipped: 0, missingRefs: 0 };
  const index = new NodeIndex();
  const elements = [];
  let header = null;
  const wantedKeys = new Set(keys);

  for (const { type, data } of readBlocks(path)) {
    stats.blocks += 1;
    if (type === 'OSMHeader') { header = decodeHeader(data); continue; }
    if (type !== 'OSMData') continue;
    const block = new PbfReader(data).readFields(readBlock, { strings: [], groups: [], granularity: 100, latOffset: 0, lonOffset: 0 });
    const s = block.strings;
    const wanted = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) if (wantedKeys.has(s[i])) wanted[i] = 1;
    const g = block.granularity;
    // Degrees * 1e7 as an integer: nanodegrees / 100.
    const toE7 = (offset, value) => Math.round((offset + g * value) / 100);
    const inBox = (lonE7, latE7) => lonE7 >= west * 1e7 && lonE7 <= east * 1e7 && latE7 >= south * 1e7 && latE7 <= north * 1e7;
    const tagsOf = (keysArr, valsArr) => {
      const tags = {};
      for (let i = 0; i < keysArr.length; i++) tags[s[keysArr[i]]] = s[valsArr[i]];
      return tags;
    };
    const hasWanted = (keysArr) => keysArr.some((k) => wanted[k] === 1);

    for (const group of block.groups) {
      if (group.dense) {
        const d = group.dense;
        let id = 0, lat = 0, lon = 0, kv = 0;
        for (let i = 0; i < d.id.length; i++) {
          id += d.id[i]; lat += d.lat[i]; lon += d.lon[i];
          stats.nodes += 1;
          // This node's tags: key/value string ids up to a 0 delimiter (an empty keysVals means no node has tags).
          let from = kv, candidate = false;
          if (d.keysVals.length) {
            while (kv < d.keysVals.length && d.keysVals[kv] !== 0) { if (wanted[d.keysVals[kv]] === 1) candidate = true; kv += 2; }
            if (kv >= d.keysVals.length) throw new Error('osm-pbf: DenseNodes keys_vals ends without its delimiter');
            kv += 1;
          }
          const lonE7 = toE7(block.lonOffset, lon), latE7 = toE7(block.latOffset, lat);
          if (!inBox(lonE7, latE7)) continue;
          index.push(id, lonE7, latE7);
          stats.nodesInBox += 1;
          if (!candidate) continue;
          const tags = {};
          for (let j = from; d.keysVals[j] !== 0; j += 2) tags[s[d.keysVals[j]]] = s[d.keysVals[j + 1]];
          if (select(tags)) elements.push({ type: 'node', id, lon: lonE7 / 1e7, lat: latE7 / 1e7, tags });
        }
      }
      for (const n of group.nodes) {
        stats.nodes += 1;
        const lonE7 = toE7(block.lonOffset, n.lon), latE7 = toE7(block.latOffset, n.lat);
        if (!inBox(lonE7, latE7)) continue;
        index.push(n.id, lonE7, latE7);
        stats.nodesInBox += 1;
        if (!hasWanted(n.keys)) continue;
        const tags = tagsOf(n.keys, n.vals);
        if (select(tags)) elements.push({ type: 'node', id: n.id, lon: lonE7 / 1e7, lat: latE7 / 1e7, tags });
      }
      for (const w of group.ways) {
        stats.ways += 1;
        if (!hasWanted(w.keys)) continue;
        const tags = tagsOf(w.keys, w.vals);
        if (!select(tags)) continue;
        index.ensureSorted();
        let ref = 0, sumLon = 0, sumLat = 0, found = 0;
        const refs = [];
        for (const delta of w.refs) { ref += delta; refs.push(ref); }
        if (refs.length > 1 && refs[0] === refs[refs.length - 1]) refs.pop();
        for (const r of refs) {
          const at = index.find(r);
          if (at < 0) { stats.missingRefs += 1; continue; }
          sumLon += index.lon[at]; sumLat += index.lat[at]; found += 1;
        }
        if (!found) { stats.waysOutside += 1; continue; }
        stats.waysKept += 1;
        elements.push({ type: 'way', id: w.id, lon: Math.round(sumLon / found) / 1e7, lat: Math.round(sumLat / found) / 1e7, tags });
      }
      for (const r of group.relations) {
        stats.relations += 1;
        if (hasWanted(r.keys) && select(tagsOf(r.keys, r.vals))) stats.relationsSkipped += 1;
      }
    }
  }
  if (!header) throw new Error('osm-pbf: no OSMHeader block');
  return { header, elements, stats };
}
