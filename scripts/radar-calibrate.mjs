#!/usr/bin/env node
// The radar composite's pixel to lon/lat map (docs/reveal-2026-10-plan/R3.md §0.2 (b), step 2).
//
//   node scripts/radar-calibrate.mjs --image test/fixtures/radar/kompozit-<stamp>.png [--out worker/data/radar-calibration.json]
//   node scripts/radar-calibrate.mjs --image <a newer composite> --check
//
// DHMZ does not publish the bounds or the projection of https://vrijeme.hr/kompozit-stat.png. The image draws the
// cities it knows as small black diamonds with a two-letter label (ZG, LJ, KA, VZ ...), and a city's centre is a
// point of known coordinates, so the map is fitted on them: every diamond is found in the image (findMarkers), the
// ones listed in LANDMARKS are matched to the diamond nearest the pixel they were read at by eye (within 4 px), and
// an affine map x = a·lon + b·lat + c, y = d·lon + e·lat + f is fitted by least squares over them. Over the whole image
// the projection is not linear (a plain affine over all 23 markers to Venice, Ancona, Budapest and Podgorica leaves
// 2.5 px RMS), so only the markers within about 250 km of Zagreb are used: the fit is local, for a crop around Zagreb.
// The script refuses to write a fit of fewer than 3 landmarks, an RMS over 3 px or a worst residual over 4 px.
//
// --check runs the same detection on a new image and exits 1 when its size differs or a stored landmark's diamond is
// more than 2 px further from where the stored affine puts it than the fit's own residual for it (DHMZ moved the
// map). The script makes no request.
//
// worker/feed/png.ts is TypeScript with no imports; esbuild (already a dependency, through vite) bundles it into a
// throwaway .mjs, as scripts/replay-twin.mjs does with its core.
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');

export const SOURCE_URL = 'https://vrijeme.hr/kompozit-stat.png';
export const OUTPUT_PATH = 'worker/data/radar-calibration.json';
/** A pixel is dark (a marker's outline, a label) when its channels sum under this. */
export const DARK_SUM = 120;
/** The map's rows: above is the title bar, below the colour scale (§0.5 P1). */
export const MAP_ROWS = [20, 714];
export const MAX_RMS_PX = 3;
export const MAX_RESIDUAL_PX = 4;
export const MATCH_PX = 4;
export const CHECK_PX = 2;
/** The near square (rainNear is counted in it) and the inset the route serves. */
export const NEAR = { centre: [15.98, 45.81], sideKm: 30 };
export const INSET_SIDE_PX = 120;
/** The rain rule of §0.2 (c), carried in the file so a retune is one number. */
export const RAIN = { minSpread: 100, maxMinChannel: 40, share: 0.02 };

/**
 * The city markers used: each city centre's coordinates and the pixel its diamond was read at on the composite of
 * 30 September 2026 (§0.5 P1), the label beside each confirmed by eye on the image of 1 October 02:04 UTC.
 */
export const LANDMARKS = [
  { name: 'Zagreb', label: 'ZG', lon: 15.9819, lat: 45.8150, near: [343, 227] },
  { name: 'Ljubljana', label: 'LJ', lon: 14.5058, lat: 46.0569, near: [225, 197] },
  { name: 'Graz', label: 'GZ', lon: 15.4395, lat: 47.0707, near: [301, 78] },
  { name: 'Maribor', label: 'MB', lon: 15.6459, lat: 46.5547, near: [320, 140] },
  { name: 'Karlovac', label: 'KA', lon: 15.5553, lat: 45.4929, near: [310, 262] },
  { name: 'Varaždin', label: 'VZ', lon: 16.3366, lat: 46.3057, near: [374, 170] },
  { name: 'Rijeka', label: 'RI', lon: 14.4422, lat: 45.3271, near: [220, 284] },
  { name: 'Banja Luka', label: 'BL', lon: 17.1910, lat: 44.7722, near: [446, 350] },
  { name: 'Požega', label: 'PZ', lon: 17.6850, lat: 45.3403, near: [482, 282] },
  { name: 'Koprivnica', label: 'KC', lon: 16.8275, lat: 46.1628, near: [414, 186] },
  { name: 'Krapina', label: 'KR', lon: 15.8789, lat: 46.1608, near: [336, 186] },
  { name: 'Virovitica', label: 'VT', lon: 17.3839, lat: 45.8319, near: [460, 224] },
];

