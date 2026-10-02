// The open-data exports (scripts/snimka/stage-exports.ts): RFC 4180 fields,
// empty cells for missing values, row counts, the bikes sentinels, GeoJSON.
import { describe, expect, it } from 'vitest';
import { bikesRows, closuresGeoJson, csvField, csvText, hourlyRows, localIso, routesRows, seriesRows } from '../../scripts/snimka/stage-exports';
import { encodeBajs, encodeRoutes } from '../../shared/snimka-codec';
import type { ClosuresFile, SeriesFile } from '../../shared/snimka';

const T0 = 1790532000; // Sun 27 Sep 2026 20:00 Zagreb
const col = <T>(...v: (T | null)[]): (T | null)[] => v;

function tinySeries(): SeriesFile {
  const n = 3;
  const nulls = (): null[] => new Array(n).fill(null);
  return {
    v: 2, t0: T0, step: 60, n,
    seen: { all: col(5, 0, null), tram: col(1, 0, null), bus: col(4, 0, null) },
    expected: { all: col(400, 401, 402), tram: col(100, 100, 100), bus: col(300, 301, 302) },
    service: { state: col('silent', 'silent', 'silent'), since: col(T0 - 60, T0 - 60, T0 - 60), ratio: col(0.01, 0, null), hold: col(null, null, 'gap') },
    feed: { headerAgeS: col(10, 20, 80), entities: col(5, 0, null), rejectedFuture: col(0, 0, null), hiddenDepot: col(1, 1, null), hiddenParked: col(0, 0, null), frozen: col(0, 0, null), alerts: col(0, 0, null), cancelledTrips: col(0, 0, null) },
    published: null, bikes: { total: nulls(), empty: nulls(), reporting: nulls() }, closures: null,
    hourly: { t0: T0, n: 1, tempC: col(14.5), weather: col('vedro, sa "suncem", toplo'), newsPulse: [3] },
  };
}

describe('CSV', () => {
  it('quotes a field only when it holds a comma, a quote or a line break, and doubles its quotes', () => {
    expect(csvField('Črnomerec')).toBe('Črnomerec');
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('rekao je "da"')).toBe('"rekao je ""da"""');
    expect(csvField('dva\nretka')).toBe('"dva\nretka"');
    expect(csvField(0)).toBe('0');
    expect(csvField(null)).toBe('');
    expect(csvField(undefined)).toBe('');
    expect(csvField(Number.NaN)).toBe('');
  });

  it('writes the header and every row with LF line ends and a final LF, and counts the header as a row', () => {
    const { text, rows } = csvText(['a', 'b'], [[1, null], ['x,y', 2]]);
    expect(text).toBe('a,b\n1,\n"x,y",2\n');
    expect(rows).toBe(3);
    expect(text).not.toContain('\r');
    expect(() => csvText(['a'], [[1, 2]])).toThrow(/2 cells under 1 columns/);
  });

  it('dates every row on Zagreb\'s clock with +02:00 and the epoch second', () => {
    expect(localIso(T0)).toBe('2026-09-27T20:00:00+02:00');
  });

  it('series: one row per minute, every column, a missing value empty and a real zero kept', () => {
    const { columns, rows } = seriesRows(tinySeries());
    const { text, rows: count } = csvText(columns.map((c) => c.name), rows);
    expect(count).toBe(4);
    const lines = text.trim().split('\n');
    const header = lines[0]!.split(',');
    expect(header.slice(0, 2)).toEqual(['t_local', 't_epoch']);
    for (const name of ['feed_frozen', 'feed_alerts', 'feed_cancelled_trips', 'seen_all', 'expected_all', 'bikes_empty']) expect(header).toContain(name);
    const at = (line: number, name: string): string => lines[line]!.split(',')[header.indexOf(name)]!;
    expect(at(2, 'seen_all')).toBe('0');
    expect(at(3, 'seen_all')).toBe('');
    expect(at(3, 'service_hold')).toBe('gap');
    expect(at(1, 'published_vehicles')).toBe('');
    expect(at(1, 'bikes_total')).toBe('');
    expect(at(1, 't_epoch')).toBe(String(T0));
  });

  it('hourly: the weather words quoted when they need it', () => {
    const { columns, rows } = hourlyRows(tinySeries());
    const { text } = csvText(columns.map((c) => c.name), rows);
    expect(text).toBe('t_local,t_epoch,temp_c,weather,news_pulse\n2026-09-27T20:00:00+02:00,1790532000,14.5,"vedro, sa ""suncem"", toplo",3\n');
  });

  it('routes long: one row per slot and route, 255 empty', () => {
    const file = encodeRoutes(T0, 300, [{ id: '6', shortName: '6', type: 0 }, { id: '228', shortName: '228', type: 3 }], [Uint8Array.of(2, 255), Uint8Array.of(0, 1)], [Uint8Array.of(9, 9), Uint8Array.of(255, 4)]);
    const { rows } = routesRows(file);
    expect(rows).toEqual([
      ['2026-09-27T20:00:00+02:00', T0, '6', '6', 'tram', 2, 9], ['2026-09-27T20:00:00+02:00', T0, '228', '228', 'bus', 0, null],
      ['2026-09-27T20:05:00+02:00', T0 + 300, '6', '6', 'tram', null, 9], ['2026-09-27T20:05:00+02:00', T0 + 300, '228', '228', 'bus', 1, 4],
    ]);
  });

  it('bikes wide: a column per station, 254 as nr and 255 empty', () => {
    const file = encodeBajs(T0, 300, ['a', 'b'], [Uint8Array.of(3, 254), Uint8Array.of(255, 0)]);
    const { columns, rows } = bikesRows(file);
    expect(columns.map((c) => c.name)).toEqual(['t_local', 't_epoch', 'a', 'b']);
    expect(rows).toEqual([['2026-09-27T20:00:00+02:00', T0, 3, null], ['2026-09-27T20:05:00+02:00', T0 + 300, 'nr', 0]]);
  });
});

describe('GeoJSON', () => {
  it('one LineString feature per closure with every version\'s published end', () => {
    const file: ClosuresFile = {
      v: 1, versions: [{ fromSec: T0, toSec: T0 + 3600 }, { fromSec: T0 + 3600, toSec: null }],
      closures: [{ id: 0, street: 'Ilica', type: 'radovi', subtype: null, direction: 'oba', line: [[15.97, 45.81], [15.96, 45.81]], startSec: T0 - 86400 }],
      byVersion: [[[0, T0 + 7200]], [[0, null]]],
    };
    const geo = closuresGeoJson(file);
    expect(geo.type).toBe('FeatureCollection');
    expect(geo.features).toEqual([{
      type: 'Feature', geometry: { type: 'LineString', coordinates: [[15.97, 45.81], [15.96, 45.81]] },
      properties: { id: 0, street: 'Ilica', type: 'radovi', subtype: null, direction: 'oba', start_local: '2026-09-26T20:00:00+02:00',
        ends: [{ version_from_local: '2026-09-27T20:00:00+02:00', end_local: '2026-09-27T22:00:00+02:00' }, { version_from_local: '2026-09-27T21:00:00+02:00', end_local: null }] },
    }]);
    expect(() => JSON.parse(JSON.stringify(geo))).not.toThrow();
  });
});
