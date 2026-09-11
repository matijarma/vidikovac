import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EMSC_URL, emscQueryUrl, fetchEmsc, magnitudeSeverity, parseEmsc } from '../../worker/feed/modules/emsc';

const raw = JSON.parse(readFileSync(new URL('../fixtures/emsc.json', import.meta.url), 'utf8'));

describe('magnitudeSeverity', () => {
  it('follows the plan thresholds and treats a missing magnitude as info', () => {
    expect(magnitudeSeverity(1.6)).toBe('info');
    expect(magnitudeSeverity(2.999)).toBe('info');
    expect(magnitudeSeverity(3)).toBe('minor');
    expect(magnitudeSeverity(3.9)).toBe('minor');
    expect(magnitudeSeverity(4)).toBe('moderate');
    expect(magnitudeSeverity(5)).toBe('severe');
    expect(magnitudeSeverity(5.9)).toBe('severe');
    expect(magnitudeSeverity(6)).toBe('extreme');
    expect(magnitudeSeverity(Number.NaN)).toBe('info');
  });
});

describe('parseEmsc', () => {
  const payload = parseEmsc(raw);

  it('turns every GeoJSON feature into a quake item, newest first', () => {
    expect(payload.items).toHaveLength(20);
    expect(payload.items.every((item) => item.kind === 'quake')).toBe(true);
    const times = payload.items.map((item) => Date.parse(item.at ?? ''));
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  it('reads the newest event whole, with GeoJSON [lon, lat]', () => {
    const newest = payload.items[0];
    expect(newest.id).toBe('20260909_0000210');
    expect(newest.at).toBe('2026-09-09T17:11:21.790Z');
    expect(newest.severity).toBe('info');
    expect(newest.geo).toEqual({ type: 'Point', coordinates: [14.3609, 45.4524] });
    expect(newest.title).toBe('Potres magnitude 1,6');
    expect(newest.summary).toBe('CROATIA, dubina 10 km');
    expect(newest.data).toEqual({ magnitude: 1.6, magnitudeType: 'ml', depthKm: 10, region: 'CROATIA' });
    expect(payload.sourceUpdatedAt).toBe('2026-09-09T17:24:41.146Z');
  });

  it('skips a feature with no usable position', () => {
    const payload2 = parseEmsc({
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', id: 'a', properties: { time: '2026-09-11T10:00:00Z', mag: 4.2, flynn_region: 'CROATIA' } },
        { type: 'Feature', id: 'b', properties: { unid: 'b', time: '2026-09-11T09:00:00Z', lat: 45.8, lon: 16, mag: 4.2, depth: 5, flynn_region: 'CROATIA' } },
      ],
    });
    expect(payload2.items.map((item) => item.id)).toEqual(['b']);
    expect(payload2.items[0].severity).toBe('moderate');
  });

  it('survives an empty or malformed answer', () => {
    expect(parseEmsc({ type: 'FeatureCollection', features: [] }).items).toEqual([]);
    expect(parseEmsc(null).items).toEqual([]);
    expect(parseEmsc({ features: 'nije polje' }).items).toEqual([]);
  });
});

describe('emscQueryUrl', () => {
  it('bounds the query to the last seven days with a hard limit', () => {
    const url = new URL(emscQueryUrl(new Date('2026-09-11T15:20:00Z')));
    expect(url.searchParams.get('starttime')).toBe('2026-09-04T15:20:00');
    expect(url.searchParams.get('limit')).toBe('100');
    expect(url.searchParams.get('maxradius')).toBe('1.5');
    expect(url.searchParams.get('format')).toBe('json');
  });
});

describe('fetchEmsc', () => {
  it('queries the FDSN event service around Zagreb, bounded to seven days', async () => {
    const asked: string[] = [];
    const payload = await fetchEmsc({
      now: () => new Date('2026-09-11T10:00:00.000Z'),
      fetch: async (url) => {
        asked.push(url);
        return new Response(JSON.stringify(raw));
      },
    });
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain('starttime=');
    expect(asked[0]).toContain('limit=100');
    expect(EMSC_URL).toBe('https://www.seismicportal.eu/fdsnws/event/1/query?lat=45.81&lon=15.98&maxradius=1.5&format=json');
    expect(payload.items).toHaveLength(20);
  });
});
