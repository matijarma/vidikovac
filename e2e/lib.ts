// Pure helpers for the Playwright tier. No Playwright import here so vitest can
// cover them in node; e2e/helpers.ts wraps them with page-level actions.
import { CODE_ALPHABET, CODE_DISPLAY_SPLIT, CODE_LENGTH } from '../worker/protocol';

const group = `[${CODE_ALPHABET}]{${CODE_DISPLAY_SPLIT}}`;
/** ABCD-EFGH in the Crockford alphabet (0-9, A-Z without I, L, O, U). */
export const CODE_RE = new RegExp(`^${group}-${group}$`);
if (CODE_DISPLAY_SPLIT * 2 !== CODE_LENGTH) throw new Error('CODE_RE assumes two groups of CODE_DISPLAY_SPLIT');

/** Same path, query and fragment on another origin (kiosk and QR URLs are minted for production). */
export function rebaseUrl(url: string, base: string): string {
  const from = new URL(url);
  const to = new URL(base);
  return `${to.origin}${from.pathname}${from.search}${from.hash}`;
}

/** `/kiosk/#<beaconId>.<secret>` from a CreateBeaconResponse.provisionUrl, on the target origin. */
export function kioskUrl(provisionUrl: string, base: string): string {
  const hash = new URL(provisionUrl).hash;
  if (!/^#[^.]+\.[^.]+$/.test(hash)) throw new Error(`provisionUrl lacks a beaconId.secret fragment: ${provisionUrl}`);
  return `${new URL(base).origin}/kiosk/${hash}`;
}

/** Minimal .dev.vars reader: KEY=VALUE per line, optional quotes, # comments. */
export function parseDevVars(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}