function isDark(raster, x, y) {
  if (x < 0 || y < 0 || x >= raster.width || y >= raster.height) return false;
  const i = (y * raster.width + x) * 3;
  return raster.data[i] + raster.data[i + 1] + raster.data[i + 2] < DARK_SUM;
}

/**
 * Every diamond marker of the image: a pixel that is not dark, whose four tips at distance r (2, 3 or 4) are dark,
 * with no dark pixel strictly inside the diamond (|dx| + |dy| < r) and none two pixels beyond each tip. The
 * composite draws its diamonds with a two-pixel outline, so a marker is found at r 3 (its inner tips).
 */
export function findMarkers(raster, rows = MAP_ROWS) {
  const found = [];
  const [top, bottom] = rows;
  for (let y = Math.max(top, 0); y <= Math.min(bottom, raster.height - 1); y += 1) {
    for (let x = 0; x < raster.width; x += 1) {
      if (isDark(raster, x, y)) continue;
      for (const r of [2, 3, 4]) {
        const tips = [[x - r, y], [x + r, y], [x, y - r], [x, y + r]];
        if (!tips.every(([tx, ty]) => isDark(raster, tx, ty))) continue;
        const beyond = [[x - r - 2, y], [x + r + 2, y], [x, y - r - 2], [x, y + r + 2]];
        if (beyond.some(([tx, ty]) => isDark(raster, tx, ty))) continue;
        let clear = true;
        for (let dy = -r + 1; dy < r && clear; dy += 1) {
          for (let dx = -r + 1; dx < r && clear; dx += 1) {
            if (Math.abs(dx) + Math.abs(dy) < r && isDark(raster, x + dx, y + dy)) clear = false;
          }
        }
        if (!clear) continue;
        found.push({ x, y, r });
        break;
      }
    }
  }
  return found;
}

/** Solves the 3 × 3 system m·v = rhs by Cramer's rule; null when it is singular. */
function solve3(m, rhs) {
  const det = (a) => a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1]) - a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0]) + a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0]);
  const d = det(m);
  const scale = Math.max(...m.flat().map(Math.abs), 1);
  if (Math.abs(d) < 1e-9 * scale ** 3) return null;
  return [0, 1, 2].map((col) => det(m.map((row, i) => row.map((value, j) => (j === col ? rhs[i] : value)))) / d);
}

/**
 * The least-squares affine over landmarks `{ lon, lat, x, y }`: x = a·lon + b·lat + c and y = d·lon + e·lat + f, through
 * the normal equations (3 × 3, solved directly). Coordinates are taken about their mean so the system is well scaled.
 * Throws for fewer than 3 landmarks or collinear ones. Returns the six numbers, each landmark's residual, RMS and maximum.
 */
