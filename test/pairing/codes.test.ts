import { describe, expect, it } from 'vitest';
import {
  CODE_ALPHABET,
  CODE_EARLY_MS,
  CODE_GRACE_MS,
  CODE_LENGTH,
  CODES_PER_BATCH,
} from '../../worker/protocol';
import {
  alignSlotStart,
  codeWindow,
  formatCode,
  mintBatch,
  normalizeCode,
  randomCode,
} from '../../worker/pairing/codes';

describe('randomCode', () => {
  it('mints 8 characters from the Crockford alphabet, never I L O U', () => {
    for (let i = 0; i < 500; i += 1) {
      const code = randomCode();
      expect(code).toHaveLength(CODE_LENGTH);
      for (const ch of code) expect(CODE_ALPHABET.includes(ch)).toBe(true);
      expect(code).not.toMatch(/[ILOU]/);
    }
  });

  it('is not obviously repeating', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i += 1) seen.add(randomCode());
    expect(seen.size).toBe(200);
  });
});

describe('formatCode', () => {
  it('splits into two groups of four', () => {
    expect(formatCode('ABCDEFGH')).toBe('ABCD-EFGH');
  });
});

describe('normalizeCode', () => {
  it('accepts the display form and returns the bare code', () => {
    expect(normalizeCode('ABCD-EFGH')).toBe('ABCDEFGH');
  });
  it('uppercases and strips spaces, hyphens, dots and underscores', () => {
    expect(normalizeCode(' ab cd_ef.gh ')).toBe('ABCDEFGH');
  });
  it('maps I and L to 1 and O to 0', () => {
    expect(normalizeCode('IL0O-1lo1')).toBe('11001101');
  });
  it('rejects wrong length', () => {
    expect(normalizeCode('ABCDEFG')).toBeNull();
    expect(normalizeCode('ABCDEFGHJ')).toBeNull();
    expect(normalizeCode('')).toBeNull();
  });
  it('rejects U and any character outside the alphabet', () => {
    expect(normalizeCode('ABCDEFGU')).toBeNull();
    expect(normalizeCode('ABCDEFG!')).toBeNull();
    expect(normalizeCode('ABCDEFGŠ')).toBeNull();
  });
  it('rejects absurdly long input without scanning it all', () => {
    expect(normalizeCode('A'.repeat(10_000))).toBeNull();
  });
});

describe('alignSlotStart and mintBatch', () => {
  it('aligns to the wall-clock slot boundary', () => {
    expect(alignSlotStart(1_000_030_500, 30_000)).toBe(1_000_020_000);
    expect(alignSlotStart(1_000_020_000, 30_000)).toBe(1_000_020_000);
  });
  it('mints contiguous slots of the requested size with unique codes', () => {
    const batch = mintBatch(1_000_020_000, 30_000, CODES_PER_BATCH);
    expect(batch).toHaveLength(CODES_PER_BATCH);
    expect(batch[0]!.slotStart).toBe(1_000_020_000);
    expect(batch[0]!.slotEnd).toBe(1_000_050_000);
    for (let i = 1; i < batch.length; i += 1) {
      expect(batch[i]!.slotStart).toBe(batch[i - 1]!.slotEnd);
      expect(batch[i]!.slotEnd - batch[i]!.slotStart).toBe(30_000);
    }
    expect(new Set(batch.map((s) => s.code)).size).toBe(CODES_PER_BATCH);
  });
  it('rejects non-positive sizes', () => {
    expect(() => mintBatch(0, 0, 1)).toThrow();
    expect(() => mintBatch(0, 30_000, 0)).toThrow();
  });
});

describe('codeWindow', () => {
  const slot = { slotStart: 100_000, slotEnd: 130_000 };
  it('is early before slotStart - CODE_EARLY_MS', () => {
    expect(codeWindow(slot, 100_000 - CODE_EARLY_MS - 1)).toBe('early');
  });
  it('is open from slotStart - CODE_EARLY_MS to slotEnd + CODE_GRACE_MS inclusive', () => {
    expect(codeWindow(slot, 100_000 - CODE_EARLY_MS)).toBe('open');
    expect(codeWindow(slot, 115_000)).toBe('open');
    expect(codeWindow(slot, 130_000 + CODE_GRACE_MS)).toBe('open');
  });
  it('is late after slotEnd + CODE_GRACE_MS', () => {
    expect(codeWindow(slot, 130_000 + CODE_GRACE_MS + 1)).toBe('late');
  });
});
