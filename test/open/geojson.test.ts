import { describe, expect, it } from 'vitest';
import type { ModuleSnapshot } from '../../worker/feed/schema';
import { closuresToGeoJson } from '../../worker/open/geojson';

const SNAPSHOT: ModuleSnapshot = {
  module: 'prometnice',
  tier: 'open',
  status: 'live',
  fetchedAt: '2026-09-11T08:00:00Z',
  sourceUpdatedAt: '2026-09-11T07:57:00Z',
  attribution: {
    text: "Sadrži informacije Grada Zagreba (data.zagreb.hr) u skladu s Otvorenom dozvolom; skup 'prometnice'",
    url: 'https://data.zagreb.hr/dataset/prometnice',
    licence: 'Otvorena dozvola',
  },
  items: [
    {
      id: 'c1',
      module: 'prometnice',
      kind: 'closure',
      tier: 'open',
      title: 'Grada Vukovara',
      summary: 'Zatvoreno zbog radova, jedan smjer',
      at: '2026-04-18T07:00:00+00:00',
      until: '2026-09-11T22:00:00+00:00',
      geo: { type: 'LineString', coordinates: [[15.9599, 45.7994], [15.9590, 45.7993]] },
      data: { type: 'ROAD_CLOSED', subtype: 'ROAD_CLOSED_CONSTRUCTION', direction: 'ONE_DIRECTION', adapted: false },
    },
    {
      id: 'c2',
      module: 'prometnice',
      kind: 'closure',
      tier: 'open',
      title: 'Bez geometrije',
    },
    {
      id: 'x',
      module: 'prometnice',
      kind: 'poi',
      tier: 'open',
      title: 'Nije zatvaranje',
      geo: { type: 'Point', coordinates: [15.9, 45.8] },
    },
  ],
};

describe('closuresToGeoJson', () => {
  const fc = closuresToGeoJson(SNAPSHOT, 'https://zagreb.aningfilm.hr');

  it('emits one Feature per closure that has a geometry', () => {
    expect(fc.type).toBe('FeatureCollection');
    expect(fc.features).toHaveLength(1);
    const f = fc.features[0];
    expect(f.type).toBe('Feature');
    expect(f.id).toBe('c1');
    expect(f.geometry).toEqual({ type: 'LineString', coordinates: [[15.9599, 45.7994], [15.9590, 45.7993]] });
  });

  it('marks every feature and the collection as adapted, with the attribution', () => {
    const p = fc.features[0].properties;
    expect(p.adapted).toBe(true); // the item's own `adapted: false` extra does not win
    expect(p.title).toBe('Grada Vukovara');
    expect(p.summary).toBe('Zatvoreno zbog radova, jedan smjer');
    expect(p.from).toBe('2026-04-18T07:00:00+00:00');
    expect(p.until).toBe('2026-09-11T22:00:00+00:00');
    expect(p.direction).toBe('ONE_DIRECTION');
    expect(fc.adapted).toBe(true);
    expect(fc.adaptedBy).toBe('Vidikovac, https://zagreb.aningfilm.hr');
    expect(fc.attribution).toBe(SNAPSHOT.attribution.text);
    expect(fc.licence).toBe('Otvorena dozvola');
    expect(fc.source).toBe('https://data.zagreb.hr/dataset/prometnice');
    expect(fc.fetchedAt).toBe('2026-09-11T08:00:00Z');
    expect(fc.sourceUpdatedAt).toBe('2026-09-11T07:57:00Z');
    expect(fc.status).toBe('live');
  });
});