export function fitAffine(points) {
  if (points.length < 3) throw new Error(`radar-calibrate: ${points.length} landmarks, at least 3 are needed`);
  if (!points.every((p) => [p.lon, p.lat, p.x, p.y].every(Number.isFinite))) throw new Error('radar-calibrate: non-finite landmark');
  const mLon = points.reduce((s, p) => s + p.lon, 0) / points.length;
  const mLat = points.reduce((s, p) => s + p.lat, 0) / points.length;
  const rows = points.map((p) => [p.lon - mLon, p.lat - mLat, 1]);
  const normal = [0, 1, 2].map((i) => [0, 1, 2].map((j) => rows.reduce((s, r) => s + r[i] * r[j], 0)));
  const fitAxis = (values) => {
    const rhs = [0, 1, 2].map((i) => rows.reduce((s, r, k) => s + r[i] * values[k], 0));
    const v = solve3(normal, rhs);
    if (!v) throw new Error('radar-calibrate: the landmarks are collinear, no affine map is determined');
    // Back from centred coordinates: c' = c - a·mLon - b·mLat.
    return [v[0], v[1], v[2] - v[0] * mLon - v[1] * mLat];
  };
  const [a, b, c] = fitAxis(points.map((p) => p.x));
  const [d, e, f] = fitAxis(points.map((p) => p.y));
  const affine = [a, b, c, d, e, f];
  const residuals = points.map((p) => {
    const [x, y] = project(affine, p.lon, p.lat);
    return Math.hypot(x - p.x, y - p.y);
  });
  const rms = Math.sqrt(residuals.reduce((s, r) => s + r * r, 0) / residuals.length);
  if (![...affine, ...residuals, rms].every(Number.isFinite)) throw new Error('radar-calibrate: non-finite fit');
  return { affine, residuals, rms, max: Math.max(...residuals) };
}

export function project(affine, lon, lat) {
  const [a, b, c, d, e, f] = affine;
  return [a * lon + b * lat + c, d * lon + e * lat + f];
}

/** The landmarks matched to the detected marker nearest their `near` pixel, within MATCH_PX; the rest are named as missed. */
export function matchLandmarks(markers, landmarks = LANDMARKS) {
  const matched = [];
  const missed = [];
  for (const landmark of landmarks) {
    let best = null;
    for (const marker of markers) {
      const distance = Math.hypot(marker.x - landmark.near[0], marker.y - landmark.near[1]);
      if (distance <= MATCH_PX && (!best || distance < best.distance)) best = { marker, distance };
    }
    if (best) matched.push({ ...landmark, x: best.marker.x, y: best.marker.y });
    else missed.push(landmark.name);
  }
  return { matched, missed };
}

const round2 = (value) => Math.round(value * 100) / 100;

/** The near square (half side 15 km around NEAR.centre) through the affine, rounded outward; the inset around its centre. */
export function rectangles(affine, imageSize) {
  if (!Array.isArray(affine) || affine.length !== 6 || !affine.every(Number.isFinite)
    || !Array.isArray(imageSize) || imageSize.length !== 2 || !imageSize.every((n) => Number.isSafeInteger(n) && n > 0)) {
    throw new Error('radar-calibrate: invalid affine or image size');
  }
  const bottom = Math.min(MAP_ROWS[1], imageSize[1] - 1);
  if (imageSize[0] < INSET_SIDE_PX || bottom - MAP_ROWS[0] + 1 < INSET_SIDE_PX) throw new Error('radar-calibrate: image too small for inset');
  const [lon, lat] = NEAR.centre;
  const half = NEAR.sideKm / 2;
  const dLat = half / 111.32;
  const dLon = half / (111.32 * Math.cos((lat * Math.PI) / 180));
  const corners = [[lon - dLon, lat + dLat], [lon + dLon, lat + dLat], [lon + dLon, lat - dLat], [lon - dLon, lat - dLat]]
    .map(([x, y]) => project(affine, x, y));
  const xs = corners.map(([x]) => x);
  const ys = corners.map(([, y]) => y);
  const near = [Math.floor(Math.min(...xs)), Math.floor(Math.min(...ys)), Math.ceil(Math.max(...xs)), Math.ceil(Math.max(...ys))];
  if (!near.every(Number.isSafeInteger) || near[0] < 0 || near[1] < MAP_ROWS[0] || near[2] >= imageSize[0] || near[3] > bottom) {
    throw new Error('radar-calibrate: near square outside map');
  }
  const [cx, cy] = project(affine, lon, lat);
  const clamp = (value, low, high) => Math.min(Math.max(value, low), high);
  const x0 = clamp(Math.round(cx) - INSET_SIDE_PX / 2, 0, imageSize[0] - INSET_SIDE_PX);
  const y0 = clamp(Math.round(cy) - INSET_SIDE_PX / 2, MAP_ROWS[0], bottom - INSET_SIDE_PX + 1);
  const inset = [x0, y0, x0 + INSET_SIDE_PX - 1, y0 + INSET_SIDE_PX - 1];
  if (near[0] < inset[0] || near[1] < inset[1] || near[2] > inset[2] || near[3] > inset[3]) throw new Error('radar-calibrate: near square outside inset');
  const bounds = { west: lon - dLon, east: lon + dLon, north: lat + dLat, south: lat - dLat };
  return { near, inset, bounds };
}

