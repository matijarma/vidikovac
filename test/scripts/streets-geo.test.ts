// scripts/streets-geo.mjs: the offline street index behind "Adresa ili
// stajalište" (WP3 step 2). Built here from three real z14 tiles as the
// application serves them (test/fixtures/maps, raw MVT); the committed
// app/public/data/streets-geo.json is checked for its budget, its order and its
// coverage of the register, and read back through the app's own decoder.
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { zxyToTileId } from 'pmtiles';
import {
  CACHE_DIR,
  COVERAGE_TARGET,
  MAX_BYTES,
  STREET_KEYS,
  decodeIndex,
  decodeTile,
  fetchTiles,
  isGzip,
  latToTileY,
  loadRegister,
  lonToTileX,
  main,
  normalName as scriptNormalName,
  tilePointToLonLat,
  tilesFor,
} from '../../scripts/streets-geo.mjs';
import { decodeStreets } from '../../app/src/core/streets';
import type { StreetGeo } from '../../app/src/kiosk/places';
import stopsJson from '../../app/public/data/stops.json';
import { distanceM, normalName } from '../../shared/city/geo';
import { inZagreb } from '../../shared/city/place';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const FIXTURES = 'test/fixtures/maps';
const FIXTURE_TILES = ['14-8919-5841.mvt', '14-8920-5840.mvt', '14-8920-5841.mvt'];
const STOP_IDS = new Set((stopsJson as { id: string }[]).map((s) => s.id));
const quiet = () => {};
/** How far a point lies outside a box, in metres (0 inside). */
const metresOutside = (p: { lon: number; lat: number }, [w, s, e, n]: [number, number, number, number]) =>
  distanceM(p, { lon: Math.min(Math.max(p.lon, w), e), lat: Math.min(Math.max(p.lat, s), n) });
const sha = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');

async function buildFixtures(): Promise<{ json: string; rows: StreetGeo[] }> {
  const out = join(await mkdtemp(join(tmpdir(), 'streets-geo-')), 'streets-geo.json');
  const result = await main({ argv: ['--tiles', FIXTURES, '--out', out], cwd: ROOT, log: quiet });
  expect(result.written).toBe(true);
  const json = await readFile(out, 'utf8');
  return { json, rows: decodeStreets(JSON.parse(json)) };
}
let fixtureBuild: ReturnType<typeof buildFixtures> | undefined;
/** One build of the fixtures shared by the tests that only read it. */
const built = () => (fixtureBuild ??= buildFixtures());

/** A PMTiles v3 archive holding `tiles`, directories uncompressed, tiles gzipped when asked. */
function pmtilesArchive(tiles: { z: number; x: number; y: number; bytes: Uint8Array }[], gzip: boolean): Uint8Array {
  const varint = (n: number, out: number[]) => {
    while (n >= 0x80) {
      out.push((n % 0x80) | 0x80);
      n = Math.floor(n / 0x80);
    }
    out.push(n);
  };
  const entries = tiles
    .map((t) => ({ id: zxyToTileId(t.z, t.x, t.y), data: gzip ? new Uint8Array(gzipSync(t.bytes)) : t.bytes }))
    .sort((a, b) => a.id - b.id);
  const dir: number[] = [];
  varint(entries.length, dir);
  let last = 0;
  for (const e of entries) {
    varint(e.id - last, dir);
    last = e.id;
  }
  for (const _ of entries) varint(1, dir);
  for (const e of entries) varint(e.data.length, dir);
  let offset = 0;
  for (const e of entries) {
    varint(offset + 1, dir);
    offset += e.data.length;
  }
  const metadata = new TextEncoder().encode('{}');
  const header = new Uint8Array(127);
  const view = new DataView(header.buffer);
  header.set(new TextEncoder().encode('PMTiles'), 0);
  view.setUint8(7, 3);
  const rootOffset = 127;
  const metadataOffset = rootOffset + dir.length;
  const dataOffset = metadataOffset + metadata.length;
  const u64 = (at: number, value: number) => view.setBigUint64(at, BigInt(value), true);
  u64(8, rootOffset);
  u64(16, dir.length);
  u64(24, metadataOffset);
  u64(32, metadata.length);
  u64(40, dataOffset);
  u64(48, 0);
  u64(56, dataOffset);
  u64(64, offset);
  u64(72, entries.length);
  u64(80, entries.length);
  u64(88, entries.length);
  view.setUint8(96, 1); // clustered
  view.setUint8(97, 1); // internal compression: none
  view.setUint8(98, gzip ? 2 : 1); // tile compression: gzip or none
  view.setUint8(99, 1); // MVT
  view.setUint8(100, 14);
  view.setUint8(101, 14);
  const e7 = (at: number, value: number) => view.setInt32(at, Math.round(value * 1e7), true);
  e7(102, 15.7);
  e7(106, 45.5);
  e7(110, 16.3);
  e7(114, 46.02);
  view.setUint8(118, 14);
  e7(119, 15.98);
  e7(123, 45.81);
  const out = new Uint8Array(dataOffset + offset);
  out.set(header, 0);
  out.set(dir, rootOffset);
  out.set(metadata, metadataOffset);
  let at = dataOffset;
  for (const e of entries) {
    out.set(e.data, at);
    at += e.data.length;
  }
  return out;
}

