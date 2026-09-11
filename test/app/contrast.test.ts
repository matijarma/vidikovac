import { describe, expect, it } from 'vitest';
import { AA_TEXT, contrastRatio, luminance } from '../../app/src/ui/contrast';

describe('WCAG contrast arithmetic', () => {
  it('black on white is 21:1 and a colour on itself is 1:1', () => {
    expect(Math.round(contrastRatio('#000000', '#ffffff'))).toBe(21);
    expect(contrastRatio('#64748b', '#64748b')).toBeCloseTo(1, 5);
  });
  it('is symmetric and accepts 3-digit hex', () => {
    expect(contrastRatio('#fff', '#000')).toBeCloseTo(contrastRatio('#000000', '#ffffff'), 6);
  });
  it('luminance follows the sRGB curve', () => {
    expect(luminance('#ffffff')).toBeCloseTo(1, 6);
    expect(luminance('#000000')).toBe(0);
    expect(luminance('#808080')).toBeCloseTo(0.2159, 3);
  });
  it('rejects a non-hex value loudly instead of returning NaN', () => {
    expect(() => luminance('rgba(1,2,3,0.5)')).toThrow(/hex/);
  });
  it('the slate pair psdlat shipped really fails AA', () => {
    expect(contrastRatio('#94a3b8', '#f1f5f9')).toBeLessThan(AA_TEXT);
  });
});