/** The calibration file's object from an image's raster (throws when the fit fails its limits). */
export function calibrate(raster, { derivedAt, imageLastModified }) {
  const markers = findMarkers(raster);
  const { matched, missed } = matchLandmarks(markers);
  const fit = fitAffine(matched);
  if (fit.rms > MAX_RMS_PX || fit.max > MAX_RESIDUAL_PX) {
    throw new Error(`radar-calibrate: residuals too large (RMS ${fit.rms.toFixed(2)} px, max ${fit.max.toFixed(2)} px)`);
  }
  const imageSize = [raster.width, raster.height];
  const { near, inset } = rectangles(fit.affine, imageSize);
  return {
    file: {
      version: 1,
      source: SOURCE_URL,
      imageSize,
      affine: fit.affine.map((value) => Math.round(value * 1e4) / 1e4),
      landmarks: matched.map((landmark, i) => ({ name: landmark.name, lon: landmark.lon, lat: landmark.lat, x: landmark.x, y: landmark.y, residualPx: round2(fit.residuals[i]) })),
      residualPx: round2(fit.rms),
      residualMaxPx: round2(fit.max),
      method: 'least squares, x = a·lon + b·lat + c and y = d·lon + e·lat + f, over the diamond city markers the composite draws within 250 km of Zagreb',
      derivedAt,
      imageLastModified,
      near: { centre: NEAR.centre, sideKm: NEAR.sideKm, rect: near },
      inset: { sidePx: INSET_SIDE_PX, rect: inset },
      rain: RAIN,
    },
    markers,
    missed,
  };
}

/** --check: the reasons a new image does not agree with a stored calibration (empty when it does). */
export function checkCalibration(raster, stored) {
  const problems = [];
  try {
    if (stored?.version !== 1 || ![stored.residualPx, stored.residualMaxPx].every((n) => Number.isFinite(n) && n >= 0)
      || stored.residualPx > MAX_RMS_PX || stored.residualMaxPx > MAX_RESIDUAL_PX
      || !Array.isArray(stored.landmarks) || stored.landmarks.length < 3
      || !stored.landmarks.every((p) => [p.lon, p.lat, p.x, p.y, p.residualPx].every(Number.isFinite) && p.residualPx >= 0 && p.residualPx <= MAX_RESIDUAL_PX)) {
      throw new Error('invalid stored landmarks');
    }
    const expected = rectangles(stored.affine, stored.imageSize);
    if (JSON.stringify(stored.near?.centre) !== JSON.stringify(NEAR.centre) || stored.near?.sideKm !== NEAR.sideKm
      || stored.inset?.sidePx !== INSET_SIDE_PX || JSON.stringify(stored.near?.rect) !== JSON.stringify(expected.near)
      || JSON.stringify(stored.inset?.rect) !== JSON.stringify(expected.inset)) throw new Error('stored crop geometry disagrees with affine');
  } catch (error) { return [`invalid calibration: ${error instanceof Error ? error.message : error}`]; }
  if (raster.width !== stored.imageSize[0] || raster.height !== stored.imageSize[1]) {
    problems.push(`image size ${raster.width} × ${raster.height}, the calibration's ${stored.imageSize[0]} × ${stored.imageSize[1]}`);
    return problems;
  }
  const markers = findMarkers(raster);
  for (const landmark of stored.landmarks) {
    const [x, y] = project(stored.affine, landmark.lon, landmark.lat);
    const nearest = markers.reduce((best, m) => Math.min(best, Math.hypot(m.x - x, m.y - y)), Infinity);
    // The existing residual-plus-CHECK_PX envelope is radial error from the affine, not a bound on marker
    // displacement from the saved image. Its difference from the package's literal 2 px check needs a decision.
    const allowed = landmark.residualPx + CHECK_PX;
    if (nearest > allowed) problems.push(`${landmark.name}: no marker within ${allowed.toFixed(2)} px of ${x.toFixed(1)}, ${y.toFixed(1)} (nearest ${nearest.toFixed(1)} px)`);
  }
  return problems;
}