describe('names and tiles', () => {
  it('folds a name exactly as shared/city/geo.ts normalName does', async () => {
    const { streets } = await loadRegister(ROOT);
    const names = [
      ...streets.slice(0, 400).map((s: { name: string }) => s.name),
      'Trg bana Josipa Jelačića', 'Đorđićeva ulica', 'Ulica „Dr. Ante Starčevića”', "Trg kralja Petra Krešimira IV.", '  Ilica  ',
    ];
    for (const name of names) expect(scriptNormalName(name), name).toBe(normalName(name));
  });

  it('finds the served tile of Trg bana J. Jelačića and inverts its corners', () => {
    expect([lonToTileX(15.97726), latToTileY(45.81286)]).toEqual([8919, 5841]);
    const [west, north] = tilePointToLonLat(8919, 5841, 14, 0, 0, 4096);
    const [east, south] = tilePointToLonLat(8919, 5841, 14, 4096, 4096, 4096);
    expect(west).toBeCloseTo(15.974121, 5);
    expect(east).toBeCloseTo(15.996094, 5);
    expect([lonToTileX(west + 1e-9), latToTileY(north - 1e-9)]).toEqual([8919, 5841]);
    expect(latToTileY(south - 1e-9)).toBe(5842);
  });

  it('lists the tiles of the settlements, once each, inside the map bounds, in order', () => {
    const tiles = tilesFor([{ bbox: [15.975, 45.79, 15.999, 45.815] }, { bbox: [15.98, 45.81, 15.99, 45.814] }, { bbox: [15.0, 45.0, 15.1, 45.1] }]);
    expect(tiles).toEqual([
      { z: 14, x: 8919, y: 5840 }, { z: 14, x: 8919, y: 5841 }, { z: 14, x: 8919, y: 5842 },
      { z: 14, x: 8920, y: 5840 }, { z: 14, x: 8920, y: 5841 }, { z: 14, x: 8920, y: 5842 },
    ]);
  });

  it('decodes the tiles as served (raw MVT) and gunzips only what the magic bytes say is gzip', async () => {
    expect((await readdir(join(ROOT, FIXTURES))).filter((f) => f.endsWith('.mvt')).sort()).toEqual(FIXTURE_TILES);
    const raw = new Uint8Array(readFileSync(join(ROOT, FIXTURES, '14-8919-5841.mvt')));
    expect(raw.length).toBe(117_661);
    expect([raw[0], raw[1]]).toEqual([0x1a, 0xca]);
    expect(isGzip(raw)).toBe(false);
    const plain = decodeTile(raw)!;
    const zipped = new Uint8Array(gzipSync(raw));
    expect(isGzip(zipped)).toBe(true);
    const unzipped = decodeTile(zipped)!;
    expect(Object.keys(plain.layers).sort()).toContain('roads');
    expect(unzipped.layers.roads!.length).toBe(plain.layers.roads!.length);
    expect(decodeTile(new Uint8Array(0))).toBeNull();
  });
});

