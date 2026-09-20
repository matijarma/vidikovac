import { describe, expect, it } from 'vitest';
import { AREAS, CITY_AREA, SCREEN_AREAS, VENUE_TYPES, areaName, isAreaSlug, isVenueType } from '../../worker/pairing/areas';

describe('areas', () => {
  it('has the 17 gradske četvrti with ASCII slugs', () => {
    expect(AREAS).toHaveLength(17);
    for (const a of AREAS) expect(a.slug).toMatch(/^[a-z0-9-]+$/);
    expect(new Set(AREAS.map((a) => a.slug)).size).toBe(17);
    expect(areaName('gornji-grad-medvescak')).toBe('Gornji grad – Medveščak');
    expect(areaName('pescenica-zitnjak')).toBe('Peščenica – Žitnjak');
    expect(isAreaSlug('donji-grad')).toBe(true);
    expect(isAreaSlug('Donji grad')).toBe(false);
  });
  it('carries the whole city beside the četvrti, as an area but never as a district', () => {
    expect(CITY_AREA).toEqual({ slug: 'zagreb', name: 'Zagreb' });
    expect(AREAS.map((a) => a.slug)).not.toContain('zagreb');
    expect(SCREEN_AREAS).toHaveLength(18);
    expect(SCREEN_AREAS[17]).toBe(CITY_AREA);
    expect(isAreaSlug('zagreb')).toBe(true);
    expect(areaName('zagreb')).toBe('Zagreb');
  });
  it('venue types are the protocol union', () => {
    expect([...VENUE_TYPES].sort()).toEqual(['cetvrt', 'kafic', 'knjiznica', 'ostalo', 'udruga', 'zet']);
    expect(isVenueType('kafic')).toBe(true);
    expect(isVenueType('bar')).toBe(false);
  });
});
