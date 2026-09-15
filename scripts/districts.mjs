#!/usr/bin/env node
// Builds worker/data/gradske-cetvrti.json: the 17 gradske četvrti as
// Douglas-Peucker-simplified polygons in a local metre plane, reduced once
// at build time so worker/feed/geo/districts.ts never ships the ArcGIS
// FeatureServer's full-resolution boundaries (46,000+ vertices across the 17
// features) inside the Worker bundle. Deterministic and dependency-free like
// the other scripts/*.mjs build tools (gtfs-routes.mjs, gtfs-shapes.mjs):
// rerunning against the same fixture must byte-for-byte reproduce the same
// output file (this task's acceptance and test/feed/districts.test.ts both
// depend on it), so nothing here reads the clock, environment or an
// unstable iteration order.
//
// `node scripts/districts.mjs` reads the offline fixture below.
// `node scripts/districts.mjs --fetch` downloads the live ArcGIS
// FeatureServer into that fixture first (a build-time refresh only; the
// Worker itself never fetches this URL for the district table at runtime --
// see docs/izvori.md, "Prostorni slojevi modula ckan-geo").
// `node scripts/districts.mjs --tolerance 20` overrides the starting
// Douglas-Peucker epsilon in metres; if the result still exceeds the byte
// budget the script keeps escalating by 5 m up to 40 m, then exits 1.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// worker/feed/modules/ckan-geo.ts:14 -- duplicated here on purpose. Every
// scripts/*.mjs build tool in this repo is a self-contained, dependency-free
// reader (see gtfs-routes.mjs, gtfs-shapes.mjs): none of them imports a
// worker/*.ts module at build time, so this one does not either.
export const ARCGIS_CETVRTI_URL =
  'https://services8.arcgis.com/Usi0jGQwMmBUpFjr/arcgis/rest/services/Gradske_cetvrti/FeatureServer/0/query?where=1%3D1&outFields=*&outSR=4326&f=geojson';

export const FIXTURE_PATH = 'test/fixtures/gradske_cetvrti.geojson';
export const OUTPUT_PATH = 'worker/data/gradske-cetvrti.json';
export const MAX_BYTES = 61_440;
export const BASE_TOLERANCE_M = 15;
export const MAX_TOLERANCE_M = 40;
export const TOLERANCE_STEP_M = 5;

const USER_AGENT = 'Vidikovac/0.1 (zagreb.aningfilm.hr; kontakt@aningfilm.hr)';
const DOWNLOAD_TIMEOUT_MS = 30_000;

// The 17 gradske četvrti exactly as worker/pairing/areas.ts's AREAS lists
// them (slug, name, order) -- duplicated here by design: a .mjs build script
// does not import a .ts module, so this is the one other literal copy the
// brief allows, and test/feed/districts.test.ts asserts the generated
// table's slugs equal the real AREAS import, so the two cannot silently
// drift apart without a failing test.
export const AREAS = [
  { slug: 'donji-grad', name: 'Donji grad' },
  { slug: 'gornji-grad-medvescak', name: 'Gornji grad – Medveščak' },
  { slug: 'trnje', name: 'Trnje' },
  { slug: 'maksimir', name: 'Maksimir' },
  { slug: 'pescenica-zitnjak', name: 'Peščenica – Žitnjak' },
  { slug: 'novi-zagreb-istok', name: 'Novi Zagreb – istok' },
  { slug: 'novi-zagreb-zapad', name: 'Novi Zagreb – zapad' },
  { slug: 'tresnjevka-sjever', name: 'Trešnjevka – sjever' },
  { slug: 'tresnjevka-jug', name: 'Trešnjevka – jug' },
  { slug: 'crnomerec', name: 'Črnomerec' },
  { slug: 'gornja-dubrava', name: 'Gornja Dubrava' },
  { slug: 'donja-dubrava', name: 'Donja Dubrava' },
  { slug: 'stenjevec', name: 'Stenjevec' },
  { slug: 'podsused-vrapce', name: 'Podsused – Vrapče' },
  { slug: 'podsljeme', name: 'Podsljeme' },
  { slug: 'sesvete', name: 'Sesvete' },
  { slug: 'brezovica', name: 'Brezovica' },
];

const DIACRITICS = { č: 'c', ć: 'c', đ: 'd', š: 's', ž: 'z' };

