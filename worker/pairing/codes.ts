// Rotating pairing codes: 8 Crockford base32 symbols (40 bits) shown as
// ABCD-EFGH. `byte % 32` is unbiased because 256 is a multiple of 32.
import {
  CODE_ALPHABET,
  CODE_DISPLAY_SPLIT,
  CODE_EARLY_MS,
  CODE_GRACE_MS,
  CODE_LENGTH,
  type CodeSlot,
} from '../protocol';

/** Longest raw input normalizeCode will look at; a code with separators is 9 chars. */
const NORMALIZE_MAX_INPUT = 64;
const SEPARATORS = /[\s\-_.·]/g;

export function randomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) out += CODE_ALPHABET[bytes[i]! % 32];
  return out;
}

export function formatCode(code: string): string {
  return `${code.slice(0, CODE_DISPLAY_SPLIT)}-${code.slice(CODE_DISPLAY_SPLIT)}`;
}

/**
 * Coerce typed, pasted or scanned input into a bare code. Uppercases, drops
 * separators and spaces, maps the Crockford look-alikes (I, L -> 1; O -> 0),
 * then requires exactly CODE_LENGTH alphabet symbols. U is not an alias of
 * anything and is rejected like any foreign character.
 */
export function normalizeCode(raw: string): string | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > NORMALIZE_MAX_INPUT) return null;
  const compact = raw
    .toUpperCase()
    .replace(SEPARATORS, '')
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0');
  if (compact.length !== CODE_LENGTH) return null;
  for (const ch of compact) if (!CODE_ALPHABET.includes(ch)) return null;
  return compact;
}

/** The start of the slot containing nowMs, so every kiosk rotates on the same wall-clock boundaries. */
export function alignSlotStart(nowMs: number, slotMs: number): number {
  return Math.floor(nowMs / slotMs) * slotMs;
}

export function mintBatch(startMs: number, slotMs: number, count: number): CodeSlot[] {
  if (!Number.isInteger(slotMs) || slotMs <= 0) throw new Error('mintBatch: slotMs must be a positive integer');
  if (!Number.isInteger(count) || count <= 0) throw new Error('mintBatch: count must be a positive integer');
  const batch: CodeSlot[] = [];
  const used = new Set<string>();
  for (let i = 0; i < count; i += 1) {
    let code = randomCode();
    while (used.has(code)) code = randomCode();
    used.add(code);
    const slotStart = startMs + i * slotMs;
    batch.push({ code, slotStart, slotEnd: slotStart + slotMs });
  }
  return batch;
}

export function codeWindow(
  slot: { slotStart: number; slotEnd: number },
  nowMs: number,
): 'early' | 'open' | 'late' {
  if (nowMs < slot.slotStart - CODE_EARLY_MS) return 'early';
  if (nowMs > slot.slotEnd + CODE_GRACE_MS) return 'late';
  return 'open';
}
