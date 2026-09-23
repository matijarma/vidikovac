// The five files the companion plan lets lane C change before deploy D3
// (WP5 §0: city/conditions.ts, city/air.ts, layers/zrak-i-nebo.ts,
// layers/uprava-i-pravo.ts, motion/schematic-host.ts) read every word from the
// catalogue: no inline locale ternary is left, and each key they read is one
// the shared i18n scanner (seam S8) sees, so the orphan test will count it as
// read. Node environment: the scanner resolves the repository from its own URL.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isReferenced, scanI18nSource } from '../app/i18n-scan';

const ROOT = join(import.meta.dirname, '..', '..');
const FILES = ['app/src/city/conditions.ts', 'app/src/city/air.ts', 'app/src/layers/zrak-i-nebo.ts', 'app/src/layers/uprava-i-pravo.ts', 'app/src/motion/schematic-host.ts'];
const read = (file: string): string => readFileSync(join(ROOT, file), 'utf8');

describe('the five isolated files', () => {
  it.each(FILES)('%s carries no inline locale ternary', (file) => {
    const text = read(file);
    expect(text).not.toMatch(/\b(?:en|english|isEn)\s*\?\s*['"`]/);
    expect(text).not.toMatch(/getLocale\(\)\.startsWith\('en'\)\s*\?\s*['"`[]/);
  });

  it('every key they read is visible to the i18n scanner', () => {
    const scan = FILES.reduce((acc, file) => scanI18nSource(file, read(file), acc), scanI18nSource('none.ts', ''));
    for (const key of ['city.airIndex-1', 'city.airIndex-2', 'city.airIndex-3', 'city.airIndex-4', 'city.airIndex-5', 'city.airIndex-6', 'city.airMethod', 'city.consultationsNote', 'weather.reference', 'civic.consultations', 'motion.note']) {
      expect(isReferenced(scan, key), key).toBe(true);
    }
  });
});
