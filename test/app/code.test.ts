import { describe, expect, it } from 'vitest';
import { codeFromScan, codeUrl, formatCode, isCompleteCode, normalizeCode, speakableCode } from '../../app/src/code';

describe('code helpers (Crockford base32, 8 chars, ABCD-EFGH)', () => {
  it('uppercases, maps I/L to 1 and O to 0, drops U and punctuation, caps at 8', () => {
    expect(normalizeCode('abcd-efgh')).toBe('ABCDEFGH');
    expect(normalizeCode('il0o-1l9x')).toBe('1100119X');
    expect(normalizeCode('uuABCDuu EFGHJK')).toBe('ABCDEFGH');
    expect(normalizeCode('')).toBe('');
  });
  it('formats with one dash after four characters while typing', () => {
    expect(formatCode('ab')).toBe('AB');
    expect(formatCode('abcd')).toBe('ABCD');
    expect(formatCode('abcde')).toBe('ABCD-E');
    expect(formatCode('abcd-efgh')).toBe('ABCD-EFGH');
  });
  it('knows when a code is complete', () => {
    expect(isCompleteCode('ABCD-EFG')).toBe(false);
    expect(isCompleteCode('ABCD-EFGH')).toBe(true);
  });
  it('extracts the code from our QR URL and rejects other QR payloads', () => {
    expect(codeFromScan('https://zagreb.aningfilm.hr/s#ABCD-EFGH')).toBe('ABCDEFGH');
    expect(codeFromScan('http://localhost:8787/s/#code=abcd-efgh')).toBe('ABCDEFGH');
    expect(codeFromScan('https://example.com/menu')).toBeNull();
    expect(codeFromScan('WIFI:S:net;T:WPA;P:secret;;')).toBeNull();
    expect(codeFromScan('ABCD-EFGH')).toBe('ABCDEFGH');
    expect(codeFromScan('ABCD')).toBeNull();
  });
  it('builds the QR payload with the display form in the fragment', () => {
    expect(codeUrl('ABCDEFGH')).toBe('https://zagreb.aningfilm.hr/s#ABCD-EFGH');
    expect(codeUrl('ABCDEFGH', 'http://localhost:8787')).toBe('http://localhost:8787/s#ABCD-EFGH');
  });
  it('spells the code for a screen reader in two groups', () => {
    expect(speakableCode('ABCD-EFGH')).toBe('A B C D, E F G H');
  });
});
