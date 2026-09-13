import { describe, expect, it, vi } from 'vitest';
import { createDefaultI18n } from '../../app/src/i18n/create-default-i18n';
import { delayTone } from '../../app/src/experience/delay';

const hr = createDefaultI18n('hr');

describe('delayTone', () => {
  it('follows the shared helper: on time inside the band, late and early outside it, none without a figure', () => {
    expect(delayTone(hr, 0)).toBe('ontime');
    expect(delayTone(hr, 15)).toBe('ontime');
    expect(delayTone(hr, 90)).toBe('late');
    expect(delayTone(hr, -90)).toBe('early');
    expect(delayTone(hr, undefined)).toBe('none');
    expect(delayTone(hr, Number.NaN)).toBe('none');
  });
  it('gives no tone to a word the helper does not assert as a delay, whatever the number was', async () => {
    vi.resetModules();
    vi.doMock('../../app/src/layers/shared', () => ({ delayWord: (_i18n: unknown, seconds: number) => (Math.abs(seconds) > 5400 ? 'nije potvrđeno' : 'kasni 2 min') }));
    const { delayTone: toned } = await import('../../app/src/experience/delay');
    expect(toned(hr, 18_600)).toBe('none');
    expect(toned(hr, 120)).toBe('late');
    vi.doUnmock('../../app/src/layers/shared');
  });
});