/** slugOf('GORNJI GRAD - MEDVEŠČAK') -> 'gornji-grad-medvescak'. */
export function slugOf(imeGc) {
  return imeGc
    .toLocaleLowerCase('hr')
    .replace(/[čćđšž]/g, (ch) => DIACRITICS[ch])
    .replace(/[\s-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Local equirectangular metres around Zagreb's latitude (45.8°N); good
// enough for a Douglas-Peucker epsilon of a few tens of metres. See
// worker/feed/geo/districts.ts for the runtime twin of this projection
// (used by districtOf's segment distances) and app/src/motion/geo.ts for
// the client-side one -- three independent copies by design (the worker
// must not import app/src, and this build script imports neither).
const LON_TO_M = Math.cos((45.8 * Math.PI) / 180) * 111_320;
const LAT_TO_M = 110_574;
function toMetres([lon, lat]) {
  return [lon * LON_TO_M, lat * LAT_TO_M];
}

function perpendicularDistanceM(point, a, b) {
  const [px, py] = toMetres(point);
  const [ax, ay] = toMetres(a);
  const [bx, by] = toMetres(b);
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(px - ax, py - ay);
  const t = ((px - ax) * dx + (py - ay) * dy) / lengthSq;
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

/**
 * Iterative Douglas-Peucker over an open path. Iterative (an explicit stack,
 * not recursion) because some rings in the fixture run past 10,000 vertices
 * before simplification and a naive recursive split is not guaranteed
 * shallow on real, unevenly sampled boundary data.
 */
export function douglasPeucker(points, epsilonM) {
  const n = points.length;
  if (n < 3) return points.slice();
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  while (stack.length > 0) {
    const [start, end] = stack.pop();
    if (end - start < 2) continue;
    let maxDist = -1;
    let index = -1;
    for (let i = start + 1; i < end; i += 1) {
      const dist = perpendicularDistanceM(points[i], points[start], points[end]);
      if (dist > maxDist) {
        maxDist = dist;
        index = i;
      }
    }
    if (maxDist > epsilonM) {
      keep[index] = 1;
      stack.push([start, index], [index, end]);
    }
  }
  const result = [];
  for (let i = 0; i < n; i += 1) if (keep[i] === 1) result.push(points[i]);
  return result;
}

/**
 * Douglas-Peucker on a *closed* ring. Naive DP with identical endpoints
 * (ring[0] === ring[last]) degenerates -- the anchor line has zero length,
 * so "perpendicular distance" collapses to distance from a single point and
 * the simplification is not a faithful DP run. Instead the ring is first cut
 * at its farthest point from the start into two open chains, each run
 * through the real algorithm above, then rejoined; chain2 always ends back
 * at the start point, so the result is closed by construction, never by a
 * bolted-on fix-up.
 */
export function simplifyClosedRing(ring, epsilonM) {
  const points = ring.slice(0, -1); // drop the duplicate closing vertex
  if (points.length < 3) return ring.slice();
  const [ox, oy] = toMetres(points[0]);
  let farIndex = 1;
  let farDist = -1;
  for (let i = 1; i < points.length; i += 1) {
    const [x, y] = toMetres(points[i]);
    const dist = Math.hypot(x - ox, y - oy);
    if (dist > farDist) {
      farDist = dist;
      farIndex = i;
    }
  }
  const chain1 = points.slice(0, farIndex + 1);
  const chain2 = points.slice(farIndex).concat([points[0]]);
  const simplified1 = douglasPeucker(chain1, epsilonM);
  const simplified2 = douglasPeucker(chain2, epsilonM);
  const merged = simplified1.slice(0, -1).concat(simplified2);
  const first = merged[0];
  const last = merged[merged.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) merged.push([first[0], first[1]]);
  return merged;
}

const ROUND = 1e5;
function round5(value) {
  return Math.round(value * ROUND) / ROUND;
}

function roundRing(ring) {
  return ring.map(([lon, lat]) => [round5(lon), round5(lat)]);
}

function geometryPolygons(geometry) {
  if (geometry.type === 'Polygon') return [geometry.coordinates];
  if (geometry.type === 'MultiPolygon') return geometry.coordinates;
  throw new Error(`gradske četvrti: unsupported geometry type ${geometry.type}`);
}

/** [outer, ...holes] per polygon, simplified, closed, rounded; a ring that collapses under 4 points (a closed triangle) is dropped rather than shipped degenerate. */
function simplifyFeature(feature, epsilonM) {
  const polygons = geometryPolygons(feature.geometry);
  const simplified = [];
  for (const polygon of polygons) {
    const rings = [];
    for (const [ringIndex, ring] of polygon.entries()) {
      const plain = ring.map(([lon, lat]) => [lon, lat]);
      const first = plain[0];
      const last = plain[plain.length - 1];
      if (first[0] !== last[0] || first[1] !== last[1]) {
        throw new Error(`gradske četvrti: ring ${ringIndex} of ${feature.properties?.IME_GC} is not closed`);
      }
      const reduced = roundRing(simplifyClosedRing(plain, epsilonM));
      if (reduced.length >= 4) rings.push(reduced);
    }
    if (rings.length > 0) simplified.push(rings);
  }
  return simplified;
}

function bboxOf(polygons) {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const polygon of polygons) {
    for (const ring of polygon) {
      for (const [lon, lat] of ring) {
        if (lon < minLon) minLon = lon;
        if (lon > maxLon) maxLon = lon;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
      }
    }
  }
  return [round5(minLon), round5(minLat), round5(maxLon), round5(maxLat)];
}

function vertexCount(polygons) {
  let count = 0;
  for (const polygon of polygons) for (const ring of polygon) count += ring.length;
  return count;
}

/** Builds the table at one epsilon; throws if the fixture's districts and AREAS do not correspond one to one. */
export function buildTable(geojson, epsilonM) {
  const bySlug = new Map();
  for (const feature of geojson.features) {
    const name = feature.properties?.IME_GC;
    if (typeof name !== 'string' || !name.trim()) continue;
    const slug = slugOf(name);
    if (bySlug.has(slug)) throw new Error(`gradske četvrti: duplicate slug ${slug} (${name})`);
    bySlug.set(slug, feature);
  }

  const districts = [];
  for (const area of AREAS) {
    const feature = bySlug.get(area.slug);
    if (!feature) throw new Error(`gradske četvrti: fixture has no district slugging to ${area.slug} (${area.name})`);
    const polygons = simplifyFeature(feature, epsilonM);
    districts.push({ slug: area.slug, name: area.name, bbox: bboxOf(polygons), polygons });
    bySlug.delete(area.slug);
  }

  const stray = [...bySlug.keys()];
  if (stray.length > 0) {
    throw new Error(`gradske četvrti: fixture has districts AREAS does not list: ${stray.join(', ')}`);
  }

  return { source: ARCGIS_CETVRTI_URL, sourceFixture: FIXTURE_PATH, toleranceM: epsilonM, districts };
}

export async function fetchFixture({ fetchImpl = fetch, url = ARCGIS_CETVRTI_URL, cwd = process.cwd(), log = console.log } = {}) {
  log(`Fetching ${url}`);
  const response = await fetchImpl(url, {
    headers: { 'user-agent': USER_AGENT },
    redirect: 'follow',
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`gradske četvrti: HTTP ${response.status}`);
  const text = await response.text();
  const target = resolve(cwd, FIXTURE_PATH);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, text, 'utf8');
  log(`Wrote ${FIXTURE_PATH} (${text.length} bytes)`);
}

function parseArgs(argv) {
  let fetchFirst = false;
  let tolerance;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--fetch') {
      fetchFirst = true;
    } else if (argv[i] === '--tolerance') {
      const value = Number(argv[i + 1]);
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error(`--tolerance expects a positive number, got ${JSON.stringify(argv[i + 1])}`);
      }
      tolerance = value;
      i += 1;
    }
  }
  return { fetchFirst, tolerance };
}

