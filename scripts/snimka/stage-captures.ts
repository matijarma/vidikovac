// Stage `captures` (lane S1): the observer's screenshots of the public screen
// (kiosk 1920x1080) and of the phone's Sada view, re-encoded for the page:
// kiosk 1280 wide, phone 540 wide, WebP quality 78. The kiosk's pairing card
// carries a QR and the code beside it, which must never be published even
// expired: the QR is located with jsQR and blurred together with the code
// line, then the whole image is decoded again and must yield no code. A capture
// where no QR is located gets the card's measured region blurred instead and
// is named in the log for a check by eye (acceptance SN-6). On the kiosk's
// 1920x1080 layout the whole measured card is blurred with the located QR.

import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import jsQR from 'jsqr';
import type sharpModule from 'sharp';
import type { HashedRef } from '../../shared/snimka';
import type { ScreenWork } from './stage-screen';
import { readWork, sha256, writeObject, writeWork, type Paths } from './paths';

export const KIOSK_WIDTH = 1280;
export const PHONE_WIDTH = 540;
export const WEBP_QUALITY = 78;
/** The pairing card of the 1920x1080 kiosk (measured on the strike captures): QR at the left, the code to its right. */
export const KIOSK_CARD = { left: 1216, top: 668, width: 680, height: 324 };

export interface CaptureWork { kiosk: HashedRef | null; phone: HashedRef | null; kioskCode: 'located' | 'fallback' | null; phoneCode: 'located' | null }

type Sharp = typeof sharpModule;
interface Region { left: number; top: number; width: number; height: number }

function decodeQr(rgba: Buffer, width: number, height: number): { region: Region } | null {
  const found = jsQR(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.length), width, height, { inversionAttempts: 'attemptBoth' });
  if (!found) return null;
  const { topLeftCorner: a, topRightCorner: b, bottomLeftCorner: c, bottomRightCorner: d } = found.location;
  const minX = Math.min(a.x, b.x, c.x, d.x);
  const maxX = Math.max(a.x, b.x, c.x, d.x);
  const minY = Math.min(a.y, b.y, c.y, d.y);
  const maxY = Math.max(a.y, b.y, c.y, d.y);
  const size = Math.max(maxX - minX, maxY - minY);
  // The quiet zone around the QR, and the code line that sits to its right (up to 1.7 QR widths).
  const left = Math.max(0, Math.floor(minX - 0.12 * size));
  const top = Math.max(0, Math.floor(minY - 0.12 * size));
  const right = Math.min(width, Math.ceil(maxX + 1.7 * size));
  const bottom = Math.min(height, Math.ceil(maxY + 0.12 * size));
  return { region: { left, top, width: right - left, height: bottom - top } };
}

async function blurRegion(sharp: Sharp, png: Buffer, region: Region): Promise<Buffer> {
  const small = await sharp(png).extract(region).resize(Math.max(1, Math.round(region.width / 14)), Math.max(1, Math.round(region.height / 14))).toBuffer();
  const patch = await sharp(small).resize(region.width, region.height, { kernel: 'cubic' }).blur(10).toBuffer();
  return sharp(png).composite([{ input: patch, left: region.left, top: region.top }]).png().toBuffer();
}

function union(a: Region, b: Region): Region {
  const left = Math.min(a.left, b.left);
  const top = Math.min(a.top, b.top);
  return { left, top, width: Math.max(a.left + a.width, b.left + b.width) - left, height: Math.max(a.top + a.height, b.top + b.height) - top };
}

async function rgbaOf(sharp: Sharp, png: Buffer): Promise<{ data: Buffer; width: number; height: number }> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

/** One capture made safe and encoded: the code located and blurred (or the fallback region), checked to decode to nothing. */
async function prepare(sharp: Sharp, file: string, width: number, fallback: Region | null): Promise<{ webp: Buffer; code: 'located' | 'fallback' | null }> {
  let png = await sharp(file).png().toBuffer();
  const raw = await rgbaOf(sharp, png);
  const qr = decodeQr(raw.data, raw.width, raw.height);
  let code: 'located' | 'fallback' | null = null;
  const card = fallback && raw.width === 1920 && raw.height === 1080 ? fallback : null;
  if (qr) {
    // On the kiosk's own layout the whole card goes too: the code line is wider than any margin around the QR.
    png = await blurRegion(sharp, png, card ? union(qr.region, card) : qr.region);
    code = 'located';
  } else if (card) {
    png = await blurRegion(sharp, png, card);
    code = 'fallback';
  }
  const after = await rgbaOf(sharp, png);
  if (decodeQr(after.data, after.width, after.height)) throw new Error(`captures: ${file} still decodes a QR after blurring`);
  const webp = await sharp(png).resize({ width, withoutEnlargement: true }).webp({ quality: WEBP_QUALITY }).toBuffer();
  const small = await rgbaOf(sharp, await sharp(webp).png().toBuffer());
  if (decodeQr(small.data, small.width, small.height)) throw new Error(`captures: ${file} decodes a QR at ${width} px`);
  return { webp, code };
}

export async function stageCaptures(paths: Paths, log: (line: string) => void): Promise<boolean> {
  const sharp = createRequire(join(paths.repo, 'package.json'))('sharp') as Sharp;
  const screen = readWork<ScreenWork>(paths, 'screen-runs.json');
  const out: Record<string, CaptureWork> = {};
  const byEye: string[] = [];
  let kiosks = 0;
  let phones = 0;
  for (const run of screen.runs) {
    const dir = join(paths.inputs, 'strike', run.dir, 'captures');
    const entry: CaptureWork = { kiosk: null, phone: null, kioskCode: null, phoneCode: null };
    const kioskFile = join(dir, 'kiosk-1920x1080.png');
    if (existsSync(kioskFile)) {
      const { webp, code } = await prepare(sharp, kioskFile, KIOSK_WIDTH, KIOSK_CARD);
      entry.kiosk = writeObject(paths, `captures/${run.id}-kiosk`, 'webp', webp);
      entry.kioskCode = code;
      kiosks++;
      if (code !== 'located') byEye.push(`${run.dir}/captures/kiosk-1920x1080.png (${code ?? 'no code and no fallback'}, ${sha256(webp).slice(0, 16)})`);
    }
    const phoneFile = join(dir, 'phone-sada.png');
    if (existsSync(phoneFile)) {
      const { webp, code } = await prepare(sharp, phoneFile, PHONE_WIDTH, null);
      entry.phone = writeObject(paths, `captures/${run.id}-phone`, 'webp', webp);
      entry.phoneCode = code === 'located' ? 'located' : null;
      phones++;
    }
    out[run.id] = entry;
  }
  writeWork(paths, 'captures.json', { runs: out, byEye });
  for (const line of byEye) log(`captures: no code located, the card region blurred instead; check by eye: ${line}`);
  log(`captures: ${kiosks} kiosk and ${phones} phone captures, ${kiosks - byEye.length} kiosk codes located and blurred, ${byEye.length} to check by eye`);
  return true;
}
