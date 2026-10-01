import type { FetchContext } from '../schema';
import type { FeedPayload } from '../payload';
import { cropRaster, decodePng, encodePng, PNG_MAX_BYTES, type RasterRgb } from '../png';
import calibrationFile from '../../data/radar-calibration.json' with { type: 'json' };

// DHMZ's radar composite, https://vrijeme.hr/kompozit-stat.png (Otvorena dozvola, "Izvor: DHMZ"), read for one fact:
// whether rain is near Zagreb now (docs/reveal-2026-10-plan/R3.md §0.2 (c)). The image is 720 × 751 px, about 1 km a
// pixel around Zagreb; worker/data/radar-calibration.json (scripts/radar-calibrate.mjs, fitted on the city markers the
// composite draws) names the 30 km square around the city (`near.rect`) and the 120-pixel inset the route serves
// (`inset.rect`). A pixel is rain when it is a colour of DHMZ's scale: every scale colour spreads its channels by 130 or
// more with a smallest channel of 36 or less, while the relief, the sea, the borders and the labels spread under 100.
//
// Nothing here ever says "no rain": an image that fails to decode, has another size or is more than 30 minutes old
// throws (the registry then serves the last good copy as stale and goes down), and the item itself lasts 10 minutes.
// The composite is fetched with If-Modified-Since against an isolate memo, which the image route shares, so within one
// isolate the module and the route download each composite once.

export const RADAR_URL = 'https://vrijeme.hr/kompozit-stat.png';
/** An image older than this at fetch time is not read (D-C). */
export const RADAR_MAX_AGE_MS = 30 * 60_000;
/** How long one radar item stands. */
export const RADAR_ITEM_MS = 10 * 60_000;
export const RADAR_IMAGE_PATH = '/api/radar/zagreb.png';

export type Rect = readonly [x0: number, y0: number, x1: number, y1: number];
export interface RainRule { minSpread: number; maxMinChannel: number; share: number }
export interface RadarCalibration {
  version: number;
  imageSize: readonly [number, number];
  affine: readonly number[];
  near: { centre: readonly [number, number]; sideKm: number; rect: Rect };
  inset: { sidePx: number; rect: Rect };
  rain: RainRule;
}

export const CALIBRATION = calibrationFile as unknown as RadarCalibration;

/** A pixel is rain when its channels spread by at least minSpread and its smallest channel is at most maxMinChannel. */
export function isRainPixel(r: number, g: number, b: number, rule: RainRule): boolean {
  const low = Math.min(r, g, b);
  return Math.max(r, g, b) - low >= rule.minSpread && low <= rule.maxMinChannel;
}

/** The rain pixels inside an inclusive rectangle. */
export function rainCells(raster: RasterRgb, rect: Rect, rule: RainRule): number {
  const [x0, y0, x1, y1] = rect;
  let count = 0;
  for (let y = Math.max(0, y0); y <= Math.min(raster.height - 1, y1); y += 1) {
    for (let x = Math.max(0, x0); x <= Math.min(raster.width - 1, x1); x += 1) {
      const i = (y * raster.width + x) * 3;
      if (isRainPixel(raster.data[i]!, raster.data[i + 1]!, raster.data[i + 2]!, rule)) count += 1;
    }
  }
  return count;
}

/** rainNear = rainCells ≥ ceil(share × pixels of rect). */
export function radarFacts(raster: RasterRgb, calibration: RadarCalibration): { rainNear: boolean; rainCells: number } {
  const [x0, y0, x1, y1] = calibration.near.rect;
  const cells = rainCells(raster, calibration.near.rect, calibration.rain);
  const threshold = Math.ceil(calibration.rain.share * (x1 - x0 + 1) * (y1 - y0 + 1));
  return { rainNear: cells >= threshold, rainCells: cells };
}

/** Width and height from the IHDR, which the PNG format puts first (the decoder may read only the top rows). */
function pngSize(bytes: Uint8Array): [number, number] {
  if (bytes.length < 24) throw new Error('dhmz-radar: not a PNG');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return [view.getUint32(16), view.getUint32(20)];
}

/** The checks of D-C, before any decode: the image is fresh and has the calibrated size. */
export function radarTimestamp(lastModified: string, now: Date): number {
  const at = Date.parse(lastModified);
  if (!Number.isFinite(at)) throw new Error(`dhmz-radar: unreadable Last-Modified ${lastModified}`);
  if (!Number.isFinite(now.getTime()) || at > now.getTime()) throw new Error('dhmz-radar: future composite or invalid clock');
  if (now.getTime() - at > RADAR_MAX_AGE_MS) throw new Error(`dhmz-radar: composite of ${new Date(at).toISOString()} is over 30 minutes old`);
  return at;
}

function checkComposite(bytes: Uint8Array, lastModified: string, now: Date, calibration: RadarCalibration): number {
  const at = radarTimestamp(lastModified, now);
  const [width, height] = pngSize(bytes);
  if (width !== calibration.imageSize[0] || height !== calibration.imageSize[1]) {
    throw new Error(`dhmz-radar: composite is ${width} × ${height}, the calibration's ${calibration.imageSize.join(' × ')}`);
  }
  return at;
}

