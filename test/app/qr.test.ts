// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { createQr } from '../../app/src/ui/qr';

describe('createQr', () => {
  it('renders an inline SVG with role=img and the label', () => {
    const qr = createQr({ payload: 'https://zagreb.aningfilm.hr/s#ABCD-EFGH', ariaLabel: 'QR kod, kod A B C D, E F G H', unavailableText: 'QR nedostupan' });
    expect(qr.isFallback).toBe(false);
    expect(qr.element.querySelector('svg')).not.toBeNull();
    expect(qr.element.getAttribute('role')).toBe('img');
    expect(qr.element.getAttribute('aria-label')).toContain('A B C D');
  });
  it('uses currentColor modules and no remote assets', () => {
    const qr = createQr({ payload: 'x', ariaLabel: 'a', unavailableText: 'n' });
    expect(qr.element.innerHTML).toContain('currentColor');
    expect(qr.element.innerHTML).not.toMatch(/https?:\/\/(?!www\.w3\.org)/);
  });
  it('falls back to escaped text for an empty or oversized payload', () => {
    expect(createQr({ payload: '  ', ariaLabel: 'a', unavailableText: 'n' }).isFallback).toBe(true);
    const long = createQr({ payload: `<b>${'a'.repeat(5000)}</b>`, ariaLabel: 'a', unavailableText: 'n' });
    expect(long.isFallback).toBe(true);
    expect(long.element.innerHTML).not.toContain('<b>');
  });
});