describe('the builder on the fixtures', () => {
  it('writes the same bytes twice', async () => {
    const first = await buildFixtures();
    const second = await buildFixtures();
    expect(sha(second.json)).toBe(sha(first.json));
    expect(first.json.endsWith('}\n')).toBe(true);
  });

  it('resolves Ilica on a point inside Zagreb with its register id', async () => {
    const { rows } = await built();
    const { streets } = await loadRegister(ROOT);
    const register = streets.find((s: { name: string; settlement: string }) => s.name === 'Ilica' && s.settlement === 'Zagreb')!;
    const ilica = rows.filter((row) => row.name === 'Ilica');
    expect(ilica).toHaveLength(1);
    expect(ilica[0]).toMatchObject({ id: String(register.id), settlement: 'Zagreb', settlementId: '72150' });
    expect(inZagreb(ilica[0]!.lon, ilica[0]!.lat)).toBe(true);
    const [w, s, e, n] = ilica[0]!.bbox;
    expect(w <= ilica[0]!.lon && ilica[0]!.lon <= e && s <= ilica[0]!.lat && ilica[0]!.lat <= n).toBe(true);
  });

  it('lists each street’s stops by known id, one platform per name, within reach of the street', async () => {
    const { rows } = await built();
    const stops = new Map((stopsJson as { id: string; name: string; lon: number; lat: number }[]).map((s) => [s.id, s]));
    const kvaternika = rows.find((row) => row.name === 'Trg Eugena Kvaternika')!;
    expect(kvaternika.stops.map((id) => stops.get(id)!.name)).toContain('Kvaternikov trg');
    for (const row of rows) {
      const names = row.stops.map((id) => stops.get(id)?.name);
      expect(names.every(Boolean), row.name).toBe(true);
      expect(new Set(names).size, row.name).toBe(names.length);
      // Within 60 m of the line, so within 60 m of its box.
      for (const id of row.stops) expect(metresOutside(stops.get(id)!, row.bbox), `${row.name} ${id}`).toBeLessThanOrEqual(60);
    }
  });

  it('sorts the streets by name and keeps lines to the long ones', async () => {
    const { json, rows } = await built();
    const index = JSON.parse(json);
    expect(index).toMatchObject({ version: 'zagreb-v1', licence: 'ODbL 1.0', keys: STREET_KEYS, generatedFrom: '3 z14 tiles' });
    const keys = rows.map((row) => normalName(row.name));
    expect(keys).toEqual([...keys].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
    for (const row of rows) if (row.line) expect(row.lengthM, row.name).toBeGreaterThan(700);
    expect(rows.filter((row) => row.line && row.line.length >= 2).length).toBeGreaterThan(0);
  });

  it('reads back in the app exactly as the script reads it', async () => {
    const { json } = await built();
    const index = JSON.parse(json);
    expect(decodeStreets(index)).toEqual(decodeIndex(index));
    expect(() => decodeStreets({ streets: {} })).toThrow('streets-unavailable');
  });
});

describe('tile sources', () => {
  it('fetches only the missing tiles and keeps an empty answer as an empty tile', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'streets-geo-cache-'));
    const bytes = new Uint8Array(readFileSync(join(ROOT, FIXTURES, '14-8919-5841.mvt')));
    const asked: string[] = [];
    const fetchImpl = (async (url: string) => {
      asked.push(url);
      return url.endsWith('/5841.mvt') ? new Response(bytes, { status: 200 }) : new Response(null, { status: 204 });
    }) as unknown as typeof fetch;
    const tiles = [{ z: 14, x: 8919, y: 5841 }, { z: 14, x: 8919, y: 5842 }];
    await fetchTiles(tiles, { cwd, fetchImpl, log: quiet });
    expect(asked.sort()).toEqual([
      'https://zagreb.aningfilm.hr/maps/zagreb-v1/14/8919/5841.mvt',
      'https://zagreb.aningfilm.hr/maps/zagreb-v1/14/8919/5842.mvt',
    ]);
    expect(statSync(join(cwd, CACHE_DIR, '14-8919-5841.mvt')).size).toBe(bytes.length);
    expect(statSync(join(cwd, CACHE_DIR, '14-8919-5842.mvt')).size).toBe(0);
    await fetchTiles(tiles, { cwd, fetchImpl, log: quiet });
    expect(asked).toHaveLength(2);
    const failing = (async () => new Response('no', { status: 500 })) as unknown as typeof fetch;
    await expect(fetchTiles([{ z: 14, x: 8919, y: 5843 }], { cwd, fetchImpl: failing, log: quiet })).rejects.toThrow('HTTP 500');
  });

  it('builds the same streets from a local archive, gzipped or not, as from the tiles', async () => {
    const tiles = FIXTURE_TILES.map((name) => {
      const [z, x, y] = name.replace('.mvt', '').split('-').map(Number) as [number, number, number];
      return { z, x, y, bytes: new Uint8Array(readFileSync(join(ROOT, FIXTURES, name))) };
    });
    const fromTiles = JSON.parse((await built()).json);
    for (const gzip of [true, false]) {
      const dir = await mkdtemp(join(tmpdir(), 'streets-geo-archive-'));
      const archive = join(dir, 'zagreb-v1.pmtiles');
      await writeFile(archive, pmtilesArchive(tiles, gzip));
      const out = join(dir, 'streets-geo.json');
      await main({ argv: ['--archive', archive, '--out', out], cwd: ROOT, log: quiet });
      const fromArchive = JSON.parse(await readFile(out, 'utf8'));
      expect(fromArchive.streets, `gzip ${gzip}`).toEqual(fromTiles.streets);
      expect(fromArchive.lines).toEqual(fromTiles.lines);
    }
  });
});

