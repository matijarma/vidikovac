// Typed and scanned codes. Alphabet and lengths come from the shared contract
// so the phone can never accept a shape the Worker rejects.
import { CODE_ALPHABET, CODE_DISPLAY_SPLIT, CODE_LENGTH } from '../../worker/protocol';

const ALPHABET = new Set(CODE_ALPHABET.split(''));
export const CODE_URL_BASE = 'https://zagreb.aningfilm.hr';

/** Lossy and infallible: what a person typed, pasted or read aloud → code characters. */
export function normalizeCode(raw: string): string {
  let out = '';
  for (const ch of raw.toUpperCase()) {
    const mapped = ch === 'I' || ch === 'L' ? '1' : ch === 'O' ? '0' : ch;
    if (ALPHABET.has(mapped)) out += mapped;
    if (out.length === CODE_LENGTH) break;
  }
  return out;
}

export function formatCode(raw: string): string {
  const code = normalizeCode(raw);
  return code.length > CODE_DISPLAY_SPLIT
    ? `${code.slice(0, CODE_DISPLAY_SPLIT)}-${code.slice(CODE_DISPLAY_SPLIT)}`
    : code;
}

export function isCompleteCode(raw: string): boolean {
  return normalizeCode(raw).length === CODE_LENGTH;
}

/** The code inside one of OUR QR payloads (any host, path /s or /s/), or a bare complete code; else null. */
export function codeFromScan(payload: string): string | null {
  const value = payload.trim();
  if (!value) return null;
  let candidate = value;
  let parsed: URL | null = null;
  try { parsed = new URL(value); } catch { parsed = null; }
  if (parsed) {
    if (!/^\/s\/?$/.test(parsed.pathname)) return null;
    candidate = decodeURIComponent(parsed.hash.replace(/^#/, ''));
    if (candidate.startsWith('code=')) candidate = candidate.slice('code='.length);
  }
  const code = normalizeCode(candidate);
  return code.length === CODE_LENGTH ? code : null;
}

export function codeUrl(code: string, base: string = CODE_URL_BASE): string {
  return `${base.replace(/\/$/, '')}/s#${formatCode(code)}`;
}

/** "A B C D, E F G H" — for aria-labels and the kiosk's read-aloud button. */
export function speakableCode(raw: string): string {
  const code = normalizeCode(raw);
  const groups = [code.slice(0, CODE_DISPLAY_SPLIT), code.slice(CODE_DISPLAY_SPLIT)].filter(Boolean);
  return groups.map((g) => g.split('').join(' ')).join(', ');
}
