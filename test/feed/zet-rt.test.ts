import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ZET_RT_URL, delayWords, parseZetRt, routeLabel } from '../../worker/feed/modules/zet-rt';

const bytes = new Uint8Array(readFileSync(new URL('../fixtures/zet-rt.pb', import.meta.url)));
const routes = { '12': { shortName: '12', longName: 'Ljubljanica - Dubec', type: 0 } };

describe('routeLabel and delayWords', () => {
  it('names a known route and falls back to its id', () => {
    expect(routeLabel('12', routes)).toBe('12 Ljubljanica - Dubec');
    expect(routeLabel('268', routes)).toBe('Linija 268');
    expect(routeLabel('6', { '6': { shortName: '6', longName: '', type: 0 } })).toBe('Linija 6');
  });

  it('says lateness and earliness in Croatian', () => {
    expect(delayWords(0)).toBe('na vrijeme');
    expect(delayWords(29)).toBe('na vrijeme');
    expect(delayWords(-29)).toBe('na vrijeme');
    expect(delayWords(102)).toBe('kasni 2 min');
    expect(delayWords(-102)).toBe('rani 2 min');
    expect(delayWords(60)).toBe('kasni 1 min');
  });
});

describe('parseZetRt', () => {
  const payload = parseZetRt(bytes, routes);
  // Both shapes are kind 'vehicle' (R-22); the id prefix separates the moving
  // pins from the one delay summary per route.
  const vehicles = payload.items.filter((item) => item.id.startsWith('vehicle:'));
  const delays = payload.items.filter((item) => item.id.startsWith('route:'));

  it('decodes the real feed into positioned vehicles and per-route delay summaries', () => {
    expect(vehicles.length).toBe(332);
    expect(delays.length).toBeGreaterThan(0);
    expect(payload.sourceUpdatedAt).toBe('2026-09-11T10:59:45.000Z');
  });

  it('gives every vehicle a GeoJSON point and its route id', () => {
    const first = vehicles[0];
    expect(first.geo?.type).toBe('Point');
    const [lon, lat] = first.geo?.coordinates as number[];
    expect(lon).toBeGreaterThan(15.5);
    expect(lon).toBeLessThan(16.5);
    expect(lat).toBeGreaterThan(45.5);
    expect(lat).toBeLessThan(46.2);
    expect(typeof first.data?.routeId).toBe('string');
    expect(typeof first.data?.routeShortName).toBe('string');
    expect(first.id.startsWith('vehicle:')).toBe(true);
    expect(vehicles.every((item) => item.geo)).toBe(true);
  });

  it('summarises delays per route with a median and a vehicle count', () => {
    const route12 = delays.find((item) => item.data?.routeId === '12');
    expect(route12).toBeDefined();
    expect(route12?.id).toBe('route:12');
    expect(route12?.kind).toBe('vehicle');
    expect(route12?.title).toBe('12 Ljubljanica - Dubec');
    expect(route12?.data?.routeShortName).toBe('12');
    expect(typeof route12?.data?.medianDelaySeconds).toBe('number');
    expect(Number(route12?.data?.vehicles)).toBeGreaterThan(0);
    expect(route12?.summary).toMatch(/^(na vrijeme|kasni \d+ min|rani \d+ min)$/);
    const ids = delays.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('names the ZET realtime endpoint', () => {
    expect(ZET_RT_URL).toBe('https://www.zet.hr/gtfs-rt-protobuf');
  });

  // R-P3: ZET's feed carries no bearing and no speed. protobufjs used to
  // return 0 for both absent fields, which compactData kept because 0 is a
  // defined number — every vehicle claimed to face due north and stand
  // still. A reported position is evidence, never output (area T's rule);
  // a fabricated heading and a fabricated stillness are exactly that kind
  // of output, so neither key may ever reach a vehicle row again.
  it('never carries a bearing or a speed: ZET does not send them', () => {
    expect(vehicles.length).toBeGreaterThan(0);
    for (const item of vehicles) {
      expect(item.data).not.toHaveProperty('bearing');
      expect(item.data).not.toHaveProperty('speed');
    }
  });

  it('returns nothing for an empty feed rather than throwing', () => {
    expect(parseZetRt(new Uint8Array(0), {}).items).toEqual([]);
  });
});