async function loadPng() {
  const { build } = await import('esbuild');
  const dir = await mkdtemp(join(tmpdir(), 'radar-calibrate-'));
  const outfile = join(dir, 'png.mjs');
  try {
    await build({ entryPoints: [join(repoRoot, 'worker/feed/png.ts')], outfile, bundle: true, platform: 'node', format: 'esm', target: 'node22', logLevel: 'silent' });
    return await import(pathToFileURL(outfile).href);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function args(argv) {
  const out = { image: undefined, out: OUTPUT_PATH, check: false, lastModified: undefined };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--image') out.image = argv[++i];
    else if (argv[i] === '--out') out.out = argv[++i];
    else if (argv[i] === '--check') out.check = true;
    else if (argv[i] === '--last-modified') out.lastModified = argv[++i];
    else throw new Error(`radar-calibrate: unknown argument ${argv[i]}`);
  }
  if (!out.image) throw new Error('radar-calibrate: --image <png> is required');
  return out;
}

/** The Last-Modified of a saved composite, from its file name `kompozit-YYYYMMDDTHHMMSSZ.png`. */
export function stampOf(path) {
  const match = /kompozit-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/.exec(path);
  return match ? `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}Z` : undefined;
}

export async function main(argv = process.argv.slice(2)) {
  const options = args(argv);
  const { decodePng } = await loadPng();
  const raster = await decodePng(new Uint8Array(await readFile(resolve(options.image))));
  if (options.check) {
    const stored = JSON.parse(await readFile(resolve(repoRoot, options.out), 'utf8'));
    const problems = checkCalibration(raster, stored);
    for (const problem of problems) console.error(problem);
    console.log(problems.length === 0 ? `calibration holds on ${options.image}` : `calibration does not hold on ${options.image}`);
    return problems.length === 0 ? 0 : 1;
  }
  const imageLastModified = options.lastModified ?? stampOf(options.image);
  if (!imageLastModified) throw new Error('radar-calibrate: name the image kompozit-<stamp>.png or pass --last-modified <ISO>');
  const { file, markers, missed } = calibrate(raster, { derivedAt: new Date().toISOString(), imageLastModified });
  console.log(`markers found: ${markers.length}; landmarks matched: ${file.landmarks.length}${missed.length ? `; missed: ${missed.join(', ')}` : ''}`);
  for (const landmark of file.landmarks) console.log(`  ${landmark.name.padEnd(12)} ${landmark.x},${landmark.y} residual ${landmark.residualPx} px`);
  console.log(`RMS ${file.residualPx} px, max ${file.residualMaxPx} px; near ${file.near.rect.join(',')}; inset ${file.inset.rect.join(',')}`);
  await writeFile(resolve(repoRoot, options.out), `${JSON.stringify(file, null, 2)}\n`);
  console.log(`wrote ${options.out}`);
  return 0;
}

const invokedDirectly = typeof process.argv[1] === 'string' && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invokedDirectly) {
  main().then((code) => process.exit(code), (error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
