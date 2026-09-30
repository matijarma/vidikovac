// DHMZ's legend of forecast symbols (shared/city/dhmz-symbols.ts): 42 codes, DHMZ's own words, code 22's doubled
// word said once, nothing for a code outside the legend.
import { describe, expect, it } from 'vitest';
import { DHMZ_SYMBOL_CONDITIONS, DHMZ_SYMBOLS, dhmzSymbolWords } from '../../shared/city/dhmz-symbols';

describe('the DHMZ symbol legend (R0)', () => {
  it('holds codes 1 to 42, contiguous', () => {
    expect(Object.keys(DHMZ_SYMBOLS).map(Number)).toEqual(Array.from({ length: 42 }, (_, i) => i + 1));
    expect(DHMZ_SYMBOL_CONDITIONS).toHaveLength(42);
    expect(dhmzSymbolWords('6')).toBe('Oblačno');
    expect(dhmzSymbolWords('12')).toBe('Promjenljivo oblačno uz malu količinu kiše');
  });
  it('says code 22 without its doubled word, and nothing for a code outside the legend', () => {
    expect(DHMZ_SYMBOLS[22]).toBe('Promjenljivo oblačno uz uz malu količinu snijega');
    expect(dhmzSymbolWords('22')).toBe('Promjenljivo oblačno uz malu količinu snijega');
    expect(DHMZ_SYMBOL_CONDITIONS).toContain('promjenljivo oblačno uz malu količinu snijega');
    for (const code of ['0', '43', '1n', '', '06a']) expect(dhmzSymbolWords(code), code).toBeUndefined();
  });
});
