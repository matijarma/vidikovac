import { describe, expect, it } from 'vitest';
import { fillAttribution } from '../../app/src/attribution';
import { ATTRIBUTION } from '../../worker/feed/registry';
import { ATTRIBUTION_CASES, NO_ITEM_SNAPSHOT } from '../fixtures/attribution-cases';

describe('fillAttribution (browser copy)', () => {
  it.each(ATTRIBUTION_CASES)('$name', ({ attribution, snapshot, item, expected }) => {
    expect(fillAttribution(attribution, snapshot, item)).toBe(expected);
  });

  it('strips an unfillable placeholder together with its preceding separator, and keeps no brace', () => {
    const custom = { text: 'Test {nepoznato} vrijednost', url: 'https://example.test/', licence: 'x' };
    expect(fillAttribution(custom, NO_ITEM_SNAPSHOT)).toBe('Test vrijednost');
  });

  it('never returns a brace for any registered module, even with no item at all', () => {
    for (const [module, attribution] of Object.entries(ATTRIBUTION)) {
      const filled = fillAttribution(attribution, NO_ITEM_SNAPSHOT);
      expect(filled, module).not.toContain('{');
      expect(filled, module).not.toContain('}');
    }
  });

  it('is a no-op on text that carries no placeholder', () => {
    const plain = { text: 'Izvor: EMSC, seismicportal.eu', url: 'https://www.seismicportal.eu/', licence: 'EMSC terms' };
    expect(fillAttribution(plain, NO_ITEM_SNAPSHOT)).toBe(plain.text);
  });
});
