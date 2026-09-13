import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PROMETNICE_URL, closureWords, fetchPrometnice, parsePolyline, parsePrometnice } from '../../worker/feed/modules/prometnice';

const raw = JSON.parse(readFileSync(new URL('../fixtures/prometnice.json', import.meta.url), 'utf8'));

describe('parsePolyline', () => {
  it('turns the "lat lon lat lon" string into GeoJSON [lon, lat] pairs', () => {
    expect(parsePolyline('45.805906309659 15.988335060009 45.805820301355 15.98834578568')).toEqual([
      [15.988335060009, 45.805906309659],
      [15.98834578568, 45.805820301355],
    ]);
  });
  it('ignores a dangling value and empty input', () => {
    expect(parsePolyline('45.8 15.9 45.7')).toEqual([[15.9, 45.8]]);
    expect(parsePolyline('')).toEqual([]);
    expect(parsePolyline('   ')).toEqual([]);
  });
});

describe('closureWords', () => {
  it('says why and where in Croatian', () => {
    expect(closureWords('ROAD_CLOSED_CONSTRUCTION', 'BOTH_DIRECTIONS')).toBe('zatvoreno zbog radova, oba smjera');
    expect(closureWords('ROAD_CLOSED_CONSTRUCTION', 'ONE_DIRECTION')).toBe('zatvoreno zbog radova, jedan smjer');
    expect(closureWords('ROAD_CLOSED_EVENT', 'BOTH_DIRECTIONS')).toBe('zatvoreno zbog događaja, oba smjera');
    expect(closureWords('NESTO_DRUGO', '')).toBe('zatvoreno');
  });
});

describe('parsePrometnice', () => {
  const payload = parsePrometnice(raw);

  it('turns every record into a closure with a line geometry', () => {
    expect(payload.items).toHaveLength(32);
    expect(payload.items.every((item) => item.kind === 'closure')).toBe(true);
    expect(payload.items.every((item) => item.geo?.type === 'LineString')).toBe(true);
  });

  it('reads the first closure whole, with stable ids', () => {
    const first = payload.items[0];
    expect(first.title).toBe('Petra i Tome Erdödyja');
    expect(first.severity).toBe('moderate');
    expect(first.at).toBe('2026-03-30T07:54:00.000Z');
    expect(first.until).toBe('2026-09-12T07:54:00.000Z');
    expect(first.summary).toBe('zatvoreno zbog radova, oba smjera');
    expect(first.id).toBe('petra-i-tome-erdodyja:2026-03-30T07:54:00.000Z');
    expect(first.data).toEqual({
      type: 'ROAD_CLOSED',
      subtype: 'ROAD_CLOSED_CONSTRUCTION',
      direction: 'BOTH_DIRECTIONS',
    });
    expect((first.geo?.coordinates as number[][])[0]).toEqual([15.988335060009, 45.805906309659]);
    expect(new Set(payload.items.map((item) => item.id)).size).toBe(32);
  });

  it('marks anything that is not a full closure as minor and survives junk', () => {
    const payload2 = parsePrometnice([
      { type: 'ROAD_NARROWED', street: 'Ilica', polyline: '45.81 15.96 45.82 15.97', expectedStartTime: '2026-09-11T06:00:00+00:00' },
      { type: 'ROAD_CLOSED', street: '', polyline: '' },
      'nije objekt',
    ]);
    expect(payload2.items).toHaveLength(1);
    expect(payload2.items[0].severity).toBe('minor');
    expect(payload2.items[0].until).toBeUndefined();
    expect(parsePrometnice(null).items).toEqual([]);
  });
});

describe('fetchPrometnice', () => {
  it('reads the pinned CKAN resource', async () => {
    const asked: string[] = [];
    const payload = await fetchPrometnice({
      now: () => new Date('2026-09-11T10:00:00.000Z'),
      fetch: async (url) => {
        asked.push(url);
        return new Response(JSON.stringify(raw));
      },
    });
    expect(asked).toEqual([PROMETNICE_URL]);
    expect(PROMETNICE_URL).toBe(
      'https://data.zagreb.hr/dataset/7ff5514d-0a1f-4f6c-86bd-8ed9a3c55eee/resource/e48b6992-add0-45a1-ae95-c5d97d8db259/download/data.json',
    );
    expect(payload.items).toHaveLength(32);
    expect(payload.sourceUpdatedAt).toBeUndefined();
  });
});