/** The near square's corners in lon/lat: west-north, east-north, east-south, west-south, west-north. */
function nearPolygon(calibration: RadarCalibration): number[][][] {
  const [lon, lat] = calibration.near.centre;
  const half = calibration.near.sideKm / 2;
  const dLat = half / 111.32;
  const dLon = half / (111.32 * Math.cos((lat * Math.PI) / 180));
  const r = (value: number) => Math.round(value * 1e4) / 1e4;
  const [w, e, n, s] = [r(lon - dLon), r(lon + dLon), r(lat + dLat), r(lat - dLat)];
  return [[[w, n], [e, n], [e, s], [w, s], [w, n]]];
}

/** One composite to the module's payload: one item, whether rain is near Zagreb in that image. */
export async function parseRadar(bytes: Uint8Array, lastModified: string, now: Date, calibration: RadarCalibration = CALIBRATION): Promise<FeedPayload> {
  const at = checkComposite(bytes, lastModified, now, calibration);
  const raster = await decodePng(bytes, { rows: calibration.near.rect[3] + 1 });
  const facts = radarFacts(raster, calibration);
  const iso = new Date(at).toISOString();
  return {
    sourceUpdatedAt: iso,
    items: [{
      id: `dhmz-radar:${Math.floor(at / 1000)}`,
      kind: 'radar',
      title: 'Radar DHMZ, Zagreb',
      at: iso,
      dateBasis: 'observed',
      until: new Date(at + RADAR_ITEM_MS).toISOString(),
      geo: { type: 'Polygon', coordinates: nearPolygon(calibration) },
      data: { rainNear: facts.rainNear, rainCells: facts.rainCells, crop: 'zagreb', image: RADAR_IMAGE_PATH },
    }],
  };
}

interface Composite { lastModified: string; bytes: Uint8Array }

/** The isolate's last composite; the module and the image route share it. */
let memo: Composite | null = null;
/** The last payload is tied to the actual composite object: only a 304 can reuse it without decoding. */
let parsed: { composite: Composite; payload: FeedPayload } | null = null;
let pending: Promise<Composite> | null = null;

/** Test seam: forget the isolate memo. */
export function resetRadarMemo(): void {
  memo = null;
  parsed = null;
  pending = null;
}

/** The newest composite: If-Modified-Since against the memo; a 304 returns the memo, a 200 must carry Last-Modified. */
export async function latestComposite(ctx: FetchContext): Promise<Composite> {
  if (pending) return pending;
  const base = memo;
  const request = downloadComposite(ctx, base);
  pending = request;
  try { return await request; } finally { if (pending === request) pending = null; }
}

async function downloadComposite(ctx: FetchContext, base: Composite | null): Promise<Composite> {
  const response = await ctx.fetch(RADAR_URL, base ? { headers: { 'if-modified-since': base.lastModified } } : undefined);
  if (response.status === 304) {
    if (!base) throw new Error('dhmz-radar: 304 without a composite in hand');
    return base;
  }
  if (response.status !== 200) throw new Error(`dhmz-radar: upstream ${response.status}`);
  const lastModified = response.headers.get('last-modified');
  if (!lastModified) throw new Error('dhmz-radar: the composite came without Last-Modified');
  radarTimestamp(lastModified, ctx.now());
  const reader = response.body?.getReader();
  if (!reader) throw new Error('dhmz-radar: empty composite');
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > PNG_MAX_BYTES) throw new Error('dhmz-radar: composite too large');
      parts.push(value);
    }
  } finally { await reader.cancel().catch(() => undefined); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  checkComposite(bytes, lastModified, ctx.now(), CALIBRATION);
  memo = { lastModified, bytes };
  return memo;
}

export async function fetchDhmzRadar(ctx: FetchContext): Promise<FeedPayload> {
  const composite = await latestComposite(ctx);
  if (parsed && parsed.composite === composite) {
    // Same image: only its age is judged again.
    checkComposite(composite.bytes, composite.lastModified, ctx.now(), CALIBRATION);
    return parsed.payload;
  }
  try {
    const payload = await parseRadar(composite.bytes, composite.lastModified, ctx.now());
    parsed = { composite, payload };
    return payload;
  } catch (error) {
    if (memo === composite) memo = null; // Do not condition the next request on a body that failed validation.
    throw error;
  }
}

/** The image route's body: the 120-pixel crop around Zagreb, as a PNG, with the composite's Last-Modified. Throws on any failure (D-C). */
export async function radarCrop(ctx: FetchContext): Promise<{ png: Uint8Array; lastModified: string }> {
  const composite = await latestComposite(ctx);
  checkComposite(composite.bytes, composite.lastModified, ctx.now(), CALIBRATION);
  try {
    const raster = await decodePng(composite.bytes, { rows: CALIBRATION.inset.rect[3] + 1 });
    return { png: await encodePng(cropRaster(raster, CALIBRATION.inset.rect)), lastModified: composite.lastModified };
  } catch (error) {
    if (memo === composite) memo = null;
    throw error;
  }
}