describe('app/public/data/streets-geo.json (committed)', () => {
  const path = join(ROOT, 'app/public/data/streets-geo.json');
  const index = JSON.parse(readFileSync(path, 'utf8'));
  const rows = decodeStreets(index);

  it('stays inside the byte budget and names its licence', () => {
    expect(statSync(path).size).toBeLessThanOrEqual(MAX_BYTES);
    expect(index).toMatchObject({ version: 'zagreb-v1', licence: 'ODbL 1.0', attribution: '© OpenStreetMap contributors · Protomaps' });
  });

  it('carries at least 2,800 of the register’s Zagreb streets', async () => {
    const { streets } = await loadRegister(ROOT);
    const ids = new Set(rows.map((row) => row.id).filter(Boolean));
    const zagreb = streets.filter((s: { settlement: string }) => s.settlement === 'Zagreb');
    expect(zagreb.length).toBe(3_289);
    expect(zagreb.filter((s: { id: string }) => ids.has(String(s.id))).length).toBeGreaterThanOrEqual(COVERAGE_TARGET);
  });

  it('holds Ilica, Trg bana Josipa Jelačića and Trg Eugena Kvaternika inside Zagreb, sorted, with known stops', () => {
    for (const name of ['Ilica', 'Trg bana Josipa Jelačića', 'Trg Eugena Kvaternika']) {
      const row = rows.find((r) => r.name === name && r.settlement === 'Zagreb');
      expect(row, name).toBeDefined();
      expect(inZagreb(row!.lon, row!.lat)).toBe(true);
      expect(row!.id).toMatch(/^72150\d{4}$/);
    }
    const ilica = rows.find((r) => r.name === 'Ilica')!;
    expect(ilica.lengthM).toBeGreaterThan(4_000);
    expect(ilica.line!.length).toBeGreaterThanOrEqual(2);
    expect(ilica.stops.length).toBeGreaterThan(4);
    for (const row of rows) for (const id of row.stops) expect(STOP_IDS.has(id), `${row.name} ${id}`).toBe(true);
    const keys = rows.map((row) => normalName(row.name));
    expect(keys).toEqual([...keys].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
    expect(decodeIndex(index)).toEqual(rows);
  });
});