export async function main({ argv = process.argv.slice(2), cwd = process.cwd(), log = console.log } = {}) {
  const { fetchFirst, tolerance } = parseArgs(argv);
  if (fetchFirst) await fetchFixture({ cwd, log });

  const fixturePath = resolve(cwd, FIXTURE_PATH);
  const geojson = JSON.parse(await readFile(fixturePath, 'utf8'));

  let epsilonM = tolerance ?? BASE_TOLERANCE_M;
  let table;
  let json;
  for (;;) {
    table = buildTable(geojson, epsilonM);
    json = `${JSON.stringify(table)}\n`;
    if (Buffer.byteLength(json, 'utf8') <= MAX_BYTES || epsilonM >= MAX_TOLERANCE_M) break;
    epsilonM = Math.min(MAX_TOLERANCE_M, epsilonM + TOLERANCE_STEP_M);
  }

  const bytes = Buffer.byteLength(json, 'utf8');
  if (bytes > MAX_BYTES) {
    log(`gradske četvrti: ${bytes} bytes at ε=${epsilonM} m still exceeds the ${MAX_BYTES} byte budget`);
    process.exitCode = 1;
    return { bytes, epsilonM, written: false };
  }

  const target = resolve(cwd, OUTPUT_PATH);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, json, 'utf8');

  for (const district of table.districts) log(`${district.slug}: ${vertexCount(district.polygons)} vertices`);
  log(`${bytes} bytes, ε=${epsilonM} m -> ${OUTPUT_PATH}`);
  return { bytes, epsilonM, written: true };
}

const invokedDirectly =
  typeof process.argv[1] === 'string' && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
